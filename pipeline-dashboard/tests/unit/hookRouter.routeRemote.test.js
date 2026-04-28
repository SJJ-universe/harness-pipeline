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
  // Belt-and-suspenders: in R2+ a controlled bridge MAY route remote
  // hooks into a sanitized subset of executor calls. R1 is "report only".
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
  assert.equal(executorCalls, 0, "remote hooks must NOT drive the local executor in R1");
});
