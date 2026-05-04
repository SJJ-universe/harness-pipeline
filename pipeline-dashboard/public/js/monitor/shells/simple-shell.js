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
    onFirstRunCta,           // UI-FirstRun-c: next-action-card CTA dispatcher
    onTestProvider,          // UI-FirstRun-c: test-claude / test-codex CTA
    onAuthProvider,          // UI-FirstRun-c: auth-claude / auth-codex CTA
    onPublicSectorSetup,     // UI-FirstRun-c: open-public-sector-setup CTA
    onSmartCta,              // SMART-1-c: recommendations-card CTA dispatcher
    storage,                 // UI-H8: localStorage shim for tests
    i18n,                    // UI-FirstRun-c: i18n module for next-action-card
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

    // Slice UI-FirstRun-c (2026-05-04): mount the next-action-card
    // BETWEEN the welcome banner and the 4-card grid. Welcome-overlay
    // covers the "completely empty state" hero treatment; this card
    // is the persistent "what to do next" surface that stays visible
    // even when a profile is active.
    //
    // CTA dispatcher: onFirstRunCta(ctaId, meta) is the single
    // injection seam. The init script wires it to a switch over
    // the 9 CTA IDs (open-setup-wizard / open-settings-profiles /
    // test-claude / test-codex / etc). Tests can ignore this prop
    // and the card will simply be uninteractive.
    const firstRunMount = _doc.createElement("div");
    firstRunMount.className = "ss-first-run-mount";
    root.appendChild(firstRunMount);

    _mount("nextActionCard", "HarnessNextActionCard", firstRunMount, {
      i18n,
      onCta: function (ctaId, meta) {
        if (typeof onFirstRunCta === "function") {
          try { onFirstRunCta(ctaId, meta); } catch (_) {}
          return;
        }
        // Sensible default dispatch when caller didn't wire onFirstRunCta:
        // route well-known CTAs to specialized callbacks if those are
        // wired. Keeps the card useful in partial-wiring scenarios.
        if ((ctaId === "open-setup-wizard"
             || ctaId === "reopen-setup-for-providers"
             || ctaId === "create-profile") && typeof onOpenSetupWizard === "function") {
          try { onOpenSetupWizard(); } catch (_) {}
        } else if ((ctaId === "open-settings-profiles"
                    || ctaId === "open-public-sector-setup") && typeof onOpenSettings === "function") {
          try { onOpenSettings(); } catch (_) {}
        } else if ((ctaId === "test-claude" || ctaId === "test-codex") && typeof onTestProvider === "function") {
          try { onTestProvider(ctaId === "test-claude" ? "claude" : "codex"); } catch (_) {}
        } else if ((ctaId === "auth-claude" || ctaId === "auth-codex") && typeof onAuthProvider === "function") {
          try { onAuthProvider(ctaId === "auth-claude" ? "claude" : "codex"); } catch (_) {}
        }
        // No matching handler → CTA is a no-op (operator at least
        // sees the next-action message even if the action isn't
        // wired in this deployment).
      },
    });

    // Slice SMART-1-c (Phase 2 SMART arc, 2026-05-04): mount
    // recommendations-card immediately AFTER the next-action-card.
    // Both surfaces inform the operator of "what to do next" but at
    // different granularities:
    //   - next-action-card: setup status + first-run state (UI-FirstRun)
    //   - recommendations-card: live decisionContext-driven prioritized
    //     recommendations (SMART arc)
    // CTA dispatch is forwarded to the same callbacks where overlap
    // exists (open-setup-wizard / open-settings); SMART-1-specific
    // CTAs (scroll-to-approval-card / open-review-sessions /
    // open-recent-results / open-audit-export / open-security-policy)
    // route through onSmartCta if wired.
    const recsMount = _doc.createElement("div");
    recsMount.className = "ss-recs-mount";
    root.appendChild(recsMount);

    _mount("recommendationsCard", "HarnessRecommendationsCard", recsMount, {
      i18n,
      onCta: function (ctaId, opts) {
        if (typeof onSmartCta === "function") {
          try { onSmartCta(ctaId, opts); } catch (_) {}
          return;
        }
        // Sensible default dispatch — overlap with first-run CTAs +
        // 5 SMART-1-specific actions:
        if (ctaId === "open-setup-wizard" && typeof onOpenSetupWizard === "function") {
          try { onOpenSetupWizard(); } catch (_) {}
        } else if (ctaId === "scroll-to-approval-card" && typeof onApprovalsClick === "function") {
          try { onApprovalsClick(); } catch (_) {}
        } else if ((ctaId === "open-review-sessions"
                    || ctaId === "open-recent-results"
                    || ctaId === "open-audit-export"
                    || ctaId === "open-security-policy")
                   && typeof onOpenSettings === "function") {
          // For now route SMART-1-specific CTAs to settings as a
          // safe fallback. Future SMART rounds can refine each.
          try { onOpenSettings(); } catch (_) {}
        }
        // Unmatched CTA → silent no-op (recommendation still visible)
      },
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
