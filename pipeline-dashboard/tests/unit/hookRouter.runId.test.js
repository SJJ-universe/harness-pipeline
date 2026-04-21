// Slice T (v6) — HookRouter's runId resolution + orchestrator-backed
// executor lookup.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HookRouter } = require("../../executor/hook-router");

function stubExec(label) {
  return {
    label,
    calls: [],
    enabled: true,
    startFromPrompt: function () { this.calls.push("startFromPrompt"); return {}; },
    onPreTool: function () { this.calls.push("onPreTool"); return {}; },
    onPostTool: function () { this.calls.push("onPostTool"); return {}; },
    onStop: function () { this.calls.push("onStop"); return {}; },
    onSessionEnd: function () { this.calls.push("onSessionEnd"); return {}; },
    onSessionStart: function () { this.calls.push("onSessionStart"); return {}; },
    onSubagentStart: function () { this.calls.push("onSubagentStart"); return {}; },
    onSubagentStop: function () { this.calls.push("onSubagentStop"); return {}; },
    onNotification: function () { this.calls.push("onNotification"); return {}; },
    onPreCompact: function () { this.calls.push("onPreCompact"); return {}; },
  };
}

function stubOrchestrator(runs) {
  return {
    get: (runId) => runs[runId] || null,
  };
}

function mkRouter() {
  return new HookRouter({
    broadcast: () => {},
    sessionWatcher: null,
    runRegistry: null,
  });
}

test("_resolveRunId prefers session_id", () => {
  const r = mkRouter();
  assert.equal(r._resolveRunId({ session_id: "abc", agent_id: "xyz" }), "abc");
});

test("_resolveRunId falls back to agent_id when session_id missing", () => {
  const r = mkRouter();
  assert.equal(r._resolveRunId({ agent_id: "xyz" }), "xyz");
});

test("_resolveRunId defaults to 'default' on empty payload", () => {
  const r = mkRouter();
  assert.equal(r._resolveRunId({}), "default");
  assert.equal(r._resolveRunId(null), "default");
});

test("_resolveRunId stringifies non-string session_id", () => {
  const r = mkRouter();
  assert.equal(r._resolveRunId({ session_id: 123 }), "123");
});

test("without orchestrator, resolve falls back to attached executor", async () => {
  const r = mkRouter();
  const exec = stubExec("legacy");
  r.attachExecutor(exec);
  await r.route("pre-tool", { tool_name: "Edit", tool_input: {}, session_id: "any" });
  assert.deepEqual(exec.calls, ["onPreTool"]);
});

test("with orchestrator, two session_ids route to their own executors", async () => {
  const r = mkRouter();
  const fallback = stubExec("fallback");
  const execA = stubExec("A");
  const execB = stubExec("B");
  r.attachExecutor(fallback);
  r.attachOrchestrator(stubOrchestrator({ "sess-A": execA, "sess-B": execB }));
  await r.route("pre-tool", { tool_name: "Edit", tool_input: {}, session_id: "sess-A" });
  await r.route("pre-tool", { tool_name: "Edit", tool_input: {}, session_id: "sess-B" });
  assert.deepEqual(execA.calls, ["onPreTool"]);
  assert.deepEqual(execB.calls, ["onPreTool"]);
  assert.deepEqual(fallback.calls, [], "fallback should not be called when orchestrator matches");
});

test("orchestrator.get returning null falls back to attached executor", async () => {
  const r = mkRouter();
  const fallback = stubExec("fallback");
  r.attachExecutor(fallback);
  r.attachOrchestrator(stubOrchestrator({ default: null })); // returns null for everything
  await r.route("pre-tool", { tool_name: "Edit", session_id: "unknown-run" });
  assert.deepEqual(fallback.calls, ["onPreTool"],
    "unknown runId should collapse to fallback in single-active mode");
});

test("all 10 lifecycle events route through _resolveExecutor", async () => {
  const r = mkRouter();
  const exec = stubExec("only");
  r.attachExecutor(exec);
  r.attachOrchestrator(stubOrchestrator({ "my-run": exec }));

  await r.route("user-prompt", { session_id: "my-run", prompt: "x" });
  await r.route("pre-tool", { session_id: "my-run", tool_name: "Read" });
  await r.route("post-tool", { session_id: "my-run", tool_name: "Read" });
  await r.route("stop", { session_id: "my-run" });
  await r.route("session-end", { session_id: "my-run" });
  await r.route("session-start", { session_id: "my-run" });
  await r.route("subagent-start", { session_id: "my-run" });
  await r.route("subagent-stop", { session_id: "my-run" });
  await r.route("notification", { session_id: "my-run" });
  await r.route("pre-compact", { session_id: "my-run" });

  assert.deepEqual(exec.calls.sort(), [
    "onNotification",
    "onPostTool",
    "onPreCompact",
    "onPreTool",
    "onSessionEnd",
    "onSessionStart",
    "onStop",
    "onSubagentStart",
    "onSubagentStop",
    "startFromPrompt",
  ]);
});
