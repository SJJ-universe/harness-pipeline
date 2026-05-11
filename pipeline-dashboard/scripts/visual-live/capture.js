// Slice UI-P10-b (Phase D Round UI-P, 2026-05-04) — live browser
// screenshot capture using playwright-core (NO test runner overhead).
//
// What this module does:
//   - For each (route × viewport) cell in the 4×4 = 16 matrix, opens
//     a chromium browser context, navigates to the live orchestrator
//     server, waits for the route's documented mount selector, takes
//     a full-page PNG screenshot, records timing metadata.
//   - Returns a manifest object describing every cell + outcome.
//   - Never throws on a single-cell failure — records `failed: true`
//     in the manifest cell + continues. Caller decides how to react
//     to per-cell failures (CLI entry exits 1 if any failure).
//
// What this module does NOT do:
//   - Pixel-level diff against a baseline (UI-P10 is evidence
//     capture only; baseline-diffing is a follow-up round)
//   - CSS/responsive assertions (those land in UI-P11)
//   - A11y assertions (those land in UI-P12)
//
// Browser binaries:
//   playwright-core throws a clear "browserType.launch: Executable
//   doesn't exist..." error when chromium isn't installed. The CLI
//   entry catches that and prints the operator install command
//   (`npm run visual:install-browsers`).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { VIEWPORTS } = require("./viewports");
const { ROUTES } = require("./routes");

const DEFAULT_NAV_TIMEOUT_MS = 30000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 15000;
const DEFAULT_POST_PAINT_DELAY_MS = 250;

/**
 * Construct the deterministic filename for a single capture cell.
 * Format: `<route.id>__<viewport.id>.png`. The double-underscore
 * keeps filesystem listings predictable and easy to grep.
 */
function cellFilename(route, viewport) {
  if (!route || typeof route.id !== "string") {
    throw new Error("cellFilename: route.id must be a string");
  }
  if (!viewport || typeof viewport.id !== "string") {
    throw new Error("cellFilename: viewport.id must be a string");
  }
  return `${route.id}__${viewport.id}.png`;
}

/**
 * Build the manifest JSON object that summarizes a capture run.
 * Operators commit this alongside the PNGs so a later git diff can
 * surface "which cell changed" without opening every image.
 */
function buildManifest({ cells, base, capturedAt, browserVersion, totalElapsedMs }) {
  return {
    schema: "orchestrator-visual-live/v1",
    capturedAt,
    base,
    browser: { name: "chromium", version: browserVersion || null },
    totalElapsedMs,
    cells: cells.map((c) => ({
      routeId: c.routeId,
      viewportId: c.viewportId,
      pathname: c.pathname,
      width: c.width,
      height: c.height,
      isMobile: c.isMobile,
      filename: c.filename,
      bytes: c.bytes,
      navMs: c.navMs,
      paintMs: c.paintMs,
      totalMs: c.totalMs,
      ok: c.ok,
      failed: c.failed || false,
      failureReason: c.failureReason || null,
    })),
    summary: {
      total: cells.length,
      ok: cells.filter((c) => c.ok).length,
      failed: cells.filter((c) => c.failed).length,
    },
  };
}

/**
 * Run the full capture matrix (routes × viewports) against a live
 * server. Returns `{manifest, outDir, exitCode}` — caller is
 * responsible for writing the manifest to disk.
 *
 * @param {object} opts
 * @param {string} opts.base                Server base URL (e.g. http://127.0.0.1:4799)
 * @param {string} opts.outDir              Directory to write PNGs into (created if missing)
 * @param {object} [opts.playwright]        Injectable playwright-core for tests (defaults to require'd)
 * @param {Array}  [opts.viewports]         Override VIEWPORTS for tests
 * @param {Array}  [opts.routes]            Override ROUTES for tests
 * @param {object} [opts.fsImpl]            Injectable fs for tests
 * @param {Function} [opts.nowFn]           Injectable Date.now for tests
 */
async function runCapture(opts) {
  if (!opts || typeof opts.base !== "string") {
    throw new Error("runCapture: opts.base is required");
  }
  if (!opts || typeof opts.outDir !== "string") {
    throw new Error("runCapture: opts.outDir is required");
  }
  const base = opts.base.replace(/\/$/, "");
  const outDir = opts.outDir;
  const viewports = opts.viewports || VIEWPORTS;
  const routes = opts.routes || ROUTES;
  const fsImpl = opts.fsImpl || fs;
  const nowFn = opts.nowFn || (() => Date.now());

  // Lazy-require playwright-core so the module is requireable on
  // machines without browser binaries (the helpers test only loads
  // this module to read cellFilename / buildManifest).
  const playwright = opts.playwright || require("playwright-core");

  const startTotal = nowFn();
  fsImpl.mkdirSync(outDir, { recursive: true });

  let browser;
  try {
    browser = await playwright.chromium.launch();
  } catch (err) {
    // Wrap with a recognizable error code — CLI entry uses this to
    // print the operator install command instead of a stack trace.
    const wrapped = new Error(
      "Failed to launch chromium. Run `npm run visual:install-browsers` " +
      "to install the browser binary.",
    );
    wrapped.code = "BROWSER_NOT_INSTALLED";
    wrapped.cause = err;
    throw wrapped;
  }

  const browserVersion = browser.version();
  const cells = [];

  try {
    for (const route of routes) {
      for (const viewport of viewports) {
        const cellStart = nowFn();
        let context;
        let page;
        const filename = cellFilename(route, viewport);
        const targetPath = path.join(outDir, filename);
        try {
          context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: viewport.deviceScaleFactor,
            isMobile: viewport.isMobile,
            // Reduced-motion + media-color hints make captures
            // deterministic across machines.
            reducedMotion: "reduce",
            colorScheme: "light",
          });
          page = await context.newPage();
          const navStart = nowFn();
          await page.goto(`${base}${route.pathname}`, {
            waitUntil: "domcontentloaded",
            timeout: DEFAULT_NAV_TIMEOUT_MS,
          });
          const navMs = nowFn() - navStart;
          await page.waitForSelector(route.waitForSelector, {
            timeout: DEFAULT_SELECTOR_TIMEOUT_MS,
          });
          // Brief delay so any post-mount paint settles before the
          // shutter fires — prevents racy half-rendered captures.
          await page.waitForTimeout(DEFAULT_POST_PAINT_DELAY_MS);
          const paintStart = nowFn();
          const buf = await page.screenshot({
            fullPage: true,
            type: "png",
          });
          const paintMs = nowFn() - paintStart;
          fsImpl.writeFileSync(targetPath, buf);
          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            filename,
            bytes: buf.length,
            navMs,
            paintMs,
            totalMs: nowFn() - cellStart,
            ok: true,
            failed: false,
          });
        } catch (cellErr) {
          // Single-cell failure must never abort the whole run —
          // operators want to see which subset broke.
          cells.push({
            routeId: route.id,
            viewportId: viewport.id,
            pathname: route.pathname,
            width: viewport.width,
            height: viewport.height,
            isMobile: viewport.isMobile,
            filename,
            bytes: 0,
            navMs: 0,
            paintMs: 0,
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
  const manifest = buildManifest({
    cells,
    base,
    capturedAt,
    browserVersion,
    totalElapsedMs,
  });

  const exitCode = manifest.summary.failed > 0 ? 1 : 0;
  return { manifest, outDir, exitCode };
}

module.exports = {
  cellFilename,
  buildManifest,
  runCapture,
  // Constants — exposed so unit tests + CLI can echo them.
  DEFAULT_NAV_TIMEOUT_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  DEFAULT_POST_PAINT_DELAY_MS,
};
