// Slice LIVE-EVIDENCE-COLLECTOR (Phase 2 v2 follow-up, 2026-05-05) —
// behavior + structure tests for scripts/collect-live-evidence.js.
//
// The script aggregates two probe-output files into a single
// sealed bundle (schema orchestrator-live-evidence-bundle/v1, locked
// in docs/live-evidence-schema.md §4). These tests verify:
//   1. Script-file invariants (header, slice tag, npm registration).
//   2. Behavior with explicit --smart-arc + --review-relay paths
//      pointing at fixture data.
//   3. Bundle conformance: emitted JSON has the doc-locked top-level
//      fields and the verdict-derivation rules.
//
// All tests use private tmpdirs for both inputs and outputs so
// docs/reports/ is never touched.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "collect-live-evidence.js");
const PACKAGE_JSON = path.join(REPO_ROOT, "package.json");

function read(p) { return fs.readFileSync(p, "utf-8"); }

const SCHEMA_BUNDLE = "orchestrator-live-evidence-bundle/v1";
const SCHEMA_SMART_ARC = "orchestrator-smart-lv-evidence/v1";
const SCHEMA_REVIEW_RELAY = "live-verify-review-relay/v1";

// ── Fixture helpers ──────────────────────────────────────────

function mktmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lec-test-"));
}

function writeFixture(dir, filename, data) {
  const full = path.join(dir, filename);
  fs.writeFileSync(full, JSON.stringify(data, null, 2));
  return full;
}

function smartArcFixture(verdict, overrides = {}) {
  return Object.assign({
    schema: SCHEMA_SMART_ARC,
    runAt: "2026-05-06T15:00:00.000Z",
    verdict,
    environment: { pack: "finance-high-privacy", publicSector: true },
    properties: {
      p1_hard_gates_env:      { ok: true, mode: "hard" },
      p2_finance_high_privacy:{ ok: true, pack: "finance-high-privacy" },
      p3_policy_gate_blocked: { ok: true, status: 409 },
      p4_run_memory_redacted: { ok: true, redacted: true },
      p5_recommendations:     { ok: true },
      p6_preset_dispatch:     { ok: true, presetId: "security" },
    },
    auditChain: { runId: "run-fixture", verbsObserved: ["deployment_profile_resolved"] },
    notes: [],
  }, overrides);
}

function reviewRelayFixture(verdict, overrides = {}) {
  return Object.assign({
    schema: SCHEMA_REVIEW_RELAY,
    startedAt: "2026-05-06T15:30:00.000Z",
    verdict,
    options: { base: "http://127.0.0.1:4201", label: "fixture", posture: "standard", withFollowup: true, withHandback: true },
    steps: [{ step: "health", ok: true }],
    sessionId: "rs-fixture",
    critiqueReceivedElapsedMs: 4200,
    serverInfo: { pack: "standard" },
  }, overrides);
}

function runCollector(extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, ...extraArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
    timeout: 15_000,
  });
}

// ── Script file invariants ───────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: scripts/collect-live-evidence.js exists + non-empty", () => {
  assert.ok(fs.existsSync(SCRIPT));
  assert.ok(fs.statSync(SCRIPT).size > 3000);
});

test("LIVE-EVIDENCE-COLLECTOR: header tags slice + bilingual purpose", () => {
  const text = read(SCRIPT).split("\n").slice(0, 70).join("\n");
  assert.match(text, /Slice LIVE-EVIDENCE-COLLECTOR \(Phase 2 v2 follow-up, 2026-05-05\)/);
  assert.match(text, /aggregator/i);
});

test("LIVE-EVIDENCE-COLLECTOR: script names all 3 schema constants", () => {
  const text = read(SCRIPT);
  assert.match(text, new RegExp(SCHEMA_BUNDLE.replace(/\//g, "\\/")));
  assert.match(text, new RegExp(SCHEMA_SMART_ARC.replace(/\//g, "\\/")));
  assert.match(text, new RegExp(SCHEMA_REVIEW_RELAY.replace(/\//g, "\\/")));
});

test("LIVE-EVIDENCE-COLLECTOR: package.json registers `collect-live-evidence`", () => {
  const pkg = JSON.parse(read(PACKAGE_JSON));
  assert.ok(pkg.scripts["collect-live-evidence"]);
  assert.match(pkg.scripts["collect-live-evidence"], /collect-live-evidence\.js/);
});

// ── --help ────────────────────────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: --help prints usage + exits 0", () => {
  const r = runCollector(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: collect-live-evidence\.js/);
  assert.match(r.stdout, /--smart-arc/);
  assert.match(r.stdout, /--review-relay/);
  assert.match(r.stdout, /--out/);
  assert.match(r.stdout, /--json/);
});

// ── PASS scenario: both fixtures PASS ─────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: both PASS components → bundle PASS + exit 0", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  assert.equal(r.status, 0,
    `expected exit 0 (PASS), got ${r.status}: ${r.stderr}`);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.schema, SCHEMA_BUNDLE);
  assert.equal(bundle.verdict, "PASS");
  assert.equal(bundle.summary.smartArc.verdict, "PASS");
  assert.equal(bundle.summary.reviewRelay.verdict, "PASS");
  assert.deepEqual(bundle.missing, []);
});

// ── FAIL scenario: one component FAIL ────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: one component FAIL → bundle FAIL + exit 1", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("FAIL"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  assert.equal(r.status, 1);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.verdict, "FAIL");
});

test("LIVE-EVIDENCE-COLLECTOR: review-relay FAIL_CRITIQUE_TIMEOUT → bundle FAIL", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json",
    reviewRelayFixture("FAIL_CRITIQUE_TIMEOUT"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  assert.equal(r.status, 1);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.verdict, "FAIL");
});

// ── INCOMPLETE scenarios ─────────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: smart-arc CONFIG → INCOMPLETE + exit 1", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("CONFIG"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  assert.equal(r.status, 1);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.verdict, "INCOMPLETE");
});

test("LIVE-EVIDENCE-COLLECTOR: missing review-relay → INCOMPLETE + missing[]", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  // Pass empty reports-dir + only --smart-arc explicit
  const emptyDir = mktmp();
  const r = runCollector([
    "--smart-arc", sa,
    "--reports-dir", emptyDir,
    "--json",
  ]);
  assert.equal(r.status, 1);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.verdict, "INCOMPLETE");
  assert.deepEqual(bundle.missing, ["reviewRelay"]);
  assert.equal(bundle.summary.reviewRelay, null);
  assert.equal(bundle.components.reviewRelay, null);
});

// ── Bundle shape conformance ─────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: bundle has all 6 doc-locked top-level fields", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  const bundle = JSON.parse(r.stdout);
  for (const f of ["schema", "createdAt", "verdict", "summary",
                    "components", "missing"]) {
    assert.ok(f in bundle, `bundle must include doc-locked field \`${f}\``);
  }
});

test("LIVE-EVIDENCE-COLLECTOR: summary entries carry sourceFile/schema/verdict/timestamp", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  const bundle = JSON.parse(r.stdout);
  for (const c of ["smartArc", "reviewRelay"]) {
    const s = bundle.summary[c];
    assert.ok(s.sourceFile, `summary.${c}.sourceFile required`);
    assert.ok(s.schema,     `summary.${c}.schema required`);
    assert.ok(s.verdict,    `summary.${c}.verdict required`);
    assert.ok(s.timestamp,  `summary.${c}.timestamp required`);
  }
});

test("LIVE-EVIDENCE-COLLECTOR: components inline the full per-probe evidence", () => {
  const tmp = mktmp();
  const saData = smartArcFixture("PASS");
  const rrData = reviewRelayFixture("PASS");
  const sa = writeFixture(tmp, "fix-smart-arc.json", saData);
  const rr = writeFixture(tmp, "fix-review-relay.json", rrData);
  const r = runCollector(["--smart-arc", sa, "--review-relay", rr, "--json"]);
  const bundle = JSON.parse(r.stdout);
  // Full evidence inlined — properties / auditChain / notes preserved
  assert.equal(bundle.components.smartArc.schema, SCHEMA_SMART_ARC);
  assert.deepEqual(bundle.components.smartArc.properties, saData.properties);
  assert.deepEqual(bundle.components.smartArc.auditChain, saData.auditChain);
  assert.equal(bundle.components.reviewRelay.schema, SCHEMA_REVIEW_RELAY);
  assert.deepEqual(bundle.components.reviewRelay.steps, rrData.steps);
});

// ── Schema-mismatch rejection ────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: schema mismatch → component absent + INCOMPLETE", () => {
  const tmp = mktmp();
  // Wrong schema for the smart-arc slot
  const wrong = writeFixture(tmp, "fix-wrong.json", {
    schema: "orchestrator-something-else/v1",
    verdict: "PASS",
  });
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const r = runCollector(["--smart-arc", wrong, "--review-relay", rr, "--json"]);
  // Mismatch → smartArc treated as missing
  assert.equal(r.status, 1);
  const bundle = JSON.parse(r.stdout);
  assert.equal(bundle.summary.smartArc, null,
    "schema mismatch must cause the component to be absent");
  assert.deepEqual(bundle.missing, ["smartArc"]);
});

// ── --out file write ─────────────────────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: --out writes bundle to disk", () => {
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const out = path.join(tmp, "bundle.json");
  const r = runCollector([
    "--smart-arc", sa, "--review-relay", rr,
    "--out", out, "--quiet",
  ]);
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(out));
  const written = JSON.parse(fs.readFileSync(out, "utf-8"));
  assert.equal(written.schema, SCHEMA_BUNDLE);
  assert.equal(written.verdict, "PASS");
});

// ── No-leak guard (RC-CLEANUP precedent) ─────────────────────

test("LIVE-EVIDENCE-COLLECTOR: explicit --out keeps docs/reports/ untouched", () => {
  // Snapshot the smart-arc template's mtime — must be unchanged
  // after running the collector with explicit --out.
  const tracked = path.resolve(REPO_ROOT, "docs", "reports",
    "2026-05-05-smart-arc-live-verify.json");
  const before = fs.existsSync(tracked) ? fs.statSync(tracked).mtimeMs : null;
  const tmp = mktmp();
  const sa = writeFixture(tmp, "fix-smart-arc.json", smartArcFixture("PASS"));
  const rr = writeFixture(tmp, "fix-review-relay.json", reviewRelayFixture("PASS"));
  const out = path.join(tmp, "bundle.json");
  runCollector([
    "--smart-arc", sa, "--review-relay", rr,
    "--out", out, "--quiet",
  ]);
  const after = fs.existsSync(tracked) ? fs.statSync(tracked).mtimeMs : null;
  assert.equal(before, after,
    "collector must not modify docs/reports/2026-05-05-smart-arc-live-verify.json");
});

// ── Cross-coherence with schema doc ──────────────────────────

test("LIVE-EVIDENCE-COLLECTOR: schema doc §4.1 lists same 6 bundle fields", () => {
  const docText = fs.readFileSync(
    path.resolve(REPO_ROOT, "docs", "live-evidence-schema.md"), "utf-8"
  );
  const idx = docText.indexOf("### §4.1");
  const seg = docText.slice(idx, docText.indexOf("### §4.2", idx));
  // Same 6 fields listed in the doc must be the same 6 fields in
  // the bundle output.
  for (const f of ["schema", "createdAt", "verdict", "summary",
                    "components", "missing"]) {
    assert.match(seg, new RegExp("`" + f + "`"),
      `schema doc §4.1 must list \`${f}\` (cross-coherence with collector output)`);
  }
});
