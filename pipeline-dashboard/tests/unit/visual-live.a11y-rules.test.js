// Slice UI-P12-a (Phase D Round UI-P, 2026-05-04) — a11y rule
// catalog shape contract + per-rule stub-injection tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const r = require("../../scripts/visual-live/a11y-rules");
const {
  A11Y_AXE_TAGS,
  A11Y_AXE_DISABLED_RULES_ALL,
  A11Y_AXE_DISABLED_RULES_LEGACY,
  A11Y_FAILING_IMPACTS,
  A11Y_CUSTOM_RULES,
  summarizeCellA11y,
  _bucketAxeViolations,
} = r;

// ── Frozen catalog shape ─────────────────────────────────────────

test("UI-P12 a11y-rules: A11Y_AXE_TAGS frozen + WCAG 2.0/2.1 A+AA", () => {
  assert.ok(Object.isFrozen(A11Y_AXE_TAGS));
  assert.deepEqual(Array.from(A11Y_AXE_TAGS),
    ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
    "axe tag set must include WCAG 2.0/2.1 Level A + AA",
  );
});

test("UI-P12 a11y-rules: A11Y_AXE_DISABLED_RULES_ALL frozen + documented", () => {
  assert.ok(Object.isFrozen(A11Y_AXE_DISABLED_RULES_ALL));
  // color-contrast disabled until UI polish round (design tokens
  // still evolving in UI-P arc).
  assert.ok(A11Y_AXE_DISABLED_RULES_ALL.includes("color-contrast"),
    "color-contrast must be in the all-routes disabled list — design " +
    "tokens evolving across UI-P rounds",
  );
});

test("UI-P12 a11y-rules: A11Y_AXE_DISABLED_RULES_LEGACY drops landmark/region rules", () => {
  assert.ok(Object.isFrozen(A11Y_AXE_DISABLED_RULES_LEGACY));
  // Legacy DOM doesn't conform to landmark heuristics.
  for (const expected of ["region", "landmark-one-main", "landmark-unique"]) {
    assert.ok(A11Y_AXE_DISABLED_RULES_LEGACY.includes(expected),
      `legacy disabled list must include "${expected}"`,
    );
  }
});

test("UI-P12 a11y-rules: A11Y_FAILING_IMPACTS = critical + serious", () => {
  assert.ok(Object.isFrozen(A11Y_FAILING_IMPACTS));
  assert.deepEqual(Array.from(A11Y_FAILING_IMPACTS),
    ["critical", "serious"],
    "only critical/serious impact violations fail the cell — moderate/" +
    "minor recorded as warnings",
  );
});

test("UI-P12 a11y-rules: A11Y_CUSTOM_RULES frozen + 2 entries", () => {
  assert.ok(Object.isFrozen(A11Y_CUSTOM_RULES));
  assert.equal(A11Y_CUSTOM_RULES.length, 2,
    "expected 2 custom rules (lang-matches-locale + skip-link-focus-visible)",
  );
  for (const rule of A11Y_CUSTOM_RULES) {
    assert.ok(Object.isFrozen(rule));
    assert.equal(typeof rule.id, "string");
    assert.match(rule.id, /^[a-z0-9-]+$/);
    assert.equal(typeof rule.appliesTo, "function");
    assert.equal(typeof rule.evaluate, "function");
  }
});

test("UI-P12 a11y-rules: documented custom IDs present", () => {
  const ids = new Set(A11Y_CUSTOM_RULES.map((rule) => rule.id));
  for (const expected of ["lang-matches-locale", "skip-link-focus-visible"]) {
    assert.ok(ids.has(expected), `custom rule "${expected}" missing`);
  }
});

// ── _bucketAxeViolations ────────────────────────────────────────

test("UI-P12 _bucketAxeViolations: empty list → all zeros", () => {
  const out = _bucketAxeViolations([]);
  assert.deepEqual(out, { critical: 0, serious: 0, moderate: 0, minor: 0, other: 0 });
});

test("UI-P12 _bucketAxeViolations: counts each impact correctly", () => {
  const out = _bucketAxeViolations([
    { id: "a", impact: "critical" },
    { id: "b", impact: "critical" },
    { id: "c", impact: "serious" },
    { id: "d", impact: "moderate" },
    { id: "e", impact: "minor" },
  ]);
  assert.deepEqual(out, { critical: 2, serious: 1, moderate: 1, minor: 1, other: 0 });
});

test("UI-P12 _bucketAxeViolations: unknown impact → other bucket", () => {
  const out = _bucketAxeViolations([
    { id: "a", impact: "weird-new-impact" },
    { id: "b", impact: undefined },
  ]);
  assert.equal(out.other, 2);
  assert.equal(out.critical, 0);
});

// ── summarizeCellA11y ────────────────────────────────────────────

test("UI-P12 summarizeCellA11y: clean cell → ok:true", () => {
  const out = summarizeCellA11y({
    axeResult: { violations: [] },
    customResults: [
      { id: "lang-matches-locale", ok: true, skipped: false },
      { id: "skip-link-focus-visible", ok: true, skipped: false },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.axe.totalViolations, 0);
  assert.equal(out.axe.failingImpactsHit, 0);
  assert.equal(out.custom.total, 2);
  assert.equal(out.custom.passed, 2);
  assert.equal(out.custom.failed, 0);
});

test("UI-P12 summarizeCellA11y: critical axe violation → ok:false", () => {
  const out = summarizeCellA11y({
    axeResult: {
      violations: [
        { id: "button-name", impact: "critical" },
        { id: "color-contrast", impact: "moderate" },
      ],
    },
    customResults: [
      { id: "lang-matches-locale", ok: true, skipped: false },
      { id: "skip-link-focus-visible", ok: true, skipped: false },
    ],
  });
  assert.equal(out.ok, false);
  assert.equal(out.axe.totalViolations, 2);
  assert.equal(out.axe.failingImpactsHit, 1, "only critical is failing");
  assert.equal(out.axe.bucket.critical, 1);
  assert.equal(out.axe.bucket.moderate, 1);
});

test("UI-P12 summarizeCellA11y: moderate-only violations → still ok:true (warning)", () => {
  const out = summarizeCellA11y({
    axeResult: {
      violations: [
        { id: "doc-page-title", impact: "moderate" },
        { id: "image-alt-decorative", impact: "minor" },
      ],
    },
    customResults: [
      { id: "lang-matches-locale", ok: true, skipped: false },
      { id: "skip-link-focus-visible", ok: true, skipped: false },
    ],
  });
  assert.equal(out.ok, true,
    "moderate/minor are warnings, NOT cell failures");
  assert.equal(out.axe.totalViolations, 2);
  assert.equal(out.axe.failingImpactsHit, 0);
});

test("UI-P12 summarizeCellA11y: custom rule failure → ok:false even with clean axe", () => {
  const out = summarizeCellA11y({
    axeResult: { violations: [] },
    customResults: [
      { id: "lang-matches-locale", ok: false, skipped: false },
      { id: "skip-link-focus-visible", ok: true, skipped: false },
    ],
  });
  assert.equal(out.ok, false);
  assert.equal(out.custom.failed, 1);
  assert.equal(out.custom.passed, 1);
});

test("UI-P12 summarizeCellA11y: skipped custom rules counted separately", () => {
  const out = summarizeCellA11y({
    axeResult: { violations: [] },
    customResults: [
      { id: "lang-matches-locale", ok: true, skipped: false },
      { id: "skip-link-focus-visible", ok: null, skipped: true },
    ],
  });
  assert.equal(out.ok, true);
  assert.equal(out.custom.passed, 1);
  assert.equal(out.custom.skipped, 1);
  assert.equal(out.custom.failed, 0);
});

// ── Custom rule evaluate (stub-page) ─────────────────────────────

function _stubPage(canned) {
  return {
    async evaluate(_fn) { return canned.shift(); },
  };
}

test("UI-P12 lang-matches-locale: ok when html.lang === active locale (case-insensitive)", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "lang-matches-locale");
  const page = _stubPage([{ lang: "ko", activeLocale: "ko", source: "HarnessI18n.getLang" }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, true);
});

test("UI-P12 lang-matches-locale: handles en-US ↔ en simplification", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "lang-matches-locale");
  const page = _stubPage([{ lang: "en-US", activeLocale: "en", source: "HarnessI18n.getLang" }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, true, "en-US should match en after simplification");
});

test("UI-P12 lang-matches-locale: fail when html.lang differs from active", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "lang-matches-locale");
  const page = _stubPage([{ lang: "ko", activeLocale: "en", source: "HarnessI18n.getLang" }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, false);
  assert.equal(out.failures.length, 1);
});

test("UI-P12 lang-matches-locale: ok (warning) when active locale unresolvable", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "lang-matches-locale");
  const page = _stubPage([{ lang: "ko", activeLocale: null, source: null }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, true,
    "no active locale resolved → treat as warning, not failure (init may not have run)");
});

test("UI-P12 skip-link-focus-visible: ok when skip-link state changes on focus", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "skip-link-focus-visible");
  const page = _stubPage([{
    found: true,
    isFocused: true,
    changed: true,
    baseline: { width: 1, height: 1, top: -9999, opacity: "1", transform: "none" },
    focused: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
  }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, true);
});

test("UI-P12 skip-link-focus-visible: fail when not found", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "skip-link-focus-visible");
  const page = _stubPage([{ found: false }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, false);
  assert.match(out.failures[0].reason, /not found/);
});

test("UI-P12 skip-link-focus-visible: fail when focus didn't take", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "skip-link-focus-visible");
  const page = _stubPage([{
    found: true,
    isFocused: false,
    changed: true,
    baseline: { width: 1, height: 1, top: -9999, opacity: "1", transform: "none" },
    focused: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
  }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, false);
  assert.match(out.failures[0].reason, /did not receive focus/);
});

test("UI-P12 skip-link-focus-visible: fail when no visual state change", async () => {
  const rule = A11Y_CUSTOM_RULES.find((r) => r.id === "skip-link-focus-visible");
  const page = _stubPage([{
    found: true,
    isFocused: true,
    changed: false,
    baseline: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
    focused: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
  }]);
  const out = await rule.evaluate(page);
  assert.equal(out.ok, false);
  assert.match(out.failures[0].reason, /visual state did not change/);
});

// ── Browser-side helpers smoke ──────────────────────────────────

test("UI-P12 _evalLangMatchesLocale: prefers HarnessI18n then data-locale then html.lang fallback", () => {
  const fn = r._evalLangMatchesLocale;
  assert.equal(typeof fn, "function");
  // Case 1: HarnessI18n available
  globalThis.window = {
    HarnessI18n: { getLang: () => "ko" },
  };
  globalThis.document = {
    documentElement: { getAttribute: (k) => k === "lang" ? "ko" : null },
    querySelector: () => null,
  };
  try {
    const out = fn();
    assert.equal(out.activeLocale, "ko");
    assert.equal(out.source, "HarnessI18n.getLang");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
  // Case 2: HarnessI18n missing, data-locale present
  globalThis.window = {};
  globalThis.document = {
    documentElement: { getAttribute: (k) => k === "lang" ? "en" : null },
    querySelector: (sel) =>
      sel === "[data-locale]"
        ? { getAttribute: (k) => k === "data-locale" ? "en" : null }
        : null,
  };
  try {
    const out = fn();
    assert.equal(out.activeLocale, "en");
    assert.equal(out.source, "data-locale");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test("UI-P12 _evalSkipLinkFocusVisible: returns {found:false} when no .skip-link", () => {
  const fn = r._evalSkipLinkFocusVisible;
  globalThis.document = { querySelector: () => null };
  try {
    const out = fn();
    assert.equal(out.found, false);
  } finally {
    delete globalThis.document;
  }
});
