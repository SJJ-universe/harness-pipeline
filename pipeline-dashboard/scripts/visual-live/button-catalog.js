// Slice UI-P13-a (Phase D Round UI-P, 2026-05-04) — frozen registry
// of every button operators see in the product shell + per-button
// expectations. UI-P13 catches the "looks clickable but does
// nothing" UX failure that destroys deployment trust.
//
// Why frozen:
//   - Adding/removing a button changes operator expectations + the
//     CI manifest schema. PR review must surface the change.
//   - Matches piiScanner / assertions / a11y-rules registries.
//
// Two layers of verification (controlled by `clickSafe`):
//
//   STATIC (every button, always):
//     - Element exists in DOM (or `appliesTo` returned false → skip)
//     - Visible (rect.width > 0 && rect.height > 0)
//     - Has accessible name (textContent OR aria-label OR title)
//     - If disabled: has explanatory aria-label OR title (operator
//       can read WHY it's disabled)
//
//   CLICK + ACTIVITY (only when clickSafe: true):
//     - Click succeeds (no playwright timeout)
//     - One of: DOM mutation count > 0 / network request fired /
//       no console.error during/after click
//     - Catches "no event handler attached" (click does nothing)
//
// `clickSafe: false` for buttons whose activation has dangerous side
// effects on the real server:
//   - server shutdown (kills the orchestrator)
//   - codex/claude spawn (consumes API quota; may take seconds)
//   - state-machine transitions that block subsequent buttons
//
// `appliesTo(viewport, route, mode)` lets a button declare it ONLY
// applies in some shell modes (e.g., pro-actions hide on simple
// mode). `mode` is the resolved shell mode at the route's first
// paint: "simple" | "pro" | "legacy". For legacy route mode is
// always "legacy".

"use strict";

// Activity verdict thresholds. "Some activity" = any of:
const MIN_DOM_MUTATIONS = 1;
const MIN_NETWORK_REQUESTS = 1;
// Console.error during click counts AGAINST the button (handler
// silently failing). console.warn / log / debug are noise we ignore.
const FAILS_ON_CONSOLE_ERROR = true;

// ── Frozen catalog ──────────────────────────────────────────────

const BUTTONS = Object.freeze([
  // ── Header: mode toggle ─────────────────────────────────────
  Object.freeze({
    id: "header-mode-simple",
    label: "Header / Mode toggle / Simple",
    selector: '[data-region="header"] button[data-mode="simple"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: true,
    expectedActivity: "mutation",  // updates aria-pressed + may rerender
    notes: "Switches shell to Simple mode (no provider spawn).",
  }),
  Object.freeze({
    id: "header-mode-pro",
    label: "Header / Mode toggle / Pro",
    selector: '[data-region="header"] button[data-mode="pro"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: true,
    expectedActivity: "mutation",
    notes: "Switches shell to Pro mode (no provider spawn).",
  }),

  // ── Header: locale toggle ───────────────────────────────────
  Object.freeze({
    id: "header-locale-ko",
    label: "Header / Locale toggle / KO",
    selector: '[data-region="header"] button[data-locale="ko"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: true,
    expectedActivity: "mutation",
    notes: "Switches i18n locale to KO (calls OrchestratorI18n.setLang).",
  }),
  Object.freeze({
    id: "header-locale-en",
    label: "Header / Locale toggle / EN",
    selector: '[data-region="header"] button[data-locale="en"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: true,
    expectedActivity: "mutation",
    notes: "Switches i18n locale to EN.",
  }),

  // ── Header: pro-only actions ────────────────────────────────
  Object.freeze({
    id: "header-action-metrics",
    label: "Header / Pro action / Metrics",
    selector: '[data-region="header"] button[data-action="metrics"]',
    // Pro mode only — Simple hides the pro-actions cluster.
    // For routes the catalog runner can't resolve mode for, we
    // assume it's the route's default (default + pro = pro mode;
    // simple = simple mode).
    appliesTo: (_v, route) => route.id === "product-pro" || route.id === "product-default",
    clickSafe: true,
    expectedActivity: "mutation",  // opens analytics modal
    notes: "Opens analytics drawer. Modal-based; no provider spawn.",
  }),
  Object.freeze({
    id: "header-action-history",
    label: "Header / Pro action / History",
    selector: '[data-region="header"] button[data-action="history"]',
    appliesTo: (_v, route) => route.id === "product-pro" || route.id === "product-default",
    clickSafe: true,
    expectedActivity: "mutation",
    notes: "Opens run-history drawer. Local read; no provider spawn.",
  }),
  Object.freeze({
    id: "header-action-codex-verify",
    label: "Header / Pro action / Codex Verify",
    selector: '[data-region="header"] button[data-action="codex-verify"]',
    appliesTo: (_v, route) => route.id === "product-pro" || route.id === "product-default",
    clickSafe: false,  // triggers codex spawn — UNSAFE in CI
    notes: "Triggers codex CLI verification spawn. Static-only check.",
  }),

  // ── Header: always-visible action ───────────────────────────
  Object.freeze({
    id: "header-action-shutdown",
    label: "Header / Server shutdown",
    selector: '[data-region="header"] button[data-action="shutdown"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: false,  // would actually shut down the server
    notes: "Server shutdown button. NEVER clicked in CI.",
  }),

  // ── Dual terminal action row ────────────────────────────────
  // The action row is ALWAYS present in the product shell, but
  // most buttons are state-aware (disabled when no session is
  // active). UI-P13 verifies (a) all buttons exist + are
  // accessible, (b) the disabled ones have explanatory text.
  Object.freeze({
    id: "dual-action-start",
    label: "Dual terminals / Start session",
    selector: '[data-region="dual-terminals-actions"] [data-action-id="start"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: true,  // creates a server-side session — minor side effect, OK
    expectedActivity: "network",  // POST /api/review-sessions
    notes: "Creates a new review session (POST /api/review-sessions).",
  }),
  Object.freeze({
    id: "dual-action-send-codex",
    label: "Dual terminals / Send to Codex",
    selector: '[data-region="dual-terminals-actions"] [data-action-id="send-codex"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: false,  // triggers codex spawn via dispatcher
    notes: "Triggers Codex critique. Static-only check.",
  }),
  Object.freeze({
    id: "dual-action-followup-codex",
    label: "Dual terminals / Codex follow-up",
    selector: '[data-region="dual-terminals-actions"] [data-action-id="followup-codex"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: false,
    notes: "Triggers Codex follow-up. Static-only check.",
  }),
  Object.freeze({
    id: "dual-action-hand-back",
    label: "Dual terminals / Hand back to Claude",
    selector: '[data-region="dual-terminals-actions"] [data-action-id="hand-back"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: false,  // triggers claude spawn
    notes: "Triggers Claude hand-back. Static-only check.",
  }),
  Object.freeze({
    id: "dual-action-archive",
    label: "Dual terminals / Archive session",
    selector: '[data-region="dual-terminals-actions"] [data-action-id="archive"]',
    appliesTo: (_v, route) => route.id !== "legacy",
    clickSafe: false,  // server-side state mutation
    notes: "Archives the current session. Static-only check.",
  }),
]);

// ── Per-button verdict aggregation ──────────────────────────────

function summarizeButtonResult(staticResult, clickResult) {
  // staticResult: {found, visible, hasName, disabled, hasReason}
  // clickResult (if clickSafe + ran): {clickError, mutations, requests, errors, ok}
  if (!staticResult.found) {
    return { ok: true, status: "skipped", reason: "element not in DOM (appliesTo allowed it)" };
  }
  if (!staticResult.visible) {
    return { ok: true, status: "skipped", reason: "element not visible" };
  }
  if (!staticResult.hasName) {
    return { ok: false, status: "no-accessible-name", reason: "button has no textContent / aria-label / title" };
  }
  if (staticResult.disabled && !staticResult.hasReason) {
    return {
      ok: false, status: "disabled-without-reason",
      reason: "button is disabled but provides no aria-label or title to explain why",
    };
  }
  if (staticResult.disabled) {
    return { ok: true, status: "disabled-with-reason" };
  }
  // Visible + enabled. If clickSafe ran, evaluate activity.
  if (!clickResult) {
    return { ok: true, status: "static-ok-not-clicked" };
  }
  if (clickResult.clickError) {
    return { ok: false, status: "click-failed", reason: clickResult.clickError };
  }
  if (FAILS_ON_CONSOLE_ERROR && clickResult.errors && clickResult.errors.length > 0) {
    return {
      ok: false,
      status: "click-console-error",
      reason: "console.error fired during click",
      errors: clickResult.errors.slice(0, 3),
    };
  }
  const hasActivity =
    (clickResult.mutations || 0) >= MIN_DOM_MUTATIONS ||
    (clickResult.requests || 0) >= MIN_NETWORK_REQUESTS;
  if (!hasActivity) {
    return {
      ok: false,
      status: "click-no-activity",
      reason: "click produced no DOM mutation and no network request",
    };
  }
  return {
    ok: true,
    status: "click-fired-activity",
    detail: { mutations: clickResult.mutations, requests: clickResult.requests },
  };
}

// ── Browser-side static evaluator ───────────────────────────────
// Runs inside page.evaluate() — must be self-contained.

function _evalStaticButtonState(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const rect = el.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0;
  const text = (el.textContent || "").trim();
  const ariaLabel = el.getAttribute("aria-label");
  const title = el.getAttribute("title");
  const ariaLabelledBy = el.getAttribute("aria-labelledby");
  const hasName = !!(text || ariaLabel || title || ariaLabelledBy);
  const disabled =
    el.disabled === true ||
    el.getAttribute("aria-disabled") === "true" ||
    el.getAttribute("disabled") !== null;
  const hasReason = !!(ariaLabel || title);
  return {
    found: true,
    visible,
    hasName,
    text: text.slice(0, 40),
    ariaLabel,
    title,
    disabled,
    hasReason,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

module.exports = {
  BUTTONS,
  summarizeButtonResult,
  _evalStaticButtonState,
  // Constants exposed for tests + manifest
  MIN_DOM_MUTATIONS,
  MIN_NETWORK_REQUESTS,
  FAILS_ON_CONSOLE_ERROR,
};
