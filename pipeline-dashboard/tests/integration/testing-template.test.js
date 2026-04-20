// Slice B (v4) — `testing` template end-to-end walkthrough.
//
// Verifies that the completed `testing` template (Slice B-4) actually exercises
// the new pathMatch + commandMatch + scope: "phase" criteria without
// regressing when used via QualityGate.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { QualityGate } = require("../../executor/quality-gate");
const { PipelineState } = require("../../executor/pipeline-state");

const templates = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "..", "..", "pipeline-templates.json"),
    "utf-8"
  )
);
const testing = templates.testing;

test("testing template exists with 5 fully-specified phases", () => {
  assert.ok(testing, "testing template missing");
  assert.equal(testing.phases.length, 5);
  for (const p of testing.phases) {
    // Every phase should now have an agent AND either allowedTools or cycle.
    assert.ok(p.id, "phase id missing");
    assert.ok(p.agent, `phase ${p.id} missing agent`);
    assert.ok(
      p.agent === "codex" || Array.isArray(p.allowedTools),
      `phase ${p.id} (claude) missing allowedTools`
    );
  }
});

test("Phase A min-tools-in-phase gates discovery", async () => {
  const gate = new QualityGate();
  const state = new PipelineState();
  state.reset();
  const phaseA = testing.phases.find((p) => p.id === "A");

  let r = await gate.evaluate(phaseA, state);
  assert.equal(r.pass, false, "empty state must fail A's min-tools");
  state.recordTool("A", "Read", {}, { file_path: "/src/foo.js" });
  state.recordTool("A", "Grep", {}, { pattern: "test" });
  r = await gate.evaluate(phaseA, state);
  assert.equal(r.pass, true, "2 discovery tools must satisfy min-tools-in-phase");
});

test("Phase B requires a test-plan artifact", async () => {
  const gate = new QualityGate();
  const state = new PipelineState();
  state.reset();
  const phaseB = testing.phases.find((p) => p.id === "B");
  let r = await gate.evaluate(phaseB, state);
  assert.equal(r.pass, false);
  state.setArtifact("B", "test-plan", { path: "/tmp/test-plan.md" });
  r = await gate.evaluate(phaseB, state);
  assert.equal(r.pass, true);
});

test("Phase C passes only after a Codex critique has been recorded", async () => {
  const gate = new QualityGate();
  const state = new PipelineState();
  state.reset();
  const phaseC = testing.phases.find((p) => p.id === "C");
  let r = await gate.evaluate(phaseC, state);
  assert.equal(r.pass, false, "no critique yet → fail");
  state.setCritique("C", { ok: true, summary: "...", findings: [] });
  r = await gate.evaluate(phaseC, state);
  assert.equal(r.pass, true);
});

test("Phase D pathMatch accepts tests/ paths, rejects src/ paths", async () => {
  const gate = new QualityGate();
  const phaseD = testing.phases.find((p) => p.id === "D");

  // Accept path
  for (const p of [
    "/project/tests/foo.test.js",
    "/project/__tests__/bar.spec.ts",
    "project\\tests\\nested\\baz.test.mjs",
    "tests/integration/qux.spec.cjs",
  ]) {
    const state = new PipelineState();
    state.reset();
    state.recordTool("D", "Edit", {}, { file_path: p });
    const r = await gate.evaluate(phaseD, state);
    assert.equal(r.pass, true, `expected ${p} to satisfy D pathMatch`);
  }

  // Reject path (source file, not a test)
  const state = new PipelineState();
  state.reset();
  state.recordTool("D", "Edit", {}, { file_path: "/project/src/main.js" });
  const r = await gate.evaluate(phaseD, state);
  assert.equal(r.pass, false, "src file must not satisfy testing Phase D");
});

test("Phase E commandMatch accepts test runners, rejects generic Bash", async () => {
  const gate = new QualityGate();
  const phaseE = testing.phases.find((p) => p.id === "E");

  // Accept
  for (const cmd of ["npm test", "npm run test", "jest --watch", "vitest run", "node --test", "pytest -xvs"]) {
    const state = new PipelineState();
    state.reset();
    state.recordTool("E", "Bash", {}, { command: cmd });
    const r = await gate.evaluate(phaseE, state);
    // no-critical-findings is also an exitCriterion; it passes automatically
    // because state.findings is empty.
    assert.equal(r.pass, true, `expected command "${cmd}" to satisfy Phase E bash-ran`);
  }

  // Reject
  const state = new PipelineState();
  state.reset();
  state.recordTool("E", "Bash", {}, { command: "ls -la" });
  const r = await gate.evaluate(phaseE, state);
  assert.equal(r.pass, false);
});

test("Phase E fails when critical finding is present even with passing bash-ran", async () => {
  const gate = new QualityGate();
  const phaseE = testing.phases.find((p) => p.id === "E");
  const state = new PipelineState();
  state.reset();
  state.recordTool("E", "Bash", {}, { command: "npm test" });
  // Inject a critical finding from an earlier critique (scope-wise: global by default)
  state.setCritique("C", {
    ok: true,
    summary: "...",
    findings: [{ severity: "critical", message: "boom" }],
  });
  const r = await gate.evaluate(phaseE, state);
  assert.equal(r.pass, false);
  assert.ok(r.missing.some((m) => /critical/i.test(m)));
});
