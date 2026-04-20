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
        enteredAt: Date.now(),
      };
    }
    return this.phases[id];
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
          },
        ])
      ),
    };
  }
}

module.exports = { PipelineState };
