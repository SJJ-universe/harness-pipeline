// Slice UI-P13-c (Phase D Round UI-P, 2026-05-04) — CLI parsing +
// defaultOutDir contract for visual-button-live entry script.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cli = require("../../scripts/visual-button-live");

test("UI-P13 cli.parseArgs: empty args → empty options", () => {
  assert.deepEqual(cli.parseArgs([]), { help: false });
});

test("UI-P13 cli.parseArgs: --help and -h flip help", () => {
  assert.equal(cli.parseArgs(["--help"]).help, true);
  assert.equal(cli.parseArgs(["-h"]).help, true);
});

test("UI-P13 cli.parseArgs: --port + --out-dir + --label round-trip", () => {
  const out = cli.parseArgs(["--port", "5500", "--out-dir", "/tmp/buttons", "--label", "smoke"]);
  assert.equal(out.port, 5500);
  assert.equal(out.outDir, "/tmp/buttons");
  assert.equal(out.label, "smoke");
});

test("UI-P13 cli.parseArgs: --quiet + --json", () => {
  const out = cli.parseArgs(["--quiet", "--json"]);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
});

test("UI-P13 cli.parseArgs: --port number coercion", () => {
  const out = cli.parseArgs(["--port", "4799"]);
  assert.equal(out.port, 4799);
  assert.equal(typeof out.port, "number");
});

test("UI-P13 cli.defaultOutDir: contains YYYY-MM-DD prefix + ui-p13-buttons suffix", () => {
  const dir = cli.defaultOutDir();
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p13-buttons$/);
});

test("UI-P13 cli.defaultOutDir: label appended after sanitization", () => {
  const dir = cli.defaultOutDir("regression-2026-05-04");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p13-buttons-regression-2026-05-04$/);
});

test("UI-P13 cli.defaultOutDir: dangerous characters in label sanitized to dashes", () => {
  const dir = cli.defaultOutDir("hello world!@#$%");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /-hello-world-+$/);
});

test("UI-P13 cli.defaultOutDir: empty/undefined label both yield same path", () => {
  assert.equal(cli.defaultOutDir(""), cli.defaultOutDir());
});

test("UI-P13 cli: documented exports", () => {
  assert.equal(typeof cli.parseArgs, "function");
  assert.equal(typeof cli.defaultOutDir, "function");
  assert.equal(typeof cli.main, "function");
});
