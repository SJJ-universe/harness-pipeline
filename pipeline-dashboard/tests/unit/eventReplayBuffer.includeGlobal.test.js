// Slice AA-2 (Phase 2.5) — eventReplayBuffer.snapshot({ runId, includeGlobal }).
//
// Background: snapshot() has always returned entries whose event.data.runId
// either matches the requested runId OR is missing entirely. That rule was
// correct for *initial hydration* (a freshly connected client needs every
// global event), but it's wrong for *tab switches* — if the user flips from
// tab A to tab B the server must not re-emit past `toast` / `hook_event`
// traces, otherwise every tab switch duplicates them.
//
// The new `includeGlobal` option (default true for back-compat) lets callers
// opt into strict run-scoped replay.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEventReplayBuffer, REPLAY_TYPES } = require("../../src/runtime/eventReplayBuffer");

// Pick a REPLAY_TYPES-friendly event type for the test fixtures.
const TYPE = "tool_recorded";
assert.ok(REPLAY_TYPES.has(TYPE), "test precondition: tool_recorded is replayable");
// `hook_event` is also replayable and is the canonical "global" event.
const GLOBAL_TYPE = "hook_event";
assert.ok(REPLAY_TYPES.has(GLOBAL_TYPE), "test precondition: hook_event is replayable");

function seed(buf, items) {
  for (const item of items) buf.append(item);
}

test("no runId arg → full buffer (backward compatible)", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: TYPE, data: { runId: "A", tool: "Read" } },
    { type: GLOBAL_TYPE, data: { event: "pre-tool" } },       // no runId
    { type: TYPE, data: { runId: "B", tool: "Edit" } },
  ]);
  const snap = buf.snapshot();
  assert.equal(snap.length, 3, "all entries returned when no runId asked");
});

test("default includeGlobal=true keeps legacy semantics (matches Slice T)", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: TYPE, data: { runId: "A", tool: "Read" } },
    { type: GLOBAL_TYPE, data: { event: "pre-tool" } },       // no runId
    { type: TYPE, data: { runId: "B", tool: "Edit" } },
  ]);
  const snap = buf.snapshot({ runId: "A" }); // includeGlobal defaults to true
  assert.equal(snap.length, 2, "own-run + global returned");
  const runIds = snap.map((e) => e.event.data.runId);
  assert.ok(runIds.includes("A"), "own-run entry preserved");
  assert.ok(runIds.includes(undefined), "global entry preserved under lax mode");
  assert.ok(!runIds.includes("B"), "other-run entry dropped");
});

test("includeGlobal=false drops runId-less entries (AA-2 policy for tab switch)", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: TYPE, data: { runId: "A", tool: "Read" } },
    { type: GLOBAL_TYPE, data: { event: "pre-tool" } },       // no runId
    { type: TYPE, data: { runId: "A", tool: "Grep" } },
    { type: TYPE, data: { runId: "B", tool: "Edit" } },
    { type: GLOBAL_TYPE, data: { event: "post-tool" } },      // no runId
  ]);
  const snap = buf.snapshot({ runId: "A", includeGlobal: false });
  assert.equal(snap.length, 2, "only the two run-A entries come back");
  for (const entry of snap) {
    assert.equal(entry.event.data.runId, "A", "every entry is strictly run-scoped");
  }
});

test("includeGlobal=true returns own-run AND runId-less entries only (no cross-run bleed)", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: TYPE, data: { runId: "A", tool: "Read" } },
    { type: GLOBAL_TYPE, data: { event: "pre-tool" } },
    { type: TYPE, data: { runId: "B", tool: "Edit" } },       // other run
    { type: TYPE, data: { runId: "B", tool: "Bash" } },       // other run
  ]);
  const snap = buf.snapshot({ runId: "A", includeGlobal: true });
  assert.equal(snap.length, 2, "A + global; B is dropped");
  const runIds = snap.map((e) => e.event.data.runId);
  assert.ok(!runIds.includes("B"), "no B entries leak in");
});

test("includeGlobal=false with unmatched runId returns empty", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: GLOBAL_TYPE, data: { event: "pre-tool" } },
    { type: GLOBAL_TYPE, data: { event: "post-tool" } },
  ]);
  const snap = buf.snapshot({ runId: "nonexistent", includeGlobal: false });
  assert.equal(snap.length, 0, "strict mode + no matching run = empty");
});

test("null data.runId is treated like missing (both global)", () => {
  const buf = createEventReplayBuffer();
  seed(buf, [
    { type: TYPE, data: { runId: null, tool: "Read" } },
    { type: TYPE, data: { tool: "Edit" } },              // undefined
    { type: TYPE, data: { runId: "A", tool: "Grep" } },
  ]);
  const strict = buf.snapshot({ runId: "A", includeGlobal: false });
  assert.equal(strict.length, 1, "null/undefined count as global and are dropped");
  const lax = buf.snapshot({ runId: "A", includeGlobal: true });
  assert.equal(lax.length, 3, "null/undefined count as global and are included");
});

test("event with no data object is tolerated as global (no throw)", () => {
  const buf = createEventReplayBuffer();
  buf.append({ type: TYPE, data: { runId: "A", tool: "Read" } });
  buf.append({ type: TYPE });              // no data at all
  const strict = buf.snapshot({ runId: "A", includeGlobal: false });
  assert.equal(strict.length, 1, "dataless entry is global and dropped");
  const lax = buf.snapshot({ runId: "A", includeGlobal: true });
  assert.equal(lax.length, 2, "dataless entry included in lax mode");
});
