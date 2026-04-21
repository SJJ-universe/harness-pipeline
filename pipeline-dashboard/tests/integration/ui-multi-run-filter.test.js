// Slice AA-1 (Phase 2.5) — wiring integration for the run-scoped DOM filter.
//
// The pure logic lives in public/js/run-id-filter.js and is covered by
// tests/unit/runIdFilter.test.js. These tests instead prove the *wiring*:
//   1. index.html loads run-id-filter.js before app.js so HarnessRunIdFilter
//      is on window by the time handleEvent runs.
//   2. handleEvent in app.js actually calls HarnessRunIdFilter.shouldSkip
//      with the current run-tab focus before dispatching the event.
//   3. The call lives AFTER `_runTabBar.seen()` so the tab bar still
//      surfaces other runs even when their events don't render.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const APP_JS = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf-8");
const INDEX_HTML = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf-8");
const FILTER_JS = fs.readFileSync(path.join(ROOT, "public/js/run-id-filter.js"), "utf-8");

test("public/js/run-id-filter.js exists and exports shouldSkip via UMD", () => {
  assert.match(FILTER_JS, /HarnessRunIdFilter/, "window global assigned");
  assert.match(FILTER_JS, /function shouldSkip\s*\(/, "shouldSkip function defined");
  assert.match(FILTER_JS, /module\.exports\s*=\s*api/, "CommonJS export for Node tests");
});

test("index.html loads run-id-filter.js (and before app.js)", () => {
  // Use precise <script src="…"> anchors — bare "app.js" also appears in
  // comments several times in index.html and indexOf() would match those.
  const filterIdx = INDEX_HTML.indexOf('src="js/run-id-filter.js"');
  const appIdx = INDEX_HTML.indexOf('src="app.js"');
  assert.ok(filterIdx > -1, "run-id-filter.js script tag is present");
  assert.ok(appIdx > -1, "app.js script tag is present");
  assert.ok(
    filterIdx < appIdx,
    "run-id-filter.js must load before app.js so HarnessRunIdFilter is ready"
  );
});

test("index.html loads run-id-filter.js after run-tab-bar.js (co-located tab wiring)", () => {
  const tabBarIdx = INDEX_HTML.indexOf('src="js/run-tab-bar.js"');
  const filterIdx = INDEX_HTML.indexOf('src="js/run-id-filter.js"');
  assert.ok(tabBarIdx > -1, "run-tab-bar.js script tag is present");
  assert.ok(filterIdx > tabBarIdx, "tab bar sets the runId, filter consumes it");
});

test("handleEvent invokes HarnessRunIdFilter.shouldSkip with the current tab runId", () => {
  // Pull out the handleEvent function body (approximate region).
  const handleStart = APP_JS.indexOf("function handleEvent");
  assert.ok(handleStart > -1, "handleEvent function exists");
  // Inspect ~2500 chars following its signature to avoid matching
  // unrelated uses of shouldSkip elsewhere in the file.
  const region = APP_JS.slice(handleStart, handleStart + 2500);
  assert.match(
    region,
    /HarnessRunIdFilter\.shouldSkip\s*\(\s*event\s*,\s*window\._runTabBar\.current\s*\(\s*\)\s*\)/,
    "handleEvent passes the focused runId from the tab bar into shouldSkip"
  );
  assert.match(
    region,
    /return;/,
    "handleEvent early-returns when the filter says skip (no DOM render)"
  );
});

test("shouldSkip gate sits AFTER the tab-bar seen() / complete() calls", () => {
  const handleStart = APP_JS.indexOf("function handleEvent");
  const region = APP_JS.slice(handleStart, handleStart + 2500);
  const seenIdx = region.indexOf("_runTabBar.seen(");
  const shouldSkipIdx = region.indexOf("HarnessRunIdFilter.shouldSkip");
  assert.ok(seenIdx > -1, "_runTabBar.seen() is present");
  assert.ok(shouldSkipIdx > -1, "shouldSkip call is present");
  assert.ok(
    shouldSkipIdx > seenIdx,
    "filter must run AFTER seen() so other runs still populate as tabs"
  );
});

test("shouldSkip gate sits BEFORE the event-dispatcher and legacy switch", () => {
  const handleStart = APP_JS.indexOf("function handleEvent");
  const region = APP_JS.slice(handleStart, handleStart + 2500);
  const shouldSkipIdx = region.indexOf("HarnessRunIdFilter.shouldSkip");
  const dispatchIdx = region.indexOf("HarnessEventDispatcher.dispatch");
  const switchIdx = region.indexOf("switch (event.type)");
  assert.ok(shouldSkipIdx > -1);
  assert.ok(dispatchIdx > -1);
  assert.ok(switchIdx > -1);
  assert.ok(
    shouldSkipIdx < dispatchIdx,
    "filter must short-circuit before the dispatch registry fires"
  );
  assert.ok(
    shouldSkipIdx < switchIdx,
    "filter must short-circuit before the legacy switch runs"
  );
});
