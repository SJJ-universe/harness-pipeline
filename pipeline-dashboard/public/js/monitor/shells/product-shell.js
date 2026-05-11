// Slice UI-P1-d (Phase 2 Round 3, 2026-04-30) — product shell mount.
//
// Top-level shell that paints the 5-region full-screen UI per the
// reference HTML at docs/ui-reference-port-plan.md §Appendix A.
// Replaces the previous monitor-shell overlay model: the product
// shell IS the first-paint experience for / (legacy stays at
// /?mode=legacy via server-side branch).
//
// Region layout:
//   ┌────────────────────────────────────────┐
//   │ Header (52px)                          │  ← product-header.js
//   ├────────────────────────────────────────┤
//   │ Orchestrator Track (92px)                   │  ← product-orchestrator-track.js
//   ├──────────────┬─────────────────────────┤
//   │ Pipeline     │ Monitor Grid (flex)     │  ← product-pipeline-rail.js +
//   │ Rail         ├─────────────────────────┤    product-monitor-grid.js
//   │ (320/380px)  │ Dual Terminals (280px)  │  ← product-dual-terminals.js
//   └──────────────┴─────────────────────────┘
//
// Mount() takes a store + mode and renders the 5 regions. Each panel
// is mounted independently with its own root + store subscription —
// the shell's only job is the layout skeleton + mode propagation
// (the [data-mode="simple|pro"] attribute drives CSS grid columns).
//
// What this does NOT do (yet):
//   - Real data wiring — UI-P1 ships layout + stub panels. UI-P5 wires
//     each card to its store slice.
//   - Modal mounting — run-viewer / settings-accounts / approval-card
//     keep their existing mount points (added by UI-P5/P6 wiring).
//   - Mode persistence — the init script (product-shell-init.js)
//     resolves the mode from URL/localStorage and passes it in.
//     Toggling the mode at runtime updates this attribute via
//     setMode(); persistence to localStorage happens in the toggle
//     callback wired by the init script.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductShell = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Frozen Array — Object.freeze on a Set doesn't seal its internal
  // entries (Set/Map mutation methods bypass freeze). An Array's
  // length + slot mutations DO respect freeze, so the vocabulary
  // can't drift at runtime.
  const VALID_MODES = Object.freeze(["simple", "pro"]);

  // UI-P7: alias map. Per `docs/ui-reference-port-plan.md` §4 routing
  // table (lines 190-193), `?mode=advanced` is the deprecated internal
  // alias for the existing UI-H simple/advanced split — it MUST land
  // on `pro` so existing test fixtures + bookmarks keep working until
  // the alias is removed at UI-P9. Unknown values fall back to simple.
  const MODE_ALIASES = Object.freeze({
    advanced: "pro",
  });

  function _coerceMode(m) {
    if (typeof m === "string" && Object.prototype.hasOwnProperty.call(MODE_ALIASES, m)) {
      return MODE_ALIASES[m];
    }
    return VALID_MODES.indexOf(m) >= 0 ? m : "simple";
  }

  /**
   * Mount the product shell into the given root element.
   *
   * @param {object} opts
   * @param {HTMLElement} opts.root - mount point (typically #product-shell-root)
   * @param {object} opts.store - OrchestratorMonitorStore instance
   * @param {string} [opts.mode="simple"] - "simple" | "pro"
   * @param {object} [opts.doc] - document injection for tests
   * @param {object} [opts.panels] - override factories for tests
   *   { header, track, rail, grid, terminals }
   * @param {function} [opts.onModeChange] - called when toggle fires;
   *   init script wires this to localStorage write + URL update
   * @returns {{ setMode: (m: string) => void, getMode: () => string,
   *             destroy: () => void, _state: () => object }}
   */
  function mount(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("OrchestratorProductShell.mount: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("OrchestratorProductShell.mount: root must be an element");
    }
    const store = opts.store;
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("OrchestratorProductShell.mount: store must be a OrchestratorMonitorStore");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("OrchestratorProductShell.mount: no document available");
    }

    let mode = _coerceMode(opts.mode);
    // UI-P7: track locale alongside mode. The shell only forwards the
    // value to panels via setLocale + initial opts; the actual i18n
    // table lookup lives in OrchestratorI18n / per-panel _t() helpers.
    let locale = (opts.locale === "en") ? "en" : "ko";
    // Runtime product shell must not show the reference/mock page by
    // accident. Tests and visual-baseline capture omit this option so
    // they continue to exercise the reference demo shape; the browser
    // init script passes false unless the operator explicitly asks for
    // demo mode (?demo=1).
    const allowMockData = opts.allowMockData !== false;

    // Resolve panel factories. Production reads from window globals;
    // tests pass stubs via opts.panels. This keeps the shell DOM-aware
    // but data-source-agnostic: the panel modules own their store
    // subscriptions, the shell owns the layout skeleton.
    const panels = opts.panels || {};
    const headerFactory = panels.header
      || (typeof window !== "undefined" && window.OrchestratorProductHeader && window.OrchestratorProductHeader.create);
    const trackFactory = panels.track
      || (typeof window !== "undefined" && window.OrchestratorProductTrack && window.OrchestratorProductTrack.create);
    const railFactory = panels.rail
      || (typeof window !== "undefined" && window.OrchestratorProductPipelineRail && window.OrchestratorProductPipelineRail.create);
    const gridFactory = panels.grid
      || (typeof window !== "undefined" && window.OrchestratorProductMonitorGrid && window.OrchestratorProductMonitorGrid.create);
    const terminalsFactory = panels.terminals
      || (typeof window !== "undefined" && window.OrchestratorProductDualTerminals && window.OrchestratorProductDualTerminals.create);
    // AGENT-DESKTOP-0-c (2026-05-06): chat panel factory. Optional —
    // if the script tag failed to load OR tests don't pass a stub,
    // the chat region simply renders empty (gracefully degraded).
    const chatFactory = (panels && panels.chat)
      || (typeof window !== "undefined" && window.OrchestratorProductChatPanel && window.OrchestratorProductChatPanel.create);

    // Build skeleton DOM. The class names map 1:1 to style.product.css.
    // Each region carries data-region so UI-P5 wiring + visual
    // regression tooling can find them by attribute selector instead
    // of relying on class names that may shift during pixel polish.
    const shell = _doc.createElement("div");
    shell.className = "prod-shell";
    shell.setAttribute("data-region", "shell");
    shell.setAttribute("data-mode", mode);

    const headerMount = _doc.createElement("div");
    headerMount.className = "prod-header-mount";
    headerMount.setAttribute("data-region-mount", "header");
    const trackMount = _doc.createElement("div");
    trackMount.className = "prod-track-mount";
    trackMount.setAttribute("data-region-mount", "orchestrator-track");

    const workspace = _doc.createElement("div");
    workspace.className = "prod-workspace";
    workspace.setAttribute("data-region-mount", "workspace");
    const railMount = _doc.createElement("div");
    railMount.className = "prod-rail-mount";
    railMount.setAttribute("data-region-mount", "pipeline-rail");
    const stack = _doc.createElement("div");
    stack.className = "prod-monitor-stack";
    stack.setAttribute("data-region-mount", "monitor-stack");
    const gridMount = _doc.createElement("div");
    gridMount.className = "prod-grid-mount";
    gridMount.setAttribute("data-region-mount", "monitor-grid");
    const terminalsMount = _doc.createElement("div");
    terminalsMount.className = "prod-terminals-mount";
    terminalsMount.setAttribute("data-region-mount", "dual-terminals");

    // AGENT-DESKTOP-0-c (2026-05-06): chat panel mount region.
    // Sticky bottom strip below the workspace. ~200px tall when
    // populated; the panel itself owns its internal layout.
    const chatMount = _doc.createElement("div");
    chatMount.className = "prod-chat-mount";
    chatMount.setAttribute("data-region-mount", "chat");

    stack.appendChild(gridMount);
    stack.appendChild(terminalsMount);
    workspace.appendChild(railMount);
    workspace.appendChild(stack);

    shell.appendChild(headerMount);
    shell.appendChild(trackMount);
    shell.appendChild(workspace);
    shell.appendChild(chatMount);

    root.appendChild(shell);

    // PRODUCT-SHELL-WIRING: central action dispatcher.
    //
    // Header + rail buttons emit action ids ("pipeline-start", "shutdown",
    // "metrics" ...) via their `onActionClick` callback. The shell owns
    // a single `_dispatch(actionId, payload)` closure that routes each
    // id to a handler from `opts.actionHandlers` (the action map). The
    // init script wires `window.OrchestratorShellActions.createDefaultHandlers()`
    // as the default; tests inject a stub map for isolated assertions.
    //
    // No global delegated listener — every panel still owns its own
    // addEventListener (the dual-terminals self-attached pattern stays
    // unchanged). `onActionClick` is the contract; `_dispatch` is the
    // implementation behind it.
    const actionHandlers = (opts.actionHandlers && typeof opts.actionHandlers === "object")
      ? opts.actionHandlers
      : null;

    function _dispatch(actionId, payload) {
      if (!actionId) return;
      const handler = actionHandlers && actionHandlers[actionId];
      if (typeof handler !== "function") {
        // No handler installed for this action — defensive no-op so the
        // click still feels responsive (panel's own try/catch swallows).
        // Tests assert the dispatcher reaches the handler when present;
        // missing-handler path is logged for forensics but not thrown.
        if (typeof opts.onActionMissing === "function") {
          try { opts.onActionMissing(actionId); } catch (_) {}
        }
        return;
      }
      try {
        return handler(payload);
      } catch (_) {
        // Handler-internal errors are the handler's responsibility to
        // toast / report; the shell stays alive.
      }
    }

    // Mount handles — each panel returns { destroy?, setMode? }
    const handles = {};

    function _mountPanel(factory, mountEl, name, extraOpts) {
      if (typeof factory !== "function") {
        // Panel module missing — render a placeholder so the operator
        // sees what's wired vs. missing. Production should never hit
        // this path because all 5 panels are bundled in index.html.
        const placeholder = _doc.createElement("div");
        placeholder.className = "prod-panel-missing";
        placeholder.textContent = "[panel missing: " + name + "]";
        placeholder.setAttribute("role", "alert");
        mountEl.appendChild(placeholder);
        return null;
      }
      try {
        return factory(Object.assign({
          root: mountEl,
          store: store,
          doc: _doc,
          mode: mode,
          locale: locale,
          allowMockData: allowMockData,
        }, extraOpts || {}));
      } catch (err) {
        const errEl = _doc.createElement("div");
        errEl.className = "prod-panel-error";
        errEl.setAttribute("role", "alert");
        errEl.textContent = "[panel error: " + name + " — "
          + (err && err.message ? err.message : "init failed") + "]";
        mountEl.appendChild(errEl);
        return null;
      }
    }

    handles.header = _mountPanel(headerFactory, headerMount, "header", {
      onModeChange(next) { setMode(next); },
      // UI-P7: locale toggle in the header bubbles up through the shell
      // so the init script can persist it via OrchestratorI18n.setLang AND
      // re-broadcast to every panel via setLocale().
      onLocaleChange(next) { setLocale(next); },
      // PRODUCT-SHELL-WIRING: route header action buttons (metrics,
      // history, codex-verify, shutdown) through _dispatch.
      onActionClick: _dispatch,
    });
    handles.track = _mountPanel(trackFactory, trackMount, "orchestrator-track");
    handles.rail = _mountPanel(railFactory, railMount, "pipeline-rail", {
      // PRODUCT-SHELL-WIRING: route rail action buttons (pipeline-start,
      // pipeline-compact, pipeline-template) through _dispatch.
      onActionClick: _dispatch,
    });
    handles.grid = _mountPanel(gridFactory, gridMount, "monitor-grid");
    // UI-P6: pass review-relay client to dual-terminals so the action
    // row (start / send-codex / followup / hand-back / archive) is
    // wired. When opts.reviewClient is null/undefined the terminals
    // panel falls back to its UI-P4 mock-only view.
    handles.terminals = _mountPanel(terminalsFactory, terminalsMount, "dual-terminals", {
      client: opts.reviewClient || null,
      onError: opts.onPanelError || null,
    });
    // AGENT-DESKTOP-0-c (2026-05-06): mount chat panel.
    // - onActionClick: routes Approve clicks through the same
    //   _dispatch path the header + rail use, so chat-driven actions
    //   share the existing audit chain + handler safety net.
    // - toastFn: forwards the panel's [system] feedback to the
    //   shared toast system used by the rest of the shell.
    // - intentUrl + fetchImpl default to the production /api/chat/intent
    //   + window.fetch; tests override.
    handles.chat = _mountPanel(chatFactory, chatMount, "chat", {
      onActionClick: _dispatch,
      toastFn: opts.toastFn || null,
      intentUrl: opts.intentUrl || "/api/chat/intent",
      fetchImpl: opts.fetchImpl || null,
    });

    function setMode(next) {
      const coerced = _coerceMode(next);
      if (coerced === mode) return;
      mode = coerced;
      shell.setAttribute("data-mode", mode);
      // Notify panels that the mode changed. Each panel decides what to
      // re-render (header swaps button state, grid rearranges columns,
      // terminals show/hide gutters etc.).
      for (const key of Object.keys(handles)) {
        const h = handles[key];
        if (h && typeof h.setMode === "function") {
          try { h.setMode(mode); } catch (_) { /* defensive */ }
        }
      }
      try {
        if (typeof opts.onModeChange === "function") opts.onModeChange(mode);
      } catch (_) { /* defensive */ }
    }

    function getMode() { return mode; }

    // UI-P7: locale propagation. Header's locale toggle invokes
    // onLocaleChange (above) which calls this. The shell:
    //   1. updates its `locale` slot
    //   2. propagates to every panel that exposes setLocale (header,
    //      dual-terminals — others ignore until they need translatable
    //      strings)
    //   3. fires opts.onLocaleChange so the init script can persist
    //      the choice via OrchestratorI18n.setLang (writes orchestrator:lang
    //      localStorage key + dispatches orchestrator:lang-changed)
    function setLocale(next) {
      const coerced = (next === "en") ? "en" : "ko";
      if (coerced === locale) return;
      locale = coerced;
      shell.setAttribute("data-locale", locale);
      for (const key of Object.keys(handles)) {
        const h = handles[key];
        if (h && typeof h.setLocale === "function") {
          try { h.setLocale(locale); } catch (_) { /* defensive */ }
        }
      }
      try {
        if (typeof opts.onLocaleChange === "function") opts.onLocaleChange(locale);
      } catch (_) { /* defensive */ }
    }

    function getLocale() { return locale; }

    function destroy() {
      for (const key of Object.keys(handles)) {
        const h = handles[key];
        if (h && typeof h.destroy === "function") {
          try { h.destroy(); } catch (_) {}
        }
      }
      if (shell.parentNode === root) {
        try { root.removeChild(shell); } catch (_) {}
      }
    }

    function _state() {
      return {
        mode,
        locale,
        allowMockData,
        panelsMounted: Object.keys(handles).filter((k) => handles[k] !== null),
        // PRODUCT-SHELL-WIRING: surface the action surface so tests +
        // smoke checks can confirm the dispatcher saw a handler map.
        actionHandlers: actionHandlers ? Object.keys(actionHandlers) : [],
      };
    }

    // Stamp initial locale on the shell so visual-regression tooling +
    // CSS rules can target [data-locale="en"] if/when needed.
    shell.setAttribute("data-locale", locale);

    return {
      setMode,
      getMode,
      setLocale,
      getLocale,
      destroy,
      _state,
      // PRODUCT-SHELL-WIRING: expose dispatcher so tests can drive
      // action ids directly + future panels (or hash-based deep links)
      // can call into the same routing surface without re-implementing.
      _dispatch,
    };
  }

  return {
    mount,
    VALID_MODES,
    MODE_ALIASES,
    _coerceMode,
  };
});
