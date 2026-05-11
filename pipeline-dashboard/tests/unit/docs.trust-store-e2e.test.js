// Slice TRUST-STORE-E2E-RUNBOOK (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/runbooks/trust-store-e2e.md.
//
// The runbook walks the operator through Phase 1 (sign) →
// Phase 2 (install with gate) → Phase 3 (tampering rejection)
// per v1.0.0 Blocker #2 acceptance criterion #1. The tests
// anchor each phase's load-bearing pieces (commands, audit-chain
// verbs, exit codes) so a future edit can't drop the contract.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNBOOK = path.resolve(REPO_ROOT, "docs", "runbooks", "trust-store-e2e.md");
const RUNBOOKS_INDEX = path.resolve(REPO_ROOT, "docs", "runbooks", "README.md");
const V1_BLOCKERS = path.resolve(REPO_ROOT, "docs", "runbooks", "v1-blockers.md");
const SCORECARD = path.resolve(REPO_ROOT, "docs", "scorecard.md");

function read(p) { return fs.readFileSync(p, "utf-8"); }

// ── File-level invariants ─────────────────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: file exists + non-empty", () => {
  assert.ok(fs.existsSync(RUNBOOK));
  const s = fs.statSync(RUNBOOK);
  assert.ok(s.size > 6000,
    `expected ≥ 6000 bytes, got ${s.size}`);
});

test("TRUST-STORE-E2E-RUNBOOK: H1 + slice tag", () => {
  const text = read(RUNBOOK);
  assert.match(text, /^# Runbook — Trust-Store \+ Signed-Manifest End-to-End/m);
  assert.match(text,
    /Slice TRUST-STORE-E2E-RUNBOOK \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Top-level sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Audience and trust scope"],
  ["§2", "Prerequisites"],
  ["§3", "Phase 1 — Generate signed release manifest"],
  ["§4", "Phase 2 — Install via launcher with the gate active"],
  ["§5", "Phase 3 — Tampering rejection"],
  ["§6", "Evidence collection"],
  ["§7", "Risks and known gaps"],
  ["§8", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`TRUST-STORE-E2E-RUNBOOK: ${num} section "${name}" present`, () => {
    const text = read(RUNBOOK);
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
    assert.match(text, re,
      `${num} ${name} must exist`);
  });
}

// ── Two operator roles documented in §1 ──────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §1 names the two operator roles", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §1");
  const seg = text.slice(idx, text.indexOf("## §2", idx));
  assert.match(seg, /Deployer.*release engineer|release engineer.*Deployer/i,
    "§1 must name the deployer / release engineer role");
  assert.match(seg, /[Ii]nstallation operator/,
    "§1 must name the installation operator role");
  // Private vs public key separation — load-bearing safety property
  assert.match(seg, /private key/i);
  assert.match(seg, /public key/i);
});

// ── Phase 1 — sign-manifest commands ─────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §3 contains the 3 sign-manifest subcommands", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §3");
  const seg = text.slice(idx, text.indexOf("## §4", idx));
  // genkey + sign subcommand examples
  assert.match(seg, /sign-manifest\.js genkey/);
  assert.match(seg, /sign-manifest\.js sign/);
  // Required flags for `sign`
  assert.match(seg, /--manifest/);
  assert.match(seg, /--private-key/);
  assert.match(seg, /--key-id/);
});

test("TRUST-STORE-E2E-RUNBOOK: §3 references trust-store schema + fixture", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §3");
  const seg = text.slice(idx, text.indexOf("## §4", idx));
  assert.match(seg, /orchestrator-release-trust\/v1/);
  assert.match(seg, /trust-store-example\.json/);
  // Anti-real-key guard reminded
  assert.match(seg, /REPLACE_ME|placeholder/i);
});

// ── Phase 2 — gate behavior ──────────────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §4 documents 4 install verdicts", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §4");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  // Verdict sub-sections §4.3 - §4.6
  for (const sub of [".3", ".4", ".5", ".6"]) {
    assert.match(seg, new RegExp(`### §4\\${sub}`),
      `§4 must include §4${sub}`);
  }
  // Audit-chain anchor verbs
  assert.match(seg, /launcher_signature_verified/);
  assert.match(seg, /launcher_signature_failed/);
  // Exit codes
  assert.match(seg, /exit 37/);
  assert.match(seg, /exit 38/);
});

test("TRUST-STORE-E2E-RUNBOOK: §4 documents the production fail-closed env", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §4");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  assert.match(seg, /ORCHESTRATOR_REQUIRE_SIGNED_MANIFEST/);
  assert.match(seg, /ORCHESTRATOR_TRUST_STORE/);
});

test("TRUST-STORE-E2E-RUNBOOK: §4.6 covers the public-sector escape-hatch carve-out", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("### §4.6");
  const seg = text.slice(idx, text.indexOf("### §4.7", idx));
  assert.match(seg, /ORCHESTRATOR_DEPLOYMENT_PROFILE.*public-sector|public-sector.*ORCHESTRATOR_DEPLOYMENT_PROFILE/i);
  assert.match(seg, /ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST/);
  assert.match(seg, /IGNORED|ignored/);
  // The load-bearing safety property: dev escape never honored under public-sector
  assert.match(seg, /never honors|never.*honor|ignored/i);
});

// ── Phase 3 — tampering ──────────────────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §5 names the hash_mismatch reason code", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §5");
  const seg = text.slice(idx, text.indexOf("## §6", idx));
  assert.match(seg, /hash_mismatch/);
  assert.match(seg, /SHA256/);
  assert.match(seg, /exit 37/);
});

// ── §6 evidence collection ───────────────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §6 documents the eval-report template", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §6");
  const seg = text.slice(idx, text.indexOf("## §7", idx));
  // Eval report path
  assert.match(seg, /trust-store-e2e-eval\.md/);
  // Audit-extract step references the ledger
  assert.match(seg, /ledger\.jsonl/);
  // 3 audit verbs the closeout must observe
  assert.match(seg, /launcher_signature_verified/);
  assert.match(seg, /signature_missing/);
  assert.match(seg, /hash_mismatch/);
});

// ── §7 risks: 5 specific risks with mitigations ─────────────

test("TRUST-STORE-E2E-RUNBOOK: §7 risks table calls out the load-bearing risks", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx, text.indexOf("## §8", idx));
  // At least 5 markdown table rows
  const rows = (seg.match(/\|[^|\n]+\|[^|\n]+\|/g) || [])
    .filter((l) => !l.match(/^\|[\s-]+\|/));
  assert.ok(rows.length >= 6,
    `§7 must have at least 5 risk rows (header + 5+), got ${rows.length}`);
  // Specific load-bearing risks
  assert.match(seg, /[Pp]rivate key leakage/);
  assert.match(seg, /ORCHESTRATOR_REQUIRE_SIGNED_MANIFEST/);
  assert.match(seg, /ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST/);
  // Trust-store path resolver risk pointer
  assert.match(seg, /trust-store-path-precedence\.test\.js/);
  // TRUST-STORE-0 deferral pointer
  assert.match(seg, /TRUST-STORE-0/);
  assert.match(seg, /[Dd]eferred|deferral/);
});

// ── Cross-coherence ──────────────────────────────────────────

test("TRUST-STORE-E2E-RUNBOOK: §8 references all 4 production tools", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §8");
  const seg = text.slice(idx);
  for (const tool of [
    "sign-manifest\\.js",
    "launcher-cli\\.js",
    "install-version\\.ps1",
    "trust-store-path\\.js",
  ]) {
    assert.match(seg, new RegExp(tool),
      `§8 must reference ${tool.replace(/\\\./g, ".")}`);
  }
});

test("TRUST-STORE-E2E-RUNBOOK: links to v1-blockers.md", () => {
  assert.match(read(RUNBOOK), /v1-blockers\.md/);
});

test("TRUST-STORE-E2E-RUNBOOK: links to trust-store-path precedence test", () => {
  assert.match(read(RUNBOOK), /trust-store-path-precedence\.test\.js/);
});

// ── runbooks/README.md indexes the runbook ──────────────────

test("TRUST-STORE-E2E-RUNBOOK: runbooks/README.md §2 lists trust-store-e2e.md", () => {
  const text = read(RUNBOOKS_INDEX);
  const sec2 = text.slice(
    text.indexOf("## §2 Pre-deployment family"),
    text.indexOf("## §3", text.indexOf("## §2 Pre-deployment family"))
  );
  assert.match(sec2, /trust-store-e2e\.md/);
  // Audience tag — deployer + installation operator
  assert.match(sec2, /deployer/i);
});

// ── v1-blockers acceptance criteria updated ─────────────────

test("TRUST-STORE-E2E-RUNBOOK: v1-blockers §3.3 marks all 4 acceptance closed/deferred", () => {
  const text = read(V1_BLOCKERS);
  const idx = text.indexOf("### §3.3 Acceptance criteria");
  const seg = text.slice(idx, text.indexOf("### §3.4", idx));
  // Acceptance #1 → CLOSED (TRUST-STORE-E2E-RUNBOOK round)
  assert.match(seg, /1\..*CLOSED|CLOSED.*runbook walks Phases/i);
  // Acceptance #2 → CLOSED (TRUST-STORE-E2E-EVIDENCE round, this run)
  assert.match(seg, /2\..*CLOSED|CLOSED.*Committed report/i);
  // Acceptance #3 → CLOSED (TRUST-STORE-PATH-IT round)
  assert.match(seg, /3\..*CLOSED/i);
  // Acceptance #4 → DEFERRED
  assert.match(seg, /4\..*DEFERRED/i);
  // Pointer to trust-store-e2e.md (the runbook)
  assert.match(seg, /trust-store-e2e\.md/);
  // Pointer to the eval-report file (acceptance #2 evidence)
  assert.match(seg, /trust-store-e2e-eval\.md/);
  // 4 audit anchor verbs all listed
  assert.match(seg, /launcher_signature_verified/);
  assert.match(seg, /signature_missing/);
  assert.match(seg, /unknown_key_id/);
  assert.match(seg, /hash_mismatch/);
});

// ── scorecard backlog has the v1.0.0 deferral entry ─────────

test("TRUST-STORE-E2E-RUNBOOK: scorecard backlog has v1.0.0 final-readiness section", () => {
  const text = read(SCORECARD);
  // The new top-level backlog subsection
  assert.match(text, /v1\.0\.0 final-readiness backlog/);
  // TRUST-STORE-0 UI explicitly deferred
  assert.match(text, /TRUST-STORE-0 UI[\s\S]*?DEFERRED|DEFERRED[\s\S]*?TRUST-STORE-0 UI/i);
  // The 3 blockers named
  assert.match(text, /Blocker #1.*Real-binary/);
  assert.match(text, /Blocker #2.*Trust-store/);
  assert.match(text, /Blocker #3.*field-pilot/);
});

// ── Anti-claim guard (mirrors v1-blockers anti-claim guard) ─

// ── RUNBOOK-CD-FIX: working-directory preamble ──────────────

test("TRUST-STORE-E2E-RUNBOOK: documents the pipeline-dashboard working directory", () => {
  const text = read(RUNBOOK);
  assert.match(text, /작업 디렉토리|Working directory/i,
    "runbook must include the working-directory preamble");
  assert.match(text, /pipeline-dashboard/);
  assert.match(text, /cd .*pipeline-dashboard/);
});

test("TRUST-STORE-E2E-RUNBOOK: each major command block opens with `cd`", () => {
  const text = read(RUNBOOK);
  const blocks = text.match(/```powershell\n([\s\S]*?)```/g) || [];
  for (const blk of blocks) {
    const inner = blk.slice("```powershell\n".length, -3);
    if (/^npm |^node /m.test(inner)) {
      assert.match(inner, /^cd /m,
        "a ```powershell block running npm/node must open with `cd ...`:\n" +
        inner.split("\n").slice(0, 3).join(" / "));
    }
  }
});

test("TRUST-STORE-E2E-RUNBOOK: does not claim premature v1.0.0 readiness", () => {
  const text = read(RUNBOOK);
  // Operator verification is still required — the runbook is the
  // playbook, not the closure proof. A future edit that flips the
  // language without evidence is a regression.
  assert.doesNotMatch(text, /v1\.0\.0\s+(verified|ready|complete)/i,
    "runbook must not claim v1.0.0 readiness — that's the blocker");
});
