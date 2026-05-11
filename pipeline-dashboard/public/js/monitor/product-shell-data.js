// Slice UI-P5-a (Phase 2 Round 3, 2026-04-30) — product-shell data selectors.
//
// Pure selector functions that adapt the OrchestratorMonitorStore snapshot
// into the data shapes each product-shell panel renders. Every selector
// returns either the real value (when the store has it) or `null`, so
// each panel can fall back to its UI-P4 mock when no live data exists.
//
// Why selectors live in their own module:
//   - Pure functions are easy to unit-test (no DOM, no store).
//   - Each panel imports just the selectors it needs — no shared state.
//   - UI-P5 wiring becomes "subscribe + read selector + render"; if the
//     store schema changes, only the selectors move.
//
// Convention:
//   - `null` = "no real data — fall back to mock"
//   - All selectors take the snapshot as the FIRST arg
//   - Selectors NEVER mutate the snapshot

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductShellData = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // ── Run selection ────────────────────────────────────────────────

  function _runsSize(snap) {
    if (!snap || !snap.runs) return 0;
    if (typeof snap.runs.size === "number") return snap.runs.size;
    if (typeof snap.runs === "object") return Object.keys(snap.runs).length;
    return 0;
  }

  function _runsValues(snap) {
    if (!snap || !snap.runs) return [];
    if (typeof snap.runs.values === "function") return Array.from(snap.runs.values());
    if (typeof snap.runs === "object") return Object.values(snap.runs);
    return [];
  }

  function _runsGet(snap, runId) {
    if (!snap || !snap.runs || !runId) return null;
    if (typeof snap.runs.get === "function") return snap.runs.get(runId) || null;
    if (typeof snap.runs === "object") return snap.runs[runId] || null;
    return null;
  }

  function _runDetails(snap, runId) {
    if (!snap || !snap.runDetails || !runId) return null;
    if (typeof snap.runDetails.get === "function") return snap.runDetails.get(runId) || null;
    if (typeof snap.runDetails === "object") return snap.runDetails[runId] || null;
    return null;
  }

  /**
   * Pick the runId the product shell should show. Priority:
   *   1. snap.selectedRunId if it points to an existing run
   *   2. The first "active" / "running" run in the map
   *   3. The most recent run by lastEventAt (or startedAt)
   *   4. null when there are no runs at all
   */
  function selectActiveRunId(snap) {
    if (!snap) return null;
    if (snap.selectedRunId && _runsGet(snap, snap.selectedRunId)) {
      return snap.selectedRunId;
    }
    const runs = _runsValues(snap);
    if (runs.length === 0) return null;
    // Prefer active/running
    const active = runs.find((r) => r && (r.status === "active" || r.status === "running"));
    if (active && active.id) return active.id;
    // Else pick most recent
    const sorted = runs.slice().sort(function (a, b) {
      const at = (b && (b.lastEventAt || b.startedAt)) || 0;
      const bt = (a && (a.lastEventAt || a.startedAt)) || 0;
      return Number(at) - Number(bt);
    });
    return (sorted[0] && sorted[0].id) || null;
  }

  // ── Header status pill ───────────────────────────────────────────

  /**
   * Returns "idle" | "running" | "error" based on store.runs aggregate.
   * Mirrors product-header.js _statusFromStoreSnapshot but lives here
   * for shared use (e.g. orchestrator-track's status pill).
   */
  function selectAggregateRunStatus(snap) {
    if (!snap) return "idle";
    let sawActive = false, sawError = false;
    for (const r of _runsValues(snap)) {
      if (!r) continue;
      if (r.status === "active" || r.status === "running") sawActive = true;
      else if (r.status === "error") sawError = true;
    }
    if (sawActive) return "running";
    if (sawError) return "error";
    return "idle";
  }

  // ── Pipeline rail phases ────────────────────────────────────────

  /**
   * Returns an array of phase objects for the rail to render, or null
   * to signal "use mock". The shape matches MOCK_STAGES so the rail
   * doesn't need a separate code path.
   */
  function selectRunPhases(snap, runId) {
    const detail = _runDetails(snap, runId);
    const run = _runsGet(snap, runId);
    if (!detail && !run) return null;

    // Two possible source shapes (depending on bridge state):
    //   detail.run.phases : array from per-run detail fetch (MB1)
    //   run.phases        : optional inline phase array
    // If neither, return null → mock.
    const phases = (detail && detail.run && Array.isArray(detail.run.phases))
      ? detail.run.phases
      : (run && Array.isArray(run.phases) ? run.phases : null);
    if (!phases || phases.length === 0) return null;

    // Normalize each phase to the shape MOCK_STAGES uses
    return phases.map(function (p, idx) {
      return {
        id: p.id || ("phase-" + idx),
        index: idx,
        status: p.status || "pending",
        actor: p.actor || "—",
        icon: p.icon || "◇",
        kor: p.label || p.kor || p.name || ("Phase " + (idx + 1)),
        eng: p.eng || p.englishLabel || "",
        dur: p.dur || (p.durationMs ? Math.round(p.durationMs / 100) / 10 + "s" : "—"),
        detail: p.detail || p.description || "",
      };
    });
  }

  /** Returns 4 metric rows from the run summary, or null. */
  function selectRunMetrics(snap, runId) {
    const detail = _runDetails(snap, runId);
    if (!detail || !detail.run) return null;
    const r = detail.run;
    if (!r.metrics) return null;
    const m = r.metrics;
    const rows = [];
    if (m.elapsed != null)       rows.push({ id: "elapsed",       label: "총 경과",     value: String(m.elapsed) });
    if (m.iteration != null)     rows.push({ id: "iteration",     label: "이터레이션", value: String(m.iteration) });
    if (m.gatesPassed != null)   rows.push({ id: "gates-passed",  label: "게이트 통과", value: String(m.gatesPassed) });
    if (m.eta != null)           rows.push({ id: "eta",           label: "예상 잔여",  value: String(m.eta) });
    return rows.length > 0 ? rows : null;
  }

  // ── Monitor grid: findings ──────────────────────────────────────

  function selectFindings(snap, runId) {
    const detail = _runDetails(snap, runId);
    if (!detail || !Array.isArray(detail.findings)) return null;
    // Aggregate by severity tier
    const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
    for (const f of detail.findings) {
      if (!f) continue;
      const sev = (f.severity || f.tier || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counts, sev)) counts[sev] += 1;
    }
    // If everything is 0, treat as no real data (fall back to mock for demo)
    const total = counts.critical + counts.high + counts.medium + counts.low + counts.note;
    if (total === 0) return null;
    return [
      { tier: "critical", count: counts.critical },
      { tier: "high",     count: counts.high },
      { tier: "medium",   count: counts.medium },
      { tier: "low",      count: counts.low },
      { tier: "note",     count: counts.note },
    ];
  }

  // ── Monitor grid: context ───────────────────────────────────────

  function selectContextUsage(snap, runId) {
    const detail = _runDetails(snap, runId);
    if (!detail || !detail.context) return null;
    const c = detail.context;
    if (typeof c.percent !== "number") return null;
    return {
      percent: Math.max(0, Math.min(1, c.percent)),
      used: c.used || "—",
      total: c.total || "—",
      remaining: c.remaining || "—",
    };
  }

  // ── Monitor grid: verify ────────────────────────────────────────

  function selectVerifyStatus(snap, runId) {
    const detail = _runDetails(snap, runId);
    const fromDetail = detail && (detail.verifyStatus || (detail.run && detail.run.verifyStatus));
    if (!fromDetail) return null;
    const v = (typeof fromDetail === "string") ? { status: fromDetail } : fromDetail;
    const status = v.status || "idle";
    return {
      status: ["pass", "fail", "idle"].indexOf(status) >= 0 ? status : "idle",
      label: v.label || (status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "—"),
      gates: v.gates || ((v.passing != null && v.total != null) ? (v.passing + " of " + v.total + " gates") : "—"),
    };
  }

  // ── Monitor grid: subagents ─────────────────────────────────────

  function selectSubagents(snap, runId) {
    const detail = _runDetails(snap, runId);
    if (!detail || !Array.isArray(detail.subagents) || detail.subagents.length === 0) return null;
    return detail.subagents.map(function (a, idx) {
      // SUBAGENTS-RICH-0 (2026-05-11): forward the server's metrics
      // payload so the monitor-grid card can render tool breakdown +
      // parent context. pipeline-executor.js Slice W emits these
      // fields on subagent_completed:
      //   metrics: { toolCount, byTool: {Edit: 3, Read: 7, ...},
      //              durationMs }
      // The card reads agentType (for color coding), byTool (for top-3
      // pill display), toolCount (fallback when byTool is absent),
      // and parentSessionId (future tree-indent affordance).
      const metrics = (a.metrics && typeof a.metrics === "object") ? a.metrics : null;
      return {
        id: a.session_id || a.id || ("agent-" + idx),
        name: a.label || a.agent_type || a.name || ("Agent " + (idx + 1)),
        status: a.active ? "running" : (a.completedAt ? "done" : "queued"),
        dur: metrics && metrics.durationMs
          ? Math.round(metrics.durationMs / 100) / 10 + "s"
          : "—",
        agentType: a.agent_type || null,
        toolCount: metrics && typeof metrics.toolCount === "number"
          ? metrics.toolCount : null,
        byTool: metrics && metrics.byTool && typeof metrics.byTool === "object"
          ? metrics.byTool : null,
        parentSessionId: a.parent_session_id || a.parentSessionId || null,
      };
    });
  }

  // ── Monitor grid: tool calls ────────────────────────────────────

  /**
   * Pull tool calls from recent events. Returns the last `limit` calls
   * (most recent first), or null if no tool events exist.
   */
  function selectRecentToolCalls(snap, runId, limit) {
    if (!snap || !Array.isArray(snap.events)) return null;
    const max = (typeof limit === "number" && limit > 0) ? limit : 6;
    const calls = [];
    for (let i = snap.events.length - 1; i >= 0 && calls.length < max; i -= 1) {
      const e = snap.events[i];
      if (!e || !e.type) continue;
      if (e.type !== "tool" && e.type !== "tool_call" && e.type !== "tool_blocked") continue;
      // Filter by runId when one is specified — global tool events always pass.
      const eRunId = (e.data && e.data.runId) || null;
      if (runId && eRunId && eRunId !== runId) continue;
      const data = e.data || {};
      calls.push({
        tool: data.tool || data.name || "Tool",
        arg: data.arg || data.summary || "",
        dur: data.durationMs ? data.durationMs + "ms" : (data.dur || "—"),
        t: data.at ? String(data.at).slice(11, 19) : "—:—:—",
      });
    }
    return calls.length > 0 ? calls : null;
  }

  // ── Monitor grid: critique timeline ─────────────────────────────

  function selectCritique(snap, runId) {
    if (!snap || !snap.reviewSessions) return null;
    // Pick the most recent review session for this run
    const sessions = (typeof snap.reviewSessions.values === "function")
      ? Array.from(snap.reviewSessions.values())
      : Object.values(snap.reviewSessions || {});
    const ours = sessions.filter(function (s) {
      return s && (s.runId === runId || (!runId && s.runId == null));
    });
    if (ours.length === 0) return null;
    const session = ours[ours.length - 1];
    if (!session.history || !Array.isArray(session.history) || session.history.length === 0) return null;
    return session.history.map(function (h) {
      const actor = (h.actor || h.role || "").toLowerCase();
      return {
        side: actor === "claude" ? "right" : "left",
        actor: h.actor || (actor === "claude" ? "Claude" : "Codex"),
        text: h.text || h.summary || h.message || "",
        t: h.at ? String(h.at).slice(11, 19) : "—:—:—",
      };
    });
  }

  // ── Monitor grid: Codex live tail ───────────────────────────────

  function selectCodexLiveTail(snap, runId, maxChars) {
    if (!snap || !snap.reviewStreams) return null;
    // PRODUCT-LIVE-STREAM-0 Gap G: route through selectActiveReviewSession
    // so the same real-vs-synthetic priority applies (real session wins
    // over synthetic `general:<runId>` when both exist for the runId).
    const session = selectActiveReviewSession(snap, runId);
    if (!session) return null;
    const sid = session.sessionId || session.id;
    const streams = (typeof snap.reviewStreams.get === "function")
      ? snap.reviewStreams.get(sid)
      : (snap.reviewStreams[sid] || null);
    // PRODUCT-LIVE-STREAM-0 Gap C: store.appendReviewChunk writes into
    // `streams.codex` (canonical, store.js:856) but legacy review-relay
    // paths use `streams.codexChunks`. Fallback in both directions so
    // both shapes render. selectReviewStreamChunks at line 342 already
    // does this — selectCodexLiveTail was the asymmetric one.
    const arr = streams && (streams.codex || streams.codexChunks);
    if (!arr || arr.length === 0) return null;
    // Concatenate the last N chunks; cap output length.
    // Chunk shape is also bidirectional: appendReviewChunk stores
    // { chunk, seq, ts }; some legacy paths use { text, ... }.
    const max = (typeof maxChars === "number" && maxChars > 0) ? maxChars : 240;
    const text = arr.map(function (c) {
      return (typeof c.chunk === "string" ? c.chunk : null)
        || (typeof c.text === "string" ? c.text : "")
        || "";
    }).join("");
    return text.length > max ? "…" + text.slice(-max) : text;
  }

  // ── Review session selectors (UI-P6) ────────────────────────────

  /**
   * Pick the most relevant review session for the panel to act on.
   * Priority:
   *   1. snap.selectedReviewSessionId if it points to an existing session
   *   2. PRODUCT-LIVE-STREAM-0 Gap G: a REAL session for the runId
   *      (source !== "general") beats any synthetic projection. This
   *      keeps review-relay panels from getting hijacked by the
   *      synthetic `general:<runId>` session that the bridge creates
   *      to feed dual-terminals during a general-task run.
   *   3. The most recent session matching `runId` (if runId given) —
   *      this is where the synthetic session shows up when no real
   *      review session exists.
   *   4. The most recent session at all
   *   5. null when there are no review sessions
   */
  function selectActiveReviewSession(snap, runId) {
    if (!snap || !snap.reviewSessions) return null;
    const sessions = (typeof snap.reviewSessions.values === "function")
      ? Array.from(snap.reviewSessions.values())
      : Object.values(snap.reviewSessions || {});
    if (sessions.length === 0) return null;
    const sel = snap.selectedReviewSessionId;
    if (sel) {
      const found = sessions.find(function (s) {
        return s && (s.sessionId === sel || s.id === sel);
      });
      if (found) return found;
    }
    if (runId) {
      const matching = sessions.filter(function (s) { return s && s.runId === runId; });
      if (matching.length > 0) {
        // Gap G: prefer a real session over the synthetic one.
        const real = matching.find(function (s) { return s && s.source !== "general"; });
        if (real) return real;
        return matching[matching.length - 1];
      }
    }
    return sessions[sessions.length - 1] || null;
  }

  /**
   * Read the chunk array for a session/side pair, normalized to
   * `[{ text, ts, seq }]`. Returns null when no chunks exist. Tolerates
   * both store shapes — { codexChunks, claudeChunks } (legacy) and
   * { codex, claude } (canonical store API).
   */
  function selectReviewStreamChunks(snap, sessionId, side) {
    if (!snap || !snap.reviewStreams || !sessionId) return null;
    const streams = (typeof snap.reviewStreams.get === "function")
      ? snap.reviewStreams.get(sessionId)
      : (snap.reviewStreams[sessionId] || null);
    if (!streams) return null;
    let arr = null;
    if (side === "codex") arr = streams.codexChunks || streams.codex || null;
    else if (side === "claude") arr = streams.claudeChunks || streams.claude || null;
    if (!arr || arr.length === 0) return null;
    return arr.map(function (c, idx) {
      // Store appendReviewChunk canonically stores `{ chunk, seq, ts }`
      // (see public/js/monitor/store.js:615 — entry.chunk = text). We
      // also accept a legacy `text` field for synthetic test fixtures
      // that bypass the action and seed reviewStreams directly.
      return {
        text: (c && (c.text || c.chunk)) || "",
        ts:   (c && (c.ts || c.at)) || null,
        seq:  (c && c.seq != null) ? c.seq : idx,
      };
    });
  }

  /** Symmetric to selectCodexLiveTail but for the Claude rail. */
  function selectClaudeLiveTail(snap, runId, maxChars) {
    if (!snap || !snap.reviewStreams) return null;
    const session = selectActiveReviewSession(snap, runId);
    if (!session) return null;
    const sid = session.sessionId || session.id;
    const streams = (typeof snap.reviewStreams.get === "function")
      ? snap.reviewStreams.get(sid)
      : (snap.reviewStreams[sid] || null);
    if (!streams) return null;
    const chunks = streams.claudeChunks || streams.claude || [];
    if (chunks.length === 0) return null;
    const max = (typeof maxChars === "number" && maxChars > 0) ? maxChars : 240;
    // Same shape tolerance as selectReviewStreamChunks (canonical .chunk
    // from store.appendReviewChunk OR legacy .text from test fixtures).
    const text = chunks.map(function (c) { return (c && (c.text || c.chunk)) || ""; }).join("");
    return text.length > max ? "…" + text.slice(-max) : text;
  }

  /**
   * Surface deployment posture in a normalized shape so panels don't
   * walk store internals. UI-P6 hides "Hand back to Claude" when
   * publicSector + !allowLocalExecutor (matches UI-H7-e contract).
   */
  function selectDeploymentPosture(snap) {
    const accountStatus = (snap && snap.accountStatus) || {};
    const deployment = accountStatus.deployment || {};
    const publicSector = deployment.publicSector === true;
    // allowLocalExecutor defaults to TRUE — only `false` blocks local Claude.
    const allowLocalExecutor = deployment.allowLocalExecutor !== false;
    return {
      publicSector: publicSector,
      allowLocalExecutor: allowLocalExecutor,
      localExecutorBlocked: publicSector && !allowLocalExecutor,
    };
  }

  // ── Header indicators ───────────────────────────────────────────

  // UI-P7: indicator selectors now also expose `labelKey`. Header
  // looks up the i18n translation when an i18n table is wired and
  // falls back to `label` when not. Existing UI-P5 tests assert on
  // `label` (Korean string) — that field stays for backwards compat.
  function selectServerStatus(snap) {
    if (!snap) {
      return { status: "idle", label: "서버 확인 중", labelKey: "prod.indicator.server.checking" };
    }
    if (snap.server && typeof snap.server === "object") {
      const ok = snap.server.up !== false; // default true if not specified
      return {
        status: ok ? "ok" : "fail",
        label: ok ? "서버 ONLINE" : "서버 OFFLINE",
        labelKey: ok ? "prod.indicator.server.online" : "prod.indicator.server.offline",
      };
    }
    if (snap.serverInfo && snap.serverInfo.status === "ok") {
      return { status: "ok", label: "서버 ONLINE", labelKey: "prod.indicator.server.online" };
    }
    // Default = optimistic ok (server is running if the page loaded)
    return { status: "ok", label: "서버 ONLINE", labelKey: "prod.indicator.server.online" };
  }

  function selectCodexStatus(snap) {
    if (!snap || !snap.accountStatus) {
      return { status: "ok", label: "Codex READY", labelKey: "prod.indicator.codex.ready" };
    }
    const profile = snap.accountStatus.profile;
    if (!profile) {
      return { status: "ok", label: "Codex READY", labelKey: "prod.indicator.codex.ready" };
    }
    // If profile carries a lastTest result for codex, surface it
    const lt = profile.codexLastTest || profile.lastTest && profile.lastTest.codex;
    if (lt) {
      if (lt.installed && lt.authenticated) {
        return { status: "ok", label: "Codex READY", labelKey: "prod.indicator.codex.ready" };
      }
      if (lt.installed) {
        return { status: "warn", label: "Codex 인증 필요", labelKey: "prod.indicator.codex.authNeeded" };
      }
      return { status: "fail", label: "Codex 미설치", labelKey: "prod.indicator.codex.notInstalled" };
    }
    return { status: "ok", label: "Codex READY", labelKey: "prod.indicator.codex.ready" };
  }

  // ── UX-POLISH-1 (2026-05-11) + UX-POLISH-2 (2026-05-11): findings
  // drawer iteration summary, sourced from snap.events.
  //
  // Aggregates critique-cycle metadata for the findings drawer's
  // "비평 반복" section. Shows total iteration count, re-entry drivers
  // (which severity tiers showed up + sample messages), and per-
  // iteration duration timeline.
  //
  // Why event-based: the synthetic general-task review session never
  // populates `history` (legacy-bridge writes stream chunks, not turn
  // objects). The events buffer is the canonical source — codex_started
  // marks iteration start; critique_received marks iteration done with
  // findings + severity counts.

  /**
   * @returns {{
   *   iterations: number,
   *   drivers: Array<{severity, count, sampleMessage}>,
   *   timeline: Array<{n, durationMs|null, status: "done"|"active"}>
   * }|null}
   */
  function selectIterationSummary(snap, runId) {
    if (!snap) return null;
    const events = Array.isArray(snap.events) ? snap.events : [];
    // Walk events, pairing codex_started → critique_received per run.
    // Each codex_started without a matching critique_received yet is
    // an "active" iteration. critique_received also brings findings;
    // we accumulate them into the drivers map below.
    const starts = [];
    const dones = [];
    let lastFindings = [];
    let lastSeverityCounts = null;
    for (const e of events) {
      if (!e || !e.type) continue;
      const eRunId = e.runId || (e.data && e.data.runId) || null;
      if (runId && eRunId && eRunId !== runId) continue;
      if (e.type === "codex_started") {
        starts.push({ ts: _parseTs(e.ts || (e.data && (e.data.at || e.data.ts))) });
      } else if (e.type === "critique_received") {
        const d = e.data || {};
        const ts = _parseTs(e.ts || d.at || d.ts);
        dones.push({ ts: ts, ok: d.ok !== false, findings: d.findings || [] });
        if (Array.isArray(d.findings) && d.findings.length > 0) lastFindings = d.findings;
        if (d.severityCounts) lastSeverityCounts = d.severityCounts;
      }
    }
    const iterations = Math.max(starts.length, dones.length);
    // ── Drivers (severity → count + sampleMessage) ─────────────────
    // Prefer findings carried in the latest critique_received event
    // (richer than the aggregated run.findings). Fall back to run
    // findings when the event payload is empty (e.g. critique didn't
    // include detailed findings).
    const detail = _runDetails(snap, runId);
    let findingsArr = lastFindings;
    if (findingsArr.length === 0 && detail && Array.isArray(detail.findings)) {
      findingsArr = detail.findings;
    }
    const driverMap = {};
    for (const f of findingsArr) {
      if (!f) continue;
      const sev = String(f.severity || f.tier || "").toLowerCase();
      if (!sev) continue;
      if (!driverMap[sev]) {
        driverMap[sev] = { severity: sev, count: 0, sampleMessage: null };
      }
      driverMap[sev].count += 1;
      const msg = f.message || f.summary || f.text || "";
      if (msg && !driverMap[sev].sampleMessage) {
        driverMap[sev].sampleMessage = String(msg).slice(0, 120);
      }
    }
    // If we only have severityCounts (no individual messages), still
    // surface the bucket counts so the operator sees the shape.
    if (Object.keys(driverMap).length === 0 && lastSeverityCounts) {
      for (const sev of Object.keys(lastSeverityCounts)) {
        const n = lastSeverityCounts[sev];
        if (typeof n === "number" && n > 0) {
          driverMap[sev] = { severity: sev, count: n, sampleMessage: null };
        }
      }
    }
    const severityOrder = ["critical", "high", "medium", "low", "note"];
    const drivers = severityOrder
      .map(function (s) { return driverMap[s]; })
      .filter(function (d) { return d && d.count > 0; });
    // ── Timeline (per-iteration duration) ──────────────────────────
    // Pair start[i] ↔ done[i]. Unmatched starts (start without done)
    // → active. Unmatched dones (done without start, unusual) → done
    // with null duration.
    const timeline = [];
    for (let i = 0; i < iterations; i += 1) {
      const s = starts[i];
      const d = dones[i];
      if (s && d && s.ts != null && d.ts != null) {
        timeline.push({ n: i + 1, durationMs: d.ts - s.ts, status: "done" });
      } else if (s && !d) {
        timeline.push({ n: i + 1, durationMs: null, status: "active" });
      } else {
        timeline.push({ n: i + 1, durationMs: null, status: "done" });
      }
    }
    if (iterations === 0 && drivers.length === 0) return null;
    return { iterations: iterations, drivers: drivers, timeline: timeline };
  }

  function _parseTs(v) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const n = Date.parse(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  // ── UX-POLISH-1 + UX-POLISH-2 (2026-05-11): chat-panel progress
  // milestones, sourced from snap.events.
  //
  // Surfaces a stream of "what just happened" milestones for the chat
  // panel to render as system bubbles. Each milestone has a stable
  // `id` so the chat panel can dedupe (a single subscribe callback may
  // fire multiple times for the same underlying event burst).
  //
  // Why event-based: UX-POLISH-1 originally derived milestones from
  // run.phases + reviewSessions.history. Production runs never populate
  // run.phases (legacy-bridge stores phase/phaseIdx as scalars, not an
  // array) and the synthetic general-task review session has empty
  // history. So the operator saw "✓ 시작했습니다" and nothing else —
  // the screenshot incident that triggered UX-POLISH-2. snap.events
  // is the canonical sequence of lifecycle signals: every WS event the
  // bridge accepted lands there with a stable timestamp.
  //
  // Recognized event types + emitted milestone kinds:
  //   phase_update (status="active")  → phase_enter
  //   codex_started                   → iteration_start
  //   critique_received (ok=true)     → iteration_done
  //   critique_received (ok=false)    → iteration_failed
  //   error                           → halt_error
  //   tool_blocked                    → tool_blocked
  //   pipeline_paused                 → pause
  //   pipeline_complete (failed)      → halt_failed
  //   pipeline_complete (ok)          → pipeline_complete
  //
  // The selector is pure — no subscriptions, no clocks. The chat panel
  // is responsible for tracking `sinceTs` and emitting only milestones
  // newer than its last seen timestamp.

  // Map phase letter → human label for milestone params. PLAN/REVISE
  // are the Claude phases (B/D); CRITIQUE/RE-CHECK are Codex (C);
  // EXECUTE/VERIFY are runtime phases (E/F). Falls through to letter.
  const _PHASE_LABEL = Object.freeze({
    A: "CONTEXT", B: "PLAN", C: "CRITIQUE", D: "REVISE",
    E: "EXECUTE", F: "VERIFY", G: "DONE",
  });
  function _phaseLabel(phaseLetter) {
    if (!phaseLetter) return "?";
    const up = String(phaseLetter).toUpperCase();
    return _PHASE_LABEL[up] ? (up + " (" + _PHASE_LABEL[up] + ")") : up;
  }

  /**
   * @param {object} snap     — store snapshot
   * @param {string} runId    — active run id (or null/"default")
   * @param {number} sinceTs  — milliseconds since epoch; emit only milestones with ts > sinceTs
   * @returns {Array<{id, ts, kind, params}>}
   */
  function selectProgressMilestones(snap, runId, sinceTs) {
    if (!snap || !Array.isArray(snap.events)) return [];
    const since = (typeof sinceTs === "number") ? sinceTs : 0;
    const out = [];
    // Track per-phase entry dedupe (phase_update fires for both
    // "active" and "completed" — we only want one bubble per phase
    // entry, keyed by phase letter). Also track iteration counter
    // so iteration_done can report 1번/2번/... in the bubble.
    const seenPhases = new Set();
    let iterationN = 0;
    // ── pipeline_complete metrics needed for the final bubble ──
    let pipelineStartTs = null;
    for (const e of snap.events) {
      if (!e || !e.type) continue;
      // Filter by runId — events without runId are global lifecycle
      // (heartbeats etc.) and shouldn't trigger milestones.
      const eRunId = e.runId || (e.data && e.data.runId) || null;
      if (runId && eRunId && eRunId !== runId) continue;
      const ts = _parseTs(e.ts || (e.data && (e.data.at || e.data.ts)));
      if (ts == null) continue;
      const d = e.data || {};
      if (e.type === "pipeline_start" && pipelineStartTs == null) pipelineStartTs = ts;
      // Skip emitting milestones older than sinceTs, but still let
      // counters above advance so iteration numbers stay consistent
      // across multiple selector calls.
      const visible = ts > since;
      if (e.type === "phase_update") {
        const phase = d.phase;
        const status = d.status;
        if (!phase) continue;
        if (status === "active" && !seenPhases.has(phase)) {
          seenPhases.add(phase);
          if (visible) {
            out.push({
              id: "phase:" + (runId || "x") + ":" + phase,
              ts: ts,
              kind: "phase_enter",
              params: { phase: _phaseLabel(phase) },
            });
          }
        }
      } else if (e.type === "codex_started") {
        iterationN = (typeof d.iteration === "number" ? d.iteration + 1 : iterationN + 1);
        if (visible) {
          out.push({
            id: "iter-start:" + (runId || "x") + ":" + iterationN,
            ts: ts,
            kind: "iteration_start",
            params: { n: iterationN, phase: _phaseLabel(d.phase || "C") },
          });
        }
      } else if (e.type === "critique_received") {
        // Derive iteration number from event payload when present, else
        // from our running counter.
        const n = (typeof d.iteration === "number")
          ? d.iteration + 1 : (iterationN || 1);
        const sev = d.severityCounts
          || (d.findings ? _bucketSeverity(d.findings) : { critical: 0, high: 0 });
        if (visible) {
          const ok = d.ok !== false;  // legacy default
          if (ok) {
            out.push({
              id: "iter-done:" + (runId || "x") + ":" + n,
              ts: ts,
              kind: "iteration_done",
              params: { n: n, c: sev.critical || 0, h: sev.high || 0 },
            });
          } else {
            out.push({
              id: "iter-failed:" + (runId || "x") + ":" + n,
              ts: ts,
              kind: "iteration_failed",
              params: { n: n, msg: d.error || "비평 실패" },
            });
          }
        }
      } else if (e.type === "error") {
        if (visible) {
          out.push({
            id: "halt-error:" + (runId || "x") + ":" + ts,
            ts: ts,
            kind: "halt_error",
            params: {
              phase: _phaseLabel(d.phase || "?"),
              node: d.node || "?",
              msg: d.message || d.error || "원인 미상",
            },
          });
        }
      } else if (e.type === "tool_blocked") {
        if (visible) {
          out.push({
            id: "tool-blocked:" + (runId || "x") + ":" + ts,
            ts: ts,
            kind: "tool_blocked",
            params: { tool: d.tool || d.name || "?", reason: d.reason || "정책 차단" },
          });
        }
      } else if (e.type === "pipeline_paused") {
        if (visible) {
          out.push({
            id: "pause:" + (runId || "x") + ":" + ts,
            ts: ts,
            kind: "pause",
            params: { reason: d.reason || "" },
          });
        }
      } else if (e.type === "pipeline_complete") {
        const failed = !!d.failed
          || (Array.isArray(d.errors) && d.errors.length > 0);
        const elapsedSec = (pipelineStartTs != null)
          ? Math.round((ts - pipelineStartTs) / 100) / 10
          : null;
        const sec = (elapsedSec != null) ? elapsedSec : "—";
        if (visible) {
          if (failed) {
            out.push({
              id: "halt-failed:" + (runId || "x"),
              ts: ts,
              kind: "halt_failed",
              params: { reason: d.reason || (d.errors && d.errors[0]) || "원인 미상", sec: sec },
            });
          } else {
            out.push({
              id: "complete:" + (runId || "x"),
              ts: ts,
              kind: "pipeline_complete",
              params: { iters: iterationN, sec: sec },
            });
          }
        }
      }
    }
    out.sort(function (a, b) { return a.ts - b.ts; });
    return out;
  }

  // Bucket a finding list into severity counts. Mirrors selectFindings
  // but produces a {critical, high, ...} object instead of an array.
  function _bucketSeverity(findings) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
    if (!Array.isArray(findings)) return counts;
    for (const f of findings) {
      if (!f) continue;
      const sev = String(f.severity || f.tier || "").toLowerCase();
      if (Object.prototype.hasOwnProperty.call(counts, sev)) counts[sev] += 1;
    }
    return counts;
  }

  return {
    selectActiveRunId,
    selectAggregateRunStatus,
    selectRunPhases,
    selectRunMetrics,
    selectFindings,
    selectContextUsage,
    selectVerifyStatus,
    selectSubagents,
    selectRecentToolCalls,
    selectCritique,
    selectCodexLiveTail,
    selectClaudeLiveTail,
    selectActiveReviewSession,
    selectReviewStreamChunks,
    selectDeploymentPosture,
    selectServerStatus,
    selectCodexStatus,
    // UX-POLISH-1
    selectIterationSummary,
    selectProgressMilestones,
  };
});
