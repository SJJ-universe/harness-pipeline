// Slice MA1 (Phase D, 2026-04-27) — HarnessMonitorStore.
//
// DOM-free, framework-free state container. Serves as the single source
// of truth for the future monitoring-first console (run-monitor-ui spec
// section 5.1). Lives next to the existing UMD modules so it can be
// loaded as `window.HarnessMonitorStore` in the browser AND `require()`d
// from Node tests; no dependency on `document` / `window` / WebSocket.
//
// Policy
//   - Update lanes (hot / warm / cold) are NOT enforced here — they are a
//     consumer-side rendering concern. The store just exposes snapshots;
//     subscribers decide how often to re-render.
//   - State is namespaced (server / runs / selectedRunId / activeChildren
//     / events / counters) so each panel touches only its slice.
//   - Mutators ("actions") return the new snapshot for chaining and to
//     keep tests pure.
//   - subscribe(fn) returns an unsubscribe handle. Listeners receive the
//     full snapshot; selector logic is the caller's responsibility.
//   - reset() empties everything — used by tab switch + tests.
//
// Initial action surface (intentionally narrow; expand as MA2/MA3 land):
//   setServerSummary(summary)     — global bar / health
//   setActiveChildren(list)        — child-process snapshot from /api/server/info
//   upsertRun(runId, partial)      — register/update one run
//   removeRun(runId)               — drop a finished run
//   selectRun(runId | null)        — focused run for center workspace
//   pushEvent(envelope)            — append a normalized monitor event
//                                     (max bounded to avoid leaks)
//   bumpCounter(name, delta)       — global counters
//
// Slice D3-b (Phase E1.5, 2026-04-29):
//   setAccountStatus({profile, deployment, bridge, remote})
//                                  — single-action update for the
//                                    /api/server/info account-status
//                                    block (D3-a). One mutation per
//                                    poll; the global-bar (D3-c) +
//                                    settings-accounts modal (D3-d)
//                                    subscribe and re-render.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_MAX_EVENTS = 200;

  function freshState() {
    return {
      server: null,                  // last /api/server/info or bootstrap summary
      runs: new Map(),               // runId → { id, label, phase, status, lastEventAt, ...partial }
      selectedRunId: null,
      activeChildren: [],            // [{ pid, label, runId, ageMs }]
      events: [],                    // bounded ring of normalized envelopes
      counters: {},                  // { critical: 3, warnings: 12, ... }
      // Slice MA5: generic selection slot for the right inspector.
      // shape: { kind: string, payload: object | null } | null
      // MA5 wired the timeline → "event"; MA6 added "child" + "subagent"
      // (agent-tree panel) and "pinned-event" support stays under "event".
      selectedItem: null,
      // Slice MA6: timeline scope filter — Set<string> of scopes the user
      // has toggled OFF. Empty set = show every scope (default). When the
      // user clicks a chip, that scope toggles in/out of the set; the
      // timeline panel reads snapshot.timelineExcluded and filters on it.
      timelineExcluded: new Set(),
      // Slice MA6: pinned events — references survive eviction from the
      // events ring. A user pins an envelope from the inspector; the
      // store keeps the reference alive (the events ring may evict the
      // original entry, but the pinned ref still renders in the timeline
      // and the inspector keeps working).
      pinnedEvents: new Set(),
      // Slice MB1 (Phase D Round 2): per-run detail cache. Hydrated lazily
      // when the user selects a run (via hydrateRunDetail). Contract:
      //   runId → { run, recentEvents, children, subagents, findings,
      //             findingsOverflow, replayMeta, exportedAt }
      // The bootstrap payload only carries the run LIST + summary; this
      // map carries the deeper per-run data so the timeline + inspector +
      // agent-tree can show live detail without hitting bootstrap again.
      runDetails: new Map(),
      // Slice D3-b (Phase E1.5, 2026-04-29): account-status slice fed
      // by the periodic /api/server/info refresh in legacy-bridge.
      // Shape mirrors D3-a:
      //   { profile:    { activeId, activeLabel, count, credentialBackend },
      //     deployment: { mode, publicSector, allowLocalExecutor,
      //                   allowPlaintextSecrets, requireSandboxWorkspace,
      //                   requirePiiScan },
      //     bridge:     { mode },
      //     remote:     { mode, activeRunnerCount } }
      // null until the first refresh lands; the global-bar shows
      // "(loading)" placeholders until then.
      accountStatus: null,
    };
  }

  function createMonitorStore({ maxEvents = DEFAULT_MAX_EVENTS } = {}) {
    if (!Number.isFinite(maxEvents) || maxEvents < 1) {
      throw new Error("createMonitorStore: maxEvents must be >= 1");
    }
    let state = freshState();
    const subscribers = new Set();

    function _publish() {
      const snap = snapshot();
      for (const fn of Array.from(subscribers)) {
        try { fn(snap); } catch (_) { /* never let one subscriber break others */ }
      }
    }

    function snapshot() {
      // Cheap shallow copy that turns the Map into a plain object for
      // tests + DOM consumers. Inner run objects are shared by reference;
      // panels treating them as immutable is the convention.
      const runs = {};
      for (const [id, r] of state.runs.entries()) runs[id] = r;
      return {
        server: state.server,
        runs,
        runIds: Array.from(state.runs.keys()),
        selectedRunId: state.selectedRunId,
        activeChildren: state.activeChildren.slice(),
        events: state.events.slice(),
        counters: { ...state.counters },
        // Slice MA5: shallow copy of the selection envelope. payload is
        // shared by reference because envelopes are treated as immutable.
        selectedItem: state.selectedItem
          ? { kind: state.selectedItem.kind, payload: state.selectedItem.payload }
          : null,
        // Slice MA6: filter + pin slices. Sorted for stable test asserts.
        timelineExcluded: Array.from(state.timelineExcluded).sort(),
        pinnedEvents: Array.from(state.pinnedEvents),
        // Slice MB1: runDetails map → plain object. Inner detail objects
        // are shared by reference (same convention as runs map).
        runDetails: Object.fromEntries(state.runDetails.entries()),
        // Slice D3-b: shallow copy of the account-status block so a
        // panel reading snapshot.accountStatus doesn't accidentally
        // mutate the underlying state.
        accountStatus: state.accountStatus
          ? {
              profile: state.accountStatus.profile ? { ...state.accountStatus.profile } : null,
              deployment: state.accountStatus.deployment ? { ...state.accountStatus.deployment } : null,
              bridge: state.accountStatus.bridge ? { ...state.accountStatus.bridge } : null,
              remote: state.accountStatus.remote ? { ...state.accountStatus.remote } : null,
            }
          : null,
      };
    }

    function subscribe(fn) {
      if (typeof fn !== "function") throw new Error("subscribe: listener must be a function");
      subscribers.add(fn);
      return function unsubscribe() { subscribers.delete(fn); };
    }

    // ── actions ──────────────────────────────────────────────────────

    function setServerSummary(summary) {
      state.server = summary && typeof summary === "object" ? { ...summary } : null;
      _publish();
      return snapshot();
    }

    function setActiveChildren(list) {
      state.activeChildren = Array.isArray(list) ? list.slice() : [];
      _publish();
      return snapshot();
    }

    function upsertRun(runId, partial) {
      if (!runId || typeof runId !== "string") return snapshot();
      const prev = state.runs.get(runId) || { id: runId };
      const next = Object.assign({}, prev, partial || {}, { id: runId });
      if (!next.lastEventAt) next.lastEventAt = Date.now();
      state.runs.set(runId, next);
      _publish();
      return snapshot();
    }

    function removeRun(runId) {
      if (!runId || !state.runs.has(runId)) return snapshot();
      state.runs.delete(runId);
      if (state.selectedRunId === runId) state.selectedRunId = null;
      _publish();
      return snapshot();
    }

    function selectRun(runId) {
      // null is allowed (deselect)
      if (runId !== null && (!runId || typeof runId !== "string")) return snapshot();
      if (runId !== null && !state.runs.has(runId)) return snapshot();
      state.selectedRunId = runId;
      _publish();
      return snapshot();
    }

    function pushEvent(envelope) {
      if (!envelope || typeof envelope !== "object") return snapshot();
      state.events.push(envelope);
      if (state.events.length > maxEvents) {
        state.events.splice(0, state.events.length - maxEvents);
      }
      // Auto-bump the run's lastEventAt if the envelope is run-scoped.
      const rid = envelope.runId;
      if (rid && state.runs.has(rid)) {
        const r = state.runs.get(rid);
        r.lastEventAt = envelope.ts || Date.now();
      }
      _publish();
      return snapshot();
    }

    function bumpCounter(name, delta) {
      if (!name || typeof name !== "string") return snapshot();
      const d = Number.isFinite(delta) ? delta : 1;
      state.counters[name] = (state.counters[name] || 0) + d;
      _publish();
      return snapshot();
    }

    function reset() {
      state = freshState();
      _publish();
      return snapshot();
    }

    // ── Slice MA5: selection ──────────────────────────────────────

    function selectItem(kind, payload) {
      // Allow null/empty kind to act as a no-op so callers don't have to
      // pre-validate. Use clearSelection() when intent is to clear.
      if (typeof kind !== "string" || kind.length === 0) return snapshot();
      state.selectedItem = { kind, payload: payload == null ? null : payload };
      _publish();
      return snapshot();
    }

    function clearSelection() {
      // Idempotent — publishing on an already-null selection wastes a
      // re-render in every subscriber, so guard.
      if (state.selectedItem === null) return snapshot();
      state.selectedItem = null;
      _publish();
      return snapshot();
    }

    // ── Slice MA6: timeline scope filter ──────────────────────────

    function toggleTimelineScope(scope) {
      // No-op for non-string / empty scope so the panel doesn't have to
      // pre-validate.
      if (typeof scope !== "string" || scope.length === 0) return snapshot();
      if (state.timelineExcluded.has(scope)) {
        state.timelineExcluded.delete(scope);
      } else {
        state.timelineExcluded.add(scope);
      }
      _publish();
      return snapshot();
    }

    function setTimelineFilter(scopes) {
      // null / undefined → clear all exclusions.
      if (scopes == null) {
        if (state.timelineExcluded.size === 0) return snapshot();
        state.timelineExcluded = new Set();
        _publish();
        return snapshot();
      }
      // Replace the exclusion set wholesale.
      const next = new Set();
      if (scopes && typeof scopes[Symbol.iterator] === "function") {
        for (const s of scopes) if (typeof s === "string" && s.length > 0) next.add(s);
      }
      state.timelineExcluded = next;
      _publish();
      return snapshot();
    }

    // ── Slice MA6: event pinning ──────────────────────────────────

    function pinEvent(env) {
      // pinEvent is for envelope refs only — no-op on bad input.
      if (!env || typeof env !== "object") return snapshot();
      if (state.pinnedEvents.has(env)) return snapshot();
      state.pinnedEvents.add(env);
      _publish();
      return snapshot();
    }

    function unpinEvent(env) {
      if (!env || !state.pinnedEvents.has(env)) return snapshot();
      state.pinnedEvents.delete(env);
      _publish();
      return snapshot();
    }

    function togglePinEvent(env) {
      if (!env || typeof env !== "object") return snapshot();
      if (state.pinnedEvents.has(env)) {
        state.pinnedEvents.delete(env);
      } else {
        state.pinnedEvents.add(env);
      }
      _publish();
      return snapshot();
    }

    // ── Slice MB1: per-run detail cache ──────────────────────────

    function setRunDetail(runId, detail) {
      // No-op for bad input — caller (hydrateRunDetail) is responsible
      // for shape, but we guard so a network glitch can't trash state.
      if (typeof runId !== "string" || runId.length === 0) return snapshot();
      if (!detail || typeof detail !== "object") return snapshot();
      state.runDetails.set(runId, detail);
      _publish();
      return snapshot();
    }

    // ── Slice D3-b: account-status slice ──────────────────────────
    //
    // Single-action update for the /api/server/info block fed by the
    // legacy-bridge periodic refresh. We accept a partial object —
    // any of the 4 sub-blocks may be missing or null and we keep the
    // last known good value for that sub-block. Common case (legacy
    // server without D3-a wired) all 4 will be present and stable-
    // shape per D3-a's contract.
    function setAccountStatus(input) {
      if (input == null) {
        // Explicit null clears the slice entirely (used on monitor
        // close + tests).
        if (state.accountStatus === null) return snapshot();
        state.accountStatus = null;
        _publish();
        return snapshot();
      }
      if (typeof input !== "object") return snapshot();
      // Defensive shallow copies of each sub-block. Keeps the previous
      // value when the field isn't passed (preserves last-known-good
      // through a partial poll response).
      const prev = state.accountStatus || {};
      const next = {
        profile: "profile" in input
          ? (input.profile && typeof input.profile === "object" ? { ...input.profile } : null)
          : (prev.profile || null),
        deployment: "deployment" in input
          ? (input.deployment && typeof input.deployment === "object" ? { ...input.deployment } : null)
          : (prev.deployment || null),
        bridge: "bridge" in input
          ? (input.bridge && typeof input.bridge === "object" ? { ...input.bridge } : null)
          : (prev.bridge || null),
        remote: "remote" in input
          ? (input.remote && typeof input.remote === "object" ? { ...input.remote } : null)
          : (prev.remote || null),
      };
      state.accountStatus = next;
      _publish();
      return snapshot();
    }

    function clearRunDetail(runId) {
      // Specific runId clears just that entry; null/undefined clears all
      // (used on monitor close + tab refresh).
      if (runId == null) {
        if (state.runDetails.size === 0) return snapshot();
        state.runDetails.clear();
        _publish();
        return snapshot();
      }
      if (typeof runId !== "string" || !state.runDetails.has(runId)) return snapshot();
      state.runDetails.delete(runId);
      _publish();
      return snapshot();
    }

    // Test-only inspection so unit tests don't need to read the snapshot
    // every time. Internals not exposed by the public API.
    function _internal() {
      return { state, subscriberCount: subscribers.size };
    }

    return {
      // queries
      snapshot,
      subscribe,
      // actions
      setServerSummary,
      setActiveChildren,
      upsertRun,
      removeRun,
      selectRun,
      pushEvent,
      bumpCounter,
      reset,
      // Slice MA5
      selectItem,
      clearSelection,
      // Slice MA6
      toggleTimelineScope,
      setTimelineFilter,
      pinEvent,
      unpinEvent,
      togglePinEvent,
      // Slice MB1
      setRunDetail,
      clearRunDetail,
      // Slice D3-b
      setAccountStatus,
      // testing aid
      _internal,
    };
  }

  return { createMonitorStore, DEFAULT_MAX_EVENTS };
});
