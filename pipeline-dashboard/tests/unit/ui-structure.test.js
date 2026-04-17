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
