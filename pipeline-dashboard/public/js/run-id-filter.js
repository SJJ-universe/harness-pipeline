// Slice AA-1 (Phase 2.5, v6) — run-scoped DOM routing helper.
//
// Background: once multi-run is unlocked, events from other runs still
// arrive at every WebSocket client. The dashboard's active timeline must
// not render those — otherwise tabs are meaningless because all runs are
// collapsed into one view. But a few event types are *intentionally*
// run-agnostic (toasts, hook_event debug traces, context_alarm, etc.)
// and must render regardless of which tab is focused.
//
// This tiny pure module encodes the "should this event be skipped for the
// currently-focused tab?" decision so that `handleEvent` in app.js stays
// small and the behavior is unit-testable in Node (no DOM required).
//
// This module ships as UMD: Node tests `require()` it, the browser picks
// it up as `window.HarnessRunIdFilter`.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessRunIdFilter = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  /**
   * Return true when the event should be skipped for the currently-focused
   * run's timeline. The caller decides what "skipped" means (typically
   * `return` from the renderer so the event does not hit DOM).
   *
   * Rules (fall-through, first match wins):
   *   - event falsy / not an object            → do not skip (safety)
   *   - event.data missing / not an object     → do not skip (pre-Slice-T
   *                                              events predate multi-run)
   *   - event.data.runId missing (null/undef)  → do not skip (GLOBAL event:
   *                                              toast, hook_event, etc.)
   *   - currentRunId missing                   → do not skip (no tab
   *                                              selection yet — render
   *                                              everything so initial
   *                                              hydration is complete)
   *   - event.data.runId === currentRunId      → do not skip (own run)
   *   - otherwise                              → skip (other run)
   */
  function shouldSkip(event, currentRunId) {
    if (!event || typeof event !== "object") return false;
    if (!event.data || typeof event.data !== "object") return false;
    const eventRunId = event.data.runId;
    if (eventRunId === undefined || eventRunId === null) return false;
    if (!currentRunId) return false;
    return eventRunId !== currentRunId;
  }

  return { shouldSkip };
});
