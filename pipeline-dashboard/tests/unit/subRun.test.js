// Slice W (v6) — SubRun unit tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const { SubRun, MAX_TOOLS_PER_SUBRUN } = require("../../executor/sub-run");

test("constructor requires a sessionId", () => {
  assert.throws(() => new SubRun({}), /sessionId/);
});

test("constructor seeds startedAt, leaves completedAt null", () => {
  const r = new SubRun({ sessionId: "sess-A" });
  assert.ok(r.startedAt > 0);
  assert.equal(r.completedAt, null);
});

test("recordTool appends + increments byTool + defaults nulls", () => {
  const r = new SubRun({ sessionId: "s" });
  r.recordTool("Edit", { filePath: "src/a.js" });
  r.recordTool("Edit", { filePath: "src/b.js" });
  r.recordTool("Bash", { command: "npm test" });
  assert.equal(r.tools.length, 3);
  assert.equal(r.byTool.Edit, 2);
  assert.equal(r.byTool.Bash, 1);
  assert.equal(r.tools[0].filePath, "src/a.js");
  assert.equal(r.tools[2].command, "npm test");
});

test("recordTool caps to MAX_TOOLS_PER_SUBRUN", () => {
  const r = new SubRun({ sessionId: "s" });
  for (let i = 0; i < MAX_TOOLS_PER_SUBRUN + 15; i++) {
    r.recordTool("Edit", { filePath: `f${i}.js` });
  }
  assert.equal(r.tools.length, MAX_TOOLS_PER_SUBRUN);
  // byTool is a raw counter, not capped
  assert.equal(r.byTool.Edit, MAX_TOOLS_PER_SUBRUN + 15);
});

test("setArtifact stores key/value", () => {
  const r = new SubRun({ sessionId: "s" });
  r.setArtifact("plan", "path/to/plan.md");
  assert.equal(r.artifacts.plan, "path/to/plan.md");
});

test("complete() sets completedAt once; second call is a no-op", () => {
  const r = new SubRun({ sessionId: "s" });
  assert.equal(r.complete(), true);
  const first = r.completedAt;
  assert.equal(r.complete(), false);
  assert.equal(r.completedAt, first);
});

test("durationMs grows before completion, freezes after", async () => {
  const r = new SubRun({ sessionId: "s" });
  await new Promise((res) => setTimeout(res, 10));
  const d1 = r.durationMs();
  r.complete();
  await new Promise((res) => setTimeout(res, 10));
  const d2 = r.durationMs();
  assert.ok(d1 >= 9);
  assert.ok(d2 >= d1);
  // After complete, duration shouldn't grow beyond completedAt - startedAt
  assert.equal(d2, r.completedAt - r.startedAt);
});

test("snapshot is stable + cloneable", () => {
  const r = new SubRun({ sessionId: "s", agentId: "agent-1", agentType: "codex" });
  r.recordTool("Edit", { filePath: "src/a.js" });
  r.setArtifact("plan", "p.md");
  const snap = r.snapshot();
  snap.byTool.Edit = 999; // mutation
  assert.equal(r.byTool.Edit, 1, "mutation on snapshot should not affect SubRun");
  assert.deepEqual(snap.artifactKeys, ["plan"]);
  assert.equal(snap.agentType, "codex");
});
