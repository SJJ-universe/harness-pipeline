// Slice MB4-c (Phase D Round 2, 2026-04-27) — terminal-mount.
//
// Behaviour-preserving lift of the legacy `initTerminal()` + lazy mount
// out of public/app.js. The module owns the term + termWs state and
// the auto-`claude --continue` boot dance. app.js calls
// OrchestratorTerminalMount.mount() lazily on the first tab switch to
// "terminal" — same trigger semantics as before.
//
// Contract (return value of install()):
//   mount({ containerId? })  → mounts xterm + opens /terminal ws
//   dispose()                → closes ws + disposes term
//   isMounted()              → boolean
//
// Tests cover the public surface with stub xterm + stub WebSocket.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorTerminalMount = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function install({
    TerminalCtor = null,
    FitAddonCtor = null,
    WebSocketCtor = null,
    locationProtocol = null,
    locationHost = null,
    apiTokenGetter = null,    // async () → token
    doc = null,
  } = {}) {
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    const T = TerminalCtor
      || (typeof globalThis !== "undefined" && globalThis.Terminal);
    const Fit = FitAddonCtor
      || (typeof globalThis !== "undefined" && globalThis.FitAddon && globalThis.FitAddon.FitAddon);
    const WSCtor = WebSocketCtor
      || (typeof globalThis !== "undefined" && globalThis.WebSocket);

    let term = null;
    let termWs = null;
    let resizeObserver = null;
    let mounted = false;

    async function mount({ containerId = "terminal-container" } = {}) {
      if (mounted) return;
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const container = _doc.getElementById(containerId);
      if (!container) return;

      if (typeof T !== "function") {
        container.innerHTML =
          '<div class="modal-empty">xterm.js를 로드할 수 없습니다. 인터넷 연결을 확인하세요.</div>';
        return;
      }

      term = new T({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', monospace",
        theme: {
          background: "#0d1117",
          foreground: "#e6edf3",
          cursor: "#d4a574",
          selectionBackground: "#264f78",
        },
      });

      let fitAddon = null;
      if (typeof Fit === "function") {
        fitAddon = new Fit();
        term.loadAddon(fitAddon);
      }
      term.open(container);
      if (fitAddon && typeof fitAddon.fit === "function") {
        try { fitAddon.fit(); } catch (_) {}
      }

      // Custom key handler — paste + copy semantics (preserved from legacy).
      if (typeof term.attachCustomKeyEventHandler === "function") {
        term.attachCustomKeyEventHandler((e) => {
          if (e.type !== "keydown") return true;
          const ctrl = e.ctrlKey || e.metaKey;
          if (ctrl && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "C")) {
            const sel = term.getSelection();
            if (sel && sel.length > 0) {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(sel).catch(() => {});
              }
              term.clearSelection();
              return false;
            }
            return true;
          }
          if (ctrl && e.shiftKey && (e.key === "C" || e.key === "c")) {
            const sel = term.getSelection();
            if (sel && sel.length > 0) {
              if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(sel).catch(() => {});
              }
              term.clearSelection();
            }
            return false;
          }
          if (ctrl && (e.key === "v" || e.key === "V")) {
            return false;
          }
          return true;
        });
      }

      // Resolve the auth token. apiTokenGetter is the canonical
      // injection point; falls back to window.OrchestratorApi.getToken,
      // then window.ORCHESTRATOR_TOKEN.
      let token = "";
      if (typeof apiTokenGetter === "function") {
        try { token = await apiTokenGetter(); } catch (_) { token = ""; }
      } else if (typeof globalThis !== "undefined") {
        if (globalThis.OrchestratorApi && typeof globalThis.OrchestratorApi.getToken === "function") {
          try { token = await globalThis.OrchestratorApi.getToken(); } catch (_) {}
        }
        if (!token && globalThis.ORCHESTRATOR_TOKEN) token = globalThis.ORCHESTRATOR_TOKEN;
      }

      const protocol = locationProtocol
        || (typeof location !== "undefined" ? location.protocol : "http:");
      const host = locationHost
        || (typeof location !== "undefined" ? location.host : "127.0.0.1:4201");
      const wsProto = protocol === "https:" ? "wss:" : "ws:";
      const url = wsProto + "//" + host + "/terminal?token=" + encodeURIComponent(token || "");

      if (typeof WSCtor !== "function") {
        // No WebSocket available — render unavailable stub.
        container.innerHTML =
          '<div class="modal-empty">WebSocket을 로드할 수 없습니다.</div>';
        return;
      }

      termWs = new WSCtor(url);
      mounted = true;

      let promptReady = false;
      let continueFailed = false;

      termWs.onopen = () => {
        try {
          termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
        } catch (_) {}
      };

      termWs.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (msg && msg.type === "output") {
          term.write(msg.data);
          if (!continueFailed && typeof msg.data === "string" && msg.data.includes("No conversation found")) {
            continueFailed = true;
            setTimeout(() => {
              if (termWs && termWs.readyState === 1) {
                try { termWs.send(JSON.stringify({ type: "input", data: "claude\n" })); } catch (_) {}
              }
            }, 300);
          }
          if (!promptReady && typeof msg.data === "string" && msg.data.includes("$")) {
            promptReady = true;
            setTimeout(() => {
              if (termWs && termWs.readyState === 1) {
                try { termWs.send(JSON.stringify({ type: "input", data: "claude --continue\n" })); } catch (_) {}
              }
            }, 300);
          }
        }
      };

      termWs.onclose = (ev) => {
        if (ev && ev.code === 1008) {
          if (term) term.write("\r\n\x1b[33m[인증 재시도 중...]\x1b[0m\r\n");
          mounted = false;
          term = null; termWs = null;
          setTimeout(() => mount({ containerId }), 1500);
          return;
        }
        if (term) term.write("\r\n\x1b[31m[연결 종료]\x1b[0m\r\n");
      };

      term.onData((data) => {
        if (termWs && termWs.readyState === 1) {
          try { termWs.send(JSON.stringify({ type: "input", data })); } catch (_) {}
        }
      });

      // Resize observer — only in a real browser environment.
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(() => {
          if (fitAddon && typeof fitAddon.fit === "function") {
            try { fitAddon.fit(); } catch (_) {}
          }
          if (termWs && termWs.readyState === 1) {
            try { termWs.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })); } catch (_) {}
          }
        });
        try { resizeObserver.observe(container); } catch (_) {}
      }
    }

    function dispose() {
      try { resizeObserver && resizeObserver.disconnect && resizeObserver.disconnect(); } catch (_) {}
      resizeObserver = null;
      try { termWs && termWs.close && termWs.close(); } catch (_) {}
      termWs = null;
      try { term && term.dispose && term.dispose(); } catch (_) {}
      term = null;
      mounted = false;
    }

    function isMounted() { return mounted; }

    return { mount, dispose, isMounted };
  }

  return { install };
});
