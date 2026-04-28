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

function makeRouter() {
  const broadcasts = [];
  const router = new HookRouter({
    broadcast: (e) => broadcasts.push(e),
    sessionWatcher: null,
    runRegistry: null,
    fixturesDir: null,
  });
  return { router, broadcasts };
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
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Write" });
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
  // the executor under HARNESS_REMOTE_BRIDGE_MODE=dispatch. Default
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

test("R2.5-b: routeRemote returns {broadcast, rejected, sanitized, dispatched} on every accepted call", () => {
  const { router } = makeRouter();
  const result = router.routeRemote("rr-1", {
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
    "R2.5-b leaves dispatched=null; R2.5-c wires the dispatch path");
});

test("R2.5-b: routeRemote returns rejected reason for hook outside the allowlist", () => {
  const { router } = makeRouter();
  const result = router.routeRemote("rr-1", {
    hook: "SessionStart", tool: "Read",
  });
  // SessionStart is intentionally NOT in ALLOWED_HOOKS for R2.5.
  assert.equal(result.broadcast, true,
    "broadcast still happens — operator should see the inbound traffic");
  assert.ok(result.rejected, "SessionStart must be rejected");
  assert.equal(result.rejected.reason, "hook_not_allowed");
  assert.equal(result.sanitized, null, "rejected frames have no sanitized payload");
});

test("R2.5-b: routeRemote returns rejected reason for write-side tools (Bash / Write / Edit)", () => {
  const { router } = makeRouter();
  for (const tool of ["Bash", "Write", "Edit"]) {
    const result = router.routeRemote("rr-1", {
      hook: "PreToolUse", tool,
      data: { command: "rm -rf /" },
    });
    assert.equal(result.rejected && result.rejected.reason, "tool_not_allowed",
      `tool=${tool} should reject with tool_not_allowed`);
    assert.equal(result.sanitized, null);
  }
});

test("R2.5-b: routeRemote stats track sanitized + rejected counts", () => {
  const { router } = makeRouter();
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read" });    // accept
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Read" });    // accept
  router.routeRemote("rr-1", { hook: "PreToolUse", tool: "Bash" });    // reject
  router.routeRemote("rr-1", { hook: "Custom" });                       // reject
  const stats = router.getStats();
  assert.equal(stats.remoteHookSanitized, 2);
  assert.equal(stats.remoteHookRejected, 2);
  // Total + remoteHooks counts (R1-k2 + R1-k1) still tick on every
  // accepted-as-routeRemote-call regardless of sanitization outcome.
  assert.equal(stats.total, 4);
  assert.equal(stats.remoteHooks, 4);
});

test("R2.5-b: routeRemote returns the empty result on null/missing inputs (no broadcast)", () => {
  // Defensive guard: when the input itself is invalid, broadcast is
  // skipped (no audit anchor either) — these calls should never have
  // happened. Distinct from "hook_not_allowed" which IS an attacker
  // event the operator should see.
  const { router } = makeRouter();
  const r1 = router.routeRemote("", { hook: "PreToolUse", tool: "Read" });
  const r2 = router.routeRemote(null, { hook: "PreToolUse", tool: "Read" });
  const r3 = router.routeRemote("rr-1", null);
  for (const r of [r1, r2, r3]) {
    assert.equal(r.broadcast, false);
    assert.equal(r.rejected, null);
    assert.equal(r.sanitized, null);
  }
});
