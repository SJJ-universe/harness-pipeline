// Slice RR0-c (Phase 2 / RELEASE-READY-0, 2026-05-05) — legacy-bridge
// runner activity routing tests. Pins:
//   - codex_idle_warning / claude_idle_warning → store.recordRunnerIdleWarning
//   - codex_killed_for_idle / claude_killed_for_idle → store.recordRunnerKilled
//   - pipeline_complete / pipeline_reset → clearRunnerActivityForRun
//   - These events do NOT pollute the events ring (own slice)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { install } = require("../../public/js/monitor/legacy-bridge");
const { createMonitorStore } = require("../../public/js/monitor/store");
const dispatcher = require("../../public/js/event-dispatcher");
const { normalize } = require("../../public/js/monitor/normalizer");

function fakeResponse(body = {}) {
  return {
    ok: true, status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function fakeFetch() {
  return async () => fakeResponse({});
}

function manualInterval() {
  return {
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  };
}

function freshDispatcher() {
  // Reset taps from previous tests to avoid cross-pollution.
  if (dispatcher && typeof dispatcher.clearTaps === "function") {
    dispatcher.clearTaps();
  }
  return dispatcher;
}

function setupBridge() {
  const store = createMonitorStore();
  const interval = manualInterval();
  const teardown = install({
    store,
    normalize,
    dispatcher: freshDispatcher(),
    fetchImpl: fakeFetch(),
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  return { store, teardown };
}

// ── Idle warning routing ─────────────────────────────────────────

test("RR0-c bridge: codex_idle_warning routes to recordRunnerIdleWarning", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: {
      runId: "run-A", phase: "implement", iteration: 2,
      msSinceLastTick: 7500, msUntilKill: 2500,
    },
  });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].runner, "codex");
  assert.equal(snap[0].runId, "run-A");
  assert.equal(snap[0].phase, "implement");
  assert.equal(snap[0].iteration, 2);
  assert.equal(snap[0].state, "warning");
  assert.equal(snap[0].msSinceLastTick, 7500);
  assert.equal(snap[0].msUntilKill, 2500);
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

test("RR0-c bridge: claude_idle_warning routes with runner='claude'", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "claude_idle_warning",
    data: { runId: "run-B", iteration: 1, msSinceLastTick: 30000, msUntilKill: 30000 },
  });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].runner, "claude");
  assert.equal(snap[0].runId, "run-B");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

// ── Idle kill routing ────────────────────────────────────────────

test("RR0-c bridge: codex_killed_for_idle routes to recordRunnerKilled with reason", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "codex_killed_for_idle",
    data: {
      runId: "run-A", iteration: 1,
      reason: "idle_timeout", msSinceLastTick: 60000,
    },
  });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].state, "killed");
  assert.equal(snap[0].killReason, "idle_timeout");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

test("RR0-c bridge: claude_killed_for_idle with total_timeout reason", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "claude_killed_for_idle",
    data: {
      runId: "run-X", iteration: 0,
      reason: "total_timeout", msSinceLastTick: 1000,
    },
  });
  assert.equal(store.snapshot().runnerActivity[0].killReason, "total_timeout");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

// ── Lifecycle sweep ──────────────────────────────────────────────

test("RR0-c bridge: pipeline_complete sweeps runnerActivity for that runId", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { runId: "run-A", iteration: 1, msSinceLastTick: 7500, msUntilKill: 2500 },
  });
  assert.equal(store.snapshot().runnerActivity.length, 1);
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "run-A" },
  });
  assert.equal(store.snapshot().runnerActivity.length, 0);
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

test("RR0-c bridge: pipeline_reset sweeps runnerActivity", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "claude_idle_warning",
    data: { runId: "run-B", iteration: 0, msSinceLastTick: 5000, msUntilKill: 5000 },
  });
  dispatcher.notifyTaps({
    type: "pipeline_reset",
    data: { runId: "run-B" },
  });
  assert.equal(store.snapshot().runnerActivity.length, 0);
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

test("RR0-c bridge: pipeline_complete for a different runId leaves others intact", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { runId: "run-A", iteration: 1, msSinceLastTick: 7500, msUntilKill: 2500 },
  });
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { runId: "run-B", iteration: 0, msSinceLastTick: 7500, msUntilKill: 2500 },
  });
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "run-A" },
  });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].runId, "run-B");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

// ── Events ring isolation ────────────────────────────────────────

test("RR0-c bridge: idle/kill events do NOT pollute events ring", () => {
  const { store, teardown } = setupBridge();
  // Fire 3 watchdog events
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { runId: "run-A", iteration: 1, msSinceLastTick: 7500, msUntilKill: 2500 },
  });
  dispatcher.notifyTaps({
    type: "claude_idle_warning",
    data: { runId: "run-B", iteration: 0, msSinceLastTick: 5000, msUntilKill: 5000 },
  });
  dispatcher.notifyTaps({
    type: "codex_killed_for_idle",
    data: { runId: "run-C", iteration: 0, reason: "idle_timeout" },
  });
  // events ring should remain empty (these are routed to runnerActivity slice)
  const snap = store.snapshot();
  assert.equal(snap.events.length, 0,
    "watchdog events live in their own slice, not the events ring");
  // But runnerActivity has all 3
  assert.equal(snap.runnerActivity.length, 3);
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

// ── Defensive ─────────────────────────────────────────────────────

test("RR0-c bridge: malformed payload (no data) → defaults runId='default' + silent (no throw)", () => {
  // Bridge constructs runner from the event TYPE, so an event with
  // no data still has enough info to create a "default" entry.
  // This is acceptable behavior — operators see a "default" runId
  // entry indicating the runner was active under an unattributed
  // run. No throw is the key invariant.
  const { store, teardown } = setupBridge();
  assert.doesNotThrow(() => {
    dispatcher.notifyTaps({ type: "codex_idle_warning" });
  });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 1);
  assert.equal(snap[0].runner, "codex");
  assert.equal(snap[0].runId, "default");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

test("RR0-c bridge: data missing runId → defaults to 'default'", () => {
  const { store, teardown } = setupBridge();
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { iteration: 1, msSinceLastTick: 5000, msUntilKill: 5000 },
  });
  assert.equal(store.snapshot().runnerActivity[0].runId, "default");
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});

// ── Realistic chain ──────────────────────────────────────────────

test("RR0-c bridge: warn → kill → pipeline_complete cleans up", () => {
  const { store, teardown } = setupBridge();
  // 1. Warn
  dispatcher.notifyTaps({
    type: "codex_idle_warning",
    data: { runId: "run-X", iteration: 1, msSinceLastTick: 45000, msUntilKill: 15000 },
  });
  let snap = store.snapshot();
  assert.equal(snap.runnerActivity[0].state, "warning");
  // 2. Kill
  dispatcher.notifyTaps({
    type: "codex_killed_for_idle",
    data: { runId: "run-X", iteration: 1, reason: "idle_timeout", msSinceLastTick: 60000 },
  });
  snap = store.snapshot();
  assert.equal(snap.runnerActivity[0].state, "killed");
  // 3. Pipeline finishes (e.g., orchestrator marks the run complete)
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "run-X" },
  });
  assert.equal(store.snapshot().runnerActivity.length, 0);
  if (teardown && typeof teardown.destroy === "function") teardown.destroy();
});
