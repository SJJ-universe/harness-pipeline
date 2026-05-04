// Slice UI-P12-b (Phase D Round UI-P, 2026-05-04) — accessibility
// runner that boots playwright-core chromium + iterates the same
// 4×4 cell matrix as UI-P10 capture. Per cell:
//   1. axe-core injected via page.addScriptTag (`axe.source` from
//      the npm devDep)
//   2. axe.run() with the documented WCAG tag set + per-route
//      disabled-rule list applied
//   3. UI-P12-a custom rules (lang-matches-locale,
//      skip-link-focus-visible) run via runCustomRules
//   4. Per-cell summary built via summarizeCellA11y
//
// Cell-level fault model matches capture.js + assert-runner.js:
//   - Navigation timeout / selector miss / axe injection failure →
//     `{failed: true, failureReason}` recorded, loop continues.
//   - Single-cell failure NEVER aborts the whole matrix.
//
// Manifest schema `harness-visual-a11y/v1` — distinct from capture's
// `harness-visual-live/v1` and assert-runner's `harness-visual-assert/v1`
// so a future round can fuse all three into one workflow safely.
//
// Exit code:
//   0  every cell ok (no critical/serious axe violations + 0
//      custom failures)
//   1  any cell failed assertion or had a per-cell error

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { VIEWPORTS } = require("./viewports");
const { ROUTES } = require("./routes");
const {
  A11Y_AXE_TAGS,
  A11Y_AXE_DISABLED_RULES_ALL,
  A11Y_AXE_DISABLED_RULES_LEGACY,
  A11Y_CUSTOM_RULES,
  summarizeCellA11y,
} = require("./a11y-rules");

const DEFAULT_NAV_TIMEOUT_MS = 30000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 15000;
const DEFAULT_POST_PAINT_DELAY_MS = 250;

/**
 * Run the UI-P12-a custom rules against a live page.
 * Pulled out so tests can hit it with a stubbed page.
 */
async function runCustomRules(page, viewport, route) {
  const out = [];
  for (const rule of A11Y_CUSTOM_RULES) {
    if (!rule.appliesTo(viewport, route)) {
      out.push({ id: rule.id, label: rule.label, ok: null, skipped: true });
      continue;
    }
    try {
      const r = await rule.evaluate(page, viewport, route);
      out.push({
        id: rule.id,
        label: rule.label,
        ok: r.ok,
        skipped: false,
        detail: r.detail || null,
        failures: r.failures || null,
      });
    } catch (err) {
      out.push({
        id: rule.id,
        label: rule.label,
        ok: false,
        skipped: false,
        failures: [{ reason: "evaluate threw", message: String(err && err.message || err) }],
      });
    }
  }
  return out;
}

/**
 * Build the disabled-rules list for axe.run() based on route +
 * any extra exclusions the operator wants.
 */
function buildAxeDisabledRules(route, extraDisabled = []) {
  const disabled = [...A11Y_AXE_DISABLED_RULES_ALL];
  if (route && route.id === "legacy") {
    disabled.push(...A11Y_AXE_DISABLED_RULES_LEGACY);
  }
  for (const r of extraDisabled || []) {
    if (!disabled.includes(r)) disabled.push(r);
  }
  return disabled;
}

/**
 * Build the axe.run() config object passed to page.evaluate.
 */
function buildAxeRunConfig(route, extraDisabled = []) {
  return {
    runOnly: { type: "tag", values: Array.from(A11Y_AXE_TAGS) },
    rules: buildAxeDisabledRules(route, extraDisabled).reduce((acc, ruleId) => {
      acc[ruleId] = { enabled: false };
      return acc;
    }, {}),
    resultTypes: ["violations"],
  };
}

/**
 * Build the a11y manifest object for a completed run.
 */
function buildA11yManifest({ cells, base, capturedAt, browserVersion, totalElapsedMs, axeVersion }) {
  const summary = {
    totalCells: cells.length,
    cellsAllPassed: cells.filter((c) => c.summary && c.summary.ok && !c.failed).length,
    cellsWithFailures: cells.filter((c) => c.summary && !c.summary.ok && !c.failed).length,
    cellsWithErrors: cells.filter((c) => c.failed).length,
    totalAxeViolations: cells.reduce(
      (s, c) => s + (c.summary && c.summary.axe ? c.summary.axe.totalViolations : 0), 0,
    ),
    totalAxeFailingImpacts: cells.reduce(
      (s, c) => s + (c.summary && c.summary.axe ? c.summary.axe.failingImpactsHit : 0), 0,
    ),
    totalCustomFailed: cells.reduce(
      (s, c) => s + (c.summary && c.summary.custom ? c.summary.custom.failed : 0), 0,
    ),
  };
  return {
    schema: "harness-visual-a11y/v1",
    capturedAt,
    base,
    browser: { name: "chromium", version: browserVersion || null },
    axe: { name: "axe-core", version: axeVersion || null, tags: Array.from(A11Y_AXE_TAGS) },
    customRulesetVersion: A11Y_CUSTOM_RULES.length,
    customRuleIds: A11Y_CUSTOM_RULES.map((r) => r.id),
    totalElapsedMs,
    cells,
    summary,
  };
}

/**
 * Run the a11y matrix against a live server.
 *
 * @param {object} opts
 * @param {string} opts.base
 * @param {Array}  [opts.viewports]
 * @param {Array}  [opts.routes]
 * @param {object} [opts.playwright]
 * @param {object} [opts.axeCore]            Inject axe-core for tests
 * @param {object} [opts.fsImpl]
 * @param {Function} [opts.nowFn]
 * @param {Array}  [opts.extraDisabledRules] Additional axe rules to disable
 */
async function runA11yMatrix(opts) {
  if (!opts || typeof opts.base !== "string") {
    throw new Error("runA11yMatrix: opts.base is required");
  }
  const base = opts.base.replace(/\/$/, "");
  const viewports = opts.viewports || VIEWPORTS;
  const routes = opts.routes || ROUTES;
  const fsImpl = opts.fsImpl || fs;
  const nowFn = opts.nowFn || (() => Date.now());
  const extraDisabledRules = opts.extraDisabledRules || [];

  const playwright = opts.playwright || require("playwright-core");
  const axeCore = opts.axeCore || require("axe-core");

  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (err) {
    const wrapped = new Error(
      "Failed to launch chromium. Run `npm run visual:install-browsers` " +
      "to install the browser binary.",
    );
    wrapped.code = "BROWSER_NOT_INSTALLED";
    wrapped.cause = err;
    throw wrapped;
  }

  const browserVersion = browser.version();
  const axeVersion = axeCore.version || null;
  const startTotal = nowFn();
  const cells = [];

  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        const cellStart = nowFn();
        let context;
        let page;
        try {
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: viewport.deviceScaleFactor,
            isMobile: viewport.isMobile,
            reducedMotion: "reduce",
            colorScheme: "light",
          });
          page = await context.newPage();
          await page.goto(`${base}${route.pathname}`, {
            waitUntil: "domcontentloaded",
            timeout: DEFAULT_NAV_TIMEOUT_MS,
          });
          await page.waitForSelector(route.waitForSelector, {
            timeout: DEFAULT_SELECTOR_TIMEOUT_MS,
          });
          await page.waitForTimeout(DEFAULT_POST_PAINT_DELAY_MS);

          // Inject axe-core into the page context. addScriptTag with
          // `content` runs the source verbatim — axe.source is the
          // bundled IIFE that registers the global `axe` object.
          await page.addScriptTag({ content: axeCore.source });

          // Run axe with our config. page.evaluate receives the
          // config as second arg (cannot reference outer-scope vars).
          const axeConfig = buildAxeRunConfig(route, extraDisabledRules);
          const axeResult = await page.evaluate(async (cfg) => {
            // eslint-disable-next-line no-undef
            return await axe.run(document, cfg);
          }, axeConfig);

          // Custom rules run on the same page (axe injection done).
          const customResults = await runCustomRules(page, viewport, route);

          const cellSummary = summarizeCellA11y({ axeResult, customResults });

          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            axeViolations: axeResult.violations || [],
            customResults,
            summary: cellSummary,
            totalMs: nowFn() - cellStart,
            ok: cellSummary.ok,
            failed: false,
          });
        } catch (cellErr) {
          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            axeViolations: null,
            customResults: null,
            summary: null,
            totalMs: nowFn() - cellStart,
            ok: false,
            failed: true,
            failureReason: String(cellErr && cellErr.message || cellErr),
          });
        } finally {
          if (page) { try { await page.close(); } catch (_) {} }
          if (context) { try { await context.close(); } catch (_) {} }
        }
      }
    }
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  // Touch fsImpl just enough for callers that injected one — keeps
  // the API symmetric with capture.js / assert-runner.js even though
  // a11y itself doesn't write per-cell files.
  void fsImpl;

  const totalElapsedMs = nowFn() - startTotal;
  const capturedAt = new Date(nowFn()).toISOString();
  const manifest = buildA11yManifest({
    cells,
    base,
    capturedAt,
    browserVersion,
    totalElapsedMs,
    axeVersion,
  });

  const exitCode =
    manifest.summary.cellsWithFailures > 0 || manifest.summary.cellsWithErrors > 0
      ? 1
      : 0;

  return { manifest, exitCode };
}

module.exports = {
  runCustomRules,
  buildAxeDisabledRules,
  buildAxeRunConfig,
  buildA11yManifest,
  runA11yMatrix,
  DEFAULT_NAV_TIMEOUT_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  DEFAULT_POST_PAINT_DELAY_MS,
};
