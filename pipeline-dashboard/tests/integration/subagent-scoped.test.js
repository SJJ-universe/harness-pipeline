// Slice W (v6) — Subagent-scoped state end-to-end: SubagentStart creates
// a SubRun, PostToolUse calls with that session_id accumulate there, and
// SubagentStop broadcasts the aggregated metrics.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { HookRouter } = require("../../executor/hook-router");

function mk() {
  const events = [];
  const broadcast = (e) => events.push(e);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-subrun-"));
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "E", label: "E", name: "Build", agent: "claude", allowedTools: ["Read", "Edit", "Write", "Bash"] },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast,
    templates,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  const router = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });
  router.attachExecutor(ex);
  return { ex, router, events };
}

test("SubagentStart creates a SubRun in the active run", async () => {
  const { ex } = mk();
  await ex.startFromPrompt("implement a feature");
  await ex.onSubagentStart({
    session_id: "subagent-1",
    agent_id: "agent-A",
    agent_type: "codex",
    parent_session_id: "parent-42",
  });
  assert.ok(ex.active.subRuns instanceof Map);
  const subRun = ex.active.subRuns.get("subagent-1");
  assert.ok(subRun, "SubRun must exist after SubagentStart");
  assert.equal(subRun.agentType, "codex");
  assert.equal(subRun.parentSessionId, "parent-42");
});

test("PostToolUse from subagent session accumulates into its SubRun", async () => {
  const { ex, router } = mk();
  await ex.startFromPrompt("implement a feature");
  await ex.onSubagentStart({
    session_id: "sub-1",
    agent_id: "a",
    agent_type: "codex",
  });
  // Simulate a subagent-issued Edit
  await router.route("post-tool", {
    session_id: "sub-1",
    tool_name: "Edit",
    tool_input: { file_path: "src/x.js" },
    tool_response: {},
  });
  await router.route("post-tool", {
    session_id: "sub-1",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: {},
  });
  const subRun = ex.active.subRuns.get("sub-1");
  assert.equal(subRun.tools.length, 2);
  assert.equal(subRun.byTool.Edit, 1);
  assert.equal(subRun.byTool.Bash, 1);
  // Parent state ALSO records (aggregated view)
  assert.equal(ex.state.metrics.toolCount, 2);
});

test("SubagentStop broadcasts completion metrics { toolCount, byTool, durationMs }", async () => {
  const { ex, events } = mk();
  await ex.startFromPrompt("implement a feature");
  await ex.onSubagentStart({ session_id: "sub-A", agent_type: "codex" });
  // Directly record into subRun (bypass router for simplicity)
  const subRun = ex.active.subRuns.get("sub-A");
  subRun.recordTool("Edit", { filePath: "x.js" });
  subRun.recordTool("Read", { filePath: "y.js" });
  subRun.recordTool("Edit", { filePath: "z.js" });
  await new Promise((r) => setTimeout(r, 8));
  await ex.onSubagentStop({ session_id: "sub-A" });
  const completed = events.find((e) => e.type === "subagent_completed" && e.data.session_id === "sub-A");
  assert.ok(completed);
  assert.deepEqual(completed.data.metrics.byTool, { Edit: 2, Read: 1 });
  assert.equal(completed.data.metrics.toolCount, 3);
  assert.ok(completed.data.metrics.durationMs >= 7);
});

test("tool from an unknown session_id (not a SubRun) only hits parent state", async () => {
  const { ex, router } = mk();
  await ex.startFromPrompt("implement a feature");
  await router.route("post-tool", {
    session_id: "no-matching-subrun",
    tool_name: "Read",
    tool_input: { file_path: "src/a.js" },
    tool_response: {},
  });
  assert.equal(ex.state.metrics.toolCount, 1);
  // No SubRun map entry leaked
  if (ex.active.subRuns) {
    assert.equal(ex.active.subRuns.size, 0);
  }
});

test("completed SubRun rejects further tool records (subRun.completedAt guard)", async () => {
  const { ex, router } = mk();
  await ex.startFromPrompt("implement a feature");
  await ex.onSubagentStart({ session_id: "sub-done", agent_type: "codex" });
  await ex.onSubagentStop({ session_id: "sub-done" });
  // Now a stray PostToolUse with that session_id arrives
  await router.route("post-tool", {
    session_id: "sub-done",
    tool_name: "Edit",
    tool_input: { file_path: "x.js" },
    tool_response: {},
  });
  const subRun = ex.active.subRuns.get("sub-done");
  // The initial subRun had 0 tool calls when it completed, and the late
  // call should be ignored by the completedAt guard.
  assert.equal(subRun.tools.length, 0);
});
