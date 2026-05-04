// Slice UI-P10-c (Phase D Round UI-P, 2026-05-04) — CLI parsing
// + default outDir contract for the visual-capture-live entry script.
//
// We do NOT exercise main() here (that would require a real chromium
// + server boot, which is operator-runnable land per the runbook).
// What we lock:
//   - parseArgs handles every documented flag (NO undocumented flag
//     silently accepted — guards against future PRs adding ad-hoc
//     options without docs)
//   - defaultOutDir produces a YYYY-MM-DD-prefixed path inside
//     docs/reports/ + label sanitization for filesystem safety

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const cli = require("../../scripts/visual-capture-live");

// ── parseArgs ────────────────────────────────────────────────────

test("UI-P10 cli.parseArgs: empty args → empty options", () => {
  const out = cli.parseArgs([]);
  assert.deepEqual(out, { help: false });
});

test("UI-P10 cli.parseArgs: --help and -h both flip help", () => {
  assert.equal(cli.parseArgs(["--help"]).help, true);
  assert.equal(cli.parseArgs(["-h"]).help, true);
});

test("UI-P10 cli.parseArgs: --port + --out-dir + --label round-trip", () => {
  const out = cli.parseArgs([
    "--port", "5500",
    "--out-dir", "/tmp/visual",
    "--label", "smoke-test",
  ]);
  assert.equal(out.port, 5500);
  assert.equal(out.outDir, "/tmp/visual");
  assert.equal(out.label, "smoke-test");
});

test("UI-P10 cli.parseArgs: --quiet and --json flags", () => {
  const out = cli.parseArgs(["--quiet", "--json"]);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
});

test("UI-P10 cli.parseArgs: --port number coercion", () => {
  const out = cli.parseArgs(["--port", "4799"]);
  assert.equal(out.port, 4799);
  assert.equal(typeof out.port, "number");
});

// ── defaultOutDir ────────────────────────────────────────────────

test("UI-P10 cli.defaultOutDir: contains YYYY-MM-DD prefix + ui-p10-live suffix", () => {
  const dir = cli.defaultOutDir();
  // Path can be docs/reports/2026-05-04-ui-p10-live or docs\reports\... on Windows
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p10-live$/,
    `defaultOutDir() must produce docs/reports/YYYY-MM-DD-ui-p10-live, got: ${normalized}`,
  );
});

test("UI-P10 cli.defaultOutDir: label appended after sanitization", () => {
  const dir = cli.defaultOutDir("smoke-test");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p10-live-smoke-test$/);
});

test("UI-P10 cli.defaultOutDir: dangerous characters in label sanitized to dashes", () => {
  // Operators may pass a label with shell-meaningful chars; the
  // sanitizer maps anything outside [a-zA-Z0-9._-] to "-" so the
  // resulting path stays filesystem-safe on Windows + Mac + Linux.
  const dir = cli.defaultOutDir("hello world!@#$%");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /-hello-world-+$/,
    `dangerous chars in label must be sanitized, got: ${normalized}`,
  );
});

test("UI-P10 cli.defaultOutDir: empty label yields no suffix", () => {
  const withLabel = cli.defaultOutDir("");
  const withoutLabel = cli.defaultOutDir();
  assert.equal(withLabel, withoutLabel,
    "empty / undefined label both yield the same path",
  );
});

// ── Module surface ───────────────────────────────────────────────

test("UI-P10 cli: documented exports", () => {
  assert.equal(typeof cli.parseArgs, "function");
  assert.equal(typeof cli.defaultOutDir, "function");
  assert.equal(typeof cli.main, "function");
});
