// Slice V (v6) — File conflict detector for concurrent pipeline runs.
//
// Tracks which files each run has touched (Edit/Write). When a second run
// tries to edit a file already claimed by another, we emit a
// `file_conflict_warning` broadcast — this is a warning, NOT a block. The
// user/LLM can decide whether to proceed (both changes merge, last-write-
// wins) or pick a different path.
//
// Rationale for warning-only:
//   - Hard-blocking would create deadlocks when two parallel critics want to
//     amend the same plan.
//   - Warning + dashboard surfacing is sufficient for one-user multi-session
//     use cases Phase 1 targets. Phase 3 (D) adds workspace isolation so
//     conflicts can't happen in the first place.
//
// API:
//   recordEdit(runId, filePath)  → records the claim + broadcasts conflict
//                                  (returns { conflict: boolean, conflictWithRunIds }).
//   clear(runId)                 → drop all claims by runId (on pipeline_complete).
//   snapshot()                   → debugging inspection.

function createFileConflictDetector({ broadcast = () => {} } = {}) {
  // filePath → Set<runId>
  const byFile = new Map();
  // runId → Set<filePath> (inverse index for cheap clear)
  const byRun = new Map();

  function recordEdit(runId, filePath) {
    if (!runId || !filePath || typeof filePath !== "string") {
      return { conflict: false, conflictWithRunIds: [] };
    }
    const owners = byFile.get(filePath) || new Set();
    const conflictWithRunIds = Array.from(owners).filter((r) => r !== runId);
    owners.add(runId);
    byFile.set(filePath, owners);

    const files = byRun.get(runId) || new Set();
    files.add(filePath);
    byRun.set(runId, files);

    if (conflictWithRunIds.length > 0) {
      broadcast({
        type: "file_conflict_warning",
        data: {
          runId,
          filePath,
          conflictWithRunIds,
          at: Date.now(),
        },
      });
    }
    return { conflict: conflictWithRunIds.length > 0, conflictWithRunIds };
  }

  function clear(runId) {
    if (!runId) return;
    const files = byRun.get(runId);
    if (!files) return;
    for (const filePath of files) {
      const owners = byFile.get(filePath);
      if (owners) {
        owners.delete(runId);
        if (owners.size === 0) byFile.delete(filePath);
      }
    }
    byRun.delete(runId);
  }

  function snapshot() {
    const flat = {};
    for (const [file, owners] of byFile.entries()) {
      flat[file] = Array.from(owners);
    }
    return flat;
  }

  function size() {
    return byFile.size;
  }

  return { recordEdit, clear, snapshot, size };
}

module.exports = { createFileConflictDetector };
