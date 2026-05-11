const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
// Slice UI-P1 (2026-04-30): structural tests against the LEGACY shell
// (index.legacy.html) — the legacy view's structural invariants are
// what these tests originally pinned. The product shell at index.html
// has its own contract verified in monitor.product-shell.test.js +
// monitor.product-header.test.js.
const indexProduct = fs.readFileSync(path.join(root, "public", "index.html"), "utf-8");
const index = fs.readFileSync(path.join(root, "public", "index.legacy.html"), "utf-8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf-8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf-8");
const productShellInit = fs.readFileSync(path.join(root, "public", "js", "product-shell-init.js"), "utf-8");

test("legacy index.html has zero inline event handlers (CSP-safe)", () => {
  const matches = index.match(/\son[a-z]+="/gi) || [];
  assert.equal(matches.length, 0, `Found inline handlers in legacy: ${matches.join(", ")}`);
});

test("product index.html has zero inline event handlers (CSP-safe)", () => {
  // UI-P1 contract: the new product shell must also be CSP-safe.
  const matches = indexProduct.match(/\son[a-z]+="/gi) || [];
  assert.equal(matches.length, 0, `Found inline handlers in product shell: ${matches.join(", ")}`);
});

test("app.js defines initEventBindings and calls it in init", () => {
  assert.match(app, /function initEventBindings/);
  assert.match(app, /initEventBindings\(\)/);
});

test("horse reining has non-auto-resume intervention handling", () => {
  assert.match(app, /case "tool_blocked"/);
  assert.match(app, /setHorseState\("reining"/);
  assert.match(app, /case "gate_failed"/);
  assert.match(app, /case "claim_verification_failed"/);
});

test("horse rein animation has rear-leg pivot and upward lift", () => {
  assert.match(css, /\.horse-rider\.reining/);
  assert.match(css, /transform-origin/);
  assert.match(css, /translateY\(-2px\)/);
  assert.match(css, /rotate\(-5deg\)/);
});

// Slice K (v5): ws-client extracted out of app.js. The app must route
// through window.OrchestratorWsClient and the script tag must load before app.js.
test("app.js delegates the main pipeline WebSocket to OrchestratorWsClient", () => {
  assert.match(app, /window\.OrchestratorWsClient/);
  assert.match(app, /OrchestratorWsClient\.install\(/);
  // The pipeline-WS inline constructor is gone — regex is narrow enough to
  // ignore the separate terminal WebSocket (URL ends with /terminal?token=).
  assert.ok(!/new WebSocket\(`\$\{protocol\}\/\/\$\{location\.host\}`\)/.test(app),
    "app.js still contains an inline new WebSocket() for the pipeline socket");
});

test("ws-client.js script tag loads before app.js in legacy index.html", () => {
  // Legacy view: ws-client must precede app.js (app.js calls
  // window.OrchestratorWsClient.install). Product shell doesn't load app.js
  // so this ordering check applies only to the legacy shell.
  const posWs = index.indexOf("js/ws-client.js");
  const posApp = index.indexOf("app.js\"></script>");
  assert.ok(posWs > 0, "ws-client.js script tag missing from legacy index.html");
  assert.ok(posWs < posApp, "ws-client.js must load before app.js in legacy");
});

// Slice R (v6): event dispatcher registry must be loaded before app.js so
// handleEvent's `window.OrchestratorEventDispatcher.dispatch()` call works.
test("event-dispatcher.js loads before app.js in legacy; handleEvent checks registry first", () => {
  const posEd = index.indexOf("js/event-dispatcher.js");
  const posApp = index.indexOf("app.js\"></script>");
  assert.ok(posEd > 0, "event-dispatcher.js script tag missing in legacy");
  assert.ok(posEd < posApp, "event-dispatcher.js must load before app.js in legacy");
  assert.match(app, /window\.OrchestratorEventDispatcher\.dispatch\(event\)/,
    "handleEvent must consult the dispatcher before falling through to switch");
});

// UI-P1 contract: product shell must load shared runtime modules before
// product-shell-init.js (which boots the shell + needs OrchestratorProductShell,
// OrchestratorMonitorStore, OrchestratorMonitorLegacyBridge etc. to be defined).
test("product index.html loads core modules + panels before product-shell-init.js", () => {
  const posStore = indexProduct.indexOf("js/monitor/store.js");
  const posShell = indexProduct.indexOf("js/monitor/shells/product-shell.js");
  const posInit = indexProduct.indexOf("js/product-shell-init.js");
  assert.ok(posStore > 0 && posShell > 0 && posInit > 0,
    "missing required script tag in product shell");
  assert.ok(posStore < posInit, "store.js must load before init");
  assert.ok(posShell < posInit, "product-shell.js must load before init");
});

test("product shell runtime disables reference mock data unless demo mode is explicit", () => {
  assert.match(productShellInit, /function _resolveDemoMode\(\)/);
  assert.match(productShellInit, /url\.searchParams\.get\("demo"\)/);
  assert.match(productShellInit, /localStorage\.getItem\("orchestrator:demo-mode"\)/);
  assert.match(productShellInit, /allowMockData:\s*demoMode/);
});

test("product shell runtime hydrates monitor bootstrap before relying on live websocket events", () => {
  assert.match(productShellInit, /function _hydrateInitialStore\(store\)/);
  assert.match(productShellInit, /hydrateMonitorStore/);
  assert.match(productShellInit, /hydrateRunDetail/);
  assert.match(productShellInit, /_hydrateInitialStore\(store\)/);
});

test("product index.html loads event-dispatcher.js BEFORE legacy-bridge.js + before product-shell-init.js", () => {
  const posDispatcher = indexProduct.indexOf("js/event-dispatcher.js");
  const posBridge = indexProduct.indexOf("js/monitor/legacy-bridge.js");
  const posInit = indexProduct.indexOf("js/product-shell-init.js");
  assert.ok(posDispatcher > 0,
    "event-dispatcher.js must be loaded by product index.html (legacy-bridge taps it)");
  assert.ok(posDispatcher < posBridge,
    "event-dispatcher.js must load BEFORE legacy-bridge.js (the bridge subscribes via addTap)");
  assert.ok(posDispatcher < posInit,
    "event-dispatcher.js must load BEFORE product-shell-init.js (init's WS client calls .dispatch)");
});

test("product shell runtime installs OrchestratorWsClient + forwards events to EventDispatcher.dispatch", () => {
  assert.match(productShellInit, /function _installWsClient\(store\)/);
  assert.match(productShellInit, /OrchestratorWsClient\.install\(/);
  assert.match(productShellInit, /OrchestratorEventDispatcher\.dispatch\(event\)/);
  // Toast adapters for connection-state transitions are wired so
  // operators see when the live event stream drops or recovers.
  assert.match(productShellInit, /onReconnected/);
  assert.match(productShellInit, /onDisconnected/);
  assert.match(productShellInit, /onInitialError/);
  // The init code must actually CALL _installWsClient(store) — not
  // just define the helper.
  assert.match(productShellInit, /_installWsClient\(store\)/);
});
