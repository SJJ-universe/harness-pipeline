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
//
// Slice UI-H7-a (Phase D / Phase E1.5, 2026-04-30):
//   review-session slice for the Claude→Codex→Claude review relay.
//   - reviewSessions: Map<sessionId, partialSession>
//   - selectedReviewSessionId: string | null (operator focus)
//   - reviewStreams: Map<sessionId, { codex, claude, lastSeq, summaries }>
//   Actions: upsertReviewSession / removeReviewSession / selectReviewSession
//            / appendReviewChunk / setReviewSessionsList / clearReviewSessions.
//   Volume policy: chunk events go through appendReviewChunk only (NOT
//   the events ring); the reviewStreams maps cap each stream at
//   MAX_REVIEW_CHUNKS so a runaway Codex/Claude doesn't bloat the
//   snapshot. The dual-agent-console action row (UI-H7-c) renders this
//   slice; lifecycle events (review_session_created / critique_received
//   / handoff_to_claude_* / review_session_archived) update partial
//   session state via upsertReviewSession.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorStore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_MAX_EVENTS = 200;
  // Slice UI-H7-a — per-session per-side stream cap so a runaway
  // Codex/Claude doesn't blow snapshot size unbounded. 500 chunks is
  // generous (typical critique = 30-50 chunks; rare reviews can hit
  // 100-200) yet keeps the worst case bounded at ~500KB per session.
  const DEFAULT_MAX_REVIEW_CHUNKS = 500;

  /**
   * Slice UX-2-a — copy each samples-array so caller mutation of
   * sample[type].push("...") doesn't leak into stored state. Shape:
   *   { krn: ["...***...", ...], phone_kr_mobile: [...], ... }
   */
  function _cloneSamplesShape(samples) {
    if (!samples || typeof samples !== "object") return {};
    const out = {};
    for (const [type, arr] of Object.entries(samples)) {
      out[type] = Array.isArray(arr) ? [...arr] : [];
    }
    return out;
  }

  /**
   * Slice UX-2-a — defensive copy of an approval request from the
   * manager's broadcast envelope. Mirrors the manager's
   * `_shallowClone` so the snapshot shape stays in lockstep.
   * Args + samples are nested objects; defensive copies guard
   * against caller mutation leaking into stored state.
   */
  function _shallowCloneApproval(r) {
    return {
      approvalId: r.approvalId,
      hook: r.hook,
      tool: r.tool,
      args: r.args && typeof r.args === "object" ? { ...r.args } : {},
      argsHash: r.argsHash,
      argsSummary: r.argsSummary,
      runId: r.runId,
      hostIdentity: r.hostIdentity,
      source: r.source,
      piiContext: r.piiContext ? {
        hasPii: !!r.piiContext.hasPii,
        findingTypes: Array.isArray(r.piiContext.findingTypes)
          ? [...r.piiContext.findingTypes] : [],
        // Samples object: each value is an array of redacted strings.
        // Deep-copy the arrays so caller mutation doesn't leak into
        // stored state. Strings inside are immutable, so a shallow
        // array copy at this level is sufficient.
        samples: _cloneSamplesShape(r.piiContext.samples),
      } : null,
      timeoutMs: r.timeoutMs,
      requestedAt: r.requestedAt,
      expiresAt: r.expiresAt,
    };
  }

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
      // Slice SMART-0-c (Phase 2 SMART arc, 2026-05-04): decisionContext
      // is the SMART arc's primary input — pure projection of operator-
      // attention state (8 booleans + counts + posture + sources).
      // Populated by the legacy-bridge polling /api/decision-context
      // every 5s. Null until the first poll lands; SMART panels
      // gracefully degrade (no recommendations / no hard gates fire).
      // Snapshot returns a defensively shallow-copied frozen-ish
      // structure (the inner objects are frozen by the route's
      // buildContext).
      decisionContext: null,
      // Slice SMART-1-b (Phase 2 SMART arc, 2026-05-04): UI-state-only
      // tracking of dismissed recommendation IDs. Panel-set; server
      // doesn't know about dismissal (it's an operator UX preference,
      // not a gate). The panel persists this set in localStorage
      // so a refresh remembers what was hidden. State changes that
      // toggle a rule's appliesTo will re-show even if previously
      // dismissed (engine evaluates fresh on every poll); explicit
      // operator dismiss is an opt-out for stale recommendations.
      dismissedRecommendations: new Set(),
      // Slice UX-2-a (R3-e + GOV-APPROVAL-0): pending operator
      // approvals for write-tool dispatches. Map<approvalId, request>
      // where request mirrors the manager's snapshot:
      //   { approvalId, hook, tool, args, argsHash, argsSummary,
      //     runId, hostIdentity, source, piiContext, timeoutMs,
      //     requestedAt, expiresAt }
      // Filled by the legacy-bridge translating WS approval_requested
      // events; emptied on approval_resolved (no matter the
      // resolution). Both Simple-Mode card + Advanced-Mode panel
      // read this slice.
      pendingApprovals: new Map(),
      // Slice UI-H7-a (Phase D / E1.5): review-session slice.
      //   reviewSessions: Map<sessionId, partial>
      //     Partial shape mirrors reviewSessionManager._snapshot but
      //     the bridge fills it incrementally (lifecycle broadcasts
      //     don't carry full history). The action-row panel (H7-c)
      //     hits /api/review-sessions/:id when the operator opens a
      //     session for the first time to fetch the canonical history.
      //   selectedReviewSessionId: which session the dual-agent
      //     console action row is currently focused on.
      //   reviewStreams: Map<sessionId, { codex:[], claude:[],
      //                                   lastSeq, critiqueSummary,
      //                                   claudeSummary }>
      //     Per-side chunk buffers. Each chunk is { chunk, seq, ts }.
      //     Capped at DEFAULT_MAX_REVIEW_CHUNKS per side so the
      //     snapshot stays bounded regardless of session length.
      reviewSessions: new Map(),
      selectedReviewSessionId: null,
      reviewStreams: new Map(),
    };
  }

  function createMonitorStore({
    maxEvents = DEFAULT_MAX_EVENTS,
    maxReviewChunks = DEFAULT_MAX_REVIEW_CHUNKS,
  } = {}) {
    if (!Number.isFinite(maxEvents) || maxEvents < 1) {
      throw new Error("createMonitorStore: maxEvents must be >= 1");
    }
    if (!Number.isFinite(maxReviewChunks) || maxReviewChunks < 1) {
      throw new Error("createMonitorStore: maxReviewChunks must be >= 1");
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
              // Slice UI-FirstRun-b: providerStatus is a panel-set
              // slice (settings-accounts modal calls setProviderStatus
              // after probe-provider returns). Stays null until the
              // operator runs a Test action — first-run classifier
              // tolerates missing.
              providerStatus: state.accountStatus.providerStatus
                ? {
                    claude: state.accountStatus.providerStatus.claude
                      ? { ...state.accountStatus.providerStatus.claude }
                      : null,
                    codex: state.accountStatus.providerStatus.codex
                      ? { ...state.accountStatus.providerStatus.codex }
                      : null,
                  }
                : null,
            }
          : null,
        // Slice SMART-0-c: decisionContext snapshot. The inner
        // booleans / counts / posture / sources objects are already
        // frozen by buildContext on the server; we shallow-copy the
        // outer envelope here so a panel can't mutate the cached
        // snapshot identity.
        decisionContext: state.decisionContext
          ? {
              schema: state.decisionContext.schema,
              timestamp: state.decisionContext.timestamp,
              booleans: state.decisionContext.booleans
                ? { ...state.decisionContext.booleans } : null,
              counts: state.decisionContext.counts
                ? { ...state.decisionContext.counts } : null,
              posture: state.decisionContext.posture
                ? { ...state.decisionContext.posture } : null,
              sources: state.decisionContext.sources
                ? { ...state.decisionContext.sources } : null,
            }
          : null,
        // Slice SMART-1-b: dismissed recommendation IDs as a snapshot
        // array (sorted for stable test asserts). Panels read this
        // to filter the engine's output; mutators below maintain
        // the underlying Set.
        dismissedRecommendations: Array.from(state.dismissedRecommendations).sort(),
        // Slice UX-2-a: defensive shallow copy of each pending
        // approval. Sorted by requestedAt so the card UI displays
        // oldest-first (operator deciding in arrival order).
        pendingApprovals: Array.from(state.pendingApprovals.values())
          .map((r) => _shallowCloneApproval(r))
          .sort((a, b) => (a.requestedAt || 0) - (b.requestedAt || 0)),
        // Slice UI-H7-a: review-session slice.
        //   reviewSessions: array sorted by lastActivityAt desc
        //     (matches reviewSessionManager.list() ordering)
        //   selectedReviewSessionId: focused session for the action row
        //   reviewStreams: object keyed by sessionId
        //     value = { codex, claude, lastSeq, critiqueSummary,
        //               claudeSummary } — chunks are shallow-copied
        //     so a panel rendering them can't mutate stored buffers.
        reviewSessions: Array.from(state.reviewSessions.values())
          .map((s) => ({ ...s }))
          .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)),
        selectedReviewSessionId: state.selectedReviewSessionId,
        reviewStreams: _snapshotReviewStreams(state.reviewStreams),
      };
    }

    function _snapshotReviewStreams(streams) {
      const out = {};
      for (const [sid, s] of streams.entries()) {
        out[sid] = {
          codex: s.codex.slice(),
          claude: s.claude.slice(),
          lastSeq: s.lastSeq || 0,
          critiqueSummary: s.critiqueSummary
            ? { ...s.critiqueSummary,
                severityCounts: s.critiqueSummary.severityCounts
                  ? { ...s.critiqueSummary.severityCounts } : null }
            : null,
          claudeSummary: s.claudeSummary ? { ...s.claudeSummary } : null,
        };
      }
      return out;
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
        // Slice UI-FirstRun-b: providerStatus is panel-set, NOT
        // populated by /api/server/info polling. setAccountStatus
        // preserves the existing slice unless caller explicitly
        // passes providerStatus (rare — most callers won't include).
        providerStatus: "providerStatus" in input
          ? (input.providerStatus && typeof input.providerStatus === "object" ? { ...input.providerStatus } : null)
          : (prev.providerStatus || null),
      };
      state.accountStatus = next;
      _publish();
      return snapshot();
    }

    // Slice UI-FirstRun-b: dedicated mutator for the providerStatus
    // slice — settings-accounts panel calls this after a successful
    // (or failed) probe-provider response so the first-run classifier
    // can drop out of the "untested" branch into provider-missing /
    // provider-not-authenticated / ready as appropriate.
    //
    // Input shape: {claude?: {installed, authenticated, ...}, codex?: {...}}
    // Partial input merges over previous (operator who only tests Claude
    // doesn't wipe Codex's last-known status).
    function setProviderStatus(input) {
      if (input == null) {
        // Explicit null clears the slice.
        if (!state.accountStatus || !state.accountStatus.providerStatus) {
          return snapshot();
        }
        state.accountStatus = { ...state.accountStatus, providerStatus: null };
        _publish();
        return snapshot();
      }
      if (typeof input !== "object") return snapshot();
      const prev = state.accountStatus || {};
      const prevPS = prev.providerStatus || {};
      const nextPS = {
        claude: "claude" in input
          ? (input.claude && typeof input.claude === "object" ? { ...input.claude } : null)
          : (prevPS.claude || null),
        codex: "codex" in input
          ? (input.codex && typeof input.codex === "object" ? { ...input.codex } : null)
          : (prevPS.codex || null),
      };
      state.accountStatus = {
        // Preserve other accountStatus blocks
        profile: prev.profile || null,
        deployment: prev.deployment || null,
        bridge: prev.bridge || null,
        remote: prev.remote || null,
        providerStatus: nextPS,
      };
      _publish();
      return snapshot();
    }

    // ── Slice SMART-0-c: decisionContext slice mutator ───────────

    // Replaces the cached decisionContext snapshot. Input is the
    // exact response body from GET /api/decision-context (validated
    // by schema check below). null clears the slice (e.g. on monitor
    // close + tests).
    function setDecisionContext(input) {
      if (input == null) {
        if (state.decisionContext === null) return snapshot();
        state.decisionContext = null;
        _publish();
        return snapshot();
      }
      // Validate schema marker so a stray response shape doesn't
      // pollute the slice. The route always emits this constant.
      if (!input || typeof input !== "object" ||
          input.schema !== "harness-decision-context/v1") {
        return snapshot();
      }
      // Defensive shallow clone of each sub-block. Inner objects
      // are frozen by the route's buildContext, so identity-pinning
      // is fine; we just need to prevent caller-side mutation of
      // the slice's outer envelope.
      state.decisionContext = {
        schema: input.schema,
        timestamp: input.timestamp,
        booleans: input.booleans && typeof input.booleans === "object"
          ? { ...input.booleans } : null,
        counts: input.counts && typeof input.counts === "object"
          ? { ...input.counts } : null,
        posture: input.posture && typeof input.posture === "object"
          ? { ...input.posture } : null,
        sources: input.sources && typeof input.sources === "object"
          ? { ...input.sources } : null,
      };
      _publish();
      return snapshot();
    }

    // ── Slice SMART-1-b: dismissed-recommendations actions ──────
    //
    // Operator-side UX state. The recommendationEngine.js evaluates
    // rules fresh on every poll (no server state); this slice is
    // ONLY for "operator clicked dismiss → hide until appliesTo
    // changes". When a rule's underlying signal flips false then
    // true again (e.g., new approval arrived after operator
    // dismissed the previous batch), the engine emits the rule
    // anew because dismiss is keyed on rule ID + operator's intent.
    //
    // For "dismiss this version of the recommendation but reshow
    // when state changes", a future SMART round can extend with
    // a {ruleId, contextHash} key. Current design is the simpler
    // permanent-until-cleared dismiss.

    function dismissRecommendation(ruleId) {
      if (typeof ruleId !== "string" || ruleId.length === 0) return snapshot();
      if (state.dismissedRecommendations.has(ruleId)) return snapshot();
      state.dismissedRecommendations.add(ruleId);
      _publish();
      return snapshot();
    }

    function undoDismissRecommendation(ruleId) {
      if (typeof ruleId !== "string" || ruleId.length === 0) return snapshot();
      if (!state.dismissedRecommendations.has(ruleId)) return snapshot();
      state.dismissedRecommendations.delete(ruleId);
      _publish();
      return snapshot();
    }

    function clearDismissedRecommendations() {
      if (state.dismissedRecommendations.size === 0) return snapshot();
      state.dismissedRecommendations.clear();
      _publish();
      return snapshot();
    }

    // ── Slice UX-2-a: pending-approval actions ───────────────────

    function upsertApproval(request) {
      // Tolerant input — broadcast envelope from the WS bridge
      // hands us the manager's snapshot shape verbatim. Defensive
      // shallow copy so the caller can't mutate the stored entry.
      if (!request || typeof request !== "object") return snapshot();
      const id = request.approvalId;
      if (typeof id !== "string" || id.length === 0) return snapshot();
      state.pendingApprovals.set(id, _shallowCloneApproval(request));
      _publish();
      return snapshot();
    }

    function resolveApproval(approvalId) {
      // Single-arg signature — the manager's broadcastFn already
      // includes resolution metadata in the approval_resolved event,
      // but the store doesn't keep resolved entries (the audit chain
      // does). UI shows "Resolved (granted by …)" toast via the
      // legacy-bridge handler before the entry leaves the slice.
      if (typeof approvalId !== "string" || approvalId.length === 0) return snapshot();
      if (!state.pendingApprovals.has(approvalId)) return snapshot();
      state.pendingApprovals.delete(approvalId);
      _publish();
      return snapshot();
    }

    function clearApprovals() {
      // Used by reset() and on monitor close.
      if (state.pendingApprovals.size === 0) return snapshot();
      state.pendingApprovals.clear();
      _publish();
      return snapshot();
    }

    // ── Slice UI-H7-a: review-session actions ────────────────────

    function _ensureReviewStream(sessionId) {
      let s = state.reviewStreams.get(sessionId);
      if (!s) {
        s = {
          codex: [], claude: [],
          lastSeq: 0,
          critiqueSummary: null,
          claudeSummary: null,
        };
        state.reviewStreams.set(sessionId, s);
      }
      return s;
    }

    function upsertReviewSession(sessionId, partial) {
      // Tolerant input — broadcast envelope or REST GET response can
      // drive this. Defensive: ignore non-string sessionId.
      if (typeof sessionId !== "string" || sessionId.length === 0) return snapshot();
      if (partial && typeof partial !== "object") return snapshot();
      const prev = state.reviewSessions.get(sessionId) || { sessionId };
      const merged = Object.assign({}, prev, partial || {}, { sessionId });
      // Some lifecycle events (handoff_to_claude_completed) carry a
      // claudeSummary field that should land on the streams slice
      // alongside session state. Mirror once per upsert so the
      // dual-agent-console can read either reviewSessions or streams.
      if (partial && partial.claudeSummary !== undefined) {
        const s = _ensureReviewStream(sessionId);
        s.claudeSummary = partial.claudeSummary
          ? { ...partial.claudeSummary } : null;
      }
      if (partial && partial.critiqueSummary !== undefined) {
        const s = _ensureReviewStream(sessionId);
        s.critiqueSummary = partial.critiqueSummary
          ? { summary: partial.critiqueSummary,
              severityCounts: partial.critiqueSeverityCounts
                ? { ...partial.critiqueSeverityCounts } : null }
          : null;
      }
      // Default lastActivityAt for clarity if caller didn't set one.
      if (typeof merged.lastActivityAt !== "number") {
        merged.lastActivityAt = Date.now();
      }
      state.reviewSessions.set(sessionId, merged);
      _publish();
      return snapshot();
    }

    function removeReviewSession(sessionId) {
      if (typeof sessionId !== "string") return snapshot();
      const had = state.reviewSessions.has(sessionId)
        || state.reviewStreams.has(sessionId);
      if (!had) return snapshot();
      state.reviewSessions.delete(sessionId);
      state.reviewStreams.delete(sessionId);
      if (state.selectedReviewSessionId === sessionId) {
        state.selectedReviewSessionId = null;
      }
      _publish();
      return snapshot();
    }

    function selectReviewSession(sessionId) {
      // null is allowed (deselect). Unknown id is allowed (operator may
      // pick a session from a list before lifecycle event lands).
      if (sessionId !== null && (typeof sessionId !== "string" || !sessionId)) {
        return snapshot();
      }
      state.selectedReviewSessionId = sessionId;
      _publish();
      return snapshot();
    }

    function appendReviewChunk(sessionId, side, chunk) {
      if (typeof sessionId !== "string" || !sessionId) return snapshot();
      if (side !== "codex" && side !== "claude") return snapshot();
      if (!chunk || typeof chunk !== "object") return snapshot();
      const text = typeof chunk.chunk === "string" ? chunk.chunk : "";
      if (text.length === 0) return snapshot();
      const s = _ensureReviewStream(sessionId);
      const entry = {
        chunk: text,
        seq: Number.isFinite(chunk.seq) ? chunk.seq : (s.lastSeq + 1),
        ts: Number.isFinite(chunk.ts) ? chunk.ts : Date.now(),
      };
      s[side].push(entry);
      // Cap each side independently — ring eviction.
      if (s[side].length > maxReviewChunks) {
        s[side].splice(0, s[side].length - maxReviewChunks);
      }
      // Track the highest seq across both sides so caller can detect
      // gaps if they ever care.
      if (entry.seq > s.lastSeq) s.lastSeq = entry.seq;
      _publish();
      return snapshot();
    }

    function setReviewSessionsList(list) {
      // Replace the entire reviewSessions Map with the provided list.
      // Used by the API client (UI-H7-b) on initial /api/review-sessions
      // hydrate. Keeps reviewStreams intact (chunks live across list
      // refreshes — list refresh updates lifecycle metadata, not stream
      // bodies).
      if (!Array.isArray(list)) return snapshot();
      const next = new Map();
      for (const session of list) {
        if (!session || typeof session !== "object") continue;
        const sid = session.sessionId;
        if (typeof sid !== "string" || !sid) continue;
        next.set(sid, { ...session });
      }
      state.reviewSessions = next;
      // If the previously selected session is no longer in the list,
      // null out the selection (defensive — caller can re-select).
      if (state.selectedReviewSessionId
          && !state.reviewSessions.has(state.selectedReviewSessionId)) {
        state.selectedReviewSessionId = null;
      }
      _publish();
      return snapshot();
    }

    function clearReviewSessions() {
      // Used by reset() and on monitor close.
      const had = state.reviewSessions.size > 0
        || state.reviewStreams.size > 0
        || state.selectedReviewSessionId !== null;
      if (!had) return snapshot();
      state.reviewSessions.clear();
      state.reviewStreams.clear();
      state.selectedReviewSessionId = null;
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
      // Slice UI-FirstRun-b: providerStatus sub-slice (panel-set after probe)
      setProviderStatus,
      // Slice SMART-0-c: decisionContext slice mutator (legacy-bridge polling)
      setDecisionContext,
      // Slice SMART-1-b: dismissed-recommendations slice mutators
      // (panel-set; recommendations-card persists in localStorage)
      dismissRecommendation,
      undoDismissRecommendation,
      clearDismissedRecommendations,
      // Slice UX-2-a: pending-approval slice (R3-e + GOV-APPROVAL-0)
      upsertApproval,
      resolveApproval,
      clearApprovals,
      // Slice UI-H7-a: review-session slice
      upsertReviewSession,
      removeReviewSession,
      selectReviewSession,
      appendReviewChunk,
      setReviewSessionsList,
      clearReviewSessions,
      // testing aid
      _internal,
    };
  }

  return { createMonitorStore, DEFAULT_MAX_EVENTS, DEFAULT_MAX_REVIEW_CHUNKS };
});
