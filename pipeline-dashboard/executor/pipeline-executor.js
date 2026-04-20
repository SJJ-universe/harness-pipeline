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
// Slice G (v5): phase-scoped TDD enforcement. Pure evaluator — consults
// PipelineState.phaseTools(phase.id) to decide whether a src edit is
// preceded by a test edit in the same phase.
const { TddGuard } = require("./tdd-guard");
const { enforceTemplateDefaults, evaluateTool } = require("../src/policy/phasePolicy");
const dangerGate = require("../src/policy/dangerGate");
const { checkToolAgainstContract } = require("../src/contracts/agentContracts");
const { ClaimVerifier } = require("../src/verification/claimVerifier");
const { createCheckpointStore } = require("./checkpoint");
// Slice F0 (v5): every PreToolUse deny goes through this adapter so the
// response carries both the legacy `decision: "block"` shape AND the modern
// hookSpecificOutput.permissionDecision shape. Stop and SessionEnd returns
// still use the legacy-only shape until upstream docs reshape them too.
const { denyToolUse } = require("../src/hooks/hookDecisionAdapter");

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
  constructor({ broadcast, templates, codex, state, gate, injector, adapter, workspaceDir, repoRoot, checkpointStore }) {
    this.broadcast = broadcast;
    this.templates = templates;
    this.codex = codex;
    this.state = state || new PipelineState();
    this.gate = gate || new QualityGate();
    this.injector = injector || new SkillInjector({});
    this.adapter = adapter || new PipelineAdapter({ templates });
    // Slice G (v5): TDD Guard — phase-scoped. Reads from this.state,
    // never mutates it. Phases without a `tddGuard` block are no-ops.
    this.tddGuard = new TddGuard(this.state);
    this.workspaceDir =
      workspaceDir || process.env.HARNESS_WORKSPACE_DIR || DEFAULT_WORKSPACE_DIR;
    this.repoRoot = repoRoot || path.resolve(__dirname, "..", "..");
    // Checkpoint store: must be explicitly injected (via server.js) for disk persistence.
    // Default is a no-op store — safe for tests that don't need persistence.
    this.checkpointStore = checkpointStore || { path: null, save() {}, load() { return null; }, clear() {} };

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

    // Guard A: resume active pipeline instead of restarting Phase A
    if (this.active) {
      return this._resumeActivePipeline();
    }

    // Guard B: restore from disk checkpoint (survives server restart)
    const restored = this._restoreFromCheckpoint();
    if (restored) {
      return restored;
    }

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
   *
   * opts.resumeKind: null (fresh start) | "active" (same-session resume) | "restored" (checkpoint restore)
   */
  _buildPhaseGuidance(phase, opts = {}) {
    const tools = (phase.allowedTools || []).join(", ");
    const criteria = (phase.exitCriteria || []).map((c) => c.message).join("; ");
    const resumeKind = opts.resumeKind || null;

    if (!resumeKind) {
      return {
        suppressOutput: false,
        message:
          `[SJ 하네스 엔진] Phase ${phase.id} (${phase.name}) 시작\n` +
          `허용 도구: ${tools || "제한 없음"}\n` +
          `완료 조건: ${criteria || "없음"}\n` +
          `조건을 충족한 후 턴을 종료하면 다음 Phase로 진행됩니다.`,
      };
    }

    // Resume mode: emphasize continuation + previous progress
    const phases = this.active?.template?.phases || [];
    const phaseIdx = this.active?.phaseIdx ?? 0;
    const completedList = phases.slice(0, phaseIdx)
      .map((p) => `  - Phase ${p.id} (${p.name}) ✓ 완료`)
      .join("\n") || "  (이전 Phase 없음)";
    const metrics = this.state?.metrics || {};
    const toolCount = metrics.toolCount || 0;
    const filesEdited = metrics.filesEdited?.size || 0;
    const findingsCount = (this.state?.findings || []).length;
    const originalPrompt = (this.active?.userPrompt || "").slice(0, 200);
    const kindLabel = resumeKind === "active"
      ? "활성 파이프라인 계속 진행 (같은 세션)"
      : "체크포인트에서 복원 (새 세션)";

    return {
      suppressOutput: false,
      message:
        `[SJ 하네스 엔진] ${kindLabel}\n\n` +
        `원래 작업: "${originalPrompt || "(unknown)"}"\n` +
        `현재 Phase: ${phase.id} (${phase.name})\n\n` +
        `진행 단계:\n${completedList}\n` +
        `  - Phase ${phase.id} (${phase.name}) ← 현재 진행 중\n\n` +
        `진행 상황:\n` +
        `  - 도구 사용: ${toolCount}회\n` +
        `  - 파일 수정: ${filesEdited}건\n` +
        `  - 발견 사항: ${findingsCount}건\n\n` +
        `현재 Phase 지침:\n` +
        `  - 허용 도구: ${tools || "제한 없음"}\n` +
        `  - 완료 조건: ${criteria || "없음"}\n\n` +
        `※ 이것은 새 작업 시작이 아니라 기존 파이프라인의 연속입니다.\n` +
        `※ 완전히 새 작업을 시작하려면 POST /api/executor/reset 후 다시 프롬프트를 보내세요.`,
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
      this._scheduleCheckpoint();
      return denyToolUse(danger.reason);
    }

    const policy = evaluateTool({ phase, tool, input: _input || {} });
    if (policy.decision === "block") {
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, reason: policy.reason, source: "policy" },
      });
      this._scheduleCheckpoint();
      return denyToolUse(policy.reason);
    }

    // Agent contract enforcement
    const agentName = this._resolveAgentName(phase);
    const contractResult = checkToolAgainstContract(agentName, tool, _input || {});
    if (!contractResult.allowed) {
      this.broadcast({
        type: "tool_blocked",
        data: { phase: phase.id, tool, reason: contractResult.reason, source: "contract" },
      });
      this._scheduleCheckpoint();
      return denyToolUse(contractResult.reason);
    }

    // Slice G (v5): TDD Guard Stage 1 — require-test-edit-first.
    // Phases without `tddGuard` pass through (guard returns allow:true).
    // We emit a dedicated `tdd_guard_blocked` broadcast (not tool_blocked)
    // so the UI can highlight TDD violations distinctly from danger/policy/
    // contract blocks.
    const tddVerdict = this.tddGuard.evaluate(phase, tool, _input || {});
    if (!tddVerdict.allow) {
      this.broadcast({
        type: "tdd_guard_blocked",
        data: { phase: phase.id, tool, reason: tddVerdict.reason, filePath: _input?.file_path || _input?.filePath || null },
      });
      this._scheduleCheckpoint();
      return denyToolUse(tddVerdict.reason);
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
      this._scheduleCheckpoint();
      return denyToolUse(reason);
    }
    return {};
  }

  async onPostTool(tool, response, input) {
    if (!this.enabled || !this.active) return {};
    const phase = this._currentPhase();
    if (!phase) return {};

    // Slice B (v4): forward tool input so PipelineState can record file paths
    // and shell commands for phase-scoped / pathMatch / commandMatch criteria.
    this.state.recordTool(phase.id, tool, response, input || {});
    this._captureArtifacts(phase, tool, response);
    this._scheduleCheckpoint();

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

    // Slice B (v4): gate evaluation + retry/bypass bookkeeping extracted into
    // _handleGateResult so Codex phases can reuse the exact same ladder.
    const gateResult = await this.gate.evaluate(phase, this.state);
    // Slice F (v5): QualityGate stays a pure evaluator — the executor is
    // responsible for booking the attempt against PipelineState.
    this.state.markGateAttempt(phase.id, gateResult.pass);
    const decision = this._handleGateResult(phase, gateResult, { source: "stop" });
    if (decision.kind === "block") {
      return { decision: "block", reason: decision.reason };
    }
    // pass or bypass: continue advancing
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
    // Session end is a temporary pause — keep checkpoint so next session can resume.
    // Force-save current state, cancel any pending debounce, then drop in-memory only.
    const phase = this._currentPhase();
    // Slice F (v5): close the current attempt so the time spent so far is
    // recorded. On resume, _enterPhase opens a fresh attempt — the paused
    // interval is NOT counted, which is what we want.
    if (phase) {
      this.state.markPhaseExit(phase.id, { gatePass: null, reason: "session-end" });
      this._broadcastPhaseMetrics(phase.id);
    }
    this.broadcast({
      type: "pipeline_paused",
      data: { reason: "session-end", phase: phase ? phase.id : null },
    });
    if (this._checkpointTimer) {
      clearTimeout(this._checkpointTimer);
      this._checkpointTimer = null;
    }
    this.checkpointStore.save(this.active, this.state);
    this.active = null;
    return {};
  }

  // ── Slice A (v4) lifecycle handlers ─────────────────────────────
  //
  // Hook router wires the five additional Claude Code lifecycle events here.
  // Each method tolerates disabled state and missing/malformed payloads.

  /**
   * SessionStart — Claude Code's `source` field distinguishes how the session began:
   *   - "startup"  : fresh shell launch. Do nothing special; pipeline_replay on WS
   *                   connect already restores UI state for reconnecting browsers.
   *   - "resume"   : continuing an existing session (e.g. `claude --continue`).
   *                   Mirrors the behavior startFromPrompt has when `this.active`
   *                   is already populated — it's a no-op because state is in memory.
   *   - "clear"    : /clear issued. Nothing to do here either.
   *   - "compact"  : session re-emerges after /compact. This is the only reliable
   *                   stdout→context channel we have for post-compaction state
   *                   re-injection. Read the summary file written by onPreCompact
   *                   and return `additionalContext` so Claude receives it.
   */
  async onSessionStart(payload) {
    const source = payload && payload.source;
    if (source !== "compact") return {};

    try {
      const summaryPath = path.join(this.repoRoot, ".harness", "last-compact-summary.md");
      if (!fs.existsSync(summaryPath)) return {};
      let body = fs.readFileSync(summaryPath, "utf-8");
      // Guard against pathological summary files — the 2KB cap is enforced by
      // the writer, but we re-check on read so a manually edited file can't
      // flood the reconstructed session context.
      const MAX_BYTES = 2048;
      if (Buffer.byteLength(body, "utf-8") > MAX_BYTES) {
        body = body.slice(0, MAX_BYTES) + "\n…(truncated on read)";
      }
      return { additionalContext: body };
    } catch (_) {
      // Summary file access problems should never block Claude — swallow + no-op.
      return {};
    }
  }

  /**
   * SubagentStart — record the dispatching subagent so the UI can show a live
   * "active subagents" tray. `parent_session_id` is optional in Claude Code
   * payloads and we treat it as metadata only.
   */
  async onSubagentStart(payload) {
    if (!this.active) return {};
    const d = payload || {};
    const sessionId = d.session_id || d.agent_id || null;
    if (!this.active.subagents) this.active.subagents = {};
    const entry = {
      agent_type: d.agent_type || d.subagent_type || "unknown",
      startedAt: Date.now(),
      parent_session_id: d.parent_session_id || null,
    };
    if (sessionId) this.active.subagents[sessionId] = entry;
    this.broadcast({
      type: "subagent_started",
      data: {
        session_id: sessionId,
        agent_type: entry.agent_type,
        parent_session_id: entry.parent_session_id,
      },
    });
    return {};
  }

  /**
   * SubagentStop — complete the matching tray entry and emit a completion event.
   * We intentionally keep the entry in-memory so replay can reconstruct a
   * "✓ completed (Ns)" readonly rendering until the pipeline itself resets.
   */
  async onSubagentStop(payload) {
    if (!this.active) return {};
    const d = payload || {};
    const sessionId = d.session_id || d.agent_id || null;
    const entry = sessionId && this.active.subagents ? this.active.subagents[sessionId] : null;
    const elapsedMs = entry ? Date.now() - entry.startedAt : null;
    this.broadcast({
      type: "subagent_completed",
      data: {
        session_id: sessionId,
        agent_type: entry ? entry.agent_type : (d.agent_type || "unknown"),
        elapsedMs,
      },
    });
    // Mark as completed rather than delete — Slice D renders a brief "✓ done"
    // state before fading out. Replay can still show this entry.
    if (entry) entry.completedAt = Date.now();
    return {};
  }

  /**
   * Notification — surfaces Claude Code's Notification hook (idle reminders,
   * permission prompts, etc.) into the UI via the `harness_notification`
   * broadcast, which Slice C renders as a toast.
   */
  async onNotification(payload) {
    const d = payload || {};
    const message = typeof d.message === "string" ? d.message : "";
    const level = typeof d.level === "string" ? d.level : "info";
    if (!message) return {};
    this.broadcast({
      type: "harness_notification",
      data: { level, message },
    });
    return {};
  }

  /**
   * PreCompact — fire-before-compaction hook. We do NOT rely on stdout to
   * inject the resulting summary into Claude's post-compact context (that path
   * is fragile for PreCompact specifically). Instead:
   *   1. force-save the checkpoint,
   *   2. write a concise summary (≤2KB) to `.harness/last-compact-summary.md`,
   *   3. broadcast `pipeline_compacted` so the UI + server-side replay buffer
   *      can react.
   *
   * The actual re-injection happens in `onSessionStart({ source: "compact" })`
   * which reads the same file and returns it as `additionalContext` — that IS
   * a documented reliable channel.
   */
  async onPreCompact(payload) {
    if (!this.active) return {};

    // 1. Flush any pending debounced checkpoint, then force-save immediately
    //    so the summary we're about to write describes the truly-latest state.
    if (this._checkpointTimer) {
      clearTimeout(this._checkpointTimer);
      this._checkpointTimer = null;
    }
    try {
      this.checkpointStore.save(this.active, this.state);
    } catch (_) {}

    // 2. Build a bounded summary. We cap at ~2KB to protect Claude's
    //    post-compact context budget. Truncate individual sections before
    //    assembly so no single noisy field blows the envelope.
    const phase = this._currentPhase();
    const lines = [];
    lines.push(`# Harness PreCompact Summary`);
    lines.push(`- At: ${new Date().toISOString()}`);
    lines.push(`- Trigger: ${(payload && payload.trigger) || "unknown"}`);
    lines.push(`- Template: ${this.active.templateId || "?"}`);
    lines.push(`- Phase: ${phase ? `${phase.id} (${phase.name || ""})` : "n/a"}`);
    lines.push(`- Iteration: ${this.active.iteration || 0}`);
    const userPrompt = String(this.active.userPrompt || "").slice(0, 240);
    if (userPrompt) lines.push(`- Original task: ${userPrompt}`);
    const missing = phase && Array.isArray(phase.exitCriteria)
      ? phase.exitCriteria.map((c) => c.message).filter(Boolean).slice(0, 6)
      : [];
    if (missing.length) {
      lines.push(``);
      lines.push(`## Pending exit criteria`);
      for (const m of missing) lines.push(`- ${m}`);
    }
    const critique = this.active.lastCritique;
    if (critique) {
      lines.push(``);
      lines.push(`## Last Codex critique (phase ${critique.phase})`);
      const summary = String(critique.summary || "").slice(0, 400);
      if (summary) lines.push(summary);
      const findings = Array.isArray(critique.findings) ? critique.findings.slice(0, 5) : [];
      for (const f of findings) {
        lines.push(`- [${f.severity || "note"}] ${String(f.message || "").slice(0, 120)}`);
      }
    }
    if (this.active.subagents && Object.keys(this.active.subagents).length > 0) {
      lines.push(``);
      lines.push(`## Active/recent subagents`);
      for (const [sid, entry] of Object.entries(this.active.subagents).slice(0, 6)) {
        const status = entry.completedAt ? "done" : "active";
        lines.push(`- ${entry.agent_type} (${status}) sid=${String(sid).slice(0, 12)}`);
      }
    }
    let summaryText = lines.join("\n");
    const MAX_BYTES = 2048;
    if (Buffer.byteLength(summaryText, "utf-8") > MAX_BYTES) {
      summaryText = summaryText.slice(0, MAX_BYTES - 24) + "\n…(truncated on write)";
    }

    // 3. Persist. Directory creation is best-effort — if the filesystem is
    //    hostile, fail silently so the hook never blocks Claude.
    try {
      const dir = path.join(this.repoRoot, ".harness");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "last-compact-summary.md"), summaryText, "utf-8");
    } catch (_) {}

    // 4. Broadcast so the UI shows a paused-for-compaction indicator and the
    //    server-side replay buffer can be flushed (server.js wires this).
    this.broadcast({
      type: "pipeline_compacted",
      data: {
        phase: phase ? phase.id : null,
        trigger: (payload && payload.trigger) || null,
        summaryBytes: Buffer.byteLength(summaryText, "utf-8"),
      },
    });

    // 5. No stdout injection here — we deliberately stay silent on this hook
    //    because PreCompact's stdout semantics are not guaranteed to land in
    //    the post-compact Claude context. The summary file + SessionStart
    //    re-injection path is the contract.
    return {};
  }

  getReplaySnapshot() {
    if (this.active) {
      const phase = this._currentPhase();
      return {
        status: "active",
        templateId: this.active.templateId,
        template: this.active.template,
        phaseIdx: this.active.phaseIdx,
        phase: phase ? phase.id : null,
        startedAt: this.active.startedAt,
        stateSnapshot: this.state.snapshot(),
      };
    }
    const checkpoint = this.checkpointStore.load();
    if (checkpoint) {
      const template = checkpoint.templateSnapshot || null;
      const phase = template && Array.isArray(template.phases)
        ? template.phases[checkpoint.phaseIdx]
        : null;
      return {
        status: "paused",
        templateId: checkpoint.templateId,
        template,
        phaseIdx: checkpoint.phaseIdx,
        phase: phase ? phase.id : null,
        startedAt: checkpoint.startedAt,
        savedAt: checkpoint.savedAt,
        stateSnapshot: checkpoint.stateSnapshot,
      };
    }
    return { status: "idle" };
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

  /**
   * Slice B (v4): common gate-result ladder used by both `onStop` and
   * `_runCodexPhase`. Broadcasts `gate_evaluated`, then decides the caller's
   * next move via the returned kind:
   *
   *   { kind: "pass"  }   — gate passed; caller should advance
   *   { kind: "bypass" }  — gate failed but retry budget exhausted; caller
   *                          should advance (gate_bypassed broadcast happened)
   *   { kind: "block", reason } — gate failed and there's retry budget left;
   *                          onStop surfaces this as `{ decision: "block" }`
   *                          back to Claude, while Codex phases use it as a
   *                          signal to loop back through linkedCycle.
   *
   * opts.source is informational ("stop" or "codex-phase") and tailors the
   * block-reason wording so Claude understands which transition was denied.
   */
  _handleGateResult(phase, gateResult, opts = {}) {
    this.broadcast({
      type: "gate_evaluated",
      data: { phase: phase.id, pass: gateResult.pass, missing: gateResult.missing },
    });

    if (gateResult.pass) {
      this.active.gateRetries = 0;
      return { kind: "pass" };
    }

    this.active.gateRetries = (this.active.gateRetries || 0) + 1;
    if (this.active.gateRetries >= MAX_GATE_RETRIES) {
      this.broadcast({
        type: "gate_bypassed",
        data: {
          phase: phase.id,
          retries: this.active.gateRetries,
          missing: gateResult.missing,
        },
      });
      this.active.gateRetries = 0;
      return { kind: "bypass" };
    }

    const tools = (phase.allowedTools || []).join(", ");
    const suffix = opts.source === "codex-phase"
      ? `Codex phase 완료 조건 미충족 — 다음 반복에서 재검증합니다.`
      : `위 조건을 충족한 후 다시 턴을 종료하세요.`;
    const reason =
      `[SJ 하네스] Phase ${phase.id} (${phase.name}) 완료 조건 미충족\n` +
      `미충족 조건: ${gateResult.missing.join("; ")}\n` +
      `허용 도구: ${tools || "제한 없음"}\n` +
      `${suffix} (시도 ${this.active.gateRetries}/${MAX_GATE_RETRIES})`;
    this.broadcast({
      type: "gate_failed",
      data: {
        phase: phase.id,
        missing: gateResult.missing,
        retries: this.active.gateRetries,
        source: opts.source || "stop",
      },
    });
    this._scheduleCheckpoint();
    return { kind: "block", reason };
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

  _scheduleCheckpoint() {
    if (this._checkpointTimer) return; // already scheduled
    this._checkpointTimer = setTimeout(() => {
      this._checkpointTimer = null;
      if (this.active) this.checkpointStore.save(this.active, this.state);
    }, 500);
  }

  _resumeActivePipeline() {
    const phase = this._currentPhase();
    if (!phase) return {};
    this.broadcast({
      type: "pipeline_resume",
      data: {
        templateId: this.active.templateId,
        phase: phase.id,
        phaseIdx: this.active.phaseIdx,
      },
    });
    // Re-emit phase_update events so UI re-applies `.phase.active` highlighting.
    // Without this, same-session resume leaves the DOM without the active class
    // (see pipeline_paused which may have set `.paused`).
    for (let i = 0; i < this.active.phaseIdx; i++) {
      const p = this.active.template.phases[i];
      if (p) this.broadcast({ type: "phase_update", data: { phase: p.id, status: "completed" } });
    }
    this.broadcast({ type: "phase_update", data: { phase: phase.id, status: "active" } });
    return this._buildPhaseGuidance(phase, { resumeKind: "active" });
  }

  _restoreFromCheckpoint() {
    const checkpoint = this.checkpointStore.load();
    if (!checkpoint) return null;

    const template = checkpoint.templateSnapshot || this.templates[checkpoint.templateId];
    if (!template || !Array.isArray(template.phases)) {
      this.checkpointStore.clear();
      return null;
    }

    this.active = {
      templateId: checkpoint.templateId,
      template: enforceTemplateDefaults(structuredClone(template)),
      phaseIdx: checkpoint.phaseIdx,
      iteration: checkpoint.iteration || 0,
      gateRetries: checkpoint.gateRetries || 0,
      userPrompt: checkpoint.userPrompt || "",
      startedAt: checkpoint.startedAt || Date.now(),
    };

    this.state.reset({
      userPrompt: checkpoint.userPrompt || "",
      templateId: checkpoint.templateId,
    });

    const phase = this._currentPhase();
    this.broadcast({
      type: "pipeline_restored",
      data: {
        templateId: checkpoint.templateId,
        phase: phase && phase.id,
        phaseIdx: checkpoint.phaseIdx,
        savedAt: checkpoint.savedAt,
      },
    });

    // Replay phase states for UI rendering
    for (let i = 0; i < checkpoint.phaseIdx; i++) {
      const p = this.active.template.phases[i];
      if (p) this.broadcast({ type: "phase_update", data: { phase: p.id, status: "completed" } });
    }
    if (phase) this.broadcast({ type: "phase_update", data: { phase: phase.id, status: "active" } });

    return phase ? this._buildPhaseGuidance(phase, { resumeKind: "restored" }) : {};
  }

  resetActive(reason = "manual-reset") {
    this.active = null;
    this.state.reset({ userPrompt: "", templateId: null });
    this.checkpointStore.clear();
    this.broadcast({ type: "pipeline_reset", data: { reason } });
    return this.getStatus();
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

  _broadcastPhaseMetrics(phaseId) {
    // Slice F (v5): fired whenever an attempt closes. Consumers: UI
    // analytics panel + run-history replay. Carries both this-attempt
    // durationMs and the running totalDurationMs so the client can render
    // either a per-attempt row or a phase-aggregate bar chart without
    // re-computing.
    const p = this.state.phases[phaseId];
    if (!p) return;
    const latest = p.attempts[p.attempts.length - 1];
    this.broadcast({
      type: "phase_metrics",
      data: {
        phaseId,
        attemptIndex: p.attempts.length - 1,
        attempts: p.attempts.length,
        durationMs: latest?.durationMs || 0,
        totalDurationMs: this.state.phaseTotalDurationMs(phaseId),
        gateAttempts: p.gateAttempts,
        gateFailures: p.gateFailures,
        gatePass: latest?.gatePass ?? null,
        reason: latest?.reason || null,
      },
    });
  }

  async _enterPhase(idx) {
    if (!this.active) return;
    const template = this.active.template;
    if (idx >= template.phases.length) {
      this._complete("end-of-template");
      return;
    }

    // Slice F (v5): close the previous phase's attempt BEFORE broadcasting
    // status transitions. markPhaseExit is idempotent, so explicit closes
    // from cycle-reenter paths (which carry different gatePass/reason)
    // already win and this default call becomes a no-op there.
    if (this.active.phaseIdx >= 0) {
      const prev = template.phases[this.active.phaseIdx];
      this.state.markPhaseExit(prev.id, { gatePass: true, reason: "advance" });
      this._broadcastPhaseMetrics(prev.id);
      this.broadcast({ type: "phase_update", data: { phase: prev.id, status: "completed" } });
      for (const node of prev.nodes || []) {
        this.broadcast({ type: "node_update", data: { node: node.id, status: "completed" } });
      }
    }

    this.active.phaseIdx = idx;
    this.active.gateRetries = 0;
    const phase = template.phases[idx];

    // Slice F (v5): open a fresh attempt. On cycle re-entry this pushes a
    // second/third/... entry onto attempts[] instead of overwriting the
    // first, so per-iteration timing is preserved.
    this.state.openPhaseAttempt(phase.id);

    // Inject skill context for this phase
    const skillContent = await this.injector.gather(phase);
    if (skillContent) this.state.setSkillContext(phase.id, skillContent);

    this.broadcast({ type: "phase_update", data: { phase: phase.id, status: "active" } });
    for (const node of phase.nodes || []) {
      this.broadcast({ type: "node_update", data: { node: node.id, status: "active" } });
    }

    // Persist checkpoint so phase position survives server restarts
    this.checkpointStore.save(this.active, this.state);

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
    // Mark codex-running for heartbeat visibility; try/finally ensures clear on error
    this.active._codexStartedAt = Date.now();
    let result;
    try {
      result = await this.codex.exec(prompt, {
        timeoutMs: phase.timeoutMs || 120000,
        phaseId: phase.id,
        iteration,
        source: "phase",
      });
    } finally {
      if (this.active) this.active._codexStartedAt = null;
    }
    this.state.setCritique(phase.id, result);
    this._scheduleCheckpoint();
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
          // Slice F (v5): explicit close with "findings" reason so analytics
          // distinguishes a findings-triggered cycle from a gate-triggered
          // one. _enterPhase's default close becomes idempotent here.
          this.state.markPhaseExit(phase.id, { gatePass: false, reason: "cycle-reenter-findings" });
          await this._enterPhase(linkedIdx);
          return;
        }
      }
    }

    // Slice B (v4) FIX: previously Codex phases went straight to _advance()
    // so criteria like `critique-received` were declaratively present but
    // never actually enforced (pipeline-executor.js:749 pre-fix). We now run
    // the same gate ladder as onStop, but since a Codex phase has no user
    // turn to re-prompt, a `block` decision falls back to one more
    // linkedCycle iteration if the iteration budget allows. When nothing
    // more can be done, we advance anyway — the gate_failed / gate_bypassed
    // broadcasts are the user-visible signal.
    const gateResult = await this.gate.evaluate(phase, this.state);
    // Slice F (v5): pair the gate.evaluate call with a markGateAttempt so
    // the state counters stay in sync with both the onStop and codex-phase
    // gate entry points.
    this.state.markGateAttempt(phase.id, gateResult.pass);
    const decision = this._handleGateResult(phase, gateResult, { source: "codex-phase" });
    if (decision.kind === "block" && phase.cycle && phase.linkedCycle) {
      const canIterate = this.active.iteration < (phase.maxIterations || 3);
      if (canIterate) {
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
              reason: "gate-failed",
            },
          });
          // Slice F (v5): explicit close with "gate-fail" reason for analytics.
          this.state.markPhaseExit(phase.id, { gatePass: false, reason: "cycle-reenter-gate-fail" });
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

    // Slice F (v5): close the currently open phase attempt before teardown
    // so the final phase's duration shows up in snapshot/replay. gatePass
    // is left null on _complete because the ladder decision happens at a
    // different layer (verification / disabled flip / end-of-template).
    const curPhase = this._currentPhase();
    if (curPhase) {
      this.state.markPhaseExit(curPhase.id, { gatePass: null, reason });
      this._broadcastPhaseMetrics(curPhase.id);
    }

    // Cancel any pending debounced checkpoint save
    if (this._checkpointTimer) {
      clearTimeout(this._checkpointTimer);
      this._checkpointTimer = null;
    }
    // Clear checkpoint — pipeline is done, next session should start fresh
    this.checkpointStore.clear();

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
