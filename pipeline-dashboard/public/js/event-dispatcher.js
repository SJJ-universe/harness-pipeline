// Slice R (v6) — Event dispatcher (registry pattern).
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

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessEventDispatcher = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const _registry = new Map();

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

  // Test-only: reset the registry between unit tests so cross-test leakage
  // doesn't surprise us.
  function _resetForTests() { _registry.clear(); }

  return { register, unregister, dispatch, has, size, types, _resetForTests };
});
