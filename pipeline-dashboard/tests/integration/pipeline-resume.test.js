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
