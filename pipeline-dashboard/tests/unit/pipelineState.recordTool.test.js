// Slice B (v4) — PipelineState.recordTool signature extension.
//
// The old 3-arg signature `recordTool(phaseId, tool, response)` continues to
// work so existing phase2/phase3 legacy tests don't regress. The new 4th arg,
// `input`, is what Claude Code's hooks pass in the PostToolUse payload and is
// what QualityGate's pathMatch/commandMatch options look at.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PipelineState } = require("../../executor/pipeline-state");

test("legacy 3-arg recordTool still populates metrics", () => {
  const s = new PipelineState();
  s.reset({ userPrompt: "test" });
  s.recordTool("A", "Write", { filePath: "/tmp/plan.md" });
  s.recordTool("A", "Edit", { filePath: "/src/x.js" });
  s.recordTool("A", "Bash", { command: "npm test" });
  assert.equal(s.metrics.toolCount, 3);
  assert.equal(s.metrics.bashCommands, 1);
  assert.equal(s.metrics.filesEdited.size, 2);
  assert.ok(s.metrics.filesEdited.has("/tmp/plan.md"));
  assert.ok(s.metrics.filesEdited.has("/src/x.js"));
});

test("new 4-arg form prefers input.file_path over response", () => {
  const s = new PipelineState();
  s.reset();
  s.recordTool("A", "Edit", { structuredPatch: { filePath: "/ignored.js" } }, { file_path: "/preferred.js" });
  assert.ok(s.metrics.filesEdited.has("/preferred.js"),
    "input.file_path should take precedence");
  assert.ok(!s.metrics.filesEdited.has("/ignored.js"));
});

test("new 4-arg form captures Bash command on the tool entry", () => {
  const s = new PipelineState();
  s.reset();
  s.recordTool("E", "Bash", {}, { command: "npm test -- --filter foo" });
  const tools = s.phaseTools("E");
  assert.equal(tools.length, 1);
  assert.equal(tools[0].tool, "Bash");
  assert.equal(tools[0].command, "npm test -- --filter foo");
});

test("Read tool records filePath on its entry but never enters filesEdited", () => {
  const s = new PipelineState();
  s.reset();
  s.recordTool("A", "Read", {}, { file_path: "/src/x.js" });
  const tools = s.phaseTools("A");
  assert.equal(tools[0].filePath, "/src/x.js", "Read should still record path");
  assert.equal(s.metrics.filesEdited.size, 0, "Read must not count toward filesEdited");
});

test("Bash tool without command input stores empty string", () => {
  const s = new PipelineState();
  s.reset();
  s.recordTool("E", "Bash", {}, {});
  const tools = s.phaseTools("E");
  assert.equal(tools[0].command, "", "missing command should be normalized to ''");
  assert.equal(s.metrics.bashCommands, 1, "Bash counter should still increment");
});

test("Non-file tool (Glob) stores null filePath", () => {
  const s = new PipelineState();
  s.reset();
  s.recordTool("A", "Glob", {}, { pattern: "**/*.js" });
  const tools = s.phaseTools("A");
  assert.equal(tools[0].filePath, null);
  assert.equal(tools[0].command, null);
});

test("phaseTools returns an empty array for unseen phases", () => {
  const s = new PipelineState();
  s.reset();
  assert.deepEqual(s.phaseTools("Z"), []);
});

test("recordTool accepts undefined input without crashing", () => {
  const s = new PipelineState();
  s.reset();
  // Some legacy callers pass only 3 args; others pass undefined explicitly.
  s.recordTool("A", "Edit", { filePath: "/a.js" }, undefined);
  assert.ok(s.metrics.filesEdited.has("/a.js"));
});
