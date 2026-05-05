// Slice LIVE-EVIDENCE-SCHEMA-DOC (Phase 2 v2 follow-up, 2026-05-05) —
// structural + conformance tests for docs/live-evidence-schema.md.
//
// Two responsibilities:
//   1. Structure: the doc has the load-bearing sections, schema
//      identifiers, audit-chain anchors, and convergence notes.
//   2. Conformance: each probe script's CONFIG-mode JSON output
//      matches the doc-locked v1 shape. Run the probe with an
//      unreachable base URL → CONFIG verdict → JSON has the
//      required top-level fields named in the schema doc.
//
// Conformance is what gives the doc teeth: if a probe later
// renames a field without bumping schema/v1 → /v2, this test
// fires.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOC = path.resolve(REPO_ROOT, "docs", "live-evidence-schema.md");

function read(p) { return fs.readFileSync(p, "utf-8"); }

const EVIDENCE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lv-schema-test-"));

// ── File-level invariants ─────────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: file exists + non-empty", () => {
  assert.ok(fs.existsSync(DOC));
  const s = fs.statSync(DOC);
  assert.ok(s.size > 5000,
    `expected ≥ 5000 bytes, got ${s.size}`);
});

test("LIVE-EVIDENCE-SCHEMA-DOC: H1 + slice tag", () => {
  const text = read(DOC);
  assert.match(text, /^# Live-Evidence Schema Reference/m);
  assert.match(text, /Slice LIVE-EVIDENCE-SCHEMA-DOC \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Top-level sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Why this exists"],
  ["§2", "Schema 1 — `harness-smart-lv-evidence/v1`"],
  ["§3", "Schema 2 — `live-verify-review-relay/v1`"],
  ["§4", "Audit-chain anchors"],
  ["§5", "Schema versioning policy"],
  ["§6", "Schema convergence notes"],
  ["§7", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`LIVE-EVIDENCE-SCHEMA-DOC: ${num} section "${name}" present`, () => {
    const text = read(DOC);
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
    assert.match(text, re,
      `${num} ${name} must exist`);
  });
}

// ── Schema identifiers locked ─────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: schema 1 string locked as harness-smart-lv-evidence/v1", () => {
  const text = read(DOC);
  // Appears in title, in source code reference, in example.
  const occurrences = (text.match(/harness-smart-lv-evidence\/v1/g) || []).length;
  assert.ok(occurrences >= 3,
    `expected ≥ 3 mentions of the schema 1 identifier, got ${occurrences}`);
});

test("LIVE-EVIDENCE-SCHEMA-DOC: schema 2 string locked as live-verify-review-relay/v1", () => {
  const text = read(DOC);
  const occurrences = (text.match(/live-verify-review-relay\/v1/g) || []).length;
  assert.ok(occurrences >= 3,
    `expected ≥ 3 mentions of the schema 2 identifier, got ${occurrences}`);
});

// ── Schema 1 shape — required field names ────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: §2.1 names all 7 top-level required fields", () => {
  const text = read(DOC);
  const idx = text.indexOf("### §2.1");
  const seg = text.slice(idx, text.indexOf("### §2.2", idx));
  for (const f of ["schema", "runAt", "verdict", "environment",
                    "properties", "auditChain", "notes"]) {
    assert.match(seg, new RegExp("`" + f + "`"),
      `§2.1 must list field \`${f}\``);
  }
});

test("LIVE-EVIDENCE-SCHEMA-DOC: §2.2 names all 6 SMART arc property keys", () => {
  const text = read(DOC);
  const idx = text.indexOf("### §2.2");
  const seg = text.slice(idx, text.indexOf("### §2.3", idx));
  for (const k of [
    "p1_hard_gates_env",
    "p2_finance_high_privacy",
    "p3_policy_gate_blocked",
    "p4_run_memory_redacted",
    "p5_recommendations",
    "p6_preset_dispatch",
  ]) {
    assert.match(seg, new RegExp("`" + k + "`"),
      `§2.2 must list property key \`${k}\``);
  }
});

test("LIVE-EVIDENCE-SCHEMA-DOC: §2.4 documents the 3-verdict vocabulary", () => {
  const text = read(DOC);
  const idx = text.indexOf("### §2.4");
  const seg = text.slice(idx, text.indexOf("### §2.5", idx));
  assert.match(seg, /`PASS`/);
  assert.match(seg, /`FAIL`/);
  assert.match(seg, /`CONFIG`/);
});

// ── Schema 2 shape — required field names ────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: §3.1 names all 8 top-level required fields", () => {
  const text = read(DOC);
  const idx = text.indexOf("### §3.1");
  const seg = text.slice(idx, text.indexOf("### §3.2", idx));
  for (const f of ["schema", "startedAt", "verdict", "options",
                    "steps", "sessionId", "critiqueReceivedElapsedMs",
                    "serverInfo"]) {
    assert.match(seg, new RegExp("`" + f + "`"),
      `§3.1 must list field \`${f}\``);
  }
});

test("LIVE-EVIDENCE-SCHEMA-DOC: §3.4 documents the FAIL_* vocabulary", () => {
  const text = read(DOC);
  const idx = text.indexOf("### §3.4");
  const seg = text.slice(idx, text.indexOf("### §3.5", idx));
  for (const v of ["PASS", "FAIL_SERVER_DOWN", "FAIL_CREATE",
                    "FAIL_SEND_CODEX", "FAIL_CRITIQUE_TIMEOUT",
                    "FAIL_FOLLOWUP", "FAIL_HANDBACK",
                    "FAIL_CLAUDE_TIMEOUT", "PENDING"]) {
    assert.match(seg, new RegExp("`" + v + "`"),
      `§3.4 must list verdict \`${v}\``);
  }
});

// ── §4 audit-chain anchors ────────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: §4 names all 3 audit-chain anchor verbs", () => {
  const text = read(DOC);
  const idx = text.indexOf("## §4");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  for (const verb of [
    "deployment_profile_resolved",
    "policy_gate_blocked",
    "review_session_dispatch_started",
  ]) {
    assert.match(seg, new RegExp("`" + verb + "`"),
      `§4 must name audit verb \`${verb}\``);
  }
});

// ── §5 versioning policy ──────────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: §5 distinguishes breaking vs additive changes", () => {
  const text = read(DOC);
  const idx = text.indexOf("## §5");
  const seg = text.slice(idx, text.indexOf("## §6", idx));
  // Must explicitly say what bumps to v2 vs what stays v1.
  assert.match(seg, /breaking|breaking change|bump to v2/i);
  assert.match(seg, /additive/i);
});

// ── §6 convergence notes call out the 4 inconsistencies ──────

test("LIVE-EVIDENCE-SCHEMA-DOC: §6 documents 4 v2 candidate fixes", () => {
  const text = read(DOC);
  const idx = text.indexOf("## §6");
  const seg = text.slice(idx, text.indexOf("## §7", idx));
  // 4 numbered items
  for (const n of [1, 2, 3, 4]) {
    assert.match(seg, new RegExp(`^${n}\\.\\s+\\*\\*`, "m"),
      `§6 must include numbered convergence note ${n}.`);
  }
  // The specific divergence points named
  assert.match(seg, /prefix/);
  assert.match(seg, /[Tt]imestamp/);
});

// ── Cross-references ──────────────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: links to v1-blockers.md (the blocker this unlocks)", () => {
  assert.match(read(DOC), /v1-blockers\.md/);
});

test("LIVE-EVIDENCE-SCHEMA-DOC: links to both probe scripts in §7", () => {
  const text = read(DOC);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx);
  assert.match(seg, /live-verify-smart-arc\.js/);
  assert.match(seg, /live-verify-review-relay\.js/);
});

// ── docs/README.md indexed ────────────────────────────────────

test("LIVE-EVIDENCE-SCHEMA-DOC: docs/README.md indexes live-evidence-schema.md", () => {
  const text = fs.readFileSync(
    path.resolve(REPO_ROOT, "docs", "README.md"), "utf-8"
  );
  assert.match(text, /live-evidence-schema\.md/,
    "docs/README.md must list live-evidence-schema.md");
});

// ── Conformance: probe CONFIG output matches doc-locked shape ─

// These tests run each probe with an unreachable base URL so the
// probe exits CONFIG without spawning real Claude/Codex. They
// verify the EMITTED JSON has the field names the doc claims.
//
// If a future edit renames `runAt` → `executedAt` without bumping
// the schema version, this test fires.

test("CONFORMANCE: smart-arc probe CONFIG output matches schema 1 v1 shape", () => {
  const result = spawnSync(process.execPath, [
    path.resolve(REPO_ROOT, "scripts", "live-verify-smart-arc.js"),
    "--base", "http://127.0.0.1:1",
    "--json",
    "--evidence-dir", EVIDENCE_TMP,
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
    timeout: 15_000,
  });
  assert.equal(result.status, 2,
    `smart-arc CONFIG exit must be 2, got ${result.status}`);
  const evidence = JSON.parse(result.stdout);
  // Doc-locked top-level field names
  assert.equal(evidence.schema, "harness-smart-lv-evidence/v1");
  assert.ok("runAt" in evidence, "schema 1 must have `runAt` (not `executedAt`)");
  assert.ok("verdict" in evidence);
  assert.ok("environment" in evidence);
  assert.ok("properties" in evidence);
  assert.ok("auditChain" in evidence);
  assert.ok(Array.isArray(evidence.notes), "schema 1 `notes` must be string[]");
  // Verdict on CONFIG path
  assert.equal(evidence.verdict, "CONFIG");
});

test("CONFORMANCE: review-relay probe CONFIG output matches schema 2 v1 shape", () => {
  const result = spawnSync(process.execPath, [
    path.resolve(REPO_ROOT, "scripts", "live-verify-review-relay.js"),
    "--base", "http://127.0.0.1:1",
    "--json",
    "--evidence-dir", EVIDENCE_TMP,
    "--quiet",
  ], {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf-8",
    timeout: 15_000,
  });
  // review-relay exits 2 on FAIL_SERVER_DOWN
  assert.equal(result.status, 2,
    `review-relay CONFIG-equivalent exit must be 2, got ${result.status}`);
  // Find the JSON in stdout (the script may emit non-JSON banners
  // too; grab the first balanced { ... } block).
  const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
  assert.ok(jsonMatch, "review-relay --json must emit a JSON object");
  const evidence = JSON.parse(jsonMatch[0]);
  // Doc-locked top-level field names
  assert.equal(evidence.schema, "live-verify-review-relay/v1");
  assert.ok("startedAt" in evidence,
    "schema 2 must have `startedAt` (not `runAt`)");
  assert.ok("verdict" in evidence);
  assert.ok("options" in evidence);
  assert.ok(Array.isArray(evidence.steps),
    "schema 2 `steps` must be array");
  assert.ok("sessionId" in evidence);
  assert.ok("critiqueReceivedElapsedMs" in evidence);
  assert.ok("serverInfo" in evidence);
  // Verdict on server-down path
  assert.equal(evidence.verdict, "FAIL_SERVER_DOWN");
});

// ── Cross-coherence: doc + script schema strings agree ────────

test("CROSS-COHERENCE: smart-arc script + schema doc agree on identifier", () => {
  const scriptText = fs.readFileSync(
    path.resolve(REPO_ROOT, "scripts", "live-verify-smart-arc.js"), "utf-8"
  );
  // Script must hard-code the v1 string the doc locked.
  assert.match(scriptText, /["']harness-smart-lv-evidence\/v1["']/,
    "smart-arc script must emit schema = 'harness-smart-lv-evidence/v1'");
});

test("CROSS-COHERENCE: review-relay script + schema doc agree on identifier", () => {
  const scriptText = fs.readFileSync(
    path.resolve(REPO_ROOT, "scripts", "live-verify-review-relay.js"), "utf-8"
  );
  assert.match(scriptText, /["']live-verify-review-relay\/v1["']/,
    "review-relay script must emit schema = 'live-verify-review-relay/v1'");
});
