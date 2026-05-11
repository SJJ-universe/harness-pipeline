// Slice MB4-a + MC2 (Phase D Round 2 + 2.5, 2026-04-27) — OrchestratorMonitorLegacyBridge.
//
// Without this bridge the monitor store is a snapshot frozen at the
// moment hydrateMonitorStore returned. The legacy WebSocket stream
// (handled by app.js::handleEvent → tab bar / tool feed / etc.) keeps
// flowing but never reaches the monitor store, so the timeline + agent
// tree + inspector show stale data.
//
// The bridge fixes that with three cheap mechanisms:
//
//   1. Tap into OrchestratorEventDispatcher (MB4-a addition) — every event
//      app.js receives is mirrored to a wildcard tap. The tap normalizes
//      via OrchestratorMonitorNormalizer and pushes to store.pushEvent. No
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
  if (typeof window !== "undefined") root.OrchestratorMonitorLegacyBridge = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_REFRESH_MS = 5000;
  const DEFAULT_INFO_URL = "/api/server/info";
  // Slice SMART-0-c (Phase 2 SMART arc, 2026-05-04): decision-context
  // endpoint polled alongside /api/server/info on the same interval.
  // SMART panels (recommendations / hard gates / etc) read the
  // resulting store.decisionContext slice.
  const DEFAULT_DECISION_CONTEXT_URL = "/api/decision-context";
  // Slice POL-c (Phase 2 / POLICY-UX-0, 2026-05-05): policy pack
  // catalog endpoint. Fetched ONCE on install — packs are frozen
  // at boot, no point polling. UI panel reads store.policyPacks.
  const DEFAULT_POLICY_PACKS_URL = "/api/policy-packs";

  function install({
    store,
    normalize,
    dispatcher = null,           // window.OrchestratorEventDispatcher in browser
    fetchImpl = null,            // window.fetch in browser
    setIntervalFn = null,        // setInterval in browser
    clearIntervalFn = null,      // clearInterval in browser
    refreshIntervalMs = DEFAULT_REFRESH_MS,
    infoUrl = DEFAULT_INFO_URL,
    decisionContextUrl = DEFAULT_DECISION_CONTEXT_URL,
    policyPacksUrl = DEFAULT_POLICY_PACKS_URL,
    headers = {},
  } = {}) {
    if (!store || typeof store.pushEvent !== "function") {
      throw new Error("legacyBridge.install: store must be a OrchestratorMonitorStore");
    }
    if (typeof normalize !== "function") {
      throw new Error("legacyBridge.install: normalize must be a function");
    }
    const _dispatcher = dispatcher
      || (typeof globalThis !== "undefined" && globalThis.OrchestratorEventDispatcher);
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
      // Slice SMART-0-c: separate counters for the decision-context
      // poll so its error rate can be inspected without conflating
      // with /api/server/info errors.
      decisionContextRefreshes: 0,
      decisionContextErrors: 0,
      // Slice MC2: count run-summary upserts so tests + readiness
      // checks can verify lifecycle event handling.
      runSyncs: 0,
      // Slice UX-2-a: count approval lifecycle syncs. Increments on
      // every approval_requested / approval_resolved that reached
      // the store.
      approvalSyncs: 0,
      // Slice UI-H7-a: count review-session lifecycle + chunk syncs.
      // Increments on every review_session_* / codex_stream_chunk /
      // claude_stream_chunk / critique_received / handoff_to_claude_*
      // that reached the store.
      reviewSyncs: 0,
      // PRODUCT-LIVE-STREAM-0: count synthetic-session syncs from
      // general-task pipeline events (codex_progress, log_message,
      // general_plan_complete, phase_update B/D active).
      generalStreamSyncs: 0,
    };
    let unsubscribeTap = null;
    let intervalId = null;

    // PRODUCT-LIVE-STREAM-0 (2026-05-07): phase letter → MOCK_STAGES idx
    // mapping. The general pipeline runner (src/server/generalPipelineRunner.js)
    // emits phase_update with `data.phase: "A"|"B"|"C"|"D"` (string) but
    // never `data.phaseIdx` (number). The product-orchestrator-track panel
    // reads `run.phaseIdx` from the store, so without this mapping the
    // panel never advances past STAGE 1/7. MOCK_STAGES order is:
    //   [PLAN(0), CRITIQUE(1), REVISE(2), RE-CHECK(3),
    //    EXECUTE(4), VERIFY(5), DONE(6)]
    // General runner phase semantics:
    //   A = context-analyzer (instant)  → PLAN
    //   B = task-planner (Claude)        → PLAN
    //   C = plan-critic (Codex)          → CRITIQUE
    //   D = plan-refiner (Claude, loops) → REVISE
    // 4 (EXECUTE) and 5 (VERIFY) have no general-task analogue; on
    // pipeline_complete we jump to 6 (DONE) for closure.
    const PHASE_LETTER_TO_IDX = { A: 0, B: 0, C: 1, D: 2 };
    function _phaseLetterToIdx(letter) {
      return Object.prototype.hasOwnProperty.call(PHASE_LETTER_TO_IDX, letter)
        ? PHASE_LETTER_TO_IDX[letter] : null;
    }

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
          // PRODUCT-LIVE-STREAM-0 Gap E: pipeline_start payload from the
          // general runner has no `phase` field, so phase_update can't
          // run its letter→idx fallback yet. Seed phaseIdx: 0 so the
          // orchestrator-track panel snaps from null/idle to PLAN immediately
          // when the run begins.
          partial = {
            status: "active",
            templateId: data.template || data.templateId || null,
            startedAt: data.at || data.ts || now,
            phaseIdx: 0,
          };
          if (typeof data.phase === "string") partial.phase = data.phase;
          if (typeof data.phaseIdx === "number") partial.phaseIdx = data.phaseIdx;
          else if (typeof data.phase === "string") {
            const _idx = _phaseLetterToIdx(data.phase);
            if (_idx !== null) partial.phaseIdx = _idx;
          }
          break;
        case "phase_update":
          partial = {
            phase: data.phase || null,
            // status from phase_update only flips the run-level status
            // when the phase reports "error"; otherwise we leave the
            // run as "active" (the legacy semantics).
            status: data.status === "error" ? "error" : "active",
          };
          // PRODUCT-LIVE-STREAM-0 Gap A: server emits phase as a letter
          // (A/B/C/D) without phaseIdx. Map letters via PHASE_LETTER_TO_IDX
          // so the panel advances. Explicit phaseIdx still wins.
          if (typeof data.phaseIdx === "number") partial.phaseIdx = data.phaseIdx;
          else {
            const _idx = _phaseLetterToIdx(data.phase);
            if (_idx !== null) partial.phaseIdx = _idx;
          }
          break;
        case "pipeline_paused":
          partial = { status: "paused" };
          break;
        case "pipeline_complete": {
          // PRODUCT-LIVE-STREAM-0 Gap D: pipeline_complete payload from
          // the general runner uses `errors: [...]` (not `failed: bool`)
          // to signal failure. Treat a non-empty errors array OR a
          // truthy `failed` as error. On clean completion, jump phaseIdx
          // to 6 (DONE) so orchestrator-track shows full progress.
          const _hasErrors = !!data.failed
            || (Array.isArray(data.errors) && data.errors.length > 0);
          partial = {
            status: _hasErrors ? "error" : "completed",
            completedAt: data.at || data.ts || now,
          };
          if (!_hasErrors) partial.phaseIdx = 6;
          break;
        }
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

      // PLS-0-followup (2026-05-08): when a brand-new pipeline run
      // arrives, also flip selectedRunId so the orchestrator-track + horse
      // panels start showing it. Without this the store keeps a stale
      // selectedRunId (often the bootstrap "default" placeholder),
      // selectActiveRunId returns the wrong run, and the panels never
      // animate even though the new run's phaseIdx is being updated
      // correctly underneath. Only fire on pipeline_start to avoid
      // hijacking the operator's manual selection mid-run.
      if (type === "pipeline_start" && typeof store.selectRun === "function") {
        try {
          const _curSel = (store.snapshot && store.snapshot().selectedRunId) || null;
          // Re-select if nothing is selected, or if the prior selection
          // is the bootstrap placeholder ("default"), or simply not the
          // run that just started.
          if (_curSel == null || _curSel === "default" || _curSel !== runId) {
            store.selectRun(runId);
          }
        } catch (_) { /* defensive */ }
      }

      // Slice RR0-c: when a run completes / resets, sweep its
      // runner-activity entries so the long-running task card stops
      // showing stale warnings. The watchdog itself emits no
      // "runner_recovered" event — the kill timer + clear() in the
      // runner are server-side; the client wipes state when the
      // pipeline reports the run finished.
      if ((type === "pipeline_complete" || type === "pipeline_reset")
        && typeof store.clearRunnerActivityForRun === "function") {
        try { store.clearRunnerActivityForRun(runId); } catch (_) {}
      }
      return true;
    }

    // Slice RR0-c (Phase 2 / RELEASE-READY-0, 2026-05-05): runner
    // activity lifecycle events. Returns true when the event was a
    // runner_*_idle_warning / _killed_for_idle event so the caller
    // can skip the normal pushEvent path (these are tracked on a
    // dedicated slice, not in the events ring — they'd be too
    // frequent for ring-eviction sanity).
    function _syncRunnerActivityFromEvent(type, data) {
      const isWarn  = type === "codex_idle_warning"  || type === "claude_idle_warning";
      const isKill  = type === "codex_killed_for_idle" || type === "claude_killed_for_idle";
      if (!isWarn && !isKill) return false;
      if (!data || typeof data !== "object") return true;
      const runner = type.startsWith("codex_") ? "codex" : "claude";
      const payload = {
        runner,
        runId: typeof data.runId === "string" ? data.runId : "default",
        phase: data.phase || null,
        iteration: data.iteration || 0,
        msSinceLastTick: Number(data.msSinceLastTick) || 0,
      };
      if (isWarn) {
        payload.msUntilKill = Number(data.msUntilKill) || 0;
        if (typeof store.recordRunnerIdleWarning === "function") {
          try { store.recordRunnerIdleWarning(payload); } catch (_) {}
        }
        stats.runnerActivitySyncs = (stats.runnerActivitySyncs || 0) + 1;
      } else {
        payload.reason = typeof data.reason === "string" ? data.reason : "unknown";
        if (typeof store.recordRunnerKilled === "function") {
          try { store.recordRunnerKilled(payload); } catch (_) {}
        }
        stats.runnerActivitySyncs = (stats.runnerActivitySyncs || 0) + 1;
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

    // Slice UI-H7-a: review-session lifecycle + stream-chunk events
    // → store.upsertReviewSession / store.appendReviewChunk.
    //
    // Returns true when the event was a known review-session type
    // and was consumed. Stream chunks are HIGH volume and have their
    // own slice (reviewStreams), so the bridge skips pushEvent for
    // them. Lifecycle events are also consumed exclusively (the
    // dual-agent-console reads reviewSessions, not the events ring).
    //
    // We treat ALL review-session-scoped events as consumed so the
    // events ring (timeline) stays clean of relay noise. The
    // dedicated review-relay panel (H7-c) is the single surface for
    // review history.
    function _syncReviewSessionFromEvent(event) {
      if (!event || typeof event !== "object") return false;
      const type = event.type;
      const data = (event.data && typeof event.data === "object") ? event.data : {};
      const sessionId = data.sessionId;
      // Reject early when this isn't a review-session event. Every
      // review broadcast carries `sessionId` per the manager contract.
      if (typeof sessionId !== "string" || !sessionId) return false;

      const now = Date.now();
      switch (type) {
        case "review_session_created": {
          // Two semantic uses (per manager source):
          //   - On create:    { sessionId, source, runId, label, createdAt }
          //   - On sendCodex: { sessionId, state, dispatchedAt }
          // We merge both; later events overwrite earlier fields.
          if (typeof store.upsertReviewSession !== "function") return true;
          const partial = { sessionId };
          if (data.source !== undefined)     partial.source = data.source;
          if (data.runId !== undefined)      partial.runId = data.runId;
          if (data.label !== undefined)      partial.label = data.label;
          if (data.createdAt !== undefined)  partial.createdAt = data.createdAt;
          if (data.state !== undefined)      partial.state = data.state;
          partial.lastActivityAt = data.dispatchedAt
            || data.createdAt || now;
          if (partial.state === undefined && data.createdAt !== undefined) {
            // First-create payload — initialise state.
            partial.state = "created";
          }
          try { store.upsertReviewSession(sessionId, partial); }
          catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "codex_stream_chunk": {
          if (typeof store.appendReviewChunk !== "function") return true;
          try {
            store.appendReviewChunk(sessionId, "codex", {
              chunk: data.chunk, seq: data.seq, ts: data.ts || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "claude_stream_chunk": {
          if (typeof store.appendReviewChunk !== "function") return true;
          try {
            store.appendReviewChunk(sessionId, "claude", {
              chunk: data.chunk, seq: data.seq, ts: data.ts || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "critique_received": {
          if (typeof store.upsertReviewSession !== "function") return true;
          try {
            store.upsertReviewSession(sessionId, {
              state: "critique_received",
              critiqueSummary: data.summary || null,
              critiqueSeverityCounts: data.severityCounts || null,
              lastActivityAt: data.receivedAt || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "handoff_to_claude_requested": {
          if (typeof store.upsertReviewSession !== "function") return true;
          try {
            store.upsertReviewSession(sessionId, {
              state: "awaiting_claude",
              includeCritique: !!data.includeCritique,
              lastActivityAt: data.dispatchedAt || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "handoff_to_claude_completed": {
          if (typeof store.upsertReviewSession !== "function") return true;
          try {
            store.upsertReviewSession(sessionId, {
              state: "claude_received",
              claudeSummary: data.summary
                ? { summary: data.summary, completedAt: data.completedAt || now }
                : null,
              lastActivityAt: data.completedAt || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        case "review_session_archived": {
          if (typeof store.upsertReviewSession !== "function") return true;
          try {
            store.upsertReviewSession(sessionId, {
              state: "archived",
              archivedAt: data.archivedAt || now,
              archiveReason: data.reason || null,
              lastActivityAt: data.archivedAt || now,
            });
          } catch (_) { /* defensive */ }
          stats.reviewSyncs++;
          return true;
        }
        default:
          return false;
      }
    }

    // PRODUCT-LIVE-STREAM-0 (2026-05-07): emergency projection bridge
    // for the general-task pipeline. The product shell's dual-terminals
    // panel reads from `reviewStreams` Map<sessionId, {claude, codex}>.
    // General-task runs have no review session, so without this helper
    // the terminals stay frozen at "No live stream yet." even though
    // the server is broadcasting useful content (codex_progress every
    // 500ms, log_message at phase boundaries, general_plan_complete
    // with the full plan + critique summary).
    //
    // Strategy: synthesize a session id `"general:<runId>"` and fan
    // these events into the existing reviewStreams slice. dual-terminals
    // automatically picks up the synthesized session via
    // selectActiveReviewSession + selectReviewStreamChunks; no panel
    // changes required.
    //
    // Boundary discipline (so review-relay semantics aren't muddied):
    //   - Every synthetic session is tagged with `source: "general"`
    //     and `streamOnly: true`. The action-row gate in
    //     product-dual-terminals checks streamOnly to suppress the
    //     review API buttons (start session / send to codex / etc.)
    //     for these synthesized entries.
    //   - selectActiveReviewSession prefers a real session
    //     (`source !== "general"`) when one exists for the same runId.
    //   - codex_progress is gated on `data.source === "general-pipeline"`
    //     so review-relay codex traffic isn't accidentally vacuumed
    //     into the wrong stream.
    //
    // Always returns false so the caller continues normal processing
    // (events ring, run sync, app.js handlers all still fire).
    function _syncGeneralStreamFromEvent(event) {
      if (!event || typeof event !== "object") return false;
      const t = event.type;
      if (t !== "codex_progress" && t !== "log_message"
          && t !== "general_plan_complete" && t !== "phase_update") {
        return false;
      }
      const data = (event.data && typeof event.data === "object") ? event.data : {};
      const runId = data.runId;
      if (typeof runId !== "string" || !runId) return false;

      // Gap H: codex_progress source gate — only general-pipeline
      // (vs review-session, etc.) flows into the synthetic stream.
      if (t === "codex_progress" && data.source !== "general-pipeline") return false;

      // phase_update: only "active" status on Claude phases (B/D)
      // produces a synthetic claude-side status line. Other
      // phase_update permutations fall through (run sync still fires
      // through the normal switch).
      if (t === "phase_update") {
        const _isClaudePhase = data.phase === "B" || data.phase === "D";
        if (!_isClaudePhase || data.status !== "active") return false;
      }

      const sid = "general:" + runId;
      const now = Date.now();

      if (typeof store.upsertReviewSession === "function") {
        try {
          store.upsertReviewSession(sid, {
            sessionId: sid,
            runId,
            source: "general",
            streamOnly: true,
            state: "in_progress",
            lastActivityAt: now,
          });
        } catch (_) { /* defensive */ }
      }

      if (typeof store.appendReviewChunk !== "function") return false;

      if (t === "codex_progress") {
        const chunkText = (typeof data.stdout === "string" && data.stdout)
          || (typeof data.stderr === "string" && data.stderr) || "";
        if (!chunkText) {
          stats.generalStreamSyncs = (stats.generalStreamSyncs || 0) + 1;
          return false;
        }
        try {
          store.appendReviewChunk(sid, "codex", {
            chunk: chunkText,
            seq: data.elapsedMs || now,
            ts: now,
          });
        } catch (_) { /* defensive */ }
      } else if (t === "phase_update") {
        // Gap F: insert an immediate status line into the Claude
        // terminal so the operator can see Claude is actively
        // working. Real stdout streaming is a follow-up round
        // (PRODUCT-LIVE-STREAM-2).
        const _label = data.phase === "B"
          ? "Claude 계획 생성 중..."
          : "Claude 수정 중...";
        try {
          store.appendReviewChunk(sid, "claude", {
            chunk: "[" + data.phase + "] " + _label + "\n",
            seq: now,
            ts: now,
          });
        } catch (_) { /* defensive */ }
      } else if (t === "log_message") {
        const _msg = (typeof data.message === "string" ? data.message : "") || "";
        if (_msg.length === 0) {
          stats.generalStreamSyncs = (stats.generalStreamSyncs || 0) + 1;
          return false;
        }
        try {
          store.appendReviewChunk(sid, "claude", {
            chunk: _msg,
            seq: now,
            ts: now,
          });
        } catch (_) { /* defensive */ }
      } else if (t === "general_plan_complete") {
        const _finalPlan = (typeof data.finalPlan === "string" ? data.finalPlan : "") || "";
        if (_finalPlan) {
          const _tail = _finalPlan.length > 4000
            ? "...\n" + _finalPlan.slice(-4000) : _finalPlan;
          try {
            store.appendReviewChunk(sid, "claude", {
              chunk: "[최종 plan]\n" + _tail,
              seq: now,
              ts: now,
            });
          } catch (_) { /* defensive */ }
        }
        const _summary = data.lastCritique
          && typeof data.lastCritique.summary === "string"
            ? data.lastCritique.summary : "";
        if (_summary) {
          try {
            store.appendReviewChunk(sid, "codex", {
              chunk: "[비평 요약]\n" + _summary,
              seq: now + 1,
              ts: now,
            });
          } catch (_) { /* defensive */ }
        }
        if (typeof store.upsertReviewSession === "function") {
          try {
            store.upsertReviewSession(sid, {
              state: "completed",
              lastActivityAt: now,
            });
          } catch (_) { /* defensive */ }
        }
      }

      stats.generalStreamSyncs = (stats.generalStreamSyncs || 0) + 1;
      return false;
    }

    // ── 1. Wildcard tap → store.pushEvent + run sync ──
    function _onLegacyEvent(event) {
      // PRODUCT-LIVE-STREAM-0: emergency projection bridge — fan
      // selected general-pipeline events into a synthetic review
      // session (`general:<runId>`) so the product shell terminals
      // come alive. Always returns false; doesn't gate any other
      // handler. See _syncGeneralStreamFromEvent for the boundary
      // discipline (source gate, streamOnly tag, action-row guard).
      try { _syncGeneralStreamFromEvent(event); } catch (_) { /* defensive */ }
      // Slice UI-H7-a: review-session events take precedence — they
      // have their own slice (reviewSessions / reviewStreams). Skip
      // pushEvent + run sync for them so high-volume stream chunks
      // don't pollute the events ring.
      if (_syncReviewSessionFromEvent(event)) return;
      // Slice UX-2-a: approval events take precedence — they have
      // their own slice (pendingApprovals) and don't go through the
      // generic events ring. Skip pushEvent + run sync for them.
      if (_syncApprovalFromEvent(event)) return;
      // Slice RR0-c: runner activity events take precedence — own
      // slice (runnerActivity), volume-prone (kicks every idle window),
      // skip pushEvent so they don't pollute the events ring.
      if (event && typeof event === "object"
          && _syncRunnerActivityFromEvent(event.type, event.data || {})) {
        return;
      }

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
    // ── Slice SMART-0-c: periodic /api/decision-context refresh ──
    //
    // Independent error handling from refresh() so a transient
    // /api/server/info hiccup doesn't break decision-context
    // updates and vice-versa. SMART panels read store.decisionContext
    // populated here.
    async function refreshDecisionContext() {
      if (typeof _fetch !== "function") return null;
      if (typeof store.setDecisionContext !== "function") {
        // Older store builds without the slice — silently skip.
        return null;
      }
      try {
        const res = await _fetch(decisionContextUrl, {
          method: "GET",
          headers: { Accept: "application/json", ...headers },
        });
        if (!res || typeof res.ok !== "boolean" || !res.ok) {
          stats.decisionContextErrors++;
          return null;
        }
        const payload = typeof res.json === "function" ? await res.json() : null;
        if (!payload || typeof payload !== "object") {
          stats.decisionContextErrors++;
          return null;
        }
        // setDecisionContext does its own schema check; bad payload
        // shape becomes a no-op there. Stats still tick as success
        // (we got HTTP 200 with parseable JSON).
        store.setDecisionContext(payload);
        stats.decisionContextRefreshes++;
        return payload;
      } catch (_) {
        stats.decisionContextErrors++;
        return null;
      }
    }

    // ── Slice POL-c: one-shot policy pack catalog fetch ──
    //
    // Packs are frozen at boot so we only need to fetch once. UI
    // panel reads store.policyPacks on demand. setPolicyPacks does
    // schema check + idempotent dirty-skip so a rare manual re-fetch
    // doesn't notify-churn.
    async function refreshPolicyPacks() {
      if (typeof _fetch !== "function") return null;
      if (typeof store.setPolicyPacks !== "function") {
        return null;  // older store builds — silently skip
      }
      try {
        const res = await _fetch(policyPacksUrl, {
          method: "GET",
          headers: { Accept: "application/json", ...headers },
        });
        if (!res || typeof res.ok !== "boolean" || !res.ok) {
          stats.policyPacksErrors = (stats.policyPacksErrors || 0) + 1;
          return null;
        }
        const payload = typeof res.json === "function" ? await res.json() : null;
        if (!payload || typeof payload !== "object") {
          stats.policyPacksErrors = (stats.policyPacksErrors || 0) + 1;
          return null;
        }
        store.setPolicyPacks(payload);
        stats.policyPacksRefreshes = (stats.policyPacksRefreshes || 0) + 1;
        return payload;
      } catch (_) {
        stats.policyPacksErrors = (stats.policyPacksErrors || 0) + 1;
        return null;
      }
    }

    if (typeof _setInterval === "function" && refreshIntervalMs > 0) {
      intervalId = _setInterval(() => {
        refresh();
        refreshDecisionContext();
      }, refreshIntervalMs);
      // Don't run an initial refresh here — the layout's hydrate already
      // populates the store on mount. The first interval tick takes over
      // 5s later, which keeps boot-time noise low.
      // POL-c: kick the policy pack catalog fetch as a one-shot at
      // install time. No interval — packs are frozen at boot, so a
      // single fetch is enough for the lifetime of the operator session.
      refreshPolicyPacks();
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
      // Slice SMART-0-c: dedicated decision-context refresh so tests
      // (and operator scripts) can trigger the SMART arc input
      // independently of the /api/server/info refresh.
      refreshDecisionContext,
      // Slice POL-c: dedicated policy pack catalog refresh
      refreshPolicyPacks,
      stats: () => ({ ...stats }),
      // Slice MC2: test hook so unit tests can drive the sync function
      // directly without going through the dispatcher tap.
      _syncRunFromEvent,
      // Slice UI-H7-a: same test-hook discipline.
      _syncReviewSessionFromEvent,
      // PRODUCT-LIVE-STREAM-0: same test-hook discipline.
      _syncGeneralStreamFromEvent,
    };
  }

  return { install, DEFAULT_REFRESH_MS, DEFAULT_INFO_URL };
});
