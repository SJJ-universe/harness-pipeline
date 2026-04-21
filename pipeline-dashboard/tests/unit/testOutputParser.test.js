// Slice Q (v6) — testOutputParser fixtures for 5 formats.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseTestOutput,
  looksLikeTestCommand,
  TEST_COMMAND_RE,
} = require("../../src/runtime/testOutputParser");

// ── jest ─────────────────────────────────────────────────────────

test("jest: all passing → hasFailure:false", () => {
  const stdout = `
PASS  src/foo.test.js
Tests:       5 passed, 5 total
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "jest");
  assert.equal(r.pass, 5);
  assert.equal(r.fail, 0);
  assert.equal(r.hasFailure, false);
});

test("jest: mixed failing/passing → hasFailure:true", () => {
  const stdout = `
FAIL src/bar.test.js
Tests:       2 failed, 3 passed, 5 total
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "jest");
  assert.equal(r.pass, 3);
  assert.equal(r.fail, 2);
  assert.equal(r.hasFailure, true);
});

test("jest: with skipped section", () => {
  const stdout = `Tests:       1 failed, 2 skipped, 4 passed, 7 total`;
  const r = parseTestOutput(stdout);
  assert.equal(r.fail, 1);
  assert.equal(r.skipped, 2);
  assert.equal(r.pass, 4);
  assert.equal(r.hasFailure, true);
});

// ── vitest ───────────────────────────────────────────────────────

test("vitest: all passing", () => {
  const stdout = `
 Test Files  3 passed (3)
 Tests  12 passed (12)
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "vitest");
  assert.equal(r.pass, 12);
  assert.equal(r.fail, 0);
});

test("vitest: with failures", () => {
  const stdout = `Tests  2 failed | 5 passed (7)`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "vitest");
  assert.equal(r.fail, 2);
  assert.equal(r.pass, 5);
  assert.equal(r.hasFailure, true);
});

// ── node:test ────────────────────────────────────────────────────

test("node:test: failing case", () => {
  const stdout = `
✖ should add two numbers
ℹ tests 3
ℹ pass 2
ℹ fail 1
# tests 3
# pass 2
# fail 1
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "node-test");
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 1);
  assert.equal(r.hasFailure, true);
});

test("node:test: all pass with no fail line", () => {
  const stdout = `
# tests 5
# pass 5
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "node-test");
  assert.equal(r.pass, 5);
  assert.equal(r.fail, 0);
  assert.equal(r.hasFailure, false);
});

// ── pytest ───────────────────────────────────────────────────────

test("pytest: failures with pass", () => {
  const stdout = `=== 2 failed, 3 passed in 0.14s ===`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "pytest");
  assert.equal(r.fail, 2);
  assert.equal(r.pass, 3);
  assert.equal(r.hasFailure, true);
});

test("pytest: all passing", () => {
  const stdout = `=== 5 passed in 0.02s ===`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "pytest");
  assert.equal(r.pass, 5);
  assert.equal(r.fail, 0);
  assert.equal(r.hasFailure, false);
});

// ── TAP ──────────────────────────────────────────────────────────

test("TAP: mix of ok + not ok", () => {
  const stdout = `
TAP version 13
ok 1 first
not ok 2 second
ok 3 third
not ok 4 fourth
`;
  const r = parseTestOutput(stdout);
  assert.equal(r.format, "tap");
  assert.equal(r.pass, 2);
  assert.equal(r.fail, 2);
  assert.equal(r.hasFailure, true);
});

// ── Fail-closed ──────────────────────────────────────────────────

test("unrecognized format → hasFailure:null (fail-closed)", () => {
  const r = parseTestOutput("random text with no test summary");
  assert.equal(r.format, null);
  assert.equal(r.hasFailure, null);
});

test("empty input → hasFailure:null", () => {
  const r = parseTestOutput("");
  assert.equal(r.format, null);
  assert.equal(r.hasFailure, null);
});

test("reads from stderr too", () => {
  const r = parseTestOutput("", "Tests:       1 failed, 2 passed, 3 total");
  assert.equal(r.format, "jest");
  assert.equal(r.hasFailure, true);
});

// ── looksLikeTestCommand ─────────────────────────────────────────

test("looksLikeTestCommand matches all 5 runners", () => {
  const cases = [
    "npm test",
    "npm run test",
    "npx jest",
    "npx vitest",
    "jest --watch",
    "vitest run",
    "node --test tests/",
    "pytest -x",
    "cd x && npm test",
  ];
  for (const c of cases) {
    assert.equal(looksLikeTestCommand(c), true, `should match: ${c}`);
  }
});

test("looksLikeTestCommand rejects unrelated commands", () => {
  const cases = ["ls -la", "git status", "echo hello", "npm install", ""];
  for (const c of cases) {
    assert.equal(looksLikeTestCommand(c), false, `should NOT match: ${c}`);
  }
});

test("TEST_COMMAND_RE is exported for external use", () => {
  assert.ok(TEST_COMMAND_RE instanceof RegExp);
});
