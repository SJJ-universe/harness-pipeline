// Slice READINESS-DOC-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/readiness-rubric.md.
//
// Same pattern as docs.i18n-conventions.test.js: structural-only,
// not stylistic. Tests fail fast when sections are renamed/deleted;
// future wording changes don't trigger them.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOC_PATH = path.resolve(
  __dirname, "..", "..", "docs", "readiness-rubric.md"
);

function read() {
  return fs.readFileSync(DOC_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("READINESS-DOC-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(DOC_PATH));
  const stat = fs.statSync(DOC_PATH);
  assert.ok(stat.size > 7000,
    `expected ≥ 7000 bytes, got ${stat.size}`);
});

test("READINESS-DOC-1: H1 title present", () => {
  assert.match(read(), /^# Harness Readiness Rubric/m);
});

test("READINESS-DOC-1: tagged with slice READINESS-DOC-1", () => {
  assert.match(read(),
    /Slice READINESS-DOC-1 — per-category narrative/);
});

test("READINESS-DOC-1: original MB5 slice tag still present", () => {
  // We must not blow away the historical metadata.
  assert.match(read(),
    /Initial draft \(Slice MB5 of Phase D Round 2\)/);
});

// ── Top-level sections ────────────────────────────────────────

const TOP_SECTIONS = [
  ["1", "Why this exists"],
  ["2", "The six readiness categories"],
  ["3", "Current readiness"],
  ["4", "How readiness checks run"],
  ["5", "Out of scope"],
  ["6", "Sources"],
  ["7", "Operator workflow"],
];

for (const [num, name] of TOP_SECTIONS) {
  test(`READINESS-DOC-1: §${num} top-level section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num}\\. ${name}`);
    assert.match(md, re,
      `## ${num}. ${name} section must exist`);
  });
}

// ── Six rubric categories (§2.1 - §2.6) ──────────────────────

const CATEGORIES = [
  ["2.1", "Run visibility"],
  ["2.2", "Child visibility"],
  ["2.3", "Replay visibility"],
  ["2.4", "Event integrity"],
  ["2.5", "Contract stability"],
  ["2.6", "Remote isolation"],
];

for (const [num, name] of CATEGORIES) {
  test(`READINESS-DOC-1: §${num} category "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`### ${num} ${name}`);
    assert.match(md, re,
      `### ${num} ${name} subsection must exist`);
  });
}

// ── Per-category narrative pieces ────────────────────────────

// Each of §2.1 - §2.6 must include both:
//   - "**Question**:" line (existed before READINESS-DOC-1)
//   - "**Why it matters**:" line (added in READINESS-DOC-1)
//   - "**Star progression**:" line (added in READINESS-DOC-1)

function categorySegment(md, num) {
  const start = md.indexOf(`### ${num} `);
  if (start < 0) {
    throw new Error(`category ${num} not found`);
  }
  // next subsection or end-of-§2 is the boundary
  const fromHere = md.slice(start);
  const nextSub = fromHere.slice(1).search(/\n### \d/);
  const nextTop = fromHere.search(/\n## \d/);
  const candidates = [nextSub === -1 ? Infinity : nextSub + 1,
                       nextTop === -1 ? Infinity : nextTop];
  const end = Math.min(...candidates);
  return fromHere.slice(0, end === Infinity ? undefined : end);
}

for (const [num, name] of CATEGORIES) {
  test(`READINESS-DOC-1: §${num} ${name} has Question + Why it matters + Star progression`, () => {
    const md = read();
    const seg = categorySegment(md, num);
    assert.match(seg, /\*\*Question\*\*:/,
      `§${num} must include **Question**:`);
    assert.match(seg, /\*\*Why it matters\*\*:/,
      `§${num} must include **Why it matters**:`);
    assert.match(seg, /\*\*Star progression\*\*:/,
      `§${num} must include **Star progression**:`);
  });

  test(`READINESS-DOC-1: §${num} ${name} preserves the 3-row star table`, () => {
    const md = read();
    const seg = categorySegment(md, num);
    // Star table headers
    assert.match(seg, /\| Stars \| Criterion \|/,
      `§${num} must keep the Stars/Criterion table header`);
    // 3 star rows: ★, ★★, ★★★
    assert.match(seg, /\| ★ \|/,
      `§${num} must keep the ★ (1-star) row`);
    assert.match(seg, /\| ★★ \|/,
      `§${num} must keep the ★★ (2-star) row`);
    assert.match(seg, /\| ★★★ \|/,
      `§${num} must keep the ★★★ (3-star) row`);
  });
}

// ── §7 Operator workflow sub-sections ────────────────────────

test("READINESS-DOC-1: §7.1 Pre-deployment gate present", () => {
  assert.match(read(), /### 7\.1 Pre-deployment gate/);
});

test("READINESS-DOC-1: §7.2 Regression diagnostics present", () => {
  assert.match(read(), /### 7\.2 Regression diagnostics/);
});

test("READINESS-DOC-1: §7.3 Onboarding orientation present", () => {
  assert.match(read(), /### 7\.3 Onboarding orientation/);
});

test("READINESS-DOC-1: §7.1 documents the four exit-code tiers", () => {
  const md = read();
  const idx = md.indexOf("### 7.1 Pre-deployment gate");
  const segment = md.slice(idx, md.indexOf("### 7.2"));
  // 0 / 1 / 2 / 3 exit codes referenced
  assert.match(segment, /`0`/, "exit 0 referenced");
  assert.match(segment, /`1`/, "exit 1 referenced");
  assert.match(segment, /`2`/, "exit 2 referenced");
  assert.match(segment, /`3`/, "exit 3 referenced");
  // Star totals referenced
  assert.match(segment, /17/, "≥ 17 threshold referenced");
  assert.match(segment, /12/, "≥ 12 threshold referenced");
});

// ── Auto-marker preservation (sync-scorecard.js dependency) ──

test("READINESS-DOC-1: AUTO:test-counts marker preserved", () => {
  assert.match(read(), /<!-- AUTO:test-counts -->/);
  assert.match(read(), /<!-- \/AUTO -->/);
});

test("READINESS-DOC-1: AUTO:readiness-total marker preserved", () => {
  assert.match(read(), /<!-- AUTO:readiness-total -->/);
});

test("READINESS-DOC-1: AUTO:readiness-stars marker preserved", () => {
  assert.match(read(), /<!-- AUTO:readiness-stars -->/);
});

// ── Cross-references ────────────────────────────────────────

test("READINESS-DOC-1: references readiness-report.js script", () => {
  assert.match(read(), /readiness-report\.js/);
});

test("READINESS-DOC-1: references sync-scorecard.js script", () => {
  assert.match(read(), /(scorecard:sync|sync-scorecard\.js)/);
});

test("READINESS-DOC-1: references claim-evidence-matrix from §7.2", () => {
  const md = read();
  const idx = md.indexOf("### 7.2 Regression diagnostics");
  const segment = md.slice(idx, md.indexOf("### 7.3"));
  assert.match(segment, /claim-evidence-matrix\.md/,
    "§7.2 must point operators at the claim-evidence matrix");
});
