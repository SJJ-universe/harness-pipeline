// Slice UI-Fuse-a (Phase D Round UI-P, 2026-05-04) — workflow shape
// contract for the manual-dispatch fused CI job.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.resolve(
  __dirname, "..", "..", "..", ".github", "workflows", "visual-fused-live.yml",
);

function _readWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf-8");
}

test("UI-Fuse workflow: file exists at .github/workflows/", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH));
});

test("UI-Fuse workflow: trigger is workflow_dispatch ONLY (PR-gating still deferred)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /^on:\s*$/m);
  assert.match(yml, /workflow_dispatch:/);
  // Per governance §6.2, PR push trigger requires 4 entry conditions.
  // This test enforces the deferral until a follow-up round flips it.
  assert.equal(/^\s+push:/m.test(yml), false,
    "fused workflow must NOT have push trigger — governance §6.2 " +
    "requires 4 entry conditions before PR-gating; this round only " +
    "satisfies condition 2 (chromium cache savings)");
  assert.equal(/^\s+pull_request:/m.test(yml), false,
    "fused workflow must NOT have pull_request trigger");
  assert.equal(/^\s+schedule:/m.test(yml), false,
    "fused workflow must NOT have schedule trigger");
});

test("UI-Fuse workflow: inputs include label + port + tools subset", () => {
  const yml = _readWorkflow();
  assert.match(yml, /inputs:/);
  assert.match(yml, /label:/);
  assert.match(yml, /port:/);
  assert.match(yml, /tools:/,
    "tools input lets operator narrow the fused run to a subset for " +
    "faster iteration (default 'capture,assert,a11y,button')");
});

test("UI-Fuse workflow: standard hardening (permissions + Node 24)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /permissions:[\s\S]*contents:\s*read/);
  assert.match(yml, /node-version:\s*['"]?24/);
});

test("UI-Fuse workflow: documented step sequence", () => {
  const yml = _readWorkflow();
  const steps = [
    "Checkout",
    "Setup Node 24",
    "Install dependencies",
    "Install chromium",
    "Run fused matrix",
    "Upload fused artifact",
  ];
  let prev = -1;
  for (const name of steps) {
    const pos = yml.indexOf(name);
    assert.ok(pos > 0, `workflow must include step "${name}"`);
    assert.ok(pos > prev, `step "${name}" must follow earlier steps`);
    prev = pos;
  }
});

test("UI-Fuse workflow: chromium installed ONCE (key savings vs separate workflows)", () => {
  const yml = _readWorkflow();
  // Count occurrences of `npm run visual:install-browsers` step
  const matches = yml.match(/npm run visual:install-browsers/g) || [];
  assert.equal(matches.length, 1,
    "fused workflow's main savings is single chromium install — " +
    "must invoke visual:install-browsers exactly once");
});

test("UI-Fuse workflow: invokes all 4 visual:*-live npm scripts", () => {
  const yml = _readWorkflow();
  // Each tool name must appear in the loop's npm script call.
  // The loop uses `npm run "visual:$tool_trim-live"` so the literal
  // string is in the workflow source.
  assert.match(yml, /visual:\$tool_trim-live/,
    "fused workflow must use a parametric npm script call (visual:$tool-live)");
  // Spot-check the 4 tool names appear as case-statement entries
  for (const t of ["capture", "assert", "a11y", "button"]) {
    assert.ok(yml.includes(t),
      `tool name "${t}" must appear in workflow (case statement / docs)`);
  }
});

test("UI-Fuse workflow: emits fused summary.json with orchestrator-visual-fused/v1 schema", () => {
  const yml = _readWorkflow();
  assert.match(yml, /orchestrator-visual-fused\/v1/,
    "fused workflow must emit a top-level summary.json with " +
    "documented schema 'orchestrator-visual-fused/v1'");
  assert.match(yml, /summary\.json/);
});

test("UI-Fuse workflow: artifact upload preserves all 4 subdirs + summary", () => {
  const yml = _readWorkflow();
  assert.match(yml, /actions\/upload-artifact@v\d+/);
  assert.match(yml, /retention-days:\s*30/);
  assert.match(yml, /name:\s*ui-fuse-/,
    "artifact name must be prefixed with 'ui-fuse-'");
  assert.match(yml, /if:\s*always\(\)/,
    "upload step must use `if: always()` so failed-tool runs still " +
    "preserve the partial artifact for diagnosis");
});

test("UI-Fuse workflow: working-directory pinned to pipeline-dashboard", () => {
  const yml = _readWorkflow();
  assert.match(yml, /working-directory:\s*pipeline-dashboard/);
});

test("UI-Fuse workflow: 30-minute timeout (longer than per-tool to fit all 4)", () => {
  const yml = _readWorkflow();
  assert.match(yml, /timeout-minutes:\s*30/,
    "fused workflow needs more headroom than per-tool's 20 min — " +
    "still typical wall time is 3-7 min, ceiling catches hung jobs");
});

test("UI-Fuse workflow: per-tool failure does NOT abort the loop (overall exit captured)", () => {
  const yml = _readWorkflow();
  // The loop uses `|| OVERALL_EXIT=$?` so a failing tool's exit
  // code is captured but the loop continues. Final `exit $OVERALL_EXIT`
  // surfaces the worst exit code at job completion.
  assert.match(yml, /\|\|\s+OVERALL_EXIT=\$\?/,
    "failure-handling must capture per-tool exit without aborting the loop");
  assert.match(yml, /exit \$OVERALL_EXIT/,
    "must surface the overall exit code at the end of the matrix step");
});
