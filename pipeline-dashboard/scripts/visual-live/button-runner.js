// Slice UI-P13-b (Phase D Round UI-P, 2026-05-04) — button-runner
// that boots playwright-core chromium + iterates the same 4 routes
// from UI-P10/P11/P12, but instead of axe / responsive checks
// runs the UI-P13-a button catalog against each route.
//
// NOTE: Unlike UI-P10/P11/P12 this round runs ONE viewport per
// route (1366×768 desktop) rather than the full 4×4 matrix:
//   - Button presence/wiring is route-mode-dependent, NOT
//     viewport-dependent (a button that fires on desktop fires on
//     mobile too, modulo CSS visibility which UI-P11 already gates)
//   - 4 routes × 13 buttons × 4 viewports × click+wait would be
//     ~3 minutes of click churn — diminishing returns
//   - UI-P11 + UI-P12 already cover the per-viewport surface
//
// If a future round needs per-viewport button checking (e.g.,
// touch-only mobile buttons that don't render on desktop) we can
// add a `viewports` knob; for v1 single-desktop is the right
// trade-off.
//
// Manifest schema `harness-visual-button/v1` (distinct from
// capture v1 / assert v1 / a11y v1).

"use strict";

const { ROUTES } = require("./routes");
const { VIEWPORTS } = require("./viewports");
const {
  BUTTONS,
  summarizeButtonResult,
  _evalStaticButtonState,
  MIN_DOM_MUTATIONS,
  MIN_NETWORK_REQUESTS,
} = require("./button-catalog");

const DEFAULT_NAV_TIMEOUT_MS = 30000;
const DEFAULT_SELECTOR_TIMEOUT_MS = 15000;
const DEFAULT_POST_PAINT_DELAY_MS = 250;
const DEFAULT_CLICK_TIMEOUT_MS = 1500;
const DEFAULT_POST_CLICK_WAIT_MS = 400;

// ── Browser-side helpers (passed to page.evaluate) ───────────────

function _setupActivityObserver() {
  // Reset observer state between buttons.
  if (window.__p13obs) {
    try { window.__p13obs.disconnect(); } catch (_) {}
  }
  window.__p13activity = { mutations: 0, errors: [] };
  const obs = new MutationObserver((mutations) => {
    window.__p13activity.mutations += mutations.length;
  });
  obs.observe(document.body, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  window.__p13obs = obs;
  // Patch console.error to capture handler-side faults.
  if (!window.__p13origConsoleError) {
    window.__p13origConsoleError = console.error.bind(console);
  }
  console.error = function () {
    try {
      const text = Array.prototype.map.call(arguments, function (a) {
        try { return String(a); } catch (_) { return "[unserializable]"; }
      }).join(" ").slice(0, 200);
      window.__p13activity.errors.push(text);
    } catch (_) {}
    window.__p13origConsoleError.apply(null, arguments);
  };
  return true;
}

function _readActivity() {
  try {
    if (window.__p13obs) window.__p13obs.disconnect();
  } catch (_) {}
  // Restore console.error to baseline so the next button starts
  // clean.
  if (window.__p13origConsoleError) {
    console.error = window.__p13origConsoleError;
  }
  return window.__p13activity || { mutations: 0, errors: [] };
}

// ── buildButtonManifest ─────────────────────────────────────────

function buildButtonManifest({ cells, base, capturedAt, browserVersion, totalElapsedMs, viewportId }) {
  // Each "cell" is one route × one viewport. cells[].buttons[] is
  // the per-button result list.
  const summary = {
    totalCells: cells.length,
    cellsAllPassed: cells.filter((c) => c.summary && c.summary.failed === 0 && !c.failed).length,
    cellsWithFailures: cells.filter((c) => c.summary && c.summary.failed > 0).length,
    cellsWithErrors: cells.filter((c) => c.failed).length,
    totalButtonsApplicable: cells.reduce((s, c) => s + (c.summary ? c.summary.applicable : 0), 0),
    totalButtonsPassed: cells.reduce((s, c) => s + (c.summary ? c.summary.passed : 0), 0),
    totalButtonsFailed: cells.reduce((s, c) => s + (c.summary ? c.summary.failed : 0), 0),
    totalButtonsSkipped: cells.reduce((s, c) => s + (c.summary ? c.summary.skipped : 0), 0),
  };
  return {
    schema: "harness-visual-button/v1",
    capturedAt,
    base,
    browser: { name: "chromium", version: browserVersion || null },
    viewportId: viewportId || null,
    catalogVersion: BUTTONS.length,
    catalogIds: BUTTONS.map((b) => b.id),
    activityThresholds: {
      minMutations: MIN_DOM_MUTATIONS,
      minNetworkRequests: MIN_NETWORK_REQUESTS,
    },
    totalElapsedMs,
    cells,
    summary,
  };
}

// ── runButtonsForCell ───────────────────────────────────────────
// Iterate the catalog against a single (route, viewport) page.

async function runButtonsForCell(page, viewport, route) {
  const results = [];
  let applicable = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const button of BUTTONS) {
    if (!button.appliesTo(viewport, route)) {
      results.push({
        id: button.id,
        label: button.label,
        ok: true,
        status: "applies-to-false",
        skipped: true,
      });
      skipped += 1;
      continue;
    }
    applicable += 1;

    // STATIC check
    const staticResult = await page.evaluate(_evalStaticButtonState, button.selector);
    let clickResult = null;

    // CLICK check (clickSafe only + element visible + not disabled)
    if (
      button.clickSafe &&
      staticResult.found && staticResult.visible &&
      !staticResult.disabled
    ) {
      // Set up MutationObserver + console.error capture
      try { await page.evaluate(_setupActivityObserver); } catch (_) {}

      // Set up network listener
      let requests = 0;
      const onReq = () => { requests += 1; };
      page.on("request", onReq);

      let clickError = null;
      try {
        await page.click(button.selector, { timeout: DEFAULT_CLICK_TIMEOUT_MS });
      } catch (err) {
        clickError = String(err && err.message || err);
      }
      // Let the activity settle before reading.
      await page.waitForTimeout(DEFAULT_POST_CLICK_WAIT_MS);
      page.off("request", onReq);

      let activity = { mutations: 0, errors: [] };
      try { activity = await page.evaluate(_readActivity); } catch (_) {}

      clickResult = {
        clickError,
        mutations: activity.mutations || 0,
        requests,
        errors: activity.errors || [],
      };
    }

    const verdict = summarizeButtonResult(staticResult, clickResult);
    results.push({
      id: button.id,
      label: button.label,
      selector: button.selector,
      clickSafe: button.clickSafe,
      static: staticResult,
      click: clickResult,
      ok: verdict.ok,
      status: verdict.status,
      reason: verdict.reason || null,
      detail: verdict.detail || null,
    });
    if (verdict.ok) passed += 1;
    else failed += 1;
  }
  return {
    results,
    summary: { applicable, passed, failed, skipped },
  };
}

// ── runButtonMatrix ─────────────────────────────────────────────

async function runButtonMatrix(opts) {
  if (!opts || typeof opts.base !== "string") {
    throw new Error("runButtonMatrix: opts.base is required");
  }
  const base = opts.base.replace(/\/$/, "");
  const routes = opts.routes || ROUTES;
  // Default viewport: 1366×768 desktop. UI-P10/P11/P12 cover the
  // full 4×4 matrix; UI-P13 uses one viewport per route.
  const viewport = opts.viewport ||
    VIEWPORTS.find((v) => v.id === "desktop-1366") ||
    VIEWPORTS[0];
  const nowFn = opts.nowFn || (() => Date.now());

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

  const browserVersion = browser.version();
  const startTotal = nowFn();
  const cells = [];

  try {
    for (const route of routes) {
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

        const cellOut = await runButtonsForCell(page, viewport, route);
        cells.push({
          routeId: route.id,
          viewportId: viewport.id,
          pathname: route.pathname,
          buttons: cellOut.results,
          summary: cellOut.summary,
          totalMs: nowFn() - cellStart,
          ok: cellOut.summary.failed === 0,
          failed: false,
        });
      } catch (cellErr) {
        cells.push({
          routeId: route.id,
          viewportId: viewport.id,
          pathname: route.pathname,
          buttons: null,
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
  } finally {
    try { await browser.close(); } catch (_) {}
  }

  const totalElapsedMs = nowFn() - startTotal;
  const capturedAt = new Date(nowFn()).toISOString();
  const manifest = buildButtonManifest({
    cells,
    base,
    capturedAt,
    browserVersion,
    totalElapsedMs,
    viewportId: viewport.id,
  });

  const exitCode =
    manifest.summary.cellsWithFailures > 0 || manifest.summary.cellsWithErrors > 0
      ? 1
      : 0;

  return { manifest, exitCode };
}

module.exports = {
  buildButtonManifest,
  runButtonsForCell,
  runButtonMatrix,
  DEFAULT_NAV_TIMEOUT_MS,
  DEFAULT_SELECTOR_TIMEOUT_MS,
  DEFAULT_POST_PAINT_DELAY_MS,
  DEFAULT_CLICK_TIMEOUT_MS,
  DEFAULT_POST_CLICK_WAIT_MS,
  // Internal helpers exposed for shape testing
  _setupActivityObserver,
  _readActivity,
};
