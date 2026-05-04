// Slice UI-P5-a (Phase 2 Round 3, 2026-04-30) — product-shell data selectors.
//
// Pure selector functions that adapt the HarnessMonitorStore snapshot
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
  if (typeof window !== "undefined") root.HarnessProductShellData = api;
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
   * for shared use (e.g. harness-track's status pill).
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
      return {
        id: a.session_id || a.id || ("agent-" + idx),
        name: a.label || a.agent_type || a.name || ("Agent " + (idx + 1)),
        status: a.active ? "running" : (a.completedAt ? "done" : "queued"),
        dur: a.metrics && a.metrics.durationMs
          ? Math.round(a.metrics.durationMs / 100) / 10 + "s"
          : "—",
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
    const sessions = (typeof snap.reviewSessions && snap.reviewSessions.values === "function")
      ? Array.from(snap.reviewSessions.values())
      : Object.values(snap.reviewSessions || {});
    const ours = sessions.filter(function (s) {
      return s && (s.runId === runId || (!runId && s.runId == null));
    });
    if (ours.length === 0) return null;
    const session = ours[ours.length - 1];
    const streams = (typeof snap.reviewStreams.get === "function")
      ? snap.reviewStreams.get(session.sessionId || session.id)
      : (snap.reviewStreams[session.sessionId || session.id] || null);
    if (!streams || !streams.codexChunks || streams.codexChunks.length === 0) return null;
    // Concatenate the last N chunks; cap output length
    const max = (typeof maxChars === "number" && maxChars > 0) ? maxChars : 240;
    const text = streams.codexChunks.map(function (c) { return c.text || ""; }).join("");
    return text.length > max ? "…" + text.slice(-max) : text;
  }

  // ── Header indicators ───────────────────────────────────────────

  function selectServerStatus(snap) {
    if (!snap) return { status: "idle", label: "서버 확인 중" };
    if (snap.server && typeof snap.server === "object") {
      const ok = snap.server.up !== false; // default true if not specified
      return {
        status: ok ? "ok" : "fail",
        label: ok ? "서버 ONLINE" : "서버 OFFLINE",
      };
    }
    if (snap.serverInfo && snap.serverInfo.status === "ok") {
      return { status: "ok", label: "서버 ONLINE" };
    }
    // Default = optimistic ok (server is running if the page loaded)
    return { status: "ok", label: "서버 ONLINE" };
  }

  function selectCodexStatus(snap) {
    if (!snap || !snap.accountStatus) return { status: "ok", label: "Codex READY" };
    const profile = snap.accountStatus.profile;
    if (!profile) return { status: "ok", label: "Codex READY" };
    // If profile carries a lastTest result for codex, surface it
    const lt = profile.codexLastTest || profile.lastTest && profile.lastTest.codex;
    if (lt) {
      if (lt.installed && lt.authenticated) return { status: "ok", label: "Codex READY" };
      if (lt.installed) return { status: "warn", label: "Codex 인증 필요" };
      return { status: "fail", label: "Codex 미설치" };
    }
    return { status: "ok", label: "Codex READY" };
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
    selectServerStatus,
    selectCodexStatus,
  };
});
