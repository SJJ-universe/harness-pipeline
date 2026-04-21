// Slice Q (v6) — TDD Guard Stage 2 (failing-proof) tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TddGuard } = require("../../executor/tdd-guard");
const { PipelineState } = require("../../executor/pipeline-state");

function phaseStage2() {
  return {
    id: "D",
    tddGuard: {
      stage: "failing-proof",
      srcPattern: "^src/.*\\.js$",
      testPattern: "^tests/.*\\.test\\.js$",
      message: "[TDD Guard Stage 2]",
    },
  };
}

function recordEditInPhase(state, phaseId, tool, filePath) {
  state.recordTool(phaseId, tool, {}, { file_path: filePath });
}

test("stage 2: src Edit blocked even with prior test Edit if no failing test recorded", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  // No recordTestRun → no failing test
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /Stage 2|실패하는 테스트/);
});

test("stage 2: src Edit allowed after test Edit + failing test run", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  state.recordTestRun({
    phaseId: "D",
    command: "npm test",
    stdout: "Tests:       1 failed, 0 passed, 1 total",
  });
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, true);
});

test("stage 2: all-passing test run does NOT satisfy (must be failing)", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  state.recordTestRun({
    phaseId: "D",
    command: "npm test",
    stdout: "Tests:       0 failed, 3 passed, 3 total",
  });
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("stage 2: unknown-format test output does NOT satisfy (fail-closed)", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  state.recordTestRun({
    phaseId: "D",
    command: "custom-runner",
    stdout: "garbled output without summary",
  });
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("stage 2: stage-1 rule still enforced — no test Edit → block before checking test run", () => {
  const state = new PipelineState();
  // No test edit, but a failing test run exists
  state.recordTestRun({ phaseId: "D", command: "npm test", stdout: "Tests:       1 failed, 0 passed, 1 total" });
  const phase = {
    id: "D",
    tddGuard: {
      stage: "failing-proof",
      srcPattern: "^src/.*\\.js$",
      testPattern: "^tests/.*\\.test\\.js$",
      // Intentionally no `message`: pick up the stage-1 default text so we
      // can verify which rule actually fired.
    },
  };
  const guard = new TddGuard(state);
  const v = guard.evaluate(phase, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /Stage 1/);
});

test("stage 2: test Edit itself always allowed", () => {
  const state = new PipelineState();
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "tests/a.test.js" });
  assert.equal(v.allow, true);
});

test("stage 2: out-of-scope file passes (docs/config)", () => {
  const state = new PipelineState();
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "README.md" });
  assert.equal(v.allow, true);
});

test("stage 2: different phase's failing test doesn't count", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  // Failing test recorded under phase E, not D
  state.recordTestRun({
    phaseId: "E",
    command: "npm test",
    stdout: "Tests:       1 failed, 0 passed, 1 total",
  });
  const guard = new TddGuard(state);
  const v = guard.evaluate(phaseStage2(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("stage 2: custom failingProofMessage overrides the default", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  const phase = phaseStage2();
  phase.tddGuard.failingProofMessage = "[UNIQUE-PROOF-MSG]";
  const guard = new TddGuard(state);
  const v = guard.evaluate(phase, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /UNIQUE-PROOF-MSG/);
});

test("stage 1 template unchanged — no failing test required", () => {
  const state = new PipelineState();
  recordEditInPhase(state, "D", "Edit", "tests/a.test.js");
  const phase = {
    id: "D",
    tddGuard: {
      stage: "edit-first",
      srcPattern: "^src/",
      testPattern: "^tests/",
    },
  };
  const guard = new TddGuard(state);
  const v = guard.evaluate(phase, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, true, "stage 1 just needs test edit — no failing test required");
});
