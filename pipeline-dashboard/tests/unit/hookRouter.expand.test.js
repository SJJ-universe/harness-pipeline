// Slice A (v4) — HookRouter must fan out the five new lifecycle aliases to
// the matching executor callbacks. We stub the executor with a recorder so we
// can confirm method selection without wiring a full pipeline.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HookRouter } = require("../../executor/hook-router");

function makeRecorderExecutor() {
  const calls = [];
  const makeHandler = (name) => async (payload) => {
    calls.push({ name, payload });
    return { handledBy: name };
  };
  return {
    enabled: true,
    calls,
    startFromPrompt: async (prompt) => { calls.push({ name: "startFromPrompt", prompt }); return {}; },
    onPreTool: makeHandler("onPreTool"),
    onPostTool: makeHandler("onPostTool"),
    onStop: makeHandler("onStop"),
    onSessionEnd: makeHandler("onSessionEnd"),
    onSessionStart: makeHandler("onSessionStart"),
    onSubagentStart: makeHandler("onSubagentStart"),
    onSubagentStop: makeHandler("onSubagentStop"),
    onNotification: makeHandler("onNotification"),
    onPreCompact: makeHandler("onPreCompact"),
  };
}

function makeRouter(executor) {
  const broadcasts = [];
  const router = new HookRouter({
    broadcast: (evt) => broadcasts.push(evt),
    sessionWatcher: null,
    runRegistry: null,
    fixturesDir: require("os").tmpdir(),
  });
  router.attachExecutor(executor);
  return { router, broadcasts };
}

test("session-start routes to executor.onSessionStart", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  const result = await router.route("session-start", { source: "compact" });
  assert.equal(ex.calls.at(-1).name, "onSessionStart");
  assert.deepEqual(ex.calls.at(-1).payload, { source: "compact" });
  assert.equal(result.handledBy, "onSessionStart");
});

test("subagent-start routes to executor.onSubagentStart with payload", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  await router.route("subagent-start", {
    session_id: "sub-123",
    agent_type: "Explore",
    parent_session_id: "parent-abc",
  });
  const call = ex.calls.at(-1);
  assert.equal(call.name, "onSubagentStart");
  assert.equal(call.payload.session_id, "sub-123");
  assert.equal(call.payload.agent_type, "Explore");
});

test("subagent-stop routes to executor.onSubagentStop", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  await router.route("subagent-stop", { session_id: "sub-123" });
  assert.equal(ex.calls.at(-1).name, "onSubagentStop");
});

test("notification routes to executor.onNotification", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  await router.route("notification", { level: "warn", message: "context 85%" });
  const call = ex.calls.at(-1);
  assert.equal(call.name, "onNotification");
  assert.equal(call.payload.message, "context 85%");
});

test("pre-compact routes to executor.onPreCompact", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  await router.route("pre-compact", { trigger: "manual", custom_instructions: "" });
  assert.equal(ex.calls.at(-1).name, "onPreCompact");
});

test("unknown event returns empty object without hitting executor", async () => {
  const ex = makeRecorderExecutor();
  const { router } = makeRouter(ex);
  const result = await router.route("made-up-event", {});
  assert.deepEqual(result, {});
  // No handler should have been invoked for the unknown event.
  assert.ok(!ex.calls.some((c) => c.name !== "startFromPrompt"));
});

test("router still emits a raw hook_event broadcast for each routed event", async () => {
  const ex = makeRecorderExecutor();
  const { router, broadcasts } = makeRouter(ex);
  await router.route("pre-compact", {});
  const hookEvents = broadcasts.filter((b) => b.type === "hook_event");
  assert.ok(hookEvents.length >= 1, "hook_event broadcast should fire for pre-compact");
  assert.equal(hookEvents[0].data.event, "pre-compact");
});

test("router without attached executor still returns empty object", async () => {
  const broadcasts = [];
  const router = new HookRouter({
    broadcast: (evt) => broadcasts.push(evt),
    sessionWatcher: null,
    runRegistry: null,
    fixturesDir: require("os").tmpdir(),
  });
  // No attachExecutor call — defensive path.
  const result = await router.route("subagent-start", { session_id: "x" });
  assert.deepEqual(result, {});
});
