// Slice MA7-c (Phase D, 2026-04-27) — subagent event handlers.
//
// Behaviour-preserving lift of the live-path subagent_started +
// subagent_completed cases out of app.js's handleEvent switch.
// Registers them as HarnessEventDispatcher.register entries so the
// legacy switch's fall-through never even sees them.
//
// This is the FIRST module to use the dispatcher.register extraction
// pattern — future panel-specific handlers (Slice T's runId routing,
// Slice U's tab events, etc.) can drop in as their own UMD without
// touching the legacy switch in app.js.
//
// Replay-path subagent cases (in applyReplayEvent inside app.js)
// remain in place because they go through HarnessSubagentTray.restore
// instead of .start/.complete and never log. Replay events fire from
// a different code path that the dispatcher doesn't intercept.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessSubagentEvents = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  /**
   * install({ dispatcher, subagentTray, addLog })
   *   - dispatcher    : HarnessEventDispatcher (defaults to window global)
   *   - subagentTray  : HarnessSubagentTray (defaults to window global)
   *   - addLog(kind, message) : optional log writer (defaults to no-op)
   *
   * Returns { uninstall } so tests can clean up between cases.
   */
  function install({
    dispatcher = null,
    subagentTray = null,
    addLog = null,
  } = {}) {
    const _dispatcher = dispatcher
      || (typeof globalThis !== "undefined" && globalThis.HarnessEventDispatcher);
    if (!_dispatcher || typeof _dispatcher.register !== "function") {
      // No dispatcher — nothing to register. install() becomes a no-op
      // so app.js init doesn't crash in environments without the
      // dispatcher (Node smoke / SSR).
      return { uninstall: () => {} };
    }
    const _tray = subagentTray
      || (typeof globalThis !== "undefined" ? globalThis.HarnessSubagentTray : null);
    const _log = typeof addLog === "function" ? addLog : (() => {});

    function _shortId(id) {
      return String(id || "").slice(0, 8);
    }

    function onSubagentStarted(event) {
      const d = (event && event.data) || {};
      if (_tray && typeof _tray.start === "function") {
        _tray.start({
          session_id: d.session_id || d.agent_id,
          agent_type: d.agent_type,
          parent_session_id: d.parent_session_id || null,
        });
      }
      _log("phase",
        "서브에이전트 시작 — " + (d.agent_type || "unknown")
        + " (id=" + _shortId(d.session_id || d.agent_id) + ")");
    }

    function onSubagentCompleted(event) {
      const d = (event && event.data) || {};
      if (_tray && typeof _tray.complete === "function") {
        _tray.complete({
          session_id: d.session_id || d.agent_id,
          agent_type: d.agent_type,
          elapsedMs: d.elapsedMs,
        });
      }
      const sec = Number.isFinite(d.elapsedMs)
        ? (d.elapsedMs / 1000).toFixed(1) + "s"
        : "?s";
      _log("phase",
        "서브에이전트 완료 — " + (d.agent_type || "unknown") + " (" + sec + ")");
    }

    _dispatcher.register("subagent_started", onSubagentStarted);
    _dispatcher.register("subagent_completed", onSubagentCompleted);

    return {
      uninstall() {
        if (typeof _dispatcher.unregister === "function") {
          _dispatcher.unregister("subagent_started");
          _dispatcher.unregister("subagent_completed");
        }
      },
      // Test hooks
      _onSubagentStarted: onSubagentStarted,
      _onSubagentCompleted: onSubagentCompleted,
    };
  }

  return { install };
});
