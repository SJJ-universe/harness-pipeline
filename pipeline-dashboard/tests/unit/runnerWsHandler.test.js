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
    unregisterRemoteById: (id) => { childCalls.push({ op: "unregister", id }); return true; },
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

// ── agent_stopped → unregisterRemoteById ──────────────────────────

test("R1-g: agent_stopped frame → childRegistry.unregisterRemoteById", () => {
  const mocks = makeMocks();
  const handle = createRunnerWsHandler({ ...mocks });
  const ws = new MockWs();
  handle(ws, {}, VERDICT);
  // Start then stop.
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STARTED, id: "agent-bbb", label: "x" }));
  ws.emit("message", JSON.stringify({ type: FRAME_AGENT_STOPPED, id: "agent-bbb" }));
  const unreg = mocks.childCalls.find((c) => c.op === "unregister" && c.id === "agent-bbb");
  assert.ok(unreg);
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

test("R1-g: close auto-unregisters every agent started in this connection", () => {
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
