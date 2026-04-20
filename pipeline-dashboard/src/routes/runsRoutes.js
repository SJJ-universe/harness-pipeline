// Runs routes — Slice E (v4) — readonly replay/export surface for the
// run-history drawer.
//
// Contract:
//   GET /api/runs/current  → {
//     snapshot: getReplaySnapshot() result — pipeline status + phaseIdx +
//       template snapshot + the PipelineState.snapshot() returned by the
//       executor.
//     events:   eventReplayBuffer.snapshot() — the ring-buffered UI events
//       that a reconnecting client would replay through applyReplayEvent().
//     exportedAt: ISO timestamp at response time.
//   }
//
// This endpoint is intentionally a GET (not state-changing) — reading the
// current pipeline's export doesn't mutate anything. Auth is still enforced
// upstream by the global token middleware for parity with other /api
// endpoints.

const { Router } = require("express");

function createRunsRoutes({ pipelineExecutor, eventReplayBuffer }) {
  const router = Router();

  router.get("/runs/current", (req, res) => {
    try {
      const snapshot = pipelineExecutor && typeof pipelineExecutor.getReplaySnapshot === "function"
        ? pipelineExecutor.getReplaySnapshot()
        : { status: "idle" };
      const events = eventReplayBuffer && typeof eventReplayBuffer.snapshot === "function"
        ? eventReplayBuffer.snapshot()
        : [];
      res.json({
        snapshot,
        events,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "runs export failed" });
    }
  });

  return router;
}

module.exports = { createRunsRoutes };
