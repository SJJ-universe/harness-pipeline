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
//   │ Harness Track (92px)                   │  ← product-harness-track.js
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
  if (typeof window !== "undefined") root.HarnessProductShell = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Frozen Array — Object.freeze on a Set doesn't seal its internal
  // entries (Set/Map mutation methods bypass freeze). An Array's
  // length + slot mutations DO respect freeze, so the vocabulary
  // can't drift at runtime.
  const VALID_MODES = Object.freeze(["simple", "pro"]);

  function _coerceMode(m) {
    return VALID_MODES.indexOf(m) >= 0 ? m : "simple";
  }

  /**
   * Mount the product shell into the given root element.
   *
   * @param {object} opts
   * @param {HTMLElement} opts.root - mount point (typically #product-shell-root)
   * @param {object} opts.store - HarnessMonitorStore instance
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
      throw new Error("HarnessProductShell.mount: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("HarnessProductShell.mount: root must be an element");
    }
    const store = opts.store;
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("HarnessProductShell.mount: store must be a HarnessMonitorStore");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("HarnessProductShell.mount: no document available");
    }

    let mode = _coerceMode(opts.mode);

    // Resolve panel factories. Production reads from window globals;
    // tests pass stubs via opts.panels. This keeps the shell DOM-aware
    // but data-source-agnostic: the panel modules own their store
    // subscriptions, the shell owns the layout skeleton.
    const panels = opts.panels || {};
    const headerFactory = panels.header
      || (typeof window !== "undefined" && window.HarnessProductHeader && window.HarnessProductHeader.create);
    const trackFactory = panels.track
      || (typeof window !== "undefined" && window.HarnessProductHarnessTrack && window.HarnessProductHarnessTrack.create);
    const railFactory = panels.rail
      || (typeof window !== "undefined" && window.HarnessProductPipelineRail && window.HarnessProductPipelineRail.create);
    const gridFactory = panels.grid
      || (typeof window !== "undefined" && window.HarnessProductMonitorGrid && window.HarnessProductMonitorGrid.create);
    const terminalsFactory = panels.terminals
      || (typeof window !== "undefined" && window.HarnessProductDualTerminals && window.HarnessProductDualTerminals.create);

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
    trackMount.setAttribute("data-region-mount", "harness-track");

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

    stack.appendChild(gridMount);
    stack.appendChild(terminalsMount);
    workspace.appendChild(railMount);
    workspace.appendChild(stack);

    shell.appendChild(headerMount);
    shell.appendChild(trackMount);
    shell.appendChild(workspace);

    root.appendChild(shell);

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
    });
    handles.track = _mountPanel(trackFactory, trackMount, "harness-track");
    handles.rail = _mountPanel(railFactory, railMount, "pipeline-rail");
    handles.grid = _mountPanel(gridFactory, gridMount, "monitor-grid");
    // UI-P6: pass review-relay client to dual-terminals so the action
    // row (start / send-codex / followup / hand-back / archive) is
    // wired. When opts.reviewClient is null/undefined the terminals
    // panel falls back to its UI-P4 mock-only view.
    handles.terminals = _mountPanel(terminalsFactory, terminalsMount, "dual-terminals", {
      client: opts.reviewClient || null,
      onError: opts.onPanelError || null,
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
        panelsMounted: Object.keys(handles).filter((k) => handles[k] !== null),
      };
    }

    return {
      setMode,
      getMode,
      destroy,
      _state,
    };
  }

  return {
    mount,
    VALID_MODES,
    _coerceMode,
  };
});
