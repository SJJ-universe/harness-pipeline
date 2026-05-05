// Slice EXR-d-a (Phase 2 v2 follow-up, 2026-05-05) — structural
// tests for the reviewer-facing summary report template.
//
// Strategy mirrors external-review-matrix.test.js: structural tests
// only, not stylistic. The summary template is the artifact a
// reviewer fills at the end of a review cycle; if a future edit
// silently removes a section (e.g. "Privacy & retention statement"
// or "Per-category verdict aggregation"), the cap-movement gate
// loses one of its required inputs. These tests fail fast when
// that happens.
//
// Future edits to wording are expected; section deletions /
// renames are not.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TEMPLATE_PATH = path.resolve(
  __dirname, "..", "..",
  "docs", "external-review", "summary-template.md"
);

let _cache = null;
function readTemplate() {
  if (_cache !== null) return _cache;
  _cache = fs.readFileSync(TEMPLATE_PATH, "utf-8");
  return _cache;
}

// ── File-level invariants ─────────────────────────────────────────

test("EXR-d-a summary: file exists and is non-empty", () => {
  assert.ok(fs.existsSync(TEMPLATE_PATH), `${TEMPLATE_PATH} should exist`);
  const stat = fs.statSync(TEMPLATE_PATH);
  assert.ok(stat.size > 4000,
    `summary template should be at least 4000 bytes (got ${stat.size})`);
});

test("EXR-d-a summary: has H1 title", () => {
  const md = readTemplate();
  assert.match(md, /^# External Review — Summary Report/m);
});

test("EXR-d-a summary: tagged with slice EXR-d", () => {
  const md = readTemplate();
  assert.match(md, /Slice EXR-d \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

test("EXR-d-a summary: has 'How to use this template' block", () => {
  const md = readTemplate();
  assert.match(md, /## How to use this template/);
});

test("EXR-d-a summary: privacy reminder present", () => {
  const md = readTemplate();
  assert.match(md, /Privacy reminder/i);
  assert.match(md, /do not include real customer names/i);
});

// ── Pipeline cross-reference ──────────────────────────────────────

test("EXR-d-a summary: documents the EXR pipeline (a → b → d → cap)", () => {
  const md = readTemplate();
  // The intro shows the data flow diagram.
  assert.match(md, /EXR-a/, "references EXR-a (bundle JSON)");
  assert.match(md, /EXR-b/, "references EXR-b (matrix)");
  assert.match(md, /EXR-d/, "self-references EXR-d");
  assert.match(md, /cap-movement/i, "ties to cap-movement gate");
});

test("EXR-d-a summary: references both EXR-a bundle JSON + EXR-b matrix paths", () => {
  const md = readTemplate();
  assert.match(md, /external-review-bundle\.json/,
    "references the EXR-a bundle file");
  assert.match(md, /claim-evidence-matrix\.md/,
    "references the EXR-b matrix file");
});

test("EXR-d-a summary: cites EXR-c closeout as the deferred-gap source", () => {
  const md = readTemplate();
  // The template explains it closes a deferred item from EXR-c.
  assert.match(md, /EXR-c/, "references EXR-c (the round that deferred this)");
});

// ── Required sections ────────────────────────────────────────────

const REQUIRED_SECTIONS = [
  ["§0", "Header"],
  ["§1", "Verdict"],
  ["§2", "Sampling strategy"],
  ["§3", "Per-category verdict aggregation"],
  ["§4", "Findings"],
  ["§5", "Comparison against prior bundle"],
  ["§6", "Recommended cap movements"],
  ["§7", "Operator-actionable next steps"],
  ["§8", "Privacy & retention statement"],
];

for (const [num, name] of REQUIRED_SECTIONS) {
  test(`EXR-d-a summary: has ${num} section "${name}"`, () => {
    const md = readTemplate();
    const re = new RegExp(`## ${num} ${name.replace(/[&]/g, "\\&")}`);
    assert.match(md, re,
      `template must have ${num} ${name} section`);
  });
}

test("EXR-d-a summary: required vs optional sections marked with HTML comments", () => {
  const md = readTemplate();
  // §0, §1, §2, §3, §4 (conditional), §6 (conditional), §8 are required
  assert.match(md, /## §0 Header <!-- REQUIRED -->/);
  assert.match(md, /## §1 Verdict <!-- REQUIRED -->/);
  assert.match(md, /## §2 Sampling strategy <!-- REQUIRED -->/);
  assert.match(md, /## §3 Per-category verdict aggregation <!-- REQUIRED -->/);
  assert.match(md, /## §8 Privacy & retention statement <!-- REQUIRED -->/);
  // §5, §7 are optional
  assert.match(md, /## §5 Comparison against prior bundle <!-- OPTIONAL -->/);
  assert.match(md, /## §7 Operator-actionable next steps <!-- OPTIONAL -->/);
});

// ── Verdict tier semantics ──────────────────────────────────────

test("EXR-d-a summary: §1 documents 3 overall verdict tiers", () => {
  const md = readTemplate();
  for (const tier of ["PASS", "PASS-WITH-CONCERNS", "FAIL"]) {
    assert.match(md, new RegExp(`\`${tier}\``),
      `verdict tier ${tier} must be documented as backtick code`);
  }
  // Each tier has a semantic explanation
  assert.match(md, /\*\*`PASS`\*\*\s*—/,
    "PASS tier has explanation prefix");
  assert.match(md, /\*\*`PASS-WITH-CONCERNS`\*\*\s*—/);
  assert.match(md, /\*\*`FAIL`\*\*\s*—/);
});

test("EXR-d-a summary: §1 documents 3 cap-movement recommendation tiers", () => {
  const md = readTemplate();
  for (const tier of ["MOVE", "DEFER", "BLOCK"]) {
    assert.match(md, new RegExp(`\`${tier}\``),
      `cap-movement tier ${tier} must be documented`);
  }
  assert.match(md, /\*\*`MOVE`\*\*\s*—/);
  assert.match(md, /\*\*`DEFER`\*\*\s*—/);
  assert.match(md, /\*\*`BLOCK`\*\*\s*—/);
});

// ── Per-category aggregation (must list all 8 from EXR-b matrix) ─

test("EXR-d-a summary: §3 lists all 8 categories matching EXR-b matrix", () => {
  const md = readTemplate();
  for (let i = 1; i <= 8; i++) {
    const re = new RegExp(`### §3\\.${i}\\s+`);
    assert.match(md, re,
      `§3.${i} subsection must exist (one per EXR-b matrix category)`);
  }
});

test("EXR-d-a summary: §3 categories use the same names as EXR-b matrix", () => {
  const md = readTemplate();
  // Mirrors the EXR-b matrix category names (verified against
  // external-review-matrix.test.js's REQUIRED_CATEGORIES).
  const expected = [
    "Pipeline orchestration & dual-agent loop",
    "Multi-run isolation",
    "Long-running task survival",
    "Account / profile management & safe guidance",
    "Public-sector posture & GOV-\\* defenses",
    "Smart arc",
    "Field-pilot evidence collection",
    "External reviewer hand-off",
  ];
  for (const cat of expected) {
    const re = new RegExp(cat);
    assert.match(md, re,
      `category "${cat.replace(/\\\*/g, "*")}" must appear in §3`);
  }
});

test("EXR-d-a summary: §3 cap-relevance column lists priority caps", () => {
  const md = readTemplate();
  // Priority caps that EXR-d enables (per closeout aggregation):
  // public-sector readiness, testability, dual-agent integration
  assert.match(md, /Public-sector readiness/);
  assert.match(md, /Testability/);
  assert.match(md, /Dual-agent integration/);
  assert.match(md, /Error resilience/);
});

// ── Findings section ─────────────────────────────────────────────

test("EXR-d-a summary: §4 finding template covers severity + matrix row + remediation", () => {
  const md = readTemplate();
  // The findings section provides a fenced markdown template.
  const findingsBlock = md.slice(md.indexOf("## §4 Findings"));
  // Required fields in the finding template
  assert.match(findingsBlock, /Severity/);
  assert.match(findingsBlock, /critical \/ high \/ medium \/ low/,
    "4 severity tiers documented in finding template");
  assert.match(findingsBlock, /Matrix row\(s\)/);
  assert.match(findingsBlock, /Code anchor/);
  assert.match(findingsBlock, /What I observed/);
  assert.match(findingsBlock, /Recommended remediation/);
  assert.match(findingsBlock, /Blocks cap movement\?/);
  // PASS (no findings) explicit fallback statement
  assert.match(findingsBlock, /No findings\. All sampled rows verified\./);
});

// ── Cap-movement appendix ────────────────────────────────────────

test("EXR-d-a summary: appendix lists 3 priority cap movements with proof requirements", () => {
  const md = readTemplate();
  const appendixIdx = md.indexOf("## Appendix");
  assert.ok(appendixIdx > 0, "Appendix section exists");
  const appendix = md.slice(appendixIdx);
  // 3 priority caps documented in the appendix table
  assert.match(appendix, /Public-sector readiness \+1/,
    "Public-sector cap +1 row");
  assert.match(appendix, /Testability \+1/, "Testability cap +1 row");
  assert.match(appendix, /Safety \+1/, "Safety cap +1 row");
  // Each has cited round combination
  assert.match(appendix, /FIELD-PILOT-0/);
  assert.match(appendix, /EXTERNAL-REVIEW-0/);
  assert.match(appendix, /SMART-LV-0/);
});

test("EXR-d-a summary: appendix tells reviewer NOT to invent new cap definitions", () => {
  const md = readTemplate();
  const appendix = md.slice(md.indexOf("## Appendix"));
  assert.match(appendix, /DON'T invent new cap definitions/,
    "appendix explicit guidance: caps codified in scorecard.md");
  assert.match(appendix, /scorecard\.md/);
});

// ── Sampling strategy ───────────────────────────────────────────

test("EXR-d-a summary: §2 enumerates sampling strategy types", () => {
  const md = readTemplate();
  const samplingBlock = md.slice(md.indexOf("## §2"));
  for (const strategy of ["random", "focused", "risk-weighted", "time-boxed"]) {
    assert.match(samplingBlock, new RegExp(strategy),
      `sampling strategy "${strategy}" must be documented as a possible value`);
  }
  // Reviewer captures coverage stats
  assert.match(samplingBlock, /Total rows in matrix/);
  assert.match(samplingBlock, /Rows sampled/);
  assert.match(samplingBlock, /Coverage %/);
});

// ── Header captures bundle integrity ─────────────────────────────

test("EXR-d-a summary: §0 header captures bundle sha256 (tamper-detect)", () => {
  const md = readTemplate();
  const headerBlock = md.slice(md.indexOf("## §0"), md.indexOf("## §1"));
  assert.match(headerBlock, /Bundle sha256/,
    "header captures bundle sha256");
  assert.match(headerBlock, /recompute, don't trust the bundle's self-report/i,
    "header reminds reviewer to recompute (canary against bundle tampering)");
});

test("EXR-d-a summary: §0 header captures bundle verdict at capture", () => {
  const md = readTemplate();
  const headerBlock = md.slice(md.indexOf("## §0"), md.indexOf("## §1"));
  assert.match(headerBlock, /Bundle verdict at capture/);
  // Same 4 tiers as EXR-a bundle frozen schema
  assert.match(headerBlock, /`OK`/);
  assert.match(headerBlock, /`DEGRADED`/);
  assert.match(headerBlock, /`INCIDENT`/);
  assert.match(headerBlock, /`CONFIG`/);
});

// ── Privacy & retention checklist ────────────────────────────────

test("EXR-d-a summary: §8 privacy checklist has 4 distinct boxes", () => {
  const md = readTemplate();
  const privacyBlock = md.slice(md.indexOf("## §8"));
  // Markdown checklist boxes: "- [ ] No real..."
  const boxMatches = privacyBlock.match(/- \[ \] /g) || [];
  assert.ok(boxMatches.length >= 4,
    `expected ≥ 4 privacy checkboxes, got ${boxMatches.length}`);
  // 4 specific items
  assert.match(privacyBlock, /No real customer/);
  assert.match(privacyBlock, /No credential strings/);
  assert.match(privacyBlock, /abstract placeholders/);
  assert.match(privacyBlock, /No machine identifiers/);
  // Reviewer signature line
  assert.match(privacyBlock, /Reviewer signature/);
  // External-share toggle
  assert.match(privacyBlock, /shared externally\?/);
});

// ── Path discovery ──────────────────────────────────────────────

test("EXR-d-a summary: lives at the path discoverable by EXR-a bundle", () => {
  // The template must live in docs/external-review/, the same
  // directory as EXR-b matrix. This means the EXR-a bundle's
  // closeoutReports[] enumeration of *-eval.md doesn't pick it up
  // (good — it's a template, not a closeout), but the template is
  // discoverable next to the matrix.
  const dir = path.dirname(TEMPLATE_PATH);
  assert.equal(path.basename(dir), "external-review",
    "summary template lives in docs/external-review/");
  const matrixPath = path.join(dir, "claim-evidence-matrix.md");
  assert.ok(fs.existsSync(matrixPath),
    "EXR-b matrix must exist alongside the EXR-d template");
});

// ── Filenname hint for committed instances ──────────────────────

test("EXR-d-a summary: §How-to-use names the canonical instance path", () => {
  const md = readTemplate();
  // The instructions tell the reviewer to copy the template to a
  // dated path under docs/reports/.
  assert.match(md, /docs\/reports\/<YYYY-MM-DD>-external-review-summary\.md/,
    "canonical instance path documented for committers");
});
