// Slice UI-P11-b (Phase D Round UI-P, 2026-05-04) — assertion runner
// that boots playwright-core chromium + iterates the same 4×4 cell
// matrix as UI-P10 capture, but instead of saving PNGs runs the
// 6 assertions from `./assertions.js` against each cell.
//
// Why a separate runner from capture.js:
//   - Capture is evidence-only (UI-P10); assertions are pass/fail
//     with manifest summary the operator can chart over time.
//   - Runner can be invoked WITHOUT writing screenshots — faster
//     for the regression-checking use case (~3-5s vs ~8-12s).
//   - Operator chooses: `npm run visual:capture-live` (evidence) OR
//     `npm run visual:assert-live` (regression check). Future round
//     can fuse them once the assertion contract is mature.
//
// Module API:
//   runAssertMatrix({base, viewports?, routes?, playwright?, fsImpl?,
//                    nowFn?, screenshotFailedCells?, outDir?})
//     → Promise<{manifest, exitCode, outDir?}>
//
// exitCode semantics:
//   0  every applicable assertion passed across every cell
//   1  at least one assertion failed (manifest still returned)
//
// Manifest schema is `harness-visual-assert/v1` — distinct from
// capture.js's `harness-visual-live/v1` so future rounds can fuse
// them safely.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { VIEWPORTS } = require("./viewports");
const { ROUTES } = require("./routes");
const { ASSERTIONS, runAssertions } = require("./assertions");

const DEFAULT_NAV_TIMEOUT_MS = 30000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 15000;
const DEFAULT_POST_PAINT_DELAY_MS = 250;

/**
 * Build the assertion-run manifest object.
 */
function buildAssertManifest({ cells, base, capturedAt, browserVersion, totalElapsedMs }) {
  const summary = {
    totalCells: cells.length,
    cellsAllPassed: cells.filter((c) => c.summary && c.summary.failed === 0 && !c.failed).length,
    cellsWithFailures: cells.filter((c) => c.summary && c.summary.failed > 0).length,
    cellsWithErrors: cells.filter((c) => c.failed).length,
    totalAssertionsApplicable: cells.reduce((s, c) => s + (c.summary ? c.summary.applicable : 0), 0),
    totalAssertionsPassed: cells.reduce((s, c) => s + (c.summary ? c.summary.passed : 0), 0),
    totalAssertionsFailed: cells.reduce((s, c) => s + (c.summary ? c.summary.failed : 0), 0),
    totalAssertionsSkipped: cells.reduce((s, c) => s + (c.summary ? c.summary.skipped : 0), 0),
  };
  return {
    schema: "harness-visual-assert/v1",
    capturedAt,
    base,
    browser: { name: "chromium", version: browserVersion || null },
    rulesetVersion: ASSERTIONS.length,
    rulesetIds: ASSERTIONS.map((r) => r.id),
    totalElapsedMs,
    cells,
    summary,
  };
}

/**
 * Run the assertion matrix against a live server.
 *
 * @param {object} opts
 * @param {string} opts.base                 Server base URL
 * @param {Array}  [opts.viewports]          Override VIEWPORTS for tests
 * @param {Array}  [opts.routes]             Override ROUTES for tests
 * @param {object} [opts.playwright]         Inject playwright-core for tests
 * @param {object} [opts.fsImpl]             Inject fs for tests
 * @param {Function} [opts.nowFn]            Inject Date.now for tests
 * @param {boolean} [opts.screenshotFailedCells=false]
 *                                           When true + outDir is set, save a
 *                                           PNG of any cell with assertion
 *                                           failures so the operator can see
 *                                           what the bad layout looked like.
 * @param {string} [opts.outDir]             Required when screenshotFailedCells=true
 */
async function runAssertMatrix(opts) {
  if (!opts || typeof opts.base !== "string") {
    throw new Error("runAssertMatrix: opts.base is required");
  }
  const base = opts.base.replace(/\/$/, "");
  const viewports = opts.viewports || VIEWPORTS;
  const routes = opts.routes || ROUTES;
  const fsImpl = opts.fsImpl || fs;
  const nowFn = opts.nowFn || (() => Date.now());
  const shouldScreenshot = !!opts.screenshotFailedCells;
  const outDir = opts.outDir || null;
  if (shouldScreenshot && !outDir) {
    throw new Error("runAssertMatrix: screenshotFailedCells requires outDir");
  }

  const playwright = opts.playwright || require("playwright-core");

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

  if (shouldScreenshot && outDir) {
    fsImpl.mkdirSync(outDir, { recursive: true });
  }

  const browserVersion = browser.version();
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
          const assertOut = await runAssertions(page, viewport, route);

          // Optional debug screenshot when assertions failed.
          let screenshotPath = null;
          if (shouldScreenshot && assertOut.summary.failed > 0) {
            screenshotPath = path.join(
              outDir,
              `${route.id}__${viewport.id}__failed.png`,
            );
            try {
              const buf = await page.screenshot({ fullPage: true, type: "png" });
              fsImpl.writeFileSync(screenshotPath, buf);
            } catch (_) {
              // Screenshot failure is best-effort — never aborts the run.
              screenshotPath = null;
            }
          }

          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            results: assertOut.results,
            summary: assertOut.summary,
            totalMs: nowFn() - cellStart,
            ok: assertOut.summary.failed === 0,
            failed: false,
            screenshotPath,
          });
        } catch (cellErr) {
          // Cell-level fault (navigation timeout, etc.) — record + continue.
          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            results: null,
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

  const totalElapsedMs = nowFn() - startTotal;
  const capturedAt = new Date(nowFn()).toISOString();
  const manifest = buildAssertManifest({
    cells,
    base,
    capturedAt,
    browserVersion,
    totalElapsedMs,
  });

  // Exit 1 if any cell had failures OR errors; else 0.
  const exitCode =
    manifest.summary.cellsWithFailures > 0 || manifest.summary.cellsWithErrors > 0
      ? 1
      : 0;

  return { manifest, exitCode, outDir };
}

module.exports = {
  buildAssertManifest,
  runAssertMatrix,
  DEFAULT_NAV_TIMEOUT_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  DEFAULT_POST_PAINT_DELAY_MS,
};
