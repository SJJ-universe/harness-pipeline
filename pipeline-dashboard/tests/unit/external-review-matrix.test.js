// Slice EXR-b (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05) — structural
// tests for the claim/evidence matrix template.
//
// Strategy mirrors field-pilot-runbooks.test.js: structural tests only,
// not stylistic. The goal is "does the matrix still have the sections
// the reviewer needs to walk?" — not "is the prose perfect?". Future
// edits to wording are expected; section deletions or renames are not.
//
// The matrix is the bridge between what the orchestrator CLAIMS and what
// we BUILT + how it's VERIFIED. Reviewers walk it row-by-row; if a
// section disappears, sampling is incomplete. These tests exist to
// fail fast when that happens.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MATRIX_PATH = path.resolve(
  __dirname, "..", "..",
  "docs", "external-review", "claim-evidence-matrix.md"
);

function readMatrix() {
  return fs.readFileSync(MATRIX_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────────

test("EXR-b matrix: file exists and is non-empty", () => {
  assert.ok(fs.existsSync(MATRIX_PATH), `${MATRIX_PATH} should exist`);
  const stat = fs.statSync(MATRIX_PATH);
  assert.ok(stat.size > 4000,
    `matrix should be at least 4000 bytes (got ${stat.size})`);
});

test("EXR-b matrix: has H1 title", () => {
  const md = readMatrix();
  assert.match(md, /^# External Review — Claim \/ Evidence Matrix/m);
});

test("EXR-b matrix: tagged with slice EXR-b", () => {
  const md = readMatrix();
  assert.match(md, /Slice EXR-b \(Phase 2 \/ EXTERNAL-REVIEW-0, 2026-05-05\)/);
});

test("EXR-b matrix: has 'How to use this template' block", () => {
  const md = readMatrix();
  assert.match(md, /## How to use this template/);
});

test("EXR-b matrix: has Privacy & retention section", () => {
  const md = readMatrix();
  assert.match(md, /## Privacy & retention/);
  assert.match(md, /Do \*\*not\*\* include/);
});

test("EXR-b matrix: cross-references the EXR-a bundle script", () => {
  const md = readMatrix();
  assert.match(md, /external-review-bundle\.js/,
    "should reference scripts/external-review-bundle.js");
  assert.match(md, /orchestrator-external-review-bundle\/v1/,
    "should reference the bundle frozen schema");
});

test("EXR-b matrix: includes entry template with 8-column row", () => {
  const md = readMatrix();
  assert.match(md, /## Entry template/);
  // The template fence should show the markdown table row pattern.
  assert.match(md, /\| N\.M \|/, "template includes N.M placeholder");
  assert.match(md, /Reviewer verdict/, "template uses Reviewer verdict column");
});

test("EXR-b matrix: includes 'How to use this matrix during a review' guidance", () => {
  const md = readMatrix();
  assert.match(md, /## How to use this matrix during a review/);
  assert.match(md, /sampling strategy/i,
    "should call out sampling strategy");
  assert.match(md, /verify-auditor-bundle\.js/,
    "should mention verify-auditor-bundle.js for chain spot-checks");
});

// ── Claim category section presence ───────────────────────────────

const REQUIRED_CATEGORIES = [
  "Pipeline orchestration & dual-agent loop",
  "Multi-run isolation",
  "Long-running task survival",
  "Account / profile management & safe guidance",
  "Public-sector posture & GOV-\\* defenses",
  "Smart arc",
  "Field-pilot evidence collection",
  "External reviewer hand-off",
];

for (const [i, cat] of REQUIRED_CATEGORIES.entries()) {
  test(`EXR-b matrix: category ${i + 1} (${cat.replace(/\\\*/g, "*")}) section present`, () => {
    const md = readMatrix();
    const re = new RegExp(`### Category ${i + 1} — ${cat}`);
    assert.match(md, re,
      `category ${i + 1} section "${cat}" should be present as ### header`);
  });
}

test("EXR-b matrix: claim category overview table lists all 8 categories", () => {
  const md = readMatrix();
  // The overview block lives after "## Claim categories (8)" header.
  const idx = md.indexOf("## Claim categories (8)");
  assert.ok(idx >= 0, "overview header present");
  const overview = md.slice(idx, idx + 3000);
  // Should reference all 8 by name.
  assert.match(overview, /Pipeline orchestration/);
  assert.match(overview, /Multi-run isolation/);
  assert.match(overview, /Long-running task survival/);
  assert.match(overview, /Account \/ profile/);
  assert.match(overview, /Public-sector posture/);
  assert.match(overview, /Smart arc/);
  assert.match(overview, /Field-pilot evidence/);
  assert.match(overview, /External reviewer hand-off/);
});

// ── Per-category content invariants ───────────────────────────────

test("EXR-b matrix: Category 1 references the dual-agent loop + LV evidence row", () => {
  const md = readMatrix();
  // Should mention review_session_dispatch_started + 3045ms LV anchor.
  assert.match(md, /review_session_dispatch_started/);
  assert.match(md, /3045ms/, "should anchor against the live evidence ms timing");
});

test("EXR-b matrix: Category 2 references multi-run-isolation + Phase 2.5 (Y/Z)", () => {
  const md = readMatrix();
  assert.match(md, /multi-run-isolation/);
  assert.match(md, /Phase 2\.5/);
  // Both Y and Z slice should be referenced.
  assert.match(md, /\(Y\/Z\)/);
});

test("EXR-b matrix: Category 3 references RR0 long-running test + watchdog audit verbs", () => {
  const md = readMatrix();
  assert.match(md, /release-readiness-long-run\.test\.js/);
  assert.match(md, /codex_killed_for_idle/);
  assert.match(md, /codex_idle_warning/);
});

test("EXR-b matrix: Category 4 includes the safe-guidance principle (no credential collection)", () => {
  const md = readMatrix();
  assert.match(md, /never accepts user passwords/i);
  assert.match(md, /firstRunClassifier/);
  assert.match(md, /credential_plaintext_fallback/);
  assert.match(md, /profile_switch_blocked/);
});

test("EXR-b matrix: Category 5 covers all 5 GOV defenses (SB / PII inline / PII file / AUDIT / RELEASE)", () => {
  const md = readMatrix();
  // Each of the 5 GOV-* slices should have at least one row.
  for (const verb of [
    "local_executor_blocked",
    "pii_scan_blocked",
    "pii_file_scan_blocked",
    "audit_bundle_exported",
    "release_manifest_signed",
  ]) {
    assert.match(md, new RegExp(`\`${verb}\``),
      `Category 5 should reference verb \`${verb}\``);
  }
  // Launcher signature gate exit code.
  assert.match(md, /exit 37/, "should reference launcher exit code 37");
});

test("EXR-b matrix: Category 6 covers all 6 SMART arc properties (P3..P6 + POL-a/b)", () => {
  const md = readMatrix();
  // P3 single-emit
  assert.match(md, /policy_gate_blocked/);
  // P4 PII redaction
  assert.match(md, /run_memory_recorded/);
  assert.match(md, /sourceHash/);
  // P5 decisionContext
  assert.match(md, /decisionContext/);
  // P6 preset
  assert.match(md, /presetId/);
  assert.match(md, /\[Preset:/, "should reference [Preset: <Label>] header");
  // POL-a auto-apply
  assert.match(md, /finance-high-privacy/);
  assert.match(md, /hardGatesDefault/);
  // POL-b catalog
  assert.match(md, /\/api\/policy-packs/);
  // SMART-LV-0 probe
  assert.match(md, /live-verify-smart-arc\.js/);
});

test("EXR-b matrix: Category 7 covers FP-a probe + 4 runbook templates + canary", () => {
  const md = readMatrix();
  assert.match(md, /field-pilot-status\.js/);
  assert.match(md, /orchestrator-field-pilot-status\/v1/);
  assert.match(md, /KNOWN_AUDIT_VERBS/);
  assert.match(md, /unknownVerbs/);
  assert.match(md, /field-pilot-runbooks\.test\.js/);
});

test("EXR-b matrix: Category 8 self-references EXR-a/b/c", () => {
  const md = readMatrix();
  assert.match(md, /external-review-bundle\.js/);
  assert.match(md, /external-review-bundle\.test\.js/);
  assert.match(md, /external-review-matrix\.test\.js/);
  // EXR-c closeout cross-link.
  assert.match(md, /external-review-0-eval\.md/);
});

// ── Markdown table integrity ──────────────────────────────────────

// Each Category section should contain at least one markdown table row
// (lines starting with "| <number>.<number> |").
for (const i of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`EXR-b matrix: Category ${i} contains at least one numbered claim row`, () => {
    const md = readMatrix();
    const reHeader = new RegExp(`### Category ${i} — `);
    const headerMatch = reHeader.exec(md);
    assert.ok(headerMatch, `Category ${i} header must exist`);
    // Slice from this header to next ### header (or end of file).
    const tail = md.slice(headerMatch.index);
    const nextHeaderIdx = tail.search(/\n### Category \d /);
    const segment = nextHeaderIdx > 0 ? tail.slice(0, nextHeaderIdx) : tail;
    // Look for a markdown row with a row number like "| 1.1 |", "| 2.3 |", etc.
    const rowRe = new RegExp(`\\|\\s*${i}\\.\\d+\\s*\\|`);
    assert.match(segment, rowRe,
      `Category ${i} should have at least one numbered claim row (e.g. | ${i}.1 |)`);
  });
}

// ── Cross-coherence with the bundle script ────────────────────────

test("EXR-b matrix: lives at the path the EXR-a bundle would discover", () => {
  // The matrix is in docs/external-review/, which the bundle treats
  // as its output dir for daily runs. The matrix is NOT a daily file
  // (no -external-review-bundle.json suffix) so it won't be picked up
  // as an artifact, but the directory must exist for the bundle's
  // default --output-dir.
  const dir = path.dirname(MATRIX_PATH);
  assert.ok(fs.existsSync(dir),
    "docs/external-review/ should exist for bundle output");
  assert.ok(MATRIX_PATH.endsWith("claim-evidence-matrix.md"),
    "matrix file name should be canonical");
});

test("EXR-b matrix: round-of-record column lists all 5 priority round groups", () => {
  const md = readMatrix();
  // The category overview table.
  for (const round of [
    "RELEASE-READY-0",
    "SMART-LV-0",
    "POLICY-UX-0",
    "FIELD-PILOT-0",
    "EXTERNAL-REVIEW-0",
  ]) {
    assert.match(md, new RegExp(round),
      `overview should mention round of record ${round}`);
  }
});

test("EXR-b matrix: overview lists all required cap-movement targets", () => {
  const md = readMatrix();
  for (const target of [
    "Dual-agent integration",
    "Pipeline orchestration",
    "Error resilience",
    "Public-sector readiness",
  ]) {
    assert.match(md, new RegExp(target),
      `overview should mention cap target "${target}"`);
  }
});

// EXR-d-a (Phase 2 v2 follow-up, 2026-05-05) — the matrix's
// "Write the summary report" step now links to the EXR-d template.
test("EXR-b matrix: 'Write the summary report' step links to EXR-d template", () => {
  const md = readMatrix();
  // The link path
  assert.match(md, /docs\/external-review\/summary-template\.md/,
    "matrix points reviewers at the EXR-d summary template");
  // The canonical committed instance path
  assert.match(md, /docs\/reports\/<YYYY-MM-DD>-external-review-summary\.md/,
    "matrix shows the committed instance naming convention");
  // The required-sections list (so reviewers don't skip the 5
  // required). Markdown line-wraps after "Sampling", so use \s+ for
  // any internal whitespace rather than a literal space.
  assert.match(md,
    /§0 Header[\s\S]+?§1 Verdict[\s\S]+?§2 Sampling\s+strategy[\s\S]+?§3[\s\S]+?§8 Privacy/,
    "matrix lists the 5 EXR-d required sections inline (canary against drift)");
});
