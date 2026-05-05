// Slice SCRIPTS-INDEX-1 (Phase 2 v2 follow-up, 2026-05-05) —
// structural test for scripts/README.md (the scripts-directory index).
//
// Same pattern as docs.i18n-conventions.test.js / docs.readiness-rubric.test.js
// / docs.readme-index.test.js / docs.tests-readme.test.js: structural-only.
// Tests fail fast when sections are renamed/deleted; future
// wording changes don't trigger them.
//
// Cross-coherence: every tracked top-level scripts/*.{js,sh,ps1}
// must be referenced in the index. This catches "added a new
// script but forgot to list it" drift.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS_DIR = path.resolve(REPO_ROOT, "scripts");
const INDEX_PATH = path.join(SCRIPTS_DIR, "README.md");

function read() {
  return fs.readFileSync(INDEX_PATH, "utf-8");
}

// ── File-level invariants ─────────────────────────────────────

test("SCRIPTS-INDEX-1: file exists + non-empty", () => {
  assert.ok(fs.existsSync(INDEX_PATH));
  const stat = fs.statSync(INDEX_PATH);
  assert.ok(stat.size > 4000,
    `expected ≥ 4000 bytes, got ${stat.size}`);
});

test("SCRIPTS-INDEX-1: H1 title present", () => {
  assert.match(read(), /^# Scripts Index/m);
});

test("SCRIPTS-INDEX-1: tagged with slice SCRIPTS-INDEX-1", () => {
  assert.match(read(),
    /Slice SCRIPTS-INDEX-1 \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

// ── Required sections ────────────────────────────────────────

const SECTIONS = [
  ["§1", "Quality, readiness, and CI gates"],
  ["§2", "External review & audit"],
  ["§3", "Setup & first-run launcher"],
  ["§4", "R2 single-runner evaluation harness"],
  ["§5", "Live verification"],
  ["§6", "Field pilot"],
  ["§7", "Visual probes"],
  ["§8", "Build & diagnostics"],
  ["§9", "Cross-platform script convention"],
  ["§10", "References"],
];

for (const [num, name] of SECTIONS) {
  test(`SCRIPTS-INDEX-1: ${num} section "${name}" present`, () => {
    const md = read();
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(md, re, `${num} ${name} section must exist`);
  });
}

// ── Anchor scripts must remain indexed ───────────────────────

const ANCHOR_SCRIPTS = [
  "readiness-report.js",
  "sync-scorecard.js",
  "validate-hook-deployment.js",
  "compute-sri.js",
  "visual-baseline-update.js",
  "external-review-bundle.js",
  "verify-auditor-bundle.js",
  "sign-manifest.js",
  "setup-wizard.js",
  "live-verify-review-relay.js",
  "live-verify-smart-arc.js",
  "field-pilot-status.js",
  "build-runner.sh",
  "env-check.ps1",
];

for (const s of ANCHOR_SCRIPTS) {
  test(`SCRIPTS-INDEX-1: anchor script "${s}" referenced`, () => {
    const md = read();
    assert.match(md, new RegExp(s.replace(/\./g, "\\.")),
      `anchor script ${s} must be in the index`);
  });
}

// ── Subdirectory references ──────────────────────────────────

test("SCRIPTS-INDEX-1: launcher/ subdir referenced", () => {
  assert.match(read(), /launcher\//,
    "launcher/ subdir must be referenced");
});

test("SCRIPTS-INDEX-1: launcher-cli.js referenced", () => {
  assert.match(read(), /launcher-cli\.js/);
});

test("SCRIPTS-INDEX-1: trust-store-path.js referenced", () => {
  assert.match(read(), /trust-store-path\.js/);
});

// ── Cross-coherence: every tracked top-level script is referenced ──

function listTrackedTopLevelScripts() {
  try {
    const out = cp.execSync("git ls-files scripts", {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      timeout: 5000,
    });
    return out.split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      // top-level only: scripts/<file>, no further slash
      .filter((line) => /^scripts\/[^\/]+\.(js|sh|ps1)$/.test(line))
      .map((line) => path.basename(line));
  } catch (_e) {
    return fs.readdirSync(SCRIPTS_DIR)
      .filter((f) => /\.(js|sh|ps1)$/.test(f));
  }
}

// A .sh or .ps1 wrapper counts as referenced if (a) the file itself
// is named OR (b) the corresponding <base>.js file is named AND the
// document declares the cross-platform wrapper convention. This
// reflects the §9 contract: thin wrappers don't need per-line entries
// because the index's prose explicitly covers them.
function scriptIsReferenced(md, filename) {
  const escaped = filename.replace(/\./g, "\\.");
  if (new RegExp(escaped).test(md)) return true;

  // Wrapper carve-out: only for .sh / .ps1 with a sibling .js
  const m = filename.match(/^(.+)\.(sh|ps1)$/);
  if (!m) return false;
  const base = m[1];
  const siblingJs = base + ".js";
  if (!new RegExp(siblingJs.replace(/\./g, "\\.")).test(md)) return false;
  // The index must declare the cross-platform wrapper convention.
  if (!/wrappers?\b/i.test(md)) return false;
  // And the §9 cross-platform convention section must exist.
  if (!/Cross-platform script convention/.test(md)) return false;
  return true;
}

test("SCRIPTS-INDEX-1: every tracked top-level script referenced", () => {
  const md = read();
  const scripts = listTrackedTopLevelScripts();
  const missing = [];
  for (const s of scripts) {
    if (!scriptIsReferenced(md, s)) {
      missing.push(s);
    }
  }
  if (missing.length > 0) {
    assert.fail(
      `tracked top-level scripts not referenced in scripts/README.md ` +
      `(neither directly nor via the .js + wrapper-prose convention): ` +
      missing.join(", ")
    );
  }
});

// ── §9 cross-platform convention coverage ────────────────────

test("SCRIPTS-INDEX-1: §9 names all three platform suffixes", () => {
  const md = read();
  const idx = md.indexOf("## §9 Cross-platform script convention");
  const seg = md.slice(idx, md.indexOf("## §10", idx));
  assert.match(seg, /\.js/, "§9 must name .js");
  assert.match(seg, /\.sh/, "§9 must name .sh");
  assert.match(seg, /\.ps1/, "§9 must name .ps1");
});

// ── Cross-references ─────────────────────────────────────────

test("SCRIPTS-INDEX-1: links back to project-root README", () => {
  assert.match(read(), /\.\.\/README\.md/);
});

test("SCRIPTS-INDEX-1: links to docs/README.md", () => {
  assert.match(read(), /\.\.\/docs\/README\.md/);
});

test("SCRIPTS-INDEX-1: links to tests/README.md", () => {
  assert.match(read(), /\.\.\/tests\/README\.md/);
});

test("SCRIPTS-INDEX-1: links to readiness-rubric.md", () => {
  assert.match(read(),
    /\.\.\/docs\/readiness-rubric\.md/);
});

test("SCRIPTS-INDEX-1: links to scorecard.md", () => {
  assert.match(read(),
    /\.\.\/docs\/scorecard\.md/);
});

// ── §1 names the npm-script run handles ──────────────────────

test("SCRIPTS-INDEX-1: §1 names readiness:check + scorecard:sync + verify:hooks", () => {
  const md = read();
  const idx = md.indexOf("## §1 Quality, readiness, and CI gates");
  const seg = md.slice(idx, md.indexOf("## §2", idx));
  assert.match(seg, /readiness:check/);
  assert.match(seg, /scorecard:sync/);
  assert.match(seg, /verify:hooks/);
});
