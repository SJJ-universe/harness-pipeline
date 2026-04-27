// Slice MB4-d (Phase D Round 2, 2026-04-27) — eventBroadcaster tests.
//
// Locks the public contract of createEventBroadcaster:
//   - broadcast(event) sends to every OPEN ws in clients
//   - replay buffer captures every event before send
//   - IMMEDIATE_TYPES bypass throttle
//   - non-immediate types: first call sends; subsequent debounce
//   - lifecycle events fire heartbeat.start / stop after attachHeartbeat
//   - graceful degradation when send throws / heartbeat throws

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createEventBroadcaster,
  DEFAULT_IMMEDIATE_TYPES,
} = require("../../src/server/eventBroadcaster");

function makeWS(state = 1) {
  const sent = [];
  return {
    readyState: state,
    send(s) { sent.push(s); },
    _sent: sent,
  };
}

function manualTimers() {
  const scheduled = new Map();
  let nextId = 1;
  const setTimeoutFn = (fn, ms) => {
    const id = nextId++;
    scheduled.set(id, { fn, ms });
    return id;
  };
  const clearTimeoutFn = (id) => { scheduled.delete(id); };
  return {
    setTimeoutFn, clearTimeoutFn, scheduled,
    fireAll() {
      const fns = Array.from(scheduled.values()).map((s) => s.fn);
      scheduled.clear();
      for (const fn of fns) fn();
    },
  };
}

// ── input validation ────────────────────────────────────────────────

test("createEventBroadcaster throws when clients is not iterable", () => {
  assert.throws(() => createEventBroadcaster({ clients: null }), /iterable/);
});

test("DEFAULT_IMMEDIATE_TYPES export covers the canonical hot path", () => {
  assert.ok(DEFAULT_IMMEDIATE_TYPES.includes("phase_update"));
  assert.ok(DEFAULT_IMMEDIATE_TYPES.includes("pipeline_start"));
  assert.ok(DEFAULT_IMMEDIATE_TYPES.includes("hook_event"));
});

// ── basic broadcast ─────────────────────────────────────────────────

test("broadcast sends to every OPEN ws + skips closed/non-open", () => {
  const open1 = makeWS(1);
  const open2 = makeWS(1);
  const closed = makeWS(3);
  const clients = new Set([open1, open2, closed]);
  const eb = createEventBroadcaster({ clients });
  eb.broadcast({ type: "phase_update", data: { phase: "B" } });
  assert.equal(open1._sent.length, 1);
  assert.equal(open2._sent.length, 1);
  assert.equal(closed._sent.length, 0);
});

test("broadcast captures events into the replay buffer", () => {
  const clients = new Set();
  const eb = createEventBroadcaster({ clients });
  eb.broadcast({ type: "tool_recorded", data: { runId: "default", tool: "Edit" } });
  const all = eb.eventReplayBuffer.snapshot();
  assert.equal(all.length, 1);
  assert.equal(all[0].event.type, "tool_recorded");
});

test("broadcast tolerates ws.send throwing without aborting other clients", () => {
  const angry = { readyState: 1, send() { throw new Error("EPIPE"); } };
  const ok = makeWS(1);
  const clients = new Set([angry, ok]);
  const eb = createEventBroadcaster({ clients });
  assert.doesNotThrow(() => eb.broadcast({ type: "phase_update", data: {} }));
  assert.equal(ok._sent.length, 1);
});

// ── throttle behaviour ──────────────────────────────────────────────

test("non-immediate type: first send is immediate, second is debounced", () => {
  const ws = makeWS(1);
  const clients = new Set([ws]);
  const tm = manualTimers();
  const eb = createEventBroadcaster({
    clients,
    immediateTypes: new Set(),    // empty so even phase_update is throttleable
    throttleMs: 100,
    setTimeoutFn: tm.setTimeoutFn,
    clearTimeoutFn: tm.clearTimeoutFn,
  });
  eb.broadcast({ type: "x", data: {} });
  assert.equal(ws._sent.length, 1, "first call sent immediately");
  // Schedule was set.
  assert.equal(tm.scheduled.size, 1);
  // Second call within window → debounced (does NOT immediately send).
  eb.broadcast({ type: "x", data: { v: 2 } });
  assert.equal(ws._sent.length, 1, "second call held");
  // Fire timer → debounced send fires.
  tm.fireAll();
  assert.equal(ws._sent.length, 2);
  // The fired send carries the SECOND event's data.
  assert.match(ws._sent[1], /"v":2/);
});

test("IMMEDIATE_TYPES bypass throttle entirely (multiple sends back-to-back)", () => {
  const ws = makeWS(1);
  const clients = new Set([ws]);
  const tm = manualTimers();
  const eb = createEventBroadcaster({
    clients,
    setTimeoutFn: tm.setTimeoutFn,
    clearTimeoutFn: tm.clearTimeoutFn,
  });
  // phase_update is in DEFAULT_IMMEDIATE_TYPES.
  eb.broadcast({ type: "phase_update", data: { phase: "A" } });
  eb.broadcast({ type: "phase_update", data: { phase: "B" } });
  eb.broadcast({ type: "phase_update", data: { phase: "C" } });
  assert.equal(ws._sent.length, 3);
  assert.equal(tm.scheduled.size, 0, "no debounce timer scheduled for immediate types");
});

// ── pipeline lifecycle hooks ────────────────────────────────────────

test("pipeline_start fires heartbeat.start + clears replay buffer", () => {
  const clients = new Set();
  const eb = createEventBroadcaster({ clients });
  eb.broadcast({ type: "tool_recorded", data: {} });
  assert.equal(eb.eventReplayBuffer.snapshot().length, 1);
  let starts = 0;
  eb.attachHeartbeat({ start: () => starts++, stop: () => {} });
  eb.broadcast({ type: "pipeline_start", data: {} });
  // Legacy semantics: append → clear, so the buffer ends EMPTY after a
  // pipeline_start (subsequent events accumulate normally). Tested via
  // replay buffer's snapshot length being 0.
  assert.equal(eb.eventReplayBuffer.snapshot().length, 0, "buffer cleared on pipeline_start");
  assert.equal(starts, 1);
  // Subsequent event accumulates.
  eb.broadcast({ type: "tool_recorded", data: { x: 2 } });
  assert.equal(eb.eventReplayBuffer.snapshot().length, 1);
});

test("pipeline_complete fires heartbeat.stop", () => {
  const eb = createEventBroadcaster({ clients: new Set() });
  let stops = 0;
  eb.attachHeartbeat({ start: () => {}, stop: () => stops++ });
  eb.broadcast({ type: "pipeline_complete", data: {} });
  assert.equal(stops, 1);
});

test("auto_pipeline_detect fires heartbeat.start (hook-driven)", () => {
  const eb = createEventBroadcaster({ clients: new Set() });
  let starts = 0;
  eb.attachHeartbeat({ start: () => starts++, stop: () => {} });
  eb.broadcast({ type: "auto_pipeline_detect", data: {} });
  assert.equal(starts, 1);
});

test("pipeline_paused fires heartbeat.stop", () => {
  const eb = createEventBroadcaster({ clients: new Set() });
  let stops = 0;
  eb.attachHeartbeat({ start: () => {}, stop: () => stops++ });
  eb.broadcast({ type: "pipeline_paused", data: {} });
  assert.equal(stops, 1);
});

test("lifecycle hooks are no-ops before attachHeartbeat", () => {
  const eb = createEventBroadcaster({ clients: new Set() });
  assert.doesNotThrow(() => eb.broadcast({ type: "pipeline_start", data: {} }));
  assert.doesNotThrow(() => eb.broadcast({ type: "pipeline_complete", data: {} }));
});

test("heartbeat throw is swallowed (broadcast must keep working)", () => {
  const eb = createEventBroadcaster({ clients: new Set() });
  eb.attachHeartbeat({ start: () => { throw new Error("hb crash"); }, stop: () => {} });
  assert.doesNotThrow(() => eb.broadcast({ type: "pipeline_start", data: {} }));
});

// ── disposeAllTimers ─────────────────────────────────────────────────

test("disposeAllTimers clears any pending throttle timers", () => {
  const tm = manualTimers();
  const eb = createEventBroadcaster({
    clients: new Set([makeWS(1)]),
    immediateTypes: new Set(),
    setTimeoutFn: tm.setTimeoutFn,
    clearTimeoutFn: tm.clearTimeoutFn,
  });
  eb.broadcast({ type: "x" });
  assert.equal(tm.scheduled.size, 1);
  eb.disposeAllTimers();
  assert.equal(tm.scheduled.size, 0);
});
