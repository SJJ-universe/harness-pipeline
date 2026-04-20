// Slice B (v4) — bash-ran criterion: commandMatch + scope="phase" variants.
// This is what gates Phase E of the testing template: "only pass if a real
// test runner command was executed this phase, not just any Bash."

const test = require("node:test");
const assert = require("node:assert/strict");
const { QualityGate } = require("../../executor/quality-gate");
const { PipelineState } = require("../../executor/pipeline-state");

function makeState() {
  const s = new PipelineState();
  s.reset();
  return s;
}

test("bash-ran without options preserves the legacy counter behavior", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("E", "Bash", {}, { command: "ls -la" });
  s.recordTool("E", "Bash", {}, { command: "ls -la" });
  const phase = { id: "E", name: "E" };
  const pass = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "bash-ran", min: 2 }] }, s
  );
  assert.equal(pass.pass, true);
});

test("commandMatch only counts commands matching the regex", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("E", "Bash", {}, { command: "ls -la" });
  s.recordTool("E", "Bash", {}, { command: "npm test" });
  const phase = { id: "E", name: "E" };

  const pass = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "bash-ran", min: 1, commandMatch: "npm\\s+test" }] }, s
  );
  assert.equal(pass.pass, true);

  const fail = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "bash-ran", min: 2, commandMatch: "npm\\s+test" }] }, s
  );
  assert.equal(fail.pass, false);
});

test("scope: phase restricts commandMatch to the current phase", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("E", "Bash", {}, { command: "npm test" });   // in phase
  s.recordTool("F", "Bash", {}, { command: "npm test" });   // out of phase
  const pass = await gate.evaluate(
    {
      id: "E", name: "E",
      exitCriteria: [{ type: "bash-ran", min: 2, scope: "phase", commandMatch: "npm\\s+test" }],
    },
    s
  );
  assert.equal(pass.pass, false, "must not count Bash from other phases");

  const passF = await gate.evaluate(
    {
      id: "F", name: "F",
      exitCriteria: [{ type: "bash-ran", min: 1, scope: "phase", commandMatch: "npm\\s+test" }],
    },
    s
  );
  assert.equal(passF.pass, true);
});

test("commandMatch requires command text; Bash with empty command never counts", async () => {
  const gate = new QualityGate();
  const s = makeState();
  // Legacy callers that didn't pass input end up with "" commands.
  s.recordTool("E", "Bash", {});
  const pass = await gate.evaluate(
    { id: "E", name: "E",
      exitCriteria: [{ type: "bash-ran", min: 1, commandMatch: "npm\\s+test" }] },
    s
  );
  assert.equal(pass.pass, false);
});

test("invalid commandMatch regex fails the criterion", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("E", "Bash", {}, { command: "npm test" });
  const bad = await gate.evaluate(
    { id: "E", name: "E",
      exitCriteria: [{ type: "bash-ran", min: 1, commandMatch: "([unclosed" }] },
    s
  );
  assert.equal(bad.pass, false);
});

test("testing template Phase E commandMatch accepts common runners", async () => {
  // Mirrors the regex in pipeline-templates.json testing Phase E.
  const gate = new QualityGate();
  const crit = {
    type: "bash-ran",
    min: 1,
    scope: "phase",
    commandMatch: "(?:npm\\s+(?:run\\s+)?test|jest|vitest|node\\s+--test|pytest)",
  };
  const cases = [
    "npm test",
    "npm run test",
    "npm test -- --coverage",
    "jest --coverage",
    "vitest run",
    "node --test tests/",
    "pytest -xvs",
  ];
  for (const cmd of cases) {
    const s = makeState();
    s.recordTool("E", "Bash", {}, { command: cmd });
    const res = await gate.evaluate(
      { id: "E", name: "E", exitCriteria: [crit] }, s
    );
    assert.equal(res.pass, true, `should accept command: ${cmd}`);
  }
  // Non-runner should NOT pass.
  const s = makeState();
  s.recordTool("E", "Bash", {}, { command: "ls" });
  const res = await gate.evaluate(
    { id: "E", name: "E", exitCriteria: [crit] }, s
  );
  assert.equal(res.pass, false);
});
