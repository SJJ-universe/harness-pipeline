// Slice RR0-c (Phase 2 / RELEASE-READY-0, 2026-05-05) — runnerActivity
// store slice tests. Pins the 4 mutators + snapshot shape + sweep on
// pipeline complete + isolation between codex/claude/iteration keys.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");

// ── snapshot shape ─────────────────────────────────────────────────

test("RR0-c store: snapshot includes runnerActivity (empty array initially)", () => {
  const store = createMonitorStore();
  const snap = store.snapshot();
  assert.ok(Array.isArray(snap.runnerActivity));
  assert.equal(snap.runnerActivity.length, 0);
});

// ── recordRunnerIdleWarning ───────────────────────────────────────

test("recordRunnerIdleWarning: codex warning lands in snapshot", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({
    runner: "codex",
    runId: "run-A",
    phase: "implement",
    iteration: 1,
    msSinceLastTick: 7500,
    msUntilKill: 2500,
  });
  const snap = store.snapshot();
  assert.equal(snap.runnerActivity.length, 1);
  const e = snap.runnerActivity[0];
  assert.equal(e.runner, "codex");
  assert.equal(e.runId, "run-A");
  assert.equal(e.phase, "implement");
  assert.equal(e.iteration, 1);
  assert.equal(e.state, "warning");
  assert.equal(e.msSinceLastTick, 7500);
  assert.equal(e.msUntilKill, 2500);
  assert.ok(e.warningFiredAt > 0);
  assert.equal(e.killedAt, null);
  assert.equal(e.killReason, null);
});

test("recordRunnerIdleWarning: claude warning is keyed independently from codex", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "claude", runId: "run-A", iteration: 1 });
  const snap = store.snapshot();
  assert.equal(snap.runnerActivity.length, 2);
});

test("recordRunnerIdleWarning: same key (runner+runId+iteration) overwrites in place", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({
    runner: "codex", runId: "run-A", iteration: 1, msSinceLastTick: 1000,
  });
  store.recordRunnerIdleWarning({
    runner: "codex", runId: "run-A", iteration: 1, msSinceLastTick: 5000,
  });
  const snap = store.snapshot();
  assert.equal(snap.runnerActivity.length, 1);
  assert.equal(snap.runnerActivity[0].msSinceLastTick, 5000);
});

test("recordRunnerIdleWarning: different iterations are separate entries", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 2 });
  assert.equal(store.snapshot().runnerActivity.length, 2);
});

test("recordRunnerIdleWarning: missing runner → snapshot unchanged", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runId: "run-A" });
  assert.equal(store.snapshot().runnerActivity.length, 0);
});

test("recordRunnerIdleWarning: invalid payload → snapshot unchanged", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning(null);
  store.recordRunnerIdleWarning("not-an-object");
  assert.equal(store.snapshot().runnerActivity.length, 0);
});

// ── recordRunnerKilled ─────────────────────────────────────────────

test("recordRunnerKilled: lands killed entry with reason", () => {
  const store = createMonitorStore();
  store.recordRunnerKilled({
    runner: "codex", runId: "run-A", iteration: 1,
    reason: "idle_timeout", msSinceLastTick: 60000,
  });
  const snap = store.snapshot();
  assert.equal(snap.runnerActivity.length, 1);
  const e = snap.runnerActivity[0];
  assert.equal(e.state, "killed");
  assert.equal(e.killReason, "idle_timeout");
  assert.ok(e.killedAt > 0);
  assert.equal(e.warningFiredAt, null);
});

test("recordRunnerKilled: warning then killed preserves warningFiredAt", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({
    runner: "codex", runId: "run-A", iteration: 1, msSinceLastTick: 7500,
  });
  const warningTime = store.snapshot().runnerActivity[0].warningFiredAt;
  store.recordRunnerKilled({
    runner: "codex", runId: "run-A", iteration: 1,
    reason: "idle_timeout", msSinceLastTick: 60000,
  });
  const e = store.snapshot().runnerActivity[0];
  assert.equal(e.state, "killed");
  assert.equal(e.warningFiredAt, warningTime, "warningFiredAt preserved across transition");
});

test("recordRunnerKilled: missing reason → defaults to 'unknown'", () => {
  const store = createMonitorStore();
  store.recordRunnerKilled({ runner: "codex", runId: "run-A", iteration: 1 });
  assert.equal(store.snapshot().runnerActivity[0].killReason, "unknown");
});

test("recordRunnerKilled: total_timeout reason captured", () => {
  const store = createMonitorStore();
  store.recordRunnerKilled({
    runner: "claude", runId: "run-X", iteration: 0,
    reason: "total_timeout", msSinceLastTick: 5000,
  });
  assert.equal(store.snapshot().runnerActivity[0].killReason, "total_timeout");
});

// ── clearRunnerActivity ────────────────────────────────────────────

test("clearRunnerActivity(null) clears everything", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "claude", runId: "run-B", iteration: 0 });
  store.clearRunnerActivity(null);
  assert.equal(store.snapshot().runnerActivity.length, 0);
});

test("clearRunnerActivity(key) clears specific entry only", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "claude", runId: "run-B", iteration: 0 });
  store.clearRunnerActivity("codex:run-A:1");
  const remaining = store.snapshot().runnerActivity;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].runner, "claude");
});

test("clearRunnerActivity(unknown key) is no-op", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.clearRunnerActivity("nope:nope:0");
  assert.equal(store.snapshot().runnerActivity.length, 1);
});

// ── clearRunnerActivityForRun ──────────────────────────────────────

test("clearRunnerActivityForRun: sweeps all entries for a runId", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 2 });
  store.recordRunnerIdleWarning({ runner: "claude", runId: "run-A", iteration: 1 });
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-B", iteration: 1 });
  store.clearRunnerActivityForRun("run-A");
  const remaining = store.snapshot().runnerActivity;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].runId, "run-B");
});

test("clearRunnerActivityForRun: invalid runId is no-op", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.clearRunnerActivityForRun(null);
  store.clearRunnerActivityForRun("");
  assert.equal(store.snapshot().runnerActivity.length, 1);
});

test("clearRunnerActivityForRun: no matching runId is silent no-op (no publish)", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.clearRunnerActivityForRun("run-XYZ");
  assert.equal(pubs, 0);
});

// ── reset() clears runnerActivity (via freshState) ────────────────

test("reset(): clears runnerActivity along with everything else", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  store.reset();
  assert.equal(store.snapshot().runnerActivity.length, 0);
});

// ── Snapshot ordering ──────────────────────────────────────────────

test("snapshot: runnerActivity sorted by most-recent warning/kill first", async () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  // Tiny wait to ensure later record has a strictly higher timestamp.
  await new Promise((r) => setTimeout(r, 5));
  store.recordRunnerKilled({
    runner: "claude", runId: "run-B", iteration: 0,
    reason: "idle_timeout",
  });
  await new Promise((r) => setTimeout(r, 5));
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-C", iteration: 0 });
  const snap = store.snapshot().runnerActivity;
  assert.equal(snap.length, 3);
  // Most recent first
  assert.equal(snap[0].runId, "run-C");
  assert.equal(snap[1].runId, "run-B");
  assert.equal(snap[2].runId, "run-A");
});

test("snapshot: runnerActivity entries are shallow copies (caller can't mutate stored)", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  const snap1 = store.snapshot();
  snap1.runnerActivity[0].state = "tampered";
  const snap2 = store.snapshot();
  assert.equal(snap2.runnerActivity[0].state, "warning",
    "stored entry not mutated by caller's snapshot tweak");
});

// ── Subscribe/publish on mutation ─────────────────────────────────

test("subscriber: fires on recordRunnerIdleWarning", () => {
  const store = createMonitorStore();
  let fired = 0;
  store.subscribe(() => { fired++; });
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  assert.equal(fired, 1);
});

test("subscriber: fires on recordRunnerKilled", () => {
  const store = createMonitorStore();
  let fired = 0;
  store.subscribe(() => { fired++; });
  store.recordRunnerKilled({ runner: "codex", runId: "run-A", iteration: 1, reason: "idle_timeout" });
  assert.equal(fired, 1);
});

test("subscriber: fires on clearRunnerActivityForRun (when matched)", () => {
  const store = createMonitorStore();
  store.recordRunnerIdleWarning({ runner: "codex", runId: "run-A", iteration: 1 });
  let fired = 0;
  store.subscribe(() => { fired++; });
  store.clearRunnerActivityForRun("run-A");
  assert.equal(fired, 1);
});

// ── Realistic scenario ────────────────────────────────────────────

test("scenario: warn → killed → run completes → entry swept", () => {
  const store = createMonitorStore();
  // 1. Watchdog fires warning
  store.recordRunnerIdleWarning({
    runner: "codex", runId: "run-A", iteration: 1,
    msSinceLastTick: 45000, msUntilKill: 15000,
  });
  assert.equal(store.snapshot().runnerActivity[0].state, "warning");
  // 2. Idle kill fires
  store.recordRunnerKilled({
    runner: "codex", runId: "run-A", iteration: 1,
    reason: "idle_timeout", msSinceLastTick: 60000,
  });
  assert.equal(store.snapshot().runnerActivity[0].state, "killed");
  // 3. Pipeline completes → bridge calls clearRunnerActivityForRun
  store.clearRunnerActivityForRun("run-A");
  assert.equal(store.snapshot().runnerActivity.length, 0);
});
