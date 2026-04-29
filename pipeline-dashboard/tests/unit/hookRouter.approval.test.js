// Slice R3-e-d (Phase D R3, 2026-04-29) — hook-router approval gate.
//
// These tests cover the new approval-gate behavior in
// `_dispatchSanitized` + `_gateOnApproval`. Read-only tools
// (Read/Grep/Glob) bypass the gate and dispatch as before; write
// tools (Bash/Edit/Write) round-trip through the approvalManager
// before any executor method is invoked. Without an approvalManager
// wired, write-tool dispatch fail-closes (`approval_unavailable`).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { HookRouter } = require("../../executor/hook-router");
const { ApprovalManager } = require("../../src/runtime/approvalManager");

// ── Helpers ────────────────────────────────────────────────────────

function makeMockExecutor() {
  const calls = [];
  const exec = {
    calls,
    onPreTool: async (tool, input) => { calls.push({ method: "onPreTool", tool, input }); },
    onPostTool: async (tool, response, input) => { calls.push({ method: "onPostTool", tool, response, input }); },
    onStop: async (data) => { calls.push({ method: "onStop", data }); },
  };
  return exec;
}

function makeRouter(opts = {}) {
  const broadcasts = [];
  const router = new HookRouter({
    broadcast: (msg) => broadcasts.push(msg),
    sessionWatcher: { isHookDriven: false },
    bridgeMode: "dispatch",  // Approval only fires in dispatch mode.
    ...opts,
  });
  return { router, broadcasts };
}

function makeManager(opts = {}) {
  const audits = [];
  const broadcasts = [];
  const manager = new ApprovalManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    broadcastFn: (type, data) => broadcasts.push({ type, data }),
    setTimeoutFn: () => 0,  // no real timers in tests
    clearTimeoutFn: () => {},
    ...opts,
  });
  return { manager, audits, broadcasts };
}

// ── Read-only tools bypass the gate ────────────────────────────────

test("R3-e-d: read-only tools dispatch directly without approval", async () => {
  const { manager, audits } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/x" },
  });

  assert.equal(result.sanitized.requiresApproval, false);
  assert.equal(result.approval, null,
    "approval should be null for read-only dispatch");
  assert.ok(result.dispatched.ok);
  assert.equal(result.dispatched.method, "onPreTool");
  assert.equal(exec.calls.length, 1);
  assert.equal(audits.length, 0,
    "no approval audit verbs for read-only dispatch");
});

// ── Write tools: fail-closed when no manager wired ────────────────

test("R3-e-d: write-tool dispatch fail-closes when no approvalManager wired", async () => {
  // Default makeRouter does NOT inject an approvalManager. Sanitizer
  // marks Bash as requiresApproval; the gate refuses to dispatch.
  const { router } = makeRouter();  // no approvalManager
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "echo hi" },
  });

  assert.equal(result.sanitized.requiresApproval, true);
  assert.ok(result.approval);
  assert.equal(result.approval.requested, false);
  assert.equal(result.approval.resolution, "unavailable");
  assert.ok(result.dispatched);
  assert.equal(result.dispatched.ok, false);
  assert.equal(result.dispatched.error, "approval_unavailable");
  assert.equal(exec.calls.length, 0,
    "executor MUST NOT be invoked when approval is unavailable");

  // Stats counter
  assert.equal(router.getStats().remoteHookApprovalUnavailable, 1);
});

// ── Write tools: granted dispatches normally ──────────────────────

test("R3-e-d: write-tool dispatch proceeds after grant", async () => {
  const { manager, audits } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  // Drive routeRemote concurrently with the grant — the request
  // promise resolves once we fire grant.
  const routePromise = router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "echo hi" },
  }, { hostIdentity: "host-A", source: "remote_hook" });

  // Wait one microtask for the manager to register the request.
  await new Promise((r) => setImmediate(r));
  assert.equal(manager.size(), 1, "manager should have one pending request");
  const id = manager.list()[0].approvalId;
  assert.equal(manager.list()[0].runId, "rr-1");
  assert.equal(manager.list()[0].hostIdentity, "host-A");

  manager.grant(id, { deciderId: "operator-1" });

  const result = await routePromise;

  assert.equal(result.approval.requested, true);
  assert.equal(result.approval.resolution, "granted");
  assert.equal(result.approval.deciderId, "operator-1");
  assert.ok(result.dispatched.ok);
  assert.equal(result.dispatched.method, "onPreTool");
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].tool, "Bash");
  assert.equal(exec.calls[0].input.command, "echo hi");

  // Audit chain: requested + granted (manager's own emissions)
  assert.equal(audits[0].verb, "runner_hook_approval_requested");
  assert.equal(audits[1].verb, "runner_hook_approval_granted");

  // Stats
  const stats = router.getStats();
  assert.equal(stats.remoteHookApprovalRequested, 1);
  assert.equal(stats.remoteHookApprovalGranted, 1);
  assert.equal(stats.remoteHookDispatched, 1);
});

// ── Write tools: denied does not dispatch ─────────────────────────

test("R3-e-d: write-tool dispatch BLOCKED on deny", async () => {
  const { manager, audits } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  const routePromise = router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Edit",
    data: { file_path: "/etc/passwd", old_string: "x", new_string: "y" },
  });

  await new Promise((r) => setImmediate(r));
  const id = manager.list()[0].approvalId;
  manager.deny(id, { deciderId: "operator-1", reason: "looks dangerous" });

  const result = await routePromise;

  assert.equal(result.approval.resolution, "denied");
  assert.equal(result.approval.reason, "looks dangerous");
  assert.equal(result.dispatched.ok, false);
  assert.equal(result.dispatched.error, "approval_denied");
  assert.equal(exec.calls.length, 0,
    "executor MUST NOT run when operator denied");

  assert.equal(audits[1].verb, "runner_hook_approval_denied");
  assert.equal(router.getStats().remoteHookApprovalDenied, 1);
  assert.equal(router.getStats().remoteHookDispatched || 0, 0);
});

// ── Write tools: timeout does not dispatch ────────────────────────

test("R3-e-d: write-tool dispatch BLOCKED on timeout", async () => {
  // We need the manager to schedule a timer that we control. Use a
  // controllable harness so we can fire the timeout deterministically.
  const audits = [];
  let timerCb = null;
  const manager = new ApprovalManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    setTimeoutFn: (cb) => { timerCb = cb; return 1; },
    clearTimeoutFn: () => {},
  });
  const { router } = makeRouter({ approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  const routePromise = router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Write",
    data: { file_path: "/tmp/x", content: "hello" },
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(timerCb, "manager should have scheduled a timer");
  timerCb();  // fire timeout

  const result = await routePromise;
  assert.equal(result.approval.resolution, "timeout");
  assert.equal(result.dispatched.error, "approval_timeout");
  assert.equal(audits[1].verb, "runner_hook_approval_timeout");
  assert.equal(router.getStats().remoteHookApprovalTimeout, 1);
});

// ── Write tools: cancelled (e.g., run completed) does not dispatch ─

test("R3-e-d: write-tool dispatch BLOCKED on cancel (e.g. run-end cancel)", async () => {
  const { manager } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  const routePromise = router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "long-running" },
  });
  await new Promise((r) => setImmediate(r));
  const id = manager.list()[0].approvalId;
  manager.cancel(id, { reason: "run_completed" });

  const result = await routePromise;
  assert.equal(result.approval.resolution, "cancelled");
  assert.equal(result.approval.reason, "run_completed");
  assert.equal(result.dispatched.error, "approval_cancelled");
  assert.equal(router.getStats().remoteHookApprovalCancelled, 1);
});

// ── routeRemote propagates ctx.hostIdentity / ctx.source ──────────

test("R3-e-d: routeRemote ctx is plumbed through to approval request", async () => {
  const { manager } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "x" },
  }, { hostIdentity: "host-XYZ", source: "remote_hook_v2" });
  await new Promise((r) => setImmediate(r));

  const list = manager.list();
  assert.equal(list[0].hostIdentity, "host-XYZ");
  assert.equal(list[0].source, "remote_hook_v2");
});

// ── Bridge mode: report mode skips approval AND dispatch ──────────

test("R3-e-d: bridgeMode='report' skips approval + dispatch (sanitization only)", async () => {
  const { manager } = makeManager();
  const { router } = makeRouter({ bridgeMode: "report", approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "echo hi" },
  });

  assert.ok(result.sanitized);
  assert.equal(result.sanitized.requiresApproval, true);
  assert.equal(result.approval, null,
    "report mode never asks for approval — operator is previewing");
  assert.equal(result.dispatched, null);
  assert.equal(manager.size(), 0,
    "manager should not have a pending request from a report-mode call");
});

// ── Bridge mode: off skips everything ──────────────────────────────

test("R3-e-d: bridgeMode='off' (default) preserves R1/R2 broadcast-only behavior", async () => {
  const { manager } = makeManager();
  const { router } = makeRouter({ bridgeMode: "off", approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "echo hi" },
  });

  assert.ok(result.broadcast);
  assert.ok(result.sanitized);  // sanitizer still runs
  assert.equal(result.approval, null);
  assert.equal(result.dispatched, null);
  assert.equal(manager.size(), 0);
});

// ── Read-only tools dispatch even when manager is wired ────────────

test("R3-e-d: Read tool ignores approvalManager (dispatches without asking)", async () => {
  const { manager, audits } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Read", data: { file_path: "/x" },
  });
  await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Grep", data: { pattern: "x" },
  });
  await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Glob", data: { glob: "*.js" },
  });

  assert.equal(exec.calls.length, 3, "all 3 read-only dispatches happened");
  assert.equal(manager.size(), 0, "no approval requests issued");
  assert.equal(audits.length, 0, "no approval audit verbs");
});

// ── Stats: approval counters increment correctly ───────────────────

test("R3-e-d: stats track approval lifecycle counters", async () => {
  const { manager } = makeManager();
  const { router } = makeRouter({ approvalManager: manager });
  router.attachExecutor(makeMockExecutor());

  // Fire 3 write-tool requests; grant 1, deny 1, leave 1 pending.
  const p1 = router.routeRemote("r1", { hook: "PreToolUse", tool: "Bash", data: { command: "a" } });
  const p2 = router.routeRemote("r1", { hook: "PreToolUse", tool: "Bash", data: { command: "b" } });
  const p3 = router.routeRemote("r1", { hook: "PreToolUse", tool: "Bash", data: { command: "c" } });

  await new Promise((r) => setImmediate(r));
  const ids = manager.list().map((s) => s.approvalId);
  manager.grant(ids[0]);
  manager.deny(ids[1]);
  // Leave ids[2] pending; cancel it via cancelByRunId.
  manager.cancelByRunId("r1");

  await Promise.all([p1, p2, p3]);

  const stats = router.getStats();
  assert.equal(stats.remoteHookApprovalRequested, 3);
  assert.equal(stats.remoteHookApprovalGranted, 1);
  assert.equal(stats.remoteHookApprovalDenied, 1);
  assert.equal(stats.remoteHookApprovalCancelled, 1);
});

// ── Manager throwing on .request() is treated as fail-closed ──────

test("R3-e-d: manager.request that throws yields approval_unavailable", async () => {
  // Construct a manager-like that throws on every request — simulates
  // a corrupted state. The router should fail-closed without crashing.
  const broken = {
    request: () => { throw new Error("manager corrupted"); },
  };
  const { router } = makeRouter({ approvalManager: broken });
  const exec = makeMockExecutor();
  router.attachExecutor(exec);

  const result = await router.routeRemote("rr-1", {
    hook: "PreToolUse", tool: "Bash", data: { command: "x" },
  });

  assert.equal(result.approval.resolution, "unavailable");
  assert.equal(result.dispatched.error, "approval_unavailable");
  assert.equal(exec.calls.length, 0);
});
