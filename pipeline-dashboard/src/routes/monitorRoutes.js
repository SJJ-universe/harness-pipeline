// Slice MA2 (Phase D, 2026-04-27) — /api/monitor/bootstrap.
//
// Consolidated hydration endpoint for the future monitoring console
// (run-monitor-ui-hybrid spec section 5.3). The dashboard fetches this
// once at boot to seed every panel of HarnessMonitorStore in a single
// round-trip:
//
//   { server, runs, selectedRunId, activeChildren, activeChildCount,
//     recentEvents, exportedAt }
//
// Why a separate route instead of expanding /api/server/info or
// /api/runs/current?
//   - /api/server/info is process health (PID, uptime, clients) and gets
//     called from a tight 5-second poll; piling runs/events in there
//     would bloat every poll. Bootstrap runs ONCE on hydrate.
//   - /api/runs/current returns ONE run snapshot (the active one); the
//     monitor console wants the orchestrator's full list (Phase 2.5
//     multi-run + Phase 1 V slice unlocked HARNESS_MAX_RUNS≥1).
//   - Spec D-spec calls out "server contract는 추가만" — we don't reshape
//     existing endpoints.
//
// Per spec D-out-of-scope this round only does CLIENT-side normalization;
// `recentEvents` returns the raw replay-buffer entries, and the client
// passes each `entry.event` through HarnessMonitorNormalizer before
// pushing into the store.
//
// All inputs are optional + null-safe so the route can be mounted even
// when individual subsystems are missing (graceful degradation matches
// the MA0 /api/server/info pattern).

const { Router } = require("express");

function createMonitorRoutes({
  pipelineOrchestrator = null,
  childRegistry = null,
  eventReplayBuffer = null,
  bootTime = null,
  mode = null,
  // Slice MA2: bound the recentEvents payload so the bootstrap response
  // stays small even when the replay ring is full (default cap 500). 100
  // is enough to repopulate a freshly-loaded timeline panel without
  // sending the whole ring on every reconnect.
  recentEventLimit = 100,
} = {}) {
  const router = Router();

  router.get("/monitor/bootstrap", (req, res) => {
    try {
      // ── Server summary (subset of /api/server/info, plus boot meta) ──
      let activeChildren = [];
      let activeChildCount = 0;
      if (childRegistry && typeof childRegistry.snapshot === "function") {
        try {
          activeChildren = childRegistry.snapshot();
          activeChildCount = childRegistry.size
            ? childRegistry.size()
            : activeChildren.length;
        } catch (_) {
          // Never let an observability path break the bootstrap response.
          activeChildren = [];
          activeChildCount = 0;
        }
      }

      const server = {
        pid: process.pid,
        uptime: process.uptime(),
        supervised: !!process.send,
        mode: mode || (process.env.HARNESS_ALLOW_REMOTE === "1" ? "remote" : "local"),
        bootTime: bootTime || null,
        activeChildCount,
      };

      // ── Runs (orchestrator's full list, with each executor's snapshot) ──
      const runs = [];
      let selectedRunId = null;
      if (pipelineOrchestrator && typeof pipelineOrchestrator.list === "function") {
        const runIds = pipelineOrchestrator.list();
        for (const runId of runIds) {
          const exec = typeof pipelineOrchestrator.get === "function"
            ? pipelineOrchestrator.get(runId)
            : null;
          if (!exec) continue;
          let snap = { status: "idle" };
          if (typeof exec.getReplaySnapshot === "function") {
            try {
              snap = exec.getReplaySnapshot() || { status: "idle" };
            } catch (_) {
              snap = { status: "idle" };
            }
          }
          runs.push({
            id: runId,
            status: snap.status || "idle",
            templateId: snap.templateId || null,
            phase: snap.phase || null,
            phaseIdx: typeof snap.phaseIdx === "number" ? snap.phaseIdx : null,
            startedAt: snap.startedAt || null,
          });
        }
        // selectedRunId mirrors orchestrator.getActive() so the store's
        // initial focus matches the executor that hookRouter routes to
        // by default (Slice S single-active compat).
        const active = typeof pipelineOrchestrator.getActive === "function"
          ? pipelineOrchestrator.getActive()
          : null;
        if (active && active.runId) {
          selectedRunId = active.runId;
        } else if (runIds.length > 0) {
          selectedRunId = runIds[0];
        }
      }

      // ── Recent events (raw — client normalizes to envelopes) ──
      let recentEvents = [];
      if (eventReplayBuffer && typeof eventReplayBuffer.snapshot === "function") {
        try {
          const all = eventReplayBuffer.snapshot();
          if (Array.isArray(all) && all.length > 0) {
            const start = Math.max(0, all.length - recentEventLimit);
            recentEvents = all.slice(start);
          }
        } catch (_) {
          recentEvents = [];
        }
      }

      res.json({
        server,
        runs,
        selectedRunId,
        activeChildren,
        activeChildCount,
        recentEvents,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "monitor bootstrap failed" });
    }
  });

  // ── Slice MB1 (Phase D Round 2): per-run detail endpoint ───────────
  //
  // GET /api/monitor/runs/:runId
  //
  // Lazy fetch on tab/click — bootstrap stays summary-only. Returns the
  // selected run's executor snapshot + scoped recentEvents + scoped
  // children + (MB2 will fill) subagents + replay metadata.
  //
  // Status codes:
  //   200 — runId is known to the orchestrator
  //   404 — runId not registered
  //   503 — orchestrator missing (boot race; route mounted before orch wiring)
  router.get("/monitor/runs/:runId", (req, res) => {
    try {
      if (!pipelineOrchestrator || typeof pipelineOrchestrator.get !== "function") {
        return res.status(503).json({ error: "orchestrator not available" });
      }
      const runId = String(req.params.runId || "");
      if (!runId) {
        return res.status(400).json({ error: "runId required" });
      }
      const exec = pipelineOrchestrator.get(runId);
      if (!exec) {
        return res.status(404).json({ error: "run not found", runId });
      }

      // Run snapshot (status/template/phase/started + state details).
      let snap = { status: "idle" };
      let stateSnap = null;
      if (typeof exec.getReplaySnapshot === "function") {
        try { snap = exec.getReplaySnapshot() || { status: "idle" }; } catch (_) {}
      }
      if (snap && snap.stateSnapshot && typeof snap.stateSnapshot === "object") {
        stateSnap = snap.stateSnapshot;
      }

      const run = {
        id: runId,
        status: snap.status || "idle",
        templateId: snap.templateId || null,
        phase: snap.phase || null,
        phaseIdx: typeof snap.phaseIdx === "number" ? snap.phaseIdx : null,
        startedAt: snap.startedAt || null,
        savedAt: snap.savedAt || null,
      };

      // Scoped recentEvents — runId match OR scope:"global" (mirrors AA-2
      // includeGlobal policy, default true so the dashboard sees system
      // events for context). Cap independent of bootstrap's recentEventLimit.
      let recentEvents = [];
      if (eventReplayBuffer && typeof eventReplayBuffer.snapshot === "function") {
        try {
          // The replay buffer's runId+includeGlobal filter already does the
          // exact split we want; re-use it instead of duplicating logic.
          const all = eventReplayBuffer.snapshot({ runId, includeGlobal: true });
          if (Array.isArray(all) && all.length > 0) {
            const start = Math.max(0, all.length - recentEventLimit);
            recentEvents = all.slice(start);
          }
        } catch (_) { recentEvents = []; }
      }

      // Scoped children — childRegistry.snapshot() filtered to this run.
      let children = [];
      if (childRegistry && typeof childRegistry.snapshot === "function") {
        try {
          children = childRegistry.snapshot().filter((c) => c && c.runId === runId);
        } catch (_) { children = []; }
      }

      // Findings — straight from PipelineState.snapshot() if available.
      // Capped at 50 newest so payload stays bounded; the full list is
      // available via the legacy /api/runs/current export.
      let findings = [];
      let findingsOverflow = null;
      if (stateSnap && Array.isArray(stateSnap.findings)) {
        const all = stateSnap.findings;
        findings = all.slice(Math.max(0, all.length - 50));
        if (stateSnap.findingsOverflow) {
          findingsOverflow = {
            count: stateSnap.findingsOverflow.count || 0,
            bySeverity: stateSnap.findingsOverflow.bySeverity || {},
          };
        }
      }

      // Subagents — MB2 will populate this from the executor's authoritative
      // subagent state. For MB1 we expose the field but return empty so
      // the client can already start consuming the contract.
      let subagents = [];
      if (typeof exec.getSubagentSnapshot === "function") {
        try { subagents = exec.getSubagentSnapshot() || []; } catch (_) { subagents = []; }
      }

      // Replay metadata — does this run have a checkpoint on disk?
      const replayMeta = {
        hasCheckpoint: snap.status === "paused" || !!snap.savedAt,
        savedAt: snap.savedAt || null,
      };

      res.json({
        run,
        recentEvents,
        children,
        subagents,
        findings,
        findingsOverflow,
        replayMeta,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "monitor run detail failed" });
    }
  });

  return router;
}

module.exports = { createMonitorRoutes };
