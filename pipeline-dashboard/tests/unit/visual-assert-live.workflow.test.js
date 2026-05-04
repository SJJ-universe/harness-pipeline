// Slice UI-P11-d (Phase D Round UI-P, 2026-05-04) — workflow shape
// contract for the manual-dispatch CI assertion job. Mirrors
// tests/unit/visual-capture-live.workflow.test.js structure.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.resolve(
  __dirname, "..", "..", "..", ".github", "workflows", "visual-assert-live.yml",
);

function _readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf-8");
}

test("UI-P11-d workflow: file exists at .github/workflows/", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH),
    `expected workflow at ${WORKFLOW_PATH}`,
  );
});

test("UI-P11-d workflow: trigger is workflow_dispatch ONLY", () => {
  const yml = _readWorkflow();
  assert.match(yml, /^on:\s*$/m);
  assert.match(yml, /workflow_dispatch:/,
    "workflow must enable workflow_dispatch trigger");
  assert.equal(/^\s+push:/m.test(yml), false,
    "workflow must NOT have push trigger — UI-P11-d design contract " +
    "matches UI-P10-d (chromium download cost)");
  assert.equal(/^\s+pull_request:/m.test(yml), false,
    "workflow must NOT have pull_request trigger");
  assert.equal(/^\s+schedule:/m.test(yml), false,
    "workflow must NOT have schedule trigger — operator-triggered only");
});

test("UI-P11-d workflow: inputs include label + port + screenshot_failures", () => {
  const yml = _readWorkflow();
  assert.match(yml, /inputs:/);
  assert.match(yml, /label:/);
  assert.match(yml, /port:/);
  assert.match(yml, /screenshot_failures:/,
    "input 'screenshot_failures' lets operator turn off PNG capture " +
    "on triggered runs (default true; off for slimmer artifacts)");
});

test("UI-P11-d workflow: standard hardening (permissions + Node 24)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /permissions:[\s\S]*contents:\s*read/);
  assert.match(yml, /node-version:\s*['"]?24/);
});

test("UI-P11-d workflow: documented step sequence", () => {
  const yml = _readWorkflow();
  const checkout = yml.indexOf("Checkout");
  const setupNode = yml.indexOf("Setup Node 24");
  const npmCi = yml.indexOf("Install dependencies");
  const installBrowsers = yml.indexOf("Install chromium");
  const assertion = yml.indexOf("Run assertion matrix");
  const upload = yml.indexOf("Upload manifest + failure PNGs artifact");
  for (const [name, pos] of [
    ["Checkout", checkout],
    ["Setup Node 24", setupNode],
    ["Install dependencies", npmCi],
    ["Install chromium", installBrowsers],
    ["Run assertion matrix", assertion],
    ["Upload manifest + failure PNGs artifact", upload],
  ]) {
    assert.ok(pos > 0, `workflow must include step "${name}"`);
  }
  assert.ok(checkout < setupNode);
  assert.ok(setupNode < npmCi);
  assert.ok(npmCi < installBrowsers);
  assert.ok(installBrowsers < assertion);
  assert.ok(assertion < upload);
});

test("UI-P11-d workflow: invokes the documented npm scripts", () => {
  const yml = _readWorkflow();
  assert.match(yml, /npm run visual:install-browsers/);
  assert.match(yml, /npm run visual:assert-live/);
});

test("UI-P11-d workflow: artifact upload preserves PNGs + manifest", () => {
  const yml = _readWorkflow();
  assert.match(yml, /actions\/upload-artifact@v\d+/);
  assert.match(yml, /retention-days:\s*30/);
  assert.match(yml, /name:\s*ui-p11-assert-/,
    "artifact name must be prefixed with 'ui-p11-assert-'");
  // `if: always()` ensures the artifact uploads even when the
  // assertion run failed (operator triggered this to find regressions
  // — they DEFINITELY want the artifact when failures happened).
  assert.match(yml, /if:\s*always\(\)/,
    "upload-artifact step must use `if: always()` so failures still upload");
});

test("UI-P11-d workflow: working-directory pinned to pipeline-dashboard", () => {
  const yml = _readWorkflow();
  assert.match(yml, /working-directory:\s*pipeline-dashboard/);
});

test("UI-P11-d workflow: 20-minute timeout", () => {
  const yml = _readWorkflow();
  assert.match(yml, /timeout-minutes:\s*20/,
    "20-minute ceiling matches UI-P10-d; assertion run is 3-5 min " +
    "+ chromium install");
});
