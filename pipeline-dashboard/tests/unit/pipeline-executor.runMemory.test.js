// Slice S4-c (Phase 2 / SMART-4, 2026-05-05) — pipeline-executor
// onRunComplete callback unit tests.
//
// Pins:
//   - onRunComplete fires AFTER broadcast(pipeline_complete)
//   - Receives (runId, snapshot) — same snapshot the broadcast carries
//   - Defensive try/catch: callback throw does NOT propagate / break _complete
//   - When onRunComplete is null/undefined, _complete behaves identically
//   - Constructor accepts the new dep without disturbing existing wiring

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { PipelineExecutor } = require("../../executor/pipeline-executor");

function makeExecutor(opts = {}) {
  return new PipelineExecutor({
    broadcast: opts.broadcast || (() => {}),
    templates: opts.templates || {},
    codex: opts.codex || null,
    onRunComplete: opts.onRunComplete,
    runId: opts.runId,
  });
}

// Minimal stub for `this.active` so _complete walks the full path.
// _currentPhase() reads this.active.template.phases[this.active.phaseIdx]
// so we provide an empty-phases template + phaseIdx=0 → null phase.
function seedActive(exec, overrides = {}) {
  exec.active = {
    templateId: "test-template",
    template: { phases: [] },
    phaseIdx: 0,
    startedAt: Date.now() - 1000,
    iteration: 1,
    ...overrides,
  };
}

// ── Constructor accepts onRunComplete dep ──────────────────────

test("constructor accepts onRunComplete callback", () => {
  const cb = () => {};
  const exec = makeExecutor({ onRunComplete: cb });
  assert.equal(exec.onRunComplete, cb);
});

test("constructor without onRunComplete → this.onRunComplete = null", () => {
  const exec = makeExecutor();
  assert.equal(exec.onRunComplete, null);
});

test("constructor with non-function onRunComplete → null (defensive)", () => {
  const exec = makeExecutor({ onRunComplete: "not a function" });
  assert.equal(exec.onRunComplete, null);
});

// ── Callback fires on _complete with snapshot ──────────────────

test("_complete invokes onRunComplete(runId, snapshot)", () => {
  const calls = [];
  const exec = makeExecutor({
    runId: "run-A",
    onRunComplete: (runId, snapshot) => calls.push({ runId, snapshot }),
  });
  seedActive(exec);
  exec._complete("complete");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, "run-A");
  assert.equal(calls[0].snapshot.templateId, "test-template");
  assert.equal(calls[0].snapshot.reason, "complete");
  assert.ok(calls[0].snapshot.state, "snapshot.state present");
  assert.ok(calls[0].snapshot.verification, "snapshot.verification present");
});

test("_complete uses default runId='default' when not provided", () => {
  const calls = [];
  const exec = makeExecutor({
    onRunComplete: (runId) => calls.push(runId),
  });
  seedActive(exec);
  exec._complete("ok");
  assert.equal(calls[0], "default");
});

test("onRunComplete fires AFTER broadcast(pipeline_complete) — order check", () => {
  const order = [];
  const exec = makeExecutor({
    broadcast: (event) => {
      if (event && event.type === "pipeline_complete") order.push("broadcast");
    },
    onRunComplete: () => order.push("onRunComplete"),
  });
  seedActive(exec);
  exec._complete("complete");
  assert.deepEqual(order, ["broadcast", "onRunComplete"]);
});

// ── Defensive try/catch ─────────────────────────────────────────

test("onRunComplete that THROWS does NOT propagate", () => {
  const exec = makeExecutor({
    onRunComplete: () => { throw new Error("recorder boom"); },
  });
  seedActive(exec);
  // Must not throw
  assert.doesNotThrow(() => exec._complete("complete"));
  // active still cleared (the cleanup line `this.active = null`)
  assert.equal(exec.active, null);
});

test("onRunComplete throw does NOT prevent broadcast firing", () => {
  const broadcasts = [];
  const exec = makeExecutor({
    broadcast: (event) => broadcasts.push(event),
    onRunComplete: () => { throw new Error("boom"); },
  });
  seedActive(exec);
  exec._complete("complete");
  // pipeline_complete still broadcast
  assert.ok(broadcasts.some((e) => e.type === "pipeline_complete"));
});

// ── No callback wired → identical behavior ──────────────────────

test("_complete without onRunComplete behaves identically (regression)", () => {
  const broadcasts = [];
  const exec = makeExecutor({
    broadcast: (event) => broadcasts.push(event),
    // no onRunComplete
  });
  seedActive(exec);
  exec._complete("complete");
  assert.ok(broadcasts.some((e) => e.type === "pipeline_complete"));
  assert.equal(exec.active, null);
});

// ── No-active-run path skips callback (matches early-return) ────

test("_complete on inactive executor → onRunComplete NOT called", () => {
  const calls = [];
  const exec = makeExecutor({
    onRunComplete: () => calls.push("called"),
  });
  // Don't seedActive — active is null.
  exec._complete("complete");
  assert.equal(calls.length, 0, "callback skipped on noop _complete");
});
