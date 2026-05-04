// Slice UI-P1-g (Phase 2 Round 3, 2026-04-30) — product shell init.
//
// Boot script for the product shell. Loaded last by index.html so all
// other modules (HarnessMonitorStore, HarnessProductShell, panel
// factories) are available on `window`.
//
// Mode resolution priority (per §S sign-off decision 1):
//   1. URL ?mode=simple|pro|legacy (legacy already redirected by
//      server-side branch — never reaches this script)
//   2. localStorage.getItem("harness:ui-mode")
//   3. Default "simple" (sign-off decision 1)
//
// CSP-compliant — this script lives in a separate file, not inline,
// so it gets a per-request nonce from indexRenderer.

(function () {
  "use strict";

  function _resolveMode() {
    let m = "simple";
    try {
      const url = new URL(window.location.href);
      const qs = url.searchParams.get("mode");
      if (qs === "pro" || qs === "simple") return qs;
      // ?mode=legacy is intercepted by server.js — if we see it here,
      // the server didn't redirect (older harness or test fixture).
      // Fall through to localStorage.
    } catch (_) { /* defensive */ }
    try {
      const ls = window.localStorage && window.localStorage.getItem("harness:ui-mode");
      if (ls === "pro" || ls === "simple") return ls;
    } catch (_) { /* defensive */ }
    return m;
  }

  function _persistMode(mode) {
    try {
      window.localStorage && window.localStorage.setItem("harness:ui-mode", mode);
    } catch (_) { /* defensive — private browsing / quota / etc. */ }
  }

  function _bootProductShell() {
    const rootEl = document.getElementById("product-shell-root");
    if (!rootEl) {
      console.error("[product-shell] #product-shell-root not found");
      return;
    }
    if (typeof window.HarnessProductShell === "undefined") {
      console.error("[product-shell] HarnessProductShell module missing");
      return;
    }
    if (typeof window.HarnessMonitorStore === "undefined") {
      console.error("[product-shell] HarnessMonitorStore module missing");
      return;
    }

    const mode = _resolveMode();
    const store = window.HarnessMonitorStore.createMonitorStore();

    let handle;
    try {
      handle = window.HarnessProductShell.mount({
        root: rootEl,
        store: store,
        mode: mode,
        onModeChange: function (next) {
          _persistMode(next);
        },
      });
    } catch (err) {
      console.error("[product-shell] mount failed:", err && err.message ? err.message : err);
      return;
    }

    // Wire the legacy bridge so ws-client events flow into the store
    // the product shell subscribes to. UI-P5 expands the bridge with
    // run-summary / approval / review-session sync; UI-P1 just wires
    // the basic event tap so the status pill can react to live runs.
    try {
      if (window.HarnessMonitorLegacyBridge
          && typeof window.HarnessMonitorLegacyBridge.install === "function") {
        // The bridge needs an existing ws-client + normalizer. Install
        // is no-op when ws-client isn't ready yet — bridge polls.
        window.HarnessMonitorLegacyBridge.install({
          store: store,
          normalize: window.HarnessMonitorNormalizer
            && window.HarnessMonitorNormalizer.normalize,
        });
      }
    } catch (err) {
      console.warn("[product-shell] legacy-bridge install failed:", err && err.message ? err.message : err);
    }

    // Expose for tests + the eventual settings-accounts modal that
    // needs a handle to the running shell.
    window.__HarnessProductShell = {
      handle: handle,
      store: store,
      mode: mode,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bootProductShell);
  } else {
    _bootProductShell();
  }
})();
