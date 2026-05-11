// Slice README-PROJECT-LINKS-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for the project-root README.md.
//
// Structural-only, not stylistic. Tests fail fast when sections are
// renamed/deleted; future wording changes don't trigger them.
//
// This is the smallest doc-test in the suite: the project-root README
// is short (≤ 100 lines) and changes rarely. The test enforces that
// the Documentation section pointing at docs/README.md, tests/README.md,
// and scripts/README.md stays intact, plus the existing Quick Start /
// Environment / Verification / Runtime Proof / Troubleshooting
// structure is preserved.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOC_PATH = path.resolve(__dirname, "..", "..", "README.md");

function read() {
  return fs.readFileSync(DOC_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("README-PROJECT-LINKS-1: README.md exists + non-empty", () => {
  assert.ok(fs.existsSync(DOC_PATH));
  const stat = fs.statSync(DOC_PATH);
  assert.ok(stat.size > 1500,
    `expected ≥ 1500 bytes, got ${stat.size}`);
});

test("README-PROJECT-LINKS-1: H1 title present", () => {
  assert.match(read(), /^# Orchestrator Pipeline Dashboard/m);
});

// ── Required top-level sections (existing + new) ──────────────

const SECTIONS = [
  "Quick Start",
  "Environment",
  "Verification",
  "Documentation",      // added in README-PROJECT-LINKS-1
  "Runtime Proof",
  "Troubleshooting",
];

for (const name of SECTIONS) {
  test(`README-PROJECT-LINKS-1: section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(md, re,
      `## ${name} section must exist`);
  });
}

// ── Documentation section content ────────────────────────────

test("README-PROJECT-LINKS-1: Documentation section links to docs/README.md", () => {
  const md = read();
  const idx = md.indexOf("## Documentation");
  const seg = md.slice(idx, md.indexOf("## Runtime Proof", idx));
  assert.match(seg, /docs\/README\.md/,
    "Documentation section must link to docs/README.md");
});

test("README-PROJECT-LINKS-1: Documentation section links to tests/README.md", () => {
  const md = read();
  const idx = md.indexOf("## Documentation");
  const seg = md.slice(idx, md.indexOf("## Runtime Proof", idx));
  assert.match(seg, /tests\/README\.md/,
    "Documentation section must link to tests/README.md");
});

test("README-PROJECT-LINKS-1: Documentation section links to scripts/README.md", () => {
  const md = read();
  const idx = md.indexOf("## Documentation");
  const seg = md.slice(idx, md.indexOf("## Runtime Proof", idx));
  assert.match(seg, /scripts\/README\.md/,
    "Documentation section must link to scripts/README.md");
});

test("README-PROJECT-LINKS-1: linked sub-READMEs all exist on disk", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  for (const rel of ["docs/README.md", "tests/README.md", "scripts/README.md"]) {
    const target = path.join(repoRoot, rel);
    assert.ok(fs.existsSync(target),
      `${rel} (referenced from project README) must exist on disk`);
  }
});

// ── Quick Start content (no regression) ───────────────────────

test("README-PROJECT-LINKS-1: Quick Start still mentions npm install + npm start", () => {
  const md = read();
  const idx = md.indexOf("## Quick Start");
  const seg = md.slice(idx, md.indexOf("## Environment", idx));
  assert.match(seg, /npm install/);
  assert.match(seg, /npm start/);
  // Loopback default URL referenced
  assert.match(seg, /127\.0\.0\.1:4201/);
});

// ── Environment section anchor checks ─────────────────────────

const ENV_VARS = [
  "ORCHESTRATOR_PORT",
  "ORCHESTRATOR_HOST",
  "ORCHESTRATOR_TOKEN",
  "ORCHESTRATOR_ALLOW_REMOTE",
];

for (const v of ENV_VARS) {
  test(`README-PROJECT-LINKS-1: env var "${v}" still documented`, () => {
    const md = read();
    const idx = md.indexOf("## Environment");
    const seg = md.slice(idx, md.indexOf("## Verification", idx));
    assert.match(seg, new RegExp(v),
      `${v} must remain in the Environment section`);
  });
}

// ── Section ordering ──────────────────────────────────────────

test("README-PROJECT-LINKS-1: Documentation section sits between Verification and Runtime Proof", () => {
  const md = read();
  const verifIdx = md.indexOf("## Verification");
  const docIdx = md.indexOf("## Documentation");
  const runtimeIdx = md.indexOf("## Runtime Proof");
  assert.ok(verifIdx < docIdx,
    "Documentation must come AFTER Verification");
  assert.ok(docIdx < runtimeIdx,
    "Documentation must come BEFORE Runtime Proof");
});
