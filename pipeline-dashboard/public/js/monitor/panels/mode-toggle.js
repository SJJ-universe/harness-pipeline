// Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30) — mode-toggle panel.
//
// Three-button pill group that lets the operator switch between
// simple / advanced / legacy shells without editing the URL. The
// click handler:
//
//   1. Writes the selected mode to localStorage (OrchestratorMonitorMode.persistMode).
//   2. Reloads the page (mode change is destructive of the panel
//      mount; reload is the simplest correctness story).
//
// Why reload instead of swapping panels in place:
//
//   - Simple mode mounts a different shell (UI-H6) than advanced
//     (existing 9-panel layout). Swapping in place would require
//     a full destroy + remount + bridge re-init dance — error-
//     prone vs. a clean reload.
//   - Operators changing modes is rare (typically once per session).
//     The reload latency is acceptable for the gain in simplicity.
//
// Side effects via constructor injection:
//   reloadFn          - test stub for window.location.reload
//   storage           - test stub for window.localStorage
//   doc               - document for createElement / event listeners

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorModeToggle = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Mode → operator-friendly Korean + English label pair (matches the
  // mockup's "일반사용자 / Simple" pattern).
  const MODE_LABELS = Object.freeze({
    simple:   { ko: "일반사용자", en: "Simple"   },
    advanced: { ko: "전문사용자", en: "Advanced" },
    legacy:   { ko: "레거시",     en: "Legacy"   },
  });

  function create({
    root,
    currentMode,
    onModeSelect,
    reloadFn,
    storage,
    doc,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("mode-toggle.create: root must be an element");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("mode-toggle.create: no document available");
    }
    const _reload = typeof reloadFn === "function"
      ? reloadFn
      : (typeof window !== "undefined" && window.location
          ? () => window.location.reload() : null);
    const _storage = storage
      || (typeof window !== "undefined" && window.localStorage
            ? window.localStorage : null);

    // Resolve OrchestratorMonitorMode: try CommonJS require (test path)
    // first, then window global (browser path).
    let MonitorMode = null;
    try { MonitorMode = require("../mode"); } catch (_) { /* no-op */ }
    if (!MonitorMode && typeof window !== "undefined") {
      MonitorMode = window.OrchestratorMonitorMode;
    }
    if (!MonitorMode || typeof MonitorMode.persistMode !== "function") {
      throw new Error("mode-toggle.create: OrchestratorMonitorMode unavailable");
    }

    const validModes = MonitorMode.MODES || ["simple", "advanced", "legacy"];
    let active = validModes.includes(currentMode) ? currentMode : "simple";

    function _onClick(mode) {
      if (mode === active) return;  // no-op for current mode
      // Persist selection so the post-reload mount picks it up.
      MonitorMode.persistMode(mode, _storage);
      // Optional caller hook for tests + future SPA routing.
      if (typeof onModeSelect === "function") {
        try { onModeSelect(mode); } catch (_) { /* defensive */ }
      }
      if (typeof _reload === "function") {
        try { _reload(); } catch (_) { /* defensive */ }
      }
      // The page reloads — DOM updates after this point are wasted.
    }

    function render() {
      root.innerHTML = "";
      root.classList.add("mt-toggle");
      root.setAttribute("role", "group");
      root.setAttribute("aria-label", "Monitor mode");

      for (const mode of validModes) {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "mt-btn" + (mode === active ? " is-active" : "");
        btn.setAttribute("data-mode", mode);
        btn.setAttribute("aria-pressed", mode === active ? "true" : "false");

        const labels = MODE_LABELS[mode] || { ko: mode, en: mode };
        const ko = _doc.createElement("span");
        ko.className = "mt-btn-ko";
        ko.textContent = labels.ko;
        const en = _doc.createElement("span");
        en.className = "mt-btn-en";
        en.textContent = labels.en;

        btn.appendChild(ko);
        btn.appendChild(en);
        btn.addEventListener("click", () => _onClick(mode));
        root.appendChild(btn);
      }
    }

    render();

    return {
      destroy() {
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("mt-toggle");
      },
      // Test hooks
      _click: _onClick,
      _activeMode() { return active; },
      _setActive(mode) {
        if (validModes.includes(mode)) {
          active = mode;
          render();
        }
      },
    };
  }

  return { create, MODE_LABELS };
});
