// Slice H (v5) — Focus trap for modal dialogs.
//
// UMD module following the toast.js / run-history.js convention so tests can
// require() it directly and the browser auto-assigns window.HarnessFocusTrap.
//
// The `trap()` function:
//   - Cycles Tab / Shift+Tab within `container` so focus can't leave the modal.
//   - Calls `options.onEscape()` on the Escape key (if provided) instead of
//     handling close itself — the caller decides what "close" means.
//   - Moves focus to `options.initialFocus` (or the first focusable) on install.
//   - Returns a `release()` function that removes listeners and restores
//     focus to whatever was active before trap() ran.
//
// All the real-world focusable detection pedantry (display:none ancestors,
// visibility:hidden, etc.) is best handled by the browser — here we only do
// the structural bits that matter for keyboard cycling, which is what a
// hand-rolled test DOM can actually represent.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessFocusTrap = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FOCUSABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    'input:not([disabled]):not([type="hidden"])',
    "select:not([disabled])",
    "textarea:not([disabled])",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  function getFocusables(container) {
    if (!container || typeof container.querySelectorAll !== "function") return [];
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
  }

  function trap(container, options = {}) {
    if (!container) return () => {};
    const { onEscape, initialFocus } = options;
    const doc =
      container.ownerDocument || (typeof document !== "undefined" ? document : null);
    const previouslyFocused = doc ? doc.activeElement : null;

    function onKeyDown(e) {
      if (e.key === "Escape") {
        if (typeof onEscape === "function") {
          if (typeof e.preventDefault === "function") e.preventDefault();
          onEscape(e);
        }
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = getFocusables(container);
      if (focusables.length === 0) {
        if (typeof e.preventDefault === "function") e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = doc ? doc.activeElement : null;
      const insideContainer =
        active && typeof container.contains === "function"
          ? container.contains(active)
          : false;

      if (e.shiftKey) {
        if (!insideContainer || active === first) {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof last.focus === "function") last.focus();
        }
      } else {
        if (!insideContainer || active === last) {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof first.focus === "function") first.focus();
        }
      }
    }

    container.addEventListener("keydown", onKeyDown);

    // Move initial focus. initialFocus wins if provided; otherwise first focusable.
    if (initialFocus && typeof initialFocus.focus === "function") {
      initialFocus.focus();
    } else {
      const f = getFocusables(container)[0];
      if (f && typeof f.focus === "function") f.focus();
    }

    return function release() {
      container.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }

  return { trap, getFocusables, FOCUSABLE_SELECTOR };
});
