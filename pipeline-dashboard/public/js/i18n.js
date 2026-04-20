// Slice I (v5) — HarnessI18n: runtime translation table + DOM applier.
//
// Two layers (UMD, same convention as toast.js / focus-trap.js):
//   1. Pure helpers — `t()`, `getLang()`, `setLang()`, `applyDom()`.
//      Tests drive them against injected locale tables without a DOM.
//   2. Browser auto-assign — `window.HarnessI18n = { ... }` plus a default
//      language load from localStorage.
//
// Locale source: ko.js / en.js populate `window.HARNESS_I18N.{ko,en}`
// BEFORE this module loads. In Node tests, consumers pass their own tables
// via `setTables({ ko: {...}, en: {...} })`.
//
// Contract for applyDom():
//   [data-i18n="key"]              →  textContent = t(key)
//   [data-i18n-title="key"]        →  title = t(key)
//   [data-i18n-aria-label="key"]   →  aria-label = t(key)
//   [data-i18n-placeholder="key"]  →  placeholder = t(key)

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessI18n = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const SUPPORTED = ["ko", "en"];
  const DEFAULT = "ko";
  const STORAGE_KEY = "harness:lang";

  let _lang = DEFAULT;
  let _tables = null;

  function _globalTables() {
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.HARNESS_I18N || {};
  }

  function setTables(tables) {
    _tables = tables;
  }

  function _getTables() {
    return _tables || _globalTables();
  }

  function _loadStoredLang() {
    try {
      if (typeof localStorage === "undefined") return DEFAULT;
      const v = localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(v) ? v : DEFAULT;
    } catch (_) {
      return DEFAULT;
    }
  }
  _lang = _loadStoredLang();

  function t(key, params = {}) {
    const tables = _getTables();
    const primary = tables[_lang] || {};
    const fallback = tables[DEFAULT] || {};
    let str = primary[key];
    if (str === undefined) str = fallback[key];
    if (str === undefined) str = key;
    for (const [k, v] of Object.entries(params || {})) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
    return str;
  }

  function getLang() {
    return _lang;
  }

  function setLang(next, { persist = true, applyNow = true } = {}) {
    if (!SUPPORTED.includes(next)) return false;
    _lang = next;
    if (persist) {
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(STORAGE_KEY, next);
        }
      } catch (_) { /* quota exceeded — non-fatal */ }
    }
    if (applyNow && typeof document !== "undefined") {
      document.documentElement.lang = next;
      applyDom();
      try {
        document.dispatchEvent(
          new CustomEvent("harness:lang-changed", { detail: { lang: next } })
        );
      } catch (_) { /* old browsers without CustomEvent constructor */ }
    }
    return true;
  }

  function applyDom(rootEl) {
    const doc = rootEl || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.querySelectorAll !== "function") return;
    doc.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    doc.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    doc.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
    doc.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
  }

  // Test-only reset so repeated require() in a test file doesn't carry state.
  function _resetForTests() {
    _lang = DEFAULT;
    _tables = null;
  }

  return {
    t,
    getLang,
    setLang,
    applyDom,
    setTables,
    SUPPORTED,
    DEFAULT,
    _resetForTests,
  };
});
