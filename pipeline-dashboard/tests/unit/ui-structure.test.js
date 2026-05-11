// Slice UI-P1 (2026-04-30) — product shell structural invariants.
// Slice LEGACY-VIEW-REMOVE-0 (2026-05-11): legacy + app.js tests
// removed when the legacy view was retired. Surviving tests pin the
// product shell's script load chain + runtime invariants.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const indexProduct = fs.readFileSync(path.join(root, "public", "index.html"), "utf-8");
const productShellInit = fs.readFileSync(path.join(root, "public", "js", "product-shell-init.js"), "utf-8");

test("product index.html has zero inline event handlers (CSP-safe)", () => {
  // UI-P1 contract: the product shell must be CSP-safe.
  const matches = indexProduct.match(/\son[a-z]+="/gi) || [];
  assert.equal(matches.length, 0, `Found inline handlers in product shell: ${matches.join(", ")}`);
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
