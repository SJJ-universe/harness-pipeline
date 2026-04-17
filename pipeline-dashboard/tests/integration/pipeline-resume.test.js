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

  // Clear events to focus on events from THIS resume call
  events.length = 0;

  const guidance = await ex.startFromPrompt("please implement another feature");
  const after = ex.getStatus();

  assert.equal(before.phase, "B");
  assert.equal(after.phase, "B");
  // Resume message must clearly indicate it is NOT a fresh start
  assert.match(guidance.message, /활성 파이프라인 계속 진행/);
  assert.match(guidance.message, /원래 작업: "please implement a feature"/);
  assert.match(guidance.message, /Phase A.*완료/);
  assert.match(guidance.message, /현재 진행 중/);
  assert.match(guidance.message, /새 작업 시작이 아니라/);
  assert.ok(events.some((e) => e.type === "pipeline_resume" && e.data.phase === "B"));
  // BUG FIX: Resume must also re-emit phase_update events so UI re-applies .active class
  assert.ok(
    events.some((e) => e.type === "phase_update" && e.data.phase === "A" && e.data.status === "completed"),
    "resume re-emits phase A completed"
  );
  assert.ok(
    events.some((e) => e.type === "phase_update" && e.data.phase === "B" && e.data.status === "active"),
    "resume re-emits phase B active"
  );
});

test("fresh start (no active, no checkpoint) uses '시작' wording", async () => {
  const { ex } = makeEnv();
  const guidance = await ex.startFromPrompt("please implement a feature");
  // Fresh pipeline must use 시작 (start), not 계속 (continue)
  assert.match(guidance.message, /Phase A.*시작/);
  assert.ok(!/활성 파이프라인 계속 진행/.test(guidance.message), "should not show resume wording");
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

  const guidance = await ex.startFromPrompt("please implement a feature");

  assert.equal(ex.getStatus().phase, "B");
  assert.ok(events.some((e) => e.type === "pipeline_restored" && e.data.phase === "B"));
  assert.ok(events.some((e) => e.type === "phase_update" && e.data.phase === "A" && e.data.status === "completed"));
  assert.ok(events.some((e) => e.type === "phase_update" && e.data.phase === "B" && e.data.status === "active"));
  // Restored message must use 복원 wording
  assert.match(guidance.message, /체크포인트에서 복원/);
  assert.match(guidance.message, /원래 작업: "please implement"/);
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
