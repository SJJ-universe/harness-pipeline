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

  recordTool(phaseId, tool, response) {
    const p = this._ensurePhase(phaseId);
    p.tools.push({ tool, at: Date.now() });
    this.metrics.toolCount++;
    this.metrics.byTool[tool] = (this.metrics.byTool[tool] || 0) + 1;

    if (tool === "Edit" || tool === "Write") {
      const filePath = this._extractFilePath(response);
      if (filePath) this.metrics.filesEdited.add(filePath);
    }
    if (tool === "Bash") this.metrics.bashCommands++;
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
