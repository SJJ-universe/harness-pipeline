// Slice MA1 (Phase D, 2026-04-27) — HarnessMonitorStore unit tests.
//
// The store is the single source of truth for the future monitoring
// console. These tests lock down the action surface so panels (run-tree,
// inspector, timeline …) can rely on a stable contract before the
// monitor shell exists.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMonitorStore,
  DEFAULT_MAX_EVENTS,
} = require("../../public/js/monitor/store");

// ── construction + defaults ─────────────────────────────────────────────

test("createMonitorStore returns the public action surface", () => {
  const s = createMonitorStore();
  for (const fn of [
    "snapshot", "subscribe",
    "setServerSummary", "setActiveChildren",
    "upsertRun", "removeRun", "selectRun",
    "pushEvent", "bumpCounter", "reset",
  ]) {
    assert.equal(typeof s[fn], "function", fn + " is exposed");
  }
});

test("createMonitorStore rejects bad maxEvents", () => {
  assert.throws(() => createMonitorStore({ maxEvents: 0 }));
  assert.throws(() => createMonitorStore({ maxEvents: -1 }));
  assert.throws(() => createMonitorStore({ maxEvents: NaN }));
});

test("DEFAULT_MAX_EVENTS is exported and reasonable", () => {
  assert.ok(typeof DEFAULT_MAX_EVENTS === "number");
  assert.ok(DEFAULT_MAX_EVENTS >= 100, "ring needs to be big enough to be useful");
});

test("snapshot of a fresh store has the canonical shape", () => {
  const snap = createMonitorStore().snapshot();
  assert.equal(snap.server, null);
  assert.deepEqual(snap.runs, {});
  assert.deepEqual(snap.runIds, []);
  assert.equal(snap.selectedRunId, null);
  assert.deepEqual(snap.activeChildren, []);
  assert.deepEqual(snap.events, []);
  assert.deepEqual(snap.counters, {});
});

// ── server / activeChildren ─────────────────────────────────────────────

test("setServerSummary stores a copy of the input object", () => {
  const s = createMonitorStore();
  const input = { pid: 123, clients: 2 };
  s.setServerSummary(input);
  // mutate input afterwards — store snapshot should NOT change.
  input.clients = 999;
  assert.equal(s.snapshot().server.clients, 2);
});

test("setServerSummary accepts null to clear", () => {
  const s = createMonitorStore();
  s.setServerSummary({ pid: 1 });
  s.setServerSummary(null);
  assert.equal(s.snapshot().server, null);
});

test("setActiveChildren stores a copy of the array", () => {
  const s = createMonitorStore();
  const list = [{ pid: 1, label: "claude", runId: "A", ageMs: 10 }];
  s.setActiveChildren(list);
  list.push({ pid: 2, label: "codex", runId: "A", ageMs: 5 });
  assert.equal(s.snapshot().activeChildren.length, 1);
});

test("setActiveChildren coerces non-array to empty", () => {
  const s = createMonitorStore();
  s.setActiveChildren(null);
  assert.deepEqual(s.snapshot().activeChildren, []);
  s.setActiveChildren("not-array");
  assert.deepEqual(s.snapshot().activeChildren, []);
});

// ── runs ────────────────────────────────────────────────────────────────

test("upsertRun adds + then merges partial updates", () => {
  const s = createMonitorStore();
  s.upsertRun("A", { label: "Run A", phase: "Plan", status: "active" });
  s.upsertRun("A", { phase: "Build" });
  const r = s.snapshot().runs.A;
  assert.equal(r.label, "Run A");
  assert.equal(r.phase, "Build");
  assert.equal(r.status, "active");
  assert.equal(r.id, "A");
});

test("upsertRun rejects non-string runId", () => {
  const s = createMonitorStore();
  s.upsertRun(null, { phase: "X" });
  s.upsertRun(undefined, { phase: "X" });
  s.upsertRun(42, { phase: "X" });
  assert.deepEqual(s.snapshot().runIds, []);
});

test("upsertRun seeds lastEventAt when missing", () => {
  const s = createMonitorStore();
  s.upsertRun("A", { phase: "Plan" });
  assert.ok(s.snapshot().runs.A.lastEventAt > 0);
});

test("removeRun drops the run + clears selection if it was selected", () => {
  const s = createMonitorStore();
  s.upsertRun("A", {}); s.upsertRun("B", {});
  s.selectRun("A");
  s.removeRun("A");
  assert.deepEqual(s.snapshot().runIds, ["B"]);
  assert.equal(s.snapshot().selectedRunId, null);
});

test("removeRun on unknown id is a no-op", () => {
  const s = createMonitorStore();
  s.upsertRun("A", {});
  s.removeRun("nope");
  assert.deepEqual(s.snapshot().runIds, ["A"]);
});

// ── selectRun ───────────────────────────────────────────────────────────

test("selectRun sets the focused run when known", () => {
  const s = createMonitorStore();
  s.upsertRun("A", {});
  s.selectRun("A");
  assert.equal(s.snapshot().selectedRunId, "A");
});

test("selectRun ignores unknown runId", () => {
  const s = createMonitorStore();
  s.selectRun("ghost");
  assert.equal(s.snapshot().selectedRunId, null);
});

test("selectRun(null) clears selection", () => {
  const s = createMonitorStore();
  s.upsertRun("A", {}); s.selectRun("A");
  s.selectRun(null);
  assert.equal(s.snapshot().selectedRunId, null);
});

// ── events ──────────────────────────────────────────────────────────────

test("pushEvent appends + caps at maxEvents", () => {
  const s = createMonitorStore({ maxEvents: 3 });
  for (let i = 0; i < 10; i++) s.pushEvent({ type: "x", ts: i });
  const ev = s.snapshot().events;
  assert.equal(ev.length, 3, "ring kept exactly maxEvents");
  // Most recent 3 retained.
  assert.deepEqual(ev.map((e) => e.ts), [7, 8, 9]);
});

test("pushEvent updates the run's lastEventAt when envelope.runId exists", () => {
  const s = createMonitorStore();
  s.upsertRun("A", { phase: "Plan" });
  const before = s.snapshot().runs.A.lastEventAt;
  s.pushEvent({ type: "phase_update", runId: "A", ts: before + 100 });
  assert.equal(s.snapshot().runs.A.lastEventAt, before + 100);
});

test("pushEvent ignores envelopes whose runId points to no known run", () => {
  const s = createMonitorStore();
  // Should not throw, should not create a phantom run.
  s.pushEvent({ type: "x", runId: "ghost", ts: 1 });
  assert.deepEqual(s.snapshot().runIds, []);
});

test("pushEvent accepts envelopes without a runId (global)", () => {
  const s = createMonitorStore();
  s.pushEvent({ type: "toast", ts: 1 });
  assert.equal(s.snapshot().events.length, 1);
});

// ── counters ────────────────────────────────────────────────────────────

test("bumpCounter increments + defaults delta to 1", () => {
  const s = createMonitorStore();
  s.bumpCounter("warnings");
  s.bumpCounter("warnings");
  s.bumpCounter("critical", 3);
  s.bumpCounter("critical", -1);
  assert.deepEqual(s.snapshot().counters, { warnings: 2, critical: 2 });
});

// ── subscribe / publish ─────────────────────────────────────────────────

test("subscribe receives a snapshot on every action", () => {
  const s = createMonitorStore();
  const seen = [];
  const off = s.subscribe((snap) => seen.push(snap.runIds.slice()));
  s.upsertRun("A", {});
  s.upsertRun("B", {});
  s.removeRun("A");
  off();
  s.upsertRun("C", {}); // not seen anymore
  assert.deepEqual(seen, [["A"], ["A", "B"], ["B"]]);
});

test("subscribe broadcaster swallows listener throws", () => {
  const s = createMonitorStore();
  s.subscribe(() => { throw new Error("boom"); });
  let other = 0;
  s.subscribe(() => { other++; });
  s.upsertRun("A", {});
  assert.equal(other, 1, "other subscriber still received the snapshot");
});

test("subscribe rejects non-function listeners", () => {
  const s = createMonitorStore();
  assert.throws(() => s.subscribe(null));
  assert.throws(() => s.subscribe(42));
});

// ── reset ───────────────────────────────────────────────────────────────

test("reset wipes everything + still notifies subscribers", () => {
  const s = createMonitorStore();
  s.upsertRun("A", {});
  s.setServerSummary({ pid: 1 });
  s.bumpCounter("warnings");
  s.pushEvent({ type: "x" });
  let calls = 0;
  s.subscribe(() => { calls++; });
  s.reset();
  assert.equal(calls, 1);
  const snap = s.snapshot();
  assert.deepEqual(snap.runIds, []);
  assert.equal(snap.server, null);
  assert.deepEqual(snap.counters, {});
  assert.deepEqual(snap.events, []);
});

// ── isolation between two store instances ──────────────────────────────

test("two independent stores never leak state into each other", () => {
  const a = createMonitorStore();
  const b = createMonitorStore();
  a.upsertRun("A1", {});
  b.upsertRun("B1", {});
  assert.deepEqual(a.snapshot().runIds, ["A1"]);
  assert.deepEqual(b.snapshot().runIds, ["B1"]);
});
