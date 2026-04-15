// Automated General Pipeline — Claude plan ↔ Codex critique cycle.
//
// Flow: Phase B (Claude plans) → Phase C (Codex critiques) → if critical/high
// findings AND iteration < max: Phase D (Claude refines) → Phase C again.
// Each phase broadcasts phase_update / node_update / critique_received events
// so the existing dashboard visualizes the cycle on the "default" template.
//
// Claude is invoked via `claude -p --bare` to avoid re-entering the harness.
// Codex uses the same CodexRunner the verify API uses.
//
// Extracted from server.js in P2-3 to keep the HTTP entrypoint small.
// The prompt builders are pure and exported so unit tests can assert the
// Korean markdown skeleton without spawning a subprocess.

const path = require("path");

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

// Build a runner bound to the server's broadcast + runners + child registry.
// Returns the orchestrator + two helpers (start/abort) that server.js uses
// to expose the /api/pipeline/general-run endpoints.
function createGeneralPipeline({ broadcast, claudeRunner, codexRunner, childRegistry, workspaceRoot }) {
  const cwd = workspaceRoot || path.resolve(__dirname, "..", "..");
  let activeRun = null;

  async function runGeneralPipeline(task, maxIter, runId) {
    const started = Date.now();
    const history = [];
    let plan = "";
    let lastCritique = null;
    let iteration = 0;

    const isAborted = () => activeRun && activeRun.aborted;

    broadcast({
      type: "pipeline_start",
      data: { targetFile: `task: ${task.slice(0, 80)}`, mode: "live", runId, template: "default" },
    });

    // ── Phase A (컨텍스트 수집): immediately completed — task IS the context.
    broadcast({ type: "phase_update", data: { phase: "A", status: "active" } });
    broadcast({ type: "node_update", data: { node: "context-analyzer", status: "active" } });
    await new Promise((r) => setTimeout(r, 200));
    broadcast({ type: "node_update", data: { node: "context-analyzer", status: "completed" } });
    broadcast({ type: "phase_update", data: { phase: "A", status: "completed" } });
    if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started });

    // ── Phase B (Claude 계획 수립) ──
    broadcast({ type: "phase_update", data: { phase: "B", status: "active" } });
    broadcast({ type: "node_update", data: { node: "task-planner", status: "active" } });

    const planResultB = await claudeRunner.exec(buildPlannerPrompt(task), {
      timeoutMs: 180000,
      cwd,
      onChild: (c) => childRegistry.track(c, "claude"),
    });

    if (!planResultB.ok || !planResultB.text) {
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
    if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started });

    // ── Phase C ↔ D cycle ──
    while (iteration < maxIter) {
      broadcast({ type: "phase_update", data: { phase: "C", status: "active" } });
      broadcast({ type: "node_update", data: { node: "plan-critic", status: "active" } });
      broadcast({
        type: "codex_started",
        data: { phase: "C", iteration, promptPreview: `Critique iteration ${iteration + 1}/${maxIter}` },
      });

      const critiqueResult = await codexRunner.exec(buildCriticPrompt(task, plan), {
        timeoutMs: 150000,
        cwd,
        onChild: (c) => childRegistry.track(c, "codex"),
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
          failed: true,
          reason: "codex-critique-failed",
          runId,
          started,
          plan,
          lastCritique,
        });
      }

      broadcast({ type: "node_update", data: { node: "plan-critic", status: "completed", findings: findings.length } });

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

      iteration++;
      broadcast({ type: "cycle_iteration", data: { phase: "C", iteration, linkedTo: "D" } });
      broadcast({ type: "phase_update", data: { phase: "C", status: "completed" } });
      broadcast({ type: "phase_update", data: { phase: "D", status: "active" } });
      broadcast({ type: "node_update", data: { node: "plan-refiner", status: "active" } });

      if (isAborted()) return finalizeGeneralRun({ aborted: true, runId, started, plan, lastCritique });

      const critiqueText =
        findings.map((f) => `- [${f.severity}] ${f.message}`).join("\n") +
        (summary ? `\n\n## Summary\n${summary}` : "");
      const refineResult = await claudeRunner.exec(buildRefinerPrompt(task, plan, critiqueText), {
        timeoutMs: 180000,
        cwd,
        onChild: (c) => childRegistry.track(c, "claude"),
      });

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
        return finalizeGeneralRun({ failed: true, reason: "claude-refine-failed", runId, started, plan, lastCritique });
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

    return finalizeGeneralRun({ runId, started, plan, lastCritique, iterations: iteration, history });
  }

  function finalizeGeneralRun({ runId, started, plan, lastCritique, iterations, history, aborted, failed, reason }) {
    const duration = Date.now() - (started || Date.now());
    const verdict = failed
      ? "ERROR"
      : aborted
      ? "ABORTED"
      : (lastCritique && lastCritique.findings || []).some((f) => f.severity === "critical" || f.severity === "high")
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
        errors: failed ? [{ phase: "general", node: "orchestrator", message: reason || "failed" }] : [],
        duration,
        harnessId: "general-plan",
      },
    });
    return { verdict, iterations: iterations || 0, durationMs: duration, plan };
  }

  function start(task, maxIter) {
    if (activeRun) return { error: "another general-run pipeline is already active" };
    const runId = `gr-${Date.now()}`;
    activeRun = { runId, startedAt: Date.now(), aborted: false };
    const promise = runGeneralPipeline(task, maxIter, runId)
      .catch((err) => {
        broadcast({ type: "error", data: { phase: "general", node: "orchestrator", message: err.message } });
      })
      .finally(() => {
        activeRun = null;
      });
    return { runId, promise };
  }

  function abort() {
    if (!activeRun) return null;
    activeRun.aborted = true;
    return activeRun.runId;
  }

  function isActive() {
    return !!activeRun;
  }

  return { runGeneralPipeline, start, abort, isActive };
}

module.exports = {
  createGeneralPipeline,
  runGeneralPipeline: (...args) => {
    throw new Error("runGeneralPipeline requires createGeneralPipeline(deps) first");
  },
  buildPlannerPrompt,
  buildRefinerPrompt,
  buildCriticPrompt,
};
