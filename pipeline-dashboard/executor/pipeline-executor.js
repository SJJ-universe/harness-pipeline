// PipelineExecutor — Phase 2 + Phase 3 scope
//
// Responsibilities:
//   1. Detect a task from the user's prompt and activate a pipeline template
//   2. Enforce `allowedTools` per phase via PreToolUse blocking
//   3. Auto-run Codex phases (agent === "codex") via CodexRunner
//   4. Evaluate QualityGate (exitCriteria) on Stop — block + feedback on fail
//   5. Thread PipelineState across phases; capture artifacts via template rules
//   6. Inject SKILL.md content into Codex prompts via SkillInjector
//
// Phase 4 will add PipelineAdapter mutation.
//
// Safety: activation is gated by process.env.HARNESS_ENABLED !== "1" by default.

const fs = require("fs");
const path = require("path");
const { PipelineState } = require("./pipeline-state");
const { QualityGate } = require("./quality-gate");
const { SkillInjector } = require("./skill-injector");
const { PipelineAdapter } = require("./pipeline-adapter");
const { enforceTemplateDefaults, evaluateTool } = require("../src/policy/phasePolicy");
const dangerGate = require("../src/policy/dangerGate");
const { checkToolAgainstContract } = require("../src/contracts/agentContracts");
const { ClaimVerifier } = require("../src/verification/claimVerifier");

// _workspace/ lives in the user's project root (one level above pipeline-dashboard).
// Codex critiques are persisted here so Claude can Read them between Phase C → D.
const DEFAULT_WORKSPACE_DIR = path.resolve(__dirname, "..", "..", "_workspace");

const TASK_PATTERNS = {
  "code-review": /리뷰|review|검토/i,
  "testing": /테스트|test|jest|pytest|vitest|coverage/i,
  "debugging": /디버그|debug|버그|bug|에러|error|fix|수정|고치|오류/i,
  "refactoring": /리팩토|refactor|개선|improve|clean[\s-]*up/i,
  "planning": /계획|plan|설계|design|아키텍처|architecture/i,
  "implementation": /구현|implement|만들|생성|추가|add|create|feature|기능/i,
};

const TEMPLATE_MAP = {
  "code-review": "code-review",
  "testing": "testing",
  "debugging": "default",
  "refactoring": "default",
  "planning": "default",
  "implementation": "default",
};

const MAX_GATE_RETRIES = 3;

class PipelineExecutor {
  constructor({ broadcast, templates, codex, state, gate, injector, adapter, workspaceDir, repoRoot }) {
    this.broadcast = broadcast;
    this.templates = templates;
    this.codex = codex;
    this.state = state || new PipelineState();
    this.gate = gate || new QualityGate();
    this.injector = injector || new SkillInjector({});
    this.adapter = adapter || new PipelineAdapter({ templates });
    this.workspaceDir =
      workspaceDir || process.env.HARNESS_WORKSPACE_DIR || DEFAULT_WORKSPACE_DIR;
    this.repoRoot = repoRoot || path.resolve(__dirname, "..", "..");

    this.active = null;
    this.enabled = process.env.HARNESS_ENABLED === "1";
  }

  setEnabled(flag) {
    this.enabled = !!flag;
    if (!this.enabled && this.active) {
      this._complete("disabled");
    }
    this.broadcast({ type: "harness_mode", data: { enabled: this.enabled } });
  }

  getStatus() {
    return {
      enabled: this.enabled,
      active: !!this.active,
      templateId: this.active?.templateId || null,
      phaseIdx: this.active?.phaseIdx ?? -1,
      phase: this._currentPhase()?.id || null,
      iteration: this.active?.iteration || 0,
      gateRetries: this.active?.gateRetries || 0,
      tools: this.state?.metrics?.toolCount || 0,
      filesEdited: this.state?.metrics?.filesEdited?.size || 0,
      findings: this.state?.findings?.length || 0,
    };
  }

  // ── Hook entry points ─────────────────────────────────────────
  async startFromPrompt(prompt) {
    if (!this.enabled) return {};
    if (!prompt || typeof prompt !== "string") return {};

    const taskType = this._detectTaskType(prompt);
    if (!taskType) return {};

    const templateId = TEMPLATE_MAP[taskType] || "default";
    const template = this.templates[templateId];
    if (!template) return {};

    this.state.reset({ userPrompt: prompt, templateId });

    // Deep clone so Phase 4 mutations don't corrupt the source template
    this.active = {
      templateId,
      template: enforceTemplateDefaults(template),
      phaseIdx: -1,
      iteration: 0,
      gateRetries: 0,
      userPrompt: prompt,
      startedAt: Date.now(),
    };

    this.broadcast({
      type: "auto_pipeline_detect",
      data: { templateId, taskType, reason: `hook-driven: ${taskType}`, source: "hook" },
    });

    await this._enterPhase(0);

    // Return phase guidance so Claude knows what tools to use
    const firstPhase = this.active.template.phases[0];
    if (firstPhase) {
      return this._buildPhaseGuidance(firstPhase);
    }
    return {};
  }

  /**
   * Build a guidance response that Claude Code receives after UserPromptSubmit.
   * This is NOT a block — it's supplementary context that Claude sees.
   */
  _buildPhaseGuidance(phase) {
    const tools = (phase.allowedTools || []).join(", ");
    const criteria = (phase.exitCriteria || []).map((c) => c.message).join("; ");
    return {
      suppressOutput: false,
      message:
        `[SJ 하네스 엔진] Phase ${phase.id} (${phase.name}) 시작\n` +
        `허용 도구: ${tools || "제한 없음"}\n` +
        `완료 조건: ${criteria || "없음"}\n` +
        `조건을 충족한 후 턴을 종료하면 다음 Phase로 진행됩니다.`,
    };
  }

  async onPreTool(tool, _input) {
    if (!this.enabled || !this.active) return {};
    const phase = this._currentPhase();
    if (!phase) return {};

    const danger = dangerGate.evaluate({
      type: tool === "Bash" ? "command" : "tool",
      tool,
      input: _input || {},
      command: _input?.command,
      phaseId: phase.id,
      repoRoot: this.repoRoot,
      path: _input?.file_path || _input?.filePath || _input?.path,
    });
    if (danger.decision === "block") {
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, reason: danger.reason, matchedRule: danger.matchedRule, source: "danger" },
      });
      return { decision: "block", reason: danger.reason };
    }

    const policy = evaluateTool({ phase, tool, input: _input || {} });
    if (policy.decision === "block") {
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, reason: policy.reason, source: "policy" },
      });
      return { decision: "block", reason: policy.reason };
    }

    // Agent contract enforcement
    const agentName = this._resolveAgentName(phase);
    const contractResult = checkToolAgainstContract(agentName, tool, _input || {});
    if (!contractResult.allowed) {
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, reason: contractResult.reason, source: "contract" },
      });
      return { decision: "block", reason: contractResult.reason };
    }

    const allowed = phase.allowedTools;
    if (!allowed || allowed.length === 0) return {};

    if (!allowed.includes(tool)) {
      const nextPhase = this.active.template.phases[this.active.phaseIdx + 1];
      const nextInfo = nextPhase
        ? `다음 Phase ${nextPhase.id} (${nextPhase.name})에서 ${tool}을(를) 사용할 수 있습니다.`
        : "";
      // Suggest Write when Edit is blocked but Write is allowed (plan file update)
      const altHint = (tool === "Edit" && allowed.includes("Write"))
        ? "파일을 수정하려면 Edit 대신 Write로 전체 내용을 다시 작성하세요.\n"
        : "";
      const reason =
        `[SJ 하네스] Phase ${phase.id} (${phase.name})에서 ${tool}은(는) 사용할 수 없습니다.\n` +
        `현재 허용: ${allowed.join(", ")}\n` +
        `${altHint}` +
        `${nextInfo}\n` +
        `지금은 허용된 도구로 이 Phase의 목적을 완수하세요. 완료 후 턴을 종료하면 자동으로 다음 Phase로 진행됩니다.`;
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, allowed, source: "allowedTools" },
      });
      return { decision: "block", reason };
    }
    return {};
  }

  async onPostTool(tool, response, input) {
    if (!this.enabled || !this.active) return {};
    const phase = this._currentPhase();
    if (!phase) return {};

    this.state.recordTool(phase.id, tool, response);
    this._captureArtifacts(phase, tool, response);

    this.broadcast({
      type: "tool_recorded",
      data: {
        phase: phase.id,
        tool,
        input: input || {},
        filesEdited: this.state.metrics.filesEdited.size,
      },
    });
    return {};
  }

  async onStop(_payload) {
    if (!this.enabled || !this.active) return {};

    const phase = this._currentPhase();
    if (!phase) {
      await this._advance();
      return {};
    }

    const gateResult = await this.gate.evaluate(phase, this.state);
    this.broadcast({
      type: "gate_evaluated",
      data: { phase: phase.id, pass: gateResult.pass, missing: gateResult.missing },
    });

    if (!gateResult.pass) {
      this.active.gateRetries = (this.active.gateRetries || 0) + 1;

      if (this.active.gateRetries >= MAX_GATE_RETRIES) {
        // Give up blocking after too many retries to avoid an infinite loop
        this.broadcast({
          type: "gate_bypassed",
          data: { phase: phase.id, retries: this.active.gateRetries, missing: gateResult.missing },
        });
        this.active.gateRetries = 0;
        await this._advance();
        return {};
      }

      const tools = (phase.allowedTools || []).join(", ");
      const reason =
        `[SJ 하네스] Phase ${phase.id} (${phase.name}) 완료 조건 미충족\n` +
        `미충족 조건: ${gateResult.missing.join("; ")}\n` +
        `허용 도구: ${tools || "제한 없음"}\n` +
        `위 조건을 충족한 후 다시 턴을 종료하세요. (시도 ${this.active.gateRetries}/${MAX_GATE_RETRIES})`;
      this.broadcast({
        type: "gate_failed",
        data: { phase: phase.id, missing: gateResult.missing, retries: this.active.gateRetries },
      });
      return { decision: "block", reason };
    }

    this.active.gateRetries = 0;
    await this._advance();

    // FIX-2: if Phase C just ran and produced a critique, instruct Claude to
    // read the critique file before ending the turn. Returning `decision: block`
    // on Stop re-prompts Claude with the reason as new context.
    if (this.active && this.active.pendingHint) {
      const hint = this.active.pendingHint;
      this.active.pendingHint = null;
      if (hint.type === "codex_critique_ready") {
        const sev = (hint.findings || [])
          .reduce((acc, f) => {
            const k = (f.severity || "other").toLowerCase();
            acc[k] = (acc[k] || 0) + 1;
            return acc;
          }, {});
        const sevLine = Object.entries(sev)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ");
        const reason =
          `[Harness] Phase C 완료 — Codex 비평이 파일로 저장되었습니다.\n` +
          `  파일: ${hint.critiquePath}\n` +
          (hint.ok
            ? `  Codex 실행: OK\n`
            : `  Codex 실행: FAILED (${hint.error || "unknown"})\n`) +
          `  Findings: ${(hint.findings || []).length}건` +
          (sevLine ? ` (${sevLine})` : "") +
          `\n\n` +
          `다음 행동:\n` +
          `1. Read 도구로 위 파일을 먼저 읽으세요.\n` +
          `2. 비평 내용을 반영하여 plan*.md를 Edit/Write로 보완하세요.\n` +
          `3. 보완이 끝나면 턴을 종료하여 다음 Phase로 진행하세요.\n` +
          `(이 메시지는 Phase C→D 전환 시 한 번만 표시됩니다.)`;
        return { decision: "block", reason };
      }
    }

    return {};
  }

  async onSessionEnd(_payload) {
    if (!this.active) return {};
    this._complete("session-end");
    return {};
  }

  // ── Internal ──────────────────────────────────────────────────
  _persistCritique(phase, iteration, prompt, result) {
    try {
      if (!fs.existsSync(this.workspaceDir)) {
        fs.mkdirSync(this.workspaceDir, { recursive: true });
      }
      const fname = `${phase.id}_codex_critique_iter${iteration}.md`;
      const fpath = path.join(this.workspaceDir, fname);

      const findings = Array.isArray(result.findings) ? result.findings : [];
      const findingsBlock =
        findings.length === 0
          ? "_(no structured findings parsed)_"
          : findings
              .map((f) => `- **[${f.severity || "n/a"}]** ${f.message || ""}`)
              .join("\n");

      const body = [
        `# Codex Critique — Phase ${phase.id} (${phase.name || ""}) iter ${iteration}`,
        "",
        `- Timestamp: ${new Date().toISOString()}`,
        `- ok: ${result.ok}`,
        `- exitCode: ${result.exitCode}`,
        `- error: ${result.error || "(none)"}`,
        "",
        "## Summary",
        "",
        (result.summary || "(no summary)").trim(),
        "",
        "## Findings",
        "",
        findingsBlock,
        "",
        "## Raw stdout",
        "",
        "```",
        (result.stdout || "").slice(0, 20000),
        "```",
        "",
        "## Stderr",
        "",
        "```",
        (result.stderr || "").slice(0, 4000),
        "```",
        "",
        "## Prompt sent to Codex",
        "",
        "```",
        (prompt || "").slice(0, 8000),
        "```",
        "",
      ].join("\n");

      fs.writeFileSync(fpath, body, "utf-8");
      return fpath;
    } catch (err) {
      this.broadcast({
        type: "critique_persist_failed",
        data: { phase: phase.id, error: err.message },
      });
      return null;
    }
  }

  _detectTaskType(text) {
    for (const [type, pattern] of Object.entries(TASK_PATTERNS)) {
      if (pattern.test(text)) return type;
    }
    if (text.length > 10 && /(해줘|세요|만들|implement|create|build|write|make)/i.test(text)) {
      return "implementation";
    }
    return null;
  }

  _currentPhase() {
    if (!this.active) return null;
    return this.active.template.phases[this.active.phaseIdx] || null;
  }

  _resolveAgentName(phase) {
    if (!phase) return "default";
    if (phase.agent === "codex") return "critic";
    const id = (phase.id || "").toUpperCase();
    if (id === "A" || id === "B") return "planner";
    if (id === "C") return "critic";
    if (id === "D" || id === "E") return "executor";
    if (id === "F") return "validator";
    return "default";
  }

  _captureArtifacts(phase, tool, response) {
    const rules = phase.artifactRules;
    if (!Array.isArray(rules) || rules.length === 0) return;

    const filePath =
      response && (response.filePath || response.file_path || response.path);

    for (const rule of rules) {
      if (rule.toolMatch && tool !== rule.toolMatch) continue;
      if (rule.pathMatch) {
        if (!filePath) continue;
        let re;
        try { re = new RegExp(rule.pathMatch, "i"); } catch (_) { continue; }
        if (!re.test(filePath)) continue;
      }
      this.state.setArtifact(phase.id, rule.artifactKey, filePath || true);
      this.broadcast({
        type: "artifact_captured",
        data: { phase: phase.id, key: rule.artifactKey, path: filePath },
      });
    }
  }

  async _enterPhase(idx) {
    if (!this.active) return;
    const template = this.active.template;
    if (idx >= template.phases.length) {
      this._complete("end-of-template");
      return;
    }

    // Mark previous phase completed
    if (this.active.phaseIdx >= 0) {
      const prev = template.phases[this.active.phaseIdx];
      this.broadcast({ type: "phase_update", data: { phase: prev.id, status: "completed" } });
      for (const node of prev.nodes || []) {
        this.broadcast({ type: "node_update", data: { node: node.id, status: "completed" } });
      }
    }

    this.active.phaseIdx = idx;
    this.active.gateRetries = 0;
    const phase = template.phases[idx];

    // Inject skill context for this phase
    const skillContent = await this.injector.gather(phase);
    if (skillContent) this.state.setSkillContext(phase.id, skillContent);

    this.broadcast({ type: "phase_update", data: { phase: phase.id, status: "active" } });
    for (const node of phase.nodes || []) {
      this.broadcast({ type: "node_update", data: { node: node.id, status: "active" } });
    }

    if (phase.agent === "codex") {
      await this._runCodexPhase(phase);
    }
  }

  async _runCodexPhase(phase) {
    const prompt = this.injector.buildCodexPrompt(phase, this.state);
    this.broadcast({
      type: "codex_started",
      data: { phase: phase.id, promptPreview: prompt.slice(0, 200) },
    });

    const iteration = (this.active.iteration || 0) + 1;
    const result = await this.codex.exec(prompt, { timeoutMs: phase.timeoutMs || 120000 });
    this.state.setCritique(phase.id, result);
    this.active.lastCritique = { phase: phase.id, ...result };

    // FIX-1: persist critique to filesystem so Claude can Read it in the next phase
    const critiquePath = this._persistCritique(phase, iteration, prompt, result);
    if (critiquePath) {
      this.state.setArtifact(phase.id, "critiquePath", critiquePath);
    }

    // FIX-2: only surface a Stop-block hint when there is something actionable —
    // either findings exist or Codex itself failed. A clean run should not
    // interrupt Claude's flow.
    const findingsList = Array.isArray(result.findings) ? result.findings : [];
    const shouldHint = critiquePath && (!result.ok || findingsList.length > 0);
    if (shouldHint) {
      this.active.pendingHint = {
        type: "codex_critique_ready",
        critiquePath,
        summary: result.summary || "(no summary)",
        findings: findingsList,
        ok: result.ok,
        error: result.error || null,
      };
    }

    this.broadcast({
      type: "critique_received",
      data: {
        phase: phase.id,
        ok: result.ok,
        summary: result.summary,
        findings: result.findings,
        error: result.error || null,
        critiquePath: critiquePath || null,
      },
    });

    if (phase.cycle) {
      const hasCritical = (result.findings || []).some(
        (f) => f.severity === "critical" || f.severity === "high"
      );
      const canIterate = this.active.iteration < (phase.maxIterations || 3);
      if (hasCritical && canIterate && phase.linkedCycle) {
        this.active.iteration++;
        const linkedIdx = this.active.template.phases.findIndex(
          (p) => p.id === phase.linkedCycle
        );
        if (linkedIdx >= 0) {
          this.broadcast({
            type: "cycle_iteration",
            data: {
              phase: phase.id,
              iteration: this.active.iteration,
              linkedTo: phase.linkedCycle,
            },
          });
          await this._enterPhase(linkedIdx);
          return;
        }
      }
    }

    await this._advance();
  }

  async _advance() {
    if (!this.active) return;

    const mutation = await this.adapter.review(this.active, this.state);
    if (mutation) {
      const applied = this._applyMutation(mutation);
      if (applied) {
        this.broadcast({
          type: "pipeline_mutated",
          data: {
            ruleId: mutation.ruleId,
            mutationType: mutation.type,
            phaseIdx: this.active.phaseIdx,
            templateId: this.active.templateId,
            template: this.active.template,
            nextIdx: applied.nextIdx,
          },
        });
        await this._enterPhase(applied.nextIdx);
        return;
      }
    }

    const nextIdx = this.active.phaseIdx + 1;
    await this._enterPhase(nextIdx);
  }

  _applyMutation(mutation) {
    if (!mutation || !this.active) return null;
    const marks = this.active._adapterMarks || (this.active._adapterMarks = new Set());
    marks.add(mutation.markId || mutation.ruleId);

    switch (mutation.type) {
      case "insert-phase": {
        const at = Math.max(0, Math.min(mutation.at ?? this.active.phaseIdx + 1, this.active.template.phases.length));
        this.active.template.phases.splice(at, 0, mutation.phase);
        return { nextIdx: at };
      }
      case "switch-template": {
        const target = this.templates[mutation.templateId];
        if (!target) return null;
        this.active.template = structuredClone(target);
        this.active.templateId = target.id || mutation.templateId;
        this.active.phaseIdx = -1;
        this.active.iteration = 0;
        this.active.gateRetries = 0;
        return { nextIdx: 0 };
      }
      case "merge-template": {
        const phases = mutation.phases || [];
        if (phases.length === 0) return null;
        const at = Math.max(0, Math.min(mutation.at ?? this.active.phaseIdx + 1, this.active.template.phases.length));
        this.active.template.phases.splice(at, 0, ...phases);
        return { nextIdx: at };
      }
      default:
        return null;
    }
  }

  _complete(reason) {
    if (!this.active) return;

    // Self-verification: check claim-vs-evidence before declaring complete
    const verifier = new ClaimVerifier();
    const verification = verifier.verify(this.state.snapshot());
    if (!verification.pass && reason !== "disabled" && reason !== "session-end") {
      this.broadcast({
        type: "claim_verification_failed",
        data: { missing: verification.missing, results: verification.results },
      });
    }

    const snapshot = {
      templateId: this.active.templateId,
      durationMs: Date.now() - this.active.startedAt,
      iteration: this.active.iteration,
      state: this.state.snapshot(),
      reason,
      verification,
    };
    this.broadcast({ type: "pipeline_complete", data: snapshot });
    this.active = null;
  }
}

module.exports = { PipelineExecutor };
