// Slice Q (v6) — PipelineState.recordTestRun + hasFailingTestRun contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PipelineState, MAX_TEST_RUNS } = require("../../executor/pipeline-state");

test("MAX_TEST_RUNS is 50 (regression guard)", () => {
  assert.equal(MAX_TEST_RUNS, 50);
});

test("recordTestRun parses jest output + appends to metrics.testRuns", () => {
  const s = new PipelineState();
  const entry = s.recordTestRun({
    phaseId: "E",
    command: "npm test",
    exitCode: 1,
    stdout: "Tests:       2 failed, 3 passed, 5 total",
  });
  assert.equal(s.metrics.testRuns.length, 1);
  assert.equal(entry.format, "jest");
  assert.equal(entry.pass, 3);
  assert.equal(entry.fail, 2);
  assert.equal(entry.hasFailure, true);
});

test("recordTestRun caps stdoutSample to 4KB", () => {
  const s = new PipelineState();
  const huge = "x".repeat(10000);
  const entry = s.recordTestRun({ phaseId: "E", command: "npm test", stdout: huge });
  assert.equal(entry.stdoutSample.length, 4096);
});

test("recordTestRun evicts oldest when over MAX_TEST_RUNS", () => {
  const s = new PipelineState();
  for (let i = 0; i < MAX_TEST_RUNS + 10; i++) {
    s.recordTestRun({ phaseId: "E", command: `test#${i}`, stdout: "Tests:       0 failed, 1 passed, 1 total" });
  }
  assert.equal(s.metrics.testRuns.length, MAX_TEST_RUNS);
  assert.match(s.metrics.testRuns[0].command, /test#10/);
});

test("hasFailingTestRun returns true when a failing jest result exists for that phase", () => {
  const s = new PipelineState();
  s.recordTestRun({ phaseId: "E", command: "npm test", stdout: "Tests:       1 failed, 2 passed, 3 total" });
  assert.equal(s.hasFailingTestRun("E"), true);
  assert.equal(s.hasFailingTestRun("D"), false);
});

test("hasFailingTestRun returns false when all test runs passed", () => {
  const s = new PipelineState();
  s.recordTestRun({ phaseId: "E", command: "npm test", stdout: "Tests:       3 passed, 3 total" });
  assert.equal(s.hasFailingTestRun("E"), false);
});

test("hasFailingTestRun does NOT accept unknown format (fail-closed)", () => {
  const s = new PipelineState();
  s.recordTestRun({
    phaseId: "E",
    command: "some-random-test-runner",
    stdout: "weird output with no recognizable summary",
  });
  // parser returns hasFailure: null → not satisfying
  assert.equal(s.hasFailingTestRun("E"), false);
});

test("recordTestRun with empty stdout sets hasFailure=null (not counted)", () => {
  const s = new PipelineState();
  s.recordTestRun({ phaseId: "E", command: "npm test" });
  assert.equal(s.metrics.testRuns[0].hasFailure, null);
  assert.equal(s.hasFailingTestRun("E"), false);
});

test("reset() clears testRuns", () => {
  const s = new PipelineState();
  s.recordTestRun({ phaseId: "E", command: "npm test", stdout: "Tests:       1 failed, 0 passed, 1 total" });
  s.reset({ userPrompt: "new", templateId: "default" });
  assert.equal(s.metrics.testRuns.length, 0);
});
