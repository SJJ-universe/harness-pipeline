// Slice UI-P1-f / UI-P2-d / UI-P4-c (Phase 2 Round 3, 2026-04-30) — dual terminals.
//
// Renders the bottom 280px dual-terminal strip per the reference.
// UI-P1 shipped tab bar + empty bodies, UI-P2 added title pill +
// auto/clear + caret line. UI-P4 fills each tab body with realistic
// mock lines that mirror the reference's CLAUDE_LINES / CODEX_LINES /
// BASH_LINES / VERIFY_LINES exactly. Slot attributes pin the wire-up
// contract for UI-P5 / UI-P6 (real Claude / Codex / Bash / Verifier
// streams from the review-session manager).
//
// Slot attributes (UI-P5/P6 wiring contract):
//   data-region="dual-terminals"
//   data-terminal-side="left|right"
//     data-terminal-slot="tabs|body|spacer|title-pill"
//     data-tab=<id>            — per-tab tab button
//     data-actor="claude|codex|bash|verifier"
//     data-control="auto|clear"
//     data-line-index          — body content row
//     data-line-actor          — line-level actor (matches color)
//
// Mode behavior:
//   - simple: per-line timestamps hidden via CSS
//   - pro: timestamps visible

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductDualTerminals = api;
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
      { t: "16:42:15", text: "> sj-harness@2.5.0 test", color: "var(--prod-text-dim-60)" },
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

  function _terminal(_doc, side, tabs, defaultTab) {
    const term = _doc.createElement("div");
    term.className = "prod-terminal";
    term.setAttribute("data-terminal-side", side);
    term.setAttribute("role", "region");
    term.setAttribute("aria-label", side === "left" ? "Claude / Bash 터미널" : "Codex / Verifier 터미널");

    let activeTab = defaultTab;
    let autoScroll = true;

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
      _renderBody({ cleared: true });
    });
    spacer.appendChild(clearBtn);

    tabBar.appendChild(spacer);
    term.appendChild(tabBar);

    const body = _doc.createElement("div");
    body.className = "prod-terminal-body";
    body.setAttribute("data-terminal-slot", "body");
    body.setAttribute("role", "log");
    body.setAttribute("aria-live", "polite");
    term.appendChild(body);

    function _renderBody(renderOpts) {
      const cleared = renderOpts && renderOpts.cleared;
      const tab = _findTab(activeTab);
      titlePill.textContent = tab.title;
      autoBtn.setAttribute("data-actor", tab.actor);
      while (body.firstChild) body.removeChild(body.firstChild);

      if (cleared) {
        const empty = _doc.createElement("div");
        empty.className = "prod-terminal-empty";
        empty.setAttribute("data-card-slot", "empty");
        empty.textContent = "(cleared)";
        body.appendChild(empty);
      } else {
        // UI-P4: render mock lines for this tab
        const lines = MOCK_LINES[tab.id] || [];
        lines.forEach(function (line, idx) {
          body.appendChild(_renderLine(_doc, line, idx, tab));
        });
      }

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
    };
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductDualTerminals.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductDualTerminals.create: root + doc required");

    const wrap = _doc.createElement("div");
    wrap.className = "prod-terminals";
    wrap.setAttribute("data-region", "dual-terminals");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "듀얼 터미널 (Claude / Codex 스트림)");

    const left = _terminal(_doc, "left", TABS_LEFT, "claude");
    const right = _terminal(_doc, "right", TABS_RIGHT, "codex");
    wrap.appendChild(left.el);
    wrap.appendChild(right.el);

    root.appendChild(wrap);

    return {
      destroy: function () {
        if (wrap.parentNode === root) {
          try { root.removeChild(wrap); } catch (_) {}
        }
      },
      setMode: function () { /* mode is CSS-driven only */ },
      _state: function () {
        return {
          left: left.getActiveTab(),
          right: right.getActiveTab(),
        };
      },
    };
  }

  return {
    create,
    TABS_LEFT,
    TABS_RIGHT,
    MOCK_LINES,
  };
});
