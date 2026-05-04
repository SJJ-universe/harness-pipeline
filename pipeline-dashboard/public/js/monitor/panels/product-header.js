// Slice UI-P1-e (Phase 2 Round 3, 2026-04-30) — product header (52px).
//
// Top header band of the product shell. Mirrors the reference HTML's
// Header layout pixel-by-pixel:
//
//   ◇ SJ Harness · v2.4.0 · [실행 중]    [일반사용자|전문사용자]    ・・・    [서버 ONLINE] [Codex READY] [KO|EN] [메트릭] [히스토리] [Codex 검증] [서버 종료]
//
// Section 7 sign-off decisions wired here:
//   - Status pill syncs to run state (대기 중 / 실행 중 / 중단됨)  ← #4
//   - Pro-only buttons (메트릭 / 히스토리 / Codex 검증) hidden in Simple ← built into reference
//
// Data wiring (UI-P1 mock; UI-P5 real):
//   - Status pill: TODO P5 — read store.runs[selectedRunId]?.status
//   - 서버 indicator: TODO P5 — read store.serverInfo
//   - Codex indicator: TODO P5 — read store.accountStatus.profile.codex
//   - KO/EN: hooks HarnessI18n.setLocale() (existing module)
//   - 메트릭/히스토리: opens existing UI-H modals (UI-P5 wires)
//   - 서버 종료: POST /api/server/control/shutdown (existing endpoint;
//     wired in P5 with confirm dialog)
//
// All click handlers in UI-P1 are stubbed — they call onActionClick
// with the action id so the test suite can verify the wire-up exists.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductHeader = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const VERSION = "v2.5.0"; // bumped each phase release; UI-P1 ships with this

  const STATUS_VARIANTS = Object.freeze({
    idle:    { label: "대기 중", state: "idle" },
    running: { label: "실행 중", state: "running" },
    error:   { label: "중단됨", state: "error" },
  });

  function _statusFromStoreSnapshot(snap) {
    // No active run → idle. The product shell's run selection model
    // matches the existing legacy bridge (selectedRunId or first
    // active run). UI-P5 fully wires this; UI-P1 returns idle by
    // default with a hook for the test suite.
    if (!snap || typeof snap !== "object") return "idle";
    const runs = snap.runs;
    if (!runs) return "idle";
    // Walk runs; if any has status === "active" / "running", show running.
    // If any has status === "error", show error. Otherwise idle.
    let sawActive = false;
    let sawError = false;
    if (typeof runs.values === "function") {
      for (const r of runs.values()) {
        if (!r) continue;
        if (r.status === "active" || r.status === "running") sawActive = true;
        else if (r.status === "error") sawError = true;
      }
    } else if (typeof runs === "object") {
      for (const k of Object.keys(runs)) {
        const r = runs[k];
        if (!r) continue;
        if (r.status === "active" || r.status === "running") sawActive = true;
        else if (r.status === "error") sawError = true;
      }
    }
    if (sawActive) return "running";
    if (sawError) return "error";
    return "idle";
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductHeader.create: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("HarnessProductHeader.create: root must be an element");
    }
    const store = opts.store;
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("HarnessProductHeader.create: store required");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("HarnessProductHeader.create: no document available");
    }
    const onActionClick = typeof opts.onActionClick === "function" ? opts.onActionClick : () => {};
    const onModeChange = typeof opts.onModeChange === "function" ? opts.onModeChange : () => {};
    const onLocaleChange = typeof opts.onLocaleChange === "function" ? opts.onLocaleChange : () => {};

    let mode = opts.mode || "simple";
    let locale = opts.locale || "ko";
    // UI-P5-e: selectors for server + codex indicators
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.HarnessProductShellData)
      || null;

    // Build the header DOM once + cache references for cheap updates.
    const header = _doc.createElement("header");
    header.className = "prod-header";
    header.setAttribute("data-region", "header");
    header.setAttribute("role", "banner");
    header.setAttribute("aria-label", "SJ Harness 헤더 (상태 · 모드 · 액션)");

    // Logo + title + version
    const logo = _doc.createElement("div");
    logo.className = "prod-header-logo";
    logo.setAttribute("data-header-slot", "logo");
    logo.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#C9A66B" stroke-width="1.6" aria-hidden="true">'
      + '<path d="M12 2L2 7l10 5 10-5-10-5z"/>'
      + '<path d="M2 17l10 5 10-5"/>'
      + '<path d="M2 12l10 5 10-5"/>'
      + '</svg>'
      + '<span class="prod-header-title" data-header-slot="title">SJ Harness</span>'
      + '<span class="prod-header-version" data-header-slot="version">' + VERSION + '</span>';
    header.appendChild(logo);

    // Status pill
    const statusPill = _doc.createElement("span");
    statusPill.className = "prod-header-status-pill";
    statusPill.setAttribute("data-header-slot", "status-pill");
    statusPill.setAttribute("data-state", "idle");
    statusPill.setAttribute("role", "status");
    statusPill.setAttribute("aria-live", "polite");
    statusPill.setAttribute("aria-label", "실행 상태");
    const statusDot = _doc.createElement("span");
    statusDot.className = "prod-status-dot";
    const statusLabel = _doc.createElement("span");
    statusLabel.className = "prod-header-status-label";
    statusLabel.textContent = STATUS_VARIANTS.idle.label;
    statusPill.appendChild(statusDot);
    statusPill.appendChild(statusLabel);
    header.appendChild(statusPill);

    // Mode toggle
    const modeToggle = _doc.createElement("div");
    modeToggle.className = "prod-mode-toggle";
    modeToggle.setAttribute("data-header-slot", "mode-toggle");
    modeToggle.setAttribute("role", "group");
    modeToggle.setAttribute("aria-label", "사용자 모드 전환");
    const modeButtons = {};
    [
      ["simple", "일반사용자", "Simple"],
      ["pro",    "전문사용자", "Pro"],
    ].forEach(function (entry) {
      const id = entry[0], kor = entry[1], eng = entry[2];
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-mode", id);
      btn.setAttribute("aria-pressed", id === mode ? "true" : "false");
      btn.innerHTML = '<span>' + kor + '</span>'
        + '<span class="prod-mode-en">' + eng + '</span>';
      btn.addEventListener("click", function () {
        if (id === mode) return;
        mode = id;
        _refreshModeButtons();
        try { onModeChange(id); } catch (_) {}
      });
      modeButtons[id] = btn;
      modeToggle.appendChild(btn);
    });
    header.appendChild(modeToggle);

    function _refreshModeButtons() {
      Object.keys(modeButtons).forEach(function (id) {
        modeButtons[id].setAttribute("aria-pressed", id === mode ? "true" : "false");
      });
      _refreshProActions();
    }

    // Spacer pushes right cluster to the edge
    const spacer = _doc.createElement("div");
    spacer.className = "prod-header-spacer";
    header.appendChild(spacer);

    // Right cluster — indicators + locale + actions
    const indicators = _doc.createElement("div");
    indicators.className = "prod-header-indicators";
    indicators.setAttribute("data-header-slot", "indicators");

    const serverIndicator = _doc.createElement("span");
    serverIndicator.className = "prod-indicator";
    serverIndicator.setAttribute("data-indicator", "server");
    serverIndicator.setAttribute("aria-label", "서버 상태");
    const serverDot = _doc.createElement("span");
    serverDot.className = "prod-indicator-dot";
    serverDot.setAttribute("data-status", "ok");
    serverDot.setAttribute("data-indicator-slot", "dot");
    const serverLabel = _doc.createElement("span");
    serverLabel.setAttribute("data-indicator-slot", "label");
    serverLabel.textContent = "서버 ONLINE";
    serverIndicator.appendChild(serverDot);
    serverIndicator.appendChild(serverLabel);
    indicators.appendChild(serverIndicator);

    const codexIndicator = _doc.createElement("span");
    codexIndicator.className = "prod-indicator";
    codexIndicator.setAttribute("data-indicator", "codex");
    codexIndicator.setAttribute("aria-label", "Codex 상태");
    const codexDot = _doc.createElement("span");
    codexDot.className = "prod-indicator-dot";
    codexDot.setAttribute("data-status", "ok");
    codexDot.setAttribute("data-indicator-slot", "dot");
    const codexLabel = _doc.createElement("span");
    codexLabel.setAttribute("data-indicator-slot", "label");
    codexLabel.textContent = "Codex READY";
    codexIndicator.appendChild(codexDot);
    codexIndicator.appendChild(codexLabel);
    indicators.appendChild(codexIndicator);

    // Locale toggle KO/EN
    const localeToggle = _doc.createElement("div");
    localeToggle.className = "prod-locale-toggle";
    localeToggle.setAttribute("data-header-slot", "locale-toggle");
    localeToggle.setAttribute("role", "group");
    localeToggle.setAttribute("aria-label", "언어 선택");
    const localeButtons = {};
    ["KO", "EN"].forEach(function (l) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.textContent = l;
      btn.setAttribute("data-locale", l.toLowerCase());
      btn.setAttribute("aria-pressed", l.toLowerCase() === locale ? "true" : "false");
      btn.addEventListener("click", function () {
        const next = l.toLowerCase();
        if (next === locale) return;
        locale = next;
        Object.keys(localeButtons).forEach(function (k) {
          localeButtons[k].setAttribute("aria-pressed", k.toLowerCase() === locale ? "true" : "false");
        });
        try { onLocaleChange(locale); } catch (_) {}
      });
      localeButtons[l] = btn;
      localeToggle.appendChild(btn);
    });
    indicators.appendChild(localeToggle);

    // Pro-only actions — hidden in simple via display:none
    const proActions = _doc.createElement("span");
    proActions.className = "prod-header-pro-actions";
    proActions.setAttribute("data-header-slot", "pro-actions");
    [
      ["metrics", "📈 메트릭"],
      ["history", "📜 히스토리"],
      ["codex-verify", "Codex 검증"],
    ].forEach(function (entry) {
      const id = entry[0], label = entry[1];
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-header-action";
      btn.setAttribute("data-action", id);
      btn.textContent = label;
      btn.addEventListener("click", function () {
        try { onActionClick(id); } catch (_) {}
      });
      proActions.appendChild(btn);
    });
    indicators.appendChild(proActions);

    // 서버 종료 (always visible)
    const shutdownBtn = _doc.createElement("button");
    shutdownBtn.type = "button";
    shutdownBtn.className = "prod-header-action";
    shutdownBtn.setAttribute("data-action", "shutdown");
    shutdownBtn.setAttribute("data-tone", "danger");
    shutdownBtn.textContent = "서버 종료";
    shutdownBtn.addEventListener("click", function () {
      try { onActionClick("shutdown"); } catch (_) {}
    });
    indicators.appendChild(shutdownBtn);

    header.appendChild(indicators);

    function _refreshProActions() {
      proActions.style.display = (mode === "pro") ? "" : "none";
    }
    _refreshProActions();

    // Live status sync from store. Reuses the existing publish/subscribe
    // contract — every store mutation triggers one render. UI-P5-e
    // extends this to also update the server + codex indicator dots
    // when accountStatus changes in the store.
    function _renderFromStore() {
      const snap = store.snapshot();
      // Status pill (UI-P1)
      const variant = _statusFromStoreSnapshot(snap);
      const cfg = STATUS_VARIANTS[variant] || STATUS_VARIANTS.idle;
      statusPill.setAttribute("data-state", cfg.state);
      statusLabel.textContent = cfg.label;
      // Indicators (UI-P5-e) — only update if selectors module loaded
      if (selectors) {
        try {
          const server = selectors.selectServerStatus(snap);
          serverDot.setAttribute("data-status", server.status);
          serverLabel.textContent = server.label;
        } catch (_) { /* defensive */ }
        try {
          const codex = selectors.selectCodexStatus(snap);
          codexDot.setAttribute("data-status", codex.status);
          codexLabel.textContent = codex.label;
        } catch (_) { /* defensive */ }
      }
    }

    _renderFromStore();
    const unsubscribe = store.subscribe(_renderFromStore);

    root.appendChild(header);

    return {
      destroy: function () {
        try { unsubscribe(); } catch (_) {}
        if (header.parentNode === root) {
          try { root.removeChild(header); } catch (_) {}
        }
      },
      setMode: function (next) {
        if (next === "simple" || next === "pro") {
          if (next !== mode) {
            mode = next;
            _refreshModeButtons();
          }
        }
      },
      setLocale: function (l) {
        const next = (l === "en") ? "en" : "ko";
        if (next !== locale) {
          locale = next;
          Object.keys(localeButtons).forEach(function (k) {
            localeButtons[k].setAttribute("aria-pressed", k.toLowerCase() === locale ? "true" : "false");
          });
        }
      },
      _state: function () {
        return {
          mode,
          locale,
          status: statusPill.getAttribute("data-state"),
          statusLabel: statusLabel.textContent,
        };
      },
    };
  }

  return {
    create,
    VERSION,
    STATUS_VARIANTS,
    _statusFromStoreSnapshot,
  };
});
