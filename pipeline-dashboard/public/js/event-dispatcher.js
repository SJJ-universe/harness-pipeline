// Slice R (v6) + MB4-a (Phase D Round 2) — Event dispatcher (registry + taps).
//
// Coexists with the legacy switch in app.js::handleEvent. The switch keeps
// handling every event type registered before this slice; new types added in
// Slice T (runId routing) and Slice U (tab UI) should `register(...)` here
// instead of appending a case to the switch. Long term, existing cases can
// migrate one-by-one without breaking behavior.
//
// Contract:
//   - `register(type, handler)` → replaces any prior handler for that type
//     and warns once (helps catch init-order surprises).
//   - `dispatch(event)` → returns true if a handler ran, false otherwise so
//     the caller (app.js handleEvent) can fall through to the switch.
//   - `unregister(type)` → removes and returns whether it was registered.
//   - Handler throws are caught and logged, never propagate.
//
// Slice MB4-a additions:
//   - `addTap(fn)` → register a wildcard subscriber that fires on EVERY
//     event regardless of whether a typed handler is registered. Returns
//     an unsubscribe function. Used by the monitor legacy-bridge so the
//     monitor store can observe live WS traffic without app.js having to
//     know about the store.
//   - `removeTap(fn)` → equivalent to the returned unsubscribe.
//   - `notifyTaps(event)` → invoked by app.js handleEvent for every event,
//     in addition to dispatch(). Throws are caught per-tap so one bad tap
//     can't poison the others.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessEventDispatcher = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const _registry = new Map();
  // Slice MB4-a: wildcard subscribers. Set so addTap is idempotent on
  // the same fn ref (which can happen if init runs twice in dev reload).
  const _taps = new Set();

  function register(type, handler) {
    if (typeof type !== "string" || !type) {
      throw new Error('register(type, handler): type must be a non-empty string');
    }
    if (typeof handler !== "function") {
      throw new Error('register(type, handler): handler must be a function');
    }
    if (_registry.has(type)) {
      // Overwrite intentionally — catches accidental double-register in dev
      // but doesn't hard-fail production reload flows.
      if (typeof console !== "undefined" && console.warn) {
        console.warn(`[event-dispatcher] duplicate register for "${type}" — overwriting`);
      }
    }
    _registry.set(type, handler);
  }

  function unregister(type) {
    return _registry.delete(type);
  }

  function dispatch(event) {
    if (!event || typeof event !== "object" || typeof event.type !== "string") {
      return false;
    }
    const handler = _registry.get(event.type);
    if (!handler) return false;
    try {
      handler(event);
    } catch (err) {
      if (typeof console !== "undefined" && console.error) {
        console.error(`[event-dispatcher] handler "${event.type}" threw:`, err);
      }
    }
    return true;
  }

  function has(type) { return _registry.has(type); }
  function size() { return _registry.size; }
  function types() { return Array.from(_registry.keys()); }

  // ── Slice MB4-a: wildcard taps ──────────────────────────────────

  function addTap(fn) {
    if (typeof fn !== "function") {
      throw new Error('addTap(fn): fn must be a function');
    }
    _taps.add(fn);
    return function unsubscribe() { _taps.delete(fn); };
  }

  function removeTap(fn) {
    return _taps.delete(fn);
  }

  function tapCount() { return _taps.size; }

  function notifyTaps(event) {
    if (_taps.size === 0) return;
    // Snapshot to allow taps to safely add/remove during iteration.
    for (const fn of Array.from(_taps)) {
      try { fn(event); } catch (err) {
        if (typeof console !== "undefined" && console.error) {
          console.error("[event-dispatcher] tap threw:", err);
        }
      }
    }
  }

  // Test-only: reset the registry + taps between unit tests so cross-test
  // leakage doesn't surprise us.
  function _resetForTests() { _registry.clear(); _taps.clear(); }

  return {
    register, unregister, dispatch, has, size, types,
    // Slice MB4-a
    addTap, removeTap, tapCount, notifyTaps,
    _resetForTests,
  };
});
