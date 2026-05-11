// Slice UI-P8 (Phase 2 Round 3, 2026-04-30) — legacy-view deprecation
// banner controller.
//
// Mounted only in /?mode=legacy via index.legacy.html. Manages the
// banner element added at the top of the document:
//
//   - Reads localStorage `harness:legacy-banner-dismissed` on load.
//     If "true", the banner is removed from the DOM at first paint
//     so the legacy chrome reflows naturally.
//   - Wires the dismiss button. On click: drops the banner element +
//     writes the storage key. The CTA link is plain `<a href="/">`,
//     so it works without JS — no listener needed there.
//   - Re-runs OrchestratorI18n.applyDom() on the banner element when the
//     KO/EN toggle fires `harness:lang-changed`, so the message and
//     CTA labels swap in place.
//
// Per UI-P0 §285-286: this view stays available indefinitely. The
// banner is informational, not a forced migration prompt.
//
// CSP: this file is a separate `<script src>` so server.js
// indexRenderer applies the per-request nonce automatically. No
// inline JS is added to the legacy HTML.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorLegacyBanner = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const STORAGE_KEY = "harness:legacy-banner-dismissed";
  const BANNER_ID = "harness-legacy-banner";

  /** Read the persisted dismiss flag. Defensive against localStorage
   *  being unavailable (private browsing / quota / etc.). */
  function _isDismissed(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return false;
      return s.getItem(STORAGE_KEY) === "true";
    } catch (_) { return false; }
  }

  function _persistDismissed(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return;
      s.setItem(STORAGE_KEY, "true");
    } catch (_) { /* defensive */ }
  }

  function _clearDismissed(storage) {
    // Test-only / operator-only — exposed on the API surface so a
    // future "show banner again" affordance can rehydrate without
    // requiring a localStorage console dump.
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (!s) return;
      s.removeItem(STORAGE_KEY);
    } catch (_) { /* defensive */ }
  }

  /** Initialize the banner. Returns a small handle for tests/operators. */
  function install(opts) {
    opts = opts || {};
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    const _storage = opts.storage
      || (typeof localStorage !== "undefined" ? localStorage : null);
    const i18n = opts.i18n
      || (typeof window !== "undefined" && window.OrchestratorI18n)
      || null;

    if (!_doc || typeof _doc.getElementById !== "function") {
      return { ok: false, reason: "no_document" };
    }
    const banner = _doc.getElementById(BANNER_ID);
    if (!banner) return { ok: false, reason: "no_banner_element" };

    // First paint: hide if already dismissed. We REMOVE the element
    // (rather than display:none) so legacy chrome reflows without a
    // flicker — banner is cheap to re-add via reset() below if the
    // operator clears the storage key.
    if (_isDismissed(_storage)) {
      try {
        if (banner.parentNode && typeof banner.parentNode.removeChild === "function") {
          banner.parentNode.removeChild(banner);
        }
      } catch (_) { /* defensive */ }
      return {
        ok: true,
        dismissed: true,
        bannerEl: null,
        reset: function () { _clearDismissed(_storage); },
      };
    }

    // Apply i18n to the banner subtree if available. The banner ships
    // with Korean defaults baked in so the first paint always has
    // something to show even if the i18n module hasn't loaded yet.
    try {
      if (i18n && typeof i18n.applyDom === "function") {
        i18n.applyDom(banner);
      }
    } catch (_) { /* defensive */ }

    // Wire the dismiss button.
    const dismissBtn = banner.querySelector(".legacy-banner-dismiss");
    if (dismissBtn && typeof dismissBtn.addEventListener === "function") {
      dismissBtn.addEventListener("click", function () {
        try {
          if (banner.parentNode && typeof banner.parentNode.removeChild === "function") {
            banner.parentNode.removeChild(banner);
          } else {
            // Last-resort fallback if removeChild isn't available
            banner.setAttribute("data-dismissed", "true");
          }
        } catch (_) { /* defensive */ }
        _persistDismissed(_storage);
      });
    }

    // Re-run i18n.applyDom on locale change so message/CTA labels swap
    // in place (OrchestratorI18n dispatches harness:lang-changed on setLang).
    if (typeof _doc.addEventListener === "function") {
      _doc.addEventListener("harness:lang-changed", function () {
        try {
          if (i18n && typeof i18n.applyDom === "function" && banner.parentNode) {
            i18n.applyDom(banner);
          }
        } catch (_) { /* defensive */ }
      });
    }

    return {
      ok: true,
      dismissed: false,
      bannerEl: banner,
      reset: function () { _clearDismissed(_storage); },
    };
  }

  // Auto-install on DOMContentLoaded when running in the browser. The
  // legacy view loads this script with `defer` so DOM is ready, but
  // we still gate on readyState for safety.
  if (typeof document !== "undefined" && typeof window !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { install(); });
    } else {
      install();
    }
  }

  return {
    install,
    STORAGE_KEY,
    BANNER_ID,
    _isDismissed,
    _clearDismissed,
  };
});
