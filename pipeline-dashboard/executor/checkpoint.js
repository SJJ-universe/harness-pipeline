// Checkpoint store for pipeline state persistence across server restarts.
//
// Uses a factory pattern for dependency injection (testable with temp dirs).
// Stores the full mutated template snapshot, not just templateId,
// so pipeline mutations survive restarts.

const fs = require("fs");
const path = require("path");

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function createCheckpointStore({ repoRoot, ttlMs = DEFAULT_TTL_MS, filename = "pipeline-checkpoint.json" } = {}) {
  const root = repoRoot || path.resolve(__dirname, "..");
  const dir = path.join(root, ".harness");
  const checkpointPath = path.join(dir, filename);

  function clear() {
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  }

  function quarantineCorrupt() {
    if (!fs.existsSync(checkpointPath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const corruptPath = path.join(dir, `pipeline-checkpoint.corrupt.${stamp}.json`);
    try {
      fs.renameSync(checkpointPath, corruptPath);
    } catch (_) {
      try { fs.unlinkSync(checkpointPath); } catch (_) {}
    }
  }

  function save(active, state) {
    if (!active) return null;
    const data = {
      version: 1,
      savedAt: Date.now(),
      templateId: active.templateId,
      templateSnapshot: active.template,
      phaseIdx: active.phaseIdx,
      iteration: active.iteration || 0,
      gateRetries: active.gateRetries || 0,
      userPrompt: active.userPrompt || "",
      startedAt: active.startedAt || Date.now(),
      stateSnapshot: state && typeof state.snapshot === "function" ? state.snapshot() : null,
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(checkpointPath, JSON.stringify(data, null, 2), "utf-8");
    return data;
  }

  function load() {
    if (!fs.existsSync(checkpointPath)) return null;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(checkpointPath, "utf-8"));
    } catch (_) {
      quarantineCorrupt();
      return null;
    }
    if (!data || typeof data !== "object" || data.version !== 1) {
      quarantineCorrupt();
      return null;
    }
    if (!data.savedAt || Date.now() - data.savedAt > ttlMs) {
      clear();
      return null;
    }
    if (!data.templateId || !data.templateSnapshot || !Array.isArray(data.templateSnapshot.phases)) {
      quarantineCorrupt();
      return null;
    }
    return data;
  }

  return {
    path: checkpointPath,
    ttlMs,
    save,
    load,
    clear,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  createCheckpointStore,
};
