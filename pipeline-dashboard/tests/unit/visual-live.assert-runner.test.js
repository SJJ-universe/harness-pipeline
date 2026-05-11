// Slice UI-P11-b (Phase D Round UI-P, 2026-05-04) — assert-runner
// stub-injection tests. NO real chromium spawn — uses fake
// playwright object that returns canned values for each
// page.evaluate call.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runner = require("../../scripts/visual-live/assert-runner");
const { ASSERTIONS } = require("../../scripts/visual-live/assertions");

// ── buildAssertManifest shape ────────────────────────────────────

test("UI-P11 assert-runner.buildAssertManifest: schema + summary derivation", () => {
  const cells = [
    {
      routeId: "r1", viewportId: "v1",
      summary: { applicable: 5, passed: 5, failed: 0, skipped: 1 },
      ok: true, failed: false,
    },
    {
      routeId: "r2", viewportId: "v1",
      summary: { applicable: 5, passed: 4, failed: 1, skipped: 1 },
      ok: false, failed: false,
    },
    {
      routeId: "r3", viewportId: "v1",
      summary: null,
      ok: false, failed: true,
      failureReason: "navigation timeout",
    },
  ];
  const m = runner.buildAssertManifest({
    cells,
    base: "http://x:4799",
    capturedAt: "2026-05-04T00:00:00.000Z",
    browserVersion: "131.0.0.0",
    totalElapsedMs: 5000,
  });
  assert.equal(m.schema, "orchestrator-visual-assert/v1");
  assert.equal(m.rulesetVersion, ASSERTIONS.length);
  assert.equal(m.rulesetIds.length, ASSERTIONS.length);
  assert.equal(m.summary.totalCells, 3);
  assert.equal(m.summary.cellsAllPassed, 1);
  assert.equal(m.summary.cellsWithFailures, 1);
  assert.equal(m.summary.cellsWithErrors, 1);
  assert.equal(m.summary.totalAssertionsApplicable, 10);
  assert.equal(m.summary.totalAssertionsPassed, 9);
  assert.equal(m.summary.totalAssertionsFailed, 1);
  assert.equal(m.summary.totalAssertionsSkipped, 2);
});

// ── Stub playwright builder ──────────────────────────────────────

function _stubPlaywright({
  throwOnLaunch = false,
  evaluateImpl = null,
  navThrowsForRoute = null,
  browserVersion = "131.0.0.0",
} = {}) {
  return {
    chromium: {
      async launch() {
        if (throwOnLaunch) {
          throw new Error("browserType.launch: Executable doesn't exist");
        }
        return {
          version: () => browserVersion,
          async newContext(_opts) {
            return {
              async newPage() {
                let lastUrl = null;
                return {
                  async goto(url) {
                    lastUrl = url;
                    if (navThrowsForRoute && url.includes(navThrowsForRoute)) {
                      throw new Error("simulated nav failure for " + navThrowsForRoute);
                    }
                  },
                  async waitForSelector() {},
                  async waitForTimeout() {},
                  async screenshot() { return Buffer.from("fake-png"); },
                  // page.evaluate is what assertions call — delegate
                  // to the per-test impl.
                  async evaluate(fn, ...args) {
                    if (typeof evaluateImpl === "function") {
                      return evaluateImpl(fn, args, lastUrl);
                    }
                    // Default: return a generic OK shape that
                    // satisfies all 6 assertion evaluators.
                    return {
                      // page-overflow shape
                      scrollWidth: 1000,
                      clientWidth: 1000,
                      overflow: 0,
                      // text-fit + tap-target + monitor-grid + pipeline-rail shape
                      total: 5,
                      failures: [],
                      // dual-terminals shape
                      found: true,
                      visible: true,
                    };
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
  };
}

// ── runAssertMatrix happy path ───────────────────────────────────

test("UI-P11 assert-runner.runAssertMatrix: all 16 cells pass with stub OK", async () => {
  const stub = _stubPlaywright();
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.manifest.summary.totalCells, 16,
    "default matrix is 4 routes × 4 viewports");
  assert.equal(result.manifest.summary.cellsAllPassed, 16);
  assert.equal(result.manifest.summary.cellsWithFailures, 0);
  assert.equal(result.manifest.summary.cellsWithErrors, 0);
  // ruleset metadata pinned in manifest
  assert.equal(result.manifest.rulesetIds[0], "no-horizontal-page-overflow");
});

test("UI-P11 assert-runner.runAssertMatrix: BROWSER_NOT_INSTALLED bubbles up", async () => {
  const stub = _stubPlaywright({ throwOnLaunch: true });
  await assert.rejects(
    async () => runner.runAssertMatrix({
      base: "http://127.0.0.1:4799",
      playwright: stub,
    }),
    (err) => {
      assert.equal(err.code, "BROWSER_NOT_INSTALLED");
      return true;
    },
  );
});

test("UI-P11 assert-runner.runAssertMatrix: per-cell nav fault → cells 4 of one route counted as errors", async () => {
  // navigation fails for any URL containing ?mode=pro → 4 viewports
  // worth of pro-route cells get error status; other 12 pass.
  const stub = _stubPlaywright({ navThrowsForRoute: "?mode=pro" });
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
  });
  assert.equal(result.manifest.summary.totalCells, 16);
  assert.equal(result.manifest.summary.cellsWithErrors, 4,
    "4 viewports × 1 broken route");
  assert.equal(result.manifest.summary.cellsAllPassed, 12);
  assert.equal(result.exitCode, 1);
  // Failed cells preserve the failureReason string
  const failed = result.manifest.cells.filter((c) => c.failed);
  for (const c of failed) {
    assert.equal(c.routeId, "product-pro");
    assert.match(c.failureReason, /simulated nav failure/);
  }
});

test("UI-P11 assert-runner.runAssertMatrix: assertion failure → exit 1 + cellsWithFailures count", async () => {
  // Stub: page-overflow assertion always reports overflow:200,
  // every other assertion reports OK. So every cell records one
  // failed assertion → exit 1.
  let evalIndexInCell = 0;
  let cellNumber = 0;
  const stub = _stubPlaywright({
    evaluateImpl: (_fn, _args, _url) => {
      evalIndexInCell += 1;
      // First evaluate per cell = page-overflow → fail
      if (evalIndexInCell === 1) {
        // Reset counter when starting next cell. There's no clean
        // signal for "new cell" inside the stub, but we know
        // each cell calls evaluate ≥ 5 times. Using modulo on
        // expected-per-cell call count keeps the stub simple.
        return { scrollWidth: 1500, clientWidth: 1366, overflow: 134 };
      }
      // Subsequent evaluates = other assertions → pass
      const isLastInCell = evalIndexInCell >= 6;
      const out = {
        // text-fit / monitor-grid / pipeline-rail shape
        total: 5, failures: [],
        // dual-terminals shape
        found: true, visible: true, scrollWidth: 100, clientWidth: 100, overflow: 0,
      };
      if (isLastInCell) {
        evalIndexInCell = 0;  // reset for next cell
        cellNumber += 1;
      }
      return out;
    },
  });
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
  });
  // Every cell has at least one failed assertion (page-overflow).
  // legacy route only runs page-overflow (other rules skip), so
  // the 4 legacy cells count just 1 failure each.
  assert.equal(result.exitCode, 1);
  assert.ok(result.manifest.summary.cellsWithFailures >= 1,
    "at least one cell should report assertion failures");
  assert.ok(result.manifest.summary.totalAssertionsFailed >= 1);
});

// ── Screenshot-on-failure option ─────────────────────────────────

test("UI-P11 assert-runner.runAssertMatrix: screenshotFailedCells writes PNG when failures present", async () => {
  const writes = [];
  const dirs = [];
  const fsImpl = {
    mkdirSync: (p) => dirs.push(p),
    writeFileSync: (p, buf) => writes.push({ path: p, length: buf.length }),
  };
  // Stub: every page-overflow check fails (overflow:200) → cells
  // record failure → screenshot triggered.
  let evalIndex = 0;
  const stub = _stubPlaywright({
    evaluateImpl: () => {
      evalIndex += 1;
      if (evalIndex % 6 === 1) {
        return { scrollWidth: 1500, clientWidth: 1366, overflow: 134 };
      }
      return {
        total: 5, failures: [],
        found: true, visible: true, scrollWidth: 100, clientWidth: 100, overflow: 0,
      };
    },
  });
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
    fsImpl,
    screenshotFailedCells: true,
    outDir: "/tmp/assert-fail",
  });
  assert.ok(dirs.length >= 1, "outDir must be created");
  assert.ok(writes.length > 0, "at least one failed-cell screenshot must be written");
  for (const w of writes) {
    assert.match(w.path, /__failed\.png$/,
      "screenshot filename must end with __failed.png");
  }
  assert.equal(result.exitCode, 1);
});

test("UI-P11 assert-runner.runAssertMatrix: screenshotFailedCells without outDir throws", async () => {
  await assert.rejects(
    async () => runner.runAssertMatrix({
      base: "http://x",
      playwright: _stubPlaywright(),
      screenshotFailedCells: true,
      // outDir intentionally missing
    }),
    /screenshotFailedCells requires outDir/,
  );
});

// ── Subset routes/viewports ──────────────────────────────────────

test("UI-P11 assert-runner.runAssertMatrix: subset routes/viewports honored", async () => {
  const stub = _stubPlaywright();
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799",
    routes: [{ id: "test", pathname: "/", waitForSelector: "#root" }],
    viewports: [{ id: "vp", width: 800, height: 600, deviceScaleFactor: 1, isMobile: false }],
    playwright: stub,
  });
  assert.equal(result.manifest.summary.totalCells, 1);
});

// ── Input validation ─────────────────────────────────────────────

test("UI-P11 assert-runner.runAssertMatrix: requires opts.base", async () => {
  await assert.rejects(
    async () => runner.runAssertMatrix({}),
    /opts\.base is required/,
  );
});

test("UI-P11 assert-runner.runAssertMatrix: trailing slash on base normalized", async () => {
  const stub = _stubPlaywright();
  const result = await runner.runAssertMatrix({
    base: "http://127.0.0.1:4799/",
    playwright: stub,
  });
  assert.equal(result.manifest.base, "http://127.0.0.1:4799");
});
