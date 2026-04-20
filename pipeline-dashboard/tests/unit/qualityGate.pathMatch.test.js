// Slice B (v4) — files-edited criterion: pathMatch + scope="phase" variants.
// The global (no scope) flavor is also retested here to make sure we didn't
// regress the pre-existing shape when we introduced the new options.

const test = require("node:test");
const assert = require("node:assert/strict");
const { QualityGate } = require("../../executor/quality-gate");
const { PipelineState } = require("../../executor/pipeline-state");

function makeState() {
  const s = new PipelineState();
  s.reset();
  return s;
}

test("files-edited without options keeps the legacy global behavior", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("D", "Edit", {}, { file_path: "/src/x.js" });
  s.recordTool("D", "Write", {}, { file_path: "/src/y.js" });
  const phase = { id: "D", name: "D", exitCriteria: [] };

  const pass = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 2 }] }, s
  );
  assert.equal(pass.pass, true);
  const fail = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 3 }] }, s
  );
  assert.equal(fail.pass, false);
});

test("pathMatch filters the global file set", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("D", "Edit", {}, { file_path: "/src/math.js" });
  s.recordTool("D", "Edit", {}, { file_path: "/tests/math.test.js" });
  s.recordTool("D", "Edit", {}, { file_path: "/docs/readme.md" });

  const phase = { id: "D", name: "D" };
  const onlyTests = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 1, pathMatch: "\\.test\\.js$" }] }, s
  );
  assert.equal(onlyTests.pass, true);
  const needTwoTests = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 2, pathMatch: "\\.test\\.js$" }] }, s
  );
  assert.equal(needTwoTests.pass, false);
});

test("scope: phase restricts counting to the current phase's recorded edits", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("D", "Edit", {}, { file_path: "/tests/a.test.js" });
  s.recordTool("E", "Edit", {}, { file_path: "/tests/b.test.js" }); // other phase
  const phase = { id: "D", name: "D" };

  const pass = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 1, scope: "phase" }] }, s
  );
  assert.equal(pass.pass, true);

  const phaseE = { id: "E", name: "E" };
  const passE = await gate.evaluate(
    { ...phaseE, exitCriteria: [{ type: "files-edited", min: 1, scope: "phase" }] }, s
  );
  assert.equal(passE.pass, true);

  // Combined: scope phase + pathMatch for the typical testing template shape
  const combined = await gate.evaluate(
    { ...phase, exitCriteria: [
      { type: "files-edited", min: 1, scope: "phase", pathMatch: "\\.test\\.js$" },
    ] }, s
  );
  assert.equal(combined.pass, true);
});

test("scope: phase ignores Read/Grep even if they touched matching paths", async () => {
  const gate = new QualityGate();
  const s = makeState();
  // Read should never count toward files-edited — it's a no-mutation tool.
  s.recordTool("D", "Read", {}, { file_path: "/tests/a.test.js" });
  const phase = { id: "D", name: "D" };
  const pass = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 1, scope: "phase" }] }, s
  );
  assert.equal(pass.pass, false, "Read alone must not satisfy files-edited");
});

test("invalid pathMatch regex fails the criterion rather than silently passing", async () => {
  const gate = new QualityGate();
  const s = makeState();
  s.recordTool("D", "Edit", {}, { file_path: "/src/x.js" });
  const phase = { id: "D", name: "D" };
  const bad = await gate.evaluate(
    { ...phase, exitCriteria: [{ type: "files-edited", min: 1, pathMatch: "([unclosed" }] }, s
  );
  assert.equal(bad.pass, false);
  assert.ok(bad.missing.length === 1);
});
