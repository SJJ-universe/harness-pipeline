// Slice UI-P1-f / UI-P2-d / UI-P4-c / UI-P6 (Phase 2 Round 3, 2026-04-30)
//                                                          — dual terminals.
//
// Renders the bottom 280px dual-terminal strip per the reference, plus
// the UI-P6 review-relay action row that turns the read-only stream
// view into a controllable Claude ↔ Codex critique loop.
//
// What ships per round:
//   UI-P1: tab bar + empty bodies
//   UI-P2: title pill + auto/clear + caret line
//   UI-P4: realistic mock lines per tab (CLAUDE_LINES / CODEX_LINES /
//                                        BASH_LINES / VERIFY_LINES)
//   UI-P6: structured action row at the bottom (start / send-codex /
//          follow-up / hand-back / archive) + posture-aware Claude
//          hand-back hide + live stream chunks override mock when an
//          active review session has chunks for the active tab's actor
//
// Slot attributes (UI-P5/P6 wiring contract):
//   data-region="dual-terminals" / "dual-terminals-actions"
//   data-terminal-side="left|right"
//     data-terminal-slot="tabs|body|spacer|title-pill"
//     data-tab=<id>            — per-tab tab button
//     data-actor="claude|codex|bash|verifier"
//     data-control="auto|clear"
//     data-stream-source="live|mock"  — body-level marker (UI-P6)
//     data-line-index          — body content row
//     data-line-actor          — line-level actor (matches color)
//   data-actions-slot="indicator|buttons|posture-badge"
//   data-action-id="start|send-codex|followup-codex|hand-back|archive"
//
// Mode behavior:
//   - simple: per-line timestamps hidden via CSS
//   - pro: timestamps visible
//
// Backward compat:
//   - When no `client` prop is supplied, the action row is omitted
//     and the panel keeps its UI-P4 mock-only behavior. Tests that
//     don't care about the action row stay unchanged.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductDualTerminals = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const TABS_LEFT = Object.freeze([
    { id: "claude",   label: "Claude",   actor: "claude", title: "Claude · Plan & Execute", prompt: "◇" },
    { id: "bash",     label: "Bash",     actor: "claude", title: "Bash · Local Shell",      prompt: "$" },
  ]);
  const TABS_RIGHT = Object.freeze([
    { id: "codex",    label: "Codex",    actor: "codex",  title: "Codex · Critique Stream", prompt: "◈" },
    { id: "verifier", label: "Verifier", actor: "codex",  title: "Verifier · Test Output",  prompt: "►" },
  ]);

  // UI-P4 mock lines per tab — match reference terminals.jsx arrays
  // exactly so first-paint demo looks like a real run.
  const MOCK_LINES = Object.freeze({
    claude: Object.freeze([
      { t: "16:41:48", prompt: "◇", text: "계획 수립 시작 — Express 서버 JWT 인증 미들웨어" },
      { t: "16:41:50", text: "↳ 작업을 4개 단계로 분해합니다.", color: "var(--prod-text-dim-60)" },
      { t: "16:41:51", text: "  1. JWT 라이브러리 의존성 추가 (jsonwebtoken)", color: "var(--prod-text-dim-65)" },
      { t: "16:41:51", text: "  2. /src/auth/middleware.ts 생성", color: "var(--prod-text-dim-65)" },
      { t: "16:41:51", text: "  3. /admin 라우트에 미들웨어 적용", color: "var(--prod-text-dim-65)" },
      { t: "16:41:52", text: "  4. 통합 테스트 작성 (auth.spec.ts)", color: "var(--prod-text-dim-65)" },
      { t: "16:42:00", prompt: "◇", text: "플랜 v1 완료. Codex로 비평 요청 →", color: "var(--prod-bronze)" },
      { t: "16:42:18", prompt: "◇", text: "비평 수신. high 1건 반영 — 시크릿 로테이션 정책 추가" },
      { t: "16:42:24", prompt: "◇", text: "플랜 v2 게시. 미들웨어 순서 교정 (cors 이전 등록)" },
      { t: "16:42:30", prompt: "◇", text: "재비평 대기 중...", color: "var(--prod-text-dim-60)" },
    ]),
    codex: Object.freeze([
      { t: "16:42:01", prompt: "◈", text: "플랜 v1 수신. 정적 분석 + 보안 감사 시작." },
      { t: "16:42:08", text: "✗ JWT secret 로테이션 정책 명시되지 않음", color: "var(--prod-orange)" },
      { t: "16:42:08", text: "  └ severity: high · 권장: 24h TTL + Redis 무효화", color: "var(--prod-text-dim-60)" },
      { t: "16:42:14", text: "✗ /src/server.ts 미들웨어 등록 순서 부적절", color: "var(--prod-yellow)" },
      { t: "16:42:14", text: "  └ severity: medium · cors 이전에 auth 적용 필요", color: "var(--prod-text-dim-60)" },
      { t: "16:42:16", prompt: "◈", text: "비평 v1 발행. critical 0 / high 1 / medium 1.", color: "var(--prod-blue)" },
      { t: "16:42:25", prompt: "◈", text: "플랜 v2 수신. 재검증 시작." },
      { t: "16:42:31", text: "› 시크릿 로테이션 검토 중...", color: "var(--prod-text-dim-60)" },
      { t: "16:42:33", text: "› 미들웨어 순서 검증 중...", color: "var(--prod-text-dim-60)" },
    ]),
    bash: Object.freeze([
      { t: "16:42:14", prompt: "$", text: "npm test -- auth.spec.ts" },
      { t: "16:42:15", text: "> sj-orchestrator@2.5.0 test", color: "var(--prod-text-dim-60)" },
      { t: "16:42:15", text: "> jest auth.spec.ts", color: "var(--prod-text-dim-60)" },
      { t: "16:42:16", text: " PASS  src/auth/__tests__/auth.spec.ts", color: "var(--prod-green)" },
      { t: "16:42:16", text: "  ✓ rejects request without token (12 ms)", color: "var(--prod-text-dim-65)" },
      { t: "16:42:16", text: "  ✓ accepts valid JWT (8 ms)", color: "var(--prod-text-dim-65)" },
      { t: "16:42:16", text: "  ✓ rejects expired token (6 ms)", color: "var(--prod-text-dim-65)" },
      { t: "16:42:17", text: "Tests:       3 passed, 3 total", color: "var(--prod-green)" },
      { t: "16:42:17", text: "Time:        2.1s", color: "var(--prod-text-dim-60)" },
    ]),
    verifier: Object.freeze([
      { t: "16:42:30", prompt: "►", text: "Verifier 시작 — gate set: lint, test, audit, type" },
      { t: "16:42:31", text: "[1/4] lint ............................... PASS", color: "var(--prod-green)" },
      { t: "16:42:32", text: "[2/4] test ............................... PASS", color: "var(--prod-green)" },
      { t: "16:42:33", text: "[3/4] audit (npm audit --audit-level=high) PASS", color: "var(--prod-green)" },
      { t: "16:42:34", text: "[4/4] type (tsc --noEmit) ................ ...", color: "var(--prod-text-dim-60)" },
    ]),
  });

  // UI-P6: state labels mirror dual-agent-console for consistency.
  // UI-P7: each entry now carries an i18n key + Korean fallback. The
  // create() closure builds a t() helper from window.OrchestratorI18n (or
  // an injected stub for tests) and looks up keys at render time.
  const STATE_LABELS = Object.freeze({
    created:           { key: "prod.terminals.state.created",           fallback: "준비됨" },
    awaiting_critique: { key: "prod.terminals.state.awaiting_critique", fallback: "Codex 비평 대기" },
    critique_received: { key: "prod.terminals.state.critique_received", fallback: "비평 도착" },
    awaiting_claude:   { key: "prod.terminals.state.awaiting_claude",   fallback: "Claude 반영 대기" },
    claude_received:   { key: "prod.terminals.state.claude_received",   fallback: "Claude 반영 완료" },
    archived:          { key: "prod.terminals.state.archived",          fallback: "보관됨" },
  });

  function _stateLabel(state, t) {
    const entry = STATE_LABELS[state];
    if (!entry) return state || "-";
    return t ? t(entry.key, entry.fallback) : entry.fallback;
  }

  // UI-P7: action row spec — id → i18n key + fallback for label/title.
  // Frozen so test fixtures + visual regression tooling can iterate
  // it without it drifting silently.
  const ACTION_LABELS = Object.freeze({
    "start":           { labelKey: "prod.terminals.action.start",         labelFallback: "+ 세션 시작",
                         titleKey: "prod.terminals.action.start.title",   titleFallback: "새 review session 시작" },
    "send-codex":      { labelKey: "prod.terminals.action.sendCodex",     labelFallback: "→ Codex 비평 요청",
                         titleKey: "prod.terminals.action.sendCodex.title", titleFallback: "Claude 작업물을 Codex에 비평 요청" },
    "followup-codex":  { labelKey: "prod.terminals.action.followUpCodex", labelFallback: "? Codex에 추가 질문",
                         titleKey: "prod.terminals.action.followUpCodex.title", titleFallback: "Codex에게 추가 질문" },
    "hand-back":       { labelKey: "prod.terminals.action.handBack",      labelFallback: "→ Claude에게 반영 요청",
                         titleKey: "prod.terminals.action.handBack.title", titleFallback: "Codex 비평을 Claude로 hand-back" },
    "archive":         { labelKey: "prod.terminals.action.archive",       labelFallback: "⏏ 세션 보관",
                         titleKey: "prod.terminals.action.archive.title", titleFallback: "현재 세션을 archive로 이동" },
  });

  function _formatTs(ts) {
    if (typeof ts === "string") return ts.length >= 19 ? ts.slice(11, 19) : ts;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return "—:—:—";
    try {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return hh + ":" + mm + ":" + ss;
    } catch (_) { return "—:—:—"; }
  }

  function _renderLine(_doc, line, idx, tab) {
    const row = _doc.createElement("div");
    row.className = "prod-terminal-line";
    row.setAttribute("data-line-index", String(idx));
    row.setAttribute("data-line-actor", tab.actor);
    if (line.color) row.style.color = line.color;
    const time = _doc.createElement("span");
    time.className = "prod-terminal-line-time";
    time.setAttribute("data-card-slot", "time");
    time.textContent = line.t || "";
    row.appendChild(time);
    const text = _doc.createElement("span");
    text.className = "prod-terminal-line-text";
    text.setAttribute("data-card-slot", "text");
    if (line.prompt) {
      const prompt = _doc.createElement("span");
      prompt.className = "prod-terminal-prompt";
      prompt.setAttribute("data-actor", tab.actor);
      prompt.textContent = line.prompt + " ";
      text.appendChild(prompt);
    }
    text.appendChild(_doc.createTextNode(line.text));
    row.appendChild(text);
    return row;
  }

  function _renderCaretLine(_doc, tab) {
    const row = _doc.createElement("div");
    row.className = "prod-terminal-line";
    row.setAttribute("data-line-actor", tab.actor);
    row.setAttribute("data-card-slot", "caret-line");
    const time = _doc.createElement("span");
    time.className = "prod-terminal-line-time";
    time.textContent = "16:42:35";
    row.appendChild(time);
    const text = _doc.createElement("span");
    text.className = "prod-terminal-line-text";
    const prompt = _doc.createElement("span");
    prompt.className = "prod-terminal-prompt";
    prompt.setAttribute("data-actor", tab.actor);
    prompt.textContent = tab.prompt + " ";
    text.appendChild(prompt);
    const cursor = _doc.createElement("span");
    cursor.className = "prod-terminal-cursor";
    cursor.setAttribute("data-actor", tab.actor);
    text.appendChild(cursor);
    row.appendChild(text);
    return row;
  }

  // UI-P6: build mock-style line objects from real chunk data so the
  // existing _renderLine path can render them unchanged. Each chunk
  // becomes ONE line; we squash newlines so terminal-style wrapping
  // stays consistent with the mock view.
  function _chunksToLines(chunks, prompt) {
    return chunks.map(function (c) {
      return {
        t: _formatTs(c.ts),
        prompt: prompt,
        text: String(c.text || "").replace(/\r?\n/g, " ⏎ "),
      };
    });
  }

  function _terminal(_doc, side, tabs, defaultTab, opts) {
    const term = _doc.createElement("div");
    term.className = "prod-terminal";
    term.setAttribute("data-terminal-side", side);
    term.setAttribute("role", "region");
    term.setAttribute("aria-label", side === "left" ? "Claude / Bash 터미널" : "Codex / Verifier 터미널");

    let activeTab = defaultTab;
    let autoScroll = true;
    let cleared = false;
    const allowMockData = !opts || opts.allowMockData !== false;

    function _findTab(id) {
      for (let i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
      return tabs[0];
    }

    const tabBar = _doc.createElement("div");
    tabBar.className = "prod-terminal-tabs";
    tabBar.setAttribute("role", "tablist");
    tabBar.setAttribute("data-terminal-slot", "tabs");
    const tabButtons = {};

    tabs.forEach(function (tab) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-terminal-tab";
      btn.setAttribute("data-actor", tab.actor);
      btn.setAttribute("data-tab", tab.id);
      btn.setAttribute("aria-selected", tab.id === activeTab ? "true" : "false");
      btn.setAttribute("role", "tab");
      const dot = _doc.createElement("span");
      dot.className = "prod-terminal-tab-dot";
      btn.appendChild(dot);
      btn.appendChild(_doc.createTextNode(tab.label));
      btn.addEventListener("click", function () {
        if (tab.id === activeTab) return;
        activeTab = tab.id;
        cleared = false;
        Object.keys(tabButtons).forEach(function (k) {
          tabButtons[k].setAttribute("aria-selected", k === activeTab ? "true" : "false");
        });
        _renderBody();
      });
      tabButtons[tab.id] = btn;
      tabBar.appendChild(btn);
    });

    const spacer = _doc.createElement("div");
    spacer.className = "prod-terminal-tabs-spacer";
    spacer.setAttribute("data-terminal-slot", "spacer");
    const titlePill = _doc.createElement("span");
    titlePill.className = "prod-terminal-title-pill";
    titlePill.setAttribute("data-terminal-slot", "title-pill");
    titlePill.textContent = _findTab(activeTab).title;
    spacer.appendChild(titlePill);

    const autoBtn = _doc.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "prod-terminal-control-btn";
    autoBtn.setAttribute("data-control", "auto");
    autoBtn.setAttribute("data-active", "true");
    autoBtn.setAttribute("data-actor", _findTab(activeTab).actor);
    autoBtn.textContent = "auto";
    autoBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      autoBtn.setAttribute("data-active", autoScroll ? "true" : "false");
    });
    spacer.appendChild(autoBtn);

    const clearBtn = _doc.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "prod-terminal-control-btn";
    clearBtn.setAttribute("data-control", "clear");
    clearBtn.setAttribute("data-active", "false");
    clearBtn.textContent = "clear";
    clearBtn.addEventListener("click", function () {
      cleared = true;
      _renderBody();
    });
    spacer.appendChild(clearBtn);

    tabBar.appendChild(spacer);
    term.appendChild(tabBar);

    const body = _doc.createElement("div");
    body.className = "prod-terminal-body";
    body.setAttribute("data-terminal-slot", "body");
    body.setAttribute("role", "log");
    body.setAttribute("aria-live", "polite");
    body.setAttribute("data-stream-source", allowMockData ? "mock" : "empty");
    term.appendChild(body);

    function _renderBody() {
      const tab = _findTab(activeTab);
      titlePill.textContent = tab.title;
      autoBtn.setAttribute("data-actor", tab.actor);
      while (body.firstChild) body.removeChild(body.firstChild);

      // UI-P6: try live stream chunks first when wired up. Only the
      // "claude" and "codex" tabs participate in the review relay;
      // bash + verifier remain mock until UI-P7 wires real PTY +
      // verifier output.
      let lines = null;
      let source = "mock";
      if (!cleared && opts && opts.resolveLiveLines) {
        try {
          const live = opts.resolveLiveLines(tab.id);
          if (Array.isArray(live) && live.length > 0) {
            lines = live;
            source = "live";
          }
        } catch (_) { /* defensive */ }
      }
      if (cleared) {
        const empty = _doc.createElement("div");
        empty.className = "prod-terminal-empty";
        empty.setAttribute("data-card-slot", "empty");
        empty.textContent = "(cleared)";
        body.appendChild(empty);
      } else {
        if (!lines && allowMockData) lines = MOCK_LINES[tab.id] || [];
        if (!lines) {
          source = "empty";
          const empty = _doc.createElement("div");
          empty.className = "prod-terminal-empty";
          empty.setAttribute("data-card-slot", "empty");
          empty.textContent = "No live stream yet.";
          body.appendChild(empty);
        } else {
          lines.forEach(function (line, idx) {
            body.appendChild(_renderLine(_doc, line, idx, tab));
          });
        }
      }
      body.setAttribute("data-stream-source", source);

      // Always-visible final caret line
      body.appendChild(_renderCaretLine(_doc, tab));
    }

    _renderBody();

    return {
      el: term,
      getActiveTab: function () { return activeTab; },
      setActiveTab: function (id) {
        const btn = tabButtons[id];
        if (btn) btn.click();
      },
      rerender: _renderBody,
    };
  }

  // ── UI-P6: review-relay action row ────────────────────────────────

  function _renderActionRow(_doc, ctx) {
    // ctx: { activeSession, posture, inFlight, handlers, t }
    const t = ctx.t || function (_k, fb) { return fb; };
    const row = _doc.createElement("div");
    row.className = "prod-terminals-actions";
    row.setAttribute("data-region", "dual-terminals-actions");
    row.setAttribute("role", "toolbar");
    row.setAttribute("aria-label", t("prod.aria.actionRow", "Review relay actions"));

    // Section A: indicator
    const indicator = _doc.createElement("span");
    indicator.className = "prod-actions-indicator";
    indicator.setAttribute("data-actions-slot", "indicator");
    if (ctx.activeSession) {
      const sid = ctx.activeSession.sessionId || ctx.activeSession.id || "";
      const label = ctx.activeSession.label || ("세션 " + String(sid).slice(0, 8));
      indicator.setAttribute("data-state", ctx.activeSession.state || "unknown");
      indicator.textContent = "🔗 " + label + " · " + _stateLabel(ctx.activeSession.state, t);
    } else {
      indicator.setAttribute("data-state", "none");
      indicator.textContent = t("prod.terminals.session.none", "🔗 세션 없음");
    }
    row.appendChild(indicator);

    // Section B: button group
    const buttons = _doc.createElement("span");
    buttons.className = "prod-actions-buttons";
    buttons.setAttribute("data-actions-slot", "buttons");

    const session = ctx.activeSession;
    const state = session ? session.state : null;
    const inFlight = session && ctx.inFlight && ctx.inFlight.has(session.sessionId || session.id);

    function _btn(spec) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-actions-btn prod-actions-btn-" + spec.id;
      btn.setAttribute("data-action-id", spec.id);
      if (spec.title) btn.setAttribute("title", spec.title);
      btn.textContent = spec.label;
      if (spec.disabled) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
        btn.classList.add("is-disabled");
      } else if (typeof spec.action === "function") {
        btn.addEventListener("click", function () {
          try { spec.action(); } catch (e) { ctx.handlers.onError(e); }
        });
      }
      return btn;
    }

    // Helper that pulls i18n label/title for a given action id.
    function _spec(id) {
      const a = ACTION_LABELS[id] || {};
      return {
        label: t(a.labelKey, a.labelFallback),
        title: t(a.titleKey, a.titleFallback),
      };
    }

    // Start session — always available
    let s = _spec("start");
    buttons.appendChild(_btn({
      id: "start",
      label: s.label, title: s.title,
      disabled: false,
      action: function () { ctx.handlers.onStart(); },
    }));

    // Send to Codex
    const canSendToCodex = !!session && (
      state === "created" || state === "critique_received" || state === "claude_received"
    );
    s = _spec("send-codex");
    buttons.appendChild(_btn({
      id: "send-codex",
      label: s.label, title: s.title,
      disabled: !canSendToCodex || !!inFlight,
      action: function () { ctx.handlers.onSendCodex(session); },
    }));

    // Follow-up Codex
    const canFollowUpCodex = !!session && state !== "created" && state !== "archived";
    s = _spec("followup-codex");
    buttons.appendChild(_btn({
      id: "followup-codex",
      label: s.label, title: s.title,
      disabled: !canFollowUpCodex || !!inFlight,
      action: function () { ctx.handlers.onFollowUp(session); },
    }));

    // Hand back to Claude — hidden when posture blocks local executor.
    if (!ctx.posture || !ctx.posture.localExecutorBlocked) {
      const canHandBack = !!session && state === "critique_received";
      s = _spec("hand-back");
      buttons.appendChild(_btn({
        id: "hand-back",
        label: s.label, title: s.title,
        disabled: !canHandBack || !!inFlight,
        action: function () { ctx.handlers.onHandBack(session); },
      }));
    }

    // Archive
    const canArchive = !!session && state !== "archived";
    s = _spec("archive");
    buttons.appendChild(_btn({
      id: "archive",
      label: s.label, title: s.title,
      disabled: !canArchive,
      action: function () { ctx.handlers.onArchive(session); },
    }));

    row.appendChild(buttons);

    // Section C: posture badge — only when local Claude blocked.
    if (ctx.posture && ctx.posture.localExecutorBlocked) {
      const badge = _doc.createElement("span");
      badge.className = "prod-actions-posture-badge";
      badge.setAttribute("data-actions-slot", "posture-badge");
      badge.setAttribute("data-posture", "public-sector");
      badge.textContent = t("prod.terminals.posture.publicSector",
        "🛡 공공기관 모드 — 로컬 Claude 실행 차단");
      row.appendChild(badge);
    }

    return row;
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("OrchestratorProductDualTerminals.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("OrchestratorProductDualTerminals.create: root + doc required");

    const store = opts.store || null;
    const client = opts.client || null;
    const allowMockData = opts.allowMockData !== false;
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.OrchestratorProductShellData)
      || null;
    // UI-P7: i18n integration. Tests inject opts.i18n or omit it
    // entirely (returns Korean fallbacks); browser auto-resolves
    // window.OrchestratorI18n. _t() returns the translation when valid,
    // the fallback otherwise.
    let i18n = opts.i18n
      || (typeof window !== "undefined" && window.OrchestratorI18n)
      || null;
    function _t(key, fallback) {
      if (i18n && typeof i18n.t === "function") {
        try {
          const val = i18n.t(key);
          if (typeof val === "string" && val.length > 0 && val !== key) return val;
        } catch (_) { /* defensive */ }
      }
      return fallback;
    }
    const _onError = typeof opts.onError === "function" ? opts.onError : function (err) {
      try { console.warn("[product-dual-terminals]", err && err.message ? err.message : err); }
      catch (_) {}
    };
    const _prompt = typeof opts.promptFn === "function"
      ? opts.promptFn
      : (typeof window !== "undefined" && typeof window.prompt === "function"
          ? window.prompt.bind(window) : null);
    const _confirm = typeof opts.confirmFn === "function"
      ? opts.confirmFn
      : (typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm.bind(window) : null);

    // UI-P6: in-flight tracking so duplicate clicks don't fire parallel
    // requests while a session is mid-action.
    const inFlight = new Set();

    // Outer wrap holds the two terminals (top) + action row (bottom).
    const wrap = _doc.createElement("div");
    wrap.className = "prod-terminals-wrap";
    wrap.setAttribute("data-region", "dual-terminals");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", _t("prod.aria.dualTerminals", "듀얼 터미널 (Claude / Codex 스트림)"));

    const terminals = _doc.createElement("div");
    terminals.className = "prod-terminals";
    terminals.setAttribute("data-region-slot", "terminals");
    wrap.appendChild(terminals);

    function _resolveActiveSession() {
      if (!store || !selectors) return null;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return null; }
      const runId = (typeof selectors.selectActiveRunId === "function")
        ? selectors.selectActiveRunId(snap) : null;
      if (typeof selectors.selectActiveReviewSession !== "function") return null;
      return selectors.selectActiveReviewSession(snap, runId) || null;
    }

    function _resolvePosture() {
      if (!store || !selectors || typeof selectors.selectDeploymentPosture !== "function") {
        return { publicSector: false, allowLocalExecutor: true, localExecutorBlocked: false };
      }
      try { return selectors.selectDeploymentPosture(store.snapshot()); }
      catch (_) {
        return { publicSector: false, allowLocalExecutor: true, localExecutorBlocked: false };
      }
    }

    // Per-terminal live-line resolver. Returns array or null.
    function _resolveLiveLines(tabId) {
      if (!store || !selectors) return null;
      if (tabId !== "claude" && tabId !== "codex") return null;
      const session = _resolveActiveSession();
      if (!session) return null;
      const sid = session.sessionId || session.id;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return null; }
      if (typeof selectors.selectReviewStreamChunks !== "function") return null;
      const chunks = selectors.selectReviewStreamChunks(snap, sid, tabId);
      if (!chunks || chunks.length === 0) return null;
      return _chunksToLines(chunks, tabId === "claude" ? "◇" : "◈");
    }

    const left = _terminal(_doc, "left", TABS_LEFT, "claude", {
      resolveLiveLines: _resolveLiveLines,
      allowMockData: allowMockData,
    });
    const right = _terminal(_doc, "right", TABS_RIGHT, "codex", {
      resolveLiveLines: _resolveLiveLines,
      allowMockData: allowMockData,
    });
    terminals.appendChild(left.el);
    terminals.appendChild(right.el);

    // UI-P6: action row only when client is wired. Tests + UI-P4
    // callers without a client get the original mock-only view.
    let actionRowEl = null;
    function _renderActionRowIfNeeded() {
      if (!client) return;
      // PRODUCT-LIVE-STREAM-0 Gap G: when the active session is a
      // synthetic projection from the general-task pipeline (tagged
      // streamOnly: true by legacy-bridge._syncGeneralStreamFromEvent),
      // the review-relay action row would point at a session id that
      // doesn't exist on the server (e.g. "general:gr-...") — the
      // buttons (Start session / Send to Codex / Follow up / Hand
      // back / Archive) would all hit 404. Skip the row entirely so
      // those buttons aren't even visible. The terminals themselves
      // still stream content; only the action row is suppressed.
      const _active = _resolveActiveSession && _resolveActiveSession();
      if (_active && _active.streamOnly) {
        if (actionRowEl && actionRowEl.parentNode === wrap) {
          try { wrap.removeChild(actionRowEl); } catch (_) {}
          actionRowEl = null;
        }
        return;
      }
      if (actionRowEl && actionRowEl.parentNode === wrap) {
        try { wrap.removeChild(actionRowEl); } catch (_) {}
      }
      const ctx = {
        activeSession: _resolveActiveSession(),
        posture: _resolvePosture(),
        inFlight: inFlight,
        t: _t,
        handlers: {
          onError: _onError,
          onStart: _onStartSession,
          onSendCodex: _onSendToCodex,
          onFollowUp: _onFollowUp,
          onHandBack: _onHandBack,
          onArchive: _onArchive,
        },
      };
      actionRowEl = _renderActionRow(_doc, ctx);
      wrap.appendChild(actionRowEl);
    }

    function _askInstruction(message) {
      if (typeof _prompt !== "function") {
        _onError(new Error("instruction prompt unavailable in this environment"));
        return null;
      }
      const v = _prompt(message);
      if (typeof v !== "string" || v.trim().length === 0) return null;
      return v.trim();
    }

    function _markInFlight(sessionId) { inFlight.add(sessionId); _renderActionRowIfNeeded(); }
    function _clearInFlight(sessionId) { inFlight.delete(sessionId); _renderActionRowIfNeeded(); }

    async function _onStartSession() {
      const label = _askInstruction("새 review session 이름을 입력하세요:");
      if (label === null) return;
      let snap = null;
      try { snap = store && store.snapshot(); } catch (_) {}
      const runId = (snap && snap.selectedRunId) || (snap && selectors
        && typeof selectors.selectActiveRunId === "function"
          ? selectors.selectActiveRunId(snap) : null);
      try {
        await client.createSession({
          label: label, runId: runId, source: runId ? "selected_run" : "manual",
          store: store, select: true,
        });
      } catch (err) { _onError(err); }
    }

    async function _onSendToCodex(session) {
      if (!session) return;
      const sid = session.sessionId || session.id;
      const instruction = _askInstruction(
        "Codex에 어떤 비평을 요청합니까? (예: '보안 검토', '효율성 분석'):"
      );
      if (instruction === null) return;
      _markInFlight(sid);
      try {
        await client.sendToCodex(sid, { instruction: instruction, store: store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(sid); }
    }

    async function _onFollowUp(session) {
      if (!session) return;
      const sid = session.sessionId || session.id;
      const question = _askInstruction("Codex에 추가 질문:");
      if (question === null) return;
      _markInFlight(sid);
      try {
        await client.followUp(sid, { question: question, target: "codex", store: store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(sid); }
    }

    async function _onHandBack(session) {
      if (!session) return;
      const sid = session.sessionId || session.id;
      const instruction = _askInstruction("Claude에 어떤 수정을 요청합니까?");
      if (instruction === null) return;
      _markInFlight(sid);
      try {
        await client.handBackToClaude(sid, { instruction: instruction, store: store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(sid); }
    }

    async function _onArchive(session) {
      if (!session) return;
      const sid = session.sessionId || session.id;
      const ok = (typeof _confirm === "function")
        ? _confirm("'" + (session.label || sid) + "' 세션을 보관할까요?")
        : true;
      if (!ok) return;
      _markInFlight(sid);
      try {
        if (typeof client.archiveSession === "function") {
          await client.archiveSession(sid, { reason: "operator-archive", store: store });
        } else if (store && typeof store.upsertReviewSession === "function") {
          store.upsertReviewSession(sid, {
            state: "archived", archivedAt: Date.now(), archiveReason: "operator-archive",
          });
        }
      } catch (err) { _onError(err); }
      finally { _clearInFlight(sid); }
    }

    // UI-P6: subscribe to store so chunk arrival re-renders terminals
    // AND action row (state transitions hide/enable buttons).
    function _onStoreChange() {
      try { left.rerender(); } catch (_) {}
      try { right.rerender(); } catch (_) {}
      _renderActionRowIfNeeded();
    }

    let unsubscribe = null;
    if (store && typeof store.subscribe === "function") {
      try { unsubscribe = store.subscribe(_onStoreChange); }
      catch (_) { /* defensive */ }
    }

    _renderActionRowIfNeeded();
    root.appendChild(wrap);

    return {
      destroy: function () {
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        if (wrap.parentNode === root) {
          try { root.removeChild(wrap); } catch (_) {}
        }
      },
      setMode: function () { /* mode is CSS-driven only */ },
      // UI-P7: locale propagation. Triggers a fresh action-row render
      // so labels/titles + posture badge pick up the new translations
      // (OrchestratorI18n.setLang already updated the table). The two
      // terminal bodies (left/right) are mock or live stream content
      // — neither needs locale, but rerender keeps caret + tabs in
      // sync with any DOM mutation that happened during the swap.
      setLocale: function (l) {
        const next = (l === "en") ? "en" : "ko";
        // refresh i18n reference in case window.OrchestratorI18n was lazily
        // loaded after create() — defensive, harmless when stub.
        if (!opts.i18n && typeof window !== "undefined" && window.OrchestratorI18n) {
          i18n = window.OrchestratorI18n;
        }
        try { wrap.setAttribute("aria-label", _t("prod.aria.dualTerminals", "듀얼 터미널 (Claude / Codex 스트림)")); } catch (_) {}
        // Re-render action row + terminal bodies (cheap rebuild).
        _onStoreChange();
        // Suppress unused-arg lint
        return next;
      },
      _state: function () {
        return {
          left: left.getActiveTab(),
          right: right.getActiveTab(),
          inFlightCount: inFlight.size,
          hasActionRow: actionRowEl !== null,
        };
      },
      // Test hooks
      _activeSession: function () { return _resolveActiveSession(); },
      _posture: function () { return _resolvePosture(); },
      _rerender: _onStoreChange,
    };
  }

  return {
    create,
    TABS_LEFT,
    TABS_RIGHT,
    MOCK_LINES,
    STATE_LABELS,
  };
});
