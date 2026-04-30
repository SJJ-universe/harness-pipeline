// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — Simple shell orchestrator.
//
// The operator-friendly first-paint view per UI Plan §UX-H6. Mounts
// 4 cards in a responsive grid:
//
//   [지금 AI가 하는 일] [승인 필요]
//   [최근 결과]         [연결 상태]
//
// The 5th card (보안 / 개인정보 상태) is the security-status-card
// (UI-H5) which the layout already mounts in its own region above
// the simple shell. So the simple shell focuses on the operator-
// workflow trio + connection status.
//
// Design: cards are independent panels. simple-shell.js just
// orchestrates the grid layout + sequential mount + tear-down.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorSimpleShell = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolvePanel(panels, key, globalName) {
    if (panels && panels[key] && typeof panels[key].create === "function") {
      return panels[key];
    }
    if (typeof window !== "undefined" && window[globalName]) {
      return window[globalName];
    }
    if (typeof globalThis !== "undefined" && globalThis[globalName]) {
      return globalThis[globalName];
    }
    return null;
  }

  function mount({
    root, store, doc,
    panels = {},
    onApprovalsClick,    // jump to approval-card region
    onOpenSettings,      // toggle settings modal visibility
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("simple-shell.mount: root must be an element");
    }
    if (!store) throw new Error("simple-shell.mount: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("simple-shell.mount: no document available");

    root.innerHTML = "";
    root.classList.add("simple-shell");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Simple dashboard");

    const grid = _doc.createElement("div");
    grid.className = "ss-grid";

    function _makeCell() {
      const cell = _doc.createElement("div");
      cell.className = "ss-cell";
      grid.appendChild(cell);
      return cell;
    }

    const handles = [];
    function _mount(panelKey, globalName, cell, opts) {
      const Panel = _resolvePanel(panels, panelKey, globalName);
      if (!Panel) return;
      try {
        const handle = Panel.create({ root: cell, store, doc: _doc, ...opts });
        if (handle) handles.push(handle);
      } catch (_) { /* never break the shell on a panel-init fault */ }
    }

    // Card 1: 지금 AI가 하는 일
    _mount("nowDoing", "HarnessMonitorNowDoingCard", _makeCell());
    // Card 2: 승인 필요
    _mount("pendingApprovals", "HarnessMonitorPendingApprovalsCard", _makeCell(), {
      onClick: onApprovalsClick,
    });
    // Card 3: 최근 결과
    _mount("recentResults", "HarnessMonitorRecentResultsCard", _makeCell());
    // Card 4: Claude / Codex 연결 상태
    _mount("connectionStatus", "HarnessMonitorConnectionStatusCard", _makeCell(), {
      onOpenSettings,
    });

    root.appendChild(grid);

    return {
      destroy() {
        for (const h of handles) {
          try { h.destroy && h.destroy(); } catch (_) {}
        }
        handles.length = 0;
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("simple-shell");
      },
      _handleCount() { return handles.length; },
    };
  }

  return { mount };
});
