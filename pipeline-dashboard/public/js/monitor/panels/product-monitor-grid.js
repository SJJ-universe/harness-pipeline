// Slice UI-P1-f / UI-P2-c / UI-P4-b / UI-P5-c (Phase 2 Round 3, 2026-04-30) — monitor grid.
//
// UI-P5-c: each card now takes "real or mock" data via the
// HarnessProductShellData selectors. On store.subscribe, the grid
// rebuilds — every card body picks its real data from the snapshot
// or falls back to the UI-P4 MOCK constant. Demo state stays visible
// when the store has no live run.
//
// Renders the center monitor grid per the reference. UI-P1 painted the
// layout, UI-P2 added structural placeholders, UI-P4 promotes those
// placeholders into demo-grade mock data that matches the reference's
// inline mock arrays exactly. Every renderable slot now carries a
// data-* attribute so UI-P5 can inject store-derived data without
// rebuilding the DOM.
//
// Slot attributes (UI-P5 wiring contract):
//   data-region="monitor-grid"             — panel root
//   data-card="findings|context|verify|codex-live|subagents|tools|critique"
//     data-card-slot="title|count|label|bar|fill|meta|dot|pre|cursor|row|stream"
//   data-tier="critical|high|medium|low|note"           — findings tier
//   data-tool="Read|Grep|Edit|Bash|Write|WebFetch|..."  — tool feed row
//   data-actor="codex|claude"                            — critique bubble
//   data-line-index                                      — terminal/feed row
//
// Mode behavior:
//   - simple: 2-col stat row (Findings + Context); no CodexLive; no Verify
//   - pro:    3-col stat row (+ Verify); CodexLive card visible

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductMonitorGrid = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // UI-P4 demo mock — values match the reference inline arrays so the
  // first paint shows realistic numbers.
  const MOCK_FINDINGS = Object.freeze([
    { tier: "critical", count: 0 },
    { tier: "high",     count: 1 },
    { tier: "medium",   count: 3 },
    { tier: "low",      count: 5 },
    { tier: "note",     count: 8 },
  ]);
  const MOCK_CONTEXT = Object.freeze({
    percent: 0.62,
    used: "124k",
    total: "200k",
    remaining: "~76k 잔여",
  });
  const MOCK_VERIFY = Object.freeze({
    status: "pass",          // pass | fail | idle
    label: "PASS",
    gates: "4 of 4 gates",
  });
  const MOCK_CODEX_LIVE = Object.freeze({
    model: "gpt-5-codex · 142ms",
    text:
      "> 플랜의 3단계에서 JWT secret이 환경변수로만 주입되는데,\n" +
      "  로테이션 정책이 명시되어 있지 않음. (severity: high)\n" +
      "> 4단계 미들웨어 등록 순서가 cors 보다 뒤에 있음. 인증\n" +
      "  실패가 노출될 수 있음. (severity: medium)",
  });
  const MOCK_SUBAGENTS = Object.freeze([
    { id: "sub-1", name: "코드 검색", status: "running", dur: "4.2s" },
    { id: "sub-2", name: "문서 검토", status: "running", dur: "2.1s" },
    { id: "sub-3", name: "테스트 작성", status: "queued",  dur: "—" },
  ]);
  const MOCK_TOOL_FEED = Object.freeze([
    { tool: "Read",  arg: "src/auth/jwt.ts",          dur: "12ms",  t: "16:42:08" },
    { tool: "Grep",  arg: 'pattern="middleware"',     dur: "34ms",  t: "16:42:09" },
    { tool: "Edit",  arg: "src/server.ts:42",         dur: "8ms",   t: "16:42:11" },
    { tool: "Bash",  arg: "npm test -- auth.spec.ts", dur: "2.1s",  t: "16:42:14" },
    { tool: "Read",  arg: "tests/auth.spec.ts",       dur: "6ms",   t: "16:42:17" },
    { tool: "Write", arg: "docs/jwt-rotation.md",     dur: "14ms",  t: "16:42:19" },
  ]);
  const MOCK_CRITIQUE = Object.freeze([
    { side: "left",  actor: "Codex",  text: "플랜 v1: JWT secret 로테이션 누락 (high)",  t: "16:41:52" },
    { side: "right", actor: "Claude", text: "수용. 환경변수 + 24h 로테이션 정책 추가.",   t: "16:42:03" },
    { side: "left",  actor: "Codex",  text: "플랜 v2: cors 미들웨어 순서 문제 (medium)",  t: "16:42:18" },
    { side: "right", actor: "Claude", text: "auth → cors 순서 교정. 재비평 요청.",        t: "16:42:24" },
    { side: "left",  actor: "Codex",  text: "재비평 진행 중...",                         t: "16:42:31" },
  ]);

  function _cardShell(_doc, opts) {
    const card = _doc.createElement("div");
    card.className = "prod-card" + (opts.extraClass ? " " + opts.extraClass : "");
    card.setAttribute("data-card", opts.id);
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", opts.aria);
    const t = _doc.createElement("div");
    t.className = "prod-card-title";
    t.setAttribute("data-card-slot", "title");
    const ts = _doc.createElement("span");
    ts.textContent = opts.title;
    t.appendChild(ts);
    if (opts.meta) {
      const m = _doc.createElement("span");
      m.className = "prod-card-title-meta";
      m.setAttribute("data-card-slot", "title-meta");
      m.textContent = opts.meta;
      t.appendChild(m);
    }
    card.appendChild(t);
    return card;
  }

  // ── Card body builders ──────────────────────────────────────────
  // Each builder takes its data array as the second arg; pass MOCK_*
  // when no real data is available (UI-P5-c).

  function _buildFindings(_doc, data, mode) {
    const findings = data || MOCK_FINDINGS;
    const isLive = !!data;
    const card = _cardShell(_doc, {
      id: "findings",
      title: "발견 사항 · Findings",
      meta: mode === "pro" ? (isLive ? "5-tier · live" : "5-tier") : null,
      extraClass: "prod-card-findings",
      aria: "발견 사항 — 5단계 심각도별 카운트",
    });
    const grid = _doc.createElement("div");
    grid.className = "prod-findings-grid";
    grid.setAttribute("data-card-slot", "tiers");
    findings.forEach(function (entry) {
      const tier = _doc.createElement("div");
      tier.className = "prod-finding-tier";
      tier.setAttribute("data-tier", entry.tier);
      const count = _doc.createElement("div");
      count.className = "prod-finding-count";
      count.setAttribute("data-card-slot", "count");
      count.setAttribute("data-zero", entry.count === 0 ? "true" : "false");
      count.textContent = String(entry.count);
      tier.appendChild(count);
      const label = _doc.createElement("div");
      label.className = "prod-finding-label";
      label.setAttribute("data-card-slot", "label");
      label.textContent = entry.tier;
      tier.appendChild(label);
      grid.appendChild(tier);
    });
    card.appendChild(grid);
    return card;
  }

  function _buildContext(_doc, data) {
    const ctx = data || MOCK_CONTEXT;
    const pct = ctx.percent;
    const card = _cardShell(_doc, {
      id: "context",
      title: "컨텍스트 · Context",
      meta: Math.round(pct * 100) + "%",
      extraClass: "prod-card-context",
      aria: "컨텍스트 사용량",
    });
    const bar = _doc.createElement("div");
    bar.className = "prod-context-bar-bg";
    bar.setAttribute("data-card-slot", "bar");
    const fill = _doc.createElement("div");
    fill.className = "prod-context-bar-fill";
    fill.setAttribute("data-card-slot", "fill");
    fill.style.width = (pct * 100) + "%";
    bar.appendChild(fill);
    card.appendChild(bar);
    const meta = _doc.createElement("div");
    meta.className = "prod-context-meta";
    meta.setAttribute("data-card-slot", "meta");
    const left = _doc.createElement("span");
    left.setAttribute("data-card-slot", "tokens");
    left.textContent = ctx.used + " / " + ctx.total + " tokens";
    meta.appendChild(left);
    const right = _doc.createElement("span");
    right.className = "prod-context-meta-secondary";
    right.setAttribute("data-card-slot", "remaining");
    right.textContent = ctx.remaining;
    meta.appendChild(right);
    card.appendChild(meta);
    return card;
  }

  function _buildVerify(_doc, data) {
    const v = data || MOCK_VERIFY;
    const card = _cardShell(_doc, {
      id: "verify",
      title: "검증 · Verify",
      meta: null,
      extraClass: "prod-card-verify",
      aria: "검증 게이트 상태",
    });
    card.setAttribute("data-pro-only", "true");
    const row = _doc.createElement("div");
    row.className = "prod-verify-row";
    const dot = _doc.createElement("span");
    dot.className = "prod-verify-dot";
    dot.setAttribute("data-card-slot", "dot");
    dot.setAttribute("data-status", v.status);
    row.appendChild(dot);
    const labels = _doc.createElement("div");
    const primary = _doc.createElement("div");
    primary.className = "prod-verify-label-primary";
    primary.setAttribute("data-card-slot", "label-primary");
    primary.textContent = v.label;
    labels.appendChild(primary);
    const secondary = _doc.createElement("div");
    secondary.className = "prod-verify-label-secondary";
    secondary.setAttribute("data-card-slot", "label-secondary");
    secondary.textContent = v.gates;
    labels.appendChild(secondary);
    row.appendChild(labels);
    card.appendChild(row);
    return card;
  }

  function _buildCodexLive(_doc, liveText) {
    const text = liveText != null ? liveText : MOCK_CODEX_LIVE.text;
    const isLive = liveText != null;
    const card = _cardShell(_doc, {
      id: "codex-live",
      title: "🤖 Codex 라이브 출력",
      meta: isLive ? "live" : MOCK_CODEX_LIVE.model,
      extraClass: "prod-card-codex-live",
      aria: "Codex 실시간 출력 스트림",
    });
    card.setAttribute("data-pro-only", "true");
    const pre = _doc.createElement("pre");
    pre.className = "prod-codex-live-pre";
    pre.setAttribute("data-card-slot", "stream");
    pre.appendChild(_doc.createTextNode(text));
    const caret = _doc.createElement("span");
    caret.className = "prod-codex-caret";
    caret.setAttribute("data-card-slot", "cursor");
    caret.textContent = "▍";
    pre.appendChild(caret);
    card.appendChild(pre);
    return card;
  }

  function _buildSubagents(_doc, data) {
    const agents = data || MOCK_SUBAGENTS;
    const card = _cardShell(_doc, {
      id: "subagents",
      title: "🤝 서브에이전트 · Subagents",
      meta: String(agents.length),
      extraClass: "prod-card-subagents",
      aria: "활성 서브에이전트",
    });
    const row = _doc.createElement("div");
    row.className = "prod-subagent-row";
    row.setAttribute("data-card-slot", "row");
    agents.forEach(function (agent) {
      const pill = _doc.createElement("div");
      pill.className = "prod-subagent-pill";
      pill.setAttribute("data-subagent-id", agent.id);
      pill.setAttribute("data-status", agent.status);
      const dot = _doc.createElement("span");
      dot.className = "prod-subagent-pill-dot";
      pill.appendChild(dot);
      const name = _doc.createElement("span");
      name.setAttribute("data-card-slot", "name");
      name.textContent = agent.name;
      pill.appendChild(name);
      const dur = _doc.createElement("span");
      dur.className = "prod-subagent-pill-dur";
      dur.setAttribute("data-card-slot", "dur");
      dur.textContent = agent.dur;
      pill.appendChild(dur);
      row.appendChild(pill);
    });
    card.appendChild(row);
    return card;
  }

  function _buildToolFeed(_doc, data, mode) {
    const calls = data || MOCK_TOOL_FEED;
    const card = _cardShell(_doc, {
      id: "tools",
      title: "🔧 툴 호출 · Tool Calls",
      meta: String(calls.length),
      extraClass: "prod-card-tools",
      aria: "도구 호출 피드",
    });
    const feed = _doc.createElement("div");
    feed.className = "prod-tool-feed";
    feed.setAttribute("data-card-slot", "feed");
    feed.setAttribute("role", "log");
    feed.setAttribute("aria-live", "polite");
    calls.forEach(function (entry, idx) {
      const row = _doc.createElement("div");
      row.className = "prod-tool-row";
      row.setAttribute("data-line-index", String(idx));
      const time = _doc.createElement("span");
      time.className = "prod-tool-time";
      time.setAttribute("data-card-slot", "time");
      time.textContent = entry.t.slice(3);   // strip "16:" prefix to fit
      row.appendChild(time);
      const tool = _doc.createElement("span");
      tool.className = "prod-tool-name";
      tool.setAttribute("data-tool", entry.tool);
      tool.setAttribute("data-card-slot", "tool");
      tool.textContent = entry.tool;
      row.appendChild(tool);
      const arg = _doc.createElement("span");
      arg.className = "prod-tool-arg";
      arg.setAttribute("data-card-slot", "arg");
      arg.textContent = entry.arg;
      row.appendChild(arg);
      const dur = _doc.createElement("span");
      dur.className = "prod-tool-dur";
      dur.setAttribute("data-card-slot", "dur");
      dur.textContent = entry.dur;
      row.appendChild(dur);
      feed.appendChild(row);
    });
    card.appendChild(feed);
    return card;
  }

  function _buildCritique(_doc, data) {
    const items = data || MOCK_CRITIQUE;
    const card = _cardShell(_doc, {
      id: "critique",
      title: "💬 Critique 타임라인",
      meta: String(items.length),
      extraClass: "prod-card-critique",
      aria: "Codex / Claude 비평 타임라인",
    });
    const stream = _doc.createElement("div");
    stream.className = "prod-critique-stream";
    stream.setAttribute("data-card-slot", "stream");
    stream.setAttribute("role", "log");
    stream.setAttribute("aria-live", "polite");
    items.forEach(function (item, idx) {
      const wrap = _doc.createElement("div");
      wrap.className = "prod-critique-bubble-wrap";
      wrap.setAttribute("data-side", item.side);
      wrap.setAttribute("data-line-index", String(idx));
      const bubble = _doc.createElement("div");
      bubble.className = "prod-critique-bubble";
      bubble.setAttribute("data-side", item.side);
      bubble.setAttribute("data-actor", item.actor.toLowerCase());
      const meta = _doc.createElement("div");
      meta.className = "prod-critique-meta";
      const actor = _doc.createElement("span");
      actor.className = "prod-critique-actor";
      actor.setAttribute("data-card-slot", "actor");
      actor.textContent = item.actor.toUpperCase();
      meta.appendChild(actor);
      const time = _doc.createElement("span");
      time.className = "prod-critique-time";
      time.setAttribute("data-card-slot", "time");
      time.textContent = item.t;
      meta.appendChild(time);
      bubble.appendChild(meta);
      const text = _doc.createElement("div");
      text.className = "prod-critique-text";
      text.setAttribute("data-card-slot", "text");
      text.textContent = item.text;
      bubble.appendChild(text);
      wrap.appendChild(bubble);
      stream.appendChild(wrap);
    });
    card.appendChild(stream);
    return card;
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductMonitorGrid.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductMonitorGrid.create: root + doc required");

    let mode = opts.mode || "simple";
    const store = opts.store || null;
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.HarnessProductShellData)
      || null;

    const grid = _doc.createElement("div");
    grid.className = "prod-grid";
    grid.setAttribute("data-region", "monitor-grid");
    grid.setAttribute("role", "region");
    grid.setAttribute("aria-label", "모니터 그리드");

    function _resolveData() {
      const result = {
        findings: null, context: null, verify: null,
        codexLive: null, subagents: null, tools: null, critique: null,
      };
      if (!store || !selectors) return result;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return result; }
      const runId = selectors.selectActiveRunId(snap);
      result.findings  = selectors.selectFindings(snap, runId);
      result.context   = selectors.selectContextUsage(snap, runId);
      result.verify    = selectors.selectVerifyStatus(snap, runId);
      result.subagents = selectors.selectSubagents(snap, runId);
      result.tools     = selectors.selectRecentToolCalls(snap, runId, 6);
      result.critique  = selectors.selectCritique(snap, runId);
      result.codexLive = selectors.selectCodexLiveTail(snap, runId, 240);
      return result;
    }

    function _renderGrid() {
      const data = _resolveData();
      while (grid.firstChild) grid.removeChild(grid.firstChild);

      const statRow = _doc.createElement("div");
      statRow.className = "prod-grid-stat-row";
      statRow.appendChild(_buildFindings(_doc, data.findings, mode));
      statRow.appendChild(_buildContext(_doc, data.context));
      statRow.appendChild(_buildVerify(_doc, data.verify));
      grid.appendChild(statRow);

      grid.appendChild(_buildCodexLive(_doc, data.codexLive));
      grid.appendChild(_buildSubagents(_doc, data.subagents));

      const bottomRow = _doc.createElement("div");
      bottomRow.className = "prod-grid-bottom-row";
      bottomRow.appendChild(_buildToolFeed(_doc, data.tools, mode));
      bottomRow.appendChild(_buildCritique(_doc, data.critique));
      grid.appendChild(bottomRow);

      _applyMode();
    }

    function _applyMode() {
      const proOnly = grid.querySelectorAll('[data-pro-only="true"]');
      const display = (mode === "pro") ? "" : "none";
      for (let i = 0; i < proOnly.length; i++) {
        proOnly[i].style.display = display;
      }
    }

    _renderGrid();

    let unsubscribe = null;
    if (store && typeof store.subscribe === "function") {
      try { unsubscribe = store.subscribe(_renderGrid); }
      catch (_) { /* defensive */ }
    }

    root.appendChild(grid);

    return {
      destroy: function () {
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        if (grid.parentNode === root) {
          try { root.removeChild(grid); } catch (_) {}
        }
      },
      setMode: function (next) {
        if (next === "simple" || next === "pro") {
          mode = next;
          _renderGrid(); // mode flag affects card meta + visibility
        }
      },
      _state: function () {
        const data = _resolveData();
        return {
          mode,
          cards: ["findings", "context", "verify", "codex-live", "subagents", "tools", "critique"],
          live: {
            findings: data.findings != null,
            context: data.context != null,
            verify: data.verify != null,
            codexLive: data.codexLive != null,
            subagents: data.subagents != null,
            tools: data.tools != null,
            critique: data.critique != null,
          },
        };
      },
    };
  }

  return {
    create,
    MOCK_FINDINGS,
    MOCK_CONTEXT,
    MOCK_VERIFY,
    MOCK_CODEX_LIVE,
    MOCK_SUBAGENTS,
    MOCK_TOOL_FEED,
    MOCK_CRITIQUE,
  };
});
