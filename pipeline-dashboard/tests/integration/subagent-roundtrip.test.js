// Slice D (v4) — full round-trip: SubagentStart/Stop hook → PipelineExecutor
// callback → WebSocket broadcast → server-side replay buffer → snapshot for
// a reconnecting client. Proves the subagent lifecycle is end-to-end
// observable and durable across a reconnect.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { HookRouter } = require("../../executor/hook-router");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { createEventReplayBuffer, REPLAY_TYPES } = require("../../src/runtime/eventReplayBuffer");

function makeEnv() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sub-rt-"));
  const replayBuf = createEventReplayBuffer({ maxSize: 100 });
  const broadcasts = [];
  const broadcast = (e) => {
    broadcasts.push(e);
    // Mirror the real server's behavior — every broadcast is appended to the
    // replay ring so future connects can re-hydrate.
    replayBuf.append(e);
  };
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "A", name: "Plan", agent: "claude", allowedTools: ["Read", "Agent"] },
        { id: "B", label: "B", name: "Build", agent: "claude", allowedTools: ["Edit"] },
      ],
    },
  };
  const executor = new PipelineExecutor({
    broadcast, templates, state: new PipelineState(), repoRoot,
  });
  executor.setEnabled(true);
  const router = new HookRouter({
    broadcast, sessionWatcher: null, runRegistry: null,
    fixturesDir: path.join(repoRoot, "fixtures"),
  });
  router.attachExecutor(executor);
  return { executor, router, broadcasts, replayBuf, repoRoot };
}

test("subagent_started + subagent_completed are in REPLAY_TYPES", () => {
  assert.ok(REPLAY_TYPES.has("subagent_started"),
    "Slice D requires subagent_started to survive reconnect");
  assert.ok(REPLAY_TYPES.has("subagent_completed"),
    "Slice D requires subagent_completed to survive reconnect");
});

test("hook → executor → broadcast emits subagent_started with payload", async () => {
  const { router, broadcasts, executor } = makeEnv();
  await executor.startFromPrompt("please implement a feature");
  broadcasts.length = 0;

  await router.route("subagent-start", {
    session_id: "sub-1",
    agent_type: "Explore",
    parent_session_id: "parent-A",
  });

  const started = broadcasts.find((e) => e.type === "subagent_started");
  assert.ok(started, "subagent_started broadcast missing");
  assert.equal(started.data.session_id, "sub-1");
  assert.equal(started.data.agent_type, "Explore");
  assert.equal(started.data.parent_session_id, "parent-A");
});

test("SubagentStop round-trip broadcasts subagent_completed with elapsedMs", async () => {
  const { router, broadcasts, executor } = makeEnv();
  await executor.startFromPrompt("please implement a feature");

  await router.route("subagent-start", { session_id: "sub-2", agent_type: "Plan" });
  // Give the clock a tiny bit of headroom so elapsedMs is > 0.
  await new Promise((r) => setTimeout(r, 5));
  await router.route("subagent-stop", { session_id: "sub-2", agent_type: "Plan" });

  const done = broadcasts.find((e) => e.type === "subagent_completed");
  assert.ok(done);
  assert.equal(done.data.session_id, "sub-2");
  assert.equal(done.data.agent_type, "Plan");
  assert.ok(Number.isFinite(done.data.elapsedMs) && done.data.elapsedMs >= 0,
    "elapsedMs must be a non-negative number");
});

test("replay buffer captures both lifecycle events for reconnecting clients", async () => {
  const { router, replayBuf, executor } = makeEnv();
  await executor.startFromPrompt("please implement a feature");

  await router.route("subagent-start", { session_id: "sub-3", agent_type: "Explore" });
  await router.route("subagent-start", { session_id: "sub-4", agent_type: "Plan" });
  await router.route("subagent-stop", { session_id: "sub-3", agent_type: "Explore" });

  const snap = replayBuf.snapshot().map((e) => e.event);
  const types = snap.map((e) => e.type);
  assert.ok(types.includes("subagent_started"),
    "replay snapshot must include subagent_started events");
  assert.ok(types.includes("subagent_completed"),
    "replay snapshot must include subagent_completed events");
  // Count: 2 started + 1 completed
  assert.equal(snap.filter((e) => e.type === "subagent_started").length, 2);
  assert.equal(snap.filter((e) => e.type === "subagent_completed").length, 1);
});

test("executor tracks subagents on active.subagents and marks completedAt", async () => {
  const { router, executor } = makeEnv();
  await executor.startFromPrompt("please implement a feature");
  await router.route("subagent-start", { session_id: "sub-5", agent_type: "Explore" });
  assert.ok(executor.active.subagents["sub-5"], "executor must track active subagent");
  assert.equal(executor.active.subagents["sub-5"].completedAt, undefined);

  await router.route("subagent-stop", { session_id: "sub-5" });
  const entry = executor.active.subagents["sub-5"];
  assert.ok(entry.completedAt, "completedAt must be stamped after stop");
});

test("SubagentStop without a prior SubagentStart is tolerated (no crash)", async () => {
  const { router, broadcasts, executor } = makeEnv();
  await executor.startFromPrompt("please implement a feature");
  // Mid-run connect scenario: only a stop event arrives.
  await router.route("subagent-stop", { session_id: "orphan", agent_type: "Plan" });
  const done = broadcasts.find((e) => e.type === "subagent_completed");
  assert.ok(done, "stop-only must still broadcast completion");
  assert.equal(done.data.session_id, "orphan");
});

test("disabled executor drops subagent events silently", async () => {
  const { router, broadcasts, executor } = makeEnv();
  executor.setEnabled(false);
  broadcasts.length = 0;
  await router.route("subagent-start", { session_id: "x", agent_type: "X" });
  const started = broadcasts.find((e) => e.type === "subagent_started");
  assert.ok(!started,
    "disabled executor must not surface subagent_started — noise suppression");
});
