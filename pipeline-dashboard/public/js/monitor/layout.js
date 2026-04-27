// Slice MA3 (Phase D, 2026-04-27) — HarnessMonitorLayout.
//
// Mounts the monitor shell into a host element, kicks off hydration, and
// instantiates each panel. This slice ships ONLY the global-bar panel;
// MA4/MA5 will populate the left rail / center workspace / right inspector
// / bottom dock by registering more entries in the `panels` map.
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
//   - panels      : { globalBar?: { create({root,store,onClose,doc}) } }
//                   Defaults to window.HarnessMonitorGlobalBar in browsers.
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

    root.innerHTML = "";
    root.appendChild(globalBarRoot);
    root.appendChild(errorBox);

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
    };
  }

  return { mount };
});
