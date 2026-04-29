// Slice MB4-a + MC2 (Phase D Round 2 + 2.5, 2026-04-27) — HarnessMonitorLegacyBridge.
//
// Without this bridge the monitor store is a snapshot frozen at the
// moment hydrateMonitorStore returned. The legacy WebSocket stream
// (handled by app.js::handleEvent → tab bar / tool feed / etc.) keeps
// flowing but never reaches the monitor store, so the timeline + agent
// tree + inspector show stale data.
//
// The bridge fixes that with three cheap mechanisms:
//
//   1. Tap into HarnessEventDispatcher (MB4-a addition) — every event
//      app.js receives is mirrored to a wildcard tap. The tap normalizes
//      via HarnessMonitorNormalizer and pushes to store.pushEvent. No
//      changes to app.js's existing routing.
//
//   2. Periodic /api/server/info refresh — server summary + active
//      children don't flow through the WS event stream. A small
//      setInterval (default 5s, matching app.js's existing health poll
//      cadence) re-fetches and applies via store.setServerSummary +
//      setActiveChildren. Skipped entirely if no fetch is available
//      (Node test envs).
//
//   3. Slice MC2: run summary sync. After pushEvent, the bridge
//      inspects the event type and calls store.upsertRun for lifecycle
//      events:
//        run_created       → status:idle, templateId, createdAt
//        pipeline_start    → status:active, templateId, startedAt, phase, phaseIdx
//        phase_update      → phase, phaseIdx, status (active|error)
//        pipeline_paused   → status:paused
//        pipeline_complete → status:completed, completedAt
//        pipeline_reset    → status:idle, phase:null, phaseIdx:null
//      Without this, run-tree + run-summary panels would only ever
//      show the bootstrap-time snapshot — phase changes and new runs
//      would never propagate.
//
// Lifecycle:
//   install({...}) → { destroy(), refresh() }
//   destroy() unsubscribes the tap and clears the interval. Must be
//   called when the monitor shell is closed/torn down to avoid leaks.
//
// All inputs are optional except `store` and `normalize`. Test envs
// inject stubs for dispatcher, fetch, setInterval — production wiring
// reads them from window.* defaults.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorLegacyBridge = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_REFRESH_MS = 5000;
  const DEFAULT_INFO_URL = "/api/server/info";

  function install({
    store,
    normalize,
    dispatcher = null,           // window.HarnessEventDispatcher in browser
    fetchImpl = null,            // window.fetch in browser
    setIntervalFn = null,        // setInterval in browser
    clearIntervalFn = null,      // clearInterval in browser
    refreshIntervalMs = DEFAULT_REFRESH_MS,
    infoUrl = DEFAULT_INFO_URL,
    headers = {},
  } = {}) {
    if (!store || typeof store.pushEvent !== "function") {
      throw new Error("legacyBridge.install: store must be a HarnessMonitorStore");
    }
    if (typeof normalize !== "function") {
      throw new Error("legacyBridge.install: normalize must be a function");
    }
    const _dispatcher = dispatcher
      || (typeof globalThis !== "undefined" && globalThis.HarnessEventDispatcher);
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _setInterval = setIntervalFn
      || (typeof setInterval !== "undefined" ? setInterval : null);
    const _clearInterval = clearIntervalFn
      || (typeof clearInterval !== "undefined" ? clearInterval : null);

    let stats = {
      eventsForwarded: 0,
      eventsDropped: 0,
      refreshes: 0,
      refreshErrors: 0,
      // Slice MC2: count run-summary upserts so tests + readiness
      // checks can verify lifecycle event handling.
      runSyncs: 0,
      // Slice UX-2-a: count approval lifecycle syncs. Increments on
      // every approval_requested / approval_resolved that reached
      // the store.
      approvalSyncs: 0,
    };
    let unsubscribeTap = null;
    let intervalId = null;

    // Slice MC2: lifecycle event → store.upsertRun mapping.
    //
    // Returns true if the event was a known lifecycle type and a sync
    // ran (or was attempted). Returns false for non-lifecycle events
    // so the caller knows when nothing happened.
    function _syncRunFromEvent(event) {
      if (!event || typeof event !== "object") return false;
      const type = event.type;
      const data = (event.data && typeof event.data === "object") ? event.data : {};
      const runId = data.runId;
      if (typeof store.upsertRun !== "function") return false;
      if (typeof runId !== "string" || !runId) return false;

      const now = Date.now();
      let partial = null;
      switch (type) {
        case "run_created":
          partial = {
            status: "idle",
            templateId: data.templateId || null,
            createdAt: data.at || data.ts || now,
          };
          break;
        case "pipeline_start":
          partial = {
            status: "active",
            templateId: data.template || data.templateId || null,
            startedAt: data.at || data.ts || now,
          };
          if (typeof data.phase === "string") partial.phase = data.phase;
          if (typeof data.phaseIdx === "number") partial.phaseIdx = data.phaseIdx;
          break;
        case "phase_update":
          partial = {
            phase: data.phase || null,
            // status from phase_update only flips the run-level status
            // when the phase reports "error"; otherwise we leave the
            // run as "active" (the legacy semantics).
            status: data.status === "error" ? "error" : "active",
          };
          if (typeof data.phaseIdx === "number") partial.phaseIdx = data.phaseIdx;
          break;
        case "pipeline_paused":
          partial = { status: "paused" };
          break;
        case "pipeline_complete":
          partial = {
            status: "completed",
            completedAt: data.at || data.ts || now,
          };
          break;
        case "pipeline_reset":
          partial = { status: "idle", phase: null, phaseIdx: null };
          break;
        default:
          return false; // not a lifecycle event
      }

      try {
        store.upsertRun(runId, partial);
        stats.runSyncs++;
      } catch (_) {
        // upsertRun can't normally fail; defensive only.
      }
      return true;
    }

    // Slice UX-2-a: approval lifecycle event → store pendingApprovals.
    // The hook-router's approvalManager broadcasts approval_requested
    // (full request snapshot) and approval_resolved (just the
    // approvalId + resolution) via the WS. Translate both into
    // store.upsertApproval / store.resolveApproval.
    //
    // Returns true if the event was an approval lifecycle event so
    // the caller can skip the normal pushEvent path (approval events
    // shouldn't pollute the events ring — the inspector uses the
    // pendingApprovals slice instead).
    function _syncApprovalFromEvent(event) {
      if (!event || typeof event !== "object") return false;
      const type = event.type;
      const data = (event.data && typeof event.data === "object") ? event.data : {};
      if (type === "approval_requested") {
        if (typeof store.upsertApproval !== "function") return true;
        try {
          store.upsertApproval(data);
          stats.approvalSyncs = (stats.approvalSyncs || 0) + 1;
        } catch (_) { /* defensive */ }
        return true;
      }
      if (type === "approval_resolved") {
        if (typeof store.resolveApproval !== "function") return true;
        const id = data.approvalId;
        if (typeof id === "string" && id.length > 0) {
          try {
            store.resolveApproval(id);
            stats.approvalSyncs = (stats.approvalSyncs || 0) + 1;
          } catch (_) { /* defensive */ }
        }
        return true;
      }
      return false;
    }

    // ── 1. Wildcard tap → store.pushEvent + run sync ──
    function _onLegacyEvent(event) {
      // Slice UX-2-a: approval events take precedence — they have
      // their own slice (pendingApprovals) and don't go through the
      // generic events ring. Skip pushEvent + run sync for them.
      if (_syncApprovalFromEvent(event)) return;

      const env = normalize(event);
      if (!env) {
        stats.eventsDropped++;
        return;
      }
      try {
        store.pushEvent(env);
        stats.eventsForwarded++;
      } catch (_) {
        // store mutation can't fail under normal operation, but be defensive
        stats.eventsDropped++;
      }
      // Slice MC2: also sync the runs map. We pass the RAW event so the
      // function can read data.template / data.phaseIdx / etc. directly
      // (the normalised envelope flattens these into payload).
      try { _syncRunFromEvent(event); } catch (_) { /* defensive */ }
    }
    if (_dispatcher && typeof _dispatcher.addTap === "function") {
      unsubscribeTap = _dispatcher.addTap(_onLegacyEvent);
    }

    // ── 2. Periodic /api/server/info refresh ──
    async function refresh() {
      if (typeof _fetch !== "function") return null;
      try {
        const res = await _fetch(infoUrl, {
          method: "GET",
          headers: { Accept: "application/json", ...headers },
        });
        if (!res || typeof res.ok !== "boolean") {
          stats.refreshErrors++;
          return null;
        }
        if (!res.ok) {
          stats.refreshErrors++;
          return null;
        }
        const payload = typeof res.json === "function" ? await res.json() : null;
        if (!payload || typeof payload !== "object") {
          stats.refreshErrors++;
          return null;
        }
        // Apply known fields. Other fields ignored — keep store schema strict.
        if (typeof store.setServerSummary === "function") {
          // /api/server/info doesn't carry bootTime; preserve previous if any
          // by spreading the existing summary shape onto the new fields.
          const prev = (store.snapshot && store.snapshot().server) || {};
          store.setServerSummary({
            ...prev,
            pid: payload.pid,
            uptime: payload.uptime,
            supervised: payload.supervised,
            clients: payload.clients,
            graceMs: payload.graceMs,
            shutdownArmed: payload.shutdownArmed,
            activeChildCount: payload.activeChildCount,
          });
        }
        if (typeof store.setActiveChildren === "function" && Array.isArray(payload.activeChildren)) {
          store.setActiveChildren(payload.activeChildren);
        }
        // Slice D3-b (Phase E1.5, 2026-04-29): account-status slice.
        // Map the four blocks from /api/server/info onto store.setAccountStatus
        // in a single mutation so subscribers re-render once per poll.
        // Server returns stable-shape objects (D3-a contract) so we just
        // pass them through. Skip when setAccountStatus isn't on the
        // store (legacy in-tree consumers without D3-b).
        if (typeof store.setAccountStatus === "function") {
          // Only call when at least one of the four blocks is present;
          // otherwise we'd clobber last-known-good with `null`s on a
          // server that hasn't shipped D3-a yet.
          const hasAccountFields =
            (payload.profile && typeof payload.profile === "object")
            || (payload.deployment && typeof payload.deployment === "object")
            || (payload.bridge && typeof payload.bridge === "object")
            || (payload.remote && typeof payload.remote === "object");
          if (hasAccountFields) {
            store.setAccountStatus({
              profile: payload.profile || null,
              deployment: payload.deployment || null,
              bridge: payload.bridge || null,
              remote: payload.remote || null,
            });
          }
        }
        stats.refreshes++;
        return payload;
      } catch (_) {
        stats.refreshErrors++;
        return null;
      }
    }
    if (typeof _setInterval === "function" && refreshIntervalMs > 0) {
      intervalId = _setInterval(() => { refresh(); }, refreshIntervalMs);
      // Don't run an initial refresh here — the layout's hydrate already
      // populates the store on mount. The first interval tick takes over
      // 5s later, which keeps boot-time noise low.
    }

    function destroy() {
      try { unsubscribeTap && unsubscribeTap(); } catch (_) {}
      unsubscribeTap = null;
      try {
        if (intervalId !== null && typeof _clearInterval === "function") {
          _clearInterval(intervalId);
        }
      } catch (_) {}
      intervalId = null;
    }

    return {
      destroy,
      refresh,
      stats: () => ({ ...stats }),
      // Slice MC2: test hook so unit tests can drive the sync function
      // directly without going through the dispatcher tap.
      _syncRunFromEvent,
    };
  }

  return { install, DEFAULT_REFRESH_MS, DEFAULT_INFO_URL };
});
