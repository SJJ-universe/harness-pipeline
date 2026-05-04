// Slice UI-P11-a (Phase D Round UI-P, 2026-05-04) — assertion catalog
// shape contract + stub-page evaluation tests.
//
// We do NOT spawn chromium here. Each assertion's `evaluate` accepts
// a Page-like object; we pass a stub whose `evaluate(fn, ...args)`
// returns canned values that simulate browser-side measurements.
//
// What this file pins:
//   1. ASSERTIONS frozen + 6 entries (the documented catalog)
//   2. Each entry has the required fields + frozen
//   3. `appliesTo` gating: header tap-target rule fires only on
//      mobile + non-legacy; legacy route skips most rules
//   4. `runAssertions` aggregates per-cell results + summary
//   5. Each evaluate's happy-path + failure-path produces correct
//      `ok: bool + detail + failures` shape
//   6. Browser-side helper functions (_evalPageOverflow etc.)
//      compile cleanly + return the documented shape

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const a = require("../../scripts/visual-live/assertions");
const { ASSERTIONS, runAssertions, TOLERANCE_PX, MIN_TAP_TARGET_PX } = a;

// ── Frozen catalog shape ─────────────────────────────────────────

test("UI-P11 assertions: ASSERTIONS frozen + 6 entries", () => {
  assert.ok(Object.isFrozen(ASSERTIONS),
    "ASSERTIONS must be frozen — adding/removing changes CI manifest schema",
  );
  assert.equal(ASSERTIONS.length, 6,
    "expected 6 documented rules (no-page-overflow / header-text-fit / " +
    "header-tap-target / dual-terminals-fit / monitor-grid-no-overlap / " +
    "pipeline-rail-labels-fit)",
  );
});

test("UI-P11 assertions: each entry frozen + required fields", () => {
  const REQUIRED = ["id", "label", "appliesTo", "evaluate"];
  for (const rule of ASSERTIONS) {
    assert.ok(Object.isFrozen(rule), `rule ${rule.id} must be frozen`);
    for (const field of REQUIRED) {
      assert.ok(field in rule, `rule ${rule.id} missing field "${field}"`);
    }
    assert.equal(typeof rule.id, "string");
    assert.match(rule.id, /^[a-z0-9-]+$/, `rule id "${rule.id}" must be kebab-case`);
    assert.equal(typeof rule.appliesTo, "function");
    assert.equal(typeof rule.evaluate, "function");
  }
});

test("UI-P11 assertions: documented IDs all present (canonical 6)", () => {
  const present = new Set(ASSERTIONS.map((r) => r.id));
  for (const id of [
    "no-horizontal-page-overflow",
    "header-buttons-text-fit",
    "header-buttons-min-tap-target",
    "dual-terminals-fit-container",
    "monitor-grid-cards-no-overlap",
    "pipeline-rail-lane-labels-fit",
  ]) {
    assert.ok(present.has(id), `canonical assertion "${id}" missing`);
  }
});

test("UI-P11 assertions: documented constants exposed", () => {
  assert.equal(typeof TOLERANCE_PX, "number");
  assert.equal(TOLERANCE_PX, 1, "1px sub-pixel tolerance is documented");
  assert.equal(typeof MIN_TAP_TARGET_PX, "number");
  assert.equal(MIN_TAP_TARGET_PX, 44, "WCAG 2.5.5 Enhanced minimum is 44px");
});

// ── appliesTo gating ─────────────────────────────────────────────

const desktopViewport = { id: "desktop-1366", isMobile: false };
const mobileViewport = { id: "mobile-390", isMobile: true };
const productRoute = { id: "product-default", pathname: "/" };
const legacyRoute = { id: "legacy", pathname: "/?mode=legacy" };

test("UI-P11 appliesTo: page-overflow always applies", () => {
  const rule = ASSERTIONS.find((r) => r.id === "no-horizontal-page-overflow");
  assert.equal(rule.appliesTo(desktopViewport, productRoute), true);
  assert.equal(rule.appliesTo(mobileViewport, productRoute), true);
  assert.equal(rule.appliesTo(mobileViewport, legacyRoute), true);
});

test("UI-P11 appliesTo: header-tap-target gated to mobile + non-legacy only", () => {
  const rule = ASSERTIONS.find((r) => r.id === "header-buttons-min-tap-target");
  assert.equal(rule.appliesTo(desktopViewport, productRoute), false,
    "desktop has hover affordances + larger pointer precision; tap-target not enforced");
  assert.equal(rule.appliesTo(mobileViewport, productRoute), true);
  assert.equal(rule.appliesTo(mobileViewport, legacyRoute), false,
    "legacy uses different markup — UI-P0 chose escape hatch over rewriting");
});

test("UI-P11 appliesTo: legacy route skips most product-shell rules", () => {
  for (const id of [
    "header-buttons-text-fit",
    "dual-terminals-fit-container",
    "monitor-grid-cards-no-overlap",
    "pipeline-rail-lane-labels-fit",
  ]) {
    const rule = ASSERTIONS.find((r) => r.id === id);
    assert.equal(rule.appliesTo(desktopViewport, legacyRoute), false,
      `${id} must NOT apply to legacy route (different markup)`);
    assert.equal(rule.appliesTo(desktopViewport, productRoute), true,
      `${id} must apply to product routes`);
  }
});

// ── Stub-page evaluate happy path ────────────────────────────────

function _stubPage(canned) {
  return {
    async evaluate(_fn, ..._args) {
      return canned.shift();
    },
  };
}

test("UI-P11 evaluate: page-overflow OK when scrollWidth ≤ clientWidth", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "no-horizontal-page-overflow");
  const page = _stubPage([{ scrollWidth: 1366, clientWidth: 1366, overflow: 0 }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true);
  assert.equal(r.detail.overflow, 0);
});

test("UI-P11 evaluate: page-overflow OK at 1px tolerance", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "no-horizontal-page-overflow");
  const page = _stubPage([{ scrollWidth: 1367, clientWidth: 1366, overflow: 1 }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true, "1px overflow within sub-pixel tolerance");
});

test("UI-P11 evaluate: page-overflow FAIL beyond tolerance", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "no-horizontal-page-overflow");
  const page = _stubPage([{ scrollWidth: 1500, clientWidth: 1366, overflow: 134 }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.detail.overflow, 134);
});

test("UI-P11 evaluate: header-text-fit OK when no failures", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "header-buttons-text-fit");
  const page = _stubPage([{ total: 5, failures: [] }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true);
  assert.equal(r.detail.total, 5);
});

test("UI-P11 evaluate: header-text-fit FAIL with truncated buttons listed", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "header-buttons-text-fit");
  const page = _stubPage([{
    total: 5,
    failures: [
      { text: "메트릭", scrollWidth: 80, clientWidth: 50, overflow: 30 },
    ],
  }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].text, "메트릭");
});

test("UI-P11 evaluate: tap-target OK when all buttons ≥ 44×44", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "header-buttons-min-tap-target");
  const page = _stubPage([{ total: 4, failures: [] }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true);
  assert.equal(r.detail.minPx, 44);
});

test("UI-P11 evaluate: tap-target FAIL with too-small buttons listed", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "header-buttons-min-tap-target");
  const page = _stubPage([{
    total: 4,
    failures: [{ text: "?", width: 30, height: 30 }],
  }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.failures.length, 1);
  assert.ok(r.failures[0].width < 44 || r.failures[0].height < 44);
});

test("UI-P11 evaluate: dual-terminals-fit FAIL when region not found", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "dual-terminals-fit-container");
  const page = _stubPage([{ found: false }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].reason, "region not found");
});

test("UI-P11 evaluate: dual-terminals-fit FAIL when invisible", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "dual-terminals-fit-container");
  const page = _stubPage([{
    found: true, visible: false, scrollWidth: 0, clientWidth: 0, overflow: 0,
  }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].reason, "region not visible");
});

test("UI-P11 evaluate: dual-terminals-fit OK when visible + within container", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "dual-terminals-fit-container");
  const page = _stubPage([{
    found: true, visible: true, scrollWidth: 1200, clientWidth: 1200, overflow: 0,
  }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true);
});

test("UI-P11 evaluate: monitor-grid-no-overlap OK when no failures", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "monitor-grid-cards-no-overlap");
  const page = _stubPage([{ total: 7, failures: [] }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, true);
  assert.equal(r.detail.total, 7);
});

test("UI-P11 evaluate: monitor-grid-no-overlap FAIL with overlap pair listed", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "monitor-grid-cards-no-overlap");
  const page = _stubPage([{
    total: 7,
    failures: [{ a: "findings", b: "verify" }],
  }]);
  const r = await rule.evaluate(page);
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].a, "findings");
  assert.equal(r.failures[0].b, "verify");
});

test("UI-P11 evaluate: pipeline-rail-labels-fit OK + FAIL paths", async () => {
  const rule = ASSERTIONS.find((r) => r.id === "pipeline-rail-lane-labels-fit");
  let r;
  r = await rule.evaluate(_stubPage([{ total: 7, failures: [] }]));
  assert.equal(r.ok, true);
  r = await rule.evaluate(_stubPage([{
    total: 7,
    failures: [{ text: "PLAN", scrollWidth: 60, clientWidth: 40, overflow: 20 }],
  }]));
  assert.equal(r.ok, false);
});

// ── runAssertions aggregation ────────────────────────────────────

test("UI-P11 runAssertions: applies-to skip recorded as skipped:true + counted", async () => {
  // legacy route → most rules skip
  const cannedPerRule = [
    { scrollWidth: 1366, clientWidth: 1366, overflow: 0 },  // page-overflow runs
    // 5 other rules skipped on legacy route
  ];
  const page = _stubPage(cannedPerRule);
  const out = await runAssertions(page, desktopViewport, legacyRoute);
  assert.equal(out.summary.applicable, 1, "only page-overflow applies on legacy");
  assert.equal(out.summary.passed, 1);
  assert.equal(out.summary.failed, 0);
  assert.equal(out.summary.skipped, 5);
  assert.equal(out.results.length, 6);
  // Every result has either {ok:true|false} or {skipped:true}
  for (const r of out.results) {
    if (r.skipped) {
      assert.equal(r.ok, null);
    } else {
      assert.equal(typeof r.ok, "boolean");
    }
  }
});

test("UI-P11 runAssertions: per-rule throw caught + counted as failed", async () => {
  // First rule throws; the other 4 (non-tap-target on desktop) get
  // canned responses below.
  const page = {
    callCount: 0,
    async evaluate(_fn) {
      this.callCount += 1;
      if (this.callCount === 1) throw new Error("simulated browser fault");
      // Subsequent rules: return generic OK shape
      if (this.callCount === 2) return { total: 5, failures: [] };  // header-text-fit
      if (this.callCount === 3) return { found: true, visible: true, scrollWidth: 100, clientWidth: 100, overflow: 0 };  // dual-terminals-fit
      if (this.callCount === 4) return { total: 7, failures: [] };  // monitor-grid
      if (this.callCount === 5) return { total: 7, failures: [] };  // pipeline-rail
      return { total: 0, failures: [] };
    },
  };
  const out = await runAssertions(page, desktopViewport, productRoute);
  // 5 applicable rules on desktop+product (tap-target skipped).
  // First (page-overflow) throws → counted failed.
  assert.equal(out.summary.applicable, 5);
  assert.equal(out.summary.failed, 1);
  assert.equal(out.summary.passed, 4);
  assert.equal(out.summary.skipped, 1, "tap-target skipped on desktop");
  // First result has the error message preserved
  const first = out.results[0];
  assert.equal(first.ok, false);
  assert.equal(first.failures[0].reason, "evaluate threw");
  assert.match(first.failures[0].message, /simulated browser fault/);
});

test("UI-P11 runAssertions: mobile + product → tap-target counts as applicable", async () => {
  // 6 rules apply on mobile+product: page, text-fit, tap-target,
  // dual-terminals, monitor-grid, pipeline-labels. All need canned
  // values.
  const page = _stubPage([
    { scrollWidth: 390, clientWidth: 390, overflow: 0 },         // page-overflow
    { total: 4, failures: [] },                                   // header-text-fit
    { total: 4, failures: [] },                                   // tap-target
    { found: true, visible: true, scrollWidth: 360, clientWidth: 360, overflow: 0 },  // dual-terminals
    { total: 7, failures: [] },                                   // monitor-grid
    { total: 7, failures: [] },                                   // pipeline-labels
  ]);
  const out = await runAssertions(page, mobileViewport, productRoute);
  assert.equal(out.summary.applicable, 6);
  assert.equal(out.summary.passed, 6);
  assert.equal(out.summary.failed, 0);
  assert.equal(out.summary.skipped, 0);
});

// ── Browser-side helpers shape ───────────────────────────────────
// These are the functions passed to page.evaluate. They run in
// browser context (with `document`/`window`) so we just smoke-test
// they're callable from a stubbed DOM.

test("UI-P11 _evalPageOverflow: shape is {scrollWidth, clientWidth, overflow}", () => {
  const fn = a._evalPageOverflow;
  assert.equal(typeof fn, "function");
  // Mock document for shape verification
  globalThis.document = { documentElement: { scrollWidth: 1366, clientWidth: 1366 } };
  try {
    const out = fn();
    assert.deepEqual(Object.keys(out).sort(), ["clientWidth", "overflow", "scrollWidth"].sort());
    assert.equal(out.overflow, 0);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P11 _evalElementsTextFit: returns {total, failures} shape", () => {
  const fn = a._evalElementsTextFit;
  assert.equal(typeof fn, "function");
  globalThis.document = {
    querySelectorAll: () => [
      { scrollWidth: 100, clientWidth: 100, textContent: "ok" },
      { scrollWidth: 150, clientWidth: 100, textContent: "truncated text here" },
    ],
  };
  try {
    const out = fn("button");
    assert.equal(out.total, 2);
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].overflow, 50);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P11 _evalElementsNoOverlap: detects rect intersection", () => {
  const fn = a._evalElementsNoOverlap;
  globalThis.document = {
    querySelectorAll: () => [
      { id: "a", getAttribute: (k) => k === "data-card" ? "card-a" : null,
        getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) },
      { id: "b", getAttribute: (k) => k === "data-card" ? "card-b" : null,
        getBoundingClientRect: () => ({ left: 50, right: 150, top: 50, bottom: 150 }) },
      { id: "c", getAttribute: (k) => k === "data-card" ? "card-c" : null,
        getBoundingClientRect: () => ({ left: 200, right: 300, top: 200, bottom: 300 }) },
    ],
  };
  try {
    const out = fn("[data-card]");
    assert.equal(out.total, 3);
    assert.equal(out.failures.length, 1, "card-a + card-b overlap, card-c isolated");
    assert.equal(out.failures[0].a, "card-a");
    assert.equal(out.failures[0].b, "card-b");
  } finally {
    delete globalThis.document;
  }
});

test("UI-P11 _evalContainerFit: returns {found:false} for missing selector", () => {
  const fn = a._evalContainerFit;
  globalThis.document = { querySelector: () => null };
  try {
    const out = fn("[data-region='dual-terminals']");
    assert.equal(out.found, false);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P11 _evalElementsMinTapTarget: skips zero-size + flags too-small", () => {
  const fn = a._evalElementsMinTapTarget;
  globalThis.document = {
    querySelectorAll: () => [
      { textContent: "hidden", getBoundingClientRect: () => ({ width: 0, height: 0 }) },  // skipped
      { textContent: "ok", getBoundingClientRect: () => ({ width: 50, height: 50 }) },    // ok
      { textContent: "tiny", getBoundingClientRect: () => ({ width: 30, height: 30 }) },   // fail
    ],
  };
  try {
    const out = fn("button", 44);
    assert.equal(out.total, 2, "hidden zero-size button skipped from total");
    assert.equal(out.failures.length, 1);
    assert.equal(out.failures[0].text, "tiny");
  } finally {
    delete globalThis.document;
  }
});
