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

// ── Slice AA-2 wiring checks ─────────────────────────────────────────────

const SERVER_JS = fs.readFileSync(path.join(ROOT, "server.js"), "utf-8");

test("AA-2: app.js onSelect resets UI then sends replay_request with includeGlobal:false", () => {
  // Locate the run tab bar install block and inspect just that region so
  // matches in other handlers don't muddy the signal.
  const installIdx = APP_JS.indexOf("HarnessRunTabBar.install");
  assert.ok(installIdx > -1, "HarnessRunTabBar.install() call present in app.js");
  const region = APP_JS.slice(installIdx, installIdx + 1500);
  assert.match(region, /onSelect:\s*\(runId\)\s*=>/, "onSelect closure is still wired");
  assert.match(region, /resetUI\s*\(\s*\)/, "onSelect clears the current timeline");
  assert.match(
    region,
    /_wsClient\.send\s*\(\s*\{[\s\S]*?type:\s*["']replay_request["'][\s\S]*?runId\b[\s\S]*?includeGlobal:\s*false/,
    "onSelect sends replay_request with explicit includeGlobal:false"
  );
  // The AA-1 toast stub must be gone — AA-2 replaces it with real replay.
  assert.ok(
    !/Slice V 이후 탭별 타임라인 전환/.test(region),
    "the AA-1 placeholder toast has been removed in AA-2"
  );
});

test("AA-2: server.js handles pipeline-WS replay_request messages", () => {
  assert.match(
    SERVER_JS,
    /ws\.on\s*\(\s*["']message["']\s*,/,
    "pipeline WS installs an inbound message handler"
  );
  assert.match(
    SERVER_JS,
    /parsed\.type\s*!==\s*["']replay_request["']/,
    "handler guards on type === replay_request"
  );
  // The call is written multi-line in server.js (chained with .map(...)),
  // so allow any whitespace between `eventReplayBuffer`, the dot, and the
  // `.snapshot` method name.
  assert.match(
    SERVER_JS,
    /eventReplayBuffer\s*\.\s*snapshot\s*\(\s*\{\s*runId\s*,\s*includeGlobal\s*\}\s*\)/,
    "server forwards { runId, includeGlobal } to the buffer"
  );
  assert.match(
    SERVER_JS,
    /type:\s*["']pipeline_replay["']/,
    "server re-emits events using the existing pipeline_replay shape"
  );
});

test("AA-2: server.js defaults includeGlobal to false unless client explicitly opts in", () => {
  assert.match(
    SERVER_JS,
    /includeGlobal\s*=\s*parsed\.includeGlobal\s*===\s*true/,
    "server coerces truthy values — only explicit `true` is treated as opt-in"
  );
});

test("AA-2: eventReplayBuffer.snapshot supports includeGlobal option", () => {
  const BUF_JS = fs.readFileSync(
    path.join(ROOT, "src/runtime/eventReplayBuffer.js"),
    "utf-8"
  );
  assert.match(
    BUF_JS,
    /snapshot\s*\(\s*\{\s*runId,\s*includeGlobal\s*=\s*true\s*\}\s*=\s*\{\s*\}\s*\)/,
    "snapshot({ runId, includeGlobal = true }) signature is in place"
  );
  assert.match(
    BUF_JS,
    /includeGlobal\s*===\s*true/,
    "falsy includeGlobal must drop runId-less entries"
  );
});

test("AA-2: ws-client exposes a send() API for client→server messages", () => {
  const WS_JS = fs.readFileSync(path.join(ROOT, "public/js/ws-client.js"), "utf-8");
  assert.match(WS_JS, /send:\s*\(payload\)\s*=>/, "install() return value exposes send()");
  assert.match(WS_JS, /WS\.OPEN\s*!=\s*null\s*\?\s*WS\.OPEN\s*:\s*1/, "send checks OPEN readyState");
});
