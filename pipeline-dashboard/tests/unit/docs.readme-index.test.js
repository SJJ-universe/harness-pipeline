// Slice DOC-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/README.md (the doc-directory index).
//
// Same pattern as docs.i18n-conventions.test.js +
// docs.readiness-rubric.test.js: structural-only, not stylistic.
// Tests fail fast when sections are renamed/deleted; future
// wording changes don't trigger them.
//
// Cross-coherence: every tracked top-level docs/*.md (except the
// index itself) must be referenced by filename in the index. This
// catches the "added a new doc but forgot to list it" drift.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DOC_DIR = path.resolve(REPO_ROOT, "docs");
const INDEX_PATH = path.join(DOC_DIR, "README.md");

function read() {
  return fs.readFileSync(INDEX_PATH, "utf-8");
}

// Use git ls-files when available so we only check tracked files —
// untracked drafts (e.g. `*-authoring-blueprint.md` mid-edit) don't
// trip the index test. If git isn't available (e.g. tarball install),
// fall back to fs listing minus a draft-suffix carve-out.
function listTrackedTopLevelDocs() {
  try {
    // git ls-files docs returns ALL tracked files under docs/ recursively.
    // Filter to top-level only (no slash after "docs/").
    const out = cp.execSync("git ls-files docs", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /^docs\/[^\/]+\.md$/.test(line))
      .map((line) => path.basename(line))
      .filter((f) => f !== "README.md");
  } catch (_e) {
    // Fallback for git-less environments
    return fs.readdirSync(DOC_DIR)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => f !== "README.md")
      .filter((f) => !f.startsWith("_"))
      .filter((f) => !/-authoring-blueprint\.md$/.test(f));
  }
}

// ── File-level invariants ─────────────────────────────────────

test("DOC-INDEX-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(INDEX_PATH));
  const stat = fs.statSync(INDEX_PATH);
  assert.ok(stat.size > 3000,
    `expected ≥ 3000 bytes, got ${stat.size}`);
});

test("DOC-INDEX-1: H1 title present", () => {
  assert.match(read(), /^# Harness Pipeline Documentation Index/m);
});

test("DOC-INDEX-1: tagged with slice DOC-INDEX-1", () => {
  assert.match(read(),
    /Slice DOC-INDEX-1 \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Architecture & design"],
  ["§2", "Operations & deployment"],
  ["§3", "Policy, security & remote-mode design"],
  ["§4", "Reference & contracts"],
  ["§5", "Status & health"],
  ["§6", "Sub-directories"],
  ["§7", "How to find what you need"],
  ["§8", "Conventions"],
  ["§9", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`DOC-INDEX-1: ${num} section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(md, re, `${num} ${name} section must exist`);
  });
}

// ── Cross-coherence: every tracked top-level docs/*.md is referenced ──

test("DOC-INDEX-1: at least 15 top-level docs are referenced", () => {
  // Sanity floor — if this drops below 15 something has gone
  // very wrong (mass-rename or mass-delete).
  const docs = listTrackedTopLevelDocs();
  assert.ok(docs.length >= 15,
    `expected ≥ 15 tracked top-level docs, found ${docs.length}`);
});

// "Added a new tracked doc → didn't list it in README.md" should fail.
// Untracked drafts (caught by listTrackedTopLevelDocs's git filter) are
// exempt — that's the design carve-out for in-flight authoring.

test("DOC-INDEX-1: every tracked doc is referenced in the index", () => {
  const md = read();
  const docs = listTrackedTopLevelDocs();
  const missing = [];
  for (const f of docs) {
    // Each doc must be referenced by filename anywhere in the index.
    const escaped = f.replace(/\./g, "\\.");
    const re = new RegExp(escaped);
    if (!re.test(md)) {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    assert.fail(
      `tracked top-level docs not referenced in docs/README.md: ` +
      missing.join(", ")
    );
  }
});

// Specific anchor docs that MUST stay in the index (catches
// accidental refactor-out of important docs).

const ANCHOR_DOCS = [
  "harness-architecture.md",
  "security-model.md",
  "operator-guide.md",
  "scorecard.md",
  "readiness-rubric.md",
  "i18n-conventions.md",
  "remote-sandbox-rfc.md",
  "remote-sandbox-impl.md",
  "r3-rollout-plan.md",
  "public-sector-hardening-plan.md",
  "visual-contract-governance.md",
];

for (const doc of ANCHOR_DOCS) {
  test(`DOC-INDEX-1: anchor doc "${doc}" referenced`, () => {
    const md = read();
    assert.match(md, new RegExp(doc.replace(/\./g, "\\.")),
      `anchor doc ${doc} must be in the index`);
  });
}

// ── Sub-directory references ────────────────────────────────

const SUBDIRS = [
  "external-review/",
  "runbooks/",
  "reports/",
  "superpowers/specs/",
];

for (const dir of SUBDIRS) {
  test(`DOC-INDEX-1: sub-directory "${dir}" referenced in §6`, () => {
    const md = read();
    const sixIdx = md.indexOf("## §6 Sub-directories");
    assert.ok(sixIdx > 0, "§6 Sub-directories must exist");
    const sevenIdx = md.indexOf("## §7", sixIdx);
    const segment = md.slice(sixIdx, sevenIdx === -1 ? undefined : sevenIdx);
    assert.match(segment, new RegExp(dir.replace(/\//g, "\\/")),
      `${dir} must be referenced in §6`);
  });
}

// ── Cross-references ────────────────────────────────────────

test("DOC-INDEX-1: links back to project-root README", () => {
  // ../README.md form
  assert.match(read(), /\.\.\/README\.md/);
});

test("DOC-INDEX-1: §7 mentions doc-test convention", () => {
  const md = read();
  const idx = md.indexOf("## §7");
  const seg = md.slice(idx, md.indexOf("## §8", idx));
  // The doc-test pattern is referenced
  assert.match(seg, /tests\/unit\/docs\./,
    "§7 must explain the doc-test convention");
});

test("DOC-INDEX-1: §8 names the Korean-audience exception explicitly", () => {
  const md = read();
  const idx = md.indexOf("## §8");
  const seg = md.slice(idx, md.indexOf("## §9", idx));
  assert.match(seg, /Korean/,
    "§8 must call out the Korean-audience tag carve-out");
});
