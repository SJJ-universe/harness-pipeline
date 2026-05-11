// Slice UI-P10-b (Phase D Round UI-P, 2026-05-04) — capture module
// shape contract + injectable-stub tests. NO real chromium spawn:
// this file passes a fake `playwright` object so the test runs on
// any machine without browser binaries (matches the CI principle
// that visual:capture-live is operator-runnable, not PR-gated).
//
// Live browser behavior (real chromium navigating real server) is
// covered by the operator runbook + LV-style closeout report from
// UI-P10-c — it would be expensive + flaky in regular CI.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const capture = require("../../scripts/visual-live/capture");

// ── Pure helpers ─────────────────────────────────────────────────

test("UI-P10 capture.cellFilename: deterministic format", () => {
  const route = { id: "product-pro" };
  const viewport = { id: "desktop-1366" };
  assert.equal(
    capture.cellFilename(route, viewport),
    "product-pro__desktop-1366.png",
  );
});

test("UI-P10 capture.cellFilename: throws on missing route.id / viewport.id", () => {
  assert.throws(() => capture.cellFilename(null, { id: "x" }),
    /route\.id must be a string/);
  assert.throws(() => capture.cellFilename({ id: "x" }, null),
    /viewport\.id must be a string/);
  assert.throws(() => capture.cellFilename({}, { id: "x" }),
    /route\.id must be a string/);
});

test("UI-P10 capture.buildManifest: schema + summary shape", () => {
  const cells = [
    { routeId: "a", viewportId: "v1", pathname: "/", width: 1366, height: 768, isMobile: false, filename: "a__v1.png", bytes: 100, navMs: 50, paintMs: 30, totalMs: 200, ok: true, failed: false },
    { routeId: "b", viewportId: "v1", pathname: "/?mode=x", width: 1366, height: 768, isMobile: false, filename: "b__v1.png", bytes: 0, navMs: 0, paintMs: 0, totalMs: 50, ok: false, failed: true, failureReason: "navigation failed" },
  ];
  const m = capture.buildManifest({
    cells,
    base: "http://127.0.0.1:4799",
    capturedAt: "2026-05-04T00:00:00.000Z",
    browserVersion: "131.0.6778.69",
    totalElapsedMs: 4321,
  });
  assert.equal(m.schema, "orchestrator-visual-live/v1");
  assert.equal(m.base, "http://127.0.0.1:4799");
  assert.equal(m.capturedAt, "2026-05-04T00:00:00.000Z");
  assert.equal(m.browser.name, "chromium");
  assert.equal(m.browser.version, "131.0.6778.69");
  assert.equal(m.totalElapsedMs, 4321);
  assert.equal(m.cells.length, 2);
  assert.equal(m.summary.total, 2);
  assert.equal(m.summary.ok, 1);
  assert.equal(m.summary.failed, 1);
  // failureReason preserved on failed cell
  assert.equal(m.cells[1].failureReason, "navigation failed");
  // failureReason null on ok cell
  assert.equal(m.cells[0].failureReason, null);
});

// ── Documented constants ─────────────────────────────────────────

test("UI-P10 capture: documented timeouts exposed as exports", () => {
  assert.equal(typeof capture.DEFAULT_NAV_TIMEOUT_MS, "number");
  assert.equal(typeof capture.DEFAULT_SELECTOR_TIMEOUT_MS, "number");
  assert.equal(typeof capture.DEFAULT_POST_PAINT_DELAY_MS, "number");
  assert.ok(capture.DEFAULT_NAV_TIMEOUT_MS >= 5000,
    "nav timeout must allow slow first paint");
  assert.ok(capture.DEFAULT_POST_PAINT_DELAY_MS < 1000,
    "post-paint delay must stay sub-second to keep matrix fast");
});

// ── Stub-injection: runCapture happy path ────────────────────────

function _stubFs() {
  const writes = [];
  const dirs = [];
  return {
    fsImpl: {
      mkdirSync: (p, _opts) => { dirs.push(p); },
      writeFileSync: (p, buf) => { writes.push({ path: p, length: buf.length }); },
    },
    writes,
    dirs,
  };
}

function _stubPlaywright({ throwOnLaunch = false, browserVersion = "131.0.0.0" } = {}) {
  let pageCalls = [];
  let contextCalls = [];
  return {
    chromium: {
      async launch() {
        if (throwOnLaunch) {
          const err = new Error("browserType.launch: Executable doesn't exist");
          throw err;
        }
        return {
          version: () => browserVersion,
          async newContext(opts) {
            contextCalls.push(opts);
            return {
              async newPage() {
                return {
                  async goto(url, _opts) { pageCalls.push({ goto: url }); },
                  async waitForSelector(sel, _opts) { pageCalls.push({ waitForSelector: sel }); },
                  async waitForTimeout(ms) { pageCalls.push({ waitForTimeout: ms }); },
                  async screenshot(_opts) {
                    pageCalls.push({ screenshot: true });
                    return Buffer.from("fake-png-data");
                  },
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
    pageCalls,
    contextCalls,
  };
}

test("UI-P10 capture.runCapture: writes 16 cells + manifest summary all ok", async () => {
  const { fsImpl, writes, dirs } = _stubFs();
  const stub = _stubPlaywright();
  const result = await capture.runCapture({
    base: "http://127.0.0.1:4799",
    outDir: "/tmp/visual-live-test",
    playwright: stub,
    fsImpl,
    nowFn: (() => { let t = 0; return () => (t += 10); })(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.manifest.summary.total, 16,
    "default matrix is 4 routes × 4 viewports");
  assert.equal(result.manifest.summary.ok, 16);
  assert.equal(result.manifest.summary.failed, 0);
  assert.equal(writes.length, 16, "must write 16 PNG files");
  assert.ok(dirs.length >= 1, "must create outDir");
  // Manifest cells have stable ordering — routes outer, viewports inner.
  assert.equal(result.manifest.cells[0].routeId, "product-default");
  assert.equal(result.manifest.cells[0].viewportId, "desktop-1366");
  assert.equal(result.manifest.cells[15].routeId, "legacy");
  assert.equal(result.manifest.cells[15].viewportId, "tablet-768");
});

test("UI-P10 capture.runCapture: BROWSER_NOT_INSTALLED code on launch failure", async () => {
  const { fsImpl } = _stubFs();
  const stub = _stubPlaywright({ throwOnLaunch: true });
  await assert.rejects(
    async () => capture.runCapture({
      base: "http://127.0.0.1:4799",
      outDir: "/tmp/visual-live-test",
      playwright: stub,
      fsImpl,
    }),
    (err) => {
      assert.equal(err.code, "BROWSER_NOT_INSTALLED");
      assert.match(err.message, /visual:install-browsers/);
      return true;
    },
  );
});

test("UI-P10 capture.runCapture: per-cell failure recorded but loop continues", async () => {
  const { fsImpl } = _stubFs();
  // Stub: page.goto throws on the second route — first 4 cells (one
  // route × 4 viewports) succeed; remaining 12 are failures with
  // recorded reasons.
  let routeCallCount = 0;
  const stub = {
    chromium: {
      async launch() {
        return {
          version: () => "131.0.0.0",
          async newContext(_) {
            return {
              async newPage() {
                return {
                  async goto(url) {
                    if (url.includes("?mode=pro")) {
                      throw new Error("simulated navigation failure");
                    }
                  },
                  async waitForSelector() {},
                  async waitForTimeout() {},
                  async screenshot() { return Buffer.from("ok"); },
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
  const result = await capture.runCapture({
    base: "http://127.0.0.1:4799",
    outDir: "/tmp/visual-live-test",
    playwright: stub,
    fsImpl,
  });
  // 4 viewports passed for product-default, 4 failed for product-pro,
  // 4 passed for product-simple, 4 passed for legacy = 12 ok / 4 fail
  assert.equal(result.manifest.summary.total, 16);
  assert.equal(result.manifest.summary.ok, 12);
  assert.equal(result.manifest.summary.failed, 4);
  assert.equal(result.exitCode, 1, "any failed cell → exit 1");
  // Verify the failed cells all targeted the pro route
  const failed = result.manifest.cells.filter((c) => c.failed);
  assert.equal(failed.length, 4);
  for (const c of failed) {
    assert.equal(c.routeId, "product-pro");
    assert.match(c.failureReason, /simulated navigation failure/);
  }
});

test("UI-P10 capture.runCapture: requires opts.base + opts.outDir", async () => {
  await assert.rejects(
    async () => capture.runCapture({}),
    /opts\.base is required/,
  );
  await assert.rejects(
    async () => capture.runCapture({ base: "http://x" }),
    /opts\.outDir is required/,
  );
});

test("UI-P10 capture.runCapture: trailing slash on base is normalized", async () => {
  const { fsImpl } = _stubFs();
  const stub = _stubPlaywright();
  const result = await capture.runCapture({
    base: "http://127.0.0.1:4799/",  // trailing slash
    outDir: "/tmp/visual-live-test",
    playwright: stub,
    fsImpl,
  });
  assert.equal(result.manifest.base, "http://127.0.0.1:4799",
    "trailing slash on base must be stripped to keep manifest stable");
});

test("UI-P10 capture.runCapture: subset routes/viewports honored for testing", async () => {
  const { fsImpl } = _stubFs();
  const stub = _stubPlaywright();
  const result = await capture.runCapture({
    base: "http://127.0.0.1:4799",
    outDir: "/tmp/visual-live-test",
    routes: [{ id: "test-route", pathname: "/", waitForSelector: "#root" }],
    viewports: [{ id: "test-viewport", width: 800, height: 600, deviceScaleFactor: 1, isMobile: false }],
    playwright: stub,
    fsImpl,
  });
  assert.equal(result.manifest.summary.total, 1);
  assert.equal(result.manifest.cells[0].filename, "test-route__test-viewport.png");
});
