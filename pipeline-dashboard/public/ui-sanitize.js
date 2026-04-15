// P1-4 — HTML/attribute sanitization primitives.
//
// Shared between the browser UI (loaded via <script>) and Node-side unit
// tests (loaded via require). Pure string functions — no DOM dependency —
// so the same code path is exercised in both environments.
//
// Usage in app.js:
//   const s = (window.uiSanitize.escapeHtml(serverString));
//   el.innerHTML = `<span>${s}</span>`;
//
// For attacker-reachable event handlers prefer DOM APIs:
//   el.addEventListener("click", () => runTrigger(trigger.id));
// instead of baking the id into an onclick="" attribute.

(function () {
  const AMP = /&/g;
  const LT = /</g;
  const GT = />/g;
  const DQ = /"/g;
  const SQ = /'/g;
  const BT = /`/g;

  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(AMP, "&amp;")
      .replace(LT, "&lt;")
      .replace(GT, "&gt;")
      .replace(DQ, "&quot;")
      .replace(SQ, "&#39;");
  }

  // For values that land inside attribute="...". Additionally neutralizes
  // backticks so nothing escapes even if someone nests a template literal.
  function escapeAttr(s) {
    return escapeHtml(s).replace(BT, "&#96;");
  }

  const api = { escapeHtml, escapeAttr };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else if (typeof window !== "undefined") {
    window.uiSanitize = api;
  }
})();
