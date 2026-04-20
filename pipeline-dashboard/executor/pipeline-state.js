// PipelineState — shared data container that flows between phases.
//
// Ownership: one instance per active pipeline run, held by PipelineExecutor.
// Purpose: decouple "what happened during phase X" from "what phase Y needs",
// and give QualityGate a single place to query.

class PipelineState {
  constructor() {
    this.reset();
  }

  reset(meta = {}) {
    this.meta = {
      userPrompt: meta.userPrompt || "",
      templateId: meta.templateId || null,
      startedAt: Date.now(),
    };
    this.phases = {}; // phaseId → { tools[], artifacts{}, critique, skillContext }
    this.findings = []; // accumulated across all critique phases
    this.metrics = {
      filesEdited: new Set(),
      bashCommands: 0,
      toolCount: 0,
      byTool: {},
    };
  }

  _ensurePhase(id) {
    if (!this.phases[id]) {
      this.phases[id] = {
        tools: [],
        artifacts: {},
        critique: null,
        skillContext: null,
        // Slice F (v5): every phase entry / cycle re-entry pushes a fresh
        // attempt; exit paths close the latest one. Attempts are newest-last.
        // This replaces the earlier single `enteredAt` field, which lost
        // timing data on cycle re-entry.
        attempts: [],
        gateAttempts: 0,
        gateFailures: 0,
      };
    }
    return this.phases[id];
  }

  /**
   * Open a new attempt for a phase (called by PipelineExecutor on every
   * _enterPhase). Defensively closes any still-open prior attempt, which
   * can happen if a cycle re-entry path reaches _enterPhase without the
   * caller having closed the previous attempt explicitly.
   */
  openPhaseAttempt(phaseId) {
    const p = this._ensurePhase(phaseId);
    const last = p.attempts[p.attempts.length - 1];
    if (last && last.exitedAt === null) {
      last.exitedAt = Date.now();
      last.durationMs = last.exitedAt - last.enteredAt;
      if (last.gatePass === null) last.gatePass = false;
      if (!last.reason) last.reason = "reenter-unclosed";
    }
    p.attempts.push({
      enteredAt: Date.now(),
      exitedAt: null,
      durationMs: null,
      gatePass: null,
      reason: null,
    });
  }

  /**
   * Close the latest attempt for a phase. Idempotent: a second call on an
   * already-closed attempt is a no-op, so overlapping exit paths (e.g.
   * _enterPhase default close + explicit cycle-reenter close) are safe.
   */
  markPhaseExit(phaseId, { gatePass = null, reason = null } = {}) {
    const p = this.phases[phaseId];
    if (!p) return;
    const cur = p.attempts[p.attempts.length - 1];
    if (!cur || cur.exitedAt !== null) return;
    cur.exitedAt = Date.now();
    cur.durationMs = cur.exitedAt - cur.enteredAt;
    cur.gatePass = gatePass;
    cur.reason = reason;
  }

  /**
   * Book a gate evaluation against a phase. Called by PipelineExecutor
   * immediately after `QualityGate.evaluate()`; QualityGate itself stays
   * a pure evaluator and does NOT mutate state.
   */
  markGateAttempt(phaseId, pass) {
    const p = this._ensurePhase(phaseId);
    p.gateAttempts++;
    if (!pass) p.gateFailures++;
  }

  phaseAttempts(phaseId) {
    return this.phases[phaseId]?.attempts || [];
  }

  /** Sum of durationMs across every closed attempt for a phase. */
  phaseTotalDurationMs(phaseId) {
    const p = this.phases[phaseId];
    if (!p) return 0;
    return p.attempts.reduce((s, a) => s + (a.durationMs || 0), 0);
  }

  /** Duration of the most recent (possibly still-open) attempt. */
  phaseLatestDurationMs(phaseId) {
    const p = this.phases[phaseId];
    if (!p) return 0;
    const a = p.attempts[p.attempts.length - 1];
    return a?.durationMs || 0;
  }

  /**
   * Record a tool call against a phase.
   *
   * Slice B (v4) extended the signature to take `input` — the raw tool input
   * that Claude Code sends to PreToolUse/PostToolUse. This lets QualityGate
   * filter by actual file paths and shell commands instead of just counting
   * totals, which is what `pathMatch`/`commandMatch` criteria need.
   *
   * Backward compatibility: `input` defaults to `{}` so every existing caller
   * that passes only `(phaseId, tool, response)` still works. File-path
   * extraction falls back to the previous response-based path so legacy tests
   * that pass `{ filePath: "..." }` in `response` continue to populate metrics.
   */
  recordTool(phaseId, tool, response, input = {}) {
    const p = this._ensurePhase(phaseId);
    const filePath = this._extractToolFilePath(tool, response, input);
    const command = tool === "Bash" ? String((input && input.command) || "") : null;
    p.tools.push({ tool, at: Date.now(), filePath, command });
    this.metrics.toolCount++;
    this.metrics.byTool[tool] = (this.metrics.byTool[tool] || 0) + 1;

    // filesEdited remains an Edit/Write-only metric (Read "touches" a file but
    // doesn't mutate it, so it never counts toward edit gates).
    if ((tool === "Edit" || tool === "Write") && filePath) {
      this.metrics.filesEdited.add(filePath);
    }
    if (tool === "Bash") this.metrics.bashCommands++;
  }

  _extractToolFilePath(tool, response, input) {
    // Prefer the explicit tool input (Claude Code PostToolUse payloads use
    // `file_path`; we also accept camelCase/alt aliases for flexibility).
    if (input && typeof input === "object") {
      const fromInput = input.file_path || input.filePath || input.path;
      if (fromInput) return String(fromInput);
    }
    // Fall back to response extraction — preserves pre-Slice-B callers.
    if (tool === "Edit" || tool === "Write" || tool === "Read") {
      return this._extractFilePath(response);
    }
    return null;
  }

  _extractFilePath(response) {
    if (!response || typeof response !== "object") return null;
    return (
      response.filePath ||
      response.file_path ||
      response.path ||
      (response.structuredPatch && response.structuredPatch.filePath) ||
      null
    );
  }

  /**
   * Iterate all recorded tools in a given phase that match a predicate.
   * Used by QualityGate for phase-scoped criteria.
   */
  phaseTools(phaseId) {
    return this.phases[phaseId]?.tools || [];
  }

  setArtifact(phaseId, key, value) {
    this._ensurePhase(phaseId).artifacts[key] = value;
  }

  getArtifact(phaseId, key) {
    return this.phases[phaseId]?.artifacts[key];
  }

  findArtifact(key) {
    // Search across all phases for the first matching artifact
    for (const p of Object.values(this.phases)) {
      if (p.artifacts && key in p.artifacts) return p.artifacts[key];
    }
    return undefined;
  }

  setCritique(phaseId, critique) {
    this._ensurePhase(phaseId).critique = critique;
    if (critique && Array.isArray(critique.findings)) {
      this.findings.push(
        ...critique.findings.map((f) => ({ ...f, fromPhase: phaseId }))
      );
    }
  }

  setSkillContext(phaseId, content) {
    this._ensurePhase(phaseId).skillContext = content;
  }

  phaseToolCount(phaseId) {
    return this.phases[phaseId]?.tools.length || 0;
  }

  snapshot() {
    return {
      meta: { ...this.meta },
      findings: [...this.findings],
      metrics: {
        toolCount: this.metrics.toolCount,
        bashCommands: this.metrics.bashCommands,
        filesEdited: [...this.metrics.filesEdited],
        byTool: { ...this.metrics.byTool },
      },
      phases: Object.fromEntries(
        Object.entries(this.phases).map(([id, p]) => [
          id,
          {
            toolCount: p.tools.length,
            artifactKeys: Object.keys(p.artifacts),
            hasCritique: !!p.critique,
            // Slice F (v5): expose per-attempt timeline + aggregate totals.
            // UI (analytics-panel) reads these to render one row per attempt
            // and a bar chart. totalDurationMs sums all attempts; latest is
            // the freshest (useful when previous attempts were cycles).
            attempts: p.attempts.map((a) => ({
              enteredAt: a.enteredAt,
              exitedAt: a.exitedAt,
              durationMs: a.durationMs,
              gatePass: a.gatePass,
              reason: a.reason,
            })),
            totalDurationMs: this.phaseTotalDurationMs(id),
            latestDurationMs: this.phaseLatestDurationMs(id),
            gateAttempts: p.gateAttempts,
            gateFailures: p.gateFailures,
          },
        ])
      ),
    };
  }
}

module.exports = { PipelineState };
