// Slice V (v6) — file conflict detection end-to-end via HookRouter +
// Orchestrator lazy run creation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { HookRouter } = require("../../executor/hook-router");
const { createFileConflictDetector } = require("../../src/runtime/fileConflictDetector");

function mkTempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-fileconflict-"));
}

function mkTemplates() {
  return {
    default: {
      id: "default",
      phases: [
        { id: "D", label: "D", name: "Build", agent: "claude", allowedTools: ["Read", "Edit", "Write"] },
      ],
    },
  };
}

test("two runs editing the same file → file_conflict_warning broadcast", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);

  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 3,
    createExecutor: (runId) => new PipelineExecutor({
      broadcast,
      templates: mkTemplates(),
      codex: { exec: async () => ({ ok: true, findings: [] }) },
      state: new PipelineState(),
      repoRoot: mkTempRepo(),
      workspaceDir: mkTempRepo(),
      runId,
    }),
  });

  const router = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });
  router.attachExecutor(orch.getActive());
  router.attachOrchestrator(orch);
  router.attachFileConflictDetector(createFileConflictDetector({ broadcast }));

  // Pre-bootstrap both executors so onPostTool can record
  orch.getActive().setEnabled(true);
  await orch.getActive().startFromPrompt("implement a feature");

  // Lazily create sess-B
  const execB = orch.getOrCreateRun("sess-B");
  execB.setEnabled(true);
  await execB.startFromPrompt("implement a feature");

  // Edit-then-post for default on src/shared.js
  await router.route("post-tool", {
    session_id: "default",
    tool_name: "Edit",
    tool_input: { file_path: "src/shared.js" },
    tool_response: {},
  });
  // Same file from sess-B → should conflict
  await router.route("post-tool", {
    session_id: "sess-B",
    tool_name: "Edit",
    tool_input: { file_path: "src/shared.js" },
    tool_response: {},
  });

  const conflicts = events.filter((e) => e.type === "file_conflict_warning");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].data.filePath, "src/shared.js");
  assert.equal(conflicts[0].data.runId, "sess-B");
  assert.deepEqual(conflicts[0].data.conflictWithRunIds, ["default"]);
});

test("orchestrator lazily creates runs on demand up to maxConcurrent", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);

  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 2,
    createExecutor: (runId) => ({
      runId,
      route: () => ({ ok: true }),
      _currentPhase: () => ({ id: "A" }),
      active: null,
    }),
  });

  // runId 1 exists (default). runId 2 = lazy create
  const r1 = orch.getOrCreateRun("sess-X");
  assert.ok(r1);
  assert.equal(orch.list().length, 2);

  // At capacity — third attempt returns null and broadcasts capacity reached
  const r2 = orch.getOrCreateRun("sess-Y");
  assert.equal(r2, null);
  const capReached = events.filter((e) => e.type === "run_capacity_reached");
  assert.equal(capReached.length, 1);
  assert.equal(capReached[0].data.requestedRunId, "sess-Y");
});

test("run_created broadcast fires when a new run is born", () => {
  const events = [];
  const broadcast = (e) => events.push(e);
  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 3,
    createExecutor: (runId) => ({
      runId,
      route: () => ({}),
      _currentPhase: () => null,
      active: null,
    }),
  });
  orch.getOrCreateRun("sess-new");
  const created = events.filter((e) => e.type === "run_created");
  assert.equal(created.length, 1);
  assert.equal(created[0].data.runId, "sess-new");
  assert.equal(created[0].data.active, 2);
});

test("hookRouter routes unknown session_id to a lazily-created run", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);

  const orch = new PipelineOrchestrator({
    broadcast,
    maxConcurrent: 3,
    createExecutor: (runId) => ({
      runId,
      calls: [],
      onPreTool(tool) { this.calls.push({ tool }); return {}; },
    }),
  });

  const router = new HookRouter({ broadcast });
  router.attachExecutor(orch.getActive());
  router.attachOrchestrator(orch);

  await router.route("pre-tool", {
    session_id: "fresh-session",
    tool_name: "Read",
    tool_input: {},
  });

  // fresh-session now exists
  assert.ok(orch.get("fresh-session"));
  const exec = orch.get("fresh-session");
  assert.equal(exec.calls.length, 1);
});
