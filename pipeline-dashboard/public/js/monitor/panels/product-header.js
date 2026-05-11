// Slice UI-P1-e (Phase 2 Round 3, 2026-04-30) — product header (52px).
//
// Top header band of the product shell. Mirrors the reference HTML's
// Header layout pixel-by-pixel:
//
//   ◇ SJ Orchestrator · v2.4.0 · [실행 중]    [일반사용자|전문사용자]    ・・・    [서버 ONLINE] [Codex READY] [KO|EN] [메트릭] [히스토리] [Codex 검증] [서버 종료]
//
// Section 7 sign-off decisions wired here:
//   - Status pill syncs to run state (대기 중 / 실행 중 / 중단됨)  ← #4
//   - Pro-only buttons (메트릭 / 히스토리 / Codex 검증) hidden in Simple ← built into reference
//
// Data wiring (UI-P1 mock; UI-P5 real):
//   - Status pill: TODO P5 — read store.runs[selectedRunId]?.status
//   - 서버 indicator: TODO P5 — read store.serverInfo
//   - Codex indicator: TODO P5 — read store.accountStatus.profile.codex
//   - KO/EN: hooks OrchestratorI18n.setLocale() (existing module)
//   - 메트릭/히스토리: opens existing UI-H modals (UI-P5 wires)
//   - 서버 종료: POST /api/server/control/shutdown (existing endpoint;
//     wired in P5 with confirm dialog)
//
// All click handlers in UI-P1 are stubbed — they call onActionClick
// with the action id so the test suite can verify the wire-up exists.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductHeader = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const VERSION = "v2.5.0"; // bumped each phase release; UI-P1 ships with this

  // UI-P7: status pill variants now carry i18n key + Korean fallback.
  // Header's _t() helper picks the i18n translation when OrchestratorI18n
  // is loaded (browser); Node tests fall through to the fallback so
  // the existing assertions on Korean text continue to pass.
  const STATUS_VARIANTS = Object.freeze({
    idle:    { state: "idle",    labelKey: "prod.status.idle",    fallback: "대기 중" },
    running: { state: "running", labelKey: "prod.status.running", fallback: "실행 중" },
    error:   { state: "error",   labelKey: "prod.status.error",   fallback: "중단됨" },
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
      throw new Error("OrchestratorProductHeader.create: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("OrchestratorProductHeader.create: root must be an element");
    }
    const store = opts.store;
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("OrchestratorProductHeader.create: store required");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("OrchestratorProductHeader.create: no document available");
    }
    const onActionClick = typeof opts.onActionClick === "function" ? opts.onActionClick : () => {};
    const onModeChange = typeof opts.onModeChange === "function" ? opts.onModeChange : () => {};
    const onLocaleChange = typeof opts.onLocaleChange === "function" ? opts.onLocaleChange : () => {};

    let mode = opts.mode || "simple";
    let locale = opts.locale || "ko";
    // UI-P5-e: selectors for server + codex indicators
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.OrchestratorProductShellData)
      || null;
    // UI-P7: i18n integration. Tests inject a stub via opts.i18n;
    // browser auto-resolves window.OrchestratorI18n. When i18n is missing
    // (Node test path without explicit injection) _t() returns the
    // fallback so existing assertions on Korean strings still pass.
    const i18n = opts.i18n
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
    // Status indicator → i18n key map (UI-P5-e returns labelKey on
    // selectors when present; we still tolerate older selector shapes).
    const SERVER_STATUS_KEYS = {
      ok:   { labelKey: "prod.indicator.server.online",   fallback: "서버 ONLINE" },
      fail: { labelKey: "prod.indicator.server.offline",  fallback: "서버 OFFLINE" },
      warn: { labelKey: "prod.indicator.server.checking", fallback: "서버 확인 중" },
      idle: { labelKey: "prod.indicator.server.checking", fallback: "서버 확인 중" },
    };
    const CODEX_STATUS_KEYS = {
      ok:   { labelKey: "prod.indicator.codex.ready",        fallback: "Codex READY" },
      warn: { labelKey: "prod.indicator.codex.authNeeded",   fallback: "Codex 인증 필요" },
      fail: { labelKey: "prod.indicator.codex.notInstalled", fallback: "Codex 미설치" },
    };

    // Build the header DOM once + cache references for cheap updates.
    const header = _doc.createElement("header");
    header.className = "prod-header";
    header.setAttribute("data-region", "header");
    header.setAttribute("role", "banner");
    header.setAttribute("aria-label", _t("prod.aria.header", "SJ Orchestrator 헤더 (상태 · 모드 · 액션)"));

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
      + '<span class="prod-header-title" data-header-slot="title">SJ Orchestrator</span>'
      + '<span class="prod-header-version" data-header-slot="version">' + VERSION + '</span>';
    header.appendChild(logo);

    // Status pill
    const statusPill = _doc.createElement("span");
    statusPill.className = "prod-header-status-pill";
    statusPill.setAttribute("data-header-slot", "status-pill");
    statusPill.setAttribute("data-state", "idle");
    statusPill.setAttribute("role", "status");
    statusPill.setAttribute("aria-live", "polite");
    statusPill.setAttribute("aria-label", _t("prod.aria.statusPill", "실행 상태"));
    const statusDot = _doc.createElement("span");
    statusDot.className = "prod-status-dot";
    const statusLabel = _doc.createElement("span");
    statusLabel.className = "prod-header-status-label";
    statusLabel.textContent = _t(STATUS_VARIANTS.idle.labelKey, STATUS_VARIANTS.idle.fallback);
    statusPill.appendChild(statusDot);
    statusPill.appendChild(statusLabel);
    header.appendChild(statusPill);

    // Mode toggle
    const modeToggle = _doc.createElement("div");
    modeToggle.className = "prod-mode-toggle";
    modeToggle.setAttribute("data-header-slot", "mode-toggle");
    modeToggle.setAttribute("role", "group");
    modeToggle.setAttribute("aria-label", _t("prod.aria.modeToggle", "사용자 모드 전환"));
    const modeButtons = {};
    // UI-P7: bilingual labels per UI-P0 §6 — Korean primary always
    // visible, English subscript always visible. The fallback strings
    // match the i18n table values; both stay constant across locales
    // (the design ribbon is bilingual by intent).
    [
      ["simple", "prod.mode.simple", "일반사용자", "prod.mode.simple.eng", "Simple"],
      ["pro",    "prod.mode.pro",    "전문사용자", "prod.mode.pro.eng",    "Pro"],
    ].forEach(function (entry) {
      const id = entry[0];
      const korKey = entry[1], korFallback = entry[2];
      const engKey = entry[3], engFallback = entry[4];
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("data-mode", id);
      btn.setAttribute("aria-pressed", id === mode ? "true" : "false");
      btn.innerHTML = '<span>' + _t(korKey, korFallback) + '</span>'
        + '<span class="prod-mode-en">' + _t(engKey, engFallback) + '</span>';
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
    serverIndicator.setAttribute("aria-label", _t("prod.aria.serverIndicator", "서버 상태"));
    const serverDot = _doc.createElement("span");
    serverDot.className = "prod-indicator-dot";
    serverDot.setAttribute("data-status", "ok");
    serverDot.setAttribute("data-indicator-slot", "dot");
    const serverLabel = _doc.createElement("span");
    serverLabel.setAttribute("data-indicator-slot", "label");
    serverLabel.textContent = _t("prod.indicator.server.online", "서버 ONLINE");
    serverIndicator.appendChild(serverDot);
    serverIndicator.appendChild(serverLabel);
    indicators.appendChild(serverIndicator);

    const codexIndicator = _doc.createElement("span");
    codexIndicator.className = "prod-indicator";
    codexIndicator.setAttribute("data-indicator", "codex");
    codexIndicator.setAttribute("aria-label", _t("prod.aria.codexIndicator", "Codex 상태"));
    const codexDot = _doc.createElement("span");
    codexDot.className = "prod-indicator-dot";
    codexDot.setAttribute("data-status", "ok");
    codexDot.setAttribute("data-indicator-slot", "dot");
    const codexLabel = _doc.createElement("span");
    codexLabel.setAttribute("data-indicator-slot", "label");
    codexLabel.textContent = _t("prod.indicator.codex.ready", "Codex READY");
    codexIndicator.appendChild(codexDot);
    codexIndicator.appendChild(codexLabel);
    indicators.appendChild(codexIndicator);

    // Locale toggle KO/EN
    const localeToggle = _doc.createElement("div");
    localeToggle.className = "prod-locale-toggle";
    localeToggle.setAttribute("data-header-slot", "locale-toggle");
    localeToggle.setAttribute("role", "group");
    localeToggle.setAttribute("aria-label", _t("prod.aria.localeToggle", "언어 선택"));
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

    // PRODUCT-SHELL-WIRING: layout reshuffle (rc.5 field-pilot prep).
    //
    //   Always-visible "tools" cluster   ← Codex 검증
    //   Pro-only "pro-actions" cluster   ← 메트릭, 히스토리, 서버 종료
    //
    // Reasoning per user decisions: pilots may need a quick Codex
    // health check (always visible). 메트릭/히스토리 are advanced
    // (pro). 서버 종료 is dangerous for non-engineer pilots → pro
    // only (was always-visible pre-rc.5).
    //
    // Both clusters share the i18n re-render path in setLocale below;
    // `toolsEntries` mirrors the iteration shape of `proActionEntries`
    // so the locale handler stays parallel + extensible.
    const toolsEntries = [
      { id: "codex-verify", labelKey: "btn.codexVerify", fallback: "Codex 검증" },
    ];
    const toolsCluster = _doc.createElement("span");
    toolsCluster.className = "prod-header-tools";
    toolsCluster.setAttribute("data-header-slot", "tools");
    toolsEntries.forEach(function (entry) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-header-action";
      btn.setAttribute("data-action", entry.id);
      btn.textContent = _t(entry.labelKey, entry.fallback);
      btn.addEventListener("click", function () {
        try { onActionClick(entry.id); } catch (_) {}
      });
      toolsCluster.appendChild(btn);
    });
    indicators.appendChild(toolsCluster);

    // Pro-only actions — hidden in simple via display:none
    const proActions = _doc.createElement("span");
    proActions.className = "prod-header-pro-actions";
    proActions.setAttribute("data-header-slot", "pro-actions");
    // UI-P7: reuse existing i18n keys (btn.openAnalytics /
    // btn.openRunHistory) so the legacy app and the product header
    // stay in sync when those labels are tweaked.
    const proActionEntries = [
      { id: "metrics", labelKey: "btn.openAnalytics",  fallback: "📈 메트릭" },
      { id: "history", labelKey: "btn.openRunHistory", fallback: "📜 히스토리" },
    ];
    proActionEntries.forEach(function (entry) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-header-action";
      btn.setAttribute("data-action", entry.id);
      btn.textContent = _t(entry.labelKey, entry.fallback);
      btn.addEventListener("click", function () {
        try { onActionClick(entry.id); } catch (_) {}
      });
      proActions.appendChild(btn);
    });

    // 서버 종료 — appended into proActions so _refreshProActions()
    // toggles its visibility. Pre-rc.5 it was attached to `indicators`
    // directly (always visible); the field-pilot safety decision
    // moves it under the pro gate.
    const shutdownBtn = _doc.createElement("button");
    shutdownBtn.type = "button";
    shutdownBtn.className = "prod-header-action";
    shutdownBtn.setAttribute("data-action", "shutdown");
    shutdownBtn.setAttribute("data-tone", "danger");
    shutdownBtn.textContent = _t("btn.serverStop", "서버 종료");
    shutdownBtn.addEventListener("click", function () {
      try { onActionClick("shutdown"); } catch (_) {}
    });
    proActions.appendChild(shutdownBtn);

    indicators.appendChild(proActions);

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
      // Status pill (UI-P1) — translate via STATUS_VARIANTS key map.
      const variant = _statusFromStoreSnapshot(snap);
      const cfg = STATUS_VARIANTS[variant] || STATUS_VARIANTS.idle;
      statusPill.setAttribute("data-state", cfg.state);
      statusLabel.textContent = _t(cfg.labelKey, cfg.fallback);
      // Indicators (UI-P5-e + UI-P7) — only update if selectors module
      // loaded. Status string ("ok"/"warn"/"fail") drives both the dot
      // color and the i18n key lookup. Selector's `label` field is
      // ignored when an i18n table is wired so KO/EN switching works.
      if (selectors) {
        try {
          const server = selectors.selectServerStatus(snap);
          serverDot.setAttribute("data-status", server.status);
          const cfg = SERVER_STATUS_KEYS[server.status] || SERVER_STATUS_KEYS.ok;
          serverLabel.textContent = (i18n && server.labelKey)
            ? _t(server.labelKey, server.label || cfg.fallback)
            : (i18n ? _t(cfg.labelKey, server.label || cfg.fallback)
                    : (server.label || cfg.fallback));
        } catch (_) { /* defensive */ }
        try {
          const codex = selectors.selectCodexStatus(snap);
          codexDot.setAttribute("data-status", codex.status);
          const cfg = CODEX_STATUS_KEYS[codex.status] || CODEX_STATUS_KEYS.ok;
          codexLabel.textContent = (i18n && codex.labelKey)
            ? _t(codex.labelKey, codex.label || cfg.fallback)
            : (i18n ? _t(cfg.labelKey, codex.label || cfg.fallback)
                    : (codex.label || cfg.fallback));
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
        if (next === locale) return;
        locale = next;
        Object.keys(localeButtons).forEach(function (k) {
          localeButtons[k].setAttribute("aria-pressed", k.toLowerCase() === locale ? "true" : "false");
        });
        // UI-P7: re-render every translatable surface. Mode toggle
        // labels are bilingual constants but other panels (status pill
        // text, indicator labels, action button labels, aria labels)
        // need refresh so OrchestratorI18n.getLang's new value lands in the
        // visible DOM without waiting for the next store publish.
        try {
          // 1. aria labels
          header.setAttribute("aria-label", _t("prod.aria.header", "SJ Orchestrator 헤더 (상태 · 모드 · 액션)"));
          statusPill.setAttribute("aria-label", _t("prod.aria.statusPill", "실행 상태"));
          modeToggle.setAttribute("aria-label", _t("prod.aria.modeToggle", "사용자 모드 전환"));
          serverIndicator.setAttribute("aria-label", _t("prod.aria.serverIndicator", "서버 상태"));
          codexIndicator.setAttribute("aria-label", _t("prod.aria.codexIndicator", "Codex 상태"));
          localeToggle.setAttribute("aria-label", _t("prod.aria.localeToggle", "언어 선택"));
          // 2. mode toggle (rebuild innerHTML so KO + EN subscript update)
          [
            ["simple", "prod.mode.simple", "일반사용자", "prod.mode.simple.eng", "Simple"],
            ["pro",    "prod.mode.pro",    "전문사용자", "prod.mode.pro.eng",    "Pro"],
          ].forEach(function (entry) {
            const btn = modeButtons[entry[0]];
            if (btn) {
              btn.innerHTML = '<span>' + _t(entry[1], entry[2]) + '</span>'
                + '<span class="prod-mode-en">' + _t(entry[3], entry[4]) + '</span>';
            }
          });
          // 3. pro-action button labels
          proActionEntries.forEach(function (entry) {
            for (let i = 0; i < proActions.children.length; i++) {
              const btn = proActions.children[i];
              if (btn && btn.getAttribute && btn.getAttribute("data-action") === entry.id) {
                btn.textContent = _t(entry.labelKey, entry.fallback);
              }
            }
          });
          // 3b. PRODUCT-SHELL-WIRING: tools-cluster button labels
          // (codex-verify lives outside proActions for always-visible
          // semantics; needs its own re-render iteration so locale
          // changes propagate through this cluster too).
          toolsEntries.forEach(function (entry) {
            for (let i = 0; i < toolsCluster.children.length; i++) {
              const btn = toolsCluster.children[i];
              if (btn && btn.getAttribute && btn.getAttribute("data-action") === entry.id) {
                btn.textContent = _t(entry.labelKey, entry.fallback);
              }
            }
          });
          // 4. shutdown button
          shutdownBtn.textContent = _t("btn.serverStop", "서버 종료");
          // 5. status pill + indicator dots/labels
          _renderFromStore();
        } catch (_) { /* defensive */ }
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
