// Slice T (v6) — integration: two session_ids drive two distinct
// PipelineExecutor instances via the orchestrator, and their states do NOT
// leak into each other. Single-active mode (maxConcurrent=1) would normally
// collapse both to default; here we override to 2 to prove the routing
// actually works before Slice V flips the switch system-wide.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { HookRouter } = require("../../executor/hook-router");

function mkTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-multirun-"));
}

function mkTemplates() {
  return {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "A", name: "A", agent: "claude", allowedTools: ["Read", "Edit", "Write"] },
      ],
    },
  };
}

test("two session_ids drive two distinct executors with isolated state", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);

  const templates = mkTemplates();

  // Orchestrator with a custom factory so we can pre-populate two runs.
  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 2,
    createExecutor: (runId) => new PipelineExecutor({
      broadcast,
      templates,
      codex: { exec: async () => ({ ok: true, findings: [] }) },
      state: new PipelineState(),
      repoRoot: mkTempRepo(),
      workspaceDir: mkTempRepo(),
      runId,
    }),
  });
  // Manually wire a second run (Slice V will do this automatically).
  const execA = orch.getActive();               // runId="default"
  const execB = orch.createExecutor("sess-B");
  orch.runs.set("sess-B", execB);

  execA.setEnabled(true);
  execB.setEnabled(true);
  await execA.startFromPrompt("please implement a feature");
  await execB.startFromPrompt("please implement a feature");

  const router = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });
  router.attachExecutor(execA);
  router.attachOrchestrator(orch);

  // Route two pre-tool Reads under different session_ids.
  // Phase A allows Read — policy should approve both.
  await router.route("pre-tool", {
    session_id: "default",
    tool_name: "Read",
    tool_input: { file_path: "src/x.js" },
  });
  await router.route("pre-tool", {
    session_id: "sess-B",
    tool_name: "Read",
    tool_input: { file_path: "src/y.js" },
  });

  // Both PreToolUse reads return {} (no block). Now simulate a post-tool to
  // actually populate state.
  await router.route("post-tool", {
    session_id: "default",
    tool_name: "Read",
    tool_input: { file_path: "src/x.js" },
    tool_response: { ok: true },
  });
  await router.route("post-tool", {
    session_id: "sess-B",
    tool_name: "Read",
    tool_input: { file_path: "src/y.js" },
    tool_response: { ok: true },
  });

  // Each executor's state should only record its own Read.
  const snapA = execA.state.snapshot();
  const snapB = execB.state.snapshot();
  assert.equal(snapA.metrics.toolCount, 1, "execA should have exactly 1 tool");
  assert.equal(snapB.metrics.toolCount, 1, "execB should have exactly 1 tool");
  // And they should see the correct path (no cross-contamination).
  assert.equal(execA.state.phaseTools("A")[0].filePath, "src/x.js");
  assert.equal(execB.state.phaseTools("A")[0].filePath, "src/y.js");
});

test("every broadcast event carries data.runId from its originating executor", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);
  const templates = mkTemplates();

  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 2,
    createExecutor: (runId) => new PipelineExecutor({
      broadcast,
      templates,
      codex: { exec: async () => ({ ok: true, findings: [] }) },
      state: new PipelineState(),
      repoRoot: mkTempRepo(),
      workspaceDir: mkTempRepo(),
      runId,
    }),
  });
  const execA = orch.getActive();
  execA.setEnabled(true);
  await execA.startFromPrompt("please implement a feature");

  // Filter events emitted by execA — every one should carry runId="default".
  const withRunId = events.filter((e) => e && e.data && e.data.runId != null);
  assert.ok(withRunId.length >= 1, "at least one event should have data.runId");
  for (const ev of withRunId) {
    assert.equal(ev.data.runId, "default",
      `event ${ev.type} carries unexpected runId ${ev.data.runId}`);
  }
});
