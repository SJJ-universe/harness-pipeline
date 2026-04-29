// tests/smoke/setup-wizard-scripts.test.js — Slice D2-d (Phase E1.5, 2026-04-29)
//
// Lint guard for the .ps1 + .sh wrappers that ship next to
// scripts/setup-wizard.js. The Node script's behavior is covered by
// tests/unit/setup-wizard.test.js; this file just locks the
// thin-wrapper contract.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const PS1 = path.join(REPO_ROOT, "scripts", "setup-wizard.ps1");
const SH = path.join(REPO_ROOT, "scripts", "setup-wizard.sh");
const JS = path.join(REPO_ROOT, "scripts", "setup-wizard.js");

function read(p) {
  return fs.readFileSync(p, "utf-8");
}

// ─────────────────────────────────────────────────────────────────
//  All three wrapper artifacts exist
// ─────────────────────────────────────────────────────────────────

test("D2-d scripts: setup-wizard.js exists at scripts/setup-wizard.js", () => {
  assert.ok(fs.existsSync(JS), "setup-wizard.js is the canonical entrypoint");
});

test("D2-d scripts: setup-wizard.ps1 exists at scripts/setup-wizard.ps1", () => {
  assert.ok(fs.existsSync(PS1));
});

test("D2-d scripts: setup-wizard.sh exists at scripts/setup-wizard.sh", () => {
  assert.ok(fs.existsSync(SH));
});

// ─────────────────────────────────────────────────────────────────
//  PowerShell wrapper contract
// ─────────────────────────────────────────────────────────────────

test("D2-d ps1: starts with $ErrorActionPreference = 'Stop'", () => {
  const src = read(PS1);
  assert.match(src, /\$ErrorActionPreference\s*=\s*"Stop"/,
    "fail-fast on first error so operators don't see a half-completed flow");
});

test("D2-d ps1: resolves the .js sibling via $PSScriptRoot fallback", () => {
  const src = read(PS1);
  assert.match(src, /\$PSScriptRoot/);
  assert.match(src, /Split-Path -Parent \$MyInvocation\.MyCommand\.Path/,
    "fallback when invoked via . sourcing or absolute path");
  assert.match(src, /setup-wizard\.js/);
});

test("D2-d ps1: forwards args via @args (not $args, which would stringify)", () => {
  const src = read(PS1);
  assert.match(src, /@args/,
    "@args is the splat operator that preserves arg shape; $args alone joins");
});

test("D2-d ps1: exits with $LASTEXITCODE so operators see the wizard's code", () => {
  const src = read(PS1);
  assert.match(src, /exit \$LASTEXITCODE/);
});

test("D2-d ps1: pre-checks Node availability with node --version", () => {
  const src = read(PS1);
  assert.match(src, /node --version/);
  assert.match(src, /\$LASTEXITCODE\s*-ne\s*0/,
    "non-zero LASTEXITCODE means Node missing → fail fast");
});

// ─────────────────────────────────────────────────────────────────
//  bash wrapper contract
// ─────────────────────────────────────────────────────────────────

test("D2-d sh: starts with #!/usr/bin/env bash", () => {
  const src = read(SH);
  assert.match(src.split("\n")[0], /^#!\/usr\/bin\/env bash$/);
});

test("D2-d sh: uses set -euo pipefail (fail-fast contract)", () => {
  const src = read(SH);
  assert.match(src, /set -euo pipefail/);
});

test("D2-d sh: resolves SCRIPT_DIR via cd + dirname pattern", () => {
  const src = read(SH);
  assert.match(src, /cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)"/,
    "BASH_SOURCE[0] is the canonical 'this script' reference");
  assert.match(src, /pwd/);
});

test("D2-d sh: forwards args via \"$@\"", () => {
  const src = read(SH);
  assert.match(src, /"\$@"/,
    '"$@" preserves arg shape; $@ alone re-splits');
});

test("D2-d sh: pre-checks Node availability with command -v node", () => {
  const src = read(SH);
  assert.match(src, /command -v node/);
});

test("D2-d sh: uses exec to hand off (replace shell, no extra fork)", () => {
  const src = read(SH);
  assert.match(src, /exec node/,
    "exec replaces the bash process so the operator sees only the wizard exit code");
});

// ─────────────────────────────────────────────────────────────────
//  POSIX file mode (must be executable on POSIX checkouts)
// ─────────────────────────────────────────────────────────────────

test("D2-d sh: file is executable on POSIX (skip on Windows)", () => {
  if (process.platform === "win32") {
    // Windows file modes don't track POSIX exec bits; rely on .gitattributes
    // shipping the bit. Just assert the file exists.
    assert.ok(fs.existsSync(SH));
    return;
  }
  const stat = fs.statSync(SH);
  // 0o100 = owner-execute bit. We only need owner-execute; group/world
  // depend on the operator's umask.
  assert.ok((stat.mode & 0o100) !== 0,
    "setup-wizard.sh must be executable (0o100 owner-x bit set)");
});

// ─────────────────────────────────────────────────────────────────
//  Both wrappers reference the same artifact name
// ─────────────────────────────────────────────────────────────────

test("D2-d wrappers reference setup-wizard.js (not a stale name)", () => {
  const ps1 = read(PS1);
  const sh = read(SH);
  assert.match(ps1, /setup-wizard\.js/);
  assert.match(sh, /setup-wizard\.js/);
});

// ─────────────────────────────────────────────────────────────────
//  Help output matches between Node + wrappers (sanity)
// ─────────────────────────────────────────────────────────────────

test("D2-d setup-wizard.js --help text mentions both tracks", () => {
  // Reach into the parser instead of spawning. We're not testing that
  // node runs (that's covered by setup-wizard.test.js); we're testing
  // that the documentation in the script references both tracks.
  const src = read(JS);
  assert.match(src, /Force standard track/);
  assert.match(src, /Force public-sector track/);
});
