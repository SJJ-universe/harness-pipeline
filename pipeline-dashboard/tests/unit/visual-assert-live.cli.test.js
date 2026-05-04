// Slice UI-P11-c (Phase D Round UI-P, 2026-05-04) — CLI parsing +
// defaultOutDir contract for visual-assert-live entry script.
//
// Same patterns as tests/unit/visual-capture-live.cli.test.js — pin
// every documented flag + path sanitization. main() not exercised
// here (real chromium + server boot land in operator runbook).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cli = require("../../scripts/visual-assert-live");

// ── parseArgs ────────────────────────────────────────────────────

test("UI-P11 cli.parseArgs: empty args → empty options", () => {
  assert.deepEqual(cli.parseArgs([]), { help: false });
});

test("UI-P11 cli.parseArgs: --help and -h both flip help", () => {
  assert.equal(cli.parseArgs(["--help"]).help, true);
  assert.equal(cli.parseArgs(["-h"]).help, true);
});

test("UI-P11 cli.parseArgs: --port + --out-dir + --label round-trip", () => {
  const out = cli.parseArgs(["--port", "5500", "--out-dir", "/tmp/assert", "--label", "regression"]);
  assert.equal(out.port, 5500);
  assert.equal(out.outDir, "/tmp/assert");
  assert.equal(out.label, "regression");
});

test("UI-P11 cli.parseArgs: --quiet + --json + --screenshot-failures", () => {
  const out = cli.parseArgs(["--quiet", "--json", "--screenshot-failures"]);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
  assert.equal(out.screenshotFailures, true);
});

test("UI-P11 cli.parseArgs: --port number coercion", () => {
  const out = cli.parseArgs(["--port", "4799"]);
  assert.equal(out.port, 4799);
  assert.equal(typeof out.port, "number");
});

// ── defaultOutDir ────────────────────────────────────────────────

test("UI-P11 cli.defaultOutDir: contains YYYY-MM-DD prefix + ui-p11-assert suffix", () => {
  const dir = cli.defaultOutDir();
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p11-assert$/,
    `defaultOutDir() must produce docs/reports/YYYY-MM-DD-ui-p11-assert, got: ${normalized}`,
  );
});

test("UI-P11 cli.defaultOutDir: label appended after sanitization", () => {
  const dir = cli.defaultOutDir("regression-2026-05-04");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p11-assert-regression-2026-05-04$/);
});

test("UI-P11 cli.defaultOutDir: dangerous characters in label sanitized to dashes", () => {
  const dir = cli.defaultOutDir("hello world!@#$%");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /-hello-world-+$/);
});

test("UI-P11 cli.defaultOutDir: empty/undefined label both yield same path", () => {
  assert.equal(cli.defaultOutDir(""), cli.defaultOutDir());
});

test("UI-P11 cli: documented exports", () => {
  assert.equal(typeof cli.parseArgs, "function");
  assert.equal(typeof cli.defaultOutDir, "function");
  assert.equal(typeof cli.main, "function");
});
