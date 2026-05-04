// Slice UI-P12-c (Phase D Round UI-P, 2026-05-04) — CLI parsing +
// defaultOutDir contract for visual-a11y-live entry script.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cli = require("../../scripts/visual-a11y-live");

test("UI-P12 cli.parseArgs: empty args → empty options + extraDisabledRules:[]", () => {
  const out = cli.parseArgs([]);
  assert.deepEqual(out, { help: false, extraDisabledRules: [] });
});

test("UI-P12 cli.parseArgs: --help and -h flip help", () => {
  assert.equal(cli.parseArgs(["--help"]).help, true);
  assert.equal(cli.parseArgs(["-h"]).help, true);
});

test("UI-P12 cli.parseArgs: --port + --out-dir + --label round-trip", () => {
  const out = cli.parseArgs(["--port", "5500", "--out-dir", "/tmp/a11y", "--label", "audit-2026-05-04"]);
  assert.equal(out.port, 5500);
  assert.equal(out.outDir, "/tmp/a11y");
  assert.equal(out.label, "audit-2026-05-04");
});

test("UI-P12 cli.parseArgs: --quiet + --json", () => {
  const out = cli.parseArgs(["--quiet", "--json"]);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
});

test("UI-P12 cli.parseArgs: --disable-rule repeatable accumulates", () => {
  const out = cli.parseArgs([
    "--disable-rule", "color-contrast",
    "--disable-rule", "duplicate-id",
    "--disable-rule", "region",
  ]);
  assert.deepEqual(out.extraDisabledRules,
    ["color-contrast", "duplicate-id", "region"],
  );
});

test("UI-P12 cli.parseArgs: --port number coercion", () => {
  const out = cli.parseArgs(["--port", "4799"]);
  assert.equal(out.port, 4799);
  assert.equal(typeof out.port, "number");
});

test("UI-P12 cli.defaultOutDir: contains YYYY-MM-DD prefix + ui-p12-a11y suffix", () => {
  const dir = cli.defaultOutDir();
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p12-a11y$/);
});

test("UI-P12 cli.defaultOutDir: label appended after sanitization", () => {
  const dir = cli.defaultOutDir("public-sector-audit");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-p12-a11y-public-sector-audit$/);
});

test("UI-P12 cli.defaultOutDir: dangerous characters in label sanitized to dashes", () => {
  const dir = cli.defaultOutDir("hello world!@#$%");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /-hello-world-+$/);
});

test("UI-P12 cli.defaultOutDir: empty/undefined label both yield same path", () => {
  assert.equal(cli.defaultOutDir(""), cli.defaultOutDir());
});

test("UI-P12 cli: documented exports", () => {
  assert.equal(typeof cli.parseArgs, "function");
  assert.equal(typeof cli.defaultOutDir, "function");
  assert.equal(typeof cli.main, "function");
});
