// Slice UI-P12-b (Phase D Round UI-P, 2026-05-04) — a11y-runner
// stub-injection tests. NO real chromium spawn — uses fake
// playwright + axe-core that return canned values.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runner = require("../../scripts/visual-live/a11y-runner");
const {
  A11Y_AXE_TAGS,
  A11Y_AXE_DISABLED_RULES_ALL,
  A11Y_AXE_DISABLED_RULES_LEGACY,
  A11Y_CUSTOM_RULES,
} = require("../../scripts/visual-live/a11y-rules");

// ── buildAxeDisabledRules ────────────────────────────────────────

test("UI-P12 buildAxeDisabledRules: non-legacy → ALL list only", () => {
  const out = runner.buildAxeDisabledRules({ id: "product-default" });
  assert.deepEqual(out, Array.from(A11Y_AXE_DISABLED_RULES_ALL));
});

test("UI-P12 buildAxeDisabledRules: legacy → ALL + LEGACY rules merged", () => {
  const out = runner.buildAxeDisabledRules({ id: "legacy" });
  for (const r of A11Y_AXE_DISABLED_RULES_ALL) assert.ok(out.includes(r));
  for (const r of A11Y_AXE_DISABLED_RULES_LEGACY) assert.ok(out.includes(r));
});

test("UI-P12 buildAxeDisabledRules: extra disabled merged + deduped", () => {
  const out = runner.buildAxeDisabledRules(
    { id: "legacy" },
    ["color-contrast", "duplicate-id"],
  );
  // color-contrast already in ALL — should not duplicate
  const colorContrastCount = out.filter((r) => r === "color-contrast").length;
  assert.equal(colorContrastCount, 1, "no duplicate color-contrast");
  assert.ok(out.includes("duplicate-id"));
});

test("UI-P12 buildAxeDisabledRules: null route → ALL only", () => {
  const out = runner.buildAxeDisabledRules(null);
  assert.deepEqual(out, Array.from(A11Y_AXE_DISABLED_RULES_ALL));
});

// ── buildAxeRunConfig ────────────────────────────────────────────

test("UI-P12 buildAxeRunConfig: shape includes runOnly tags + rules disabled", () => {
  const cfg = runner.buildAxeRunConfig({ id: "product-default" });
  assert.equal(cfg.runOnly.type, "tag");
  assert.deepEqual(cfg.runOnly.values, Array.from(A11Y_AXE_TAGS));
  // Each disabled rule appears in cfg.rules with enabled:false
  for (const ruleId of A11Y_AXE_DISABLED_RULES_ALL) {
    assert.deepEqual(cfg.rules[ruleId], { enabled: false });
  }
  // resultTypes includes violations (operator only cares about
  // failures by default; passes/incomplete are debugging extras)
  assert.deepEqual(cfg.resultTypes, ["violations"]);
});

test("UI-P12 buildAxeRunConfig: legacy route → landmark rules also disabled", () => {
  const cfg = runner.buildAxeRunConfig({ id: "legacy" });
  for (const ruleId of A11Y_AXE_DISABLED_RULES_LEGACY) {
    assert.deepEqual(cfg.rules[ruleId], { enabled: false });
  }
});

// ── buildA11yManifest ────────────────────────────────────────────

test("UI-P12 buildA11yManifest: schema + summary derivation", () => {
  const cells = [
    {
      routeId: "r1", viewportId: "v1",
      summary: { ok: true, axe: { totalViolations: 0, failingImpactsHit: 0, bucket: {} }, custom: { failed: 0 } },
      ok: true, failed: false,
    },
    {
      routeId: "r2", viewportId: "v1",
      summary: { ok: false, axe: { totalViolations: 3, failingImpactsHit: 1, bucket: {} }, custom: { failed: 0 } },
      ok: false, failed: false,
    },
    {
      routeId: "r3", viewportId: "v1",
      summary: null,
      ok: false, failed: true,
      failureReason: "navigation timeout",
    },
  ];
  const m = runner.buildA11yManifest({
    cells,
    base: "http://x:4799",
    capturedAt: "2026-05-04T00:00:00.000Z",
    browserVersion: "131.0.0.0",
    totalElapsedMs: 5000,
    axeVersion: "4.11.4",
  });
  assert.equal(m.schema, "orchestrator-visual-a11y/v1");
  assert.equal(m.axe.name, "axe-core");
  assert.equal(m.axe.version, "4.11.4");
  assert.deepEqual(m.axe.tags, Array.from(A11Y_AXE_TAGS));
  assert.equal(m.customRulesetVersion, A11Y_CUSTOM_RULES.length);
  assert.equal(m.customRuleIds.length, A11Y_CUSTOM_RULES.length);
  assert.equal(m.summary.totalCells, 3);
  assert.equal(m.summary.cellsAllPassed, 1);
  assert.equal(m.summary.cellsWithFailures, 1);
  assert.equal(m.summary.cellsWithErrors, 1);
  assert.equal(m.summary.totalAxeViolations, 3);
  assert.equal(m.summary.totalAxeFailingImpacts, 1);
});

// ── Stub builders ────────────────────────────────────────────────

function _stubAxeCore(version = "4.11.4") {
  return { source: "/* fake axe source */", version };
}

function _stubPlaywright({
  throwOnLaunch = false,
  axeRunResultByUrl = null,
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
                  async addScriptTag() {},
                  async evaluate(_fn, ..._args) {
                    // Either it's the axe.run call (returns axeResult)
                    // or it's a custom rule's _eval... call. The stub
                    // returns the axe result first; subsequent calls
                    // return canned custom-rule shapes.
                    if (axeRunResultByUrl) {
                      const cannedAxe = axeRunResultByUrl(lastUrl);
                      // After the first call (axe), serve the custom
                      // rule canned values from a small queue.
                      if (this.__customQueue === undefined) {
                        this.__customQueue = [
                          // lang-matches-locale shape
                          { lang: "ko", activeLocale: "ko", source: "OrchestratorI18n.getLang" },
                          // skip-link-focus-visible shape
                          {
                            found: true, isFocused: true, changed: true,
                            baseline: { width: 1, height: 1, top: -9999, opacity: "1", transform: "none" },
                            focused: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
                          },
                        ];
                        return cannedAxe;
                      }
                      return this.__customQueue.shift() || { found: false };
                    }
                    return { violations: [] };
                  },
                  async screenshot() { return Buffer.from("fake"); },
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

// ── runA11yMatrix happy path ─────────────────────────────────────

test("UI-P12 runA11yMatrix: 16 cells all pass with stub OK", async () => {
  const stub = _stubPlaywright({
    axeRunResultByUrl: () => ({ violations: [] }),
  });
  const out = await runner.runA11yMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
    axeCore: _stubAxeCore(),
  });
  assert.equal(out.exitCode, 0);
  assert.equal(out.manifest.summary.totalCells, 16);
  assert.equal(out.manifest.summary.cellsAllPassed, 16);
  assert.equal(out.manifest.summary.cellsWithFailures, 0);
  assert.equal(out.manifest.summary.cellsWithErrors, 0);
});

test("UI-P12 runA11yMatrix: BROWSER_NOT_INSTALLED bubbled up", async () => {
  const stub = _stubPlaywright({ throwOnLaunch: true });
  await assert.rejects(
    async () => runner.runA11yMatrix({
      base: "http://x", playwright: stub, axeCore: _stubAxeCore(),
    }),
    (err) => {
      assert.equal(err.code, "BROWSER_NOT_INSTALLED");
      return true;
    },
  );
});

test("UI-P12 runA11yMatrix: critical axe violation → exit 1 + cellsWithFailures", async () => {
  const stub = _stubPlaywright({
    axeRunResultByUrl: () => ({
      violations: [{ id: "button-name", impact: "critical", help: "Buttons need a name" }],
    }),
  });
  const out = await runner.runA11yMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
    axeCore: _stubAxeCore(),
  });
  assert.equal(out.exitCode, 1);
  assert.equal(out.manifest.summary.totalCells, 16);
  assert.equal(out.manifest.summary.cellsWithFailures, 16,
    "every cell records the same critical violation");
  assert.equal(out.manifest.summary.totalAxeFailingImpacts, 16);
});

test("UI-P12 runA11yMatrix: moderate-only violation → still exit 0 (warning)", async () => {
  const stub = _stubPlaywright({
    axeRunResultByUrl: () => ({
      violations: [{ id: "doc-page-title", impact: "moderate" }],
    }),
  });
  const out = await runner.runA11yMatrix({
    base: "http://127.0.0.1:4799",
    playwright: stub,
    axeCore: _stubAxeCore(),
  });
  assert.equal(out.exitCode, 0,
    "moderate-only violations are warnings, NOT cell failures");
  assert.equal(out.manifest.summary.totalAxeViolations, 16);
  assert.equal(out.manifest.summary.totalAxeFailingImpacts, 0);
});

test("UI-P12 runA11yMatrix: per-cell nav fault → cellsWithErrors counted", async () => {
  const stub = _stubPlaywright({
    axeRunResultByUrl: () => ({ violations: [] }),
    navThrowsForRoute: "?mode=pro",
  });
  const out = await runner.runA11yMatrix({
    base: "http://x", playwright: stub, axeCore: _stubAxeCore(),
  });
  assert.equal(out.manifest.summary.totalCells, 16);
  assert.equal(out.manifest.summary.cellsWithErrors, 4,
    "4 viewports × 1 broken route");
  assert.equal(out.exitCode, 1);
  // Failed cells preserve failureReason
  for (const c of out.manifest.cells.filter((c) => c.failed)) {
    assert.equal(c.routeId, "product-pro");
    assert.match(c.failureReason, /simulated nav failure/);
  }
});

// ── runCustomRules ──────────────────────────────────────────────

test("UI-P12 runCustomRules: aggregates per-rule results", async () => {
  let count = 0;
  const page = {
    async evaluate() {
      count += 1;
      if (count === 1) return { lang: "ko", activeLocale: "ko", source: "OrchestratorI18n.getLang" };
      return {
        found: true, isFocused: true, changed: true,
        baseline: { width: 1, height: 1, top: -9999, opacity: "1", transform: "none" },
        focused: { width: 100, height: 30, top: 0, opacity: "1", transform: "none" },
      };
    },
  };
  const out = await runner.runCustomRules(page, { isMobile: false }, { id: "product-default" });
  assert.equal(out.length, 2);
  for (const r of out) {
    assert.equal(r.ok, true);
    assert.equal(r.skipped, false);
  }
});

test("UI-P12 runCustomRules: per-rule throw → ok:false + failures populated", async () => {
  const page = {
    async evaluate() { throw new Error("simulated browser fault"); },
  };
  const out = await runner.runCustomRules(page, { isMobile: false }, { id: "product-default" });
  for (const r of out) {
    assert.equal(r.ok, false);
    assert.equal(r.skipped, false);
    assert.equal(r.failures[0].reason, "evaluate threw");
    assert.match(r.failures[0].message, /simulated browser fault/);
  }
});

// ── Subset / validation ─────────────────────────────────────────

test("UI-P12 runA11yMatrix: subset routes/viewports honored", async () => {
  const stub = _stubPlaywright({ axeRunResultByUrl: () => ({ violations: [] }) });
  const out = await runner.runA11yMatrix({
    base: "http://x",
    routes: [{ id: "test", pathname: "/", waitForSelector: "#root" }],
    viewports: [{ id: "vp", width: 800, height: 600, deviceScaleFactor: 1, isMobile: false }],
    playwright: stub,
    axeCore: _stubAxeCore(),
  });
  assert.equal(out.manifest.summary.totalCells, 1);
});

test("UI-P12 runA11yMatrix: requires opts.base", async () => {
  await assert.rejects(
    async () => runner.runA11yMatrix({}),
    /opts\.base is required/,
  );
});

test("UI-P12 runA11yMatrix: trailing slash on base normalized", async () => {
  const stub = _stubPlaywright({ axeRunResultByUrl: () => ({ violations: [] }) });
  const out = await runner.runA11yMatrix({
    base: "http://127.0.0.1:4799/",
    playwright: stub,
    axeCore: _stubAxeCore(),
  });
  assert.equal(out.manifest.base, "http://127.0.0.1:4799");
});
