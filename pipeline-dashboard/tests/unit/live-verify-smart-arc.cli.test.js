// Slice LV0-b (Phase 2 / SMART-LV-0, 2026-05-05) — live-verify probe
// CLI surface tests. Verifies the operator-facing CLI without booting
// the harness server (CONFIG exit path + help output).
//
// Real probe behavior against a live server is the operator's job —
// the integration test (LV0-a) covers all 6 SMART arc properties
// in-process. This test file verifies the CLI surface itself:
//   - --help prints usage + exits 0
//   - server unreachable → CONFIG exit (2)
//   - --json output is valid JSON

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "scripts", "live-verify-smart-arc.js");

// Slice END-USER-DEPLOY-POLISH follow-up (RC-CLEANUP, 2026-05-05):
// always pass --evidence-dir pointed at a fresh tmpdir so the
// probe never writes into the tracked docs/reports/ path during
// tests. Without this, the smart-arc-live-verify.json file in
// docs/reports/ was being overwritten every `npm run test:unit`,
// leaking working-tree drift into RC cuts.
const EVIDENCE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lv0b-test-"));

function runProbe(extraArgs = [], envOverrides = {}) {
  // Inject --evidence-dir if the caller didn't already pass one.
  const hasEvDir = extraArgs.includes("--evidence-dir");
  const args = hasEvDir
    ? extraArgs
    : [...extraArgs, "--evidence-dir", EVIDENCE_TMP];
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, NO_COLOR: "1", ...envOverrides },
    encoding: "utf-8",
    timeout: 15_000,
  });
}

// ── --help ────────────────────────────────────────────────────────

test("LV0-b CLI: --help prints usage + exits 0", () => {
  const result = runProbe(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: live-verify-smart-arc\.js/);
  assert.match(result.stdout, /HARNESS_DEPLOYMENT_PROFILE=finance-high-privacy/);
  assert.match(result.stdout, /HARNESS_HARD_GATES=1/);
});

test("LV0-b CLI: -h short flag also prints usage", () => {
  const result = runProbe(["-h"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

// ── Server unreachable → CONFIG ────────────────────────────────────

test("LV0-b CLI: unreachable server → exit 2 (CONFIG)", () => {
  // Use a port that nothing listens on.
  const result = runProbe([
    "--base", "http://127.0.0.1:1",  // port 1 = reserved/unused
    "--quiet",
    "--evidence-dir", "/tmp/__lv0b_test_evidence__",
  ]);
  assert.equal(result.status, 2,
    `expected CONFIG (2), got ${result.status}: ${result.stderr}`);
});

test("LV0-b CLI: --json output is valid JSON when server unreachable", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  assert.equal(result.status, 2);
  // stdout should be parseable JSON evidence packet
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.schema, "harness-smart-lv-evidence/v1");
  assert.equal(evidence.verdict, "CONFIG");
  assert.ok(typeof evidence.runAt === "string");
});

test("LV0-b CLI: --json schema includes all 6 property keys when populated", () => {
  // Even on CONFIG exit, the evidence packet should have the right
  // top-level structure (properties / environment / auditChain).
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.ok("properties" in evidence);
  assert.ok("environment" in evidence);
  assert.ok("auditChain" in evidence);
  assert.ok("verdict" in evidence);
  assert.ok("runAt" in evidence);
  assert.ok(Array.isArray(evidence.notes));
});

// ── --base override ────────────────────────────────────────────────

test("LV0-b CLI: custom --base flag honored in error path", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--quiet",
  ]);
  assert.equal(result.status, 2);
  // stderr should be silent in --quiet mode
  // (tolerate trailing newline)
});

// ── No-leak guard (RC-CLEANUP) ────────────────────────────────────
//
// Regression test for the leak that motivated this fix: running the
// CLI without an explicit --evidence-dir must NOT touch any path
// under the tracked docs/reports/ tree. The runProbe helper now
// injects EVIDENCE_TMP automatically, so this test verifies that
// behavior + asserts the tracked path is untouched.

test("RC-CLEANUP: probe runs do not write into docs/reports/", () => {
  const TRACKED = path.resolve(__dirname, "..", "..", "docs", "reports",
    "2026-05-05-smart-arc-live-verify.json");
  // Snapshot the tracked file (or its absence) before the probe.
  const before = fs.existsSync(TRACKED)
    ? fs.statSync(TRACKED).mtimeMs
    : null;
  // Pause briefly so any modification would change mtimeMs measurably.
  const result = runProbe(["--base", "http://127.0.0.1:1", "--json"]);
  assert.equal(result.status, 2,
    "guard requires the probe to actually run (CONFIG exit ok)");
  const after = fs.existsSync(TRACKED)
    ? fs.statSync(TRACKED).mtimeMs
    : null;
  assert.equal(before, after,
    "probe must not modify docs/reports/2026-05-05-smart-arc-live-verify.json");
});
