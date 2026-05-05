// Slice PREFLIGHT-CHECKLIST (Phase 2 v2 follow-up, 2026-05-05) —
// structural tests for scripts/preflight.js. Behavior tests live
// in tests/smoke/preflight.test.js since they require sub-process
// execution.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "preflight.js");
const PACKAGE_JSON = path.join(REPO_ROOT, "package.json");
const RUNBOOK = path.join(REPO_ROOT, "docs", "runbooks", "deployment-readiness.md");

function read(p) { return fs.readFileSync(p, "utf-8"); }

// ── Script file invariants ──────────────────────────────────

test("PREFLIGHT-CHECKLIST: scripts/preflight.js exists + non-empty", () => {
  assert.ok(fs.existsSync(SCRIPT));
  const s = fs.statSync(SCRIPT);
  assert.ok(s.size > 3000,
    `expected ≥ 3000 bytes, got ${s.size}`);
});

test("PREFLIGHT-CHECKLIST: script header tags slice + bilingual purpose", () => {
  const text = read(SCRIPT);
  const head = text.split("\n").slice(0, 50).join("\n");
  assert.match(head, /Slice PREFLIGHT-CHECKLIST \(Phase 2 v2 follow-up, 2026-05-05\)/);
  assert.match(head, /pre-deployment health check/i);
});

test("PREFLIGHT-CHECKLIST: script names all four required gates", () => {
  const text = read(SCRIPT);
  for (const gate of ["visual:check", "readiness:check", "scorecard:check", "verify:hooks"]) {
    assert.match(text, new RegExp(gate.replace(/:/g, ":")),
      `script must reference required gate: ${gate}`);
  }
});

test("PREFLIGHT-CHECKLIST: script handles --json + --with-smoke + --quiet flags", () => {
  const text = read(SCRIPT);
  for (const f of ["--json", "--with-smoke", "--quiet"]) {
    assert.match(text, new RegExp(f.replace("-", "\\-")),
      `script must reference ${f} flag`);
  }
});

test("PREFLIGHT-CHECKLIST: script documents exit-code semantics 0/1/2", () => {
  const text = read(SCRIPT);
  // Exit code documentation in the header block
  assert.match(text, /0\s+— all required gates PASS/i);
  assert.match(text, /1\s+— at least one required gate FAILED/i);
  assert.match(text, /2\s+— preflight itself errored/i);
});

test("PREFLIGHT-CHECKLIST: script handles READINESS-BOOT-FAILURE-CONFIG exit 4", () => {
  const text = read(SCRIPT);
  // The verdict mapping must distinguish CONFIG (exit 4) from other
  // readiness exits and emit a descriptive FAIL message.
  assert.match(text, /exitCode === 4/);
  assert.match(text, /CONFIG/);
  assert.match(text, /NOT a regression/);
});

// ── package.json registers the npm script ───────────────────

test("PREFLIGHT-CHECKLIST: package.json registers `preflight` npm script", () => {
  const pkg = JSON.parse(read(PACKAGE_JSON));
  assert.ok(pkg.scripts.preflight,
    "package.json must register a `preflight` script");
  assert.match(pkg.scripts.preflight, /scripts\/preflight\.js/,
    "preflight script must invoke scripts/preflight.js");
});

// ── Runbook structural anchors ──────────────────────────────

test("PREFLIGHT-CHECKLIST: deployment-readiness.md exists + non-empty", () => {
  assert.ok(fs.existsSync(RUNBOOK));
  const s = fs.statSync(RUNBOOK);
  assert.ok(s.size > 3000,
    `expected ≥ 3000 bytes, got ${s.size}`);
});

test("PREFLIGHT-CHECKLIST: runbook H1 + slice tag", () => {
  const text = read(RUNBOOK);
  assert.match(text, /^# Runbook — Pre-Deployment Readiness Check/m);
  assert.match(text, /Slice PREFLIGHT-CHECKLIST \(Phase 2 v2 follow-up, 2026-05-05\)/);
});

const RUNBOOK_SECTIONS = [
  ["§1", "Prerequisites"],
  ["§2", "Standard usage"],
  ["§3", "Required gates"],
  ["§4", "Optional and informational gates"],
  ["§5", "JSON mode"],
  ["§6", "Troubleshooting"],
  ["§7", "Pre-release sequence"],
  ["§8", "References"],
];

for (const [num, name] of RUNBOOK_SECTIONS) {
  test(`PREFLIGHT-CHECKLIST: runbook ${num} "${name}" present`, () => {
    const text = read(RUNBOOK);
    const re = new RegExp(`## ${num} ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(text, re,
      `runbook ${num} ${name} must exist`);
  });
}

test("PREFLIGHT-CHECKLIST: runbook §3 lists all four required gates", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §3 Required gates");
  const seg = text.slice(idx, text.indexOf("## §4", idx));
  for (const gate of ["visual:check", "readiness:check", "scorecard:check", "verify:hooks"]) {
    assert.match(seg, new RegExp(gate.replace(/:/g, ":")),
      `§3 must list ${gate}`);
  }
});

test("PREFLIGHT-CHECKLIST: runbook §1 documents the sandbox-shell carve-out", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §1 Prerequisites");
  const seg = text.slice(idx, text.indexOf("## §2", idx));
  assert.match(seg, /sandboxed shell|sandboxed shells/i,
    "§1 must call out the sandboxed-shell limitation");
  assert.match(seg, /CONFIG/,
    "§1 must point operators at the CONFIG-tier exit code");
});

test("PREFLIGHT-CHECKLIST: runbook links to readiness-rubric §4 + §7.1", () => {
  const text = read(RUNBOOK);
  assert.match(text, /readiness-rubric\.md/);
});

test("PREFLIGHT-CHECKLIST: runbook §4.1 documents --with-smoke flag", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §4 Optional");
  const seg = text.slice(idx, text.indexOf("## §5", idx));
  assert.match(seg, /--with-smoke/);
});

test("PREFLIGHT-CHECKLIST: runbook §6 troubleshooting names the CONFIG case", () => {
  const text = read(RUNBOOK);
  const idx = text.indexOf("## §6 Troubleshooting");
  const seg = text.slice(idx, text.indexOf("## §7", idx));
  // Must list at least 4 troubleshooting entries — sanity floor for
  // "this section was actually filled in"
  const tableRows = (seg.match(/\|[^|\n]+\|[^|\n]+\|[^|\n]+\|/g) || [])
    .filter((line) => !line.match(/^\|[\s-]+\|/));
  assert.ok(tableRows.length >= 5,
    `expected ≥ 5 troubleshooting rows (header + 4+ entries), got ${tableRows.length}`);
  assert.match(seg, /CONFIG/);
});

// ── RUNBOOK-CD-FIX: working-directory preamble ──────────────

test("PREFLIGHT-CHECKLIST: runbook documents the pipeline-dashboard working directory", () => {
  const text = read(RUNBOOK);
  assert.match(text, /작업 디렉토리|Working directory/i,
    "runbook must include the working-directory preamble");
  assert.match(text, /pipeline-dashboard/);
  assert.match(text, /cd .*pipeline-dashboard/);
});

test("PREFLIGHT-CHECKLIST: runbook command blocks open with `cd`", () => {
  const text = read(RUNBOOK);
  const blocks = text.match(/```powershell\n([\s\S]*?)```/g) || [];
  for (const blk of blocks) {
    const inner = blk.slice("```powershell\n".length, -3);
    if (/^npm |^node /m.test(inner)) {
      assert.match(inner, /^cd /m,
        "a ```powershell block running npm/node must open with `cd ...`:\n" +
        inner.split("\n").slice(0, 3).join(" / "));
    }
  }
});
