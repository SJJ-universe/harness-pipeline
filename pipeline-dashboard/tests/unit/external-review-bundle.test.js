// Slice EXR-a (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05) — CLI surface
// tests for scripts/external-review-bundle.js.
//
// Strategy mirrors field-pilot-status.test.js: spawn the script as a
// subprocess in --skip-live + --json mode (so no server needed), then
// parse stdout JSON and assert structural invariants. The script is
// the operator-facing seam, so we test what the operator + reviewer
// observe — the CLI surface — not internals.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "external-review-bundle.js");

function run(args = [], opts = {}) {
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf-8",
    timeout: 30000,
    env: {
      // Force NO_COLOR so tests don't have to scrub ANSI.
      NO_COLOR: "1",
      // Give the script a path that won't resolve a token, to keep
      // the JSON shape predictable across hosts.
      ...process.env,
    },
    ...opts,
  });
}

test("EXR-a CLI: --help prints usage with exit-code legend", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.match(r.stdout, /Usage: external-review-bundle\.js/);
  assert.match(r.stdout, /--skip-live/);
  assert.match(r.stdout, /--strict/);
  assert.match(r.stdout, /--label/);
  assert.match(r.stdout, /Exit codes:/);
  assert.match(r.stdout, /0\s+OK/);
  assert.match(r.stdout, /1\s+DEGRADED/);
  assert.match(r.stdout, /2\s+INCIDENT/);
  assert.match(r.stdout, /3\s+CONFIG/);
  assert.match(r.stdout, /harness-external-review-bundle\/v1/);
});

test("EXR-a CLI: -h alias also prints help", () => {
  const r = run(["-h"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: external-review-bundle\.js/);
});

test("EXR-a CLI: --skip-live --json emits frozen schema with all top-level keys", () => {
  const r = run(["--skip-live", "--json", "--notes", "test note"]);
  // Exit code MAY be 0 (OK) or 1 (DEGRADED — uncommitted work
  // is normal during development). Either is allowed; just not 2/3.
  assert.ok(r.status === 0 || r.status === 1,
    `unexpected exit ${r.status}: ${r.stderr}`);
  let parsed;
  try { parsed = JSON.parse(r.stdout); }
  catch (e) {
    assert.fail(`stdout not JSON: ${r.stdout.slice(0, 400)} / stderr: ${r.stderr}`);
  }
  assert.equal(parsed.schema, "harness-external-review-bundle/v1",
    "schema must match harness-external-review-bundle/v1");
  // 11 frozen top-level keys in order.
  for (const key of [
    "schema", "capturedAt", "verdict", "label",
    "repo", "scorecard", "readinessRubric",
    "closeoutReports", "fieldPilotSnapshots",
    "rounds", "live", "anomalies", "notes",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, key),
      `missing top-level key ${key}`);
  }
  assert.equal(parsed.notes, "test note", "--notes propagated");
});

test("EXR-a CLI: --json verdict is one of the 4 frozen tiers", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(["OK", "DEGRADED", "INCIDENT", "CONFIG"].includes(parsed.verdict),
    `verdict must be one of OK/DEGRADED/INCIDENT/CONFIG, got ${parsed.verdict}`);
});

test("EXR-a CLI: scorecard block has parsed score numerator + cap", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.scorecard, "scorecard block present");
  assert.equal(typeof parsed.scorecard.path, "string");
  assert.match(parsed.scorecard.path, /scorecard\.md$/);
  assert.equal(typeof parsed.scorecard.bytes, "number");
  assert.ok(parsed.scorecard.bytes > 0);
  assert.match(parsed.scorecard.sha256, /^[a-f0-9]{64}$/,
    "sha256 must be a 64-char hex digest");
  // Score should parse — repo is in known good state at the scorecard
  // level. Numerator / cap are integers.
  assert.equal(typeof parsed.scorecard.scoreNumerator, "number",
    "scoreNumerator must be parsed");
  assert.equal(typeof parsed.scorecard.scoreCap, "number",
    "scoreCap must be parsed");
  assert.match(parsed.scorecard.currentScore, /^\d+\/\d+$/,
    "currentScore must look like N/M");
});

test("EXR-a CLI: readinessRubric block has bytes + sha256", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.readinessRubric, "readinessRubric block present");
  assert.match(parsed.readinessRubric.path, /readiness-rubric\.md$/);
  assert.ok(parsed.readinessRubric.bytes > 0);
  assert.match(parsed.readinessRubric.sha256, /^[a-f0-9]{64}$/);
});

test("EXR-a CLI: closeoutReports lists ≥4 reports (5-priority roadmap closure)", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.closeoutReports), "closeoutReports is array");
  // At time of EXR-a writing, we expect at least 4 closeouts visible —
  // the 4 priority rounds (RR0 / SMART-LV / POL / FP) plus historical.
  assert.ok(parsed.closeoutReports.length >= 4,
    `expected ≥4 closeout reports; got ${parsed.closeoutReports.length}`);
  // Each entry has the same shape.
  for (const r of parsed.closeoutReports) {
    assert.equal(typeof r.path, "string");
    assert.equal(typeof r.bytes, "number");
    assert.match(r.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof r.slice, "string");
    // date may be null only if filename doesn't have a date prefix —
    // for the EXR-a baseline all should match.
  }
});

test("EXR-a CLI: rounds trajectory parses ≥4 closed-round entries", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.rounds), "rounds is array");
  // The 5-priority roadmap closeout block in scorecard.md has banner
  // lines for at least RR0 / SMART-LV / POL / FP.
  assert.ok(parsed.rounds.length >= 4,
    `expected ≥4 rounds parsed; got ${parsed.rounds.length}`);
  for (const r of parsed.rounds) {
    assert.equal(typeof r.id, "string");
    assert.match(r.score, /^\d+\/\d+$/);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof r.lineNumber, "number");
  }
});

test("EXR-a CLI: live block reflects --skip-live", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.live, "live block present");
  assert.equal(parsed.live.skipped, true, "live.skipped true under --skip-live");
  assert.equal(parsed.live.captured, false);
  assert.equal(parsed.live.skipReason, "--skip-live");
});

test("EXR-a CLI: repo block has HEAD + branch + cleanWorkingTree", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.repo, "repo block present");
  assert.match(parsed.repo.head, /^[a-f0-9]{40}$/, "repo.head is 40-char sha");
  assert.equal(typeof parsed.repo.branch, "string");
  assert.equal(typeof parsed.repo.cleanWorkingTree, "boolean");
  assert.ok(Array.isArray(parsed.repo.untrackedFiles));
  assert.ok(Array.isArray(parsed.repo.modifiedFiles));
});

test("EXR-a CLI: fieldPilotSnapshots is an array (may be empty pre-deployment)", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.fieldPilotSnapshots),
    "fieldPilotSnapshots must be an array, even if empty");
  for (const s of parsed.fieldPilotSnapshots) {
    assert.equal(typeof s.path, "string");
    assert.equal(typeof s.label, "string");
    // verdict / capturedAt / schema may be null if file was malformed.
  }
});

test("EXR-a CLI: --label shapes the output file name (file mode)", () => {
  // Run in file mode (no --json) and verify the bundle.label in JSON
  // matches what we passed. We peek at the written file via the
  // --output-dir override pointed at the test's tmp dir.
  const fs = require("node:fs");
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "exr-a-test-"));
  const r = run([
    "--skip-live",
    "--quiet",
    "--label", "exr-a-test",
    "--output-dir", tmp,
  ]);
  assert.ok(r.status === 0 || r.status === 1,
    `expected exit 0 or 1, got ${r.status}: ${r.stderr}`);
  const expectFile = path.join(tmp, "exr-a-test-external-review-bundle.json");
  assert.ok(fs.existsSync(expectFile),
    `expected file ${expectFile} to exist`);
  const parsed = JSON.parse(fs.readFileSync(expectFile, "utf-8"));
  assert.equal(parsed.label, "exr-a-test");
  assert.equal(parsed.schema, "harness-external-review-bundle/v1");
  // Cleanup.
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
});

test("EXR-a CLI: no --notes → notes defaults to empty string", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.notes, "", "notes defaults to empty string");
});

test("EXR-a CLI: anomalies is always an array", () => {
  const r = run(["--skip-live", "--json"]);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.anomalies), "anomalies is an array");
});

// ── Library surface tests (export contract) ─────────────────────

test("EXR-a library: SCHEMA constant export matches CLI output", () => {
  const lib = require("../../scripts/external-review-bundle");
  assert.equal(lib.SCHEMA, "harness-external-review-bundle/v1");
});

test("EXR-a library: parseArgs default values are stable", () => {
  const lib = require("../../scripts/external-review-bundle");
  const out = lib.parseArgs(["node", "external-review-bundle.js"]);
  assert.equal(out.base, "http://127.0.0.1:4201");
  assert.equal(out.quiet, false);
  assert.equal(out.json, false);
  assert.equal(out.skipLive, false);
  assert.equal(out.strict, false);
  assert.equal(out.notes, "");
  assert.equal(out.timeoutMs, 15000);
  // outputDir resolves to docs/external-review; just check shape.
  assert.match(out.outputDir, /external-review$/);
  // label defaults to today.
  assert.match(out.label, /^\d{4}-\d{2}-\d{2}$/);
});

test("EXR-a library: parseArgs flags are honored", () => {
  const lib = require("../../scripts/external-review-bundle");
  const out = lib.parseArgs([
    "node", "external-review-bundle.js",
    "--base", "http://1.2.3.4:9999",
    "--output-dir", "/tmp/x",
    "--label", "custom",
    "--notes", "n",
    "--timeout-ms", "5000",
    "--quiet", "--json", "--skip-live", "--strict",
  ]);
  assert.equal(out.base, "http://1.2.3.4:9999");
  assert.equal(out.outputDir, "/tmp/x");
  assert.equal(out.label, "custom");
  assert.equal(out.notes, "n");
  assert.equal(out.timeoutMs, 5000);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
  assert.equal(out.skipLive, true);
  assert.equal(out.strict, true);
});

test("EXR-a library: _computeVerdict CONFIG when scorecard missing", () => {
  const lib = require("../../scripts/external-review-bundle");
  const verdict = lib._computeVerdict({
    repo: { cleanWorkingTree: true },
    scorecard: null,
    readinessRubric: { path: "x" },
    closeoutReports: [],
    fieldPilotSnapshots: [],
    rounds: [],
    live: { captured: false, skipped: true },
  }, { strict: false });
  assert.equal(verdict, "CONFIG");
});

test("EXR-a library: _computeVerdict INCIDENT when chain.valid === false", () => {
  const lib = require("../../scripts/external-review-bundle");
  const verdict = lib._computeVerdict({
    repo: { cleanWorkingTree: true },
    scorecard: { scoreNumerator: 120 },
    readinessRubric: { path: "x" },
    closeoutReports: [{}, {}, {}, {}],
    fieldPilotSnapshots: [],
    rounds: [],
    live: { captured: true, auditChain: { chainValid: false } },
  }, { strict: false });
  assert.equal(verdict, "INCIDENT");
});

test("EXR-a library: _computeVerdict DEGRADED when working tree dirty", () => {
  const lib = require("../../scripts/external-review-bundle");
  const verdict = lib._computeVerdict({
    repo: { cleanWorkingTree: false },
    scorecard: { scoreNumerator: 120 },
    readinessRubric: { path: "x" },
    closeoutReports: [{}, {}, {}, {}],
    fieldPilotSnapshots: [],
    rounds: [],
    live: { captured: true, skipped: false, auditChain: { chainValid: true },
            readiness: { total: 18, max: 18 } },
  }, { strict: false });
  assert.equal(verdict, "DEGRADED");
});

test("EXR-a library: _computeVerdict OK when everything clean", () => {
  const lib = require("../../scripts/external-review-bundle");
  const verdict = lib._computeVerdict({
    repo: { cleanWorkingTree: true },
    scorecard: { scoreNumerator: 120 },
    readinessRubric: { path: "x" },
    closeoutReports: [{}, {}, {}, {}],
    fieldPilotSnapshots: [],
    rounds: [],
    live: { captured: true, skipped: false, auditChain: { chainValid: true },
            readiness: { total: 18, max: 18 } },
  }, { strict: false });
  assert.equal(verdict, "OK");
});

test("EXR-a library: _computeVerdict --strict + offline becomes INCIDENT", () => {
  const lib = require("../../scripts/external-review-bundle");
  const verdict = lib._computeVerdict({
    repo: { cleanWorkingTree: true },
    scorecard: { scoreNumerator: 120 },
    readinessRubric: { path: "x" },
    closeoutReports: [{}, {}, {}, {}],
    fieldPilotSnapshots: [],
    rounds: [],
    // captured=false + skipped=false (server unreachable, --skip-live not set)
    live: { captured: false, skipped: false },
  }, { strict: true });
  assert.equal(verdict, "INCIDENT");
});
