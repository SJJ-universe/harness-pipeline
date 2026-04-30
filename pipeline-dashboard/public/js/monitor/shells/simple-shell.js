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
    if (!globalName) return null;
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
    onApprovalsClick,        // jump to approval-card region
    onOpenSettings,          // toggle settings modal visibility
    onOpenSetupWizard,       // UI-H8: launch setup wizard guide / modal
    onCreatePersonal,        // UI-H8: quick-create personal profile
    onSelectRun,             // UI-H9: open run-viewer for a runId
    storage,                 // UI-H8: localStorage shim for tests
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

    // Slice UI-H8 (2026-04-30): mount the welcome overlay BEFORE the
    // grid so a first-run operator sees "프로필이 필요합니다" at the
    // top of their viewport. The overlay self-hides when an active
    // profile is present, so users with a configured profile see no
    // banner. Mounted via _mount so the test harness can inject a
    // panel stub or the live page can rely on the global.
    const overlayMount = _doc.createElement("div");
    overlayMount.className = "ss-welcome-mount";
    root.appendChild(overlayMount);

    const grid = _doc.createElement("div");
    grid.className = "ss-grid";

    function _makeCell() {
      const cell = _doc.createElement("div");
      cell.className = "ss-cell";
      grid.appendChild(cell);
      return cell;
    }

    const handles = [];
    function _mount(panelKey, globalName, mountRoot, opts) {
      const Panel = _resolvePanel(panels, panelKey, globalName);
      if (!Panel) return;
      try {
        const handle = Panel.create({ root: mountRoot, store, doc: _doc, ...opts });
        if (handle) handles.push(handle);
      } catch (_) { /* never break the shell on a panel-init fault */ }
    }

    // UI-H8 banner (above the grid). Hidden when a profile is active.
    // Resolves via panels.welcomeOverlay first; falls back to
    // window.HarnessMonitorWelcomeOverlay (browser) or
    // globalThis.HarnessMonitorWelcomeOverlay. Tests that don't want
    // this card simply don't inject it AND don't require its module —
    // node --test isolates each file in its own process so globalThis
    // is clean per file.
    _mount("welcomeOverlay", "HarnessMonitorWelcomeOverlay", overlayMount, {
      onOpenSetupWizard,
      onCreatePersonal,
      onOpenSettings,
      storage,
    });

    // Card 1: 지금 AI가 하는 일
    _mount("nowDoing", "HarnessMonitorNowDoingCard", _makeCell());
    // Card 2: 승인 필요
    _mount("pendingApprovals", "HarnessMonitorPendingApprovalsCard", _makeCell(), {
      onClick: onApprovalsClick,
    });
    // Card 3: 최근 결과 (clickable rows when onSelectRun is wired)
    _mount("recentResults", "HarnessMonitorRecentResultsCard", _makeCell(), {
      onSelectRun,
    });
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
