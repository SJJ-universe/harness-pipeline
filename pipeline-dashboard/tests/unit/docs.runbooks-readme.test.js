// Slice RUNBOOKS-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for docs/runbooks/README.md.
//
// Same pattern as the other docs.* tests: structural-only, not
// stylistic. Tests fail fast when sections are renamed/deleted;
// future wording changes don't trigger them.
//
// Cross-coherence: every tracked runbook in docs/runbooks/*.md
// (except README.md) must be referenced in this index. This catches
// the "added a runbook but forgot to list it" drift, mirroring the
// docs/README and scripts/README convention.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNBOOKS_DIR = path.resolve(REPO_ROOT, "docs", "runbooks");
const INDEX_PATH = path.join(RUNBOOKS_DIR, "README.md");

function read() {
  return fs.readFileSync(INDEX_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("RUNBOOKS-INDEX-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(INDEX_PATH));
  const stat = fs.statSync(INDEX_PATH);
  assert.ok(stat.size > 3000,
    `expected ≥ 3000 bytes, got ${stat.size}`);
});

test("RUNBOOKS-INDEX-1: H1 title present", () => {
  assert.match(read(), /^# Runbooks Index/m);
});

test("RUNBOOKS-INDEX-1: tagged with slice RUNBOOKS-INDEX-1", () => {
  assert.match(read(),
    /Slice RUNBOOKS-INDEX-1 \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Field-pilot family"],
  ["§2", "Pre-deployment family"],     // PREFLIGHT-CHECKLIST round
  ["§3", "Live-verify family"],
  ["§4", "How to add a new runbook"],
  ["§5", "Conventions"],
  ["§6", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`RUNBOOKS-INDEX-1: ${num} section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(md, re, `${num} ${name} section must exist`);
  });
}

// ── Cross-coherence: every tracked runbook is referenced ──

function listTrackedRunbooks() {
  try {
    const out = cp.execSync("git ls-files docs/runbooks", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /^docs\/runbooks\/[^\/]+\.md$/.test(line))
      .map((line) => path.basename(line))
      .filter((f) => f !== "README.md");
  } catch (_e) {
    return fs.readdirSync(RUNBOOKS_DIR)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => f !== "README.md");
  }
}

test("RUNBOOKS-INDEX-1: at least 8 runbooks listed", () => {
  const runbooks = listTrackedRunbooks();
  assert.ok(runbooks.length >= 8,
    `expected ≥ 8 tracked runbooks, found ${runbooks.length}`);
});

test("RUNBOOKS-INDEX-1: every tracked runbook referenced in the index", () => {
  const md = read();
  const runbooks = listTrackedRunbooks();
  const missing = [];
  for (const f of runbooks) {
    const escaped = f.replace(/\./g, "\\.");
    if (!new RegExp(escaped).test(md)) {
      missing.push(f);
    }
  }
  if (missing.length > 0) {
    assert.fail(
      `tracked runbooks not referenced in docs/runbooks/README.md: ` +
      missing.join(", ")
    );
  }
});

// ── Field-pilot family — anchor entries ──────────────────────

const FIELD_PILOT_RUNBOOKS = [
  "field-pilot-deployment-log.md",
  "field-pilot-troubleshooting.md",
  "field-pilot-incident-ledger.md",
  "field-pilot-feedback-survey.md",
];

for (const r of FIELD_PILOT_RUNBOOKS) {
  test(`RUNBOOKS-INDEX-1: §1 lists "${r}"`, () => {
    const md = read();
    const idx = md.indexOf("## §1 Field-pilot family");
    const seg = md.slice(idx, md.indexOf("## §2", idx));
    assert.match(seg, new RegExp(r.replace(/\./g, "\\.")),
      `§1 must list ${r}`);
  });
}

// ── Pre-deployment family — anchor (PREFLIGHT-CHECKLIST round) ──

test("RUNBOOKS-INDEX-1: §2 lists deployment-readiness.md + preflight.js", () => {
  const md = read();
  const idx = md.indexOf("## §2 Pre-deployment family");
  const seg = md.slice(idx, md.indexOf("## §3", idx));
  assert.match(seg, /deployment-readiness\.md/,
    "§2 must list deployment-readiness.md");
  assert.match(seg, /preflight\.js/,
    "§2 must reference scripts/preflight.js");
});

// ── Live-verify family — anchor entries + script pairing ──────

const LIVE_VERIFY_PAIRS = [
  ["live-verify-review-relay.md", "live-verify-review-relay.js"],
  ["visual-capture-live.md", "visual-capture-live.js"],
  ["visual-assert-live.md", "visual-assert-live.js"],
  ["visual-a11y-live.md", "visual-a11y-live.js"],
  ["visual-button-live.md", "visual-button-live.js"],
  ["visual-fused-live.md", "visual-fused-live.js"],
];

for (const [runbook, script] of LIVE_VERIFY_PAIRS) {
  test(`RUNBOOKS-INDEX-1: §3 pairs ${runbook} with ${script}`, () => {
    const md = read();
    const idx = md.indexOf("## §3 Live-verify family");
    const seg = md.slice(idx, md.indexOf("## §4", idx));
    assert.match(seg, new RegExp(runbook.replace(/\./g, "\\.")),
      `§3 must list ${runbook}`);
    assert.match(seg, new RegExp(script.replace(/\./g, "\\.")),
      `§3 must list ${script}`);
  });
}

// ── §3 Add-a-runbook checklist ───────────────────────────────

test("RUNBOOKS-INDEX-1: §4 documents the 5-step add-a-runbook procedure", () => {
  const md = read();
  const idx = md.indexOf("## §4 How to add a new runbook");
  const seg = md.slice(idx, md.indexOf("## §5", idx));
  for (const n of [1, 2, 3, 4, 5]) {
    assert.match(seg, new RegExp(`^${n}\\.`, "m"),
      `§4 must include step ${n}.`);
  }
  // Mentions the structural test by name
  assert.match(seg, /docs\.runbooks-readme\.test\.js/,
    "§4 must point at the structural test that enforces drift detection");
});

// ── Cross-references ─────────────────────────────────────────

test("RUNBOOKS-INDEX-1: links to docs/README.md", () => {
  assert.match(read(),
    /\.\.\/README\.md/);
});

test("RUNBOOKS-INDEX-1: links to scripts/README.md", () => {
  assert.match(read(),
    /\.\.\/\.\.\/scripts\/README\.md/);
});

test("RUNBOOKS-INDEX-1: links to tests/README.md", () => {
  assert.match(read(),
    /\.\.\/\.\.\/tests\/README\.md/);
});

test("RUNBOOKS-INDEX-1: links to external-review/ subdirectory", () => {
  assert.match(read(),
    /\.\.\/external-review\//);
});

// ── docs/README.md upstream link ─────────────────────────────

test("RUNBOOKS-INDEX-1: docs/README.md points to runbooks/README.md as entry", () => {
  const docsReadme = fs.readFileSync(
    path.join(REPO_ROOT, "docs", "README.md"), "utf-8"
  );
  assert.match(docsReadme, /runbooks\/README\.md/,
    "docs/README.md §6 must list runbooks/README.md as the entry point");
});
