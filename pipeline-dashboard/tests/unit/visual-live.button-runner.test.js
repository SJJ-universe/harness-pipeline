// Slice UI-P13-b (Phase D Round UI-P, 2026-05-04) — button-runner
// stub-injection tests. NO real chromium spawn.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runner = require("../../scripts/visual-live/button-runner");
const { BUTTONS } = require("../../scripts/visual-live/button-catalog");

// ── buildButtonManifest ─────────────────────────────────────────

test("UI-P13 buildButtonManifest: schema + summary derivation", () => {
  const cells = [
    {
      routeId: "r1", viewportId: "vp",
      summary: { applicable: 13, passed: 13, failed: 0, skipped: 0 },
      ok: true, failed: false,
    },
    {
      routeId: "r2", viewportId: "vp",
      summary: { applicable: 13, passed: 11, failed: 2, skipped: 0 },
      ok: false, failed: false,
    },
    {
      routeId: "r3", viewportId: "vp",
      summary: null,
      ok: false, failed: true,
      failureReason: "navigation timeout",
    },
  ];
  const m = runner.buildButtonManifest({
    cells,
    base: "http://x:4799",
    capturedAt: "2026-05-04T00:00:00.000Z",
    browserVersion: "131.0.0.0",
    totalElapsedMs: 5000,
    viewportId: "desktop-1366",
  });
  assert.equal(m.schema, "orchestrator-visual-button/v1");
  assert.equal(m.viewportId, "desktop-1366");
  assert.equal(m.catalogVersion, BUTTONS.length);
  assert.equal(m.catalogIds.length, BUTTONS.length);
  assert.deepEqual(m.activityThresholds, { minMutations: 1, minNetworkRequests: 1 });
  assert.equal(m.summary.totalCells, 3);
  assert.equal(m.summary.cellsAllPassed, 1);
  assert.equal(m.summary.cellsWithFailures, 1);
  assert.equal(m.summary.cellsWithErrors, 1);
  assert.equal(m.summary.totalButtonsApplicable, 26);
  assert.equal(m.summary.totalButtonsPassed, 24);
  assert.equal(m.summary.totalButtonsFailed, 2);
});

// ── Stub builders ───────────────────────────────────────────────

function _stubPage({
  staticImpl = null,
  activityImpl = null,
  clickImpl = null,
  requestEmitter = null,
} = {}) {
  // Simulates page.evaluate returning canned values for either
  // _evalStaticButtonState (first arg = function ref, second arg
  // = selector string) or _setupActivityObserver / _readActivity
  // (no second arg).
  const requestListeners = [];
  return {
    requestListeners,
    async evaluate(fn, ...args) {
      // First-arg differentiates: _evalStaticButtonState takes a
      // selector string; _setupActivityObserver / _readActivity
      // don't.
      if (args.length > 0 && typeof args[0] === "string") {
        // Static evaluation — return per-selector canned value.
        if (staticImpl) return staticImpl(args[0]);
        return { found: true, visible: true, hasName: true, disabled: false, hasReason: false };
      }
      // Setup vs read distinguished by activityImpl using counter.
      if (activityImpl) return activityImpl();
      return true;
    },
    on(event, fn) {
      if (event === "request") requestListeners.push(fn);
    },
    off(event, fn) {
      if (event === "request") {
        const i = requestListeners.indexOf(fn);
        if (i >= 0) requestListeners.splice(i, 1);
      }
    },
    async click(selector, _opts) {
      if (clickImpl) return clickImpl(selector);
      // Default: simulate one network request firing
      if (requestEmitter) requestEmitter(this);
    },
    async waitForTimeout() {},
  };
}

function _stubPlaywright({
  throwOnLaunch = false,
  pageImpl = null,
  navThrowsForRoute = null,
} = {}) {
  return {
    chromium: {
      async launch() {
        if (throwOnLaunch) {
          throw new Error("browserType.launch: Executable doesn't exist");
        }
        return {
          version: () => "131.0.0.0",
          async newContext() {
            return {
              async newPage() {
                if (pageImpl) {
                  // pageImpl gets a special page that exposes goto/
                  // waitForSelector + evaluate/click/etc.
                  const stubbed = pageImpl();
                  return Object.assign(stubbed, {
                    async goto(url) {
                      stubbed._lastUrl = url;
                      if (navThrowsForRoute && url.includes(navThrowsForRoute)) {
                        throw new Error("simulated nav for " + navThrowsForRoute);
                      }
                    },
                    async waitForSelector() {},
                    async waitForTimeout() {},
                    async close() {},
                  });
                }
                return {
                  async goto() {},
                  async waitForSelector() {},
                  async waitForTimeout() {},
                  async evaluate() {
                    return { found: true, visible: true, hasName: true, disabled: false, hasReason: false };
                  },
                  on() {}, off() {},
                  async click() {},
                  async close() {},
                };
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    },
  };
}

// ── runButtonsForCell ───────────────────────────────────────────

test("UI-P13 runButtonsForCell: clean page → all visible+enabled+named buttons pass", async () => {
  // Stub page: static returns happy state for all buttons; clickSafe
  // buttons get default click→1 mutation tracked via activityImpl.
  let callIndex = 0;
  const page = _stubPage({
    staticImpl: () => ({
      found: true, visible: true, hasName: true,
      disabled: false, hasReason: false,
      text: "Button", width: 100, height: 30,
    }),
    activityImpl: () => {
      callIndex += 1;
      // Even calls = setup (return true); odd calls = read (return activity).
      // Order is: setup (call 1), read (call 2), setup (call 3), read (call 4)...
      return callIndex % 2 === 1
        ? true  // setup
        : { mutations: 5, errors: [] };  // read
    },
    requestEmitter: (p) => {
      // Simulate a network request firing on click
      for (const fn of p.requestListeners) fn();
    },
  });
  const out = await runner.runButtonsForCell(
    page,
    { id: "desktop-1366", isMobile: false },
    { id: "product-pro" },
  );
  // product-pro applies to most buttons (legacy is filtered out in catalog)
  assert.ok(out.summary.applicable > 0);
  assert.equal(out.summary.failed, 0,
    "all buttons should pass with happy stub");
  assert.equal(out.summary.passed + out.summary.skipped, out.summary.applicable + out.summary.skipped);
  // legacy-only buttons should be skipped (none in this catalog,
  // but everything should be covered by skipped count for legacy
  // route — here we used product-pro)
});

test("UI-P13 runButtonsForCell: button without accessible name → fail", async () => {
  // Stub: static returns hasName:false for the FIRST button only;
  // others happy.
  let callIndex = 0;
  const page = _stubPage({
    staticImpl: () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          found: true, visible: true,
          hasName: false, disabled: false, hasReason: false,
          text: "", ariaLabel: null, title: null,
          width: 100, height: 30,
        };
      }
      return {
        found: true, visible: true, hasName: true,
        disabled: false, hasReason: false,
      };
    },
    activityImpl: () => true,  // never matters because clickSafe path won't run
  });
  const out = await runner.runButtonsForCell(
    page, { id: "desktop-1366", isMobile: false }, { id: "product-pro" },
  );
  assert.ok(out.summary.failed >= 1,
    "first button without name must FAIL");
  const failed = out.results.find((r) => r.status === "no-accessible-name");
  assert.ok(failed, "must record no-accessible-name status");
});

test("UI-P13 runButtonsForCell: disabled-without-reason → fail", async () => {
  let callIndex = 0;
  const page = _stubPage({
    staticImpl: () => {
      callIndex += 1;
      if (callIndex === 1) {
        return {
          found: true, visible: true, hasName: true,
          disabled: true, hasReason: false,  // disabled but no aria-label or title
        };
      }
      return { found: true, visible: true, hasName: true, disabled: false, hasReason: false };
    },
    activityImpl: () => true,
  });
  const out = await runner.runButtonsForCell(
    page, { id: "desktop-1366", isMobile: false }, { id: "product-pro" },
  );
  const failed = out.results.find((r) => r.status === "disabled-without-reason");
  assert.ok(failed, "disabled without reason must be flagged");
});

test("UI-P13 runButtonsForCell: dead button (click no activity) → fail", async () => {
  // Stub: all buttons static-happy; clickSafe buttons get
  // mutations:0 + 0 requests (dead handler).
  const page = _stubPage({
    staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
    activityImpl: () => {
      // Alternate setup → read; read returns 0 mutations + 0 errors
      // (dead button)
      return { mutations: 0, errors: [] };
    },
    // No requestEmitter — clicks fire no network requests
  });
  const out = await runner.runButtonsForCell(
    page, { id: "desktop-1366", isMobile: false }, { id: "product-pro" },
  );
  // ANY clickSafe button should produce a click-no-activity failure
  const dead = out.results.find((r) => r.status === "click-no-activity");
  assert.ok(dead, "at least one clickSafe button must register click-no-activity");
});

test("UI-P13 runButtonsForCell: console.error during click → fail", async () => {
  let setupCalled = false;
  const page = _stubPage({
    staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
    activityImpl: () => {
      if (!setupCalled) { setupCalled = true; return true; }
      setupCalled = false;
      return { mutations: 5, errors: ["TypeError: X is undefined"] };
    },
  });
  const out = await runner.runButtonsForCell(
    page, { id: "desktop-1366", isMobile: false }, { id: "product-pro" },
  );
  const errored = out.results.find((r) => r.status === "click-console-error");
  assert.ok(errored, "console.error during click must be flagged");
  assert.ok(errored.detail === null || errored.reason);
});

test("UI-P13 runButtonsForCell: legacy route → all buttons skipped (applies-to-false)", async () => {
  const page = _stubPage();
  const out = await runner.runButtonsForCell(
    page,
    { id: "desktop-1366", isMobile: false },
    { id: "legacy" },
  );
  assert.equal(out.summary.applicable, 0,
    "legacy route filters out every product-shell button via appliesTo");
  assert.equal(out.summary.skipped, BUTTONS.length);
  for (const r of out.results) {
    assert.equal(r.status, "applies-to-false");
    assert.equal(r.skipped, true);
  }
});

// ── runButtonMatrix ─────────────────────────────────────────────

test("UI-P13 runButtonMatrix: 4 routes happy path → exit 0", async () => {
  const stub = _stubPlaywright({
    pageImpl: () => _stubPage({
      staticImpl: () => ({
        found: true, visible: true, hasName: true, disabled: false, hasReason: false,
      }),
      activityImpl: () => ({ mutations: 5, errors: [] }),
      requestEmitter: (p) => { for (const fn of p.requestListeners) fn(); },
    }),
  });
  const out = await runner.runButtonMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.manifest.summary.totalCells, 4,
    "4 routes × 1 viewport (desktop-1366 default)");
  assert.equal(out.manifest.summary.cellsAllPassed, 4);
});

test("UI-P13 runButtonMatrix: BROWSER_NOT_INSTALLED bubbled up", async () => {
  const stub = _stubPlaywright({ throwOnLaunch: true });
  await assert.rejects(
    async () => runner.runButtonMatrix({ base: "http://x", playwright: stub }),
    (err) => {
      assert.equal(err.code, "BROWSER_NOT_INSTALLED");
      return true;
    },
  );
});

test("UI-P13 runButtonMatrix: nav fault for one route → cellsWithErrors counted", async () => {
  const stub = _stubPlaywright({
    pageImpl: () => _stubPage({
      staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
      activityImpl: () => ({ mutations: 5, errors: [] }),
      requestEmitter: (p) => { for (const fn of p.requestListeners) fn(); },
    }),
    navThrowsForRoute: "?mode=pro",
  });
  const out = await runner.runButtonMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
  });
  assert.equal(out.manifest.summary.totalCells, 4);
  assert.equal(out.manifest.summary.cellsWithErrors, 1,
    "1 broken route");
  assert.equal(out.exitCode, 1);
});

test("UI-P13 runButtonMatrix: subset routes honored", async () => {
  const stub = _stubPlaywright({
    pageImpl: () => _stubPage({
      staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
      activityImpl: () => ({ mutations: 5, errors: [] }),
      requestEmitter: (p) => { for (const fn of p.requestListeners) fn(); },
    }),
  });
  const out = await runner.runButtonMatrix({
    base: "http://x",
    routes: [{ id: "test", pathname: "/", waitForSelector: "#root" }],
    playwright: stub,
  });
  assert.equal(out.manifest.summary.totalCells, 1);
});

test("UI-P13 runButtonMatrix: requires opts.base", async () => {
  await assert.rejects(
    async () => runner.runButtonMatrix({}),
    /opts\.base is required/,
  );
});

test("UI-P13 runButtonMatrix: trailing slash on base normalized", async () => {
  const stub = _stubPlaywright({
    pageImpl: () => _stubPage({
      staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
      activityImpl: () => ({ mutations: 5, errors: [] }),
      requestEmitter: (p) => { for (const fn of p.requestListeners) fn(); },
    }),
  });
  const out = await runner.runButtonMatrix({
    base: "http://127.0.0.1:4799/",
    playwright: stub,
  });
  assert.equal(out.manifest.base, "http://127.0.0.1:4799");
});

test("UI-P13 runButtonMatrix: viewportId echoed into manifest", async () => {
  const stub = _stubPlaywright({
    pageImpl: () => _stubPage({
      staticImpl: () => ({ found: true, visible: true, hasName: true, disabled: false, hasReason: false }),
      activityImpl: () => ({ mutations: 5, errors: [] }),
      requestEmitter: (p) => { for (const fn of p.requestListeners) fn(); },
    }),
  });
  const out = await runner.runButtonMatrix({ base: "http://x", playwright: stub });
  assert.equal(out.manifest.viewportId, "desktop-1366",
    "default viewport is desktop-1366");
});
