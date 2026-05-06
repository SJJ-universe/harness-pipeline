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

  // PRODUCT-SHELL-WIRING: WebSocket client installer for the product
  // shell. Mirrors `connectWS()` in legacy app.js but feeds the
  // dispatcher only — no `handleEvent()` switch (legacy DOM paths
  // are not in scope for the product shell). The WS client itself
  // is shared (`public/js/ws-client.js` already loaded by index.html);
  // we just configure callbacks here.
  function _installWsClient(store) {
    if (!window.HarnessWsClient || typeof window.HarnessWsClient.install !== "function") {
      console.warn("[product-shell] HarnessWsClient missing — live events will not flow");
      return null;
    }
    if (!window.HarnessEventDispatcher
        || typeof window.HarnessEventDispatcher.dispatch !== "function") {
      console.warn(
        "[product-shell] HarnessEventDispatcher missing — bridge tap will not fire; "
        + "check that event-dispatcher.js loads before product-shell-init.js",
      );
      return null;
    }
    const protocol = (window.location && window.location.protocol === "https:") ? "wss:" : "ws:";
    const host = (window.location && window.location.host) || "127.0.0.1:4201";
    function _toast(payload) {
      if (window.HarnessToast && typeof window.HarnessToast.show === "function") {
        try { window.HarnessToast.show(payload); } catch (_) { /* defensive */ }
      }
    }
    try {
      const client = window.HarnessWsClient.install({
        url: protocol + "//" + host,
        onEvent: function (event) {
          // Forward to the dispatcher. The legacy-bridge tap (registered
          // when HarnessMonitorLegacyBridge.install ran above) catches
          // every event, normalizes, and pushes to store.pushEvent —
          // panels re-render through their store subscriptions.
          try { window.HarnessEventDispatcher.dispatch(event); }
          catch (err) {
            console.warn("[product-shell] dispatch failed for event:",
              event && event.type, err && err.message ? err.message : err);
          }
        },
        onConnected: function () {
          // Quiet on first connect — most operators expect online by default.
        },
        onReconnected: function () {
          _toast({ kind: "info", message: "서버에 다시 연결되었습니다.", duration: 2500 });
        },
        onDisconnected: function () {
          _toast({ kind: "warn", message: "서버 연결이 끊겼습니다 — 재연결 중...", duration: 4000 });
        },
        onInitialError: function (info) {
          _toast({
            kind: "error",
            message: "서버에 연결할 수 없습니다.",
            duration: 6000,
          });
          if (info && typeof info.retry === "function") {
            // Schedule one retry attempt after the toast animates;
            // operator can also refresh the page if this fails again.
            try { setTimeout(info.retry, 2000); } catch (_) {}
          }
        },
      });
      // Stash on window so debugging from the console works the same
      // way it does in the legacy view (`window._wsClient`).
      window._wsClient = client;
      return client;
    } catch (err) {
      console.error("[product-shell] WS install failed:",
        err && err.message ? err.message : err);
      return null;
    }
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
        // AGENT-DESKTOP-0-c (2026-05-06): the chat panel surfaces
        // [system] confirmations (e.g. "✓ 시작했습니다") and any
        // error fallbacks via this same toast adapter the rest of
        // the shell uses. Passed down through product-shell.mount
        // → chatFactory's opts.toastFn.
        toastFn: _toastAdapter,
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
        // The bridge subscribes to HarnessEventDispatcher via addTap
        // — it needs the dispatcher to be loaded AND fed by the WS
        // client (see _installWsClient below). install() returns a
        // handle whose destroy() unhooks both the tap and the
        // /api/server/info polling interval.
        window.HarnessMonitorLegacyBridge.install({
          store: store,
          normalize: window.HarnessMonitorNormalizer
            && window.HarnessMonitorNormalizer.normalize,
        });
      }
    } catch (err) {
      console.warn("[product-shell] legacy-bridge install failed:", err && err.message ? err.message : err);
    }

    // PRODUCT-SHELL-WIRING (rc.5 prep, 2026-05-06): install the WS
    // client so server events flow → HarnessEventDispatcher.dispatch
    // → legacy-bridge tap → store.pushEvent → panel re-render.
    //
    // Pre-rc.5 the product shell mounted the bridge but had nobody
    // feeding the dispatcher — the WS client was only initialized in
    // legacy app.js. Result: operator clicked 시작, server started a
    // run, but the UI status pill stayed "대기 중" forever because no
    // WebSocket events ever reached the store.
    //
    // The product shell does NOT need legacy app.js's `handleEvent()`
    // 200-line switch — that drives legacy DOM directly. Forwarding
    // each event into the dispatcher is enough; the bridge's
    // wildcard tap normalizes and pushes to store, which is what
    // every product panel reads.
    _installWsClient(store);

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
