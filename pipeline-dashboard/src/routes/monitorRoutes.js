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

// ── Slice R1-a (Phase D Round MH, 2026-04-28) — local-mode origin defaults.
//
// MF1 §3.2 specifies that `/api/monitor/runs/:runId` always returns an
// `origin` field — local runs get the default values below. This makes the
// field non-optional at the API level even though it's optional in the
// event envelope (where local events omit `origin` to keep the envelope
// byte-identical to pre-R1).
//
// `runnerProvider`, when wired in a future R1-d slice, returns the real
// origin for runs assigned to remote runners. R1-a ships the local default
// only; the override path is null-safe so the route works either way.

const LOCAL_ORIGIN_DEFAULTS = Object.freeze({
  runOrigin: "local",
  sandboxClass: "none",
  hostIdentity: "local",
  isolationStatus: "healthy",
});

function _resolveOrigin(runId, runnerProvider) {
  if (runnerProvider && typeof runnerProvider.originForRun === "function") {
    try {
      const o = runnerProvider.originForRun(runId);
      if (o && typeof o === "object") {
        return {
          runOrigin: typeof o.runOrigin === "string" ? o.runOrigin : LOCAL_ORIGIN_DEFAULTS.runOrigin,
          sandboxClass: typeof o.sandboxClass === "string" ? o.sandboxClass : LOCAL_ORIGIN_DEFAULTS.sandboxClass,
          hostIdentity: typeof o.hostIdentity === "string" ? o.hostIdentity : LOCAL_ORIGIN_DEFAULTS.hostIdentity,
          isolationStatus: typeof o.isolationStatus === "string" ? o.isolationStatus : LOCAL_ORIGIN_DEFAULTS.isolationStatus,
        };
      }
    } catch (_) {
      // Provider failure must not break the response — fall through to default.
    }
  }
  return Object.assign({}, LOCAL_ORIGIN_DEFAULTS);
}

/**
 * Slice R2.5-d: response shape for a runner-claimed run that has not
 * been promoted to a pipeline run yet (no executor in the
 * orchestrator). Mirrors the full /api/monitor/runs/:runId envelope
 * so client code can render uniformly — every field is empty/null
 * except the ones the runner actually told us about.
 */
function _runnerClaimedRunResponse(runId, meta, childRegistry) {
  let children = [];
  if (childRegistry && typeof childRegistry.snapshot === "function") {
    try {
      children = childRegistry.snapshot().filter((c) => c && c.runId === runId);
    } catch (_) { children = []; }
  }
  return {
    run: {
      id: runId,
      // Distinct status so the UI can render "claimed by runner, no
      // pipeline activity yet" rather than confuse with idle.
      status: "runner-claimed",
      templateId: null,
      phase: null,
      phaseIdx: null,
      startedAt: typeof meta.since === "number"
        ? new Date(meta.since).toISOString()
        : null,
      savedAt: null,
    },
    recentEvents: [],
    children,
    subagents: [],
    findings: [],
    findingsOverflow: null,
    replayMeta: { hasCheckpoint: false, savedAt: null },
    // Synthesize the origin from the runner's metadata. This is the
    // same shape MF1 §3.2 documents for `/api/monitor/runs/:runId.origin`.
    origin: {
      runOrigin: "container-remote",
      sandboxClass: "container-strict",
      hostIdentity: meta.hostIdentity,
      isolationStatus: "healthy",
    },
    exportedAt: new Date().toISOString(),
  };
}

function _resolveRunners(runnerProvider) {
  if (runnerProvider && typeof runnerProvider.listRunners === "function") {
    try {
      const r = runnerProvider.listRunners();
      if (Array.isArray(r)) return r;
    } catch (_) {
      // Same null-safe policy as origin resolution.
    }
  }
  return [];
}

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
  // Slice R1-a: optional provider for remote-runner metadata. When null
  // (today's local-only deployment) every run reports the local-mode
  // default origin and `runners: []` in the bootstrap response. The
  // provider contract:
  //   listRunners()         → Array<{ hostIdentity, sandboxClass,
  //                                    health, activeRuns, lastSeen }>
  //   originForRun(runId)   → { runOrigin, sandboxClass, hostIdentity,
  //                              isolationStatus } | null
  runnerProvider = null,
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

      // Slice R1-a: additive `runners` field. Empty array when no runner
      // provider is wired (today's deployment) or when the provider
      // returns nothing — never omitted, so the client always knows the
      // shape (matches the same "always-present, defaults for local"
      // policy as the per-run `origin` field).
      const runners = _resolveRunners(runnerProvider);

      res.json({
        server,
        runs,
        selectedRunId,
        activeChildren,
        activeChildCount,
        recentEvents,
        runners,
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
        // Slice R2.5-d: fall back to the runner registry's
        // active-run map. A remote runner connected with this runId
        // (verdict.runId from JWT) — even though no pipeline run
        // was ever created, the dashboard should still surface it
        // so operators can correlate runner activity with run
        // detail. Closes the R2 known-gap 404 path.
        if (runnerProvider && typeof runnerProvider.getActiveRunMeta === "function") {
          const meta = runnerProvider.getActiveRunMeta(runId);
          if (meta) {
            return res.json(_runnerClaimedRunResponse(runId, meta, childRegistry));
          }
        }
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

      // Slice R1-a: `origin` field always present. Local runs return the
      // hardcoded local defaults; future remote runs route through
      // runnerProvider.originForRun(runId). MF1 §3.2 says: "This makes
      // the field non-optional at the API level even though it's optional
      // in the event envelope — the client always knows the shape."
      const origin = _resolveOrigin(runId, runnerProvider);

      res.json({
        run,
        recentEvents,
        children,
        subagents,
        findings,
        findingsOverflow,
        replayMeta,
        origin,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message || "monitor run detail failed" });
    }
  });

  return router;
}

module.exports = { createMonitorRoutes };
