// Slice K (v5) — WebSocket client with auto-reconnect, extracted from app.js.
//
// UMD following the window.HarnessXxx convention used by toast / focus-trap
// / i18n. Keeps the dashboard's connection & reconnect lifecycle in one
// self-contained surface so regressions in that area are easy to pinpoint.
//
// Callback-driven (never imports app state):
//   - onEvent(event)         → every parsed WS message
//   - onConnected()          → the very first open after install()
//   - onReconnected()        → every subsequent open (after a disconnect)
//   - onDisconnected()       → close that followed at least one open
//   - onInitialError({retry}) → error before we ever connected (actionable)
//
// The caller owns UX concerns (toasts, badges, pipeline-active gating); the
// client just publishes the connection's state transitions.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessWsClient = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  // Injectable for tests — Node tests replace this with a mock constructor.
  function _WebSocket() {
    return typeof WebSocket !== "undefined" ? WebSocket : null;
  }

  function install({
    url,
    onEvent,
    onConnected,
    onReconnected,
    onDisconnected,
    onInitialError,
    reconnectMs = 2000,
    WebSocketCtor = null,   // test hook
    setTimeoutFn = null,    // test hook
  } = {}) {
    const WS = WebSocketCtor || _WebSocket();
    if (typeof WS !== "function") {
      // Silent no-op in environments without a WebSocket (SSR / Node smoke).
      return {
        getLastEventAt: () => 0,
        isConnected: () => false,
        close: () => {},
        getRawSocket: () => null,
      };
    }
    const _setTimeout = setTimeoutFn || (typeof setTimeout !== "undefined" ? setTimeout : null);

    let ws = null;
    let wasConnected = false;
    let lastEventAt = Date.now();
    let userClosed = false;

    function _connect() {
      if (userClosed) return;
      ws = new WS(url);
      ws.onopen = () => {
        lastEventAt = Date.now();
        if (wasConnected) {
          if (typeof onReconnected === "function") onReconnected();
        } else {
          if (typeof onConnected === "function") onConnected();
        }
        wasConnected = true;
      };
      ws.onmessage = (e) => {
        lastEventAt = Date.now();
        if (typeof onEvent !== "function") return;
        let parsed;
        try {
          parsed = JSON.parse(e && e.data);
        } catch (_) {
          return; // malformed payload — drop silently
        }
        onEvent(parsed);
      };
      ws.onclose = () => {
        if (wasConnected && typeof onDisconnected === "function") onDisconnected();
        if (!userClosed && _setTimeout) _setTimeout(_connect, reconnectMs);
      };
      ws.onerror = () => {
        if (!wasConnected && typeof onInitialError === "function") {
          onInitialError({
            retry: () => {
              try { ws && ws.close && ws.close(); } catch (_) {}
              _connect();
            },
          });
        }
      };
    }

    _connect();

    return {
      getLastEventAt: () => lastEventAt,
      isConnected: () => {
        if (!ws) return false;
        // WebSocket.OPEN === 1 in the browser spec; mirror it here so the
        // test mock works even without the constant exported.
        return ws.readyState === (WS.OPEN != null ? WS.OPEN : 1);
      },
      /**
       * Slice AA-2 (Phase 2.5, v6) — client-to-server send helper.
       *
       * Added to support `replay_request` (tab switch → server re-emits
       * run-scoped replay). Serializes non-string payloads as JSON and
       * silently no-ops if the socket is not OPEN so callers do not have
       * to guard every send. Returns true when the frame was handed off
       * to the underlying WebSocket, false when dropped.
       */
      send: (payload) => {
        if (!ws) return false;
        const openCode = WS.OPEN != null ? WS.OPEN : 1;
        if (ws.readyState !== openCode) return false;
        try {
          ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
          return true;
        } catch (_) {
          return false;
        }
      },
      close: () => {
        userClosed = true;
        try { ws && ws.close && ws.close(); } catch (_) {}
      },
      getRawSocket: () => ws,
    };
  }

  return { install };
});
