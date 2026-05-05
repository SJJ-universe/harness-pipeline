// Slice FP-a (Phase 2 / FIELD-PILOT-0, 2026-05-05) — field-pilot-status
// CLI surface tests. Pins:
//   - --help prints usage + exits 0
//   - server unreachable → exit 3 (CONFIG)
//   - --json emits valid harness-field-pilot-status/v1 schema
//   - --notes flag preserved in output

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT_PATH = path.resolve(__dirname, "..", "..", "scripts", "field-pilot-status.js");

function runProbe(extraArgs = [], envOverrides = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...extraArgs], {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, NO_COLOR: "1", ...envOverrides },
    encoding: "utf-8",
    timeout: 15_000,
  });
}

// ── --help ────────────────────────────────────────────────────────

test("FP-a CLI: --help prints usage + exits 0", () => {
  const result = runProbe(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: field-pilot-status\.js/);
  assert.match(result.stdout, /OK\s+— no incidents detected/);
  assert.match(result.stdout, /DEGRADED\s+— review recommended/);
  assert.match(result.stdout, /INCIDENT\s+— investigation required/);
  assert.match(result.stdout, /CONFIG\s+— server unreachable/);
});

test("FP-a CLI: -h short flag also prints usage", () => {
  const result = runProbe(["-h"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
});

// ── Server unreachable → CONFIG ────────────────────────────────────

test("FP-a CLI: unreachable server → exit 3 (CONFIG)", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",  // reserved/unused
    "--quiet",
    "--evidence-dir", "/tmp/__fpa_test_evidence__",
  ]);
  assert.equal(result.status, 3,
    `expected CONFIG (3), got ${result.status}: ${result.stderr}`);
});

test("FP-a CLI: --json output is valid JSON when server unreachable", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  assert.equal(result.status, 3);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.schema, "harness-field-pilot-status/v1");
  assert.equal(evidence.verdict, "CONFIG");
  assert.ok(typeof evidence.capturedAt === "string");
});

test("FP-a CLI: --json schema includes all expected top-level keys", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.ok("schema" in evidence);
  assert.ok("capturedAt" in evidence);
  assert.ok("verdict" in evidence);
  assert.ok("environment" in evidence);
  assert.ok("health" in evidence);
  assert.ok("audit" in evidence);
  assert.ok("runtime" in evidence);
  assert.ok("notes" in evidence);
});

test("FP-a CLI: audit subschema has today + anomalies + unknownVerbs", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.ok(evidence.audit.today);
  assert.ok(typeof evidence.audit.today.total === "number");
  assert.ok(typeof evidence.audit.today.byVerb === "object");
  assert.ok(Array.isArray(evidence.audit.anomalies));
  assert.ok(Array.isArray(evidence.audit.unknownVerbs));
});

// ── --notes preserved ────────────────────────────────────────────

test("FP-a CLI: --notes free-form text appears in evidence JSON", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
    "--notes", "deployed at 9 AM, no incidents observed",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.notes, "deployed at 9 AM, no incidents observed");
});

test("FP-a CLI: missing --notes defaults to empty string", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.notes, "");
});

// ── --label affects file naming (not directly observable here, but
//      we can verify the flag doesn't crash) ─────────────────────

test("FP-a CLI: --label custom value accepted (no crash)", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--label", "day-3",
    "--quiet",
    "--evidence-dir", "/tmp/__fpa_label_test__",
  ]);
  // Even on CONFIG exit, accepting the flag without crashing is the test.
  assert.equal(result.status, 3);
});

// ── verdict semantics ──────────────────────────────────────────────

test("FP-a CLI: verdict semantics — CONFIG when health probe fails", () => {
  const result = runProbe([
    "--base", "http://127.0.0.1:1",
    "--json",
  ]);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.verdict, "CONFIG");
  assert.equal(evidence.health.serverUp, false);
});
