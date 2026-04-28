// Slice R1-g (Phase D R1, 2026-04-28) — runnerWsHandler unit tests.
//
// Drives the handler with a mock WS to assert frame routing without the
// network. The integration test (`tests/integration/runner-ws-r1g.test.js`)
// covers the end-to-end loop with real WS + the runner agent.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  createRunnerWsHandler,
  HELLO_TYPE,
  FRAME_AGENT_STARTED,
  FRAME_AGENT_STOPPED,
  FRAME_HOOK,
} = require("../../src/server/runnerWsHandler");

class MockWs extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }
  send(data) { this.sent.push(data); }
  close() { this.emit("close", 1000, Buffer.from("test")); }
}

const VERDICT = Object.freeze({
  ok: true,
  runId: "rr-1",
  hostIdentity: "runner-x",
  runOrigin: "container-remote",
  sandboxClass: "container-strict",
  payload: { sub: "rr-1", aud: "runner-rr-1" },
});

function makeMocks() {
  const childCalls = [];
  const childRegistry = {
    registerRemote: (opts) => { childCalls.push({ op: "register", ...opts }); return { ref: opts.id }; },
    // R1-k1: unregisterRemote takes the {id, runId, hostIdentity} triple.
    // The mock records the full args so tests can lock the trust boundary
    // (id matches frame, runId/hostIdentity match the JWT verdict).
    unregisterRemote: (opts) => { childCalls.push({ op: "unregister", ...opts }); return true; },
  };
  const hookCalls = [];
  const hookRouter = {
    routeRemote: (runId, event) => { hookCalls.push({ runId, event }); },
  };
  const ledgerCalls = [];
  const ledger = {
    append: (runId, entry) => { ledgerCalls.push({ runId, ...entry }); },
  };
  return { childRegistry, hookRouter, ledger, childCalls, hookCalls, ledgerCalls };
}

// ── hello + ledger basics (regression for R1-e-2) ─────────────────

test("R1-g: connect emits hello frame + runner_ws_connected ledger entry", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  assert.equal(ws.sent.length, 1);
  const frame = JSON.parse(ws.sent[0]);
  assert.equal(frame.type, HELLO_TYPE);
  assert.equal(frame.runId, "rr-1");
  const connected = mocks.ledgerCalls.find((e) => e.type === "runner_ws_connected");
  assert.ok(connected);
  assert.equal(connected.data.hostIdentity, "runner-x");
});

// ── agent_started → registerRemote ────────────────────────────────

test("R1-g: agent_started frame → childRegistry.registerRemote", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_AGENT_STARTED,
    id: "agent-aaa",
    label: "claude",
    agentType: "claude",
  }));
  const reg = mocks.childCalls.find((c) => c.op === "register" && c.id === "agent-aaa");
  assert.ok(reg);
  assert.equal(reg.runId, "rr-1");
  assert.equal(reg.hostIdentity, "runner-x");
  assert.equal(reg.label, "claude");
  assert.equal(reg.agentType, "claude");
  // Ledger entry mirrors the projection.
  const entry = mocks.ledgerCalls.find((e) => e.type === "runner_agent_started");
  assert.ok(entry);
  assert.equal(entry.runId, "rr-1");
  assert.equal(entry.data.id, "agent-aaa");
});

test("R1-g: agent_started without id is dropped", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, label: "x" }));
  assert.equal(mocks.childCalls.filter((c) => c.op === "register").length, 0);
});

// ── agent_stopped → unregisterRemote ──────────────────────────────

test("R1-g/R1-k1: agent_stopped frame → childRegistry.unregisterRemote with verdict scope", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  // Start then stop.
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "agent-bbb", label: "x" }));
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STOPPED, id: "agent-bbb" }));
  const unreg = mocks.childCalls.find((c) => c.op === "unregister" && c.id === "agent-bbb");
  assert.ok(unreg);
  // R1-k1: the runId + hostIdentity passed to unregisterRemote come from
  // the JWT verdict, NOT from the frame body.
  assert.equal(unreg.runId, "rr-1");
  assert.equal(unreg.hostIdentity, "runner-x");
});

test("R1-k1: agent_stopped frame body cannot override the verdict's runId/hostIdentity scope", () => {
  // The frame body could try to smuggle a stop for another run by
  // including extra fields. The handler must NEVER pass those values to
  // unregisterRemote — only verdict.runId / verdict.hostIdentity get
  // through.
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_AGENT_STOPPED,
    id: "agent-ccc",
    runId: "rr-EVIL",                 // attacker-controlled
    hostIdentity: "runner-EVIL",      // attacker-controlled
  }));
  const unreg = mocks.childCalls.find((c) => c.op === "unregister");
  assert.ok(unreg);
  assert.equal(unreg.id, "agent-ccc");
  assert.equal(unreg.runId, "rr-1", "verdict.runId is authoritative");
  assert.equal(unreg.hostIdentity, "runner-x", "verdict.hostIdentity is authoritative");
});

// ── hook → hookRouter.routeRemote ─────────────────────────────────

test("R1-g: hook frame → hookRouter.routeRemote with verified runId", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Read", data: { file: "x.js" } },
  }));
  assert.equal(mocks.hookCalls.length, 1);
  // CRITICAL: the runId passed to routeRemote MUST come from the verdict
  // (i.e. the verified JWT), NOT from the frame body.
  assert.equal(mocks.hookCalls[0].runId, "rr-1");
  assert.equal(mocks.hookCalls[0].event.hook, "PreToolUse");
});

test("R1-g: hook frame WITHOUT event is dropped (no routeRemote call)", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: FRAME_HOOK }));
  assert.equal(mocks.hookCalls.length, 0);
});

// ── R1-k2: hook success audit entry ───────────────────────────────

// ── R2.5-b: structured verdict + new audit verbs ──────────────────

test("R2.5-b: when routeRemote returns sanitized, handler emits runner_hook_sanitized", () => {
  const mocks = makeMocks();
  // Mock returns the R2.5-b verdict shape: sanitized, no reject.
  mocks.hookRouter.routeRemote = () => ({
    broadcast: true,
    rejected: null,
    sanitized: { hook: "PreToolUse", tool: "Read", _data: {} },
    dispatched: null,
  });
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Read" },
  }));
  // R1-k2 entry still fires (broadcast happened).
  const routed = mocks.ledgerCalls.find((e) => e.type === "runner_hook_routed");
  assert.ok(routed, "runner_hook_routed must still fire (R1-k2 backward compat)");
  // R2.5-b sanitized entry fires.
  const sanitized = mocks.ledgerCalls.find((e) => e.type === "runner_hook_sanitized");
  assert.ok(sanitized, "runner_hook_sanitized must fire when verdict.sanitized is set");
  assert.equal(sanitized.runId, "rr-1");
  assert.equal(sanitized.data.hook, "PreToolUse");
  assert.equal(sanitized.data.tool, "Read");
  // No rejected.
  const rejected = mocks.ledgerCalls.find((e) => e.type === "runner_hook_rejected");
  assert.equal(rejected, undefined, "rejected must NOT fire on a clean sanitization");
});

test("R2.5-b: when routeRemote returns rejected, handler emits runner_hook_rejected with reason", () => {
  const mocks = makeMocks();
  mocks.hookRouter.routeRemote = () => ({
    broadcast: true,
    rejected: { reason: "tool_not_allowed" },
    sanitized: null,
    dispatched: null,
  });
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Bash" },
  }));
  // R1-k2 entry still fires (broadcast still happens).
  const routed = mocks.ledgerCalls.find((e) => e.type === "runner_hook_routed");
  assert.ok(routed, "runner_hook_routed must still fire on rejected frames (operator visibility)");
  // R2.5-b rejected entry fires with reason.
  const rejected = mocks.ledgerCalls.find((e) => e.type === "runner_hook_rejected");
  assert.ok(rejected, "runner_hook_rejected must fire when verdict.rejected is set");
  assert.equal(rejected.data.reason, "tool_not_allowed");
  assert.equal(rejected.data.hook, "PreToolUse");
  assert.equal(rejected.data.tool, "Bash");
  // No sanitized.
  const sanitized = mocks.ledgerCalls.find((e) => e.type === "runner_hook_sanitized");
  assert.equal(sanitized, undefined, "sanitized must NOT fire on a rejected frame");
});

test("R2.5-b: backward compat — handler tolerates routeRemote that returns nothing", () => {
  // Old mocks (pre-R2.5-b) return undefined. Handler should still
  // emit runner_hook_routed but skip the new verbs gracefully.
  const mocks = makeMocks();
  mocks.hookRouter.routeRemote = () => {};  // return undefined
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Read" },
  }));
  const routed = mocks.ledgerCalls.find((e) => e.type === "runner_hook_routed");
  assert.ok(routed);
  // Neither sanitized nor rejected — verdict was undefined.
  assert.equal(mocks.ledgerCalls.find((e) => e.type === "runner_hook_sanitized"), undefined);
  assert.equal(mocks.ledgerCalls.find((e) => e.type === "runner_hook_rejected"), undefined);
});

test("R1-k2: every successfully routed hook frame appends runner_hook_routed", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Read", data: { file: "x.js" } },
  }));
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PostToolUse", tool: "Bash", data: { exit: 0 } },
  }));
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "Stop", tool: null, data: {} },
  }));
  const routed = mocks.ledgerCalls.filter((e) => e.type === "runner_hook_routed");
  assert.equal(routed.length, 3, "one runner_hook_routed per accepted hook");
  // Every entry carries the verdict's runId and the hook + tool fields.
  assert.equal(routed[0].runId, "rr-1");
  assert.equal(routed[0].data.hostIdentity, "runner-x");
  assert.equal(routed[0].data.hook, "PreToolUse");
  assert.equal(routed[0].data.tool, "Read");
  assert.equal(routed[1].data.hook, "PostToolUse");
  assert.equal(routed[1].data.tool, "Bash");
  assert.equal(routed[2].data.hook, "Stop");
  assert.equal(routed[2].data.tool, null);
});

test("R1-k2: runner_hook_routed does NOT persist event.data (size + sensitivity)", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: {
      hook: "PreToolUse",
      tool: "Bash",
      data: { command: "rm -rf /tmp/secrets", env: { SECRET: "leak-this" } },
    },
  }));
  const routed = mocks.ledgerCalls.find((e) => e.type === "runner_hook_routed");
  assert.ok(routed);
  // The audit entry intentionally omits event.data — those fields are
  // already broadcast for live consumers but are too large / sensitive
  // for the persistent ledger.
  assert.equal(routed.data.command, undefined);
  assert.equal(routed.data.env, undefined);
  assert.equal(routed.data.data, undefined);
  assert.equal(routed.data.hook, "PreToolUse");
  assert.equal(routed.data.tool, "Bash");
});

test("R1-k2: failure path still emits runner_hook_route_error, NOT runner_hook_routed", () => {
  // The success entry must not appear when routeRemote throws — only the
  // error entry. This locks the invariant that the chain reflects what
  // actually happened, not just what was attempted.
  const mocks = makeMocks();
  mocks.hookRouter.routeRemote = () => { throw new Error("downstream broke"); };
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    event: { hook: "PreToolUse", tool: "Read" },
  }));
  const routed = mocks.ledgerCalls.find((e) => e.type === "runner_hook_routed");
  const errored = mocks.ledgerCalls.find((e) => e.type === "runner_hook_route_error");
  assert.equal(routed, undefined, "success entry must NOT fire when routing throws");
  assert.ok(errored, "error entry MUST fire");
});

test("R1-g: routeRemote throws → ledger captures runner_hook_route_error, handler stays alive", () => {
  const mocks = makeMocks();
  mocks.hookRouter.routeRemote = () => { throw new Error("boom"); };
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: FRAME_HOOK, event: { hook: "Stop" } }));
  const err = mocks.ledgerCalls.find((e) => e.type === "runner_hook_route_error");
  assert.ok(err);
  assert.match(err.data.error, /boom/);
  // Handler should still process subsequent frames without crashing.
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "post-error" }));
  assert.equal(mocks.childCalls.filter((c) => c.op === "register").length, 1);
});

// ── unknown / malformed → drop ────────────────────────────────────

test("R1-g: malformed JSON is dropped silently", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", "not-json{[}");
  // No projections; close-time stats record drop.
  ws.close();
  const closed = mocks.ledgerCalls.find((e) => e.type === "runner_ws_disconnected");
  assert.equal(closed.data.messagesDropped, 1);
  assert.equal(closed.data.messagesRouted, 0);
});

test("R1-g: unknown frame type is dropped + counted", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: "future_frame_type", payload: {} }));
  ws.close();
  const closed = mocks.ledgerCalls.find((e) => e.type === "runner_ws_disconnected");
  assert.equal(closed.data.messagesDropped, 1);
  assert.equal(closed.data.lastFrameType, "future_frame_type");
});

// ── auto-cleanup on close ─────────────────────────────────────────

test("R1-g/R1-k1: close auto-unregisters every agent started in this connection (scoped)", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "a1" }));
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "a2" }));
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "a3" }));
  // Explicitly stop one — should not be auto-cleared again.
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STOPPED, id: "a2" }));
  ws.close();
  const unreg = mocks.childCalls.filter((c) => c.op === "unregister");
  // a2 from explicit stop, a1 + a3 from auto-cleanup = 3 total.
  assert.equal(unreg.length, 3);
  // R1-k1: every auto-cleanup call carries the verdict's runId +
  // hostIdentity, so the registry only removes children belonging to
  // this exact (run, host) pair.
  for (const u of unreg) {
    assert.equal(u.runId, "rr-1");
    assert.equal(u.hostIdentity, "runner-x");
  }
  const closed = mocks.ledgerCalls.find((e) => e.type === "runner_ws_disconnected");
  // a1 + a3 = 2 auto-cleared.
  assert.equal(closed.data.agentsAutoCleared, 2);
});

test("R1-g: handler works when childRegistry / hookRouter are null", () => {
  // Backwards-compat: a handler without dependencies still accepts frames
  // and counts them — the integration just doesn't fan out anywhere.
  const handle = createRunnerWsHandler({ ledger: null, childRegistry: null, hookRouter: null });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "a1" }));
  ws.emit("message", JSON.stringify({ type: FRAME_HOOK, event: { hook: "Stop" } }));
  // No throws.
  ws.close();
});

// ── runId trust boundary ──────────────────────────────────────────

test("R1-g: hook frame body CANNOT override the verdict runId", () => {
  // The point of using verdict.runId for routeRemote is that the runner
  // can't smuggle hooks into another run by lying about the runId in
  // its frames. This locks that invariant.
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);     // verdict.runId = "rr-1"
  ws.emit("message", JSON.stringify({
    type: FRAME_HOOK,
    runId: "rr-EVIL-SMUGGLE",  // attacker-controlled
    event: { hook: "PostToolUse" },
  }));
  assert.equal(mocks.hookCalls.length, 1);
  assert.equal(mocks.hookCalls[0].runId, "rr-1", "verdict.runId is authoritative");
});
