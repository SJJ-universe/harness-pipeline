// Slice UI-P12-d (Phase D Round UI-P, 2026-05-04) — workflow shape
// contract for the manual-dispatch a11y CI job.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.resolve(
  __dirname, "..", "..", "..", ".github", "workflows", "visual-a11y-live.yml",
);

function _readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf-8");
}

test("UI-P12-d workflow: file exists at .github/workflows/", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH));
});

test("UI-P12-d workflow: trigger is workflow_dispatch ONLY", () => {
  const yml = _readWorkflow();
  assert.match(yml, /^on:\s*$/m);
  assert.match(yml, /workflow_dispatch:/);
  assert.equal(/^\s+push:/m.test(yml), false,
    "workflow must NOT have push trigger — chromium download cost");
  assert.equal(/^\s+pull_request:/m.test(yml), false,
    "workflow must NOT have pull_request trigger");
  assert.equal(/^\s+schedule:/m.test(yml), false,
    "workflow must NOT have schedule trigger");
});

test("UI-P12-d workflow: inputs include label + port + disable_rules", () => {
  const yml = _readWorkflow();
  assert.match(yml, /inputs:/);
  assert.match(yml, /label:/);
  assert.match(yml, /port:/);
  assert.match(yml, /disable_rules:/,
    "input 'disable_rules' lets operator disable noisy axe rules during " +
    "CI investigation without modifying source");
});

test("UI-P12-d workflow: standard hardening (permissions + Node 24)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /permissions:[\s\S]*contents:\s*read/);
  assert.match(yml, /node-version:\s*['"]?24/);
});

test("UI-P12-d workflow: documented step sequence", () => {
  const yml = _readWorkflow();
  const steps = [
    "Checkout",
    "Setup Node 24",
    "Install dependencies",
    "Install chromium",
    "Run a11y matrix",
    "Upload manifest artifact",
  ];
  let prev = -1;
  for (const name of steps) {
    const pos = yml.indexOf(name);
    assert.ok(pos > 0, `workflow must include step "${name}"`);
    assert.ok(pos > prev, `step "${name}" must follow earlier steps`);
    prev = pos;
  }
});

test("UI-P12-d workflow: invokes the documented npm scripts", () => {
  const yml = _readWorkflow();
  assert.match(yml, /npm run visual:install-browsers/);
  assert.match(yml, /npm run visual:a11y-live/);
});

test("UI-P12-d workflow: artifact upload preserves manifest", () => {
  const yml = _readWorkflow();
  assert.match(yml, /actions\/upload-artifact@v\d+/);
  assert.match(yml, /retention-days:\s*30/);
  assert.match(yml, /name:\s*ui-p12-a11y-/,
    "artifact name must be prefixed with 'ui-p12-a11y-'");
  assert.match(yml, /if:\s*always\(\)/,
    "upload-artifact step must use `if: always()` so failed runs " +
    "still upload (operator triggered specifically to find regressions)");
});

test("UI-P12-d workflow: working-directory pinned to pipeline-dashboard", () => {
  const yml = _readWorkflow();
  assert.match(yml, /working-directory:\s*pipeline-dashboard/);
});

test("UI-P12-d workflow: 20-minute timeout", () => {
  const yml = _readWorkflow();
  assert.match(yml, /timeout-minutes:\s*20/);
});
