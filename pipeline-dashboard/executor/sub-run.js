// Slice W (v6) — SubRun: lightweight child of a PipelineRun that represents
// one subagent's work.
//
// A "sub-run" is NOT a full PipelineRun — it has no Phase machine, no gate,
// no template. It's a bag of tools/artifacts/timing for one spawned Agent.
// The parent PipelineRun is the owner; sub-runs aggregate into parent metrics.
//
// Slice W ships the data model + per-subagent metrics surfaced in the
// subagent tray. Slice X will extend this to parallel Codex critics
// (sub-run per critic).
//
// Phase 3 (D) promotes sub-runs into first-class isolated workspaces (each
// subagent gets a sandbox + its own filesystem view). Today they just
// partition the parent's tool log.

const MAX_TOOLS_PER_SUBRUN = 200;

class SubRun {
  constructor({ sessionId, agentId = null, agentType = null, parentSessionId = null } = {}) {
    if (!sessionId || typeof sessionId !== "string") {
      throw new Error("SubRun requires a sessionId");
    }
    this.sessionId = sessionId;
    this.agentId = agentId;
    this.agentType = agentType;
    this.parentSessionId = parentSessionId;
    this.startedAt = Date.now();
    this.completedAt = null;
    this.tools = []; // [{ tool, at, filePath, command }]
    this.artifacts = {};
    this.byTool = {}; // tool → count
  }

  recordTool(tool, { filePath = null, command = null } = {}) {
    this.tools.push({
      tool,
      at: Date.now(),
      filePath: filePath || null,
      command: command || null,
    });
    this.byTool[tool] = (this.byTool[tool] || 0) + 1;
    // Cap to prevent runaway subagents from bloating the parent.
    if (this.tools.length > MAX_TOOLS_PER_SUBRUN) this.tools.shift();
  }

  setArtifact(key, value) {
    this.artifacts[key] = value;
  }

  complete() {
    if (this.completedAt !== null) return false;
    this.completedAt = Date.now();
    return true;
  }

  /** Duration so far (or final duration if completed). */
  durationMs() {
    const end = this.completedAt || Date.now();
    return end - this.startedAt;
  }

  /** Snapshot used by broadcasts + tray UI. */
  snapshot() {
    return {
      sessionId: this.sessionId,
      agentId: this.agentId,
      agentType: this.agentType,
      parentSessionId: this.parentSessionId,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs(),
      toolCount: this.tools.length,
      byTool: { ...this.byTool },
      artifactKeys: Object.keys(this.artifacts),
    };
  }
}

module.exports = { SubRun, MAX_TOOLS_PER_SUBRUN };
