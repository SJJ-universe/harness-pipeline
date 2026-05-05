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
      // UI-P7: accept the deprecated `?mode=advanced` alias and coerce
      // to `pro` per ui-reference-port-plan.md §4 routing table. The
      // alias is removed at UI-P9; tests + bookmarks keep working
      // until then. ?mode=legacy is intercepted by server.js (server-
      // side redirect). Anything else falls through to localStorage.
      if (qs === "pro" || qs === "simple") return qs;
      if (qs === "advanced") return "pro";
    } catch (_) { /* defensive */ }
    try {
      const ls = window.localStorage && window.localStorage.getItem("harness:ui-mode");
      if (ls === "pro" || ls === "simple") return ls;
      if (ls === "advanced") return "pro";
    } catch (_) { /* defensive */ }
    return m;
  }

  function _persistMode(mode) {
    try {
      window.localStorage && window.localStorage.setItem("harness:ui-mode", mode);
    } catch (_) { /* defensive — private browsing / quota / etc. */ }
  }

  function _resolveDemoMode() {
    try {
      const url = new URL(window.location.href);
      const qs = url.searchParams.get("demo");
      if (qs === "1" || qs === "true") return true;
      if (qs === "0" || qs === "false") return false;
    } catch (_) { /* defensive */ }
    try {
      const ls = window.localStorage && window.localStorage.getItem("harness:demo-mode");
      return ls === "1" || ls === "true";
    } catch (_) { return false; }
  }

  // UI-P7: locale resolution defers to HarnessI18n which already owns
  // the localStorage key (`harness:lang`) and the supported set
  // (`["ko", "en"]`). Falling back to "ko" matches the i18n module's
  // own DEFAULT.
  function _resolveLocale() {
    try {
      if (window.HarnessI18n && typeof window.HarnessI18n.getLang === "function") {
        const lg = window.HarnessI18n.getLang();
        if (lg === "ko" || lg === "en") return lg;
      }
    } catch (_) { /* defensive */ }
    return "ko";
  }

  function _hydrateInitialStore(store) {
    const hydrator = window.HarnessMonitorHydrate;
    const normalizer = window.HarnessMonitorNormalizer;
    if (!hydrator || typeof hydrator.hydrateMonitorStore !== "function") return;
    if (!normalizer || typeof normalizer.normalize !== "function") return;

    Promise.resolve(hydrator.hydrateMonitorStore({
      store: store,
      normalize: normalizer.normalize,
    })).then(function (result) {
      const snap = result && result.snapshot;
      const runId = snap && snap.selectedRunId;
      if (runId && typeof hydrator.hydrateRunDetail === "function") {
        return hydrator.hydrateRunDetail({ store: store, runId: runId })
          .catch(function (err) {
            console.warn("[product-shell] run detail hydrate failed:",
              err && err.message ? err.message : err);
          });
      }
      return null;
    }).catch(function (err) {
      console.warn("[product-shell] bootstrap hydrate failed:",
        err && err.message ? err.message : err);
    });
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
    const locale = _resolveLocale();
    const demoMode = _resolveDemoMode();
    const store = window.HarnessMonitorStore.createMonitorStore();

    // UI-P6: instantiate the review-relay client when the script is
    // loaded. The client is a thin wrapper over /api/review-sessions/*
    // — methods like createSession/sendToCodex are bound functions, NOT
    // a class instance, so we just expose the module's namespace.
    const reviewClient = (typeof window.HarnessReviewSessionClient === "object")
      ? window.HarnessReviewSessionClient
      : null;

    // PRODUCT-SHELL-WIRING: build the action handler map from
    // window.HarnessShellActions (loaded by index.html before this
    // init script). Each handler receives env defaults plus an
    // optional per-call payload from the dispatcher. The default
    // env supplies window/document/fetch/confirm + a toast adapter
    // that wraps window.HarnessToast.show. Tests inject their own
    // actionHandlers via window.HarnessProductShell.mount opts.
    function _toastAdapter(payload) {
      if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
        try { window.HarnessToast.show(payload); } catch (_) {}
      }
    }
    // PRODUCT-SHELL-WIRING: when the lazy-DOM modal submits a task,
    // its `addLog` callback is the only way to surface "started"
    // feedback in the product shell (legacy view shows a phase log
    // entry; product shell has no log panel). Bridge addLog → toast
    // so the operator sees a confirmation when the run kicks off.
    function _addLogAdapter(_kind, message) {
      if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
        try {
          window.HarnessToast.show({
            kind: "info",
            message: message,
            duration: 3500,
          });
        } catch (_) { /* defensive */ }
      }
    }
    const actionHandlers = (window.HarnessShellActions
        && typeof window.HarnessShellActions.createDefaultHandlers === "function")
      ? window.HarnessShellActions.createDefaultHandlers({
          win: window,
          doc: document,
          fetchImpl: (typeof fetch === "function") ? fetch : null,
          confirmFn: (typeof confirm !== "undefined") ? confirm : null,
          toastFn: _toastAdapter,
          addLog: _addLogAdapter,
        })
      : null;

    let handle;
    try {
      handle = window.HarnessProductShell.mount({
        root: rootEl,
        store: store,
        mode: mode,
        locale: locale,
        allowMockData: demoMode,
        reviewClient: reviewClient,
        actionHandlers: actionHandlers,
        onActionMissing: function (id) {
          // Forensic only — the shell's _dispatch already swallows
          // missing-handler clicks so the UI stays responsive.
          console.warn("[product-shell] no handler for action:", id);
        },
        onModeChange: function (next) {
          _persistMode(next);
        },
        // UI-P7: locale toggle in the header → shell.setLocale → here.
        // We delegate persistence to HarnessI18n.setLang which writes
        // `harness:lang` localStorage and dispatches the lang-changed
        // CustomEvent that legacy panels also listen on.
        onLocaleChange: function (next) {
          try {
            if (window.HarnessI18n && typeof window.HarnessI18n.setLang === "function") {
              window.HarnessI18n.setLang(next, { persist: true, applyNow: true });
            }
          } catch (err) {
            console.warn("[product-shell] setLang failed:",
              err && err.message ? err.message : err);
          }
        },
        onPanelError: function (err) {
          // Surface panel errors to console + toast (when available)
          // so the operator notices when an action row request fails.
          console.warn("[product-shell] panel error:",
            err && err.message ? err.message : err);
          try {
            if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
              window.HarnessToast.show({
                kind: "error",
                message: (err && err.message)
                  ? "Review relay 오류: " + err.message
                  : "Review relay 오류 발생",
              });
            }
          } catch (_) { /* defensive */ }
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

    _hydrateInitialStore(store);

    // Expose for tests + the eventual settings-accounts modal that
    // needs a handle to the running shell.
    window.__HarnessProductShell = {
      handle: handle,
      store: store,
      mode: mode,
      locale: locale,
      demoMode: demoMode,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", _bootProductShell);
  } else {
    _bootProductShell();
  }
})();
