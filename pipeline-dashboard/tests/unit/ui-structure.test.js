const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf-8");
const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf-8");
const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf-8");

test("modal content stops propagation and close functions are direct", () => {
  assert.match(index, /id="modal-overlay" onclick="closeModal\(\)"/);
  assert.match(index, /id="general-run-overlay" onclick="closeGeneralRun\(\)"/);
  assert.match(index, /id="final-plan-overlay" onclick="closeFinalPlan\(\)"/);
  assert.equal((index.match(/onclick="event\.stopPropagation\(\)"/g) || []).length, 3);
  assert.match(app, /function closeModal\(\)\s*\{/);
  assert.match(app, /function closeGeneralRun\(\)\s*\{/);
  assert.match(app, /function closeFinalPlan\(\)\s*\{/);
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
