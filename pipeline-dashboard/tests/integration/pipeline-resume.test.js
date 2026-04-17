const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { createCheckpointStore } = require("../../executor/checkpoint");

function makeEnv() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-resume-"));
  const events = [];
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "Phase A", name: "Plan", allowedTools: ["Read"] },
        { id: "B", label: "Phase B", name: "Build", allowedTools: ["Edit"] },
      ],
    },
  };
  const checkpointStore = createCheckpointStore({ repoRoot, ttlMs: 60_000 });
  const ex = new PipelineExecutor({
    broadcast: (event) => events.push(event),
    templates,
    state: new PipelineState(),
    repoRoot,
    checkpointStore,
  });
  ex.setEnabled(true);
  return { ex, events, checkpointStore, repoRoot };
}

test("startFromPrompt resumes active pipeline instead of restarting Phase A", async () => {
  const { ex, events } = makeEnv();

  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(1);
  const before = ex.getStatus();

  const guidance = await ex.startFromPrompt("please implement another feature");
  const after = ex.getStatus();

  assert.equal(before.phase, "B");
  assert.equal(after.phase, "B");
  assert.match(guidance.reason || guidance.message || JSON.stringify(guidance), /Phase B|Build|Edit/i);
  assert.ok(events.some((e) => e.type === "pipeline_resume" && e.data.phase === "B"));
});

test("startFromPrompt restores checkpoint when there is no active pipeline", async () => {
  const { checkpointStore, repoRoot } = makeEnv();
  checkpointStore.save({
    templateId: "default",
    template: {
      id: "default",
      phases: [
        { id: "A", label: "Phase A", name: "Plan", allowedTools: ["Read"] },
        { id: "B", label: "Phase B", name: "Build", allowedTools: ["Edit"] },
      ],
    },
    phaseIdx: 1,
    iteration: 0,
    gateRetries: 0,
    userPrompt: "please implement",
    startedAt: Date.now(),
  }, { snapshot: () => ({}) });

  const events = [];
  const ex = new PipelineExecutor({
    broadcast: (event) => events.push(event),
    templates: { default: { id: "default", phases: [{ id: "A" }] } },
    state: new PipelineState(),
    repoRoot,
    checkpointStore,
  });
  ex.setEnabled(true);

  await ex.startFromPrompt("please implement a feature");

  assert.equal(ex.getStatus().phase, "B");
  assert.ok(events.some((e) => e.type === "pipeline_restored" && e.data.phase === "B"));
  assert.ok(events.some((e) => e.type === "phase_update" && e.data.phase === "A" && e.data.status === "completed"));
  assert.ok(events.some((e) => e.type === "phase_update" && e.data.phase === "B" && e.data.status === "active"));
});

test("onSessionEnd preserves checkpoint (not clears)", async () => {
  const { ex, checkpointStore, events } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(1);
  assert.ok(fs.existsSync(checkpointStore.path), "checkpoint exists after phase entry");

  await ex.onSessionEnd({});

  assert.ok(fs.existsSync(checkpointStore.path), "checkpoint survives session-end");
  assert.equal(ex.active, null, "active is cleared in-memory");
  assert.ok(events.some((e) => e.type === "pipeline_paused" && e.data.reason === "session-end"));
});

test("getReplaySnapshot returns active/paused/idle correctly", async () => {
  const { ex, checkpointStore, repoRoot } = makeEnv();

  // idle: no active, no checkpoint
  checkpointStore.clear();
  assert.equal(ex.getReplaySnapshot().status, "idle");

  // active: pipeline running
  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(1);
  const active = ex.getReplaySnapshot();
  assert.equal(active.status, "active");
  assert.equal(active.phase, "B");

  // paused: session-end keeps checkpoint, clears active
  await ex.onSessionEnd({});
  const paused = ex.getReplaySnapshot();
  assert.equal(paused.status, "paused");
  assert.equal(paused.phase, "B");
});

test("_scheduleCheckpoint debounces tool_blocked saves", async () => {
  const { ex, checkpointStore } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  // Phase A only allows Read — Bash will be blocked
  await ex.onPreTool("Bash", { command: "ls" });
  // Checkpoint should be scheduled but not saved immediately
  assert.ok(ex._checkpointTimer, "debounce timer scheduled");
  // Fast-forward by waiting the debounce duration
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(ex._checkpointTimer, null, "timer fired");
  // Checkpoint file should reflect the blocked state via save
  assert.ok(fs.existsSync(checkpointStore.path));
});

test("_complete clears checkpoint and cancels pending debounce", async () => {
  const { ex, checkpointStore } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  // Schedule a checkpoint via blocked tool
  await ex.onPreTool("Bash", { command: "ls" });
  assert.ok(ex._checkpointTimer);
  // Complete the pipeline
  ex._complete("manual-test");
  assert.equal(ex._checkpointTimer, null, "debounce timer cancelled");
  assert.equal(fs.existsSync(checkpointStore.path), false, "checkpoint cleared on complete");
});
