// Slice Y + Z (Phase 2.5) — per-run state + checkpointStore isolation.
//
// This is the DoD test for the two headline correction-round gaps:
//   P1-1: global PipelineState shared across every run → findings / metrics
//         would overwrite each other when multi-run unlocked.
//   P1-2: global checkpointStore shared across every run → two runs saved
//         to the same `.harness/pipeline-checkpoint.json`.
//
// Both are fixed in server.js:511-548 by moving `new PipelineState()` and
// `createCheckpointStore({ repoRoot, runId })` inside the
// `createExecutor(runId)` factory that PipelineOrchestrator owns. These
// tests reproduce that wiring in a temp repo and prove the isolation is
// real (not just constructor separation).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { createCheckpointStore } = require("../../executor/checkpoint");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");

function mk({ maxConcurrent = 3 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-multirun-iso-"));
  const events = [];
  const broadcast = (e) => events.push(e);
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "Plan", name: "Plan", agent: "claude", allowedTools: ["Read"] },
        { id: "B", label: "Build", name: "Build", agent: "claude", allowedTools: ["Edit"] },
      ],
    },
  };
  const orchestrator = new PipelineOrchestrator({
    broadcast,
    maxConcurrent,
    // Mirrors the server.js factory wiring exactly.
    createExecutor: (runId) =>
      new PipelineExecutor({
        broadcast,
        templates,
        state: new PipelineState(),
        checkpointStore: createCheckpointStore({ repoRoot, runId }),
        repoRoot,
        runId,
      }),
  });
  return { orchestrator, repoRoot, events };
}

test("Slice Y — each run gets its own PipelineState reference", () => {
  const { orchestrator } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  const execB = orchestrator.getOrCreateRun("runB");
  assert.ok(execA && execB, "both runs created");
  assert.notStrictEqual(execA.state, execB.state, "state references must differ");
  assert.notStrictEqual(execA.state.findings, execB.state.findings, "findings arrays differ");
  assert.notStrictEqual(execA.state.metrics, execB.state.metrics, "metrics objects differ");
});

test("Slice Y — mutating one run's state does not leak into another", () => {
  const { orchestrator } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  const execB = orchestrator.getOrCreateRun("runB");

  execA.state.findings.push({ id: "A-1", severity: "info", message: "seen by A only" });
  execB.state.findings.push({ id: "B-1", severity: "warning", message: "seen by B only" });
  execB.state.findings.push({ id: "B-2", severity: "error", message: "still B only" });

  assert.equal(execA.state.findings.length, 1, "A has exactly 1 finding");
  assert.equal(execB.state.findings.length, 2, "B has exactly 2 findings");
  assert.equal(execA.state.findings[0].id, "A-1");
  assert.equal(execB.state.findings[1].id, "B-2");

  // Metrics counters are also independent.
  execA.state.metrics.toolCount = 5;
  execB.state.metrics.toolCount = 42;
  assert.equal(execA.state.metrics.toolCount, 5);
  assert.equal(execB.state.metrics.toolCount, 42);
});

test("Slice Z — each non-default run writes to its own checkpoint file", () => {
  const { orchestrator, repoRoot } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  const execB = orchestrator.getOrCreateRun("runB");

  // Paths are per-run.
  const pathA = execA.checkpointStore.path;
  const pathB = execB.checkpointStore.path;
  assert.equal(pathA, path.join(repoRoot, ".harness", "runs", "runA", "checkpoint.json"));
  assert.equal(pathB, path.join(repoRoot, ".harness", "runs", "runB", "checkpoint.json"));
  assert.notEqual(pathA, pathB, "checkpoint paths must differ");

  // Round-trip save isolation.
  execA.checkpointStore.save(
    {
      templateId: "default",
      template: { id: "default", phases: [{ id: "A" }] },
      phaseIdx: 0,
      iteration: 0,
      gateRetries: 0,
      userPrompt: "work for A",
      startedAt: Date.now(),
    },
    { snapshot: () => ({ belongsTo: "A" }) }
  );
  execB.checkpointStore.save(
    {
      templateId: "default",
      template: { id: "default", phases: [{ id: "A" }] },
      phaseIdx: 1,
      iteration: 0,
      gateRetries: 0,
      userPrompt: "work for B",
      startedAt: Date.now(),
    },
    { snapshot: () => ({ belongsTo: "B" }) }
  );

  const loadedA = execA.checkpointStore.load();
  const loadedB = execB.checkpointStore.load();
  assert.equal(loadedA.userPrompt, "work for A", "A's checkpoint untouched by B");
  assert.equal(loadedB.userPrompt, "work for B", "B's checkpoint untouched by A");
  assert.equal(loadedA.stateSnapshot.belongsTo, "A");
  assert.equal(loadedB.stateSnapshot.belongsTo, "B");
});

test("Slice Z — default run keeps the legacy checkpoint path (singleton compat)", () => {
  const { orchestrator, repoRoot } = mk({ maxConcurrent: 1 });
  const execDefault = orchestrator.getActive();
  assert.equal(
    execDefault.checkpointStore.path,
    path.join(repoRoot, ".harness", "pipeline-checkpoint.json"),
    "default run still uses .harness/pipeline-checkpoint.json"
  );
});

test("Y + Z combined — default run's state is still its own instance (no null regression)", () => {
  // Paranoia check: even with maxConcurrent=1 we should still be getting a
  // fresh PipelineState each time the orchestrator instantiates the default.
  const { orchestrator } = mk({ maxConcurrent: 1 });
  const execDefault = orchestrator.getActive();
  assert.ok(execDefault.state, "default executor has a state instance");
  assert.ok(Array.isArray(execDefault.state.findings), "findings array initialised");
  assert.equal(execDefault.state.findings.length, 0, "fresh state starts empty");
});
