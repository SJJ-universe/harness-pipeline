// Slice MB4-b (Phase D Round 2, 2026-04-27) — General pipeline runner.
//
// Behaviour-preserving lift of `runGeneralPipeline` + `finalizeGeneralRun`
// + the 3 prompt builders (planner / refiner / critic) out of server.js.
// The runtime contract is identical:
//
//   const { runGeneralPipeline, buildPlannerPrompt, buildRefinerPrompt,
//           buildCriticPrompt } = createGeneralPipelineRunner({
//     broadcast,                  // event broadcaster
//     claudeRunner, codexRunner,  // executors
//     generalRunRef,              // { active: { aborted? } | null }
//     activeCodexChildren,        // Set<ChildProcess>
//     workingDir,                 // cwd for Claude/Codex spawns
//     timeoutMs,                  // optional override (default 600_000)
//   });
//
// Tested via tests/unit/general-pipeline-runner.test.js. server.js
// requires this module + binds the four returned functions to closures
// it already had — no behaviour change for /api/pipeline/general.

function createGeneralPipelineRunner({
  broadcast,
  claudeRunner,
  codexRunner,
  generalRunRef,
  activeCodexChildren,
  workingDir,
  timeoutMs,
} = {}) {
  if (typeof broadcast !== "function") {
    throw new Error("createGeneralPipelineRunner: broadcast must be a function");
  }
  if (!claudeRunner || typeof claudeRunner.exec !== "function") {
    throw new Error("createGeneralPipelineRunner: claudeRunner.exec required");
  }
  if (!codexRunner || typeof codexRunner.exec !== "function") {
    throw new Error("createGeneralPipelineRunner: codexRunner.exec required");
  }
  const _generalRunRef = generalRunRef || { active: null };
  const _activeCodexChildren = activeCodexChildren || new Set();
  const _workingDir = workingDir || process.cwd();
  const PIPELINE_TIMEOUT_MS = Number(timeoutMs)
    || Number(process.env.PIPELINE_TIMEOUT_MS)
    || 600_000;

  // ── Prompt builders (string-only, behaviour-preserving copies). ──

  function buildPlannerPrompt(task) {
    return (
      `You are a software planner. Create a concrete implementation plan for the task below.\n` +
      `Respond in Korean using this exact markdown structure:\n\n` +
      `# 목표\n(1-2 sentences)\n\n` +
      `# 범위\n- (in-scope bullet)\n- (out-of-scope bullet)\n\n` +
      `# 작업 단계\n1. (actionable step)\n2. ...\n\n` +
      `# 리스크\n- (risk)\n\n` +
      `# 검증\n- (how to verify)\n\n` +
      `Do NOT write code or modify any files. Planning only. Keep it under 700 words.\n\n` +
      `TASK: ${task}`
    );
  }

  function buildRefinerPrompt(task, prevPlan, critique) {
    return (
      `You are a software planner. Revise the implementation plan below based on the critic's feedback.\n` +
      `Address every critical and high severity finding explicitly.\n` +
      `Respond in Korean using the same markdown structure (# 목표 / # 범위 / # 작업 단계 / # 리스크 / # 검증).\n` +
      `Do NOT write code or modify any files. Planning only.\n\n` +
      `TASK: ${task}\n\n` +
      `PREVIOUS PLAN:\n${prevPlan.slice(0, 4500)}\n\n` +
      `CRITIC FEEDBACK:\n${critique.slice(0, 3000)}`
    );
  }

  function buildCriticPrompt(task, plan) {
    return (
      `You are a plan critic. Review this implementation plan and list concrete risks, missing steps, and improvements.\n` +
      `Respond in Korean. Use bullet lines in this exact format:\n` +
      `- [critical|high|medium|low] <message>\n` +
      `End with a "## Summary" section (1-2 sentences).\n\n` +
      `TASK: ${task}\n\nPLAN:\n${plan.slice(0, 6000)}`
    );
  }

  // ── finalizeGeneralRun (broadcast + summary builder). ──

  function finalizeGeneralRun({
    runId, started, plan, lastCritique, iterations,
    history, aborted, failed, reason,
  } = {}) {
    const duration = Date.now() - (started || Date.now());
    const verdict = failed
      ? "ERROR"
      : aborted
        ? "ABORTED"
        : ((lastCritique && lastCritique.findings) || []).some(
            (f) => f.severity === "critical" || f.severity === "high"
          )
          ? "CONCERNS"
          : "CLEAN";

    broadcast({
      type: "general_plan_complete",
      data: {
        runId,
        verdict,
        iterations: iterations || 0,
        durationMs: duration,
        finalPlan: plan || "",
        lastCritique: lastCritique || null,
        reason: reason || null,
        aborted: !!aborted,
        failed: !!failed,
      },
    });

    broadcast({
      type: "pipeline_complete",
      data: {
        tokenUsage: {},
        errors: failed
          ? [{ phase: "general", node: "orchestrator", message: reason || "failed" }]
          : [],
        duration,
        harnessId: "general-plan",
      },
    });
    return { verdict, iterations: iterations || 0, durationMs: duration, plan };
  }

  // ── runGeneralPipeline (Phase A → B → C↔D cycle). ──

  async function runGeneralPipeline(task, maxIter, runId) {
    const started = Date.now();
    const history = [];
    let plan = "";
    let lastCritique = null;
    let iteration = 0;

    const isTimedOut = () => (Date.now() - started) > PIPELINE_TIMEOUT_MS;
    const isAborted = () => _generalRunRef.active && _generalRunRef.active.aborted;

    // AGENT-DESKTOP-0-diag2 (2026-05-06): server-side breadcrumbs to
    // diagnose the "modal closed but server terminal silent" path.
    // Visible in the bat console window so the operator can see exactly
    // where the runner is when the UI says it never started.
    console.log(`[runner] === pipeline START runId=${runId} task="${task.slice(0, 60)}" maxIter=${maxIter} ===`);

    broadcast({
      type: "pipeline_start",
      data: { targetFile: `task: ${task.slice(0, 80)}`, mode: "live", runId, template: "default" },
    });
    console.log(`[runner] broadcast pipeline_start runId=${runId}`);

    // Phase A — context: marked completed immediately (the user-provided
    // task IS the context for this automated flow).
    broadcast({ type: "phase_update", data: { phase: "A", status: "active" } });
    broadcast({ type: "node_update", data: { node: "context-analyzer", status: "active" } });
    await new Promise((r) => setTimeout(r, 200));
    broadcast({ type: "node_update", data: { node: "context-analyzer", status: "completed" } });
    broadcast({ type: "phase_update", data: { phase: "A", status: "completed" } });
    if (isAborted() || isTimedOut()) {
      console.log(`[runner] aborted/timeout BEFORE phase B runId=${runId}`);
      return finalizeGeneralRun({
        aborted: true, runId, started,
        reason: isTimedOut() ? "pipeline-timeout" : undefined,
      });
    }

    // Phase B — Claude plans.
    broadcast({ type: "phase_update", data: { phase: "B", status: "active" } });
    broadcast({ type: "node_update", data: { node: "task-planner", status: "active" } });

    console.log(`[runner] invoking claudeRunner.exec (Phase B planner) runId=${runId} timeout=180s`);
    const planResultB = await claudeRunner.exec(buildPlannerPrompt(task), {
      timeoutMs: 180000,
      cwd: _workingDir,
      onChild: (c) => _activeCodexChildren.add(c),
    });
    console.log(`[runner] claudeRunner.exec returned runId=${runId} ok=${planResultB && planResultB.ok} exitCode=${planResultB && planResultB.exitCode} textLen=${(planResultB && planResultB.text || "").length} stderrHead="${((planResultB && planResultB.stderr) || "").slice(0, 200)}" errorHead="${((planResultB && planResultB.error) || "").slice(0, 200)}"`);

    if (!planResultB.ok || !planResultB.text) {
      console.log(`[runner] Phase B FAILED runId=${runId} — broadcasting error + finalizing`);
      broadcast({
        type: "error",
        data: {
          phase: "B",
          node: "task-planner",
          message: `Claude 플래닝 실패: exit=${planResultB.exitCode} ${(planResultB.stderr || planResultB.error || "").slice(0, 300)}`,
        },
      });
      broadcast({ type: "node_update", data: { node: "task-planner", status: "error" } });
      broadcast({ type: "phase_update", data: { phase: "B", status: "error" } });
      return finalizeGeneralRun({ failed: true, reason: "claude-plan-failed", runId, started });
    }
    plan = planResultB.text;
    history.push({ phase: "B", iteration: 0, plan });
    broadcast({
      type: "log_message",
      data: { level: "info", message: `[B] Claude 플랜 생성 완료 (${plan.length}자)` },
    });
    broadcast({ type: "node_update", data: { node: "task-planner", status: "completed" } });
    broadcast({ type: "phase_update", data: { phase: "B", status: "completed" } });
    if (isAborted() || isTimedOut()) {
      return finalizeGeneralRun({
        aborted: true, runId, started, plan,
        reason: isTimedOut() ? "pipeline-timeout" : undefined,
      });
    }

    // Phase C ↔ D cycle.
    while (iteration < maxIter) {
      if (isTimedOut()) {
        broadcast({
          type: "log_message",
          data: { level: "warn", message: `[pipeline] wall-clock timeout (${PIPELINE_TIMEOUT_MS}ms) — stopping cycle` },
        });
        return finalizeGeneralRun({
          runId, started, plan, lastCritique,
          iterations: iteration, history,
          failed: true, reason: "pipeline-timeout",
        });
      }
      // Phase C: Codex critique.
      broadcast({ type: "phase_update", data: { phase: "C", status: "active" } });
      broadcast({ type: "node_update", data: { node: "plan-critic", status: "active" } });
      broadcast({
        type: "codex_started",
        data: { phase: "C", iteration, promptPreview: `Critique iteration ${iteration + 1}/${maxIter}` },
      });

      const critiqueResult = await codexRunner.exec(buildCriticPrompt(task, plan), {
        timeoutMs: 150000,
        cwd: _workingDir,
        phaseId: "C",
        iteration,
        source: "general-pipeline",
      });

      const findings = critiqueResult.findings || [];
      const summary = critiqueResult.summary || "";
      lastCritique = { findings, summary, ok: critiqueResult.ok, iteration };

      broadcast({
        type: "critique_received",
        data: {
          phase: "C",
          iteration,
          ok: critiqueResult.ok,
          summary,
          findings,
          error: critiqueResult.error || null,
        },
      });

      if (!critiqueResult.ok) {
        broadcast({
          type: "error",
          data: {
            phase: "C",
            node: "plan-critic",
            message: `Codex 비평 실패: exit=${critiqueResult.exitCode} ${(critiqueResult.stderr || critiqueResult.error || "").slice(0, 300)}`,
          },
        });
        broadcast({ type: "node_update", data: { node: "plan-critic", status: "error" } });
        return finalizeGeneralRun({
          failed: true, reason: "codex-critique-failed",
          runId, started, plan, lastCritique,
        });
      }

      broadcast({
        type: "node_update",
        data: { node: "plan-critic", status: "completed", findings: findings.length },
      });

      const hasCriticalOrHigh = findings.some((f) => f.severity === "critical" || f.severity === "high");
      const canIterate = iteration + 1 < maxIter;

      if (!hasCriticalOrHigh) {
        broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
        broadcast({
          type: "log_message",
          data: { level: "info", message: `[C] critical/high 없음 — 사이클 종료` },
        });
        break;
      }

      if (!canIterate) {
        broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
        broadcast({
          type: "log_message",
          data: {
            level: "warn",
            message: `[C] 최대 반복(${maxIter}) 도달 — 남은 critical/high: ${findings.filter((f) => f.severity === "critical" || f.severity === "high").length}`,
          },
        });
        break;
      }

      // Phase D: Claude refines.
      iteration++;
      broadcast({ type: "cycle_iteration", data: { phase: "C", iteration, linkedTo: "D" } });
      broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
      broadcast({ type: "phase_update", data: { phase: "D", status: "active" } });
      broadcast({ type: "node_update", data: { node: "plan-refiner", status: "active" } });

      if (isAborted() || isTimedOut()) {
        return finalizeGeneralRun({
          aborted: true, runId, started, plan, lastCritique,
          reason: isTimedOut() ? "pipeline-timeout" : undefined,
        });
      }

      const critiqueText =
        findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n") +
        (summary ? `\n\n## Summary\n${summary}` : "");
      const refineResult = await claudeRunner.exec(
        buildRefinerPrompt(task, plan, critiqueText),
        { timeoutMs: 180000, cwd: _workingDir }
      );

      if (!refineResult.ok || !refineResult.text) {
        broadcast({
          type: "error",
          data: {
            phase: "D",
            node: "plan-refiner",
            message: `Claude 수정 실패: exit=${refineResult.exitCode} ${(refineResult.stderr || refineResult.error || "").slice(0, 300)}`,
          },
        });
        broadcast({ type: "node_update", data: { node: "plan-refiner", status: "error" } });
        return finalizeGeneralRun({
          failed: true, reason: "claude-refine-failed",
          runId, started, plan, lastCritique,
        });
      }
      plan = refineResult.text;
      history.push({ phase: "D", iteration, plan });
      broadcast({
        type: "log_message",
        data: { level: "info", message: `[D] Claude 플랜 수정 완료 (${plan.length}자, 반복 ${iteration})` },
      });
      broadcast({ type: "node_update", data: { node: "plan-refiner", status: "completed" } });
      broadcast({ type: "phase_update", data: { phase: "D", status: "completed" } });
    }

    return finalizeGeneralRun({
      runId, started, plan, lastCritique,
      iterations: iteration, history,
    });
  }

  return {
    runGeneralPipeline,
    finalizeGeneralRun,
    buildPlannerPrompt,
    buildRefinerPrompt,
    buildCriticPrompt,
  };
}

module.exports = { createGeneralPipelineRunner };
