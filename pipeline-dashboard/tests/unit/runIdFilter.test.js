// Slice AA-1 (Phase 2.5) — HarnessRunIdFilter.shouldSkip pure-function tests.
//
// This is the unit-level proof that the AA-1 filter correctly routes events
// to / away from the currently-focused run tab, including the "global
// carve-out" rule for events without a runId.

const test = require("node:test");
const assert = require("node:assert/strict");
const { shouldSkip } = require("../../public/js/run-id-filter");

test("null / non-object event is never skipped (safety)", () => {
  assert.equal(shouldSkip(null, "A"), false);
  assert.equal(shouldSkip(undefined, "A"), false);
  assert.equal(shouldSkip(42, "A"), false);
  assert.equal(shouldSkip("stringy", "A"), false);
});

test("event without `data` object is never skipped (legacy event shape)", () => {
  assert.equal(shouldSkip({ type: "ping" }, "A"), false);
  assert.equal(shouldSkip({ type: "ping", data: null }, "A"), false);
  assert.equal(shouldSkip({ type: "ping", data: "not-an-object" }, "A"), false);
});

test("event without data.runId passes through (GLOBAL carve-out)", () => {
  assert.equal(
    shouldSkip({ type: "toast", data: { message: "hi" } }, "A"),
    false,
    "toast has no runId → global event, render on every tab"
  );
  assert.equal(
    shouldSkip({ type: "hook_event", data: { event: "pre-tool", tool: "Read" } }, "A"),
    false,
    "hook_event is global telemetry"
  );
  assert.equal(
    shouldSkip({ type: "context_alarm", data: { level: "warn" } }, "B"),
    false,
    "context_alarm must reach every tab"
  );
});

test("event.data.runId null / undefined behaves like absent (global)", () => {
  assert.equal(shouldSkip({ type: "x", data: { runId: null } }, "A"), false);
  assert.equal(shouldSkip({ type: "x", data: { runId: undefined } }, "A"), false);
});

test("no currentRunId (tab not yet initialised) never skips", () => {
  assert.equal(
    shouldSkip({ type: "x", data: { runId: "A" } }, undefined),
    false,
    "no tab focus → render all events so initial hydration completes"
  );
  assert.equal(shouldSkip({ type: "x", data: { runId: "A" } }, null), false);
  assert.equal(shouldSkip({ type: "x", data: { runId: "A" } }, ""), false);
});

test("matching runId is never skipped (own run passes)", () => {
  assert.equal(shouldSkip({ type: "tool_recorded", data: { runId: "A" } }, "A"), false);
  assert.equal(shouldSkip({ type: "phase_update", data: { runId: "run-42" } }, "run-42"), false);
  assert.equal(
    shouldSkip({ type: "pipeline_start", data: { runId: "default" } }, "default"),
    false
  );
});

test("mismatched runId is skipped (other run should not render)", () => {
  assert.equal(shouldSkip({ type: "tool_recorded", data: { runId: "B" } }, "A"), true);
  assert.equal(
    shouldSkip({ type: "phase_update", data: { runId: "session-x" } }, "session-y"),
    true
  );
  assert.equal(
    shouldSkip({ type: "pipeline_complete", data: { runId: "default" } }, "other-run"),
    true
  );
});

test("carve-out and skip combine correctly in a mixed stream", () => {
  // A realistic interleaved sequence while tab "A" is focused.
  const current = "A";
  const stream = [
    { type: "toast", data: { message: "hi" } },                   // global, render
    { type: "pipeline_start", data: { runId: "A", mode: "live" } }, // own, render
    { type: "pipeline_start", data: { runId: "B", mode: "live" } }, // other, skip
    { type: "hook_event", data: { event: "post-tool" } },         // global, render
    { type: "tool_recorded", data: { runId: "B", tool: "Edit" } },  // other, skip
    { type: "tool_recorded", data: { runId: "A", tool: "Read" } },  // own, render
  ];
  const rendered = stream.filter((ev) => !shouldSkip(ev, current));
  assert.deepEqual(
    rendered.map((e) => e.type + (e.data.runId ? `:${e.data.runId}` : "")),
    ["toast", "pipeline_start:A", "hook_event", "tool_recorded:A"],
    "only own-run and global events reach the renderer"
  );
});
