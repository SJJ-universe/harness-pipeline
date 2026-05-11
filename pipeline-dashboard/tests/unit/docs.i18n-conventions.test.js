// Slice I18N-DOC-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/i18n-conventions.md.
//
// Same pattern as other doc-template tests (FP-b runbooks,
// EXR-b matrix, EXR-d summary): structural-only, not stylistic.
// Tests fail fast when sections are renamed/deleted; future
// wording changes don't trigger them.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOC_PATH = path.resolve(
  __dirname, "..", "..", "docs", "i18n-conventions.md"
);

function read() {
  return fs.readFileSync(DOC_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("I18N-DOC-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(DOC_PATH));
  const stat = fs.statSync(DOC_PATH);
  assert.ok(stat.size > 3000,
    `expected ≥ 3000 bytes, got ${stat.size}`);
});

test("I18N-DOC-1: H1 title present", () => {
  assert.match(read(), /^# Harness i18n conventions/m);
});

test("I18N-DOC-1: tagged with slice I18N-DOC-1", () => {
  assert.match(read(), /Slice I18N-DOC-1 \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Key naming"],
  ["§2", "Adding a new key"],
  ["§3", "Placeholders"],
  ["§4", "Translation quality"],
  ["§5", "Sanity thresholds"],
  ["§6", "Test runner workflow"],
  ["§7", "Adding new locales"],
  ["§8", "Common pitfalls"],
  ["§9", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`I18N-DOC-1: ${num} section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num} ${name}`);
    assert.match(md, re, `${num} ${name} section must exist`);
  });
}

// ── Cross-references to test files ───────────────────────────

test("I18N-DOC-1: references all 3 i18n test files", () => {
  const md = read();
  for (const tf of [
    "i18n.coverage.test.js",
    "i18n.placeholder-parity.test.js",
    "i18n.translation-quality.test.js",
  ]) {
    assert.match(md, new RegExp(tf.replace(/\./g, "\\.")),
      `must reference ${tf}`);
  }
});

test("I18N-DOC-1: references runtime OrchestratorI18n.t", () => {
  assert.match(read(), /OrchestratorI18n\.t/);
});

test("I18N-DOC-1: references both i18n locale files", () => {
  const md = read();
  assert.match(md, /public\/js\/i18n\/ko\.js/);
  assert.match(md, /public\/js\/i18n\/en\.js/);
});

// ── Key contract content ─────────────────────────────────────

test("I18N-DOC-1: §1 Key naming documents dot-namespace + camelCase", () => {
  const md = read();
  const idx = md.indexOf("## §1 Key naming");
  const segment = md.slice(idx, md.indexOf("## §2"));
  assert.match(segment, /dot-namespaced/i);
  assert.match(segment, /camelCase/);
  // Reserved suffixes documented
  assert.match(segment, /\.title/);
  assert.match(segment, /\.body/);
  assert.match(segment, /\.cta/);
  assert.match(segment, /\.aria/);
});

test("I18N-DOC-1: §3 Placeholders documents the regex + casing rule", () => {
  const md = read();
  const idx = md.indexOf("## §3 Placeholders");
  const segment = md.slice(idx, md.indexOf("## §4"));
  // The regex
  assert.match(segment, /\\\{\(\\w\+\)\\\}/);
  // Casing rule
  assert.match(segment, /[Cc]asing/);
  // Forbidden patterns
  assert.match(segment, /\{ mode \}/, "documents space-padded as forbidden");
  assert.match(segment, /tool-name/i, "documents hyphenated as forbidden");
});

test("I18N-DOC-1: §4 Translation quality documents 4 sub-rules", () => {
  const md = read();
  const idx = md.indexOf("## §4 Translation quality");
  const segment = md.slice(idx, md.indexOf("## §5"));
  // 4 sub-rules: §4.1 / §4.2 / §4.3 / §4.4
  for (const sub of ["§4.1", "§4.2", "§4.3", "§4.4"]) {
    assert.match(segment, new RegExp(sub),
      `§4 must include ${sub}`);
  }
  // ko === en carve-out documented
  assert.match(segment, /carve-out/i);
  // 5 example legitimate cases for ko === en
  assert.match(segment, /English/);
  assert.match(segment, /일반사용자/);
});

test("I18N-DOC-1: §5 Sanity thresholds lists 3 specific thresholds", () => {
  const md = read();
  const idx = md.indexOf("## §5 Sanity thresholds");
  const segment = md.slice(idx, md.indexOf("## §6"));
  assert.match(segment, /≥\s*200\s*keys/);
  assert.match(segment, /20%\s*identical/);
  assert.match(segment, /10/, "≤ 10 symbols-only cap referenced");
});

test("I18N-DOC-1: §8 Common pitfalls is a markdown table", () => {
  const md = read();
  const idx = md.indexOf("## §8 Common pitfalls");
  const segment = md.slice(idx, md.indexOf("## §9"));
  // Has at least 4 pitfall rows
  const tableRows = (segment.match(/\|[^|\n]+\|[^|\n]+\|[^|\n]+\|/g) || [])
    .filter((line) => !line.match(/^\|[\s-]+\|/));
  // Header (1) + body (≥4) = ≥5 (actually we expect ~6)
  assert.ok(tableRows.length >= 5,
    `expected ≥ 5 pitfall table rows, got ${tableRows.length}`);
  // Specific pitfalls mentioned
  assert.match(segment, /Forget to add the key to en\.js/);
  assert.match(segment, /TODO: translate/);
});

// ── Cross-coherence ──────────────────────────────────────────

test("I18N-DOC-1: §9 References cites the 2 closeout reports", () => {
  const md = read();
  const idx = md.indexOf("## §9 References");
  const segment = md.slice(idx);
  assert.match(segment, /2026-05-05-i18n-parity-1-eval\.md/);
  assert.match(segment, /2026-05-05-i18n-parity-2-eval\.md/);
});

test("I18N-DOC-1: §7 Adding new locales documents 5 steps", () => {
  const md = read();
  const idx = md.indexOf("## §7 Adding new locales");
  const segment = md.slice(idx, md.indexOf("## §8"));
  // Numbered steps 1-5
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(segment, new RegExp(`^${n}\\.`, "m"),
      `§7 must have step ${n}`);
  }
});

test("I18N-DOC-1: doc and test-file slice tags are consistent", () => {
  // The doc claims the tests are tagged with specific slice IDs.
  // Verify those tags actually exist in the source files.
  const docMd = read();
  // Slice I, v5 — i18n.coverage
  const cov = fs.readFileSync(
    path.resolve(__dirname, "i18n.coverage.test.js"), "utf-8");
  assert.match(cov, /Slice I \(v5\)/);
  // I18N-PARITY-1-a — i18n.placeholder-parity
  const ph = fs.readFileSync(
    path.resolve(__dirname, "i18n.placeholder-parity.test.js"), "utf-8");
  assert.match(ph, /I18N-PARITY-1-a/);
  // I18N-PARITY-2-a — i18n.translation-quality
  const tq = fs.readFileSync(
    path.resolve(__dirname, "i18n.translation-quality.test.js"), "utf-8");
  assert.match(tq, /I18N-PARITY-2-a/);
  // Doc references all 3 slice tags
  assert.match(docMd, /Slice I, v5/);
  assert.match(docMd, /I18N-PARITY-1-a/);
  assert.match(docMd, /I18N-PARITY-2-a/);
});
