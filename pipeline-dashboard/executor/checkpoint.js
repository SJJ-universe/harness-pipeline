// Checkpoint store for pipeline state persistence across server restarts.
//
// Uses a factory pattern for dependency injection (testable with temp dirs).
// Stores the full mutated template snapshot, not just templateId,
// so pipeline mutations survive restarts.

const fs = require("fs");
const path = require("path");

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function createCheckpointStore({
  repoRoot,
  runId,
  ttlMs = DEFAULT_TTL_MS,
  filename,
} = {}) {
  const root = repoRoot || path.resolve(__dirname, "..");
  // Slice Z (Phase 2.5, v6): per-run checkpoint directory. The default
  // runId keeps the legacy path `.harness/pipeline-checkpoint.json` so
  // single-run users need no migration and existing callers that do not
  // pass `runId` are unaffected. Non-default runs live under
  // `.harness/runs/{runId}/checkpoint.json` so concurrent runs cannot
  // overwrite each other's checkpoint files. The per-run filename drops
  // the `pipeline-` prefix because the directory already disambiguates.
  const isDefaultRun = !runId || runId === "default";
  const dir = isDefaultRun
    ? path.join(root, ".harness")
    : path.join(root, ".harness", "runs", runId);
  const resolvedFilename =
    filename || (isDefaultRun ? "pipeline-checkpoint.json" : "checkpoint.json");
  const checkpointPath = path.join(dir, resolvedFilename);

  function clear() {
    if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
  }

  function quarantineCorrupt() {
    if (!fs.existsSync(checkpointPath)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Slice Z: derive the corrupt-file name from the resolved checkpoint
    // name so per-run stores (`checkpoint.json`) produce
    // `checkpoint.corrupt.{stamp}.json` while the legacy default stays
    // `pipeline-checkpoint.corrupt.{stamp}.json` (backward compatible).
    const basename = resolvedFilename.replace(/\.json$/, "");
    const corruptPath = path.join(dir, `${basename}.corrupt.${stamp}.json`);
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
