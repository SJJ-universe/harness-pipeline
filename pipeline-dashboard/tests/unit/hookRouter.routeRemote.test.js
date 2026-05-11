// Slice R1-g (Phase D R1, 2026-04-28) — HookRouter.routeRemote unit tests.
//
// routeRemote is the hookRouter entry point used by the runner WS handler
// when an `{type:"hook", event}` frame arrives. The deliberate R1 scope:
//
//   - record stats so the dashboard can see remote vs local hook flow
//   - tag origin = "container-remote" on the broadcast
//   - DO NOT execute the local on{Pre,Post,...} routes — runners are
//     across the trust boundary, hooks from them are reported, not
//     trusted to drive the orchestrator's pipeline executor
//
// The MG1 RFC § hook-ingress design calls this "report-only" mode for
// R1; R2 adds an allowlist + tool-arg validation bridge.

const test = require("node:test");
const assert = require("node:assert/strict");
const { HookRouter } = require("../../executor/hook-router");

function makeRouter(opts = {}) {
  const broadcasts = [];
  const router = new HookRouter({
    broadcast: (e) => broadcasts.push(e),
    sessionWatcher: null,
    runRegistry: null,
    fixturesDir: null,
    ...opts,  // allow tests to pass bridgeMode, etc.
  });
  return { router, broadcasts };
}

// R2.5-c helper: a recording mock executor for dispatch tests.
function makeMockExecutor() {
  const calls = [];
  return {
    calls,
    onPreTool: async (tool, input) => {
      calls.push({ method: "onPreTool", args: [tool, input] });
    },
    onPostTool: async (tool, response, input) => {
      calls.push({ method: "onPostTool", args: [tool, response, input] });
    },
    onStop: async (payload) => {
      calls.push({ method: "onStop", args: [payload] });
    },
    onSubagentStart: async (payload) => {
      calls.push({ method: "onSubagentStart", args: [payload] });
    },
    onSubagentStop: async (payload) => {
      calls.push({ method: "onSubagentStop", args: [payload] });
    },
  };
}

test("R1-g: routeRemote broadcasts runner_hook with origin=container-remote", () => {
  const { router, broadcasts } = makeRouter();
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read", data: { path: "x.js" } });
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].type, "runner_hook");
  assert.equal(broadcasts[0].data.runId, "rr-1");
  assert.equal(broadcasts[0].data.origin, "container-remote");
  assert.equal(broadcasts[0].data.event.hook, "PreToolUse");
  assert.equal(broadcasts[0].data.event.tool, "Read");
  assert.deepEqual(broadcasts[0].data.event.data, { path: "x.js" });
});

test("R1-g: routeRemote bumps stats.total + stats.remoteHooks + stats.byEvent[hook]", () => {
  const { router } = makeRouter();
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read" });
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Glob" });
  router.routeRemote("rr-1", { hook: "Stop", tool: null, data: {} });
  const s = router.getStats();
  assert.equal(s.total, 3);
  assert.equal(s.remoteHooks, 3);
  assert.equal(s.byEvent.PreToolUse, 2);
  assert.equal(s.byEvent.Stop, 1);
});

test("R1-g: routeRemote IGNORES empty/missing runId", () => {
  const { router, broadcasts } = makeRouter();
  router.routeRemote("", { hook: "Stop" });
  router.routeRemote(null, { hook: "Stop" });
  router.routeRemote(undefined, { hook: "Stop" });
  assert.equal(broadcasts.length, 0);
  assert.equal((router.getStats().remoteHooks || 0), 0);
});

test("R1-g: routeRemote IGNORES non-object hookEvent", () => {
  const { router, broadcasts } = makeRouter();
  router.routeRemote("rr-1", null);
  router.routeRemote("rr-1", "string");
  router.routeRemote("rr-1", 42);
  assert.equal(broadcasts.length, 0);
});

test("R1-g: routeRemote defensively copies event fields (rejects extra keys)", () => {
  // Defensive copy ensures a runner can't smuggle arbitrary metadata into
  // the broadcast payload and pollute downstream consumers.
  const { router, broadcasts } = makeRouter();
  router.routeRemote("rr-1", {
    hook: "PreToolUse",
    tool: "Read",
    data: { ok: true },
    secret: "shhh",
    arbitrary: { nested: "junk" },
  });
  const event = broadcasts[0].data.event;
  assert.equal(event.hook, "PreToolUse");
  assert.equal(event.tool, "Read");
  assert.deepEqual(event.data, { ok: true });
  assert.equal(event.secret, undefined);
  assert.equal(event.arbitrary, undefined);
});

test("R1-g: routeRemote tolerates missing tool / data fields", () => {
  const { router, broadcasts } = makeRouter();
  router.routeRemote("rr-1", { hook: "Stop" });
  const event = broadcasts[0].data.event;
  assert.equal(event.hook, "Stop");
  assert.equal(event.tool, null);
  assert.deepEqual(event.data, {});
});

test("R1-g: routeRemote NEVER calls into the attached executor (trust boundary)", () => {
  // Belt-and-suspenders: R2.5 adds a controlled bridge that MAY drive
  // the executor under ORCHESTRATOR_REMOTE_BRIDGE_MODE=dispatch. Default
  // off (R1 + R2 behavior) — this test pins the off-by-default
  // invariant.
  const { router } = makeRouter();
  let executorCalls = 0;
  router.attachExecutor({
    onPreTool: () => { executorCalls += 1; },
    onPostTool: () => { executorCalls += 1; },
    onStop: () => { executorCalls += 1; },
    onSessionStart: () => { executorCalls += 1; },
    onSessionEnd: () => { executorCalls += 1; },
    onSubagentStart: () => { executorCalls += 1; },
    onSubagentStop: () => { executorCalls += 1; },
    onNotification: () => { executorCalls += 1; },
    onPreCompact: () => { executorCalls += 1; },
  });
  for (const hook of ["PreToolUse", "PostToolUse", "Stop", "SessionStart"]) {
    router.routeRemote("rr-1", { hook, tool: "Read" });
  }
  assert.equal(executorCalls, 0, "remote hooks must NOT drive the local executor in R1/R2 default mode");
});

// ── R2.5-b: structured return value + sanitization wiring ─────────

test("R2.5-b: routeRemote returns {broadcast, rejected, sanitized, dispatched} on every accepted call", async () => {
  const { router } = makeRouter();
  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read",
    data: { file_path: "/work/in/x.txt" },
  });
  assert.equal(typeof result, "object");
  assert.equal(result.broadcast, true,
    "broadcast must always happen on accepted route — R1-k2 forensic anchor");
  assert.equal(result.rejected, null,
    "valid PreToolUse Read should not be rejected");
  assert.ok(result.sanitized, "valid frame should produce a sanitized payload");
  assert.equal(result.sanitized.hook, "PreToolUse");
  assert.equal(result.sanitized.tool, "Read");
  assert.deepEqual(result.sanitized._data, { file_path: "/work/in/x.txt" });
  assert.equal(result.dispatched, null,
    "default bridgeMode=off leaves dispatched=null; R2.5-c populates only in dispatch mode");
});

test("R2.5-b: routeRemote returns rejected reason for hook outside the allowlist", async () => {
  const { router } = makeRouter();
  const result = await router.routeRemote("rr-1", {
    hook: "SessionStart", tool: "Read",
  });
  // SessionStart is intentionally NOT in ALLOWED_HOOKS for R2.5.
  assert.equal(result.broadcast, true,
    "broadcast still happens — operator should see the inbound traffic");
  assert.ok(result.rejected, "SessionStart must be rejected");
  assert.equal(result.rejected.reason, "hook_not_allowed");
  assert.equal(result.sanitized, null, "rejected frames have no sanitized payload");
});

test("R3-e-d: routeRemote PASSES write-side tools through sanitization (no longer rejects)", async () => {
  // R3-e-d relaxes the R2.5-b "tool_not_allowed" pin for Bash/Edit/Write
  // — these now sanitize successfully with `requiresApproval: true`.
  // The hook-router's approval gate (still in this slice) decides
  // whether dispatch happens. With no approvalManager wired (the
  // default makeRouter orchestrator), the gate fail-closes; with a manager
  // wired, the operator decides.
  const { router } = makeRouter();
  for (const writeTool of ["Bash", "Edit", "Write"]) {
    const data = writeTool === "Bash" ? { command: "echo hi" }
              : writeTool === "Edit" ? { file_path: "/x", old_string: "a", new_string: "b" }
              : { file_path: "/x", content: "hi" };
    const result = await router.routeRemote("rr-1", {
      hook: "PreToolUse", tool: writeTool, data,
    });
    assert.equal(result.rejected, null,
      `tool=${writeTool} should NOT be rejected at sanitizer (R3-e-d relaxed the pin)`);
    assert.ok(result.sanitized, `tool=${writeTool} should produce a sanitized payload`);
    assert.equal(result.sanitized.requiresApproval, true,
      `tool=${writeTool} sanitized payload must carry requiresApproval:true`);
  }
});

test("R3-e-d: tool_not_allowed still fires for tools outside both sets (WebFetch / Task)", async () => {
  const { router } = makeRouter();
  for (const banned of ["WebFetch", "WebSearch", "Task", "CustomTool"]) {
    const result = await router.routeRemote("rr-1", {
      hook: "PreToolUse", tool: banned, data: {},
    });
    assert.equal(result.rejected && result.rejected.reason, "tool_not_allowed",
      `tool=${banned} should reject with tool_not_allowed (not in ALLOWED_TOOLS or WRITE_TOOLS_REQUIRING_APPROVAL)`);
  }
});

test("R2.5-b: routeRemote stats track sanitized + rejected counts", async () => {
  const { router } = makeRouter();
  await router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read" });        // accept
  await router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read" });        // accept
  await router.routeRemote("rr-1", { hook: "PreToolUse", tool: "WebFetch" });    // reject (out-of-set)
  await router.routeRemote("rr-1", { hook: "Custom" });                          // reject
  const stats = router.getStats();
  assert.equal(stats.remoteHookSanitized, 2);
  assert.equal(stats.remoteHookRejected, 2);
  // Total + remoteHooks counts (R1-k2 + R1-k1) still tick on every
  // accepted-as-routeRemote-call regardless of sanitization outcome.
  assert.equal(stats.total, 4);
  assert.equal(stats.remoteHooks, 4);
});

test("R2.5-b: routeRemote returns the empty result on null/missing inputs (no broadcast)", async () => {
  // Defensive guard: when the input itself is invalid, broadcast is
  // skipped (no audit anchor either) — these calls should never have
  // happened. Distinct from "hook_not_allowed" which IS an attacker
  // event the operator should see.
  const { router } = makeRouter();
  const r1 = await router.routeRemote("", { hook: "PreToolUse", tool: "Read" });
  const r2 = await router.routeRemote(null, { hook: "PreToolUse", tool: "Read" });
  const r3 = await router.routeRemote("rr-1", null);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.broadcast, false);
    assert.equal(r.rejected, null);
    assert.equal(r.sanitized, null);
  }
});

// ── R2.5-c: bridge mode + controlled dispatch ─────────────────────

test("R2.5-c: default bridge mode is 'off' (broadcast-only, no dispatch)", () => {
  const { router } = makeRouter();
  assert.equal(router.getBridgeMode(), "off");
});

test("R2.5-c: setBridgeMode rejects invalid modes (frozen vocabulary)", () => {
  const { router } = makeRouter();
  for (const bad of ["", "yolo", "true", "1", "execute"]) {
    assert.throws(() => router.setBridgeMode(bad), /invalid mode/);
  }
  // Valid modes go through.
  for (const ok of ["off", "report", "dispatch"]) {
    router.setBridgeMode(ok);
    assert.equal(router.getBridgeMode(), ok);
  }
});

test("R2.5-c: bridgeMode='off' (default) — sanitized hook does NOT call executor", async () => {
  // The R1/R2 default. Sanitization runs, audit verbs are emittable,
  // but no executor method is invoked.
  const { router } = makeRouter();
  const exec = makeMockExecutor();
  router.attachExecutor(exec);
  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/x" },
  });
  assert.ok(result.sanitized);
  assert.equal(result.dispatched, null);
  assert.equal(exec.calls.length, 0);
});

test("R2.5-c: bridgeMode='report' — sanitized but NOT dispatched", async () => {
  // The promotion-staging mode. Operator runs this for 24-48h before
  // flipping to "dispatch" — see audit chain rejected/sanitized
  // entries to understand what the bridge would have routed.
  const { router } = makeRouter({ bridgeMode: "report" });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);
  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/x" },
  });
  assert.ok(result.sanitized);
  assert.equal(result.dispatched, null,
    "report mode skips dispatch — operators audit before promoting");
  assert.equal(exec.calls.length, 0);
});

test("R2.5-c: bridgeMode='dispatch' — PreToolUse Read fires executor.onPreTool", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);
  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/work/in/x.txt", limit: 100 },
  });
  assert.ok(result.dispatched);
  assert.equal(result.dispatched.ok, true);
  assert.equal(result.dispatched.method, "onPreTool");
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].method, "onPreTool");
  assert.equal(exec.calls[0].args[0], "Read",
    "first arg = tool name");
  assert.deepEqual(exec.calls[0].args[1], { file_path: "/work/in/x.txt", limit: 100 },
    "second arg = sanitized data ONLY (no extra keys)");
});

test("R2.5-c: bridgeMode='dispatch' — every allowed hook routes to its mapped method", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);
  await router.routeRemote("rr", { hook: "PreToolUse",  tool: "Read",  data: { file_path: "/x" } });
  await router.routeRemote("rr", { hook: "PostToolUse", tool: "Glob",  data: { path: "/x" }, response: { matches: [] } });
  await router.routeRemote("rr", { hook: "Stop",        data: { session_id: "s1" } });
  await router.routeRemote("rr", { hook: "SubagentStart", data: { agent_id: "a1", agent_type: "claude" } });
  await router.routeRemote("rr", { hook: "SubagentStop",  data: { agent_id: "a1" } });
  const methods = exec.calls.map((c) => c.method);
  assert.deepEqual(methods, [
    "onPreTool", "onPostTool", "onStop", "onSubagentStart", "onSubagentStop",
  ], "every allowed hook must route to its contract-mapped method");
});

test("R2.5-c: bridgeMode='dispatch' — rejected frames never call the executor", async () => {
  // Negative invariant: rejection MUST short-circuit before dispatch.
  // R3-e-d note: Bash/Edit/Write are no longer sanitization-time rejects
  // (now gated at the approval layer instead). WebFetch is the
  // updated "out-of-set" tool that still rejects with tool_not_allowed.
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);
  for (const evt of [
    { hook: "SessionStart", tool: "Read" },             // hook_not_allowed
    { hook: "PreToolUse",   tool: "WebFetch" },         // tool_not_allowed (out-of-set)
    { hook: "SubagentStart", data: {} },                // data_required_missing
    { hook: "Custom" },                                 // hook_not_allowed
  ]) {
    const result = await router.routeRemote("rr", evt);
    assert.ok(result.rejected, "evt should be rejected");
    assert.equal(result.dispatched, null,
      "rejected frames must NEVER reach dispatched (executor untouched)");
  }
  assert.equal(exec.calls.length, 0,
    "executor must not be invoked once across any of the rejected frames");
});

test("R2.5-c: bridgeMode='dispatch' — executor exception captured in dispatched.error", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  router.attachExecutor({
    onPreTool: async () => { throw new Error("boom downstream"); },
  });
  const result = await router.routeRemote("rr", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/x" },
  });
  assert.ok(result.dispatched);
  assert.equal(result.dispatched.ok, false);
  assert.equal(result.dispatched.method, "onPreTool");
  assert.match(result.dispatched.error, /boom downstream/);
});

test("R2.5-c: bridgeMode='dispatch' — no executor wired emits ok=false error=no_executor", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  // No attachExecutor + no orchestrator.
  const result = await router.routeRemote("rr", {
    hook: "Stop", data: { session_id: "s1" },
  });
  assert.equal(result.dispatched.ok, false);
  assert.equal(result.dispatched.error, "no_executor");
});

test("R2.5-c: bridgeMode='dispatch' — orchestrator-resolved executor wins over attached singleton", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  const singletonExec = makeMockExecutor();
  const perRunExec = makeMockExecutor();
  router.attachExecutor(singletonExec);
  router.attachOrchestrator({
    getOrCreateRun: (runId) => runId === "rr-A" ? perRunExec : null,
  });
  await router.routeRemote("rr-A", { hook: "Stop", data: {} });
  await router.routeRemote("rr-B", { hook: "Stop", data: {} });
  // rr-A → perRunExec (orchestrator returned it), rr-B → singleton fallback.
  assert.equal(perRunExec.calls.length, 1);
  assert.equal(singletonExec.calls.length, 1);
});

test("R2.5-c: bridgeMode='dispatch' — orchestrator without getOrCreateRun falls back to .get()", async () => {
  // Backward compat with older orchestrator implementations that only
  // expose .get(). For runner-claimed runId that's not in the orch
  // run-list, .get() returns null and we fall through to the
  // singleton executor.
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  const singletonExec = makeMockExecutor();
  const perRunExec = makeMockExecutor();
  router.attachExecutor(singletonExec);
  router.attachOrchestrator({
    get: (runId) => runId === "rr-X" ? perRunExec : null,
  });
  await router.routeRemote("rr-X", { hook: "Stop", data: {} });   // → perRunExec
  await router.routeRemote("rr-Y", { hook: "Stop", data: {} });   // → singleton
  assert.equal(perRunExec.calls.length, 1);
  assert.equal(singletonExec.calls.length, 1);
});

test("R2.5-c: dispatch stats track dispatched + dispatch_error separately", async () => {
  const { router } = makeRouter({ bridgeMode: "dispatch" });
  router.attachExecutor({
    onPreTool: async () => {},
    onStop: async () => { throw new Error("boom"); },
  });
  await router.routeRemote("rr", { hook: "PreToolUse", tool: "Read", data: { file_path: "/x" } });
  await router.routeRemote("rr", { hook: "PreToolUse", tool: "Read", data: { file_path: "/y" } });
  await router.routeRemote("rr", { hook: "Stop", data: {} });  // throws
  const stats = router.getStats();
  assert.equal(stats.remoteHookDispatched, 2);
  assert.equal(stats.remoteHookDispatchError, 1);
});
