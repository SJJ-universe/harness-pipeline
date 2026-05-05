// Slice V1-BLOCKERS-RUNBOOK (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/runbooks/v1-blockers.md.
//
// Same pattern as the other docs.* tests: structural-only, not
// stylistic. Tests fail fast when sections are renamed/deleted;
// future wording changes don't trigger them.
//
// This runbook captures the three v1.0.0 final-readiness blockers
// in priority order. Each blocker has a fixed shape (Why / What /
// When / Where / Risks). The tests anchor that shape so future
// edits can't accidentally drop one of the load-bearing pieces.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNBOOK = path.resolve(REPO_ROOT, "docs", "runbooks", "v1-blockers.md");
const RUNBOOKS_INDEX = path.resolve(REPO_ROOT, "docs", "runbooks", "README.md");

function read(p) { return fs.readFileSync(p, "utf-8"); }

// ── File-level invariants ─────────────────────────────────────

test("V1-BLOCKERS-RUNBOOK: file exists + non-empty", () => {
  assert.ok(fs.existsSync(RUNBOOK));
  const s = fs.statSync(RUNBOOK);
  assert.ok(s.size > 5000,
    `expected ≥ 5000 bytes, got ${s.size}`);
});

test("V1-BLOCKERS-RUNBOOK: H1 + slice tag present", () => {
  const text = read(RUNBOOK);
  assert.match(text, /^# Runbook — v1\.0\.0 Final-Readiness Blockers/m);
  assert.match(text, /Slice V1-BLOCKERS-RUNBOOK \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Top-level sections (priority-ordered blocker structure) ──

const SECTIONS = [
  ["§1", "Why this runbook exists"],
  ["§2", "Blocker #1 — Real-binary live verification"],
  ["§3", "Blocker #2 — Trust-store + signed-manifest end-to-end"],
  ["§4", "Blocker #3 — 1-week field-pilot evidence"],
  ["§5", "Aggregation"],
  ["§6", "Cap-movement policy"],
  ["§7", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`V1-BLOCKERS-RUNBOOK: ${num} section "${name}" present`, () => {
    const text = read(RUNBOOK);
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`);
    assert.match(text, re,
      `${num} ${name} must exist`);
  });
}

// ── Each blocker has the canonical 5-piece shape ────────────

const BLOCKER_SHAPE_TESTS = [
  { num: "2", title: "Real-binary live verification" },
  { num: "3", title: "Trust-store + signed-manifest end-to-end" },
  { num: "4", title: "1-week field-pilot evidence" },
];

for (const { num, title } of BLOCKER_SHAPE_TESTS) {
  test(`V1-BLOCKERS-RUNBOOK: blocker §${num} (${title}) has canonical 5-piece shape`, () => {
    const text = read(RUNBOOK);
    const idx = text.indexOf(`## §${num}`);
    const nextIdx = text.indexOf(`## §${parseInt(num, 10) + 1}`, idx);
    const seg = text.slice(idx, nextIdx === -1 ? undefined : nextIdx);
    // Each blocker has subsections §N.1 Why / §N.2 What / §N.3 When (Acceptance) / §N.4 Where / §N.5 Risks
    for (const sub of [".1", ".2", ".3", ".4", ".5"]) {
      assert.match(seg, new RegExp(`### §${num}\\${sub}`),
        `Blocker §${num} must include §${num}${sub}`);
    }
    // Each blocker carries Status + Priority labels at the top
    assert.match(seg, /\*\*Status\*\*/,
      `Blocker §${num} must have a **Status** line`);
    assert.match(seg, /\*\*Priority\*\*/,
      `Blocker §${num} must have a **Priority** line`);
  });
}

// ── Blocker priority ordering (not arbitrary) ───────────────

test("V1-BLOCKERS-RUNBOOK: priority ordering matches the recommended sequence", () => {
  const text = read(RUNBOOK);
  // Real-binary live verification must be first; field-pilot last.
  const idxLive = text.indexOf("Blocker #1 — Real-binary live verification");
  const idxTrust = text.indexOf("Blocker #2 — Trust-store + signed-manifest");
  const idxField = text.indexOf("Blocker #3 — 1-week field-pilot");
  assert.ok(idxLive > 0, "Blocker #1 heading must exist");
  assert.ok(idxTrust > idxLive, "Blocker #2 must come after Blocker #1");
  assert.ok(idxField > idxTrust, "Blocker #3 must come after Blocker #2");
});

// ── Blocker #1 specifics (real-binary live verification) ────

test("V1-BLOCKERS-RUNBOOK: §2 names both probe scripts", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §2");
  const seg = text.slice(idx, text.indexOf("## §3", idx));
  assert.match(seg, /live-verify-smart-arc\.js/);
  assert.match(seg, /live-verify-review-relay\.js/);
});

test("V1-BLOCKERS-RUNBOOK: §2 acceptance demands real-binary spawn (not stubs)", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("### §2.3");
  const seg = text.slice(idx, text.indexOf("### §2.4", idx));
  // Use [\s\S]*? so the regex works across markdown's hard-wrap.
  assert.match(seg, /real[\s\S]*?Claude[\s\S]*?Codex[\s\S]*?binar|real[\s\S]*?binar[\s\S]*?Claude[\s\S]*?Codex/i,
    "§2.3 must explicitly require real-binary spawn (not test stubs)");
  // Anti-stub language must be present somewhere in §2.3.
  assert.match(seg, /not test stubs|not stubs|real.*binar/i,
    "§2.3 must call out the no-stubs requirement");
  assert.match(seg, /pid|child-process/,
    "§2.3 must reference child-process spawn evidence");
});

// ── Blocker #2 specifics (trust-store + signed manifest) ────

test("V1-BLOCKERS-RUNBOOK: §3 names sign-manifest.js + install-version.ps1", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §3");
  const seg = text.slice(idx, text.indexOf("## §4", idx));
  assert.match(seg, /sign-manifest\.js/);
  assert.match(seg, /install-version\.ps1/);
});

test("V1-BLOCKERS-RUNBOOK: §3 acceptance lists 3 audit-chain anchors", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("### §3.3");
  const seg = text.slice(idx, text.indexOf("### §3.4", idx));
  assert.match(seg, /launcher_signature_verified/);
  assert.match(seg, /launcher_signature_failed/);
  assert.match(seg, /hash_mismatch/);
});

// ── Blocker #3 specifics (field-pilot) ──────────────────────

test("V1-BLOCKERS-RUNBOOK: §4 names the 4 field-pilot runbooks", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §4");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  for (const name of [
    "field-pilot-deployment-log",
    "field-pilot-troubleshooting",
    "field-pilot-incident-ledger",
    "field-pilot-feedback-survey",
  ]) {
    assert.match(seg, new RegExp(name.replace(/-/g, "\\-")),
      `§4 must reference ${name}.md`);
  }
});

test("V1-BLOCKERS-RUNBOOK: §4 acceptance demands 7-day evidence + closeout report", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("### §4.3");
  const seg = text.slice(idx, text.indexOf("### §4.4", idx));
  assert.match(seg, /Day 0 through Day 7|7 daily entries/i);
  assert.match(seg, /field-pilot-eval\.md/);
});

// ── Cap-movement policy ─────────────────────────────────────

test("V1-BLOCKERS-RUNBOOK: §6 explicitly states no cap movement until all 3 close", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §6");
  const seg = text.slice(idx, text.indexOf("## §7", idx));
  assert.match(seg, /120\/126/);
  assert.match(seg, /121\/127/);
  assert.match(seg, /(end-to-end|all three|all 3)/i,
    "§6 must condition cap movement on all-three-blocker closure");
});

// ── Cross-references ────────────────────────────────────────

test("V1-BLOCKERS-RUNBOOK: §7 links to scorecard + readiness-rubric", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx);
  assert.match(seg, /scorecard\.md/);
  assert.match(seg, /readiness-rubric\.md/);
});

test("V1-BLOCKERS-RUNBOOK: §7 links to all 4 field-pilot runbooks", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx);
  assert.match(seg, /field-pilot-deployment-log\.md/);
});

test("V1-BLOCKERS-RUNBOOK: §7 cross-links sibling runbooks", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §7");
  const seg = text.slice(idx);
  assert.match(seg, /first-time-use\.md/);
  assert.match(seg, /deployment-readiness\.md/);
});

// ── Index registration ──────────────────────────────────────

test("V1-BLOCKERS-RUNBOOK: runbooks/README.md §2 lists v1-blockers.md", () => {
  const text = read(RUNBOOKS_INDEX);
  const sec2 = text.slice(
    text.indexOf("## §2 Pre-deployment family"),
    text.indexOf("## §3", text.indexOf("## §2 Pre-deployment family"))
  );
  assert.match(sec2, /v1-blockers\.md/,
    "§2 must list v1-blockers.md");
  // The audience tag should call out release-lead/operator
  assert.match(sec2, /release-lead|release lead/i,
    "v1-blockers row must tag release-lead audience");
});

// ── Anti-claim guard ────────────────────────────────────────

test("V1-BLOCKERS-RUNBOOK: does not claim premature v1.0.0 readiness", () => {
  const text = read(RUNBOOK);
  // The runbook MUST clearly state these are open blockers, not
  // closed ones. A future edit that flips this without evidence
  // is a regression we want to catch.
  assert.match(text, /Open\.\s*(Tooling|UI work|Operator)/,
    "blocker statuses must remain Open at runbook write-time");
  // No "PASS" or "v1.0.0 verified" claims before the evidence lands.
  assert.doesNotMatch(text, /v1\.0\.0\s+(verified|ready|complete)/i,
    "runbook must not claim v1.0.0 readiness — that's the blocker");
});
