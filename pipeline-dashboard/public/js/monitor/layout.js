// Slice MA3+MA4 (Phase D, 2026-04-27) — HarnessMonitorLayout.
//
// Mounts the monitor shell into a host element, kicks off hydration, and
// instantiates each panel. MA3 wired the global-bar panel; MA4 adds the
// shell-body row containing the left run-rail (run-tree) and the centre
// workspace (run-summary). MA5 will fold the right inspector + bottom
// dock + tool/event timeline into the same wiring pattern.
//
// Default behaviour: completely opt-in. The init script in index.html
// only invokes mount() when ?monitor=1 is in the URL or
// localStorage.harnessMonitor === "1". Users who don't opt in see no
// change — mount() is never called for them and the shell stays hidden.
//
// Contract:
//   mount({ root, store, normalize, fetchImpl, headers, panels, hydrate, doc })
//     → { hydrationPromise, destroy }
//
//   - root        : HTMLElement (the #monitor-shell-root container).
//   - store       : HarnessMonitorStore instance.
//   - normalize   : function from HarnessMonitorNormalizer.normalize.
//   - fetchImpl   : optional fetch override (defaults to global fetch).
//   - headers     : optional headers passed to hydrate.
//   - panels      : {
//                     globalBar?:   { create({root,store,onClose,doc}) },
//                     runTree?:     { create({root,store,onSelect,doc}) },
//                     runSummary?:  { create({root,store,doc}) },
//                   }
//                   Defaults are window.HarnessMonitor{GlobalBar,RunTree,
//                   RunSummary} in browsers; tests inject stubs.
//   - hydrate     : optional hydrate fn override (defaults to
//                   HarnessMonitorHydrate.hydrateMonitorStore).
//   - doc         : optional document override (test injection).
//
// Hydration errors do NOT throw — they surface in the in-bar error box so
// the panel keeps rendering whatever live store state already arrived
// from the WebSocket. Throwing would orphan the mount.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorLayout = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolvePanel(panels, key, globalName) {
    if (panels && panels[key] && typeof panels[key].create === "function") {
      return panels[key];
    }
    if (typeof globalThis !== "undefined" && globalThis[globalName]
        && typeof globalThis[globalName].create === "function") {
      return globalThis[globalName];
    }
    return null;
  }

  function _resolveHydrate(override) {
    if (typeof override === "function") return override;
    if (typeof globalThis !== "undefined"
        && globalThis.HarnessMonitorHydrate
        && typeof globalThis.HarnessMonitorHydrate.hydrateMonitorStore === "function") {
      return globalThis.HarnessMonitorHydrate.hydrateMonitorStore;
    }
    return null;
  }

  function mount({
    root,
    store,
    normalize,
    fetchImpl,
    headers,
    panels = {},
    hydrate,
    doc,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("HarnessMonitorLayout.mount: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("HarnessMonitorLayout.mount: store is required");
    }
    const _doc = doc || (root.ownerDocument) || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("HarnessMonitorLayout.mount: no document available");
    }

    // ── Activate the shell + push the existing dashboard down ──
    root.classList.add("monitor-shell");
    root.classList.add("is-active");
    if (typeof root.removeAttribute === "function") root.removeAttribute("hidden");
    const body = _doc.body || (root.ownerDocument && root.ownerDocument.body);
    if (body && body.classList && typeof body.classList.add === "function") {
      body.classList.add("monitor-active");
    }

    // ── Build the skeleton ──
    const globalBarRoot = _doc.createElement("div");
    globalBarRoot.className = "global-bar";
    globalBarRoot.setAttribute("role", "region");
    globalBarRoot.setAttribute("aria-label", "Monitor global bar");
    const errorBox = _doc.createElement("div");
    errorBox.className = "gb-error";
    errorBox.setAttribute("hidden", "");
    errorBox.setAttribute("role", "alert");

    // Slice MA4: shell-body row hosts left rail (run-tree) + centre
    // workspace (run-summary). The two regions are siblings so MA5 can
    // append a third (right inspector) without restructuring.
    const shellBody = _doc.createElement("div");
    shellBody.className = "shell-body";
    shellBody.setAttribute("role", "region");
    shellBody.setAttribute("aria-label", "Monitor body");

    const runRail = _doc.createElement("div");
    runRail.className = "run-rail";
    runRail.setAttribute("role", "navigation");
    runRail.setAttribute("aria-label", "Runs");

    const centerWs = _doc.createElement("div");
    centerWs.className = "center-workspace";
    centerWs.setAttribute("role", "region");
    centerWs.setAttribute("aria-label", "Selected run");

    shellBody.appendChild(runRail);
    shellBody.appendChild(centerWs);

    root.innerHTML = "";
    root.appendChild(globalBarRoot);
    root.appendChild(errorBox);
    root.appendChild(shellBody);

    function showError(msg) {
      errorBox.removeAttribute("hidden");
      errorBox.textContent = "monitor: " + msg;
    }
    function clearError() {
      errorBox.setAttribute("hidden", "");
      errorBox.textContent = "";
    }

    // ── Mount the global-bar panel ──
    let panelHandle = null;
    const GlobalBar = _resolvePanel(panels, "globalBar", "HarnessMonitorGlobalBar");
    if (GlobalBar) {
      panelHandle = GlobalBar.create({
        root: globalBarRoot,
        store,
        doc: _doc,
        onClose() {
          // Hide the shell without persistence — the user can re-show by
          // reloading with ?monitor=1 or re-setting localStorage.
          root.classList.remove("is-active");
          if (body && body.classList && typeof body.classList.remove === "function") {
            body.classList.remove("monitor-active");
          }
        },
      });
    }

    // ── Slice MA4: mount the run-tree (left rail) + run-summary (centre) ──
    let runTreeHandle = null;
    const RunTree = _resolvePanel(panels, "runTree", "HarnessMonitorRunTree");
    if (RunTree) {
      runTreeHandle = RunTree.create({
        root: runRail,
        store,
        doc: _doc,
        onSelect(runId) {
          // Wire to the store so the run-summary panel re-renders on its
          // own subscription. We don't carry selection state in layout —
          // the store is the single source of truth.
          if (typeof store.selectRun === "function") store.selectRun(runId);
        },
      });
    }

    let runSummaryHandle = null;
    const RunSummary = _resolvePanel(panels, "runSummary", "HarnessMonitorRunSummary");
    if (RunSummary) {
      runSummaryHandle = RunSummary.create({
        root: centerWs,
        store,
        doc: _doc,
      });
    }

    // ── Kick off hydration ──
    const hydrateFn = _resolveHydrate(hydrate);
    let hydrationPromise = Promise.resolve();
    if (typeof hydrateFn === "function" && typeof normalize === "function") {
      hydrationPromise = hydrateFn({
        store,
        normalize,
        fetchImpl,
        headers,
      })
        .then(() => clearError())
        .catch((err) => {
          showError(err && err.message ? err.message : String(err));
        });
    }

    return {
      hydrationPromise,
      destroy() {
        try { panelHandle && panelHandle.destroy && panelHandle.destroy(); } catch (_) {}
        try { runTreeHandle && runTreeHandle.destroy && runTreeHandle.destroy(); } catch (_) {}
        try { runSummaryHandle && runSummaryHandle.destroy && runSummaryHandle.destroy(); } catch (_) {}
        root.classList.remove("is-active");
        root.classList.remove("monitor-shell");
        if (typeof root.setAttribute === "function") root.setAttribute("hidden", "");
        if (body && body.classList && typeof body.classList.remove === "function") {
          body.classList.remove("monitor-active");
        }
        root.innerHTML = "";
      },
      // Test hooks (prefixed _).
      _showError: showError,
      _clearError: clearError,
      _errorBox: errorBox,
      _globalBarRoot: globalBarRoot,
      _runRail: runRail,
      _centerWs: centerWs,
      _shellBody: shellBody,
    };
  }

  return { mount };
});
