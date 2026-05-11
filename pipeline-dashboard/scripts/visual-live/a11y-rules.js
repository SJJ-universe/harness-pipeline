// Slice UI-P12-a (Phase D Round UI-P, 2026-05-04) — frozen ruleset
// + custom rule registry for accessibility verification.
//
// Why a frozen catalog (matches piiScanner / assertions / etc.):
//   - The result manifest contract embeds `axeRuleset` + `customRuleIds`
//     so a CI artifact stays interpretable across versions.
//   - Adding/removing rules changes operator expectations + must be
//     a deliberate decision in PR review.
//
// Strategy:
//   1. axe-core does the heavy lifting — WCAG 2.0/2.1 A+AA tags
//      cover ~50 well-tested rules out of the box (color contrast,
//      ARIA shape, keyboard fundamentals, landmark structure).
//   2. Two CUSTOM rules layer on top for harness-specific UX
//      contracts axe can't see:
//        - lang-matches-locale: <html lang> reflects active i18n
//          locale (KO ↔ EN toggle correctness — pre-condition for
//          screen readers to pronounce text correctly)
//        - skip-link-focus-visible: first Tab focuses the
//          `.skip-link` element AND the focused element gets a
//          visible style change (operator escape hatch for
//          keyboard-only users skipping decoration)
//
// Verdict policy (per cell):
//   - axe violations with impact `critical` or `serious` → cell FAIL
//   - axe violations with impact `moderate` or `minor` → cell records
//     them as warnings but does NOT fail (avoids noise from minor
//     issues that aren't blocking; CI gate can be tightened later)
//   - any custom rule failure → cell FAIL
//
// 2026-05-04 starter exclusions:
//   - `region` rule is too aggressive on the legacy view (doesn't
//     wrap every block in landmarks). Excluded for legacy route only.
//   - `color-contrast` excluded for now — design tokens are still
//     evolving in the UI Reference Port arc; turning this on would
//     create churn that's better addressed in a dedicated UI polish
//     round. Operators who want it can add via env override.

"use strict";

const A11Y_AXE_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
]);

// Rules to skip for ALL routes (until a dedicated polish round
// addresses them).
const A11Y_AXE_DISABLED_RULES_ALL = Object.freeze([
  "color-contrast",  // design tokens still evolving (UI-P arc)
]);

// Rules to skip ONLY for the legacy route. The legacy DOM uses
// pre-rewrite markup that doesn't conform to all the landmark/
// region heuristics axe enforces. UI-P0 chose escape hatch over
// rewriting legacy.
const A11Y_AXE_DISABLED_RULES_LEGACY = Object.freeze([
  "region",
  "landmark-one-main",
  "landmark-unique",
]);

// Impact levels that fail the cell. Anything outside this set is
// recorded as a warning but does NOT fail.
const A11Y_FAILING_IMPACTS = Object.freeze(["critical", "serious"]);

// ── Custom rules ─────────────────────────────────────────────────
// Each custom rule:
//   {
//     id: kebab-case
//     label: human-readable
//     appliesTo: (viewport, route) => boolean
//     evaluate: async (page, viewport, route) => {ok, detail, failures?}
//   }
// Same shape as UI-P11 assertions; the runner module reuses the
// pattern.

function _evalLangMatchesLocale() {
  const html = document.documentElement;
  const lang = (html.getAttribute("lang") || "").trim();
  // Active locale: prefer OrchestratorI18n.getLang() if available,
  // otherwise fall back to localStorage/data-locale shell attr.
  let activeLocale = null;
  let source = null;
  try {
    if (window.OrchestratorI18n && typeof window.OrchestratorI18n.getLang === "function") {
      activeLocale = window.OrchestratorI18n.getLang();
      source = "OrchestratorI18n.getLang";
    }
  } catch (_) { /* keep null */ }
  if (!activeLocale) {
    const root = document.querySelector("[data-locale]");
    if (root) {
      activeLocale = root.getAttribute("data-locale");
      source = "data-locale";
    }
  }
  if (!activeLocale) {
    activeLocale = lang || null;
    source = "html-lang-fallback";
  }
  return { lang, activeLocale, source };
}

function _evalSkipLinkFocusVisible() {
  // Find the canonical skip link (UI-P1 markup uses .skip-link).
  const skipLink = document.querySelector(".skip-link");
  if (!skipLink) return { found: false };
  const baselineRect = skipLink.getBoundingClientRect();
  const baselineStyle = window.getComputedStyle(skipLink);
  const baselineSnap = {
    width: Math.round(baselineRect.width),
    height: Math.round(baselineRect.height),
    top: Math.round(baselineRect.top),
    opacity: baselineStyle.opacity,
    transform: baselineStyle.transform,
  };
  // Focus the link programmatically — focus styling should change
  // its visual treatment (typical pattern is `position:absolute;
  // top:-9999px` baseline + `:focus { top: 0; ... }`).
  skipLink.focus();
  const focusedRect = skipLink.getBoundingClientRect();
  const focusedStyle = window.getComputedStyle(skipLink);
  const focusedSnap = {
    width: Math.round(focusedRect.width),
    height: Math.round(focusedRect.height),
    top: Math.round(focusedRect.top),
    opacity: focusedStyle.opacity,
    transform: focusedStyle.transform,
  };
  // "Visible on focus" heuristic: ANY of position / opacity /
  // transform / size changed meaningfully.
  const positionChanged = Math.abs(focusedRect.top - baselineRect.top) > 5;
  const opacityChanged = focusedStyle.opacity !== baselineStyle.opacity;
  const transformChanged = focusedStyle.transform !== baselineStyle.transform;
  const sizeChanged =
    Math.abs(focusedRect.width - baselineRect.width) > 1 ||
    Math.abs(focusedRect.height - baselineRect.height) > 1;
  const changed = positionChanged || opacityChanged || transformChanged || sizeChanged;
  return {
    found: true,
    isFocused: document.activeElement === skipLink,
    changed,
    baseline: baselineSnap,
    focused: focusedSnap,
  };
}

const A11Y_CUSTOM_RULES = Object.freeze([
  Object.freeze({
    id: "lang-matches-locale",
    label: "<html lang> attribute must match the active i18n locale",
    appliesTo: () => true,
    async evaluate(page) {
      const detail = await page.evaluate(_evalLangMatchesLocale);
      // If we couldn't resolve an active locale, treat as warning
      // not failure (page may not have run init script yet).
      if (!detail.activeLocale) {
        return { ok: true, detail };
      }
      // Normalize "en-US" → "en" for comparison; locales we ship are
      // simple two-letter ("ko" / "en").
      const langSimple = (detail.lang || "").split("-")[0].toLowerCase();
      const localeSimple = String(detail.activeLocale).split("-")[0].toLowerCase();
      const ok = langSimple === localeSimple;
      return {
        ok,
        detail,
        failures: ok ? null : [{
          reason: "lang attribute does not match active locale",
          lang: detail.lang,
          locale: detail.activeLocale,
        }],
      };
    },
  }),
  Object.freeze({
    id: "skip-link-focus-visible",
    label: "First focusable element (.skip-link) must change its visual state on focus",
    // Only meaningful where the product shell renders the skip
    // link — legacy view has its own.
    appliesTo: () => true,
    async evaluate(page) {
      const detail = await page.evaluate(_evalSkipLinkFocusVisible);
      if (!detail.found) {
        return {
          ok: false,
          detail,
          failures: [{ reason: ".skip-link element not found" }],
        };
      }
      if (!detail.isFocused) {
        return {
          ok: false,
          detail,
          failures: [{ reason: "skip-link did not receive focus" }],
        };
      }
      if (!detail.changed) {
        return {
          ok: false,
          detail,
          failures: [{
            reason: "skip-link visual state did not change on focus",
            baseline: detail.baseline,
            focused: detail.focused,
          }],
        };
      }
      return { ok: true, detail };
    },
  }),
]);

// ── Aggregation helper ───────────────────────────────────────────
//
// Given an axe.run() result + custom-rule outcomes for one cell,
// produce the per-cell summary the manifest stores.

function _bucketAxeViolations(violations) {
  const bucket = { critical: 0, serious: 0, moderate: 0, minor: 0, other: 0 };
  for (const v of violations || []) {
    if (bucket[v.impact] === undefined) bucket.other += 1;
    else bucket[v.impact] += 1;
  }
  return bucket;
}

function summarizeCellA11y({ axeResult, customResults }) {
  const violations = (axeResult && axeResult.violations) || [];
  const bucket = _bucketAxeViolations(violations);
  const failingImpactsHit = A11Y_FAILING_IMPACTS.reduce(
    (s, k) => s + (bucket[k] || 0), 0,
  );
  const customFailed = customResults.filter((r) => !r.ok && !r.skipped).length;
  const customPassed = customResults.filter((r) => r.ok && !r.skipped).length;
  const customSkipped = customResults.filter((r) => r.skipped).length;
  const ok = failingImpactsHit === 0 && customFailed === 0;
  return {
    ok,
    axe: {
      totalViolations: violations.length,
      failingImpactsHit,
      bucket,
    },
    custom: {
      total: customResults.length,
      passed: customPassed,
      failed: customFailed,
      skipped: customSkipped,
    },
  };
}

module.exports = {
  A11Y_AXE_TAGS,
  A11Y_AXE_DISABLED_RULES_ALL,
  A11Y_AXE_DISABLED_RULES_LEGACY,
  A11Y_FAILING_IMPACTS,
  A11Y_CUSTOM_RULES,
  summarizeCellA11y,
  // Internal evaluators — exposed so unit tests can verify shape
  _evalLangMatchesLocale,
  _evalSkipLinkFocusVisible,
  _bucketAxeViolations,
};
