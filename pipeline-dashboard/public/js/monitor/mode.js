// Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30) — shell mode resolution.
//
// Single source of truth for which monitor shell mode (simple |
// advanced | legacy) the operator should see. Resolution priority
// (per docs/ui-h-redesign-plan.md §2.2):
//
//   1. URL `?mode=` query param           (operator-explicit per visit)
//   2. localStorage "orchestrator.monitor.mode" (operator-saved preference)
//   3. envDefault from /api/server/info   (deployment-time policy)
//   4. "simple"                            (operator-friendly fallback)
//
// Each step accepts only one of MODES. Garbage / unrecognized values
// fall through to the next priority — so a malformed localStorage
// entry doesn't trap the operator on a broken mode.
//
// The browser path uses window.location + window.localStorage; tests
// inject stubs via the resolveMode({location, storage, envDefault})
// signature so every priority level is independently testable.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorMode = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  /**
   * Frozen list of valid modes. Adding a 4th mode forces a code-
   * review-visible diff against this constant + a docs/ui-h-redesign-
   * plan.md §2.2 update.
   */
  const MODES = Object.freeze(["simple", "advanced", "legacy"]);

  const DEFAULT_MODE = "simple";
  const STORAGE_KEY = "orchestrator.monitor.mode";

  /**
   * @param {string|*} value
   * @returns {string|null} the value if it's a valid mode, else null
   */
  function _validateMode(value) {
    if (typeof value !== "string") return null;
    const lower = value.trim().toLowerCase();
    if (MODES.includes(lower)) return lower;
    return null;
  }

  /**
   * Parse `?mode=` from a URL search string.
   *
   * @param {string} search   e.g. "?monitor=1&mode=simple"
   * @returns {string|null}
   */
  function _readUrlMode(search) {
    if (typeof search !== "string" || search.length === 0) return null;
    // Defensive: URLSearchParams handles malformed input by not
    // throwing, so we don't need extra try/catch here.
    let params;
    try { params = new URLSearchParams(search); }
    catch (_) { return null; }
    return _validateMode(params.get("mode"));
  }

  /**
   * Read mode from a Storage-like object (localStorage / sessionStorage
   * or test stub). Defensive against access errors (some browsers throw
   * when localStorage is disabled).
   */
  function _readStorageMode(storage) {
    if (!storage || typeof storage.getItem !== "function") return null;
    try { return _validateMode(storage.getItem(STORAGE_KEY)); }
    catch (_) { return null; }
  }

  /**
   * Resolve the operator's mode given dependencies. Pure function —
   * no I/O, no side effects.
   *
   * @param {object} [deps]
   * @param {{search?: string}} [deps.location]  window.location-like
   * @param {{getItem: function}} [deps.storage] window.localStorage-like
   * @param {string} [deps.envDefault]            deployment-time fallback
   * @returns {string} one of MODES
   */
  function resolveMode(deps) {
    const d = deps || {};
    const search = d.location && typeof d.location.search === "string"
      ? d.location.search : "";
    const fromUrl = _readUrlMode(search);
    if (fromUrl) return fromUrl;
    const fromStorage = _readStorageMode(d.storage);
    if (fromStorage) return fromStorage;
    const fromEnv = _validateMode(d.envDefault);
    if (fromEnv) return fromEnv;
    return DEFAULT_MODE;
  }

  /**
   * Persist a mode selection to localStorage. Defensive — silently
   * ignores garbage input or access errors.
   *
   * @param {string} mode
   * @param {{setItem: function}} [storage]   defaults to window.localStorage
   * @returns {boolean} true if the write succeeded with a valid mode
   */
  function persistMode(mode, storage) {
    const valid = _validateMode(mode);
    if (!valid) return false;
    const tgt = storage
      || (typeof window !== "undefined" && window.localStorage
            ? window.localStorage : null);
    if (!tgt || typeof tgt.setItem !== "function") return false;
    try { tgt.setItem(STORAGE_KEY, valid); return true; }
    catch (_) { return false; }
  }

  /**
   * Clear the persisted mode (operator chose "use default" via UI).
   *
   * @param {{removeItem: function}} [storage]
   */
  function clearPersistedMode(storage) {
    const tgt = storage
      || (typeof window !== "undefined" && window.localStorage
            ? window.localStorage : null);
    if (!tgt || typeof tgt.removeItem !== "function") return;
    try { tgt.removeItem(STORAGE_KEY); }
    catch (_) { /* defensive */ }
  }

  return {
    MODES,
    DEFAULT_MODE,
    STORAGE_KEY,
    resolveMode,
    persistMode,
    clearPersistedMode,
    // Test hooks
    _validateMode,
    _readUrlMode,
    _readStorageMode,
  };
});
