const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventReplayBuffer, REPLAY_TYPES } = require("../../src/runtime/eventReplayBuffer");

test("append stores only REPLAY_TYPES events", () => {
  const buf = createEventReplayBuffer();
  buf.append({ type: "tool_recorded", data: { tool: "Read" } });
  buf.append({ type: "heartbeat", data: {} }); // not in REPLAY_TYPES
  buf.append({ type: "log_message", data: {} }); // not in REPLAY_TYPES
  buf.append({ type: "tool_blocked", data: { tool: "Bash" } });
  assert.equal(buf.size(), 2);
  const snap = buf.snapshot();
  assert.equal(snap[0].event.type, "tool_recorded");
  assert.equal(snap[1].event.type, "tool_blocked");
});

test("append ignores null/invalid events", () => {
  const buf = createEventReplayBuffer();
  buf.append(null);
  buf.append(undefined);
  buf.append("string");
  buf.append({}); // no type
  assert.equal(buf.size(), 0);
});

test("ring buffer drops oldest when maxSize exceeded", () => {
  const buf = createEventReplayBuffer({ maxSize: 3 });
  buf.append({ type: "tool_recorded", data: { i: 1 } });
  buf.append({ type: "tool_recorded", data: { i: 2 } });
  buf.append({ type: "tool_recorded", data: { i: 3 } });
  buf.append({ type: "tool_recorded", data: { i: 4 } });
  buf.append({ type: "tool_recorded", data: { i: 5 } });
  assert.equal(buf.size(), 3);
  const snap = buf.snapshot();
  assert.deepEqual(snap.map((e) => e.event.data.i), [3, 4, 5]);
});

test("clear empties the buffer", () => {
  const buf = createEventReplayBuffer();
  buf.append({ type: "tool_recorded", data: {} });
  buf.append({ type: "critique_received", data: {} });
  assert.equal(buf.size(), 2);
  buf.clear();
  assert.equal(buf.size(), 0);
  assert.deepEqual(buf.snapshot(), []);
});

test("REPLAY_TYPES includes critical UI events", () => {
  assert.ok(REPLAY_TYPES.has("tool_blocked"));
  assert.ok(REPLAY_TYPES.has("tool_recorded"));
  assert.ok(REPLAY_TYPES.has("gate_failed"));
  assert.ok(REPLAY_TYPES.has("critique_received"));
  assert.ok(REPLAY_TYPES.has("phase_update"));
  // heartbeat must NOT be in REPLAY_TYPES (live-only, not replayable)
  assert.equal(REPLAY_TYPES.has("heartbeat"), false);
});
