// Slice B (v4) — scope: "phase" variants that aren't covered by the path/command
// match files. Mainly: "scope: phase" without any match regex should still work
// for both files-edited and bash-ran.

const test = require("node:test");
const assert = require("node:assert/strict");
const { QualityGate } = require("../../executor/quality-gate");
const { PipelineState } = require("../../executor/pipeline-state");

function fresh() {
  const s = new PipelineState();
  s.reset();
  return s;
}

test("files-edited scope: phase counts only current phase edits without pathMatch", async () => {
  const gate = new QualityGate();
  const s = fresh();
  s.recordTool("D", "Edit", {}, { file_path: "/a.js" });
  s.recordTool("E", "Edit", {}, { file_path: "/b.js" });
  const pass = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 1, scope: "phase" }] },
    s
  );
  assert.equal(pass.pass, true);
  const fail = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 2, scope: "phase" }] },
    s
  );
  assert.equal(fail.pass, false);
});

test("bash-ran scope: phase counts only current phase Bash calls without commandMatch", async () => {
  const gate = new QualityGate();
  const s = fresh();
  s.recordTool("E", "Bash", {}, { command: "whoami" });
  s.recordTool("E", "Bash", {}, { command: "ls" });
  s.recordTool("F", "Bash", {}, { command: "pwd" });
  const pass = await gate.evaluate(
    { id: "E", name: "E",
      exitCriteria: [{ type: "bash-ran", min: 2, scope: "phase" }] },
    s
  );
  assert.equal(pass.pass, true);
  const fail = await gate.evaluate(
    { id: "E", name: "E",
      exitCriteria: [{ type: "bash-ran", min: 3, scope: "phase" }] },
    s
  );
  assert.equal(fail.pass, false, "phase-scoped must not see F's Bash");
});

test("deduplication: editing the same file twice in a phase counts once", async () => {
  const gate = new QualityGate();
  const s = fresh();
  s.recordTool("D", "Edit", {}, { file_path: "/a.js" });
  s.recordTool("D", "Edit", {}, { file_path: "/a.js" });
  const fail = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 2, scope: "phase" }] },
    s
  );
  assert.equal(fail.pass, false, "same file twice should still count as 1");
  const pass = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 1, scope: "phase" }] },
    s
  );
  assert.equal(pass.pass, true);
});

test("missing scope keeps legacy global semantics when phase has no recorded tools", async () => {
  const gate = new QualityGate();
  const s = fresh();
  // No tools recorded yet — global counter is zero.
  // Note: the legacy `c.min || 1` fallback treats min=0 as falsy and promotes
  // it to 1, so an "any-or-none" criterion has to be written a different way
  // (e.g. omit the criterion entirely). We assert the min=1 failure path
  // instead, which is the only actually reachable legacy semantics.
  const fail = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 1 }] },
    s
  );
  assert.equal(fail.pass, false);

  // Populate one edit → passes at min=1 with no scope (legacy global path).
  s.recordTool("D", "Edit", {}, { file_path: "/a.js" });
  const pass = await gate.evaluate(
    { id: "D", name: "D",
      exitCriteria: [{ type: "files-edited", min: 1 }] },
    s
  );
  assert.equal(pass.pass, true);
});
