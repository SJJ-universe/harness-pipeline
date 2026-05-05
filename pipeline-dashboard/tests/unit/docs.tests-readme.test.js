// Slice TESTS-LAYOUT-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for tests/README.md (the test-suite layout doc).
//
// Same pattern as docs.i18n-conventions.test.js / docs.readiness-rubric.test.js
// / docs.readme-index.test.js: structural-only, not stylistic.
// Tests fail fast when sections are renamed/deleted; future
// wording changes don't trigger them.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOC_PATH = path.resolve(
  __dirname, "..", "..", "tests", "README.md"
);

function read() {
  return fs.readFileSync(DOC_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("TESTS-LAYOUT-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(DOC_PATH));
  const stat = fs.statSync(DOC_PATH);
  assert.ok(stat.size > 4000,
    `expected ≥ 4000 bytes, got ${stat.size}`);
});

test("TESTS-LAYOUT-1: H1 title present", () => {
  assert.match(read(), /^# Test Suite Layout/m);
});

test("TESTS-LAYOUT-1: tagged with slice TESTS-LAYOUT-1", () => {
  assert.match(read(),
    /Slice TESTS-LAYOUT-1 \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "The four primary suites"],
  ["§2", "Where does my new test go"],
  ["§3", "The doc-test pattern"],
  ["§4", "The runner contract"],
  ["§5", "Speed budget per suite"],
  ["§6", "Stability expectations"],
  ["§7", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`TESTS-LAYOUT-1: ${num} section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(md, re, `${num} ${name} section must exist`);
  });
}

// ── Suite directories all referenced ──────────────────────────

const SUITE_DIRS = [
  "tests/unit/",
  "tests/integration/",
  "tests/smoke/",
  "tests/visual/",
];

for (const dir of SUITE_DIRS) {
  test(`TESTS-LAYOUT-1: suite directory "${dir}" referenced`, () => {
    const md = read();
    const escaped = dir.replace(/\//g, "\\/");
    assert.match(md, new RegExp(escaped),
      `${dir} must be referenced in tests/README.md`);
  });
}

test("TESTS-LAYOUT-1: legacy phase tests are referenced", () => {
  const md = read();
  // The three legacy files are kept in executor/ — the doc must explain.
  assert.match(md, /executor\/__phase/,
    "legacy phase test location must be documented");
});

// ── Decision tree contents (§2) ──────────────────────────────

test("TESTS-LAYOUT-1: §2 is a numbered decision tree with 5 branches", () => {
  const md = read();
  const idx = md.indexOf("## §2");
  const seg = md.slice(idx, md.indexOf("## §3", idx));
  // Five numbered list entries at the start of lines
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(seg, new RegExp(`^${n}\\.`, "m"),
      `§2 must include branch ${n}.`);
  }
});

// ── Doc-test pattern table (§3) ──────────────────────────────

const DOC_TEST_PAIRS = [
  ["i18n-conventions.md", "docs.i18n-conventions.test.js"],
  ["readiness-rubric.md", "docs.readiness-rubric.test.js"],
  ["docs/README.md", "docs.readme-index.test.js"],
  ["tests/README.md", "docs.tests-readme.test.js"],
];

for (const [doc, testFile] of DOC_TEST_PAIRS) {
  test(`TESTS-LAYOUT-1: §3 pairs ${doc} with ${testFile}`, () => {
    const md = read();
    const idx = md.indexOf("## §3 The doc-test pattern");
    const seg = md.slice(idx, md.indexOf("## §4", idx));
    assert.match(seg, new RegExp(doc.replace(/[./]/g, "\\$&")),
      `§3 must list ${doc}`);
    assert.match(seg, new RegExp(testFile.replace(/[./]/g, "\\$&")),
      `§3 must list ${testFile}`);
  });
}

// ── Speed budget (§5) ────────────────────────────────────────

test("TESTS-LAYOUT-1: §5 documents soft + hard targets per suite", () => {
  const md = read();
  const idx = md.indexOf("## §5 Speed budget per suite");
  const seg = md.slice(idx, md.indexOf("## §6", idx));
  // The four primary suites listed by name in the budget table
  for (const suite of ["unit", "integration", "legacy", "smoke"]) {
    assert.match(seg, new RegExp(`\\b${suite}\\b`, "i"),
      `§5 must include ${suite} in the budget table`);
  }
  // A total row exists
  assert.match(seg, /total/i,
    "§5 must include the total-budget row");
});

// ── Stability expectations (§6) ──────────────────────────────

test("TESTS-LAYOUT-1: §6 lists 3+ flakiness causes", () => {
  const md = read();
  const idx = md.indexOf("## §6 Stability expectations");
  const seg = md.slice(idx, md.indexOf("## §7", idx));
  // 3 named flakiness causes
  assert.match(seg, /[Tt]iming/, "§6 must call out timing assumptions");
  assert.match(seg, /port/i, "§6 must call out port contention");
  assert.match(seg, /[Ff]ilesystem/, "§6 must call out filesystem residue");
});

// ── Cross-references ─────────────────────────────────────────

test("TESTS-LAYOUT-1: links back to project-root README", () => {
  assert.match(read(), /\.\.\/README\.md/);
});

test("TESTS-LAYOUT-1: links to docs/README.md", () => {
  assert.match(read(), /\.\.\/docs\/README\.md/);
});

test("TESTS-LAYOUT-1: links to readiness-rubric.md", () => {
  assert.match(read(),
    /\.\.\/docs\/readiness-rubric\.md/);
});

test("TESTS-LAYOUT-1: references run-tests.js runner", () => {
  assert.match(read(), /run-tests\.js/);
});

// ── Run-tests.js runner described (§4) ───────────────────────

test("TESTS-LAYOUT-1: §4 documents the run-tests.js contract", () => {
  const md = read();
  const idx = md.indexOf("## §4 The runner contract");
  const seg = md.slice(idx, md.indexOf("## §5", idx));
  // node:test mentioned as the assertion framework
  assert.match(seg, /node:test/,
    "§4 must name node:test as the assertion framework");
  // The "what it does NOT do" carve-out
  assert.match(seg, /(does NOT|doesn't|does not)/,
    "§4 must include the explicit no-frameworks carve-out");
});
