// Slice UI-P10-d (Phase D Round UI-P, 2026-05-04) — workflow shape
// contract for the manual-dispatch CI job. Pins:
//   - workflow file exists at the documented path
//   - trigger is workflow_dispatch ONLY (NOT push/pull_request — the
//     entire UI-P10 round design rests on this)
//   - inputs include label + port (operators rely on these)
//   - the install-browsers + capture-live + upload-artifact steps
//     are all present in the documented order
//
// Why test the workflow YAML at all: a future PR could accidentally
// add `push` or `pull_request` triggers to this workflow, which
// would silently start downloading chromium on every push and
// burning CI minutes. This unit test makes that mistake visible
// in code review.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Workflow lives at the repo root, not under pipeline-dashboard/
const WORKFLOW_PATH = path.resolve(
  __dirname, "..", "..", "..", ".github", "workflows", "visual-capture-live.yml",
);

function _readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf-8");
}

test("UI-P10-d workflow: file exists at .github/workflows/", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH),
    `expected workflow at ${WORKFLOW_PATH}`,
  );
});

test("UI-P10-d workflow: trigger is workflow_dispatch ONLY", () => {
  const yml = _readWorkflow();
  // workflow_dispatch is required
  assert.match(yml, /^on:\s*$/m,
    "workflow must declare top-level 'on:' key");
  assert.match(yml, /workflow_dispatch:/,
    "workflow must enable workflow_dispatch trigger");
  // No PR push triggers — this is the design contract
  assert.equal(/^\s+push:/m.test(yml), false,
    "workflow must NOT have push trigger — UI-P10-d design contract " +
    "rests on manual-dispatch only (chromium download cost too high " +
    "for every PR)",
  );
  assert.equal(/^\s+pull_request:/m.test(yml), false,
    "workflow must NOT have pull_request trigger — same reason as push",
  );
  assert.equal(/^\s+schedule:/m.test(yml), false,
    "workflow must NOT have schedule trigger — operator-triggered only",
  );
});

test("UI-P10-d workflow: inputs include label + port", () => {
  const yml = _readWorkflow();
  assert.match(yml, /inputs:/, "workflow_dispatch must declare inputs");
  assert.match(yml, /label:/, "input 'label' (artifact suffix) required");
  assert.match(yml, /port:/, "input 'port' (server port override) required");
});

test("UI-P10-d workflow: standard hardening (permissions + Node 24)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /permissions:[\s\S]*contents:\s*read/,
    "workflow must use least-privilege contents:read permission");
  assert.match(yml, /node-version:\s*['"]?24/,
    "workflow must pin Node 24");
});

test("UI-P10-d workflow: documented step sequence", () => {
  const yml = _readWorkflow();
  // Verify the steps appear in the documented order. Use indexOf
  // chain so a re-ordered workflow surfaces in PR diff.
  const checkout = yml.indexOf("Checkout");
  const setupNode = yml.indexOf("Setup Node 24");
  const npmCi = yml.indexOf("Install dependencies");
  const installBrowsers = yml.indexOf("Install chromium");
  const capture = yml.indexOf("Capture 16 cells");
  const upload = yml.indexOf("Upload PNG + manifest artifact");
  for (const [name, pos] of [
    ["Checkout", checkout],
    ["Setup Node 24", setupNode],
    ["Install dependencies", npmCi],
    ["Install chromium", installBrowsers],
    ["Capture 16 cells", capture],
    ["Upload PNG + manifest artifact", upload],
  ]) {
    assert.ok(pos > 0, `workflow must include step "${name}"`);
  }
  assert.ok(checkout < setupNode, "Checkout before Setup Node");
  assert.ok(setupNode < npmCi, "Setup Node before npm ci");
  assert.ok(npmCi < installBrowsers, "npm ci before install chromium");
  assert.ok(installBrowsers < capture, "install chromium before capture");
  assert.ok(capture < upload, "capture before upload artifact");
});

test("UI-P10-d workflow: invokes the documented npm scripts", () => {
  const yml = _readWorkflow();
  assert.match(yml, /npm run visual:install-browsers/,
    "workflow must invoke npm run visual:install-browsers");
  assert.match(yml, /npm run visual:capture-live/,
    "workflow must invoke npm run visual:capture-live");
});

test("UI-P10-d workflow: uploads artifact via upload-artifact@v4 with retention", () => {
  const yml = _readWorkflow();
  assert.match(yml, /actions\/upload-artifact@v\d+/,
    "must use upload-artifact action");
  assert.match(yml, /retention-days:\s*30/,
    "must explicitly set 30-day retention");
  assert.match(yml, /name:\s*ui-p10-live-/,
    "artifact name must be prefixed with 'ui-p10-live-'");
});

test("UI-P10-d workflow: working-directory pins to pipeline-dashboard", () => {
  const yml = _readWorkflow();
  assert.match(yml, /working-directory:\s*pipeline-dashboard/,
    "all run steps must execute from pipeline-dashboard/ (matches ci.yml)");
});

test("UI-P10-d workflow: timeout pinned to 20 minutes", () => {
  const yml = _readWorkflow();
  assert.match(yml, /timeout-minutes:\s*20/,
    "20-minute timeout balances chromium install + 16 capture cells " +
    "+ headroom (typical run is 3-5 minutes; 20-minute ceiling " +
    "catches hung GHA runners without burning the operator's hour)",
  );
});
