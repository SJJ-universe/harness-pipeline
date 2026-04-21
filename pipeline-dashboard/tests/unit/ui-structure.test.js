const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf-8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf-8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf-8");

test("index.html has zero inline event handlers (CSP-safe)", () => {
  const matches = index.match(/\son[a-z]+="/gi) || [];
  assert.equal(matches.length, 0, `Found inline handlers: ${matches.join(", ")}`);
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
// through window.HarnessWsClient and the script tag must load before app.js.
test("app.js delegates the main pipeline WebSocket to HarnessWsClient", () => {
  assert.match(app, /window\.HarnessWsClient/);
  assert.match(app, /HarnessWsClient\.install\(/);
  // The pipeline-WS inline constructor is gone — regex is narrow enough to
  // ignore the separate terminal WebSocket (URL ends with /terminal?token=).
  assert.ok(!/new WebSocket\(`\$\{protocol\}\/\/\$\{location\.host\}`\)/.test(app),
    "app.js still contains an inline new WebSocket() for the pipeline socket");
});

test("ws-client.js script tag loads before app.js in index.html", () => {
  const posWs = index.indexOf("js/ws-client.js");
  const posApp = index.indexOf("app.js\"></script>");
  assert.ok(posWs > 0, "ws-client.js script tag missing from index.html");
  assert.ok(posWs < posApp, "ws-client.js must load before app.js");
});

// Slice R (v6): event dispatcher registry must be loaded before app.js so
// handleEvent's `window.HarnessEventDispatcher.dispatch()` call works.
test("event-dispatcher.js loads before app.js; handleEvent checks registry first", () => {
  const posEd = index.indexOf("js/event-dispatcher.js");
  const posApp = index.indexOf("app.js\"></script>");
  assert.ok(posEd > 0, "event-dispatcher.js script tag missing");
  assert.ok(posEd < posApp, "event-dispatcher.js must load before app.js");
  assert.match(app, /window\.HarnessEventDispatcher\.dispatch\(event\)/,
    "handleEvent must consult the dispatcher before falling through to switch");
});
