// Slice UI-P11-a (Phase D Round UI-P, 2026-05-04) — frozen catalog
// of responsive / text-fit assertions evaluated against the live
// product shell at each (route × viewport) cell from UI-P10.
//
// Why frozen:
//   - Each rule is a public contract — adding/removing changes the
//     CI manifest schema (failure counts) consumed by operators
//   - Adding a rule is a deliberate decision (matches piiScanner.js
//     PATTERNS, remoteHookBridgeContract.js ALLOWED_HOOKS,
//     presetLibrary.js PRESETS — all frozen registries)
//
// Each assertion shape:
//   {
//     id: string,                 — stable kebab-case ID
//     label: string,              — human-readable
//     appliesTo: (viewport, route) => boolean,
//                                 — gates the rule (e.g., min-tap-target
//                                   only on mobile viewports)
//     evaluate: async (page, viewport, route) => AssertionResult
//   }
//
// AssertionResult:
//   {
//     ok: boolean,                — pass/fail verdict
//     detail: object,             — metric values (scrollWidth, etc.)
//     failures?: array,           — per-element failure detail
//                                   (for assertions with multiple targets)
//   }
//
// All evaluate() functions must be self-contained — they call
// `page.evaluate(fn)` where `fn` runs in the browser context with
// NO closure access to module-level vars. Pass any constants via
// the second arg of page.evaluate(fn, arg).
//
// 1px overflow tolerance: sub-pixel rendering on high-DPR viewports
// can produce 0.5px differences that aren't real overflow. Each
// rule that compares scrollWidth vs clientWidth allows ≤ 1px slop.

"use strict";

const TOLERANCE_PX = 1;
const MIN_TAP_TARGET_PX = 44;  // WCAG 2.5.5 Target Size (Enhanced) minimum

// ── Browser-side evaluators ──────────────────────────────────────
// These are pulled out as named functions so unit tests can sanity
// check their shape (the actual execution happens inside
// page.evaluate() in production).

function _evalPageOverflow() {
  const doc = document.documentElement;
  return {
    scrollWidth: doc.scrollWidth,
    clientWidth: doc.clientWidth,
    overflow: doc.scrollWidth - doc.clientWidth,
  };
}

function _evalElementsTextFit(selector) {
  const elements = document.querySelectorAll(selector);
  const failures = [];
  let total = 0;
  for (const el of elements) {
    total += 1;
    const sw = el.scrollWidth;
    const cw = el.clientWidth;
    if (sw > cw + 1) {
      failures.push({
        text: (el.textContent || "").trim().slice(0, 40),
        scrollWidth: sw,
        clientWidth: cw,
        overflow: sw - cw,
      });
    }
  }
  return { total, failures };
}

function _evalElementsMinTapTarget(selector, minPx) {
  const elements = document.querySelectorAll(selector);
  const failures = [];
  let total = 0;
  for (const el of elements) {
    // Only enforce on visible elements — `display:none` / hidden
    // elements legitimately have 0 size.
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    total += 1;
    if (rect.width < minPx || rect.height < minPx) {
      failures.push({
        text: (el.textContent || "").trim().slice(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    }
  }
  return { total, failures };
}

function _evalElementsNoOverlap(selector) {
  const elements = Array.from(document.querySelectorAll(selector));
  const rects = elements.map((el) => ({
    id: el.getAttribute("data-card") || el.id || "(unnamed)",
    rect: el.getBoundingClientRect(),
  }));
  const failures = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].rect;
      const b = rects[j].rect;
      // Two rects overlap iff their projections overlap on BOTH axes.
      // Adjacent (touching at a pixel boundary) is not overlap.
      const xOverlap = a.left < b.right - 1 && b.left < a.right - 1;
      const yOverlap = a.top < b.bottom - 1 && b.top < a.bottom - 1;
      if (xOverlap && yOverlap) {
        failures.push({ a: rects[i].id, b: rects[j].id });
      }
    }
  }
  return { total: rects.length, failures };
}

function _evalContainerFit(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  const sw = el.scrollWidth;
  const cw = el.clientWidth;
  const rect = el.getBoundingClientRect();
  return {
    found: true,
    visible: rect.width > 0 && rect.height > 0,
    scrollWidth: sw,
    clientWidth: cw,
    overflow: sw - cw,
  };
}

// ── Frozen rule catalog ──────────────────────────────────────────

const ASSERTIONS = Object.freeze([
  Object.freeze({
    id: "no-horizontal-page-overflow",
    label: "Page must not exceed viewport width (no horizontal scroll)",
    appliesTo: () => true,
    async evaluate(page) {
      const detail = await page.evaluate(_evalPageOverflow);
      return {
        ok: detail.overflow <= TOLERANCE_PX,
        detail,
      };
    },
  }),
  Object.freeze({
    id: "header-buttons-text-fit",
    label: "Header buttons must not truncate their text",
    appliesTo: (_v, route) => route.id !== "legacy",  // legacy uses different markup
    async evaluate(page) {
      const result = await page.evaluate(
        _evalElementsTextFit,
        '[data-region="header"] button',
      );
      return {
        ok: result.failures.length === 0,
        detail: { total: result.total },
        failures: result.failures,
      };
    },
  }),
  Object.freeze({
    id: "header-buttons-min-tap-target",
    label: "Header buttons must meet WCAG 2.5.5 Enhanced (≥44×44 px) on mobile",
    // Mobile viewports only — desktop has hover affordances + larger
    // pointer precision so 44×44 isn't required.
    appliesTo: (viewport, route) => viewport.isMobile && route.id !== "legacy",
    async evaluate(page) {
      const result = await page.evaluate(
        _evalElementsMinTapTarget,
        '[data-region="header"] button',
        MIN_TAP_TARGET_PX,
      );
      return {
        ok: result.failures.length === 0,
        detail: { total: result.total, minPx: MIN_TAP_TARGET_PX },
        failures: result.failures,
      };
    },
  }),
  Object.freeze({
    id: "dual-terminals-fit-container",
    label: "Dual terminals region must fit within its container width",
    appliesTo: (_v, route) => route.id !== "legacy",
    async evaluate(page) {
      const r = await page.evaluate(
        _evalContainerFit,
        '[data-region="dual-terminals"]',
      );
      // Not finding the region is a structural problem — the
      // capture should never reach this assertion if the route
      // doesn't render dual-terminals (the structural snapshot at
      // UI-P9 already pins the panel set per route).
      if (!r.found) {
        return { ok: false, detail: r, failures: [{ reason: "region not found" }] };
      }
      if (!r.visible) {
        return { ok: false, detail: r, failures: [{ reason: "region not visible" }] };
      }
      return { ok: r.overflow <= TOLERANCE_PX, detail: r };
    },
  }),
  Object.freeze({
    id: "monitor-grid-cards-no-overlap",
    label: "Monitor grid cards must not visually overlap",
    appliesTo: (_v, route) => route.id !== "legacy",
    async evaluate(page) {
      const result = await page.evaluate(
        _evalElementsNoOverlap,
        '[data-region="monitor-grid"] [data-card]',
      );
      return {
        ok: result.failures.length === 0,
        detail: { total: result.total },
        failures: result.failures,
      };
    },
  }),
  Object.freeze({
    id: "pipeline-rail-lane-labels-fit",
    label: "Pipeline rail lane labels must not truncate (use [data-phase-slot=title])",
    appliesTo: (_v, route) => route.id !== "legacy",
    async evaluate(page) {
      const result = await page.evaluate(
        _evalElementsTextFit,
        '[data-region="pipeline-rail"] [data-phase-slot="title"]',
      );
      return {
        ok: result.failures.length === 0,
        detail: { total: result.total },
        failures: result.failures,
      };
    },
  }),
]);

// ── Result aggregation ───────────────────────────────────────────

/**
 * Run every applicable assertion against a single page (one cell).
 * Returns a per-cell breakdown plus a summary.
 *
 * @param {object} page       — Playwright Page-like object with
 *                              `evaluate(fn, ...args)` method.
 * @param {object} viewport   — VIEWPORTS entry
 * @param {object} route      — ROUTES entry
 * @returns {Promise<{
 *   results: Array<{id, label, ok, detail, failures?}>,
 *   summary: {applicable: number, passed: number, failed: number, skipped: number},
 * }>}
 */
async function runAssertions(page, viewport, route) {
  const results = [];
  let applicable = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const a of ASSERTIONS) {
    if (!a.appliesTo(viewport, route)) {
      results.push({
        id: a.id,
        label: a.label,
        ok: null,
        skipped: true,
        reason: "appliesTo returned false",
      });
      skipped += 1;
      continue;
    }
    applicable += 1;
    try {
      const r = await a.evaluate(page, viewport, route);
      results.push({
        id: a.id,
        label: a.label,
        ok: r.ok,
        detail: r.detail || null,
        failures: r.failures || null,
      });
      if (r.ok) passed += 1;
      else failed += 1;
    } catch (err) {
      results.push({
        id: a.id,
        label: a.label,
        ok: false,
        detail: null,
        failures: [{ reason: "evaluate threw", message: String(err && err.message || err) }],
      });
      failed += 1;
    }
  }
  return {
    results,
    summary: { applicable, passed, failed, skipped },
  };
}

module.exports = {
  ASSERTIONS,
  runAssertions,
  // Constants — exported so unit tests + closeout can echo
  TOLERANCE_PX,
  MIN_TAP_TARGET_PX,
  // Internal evaluators — exposed for shape-only unit testing
  _evalPageOverflow,
  _evalElementsTextFit,
  _evalElementsMinTapTarget,
  _evalElementsNoOverlap,
  _evalContainerFit,
};
