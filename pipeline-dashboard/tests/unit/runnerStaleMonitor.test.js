// Slice R3-c-2 (Phase D R3, 2026-04-28) — RunnerStaleMonitor unit tests.
//
// Pins down the single-emit semantics, dedupe-on-recovery behavior,
// idle-stale skip rule, idempotent start/stop, ledger-failure
// resilience, and observable stats surface.

const test = require("node:test");
const assert = require("node:assert/strict");
const { RunnerStaleMonitor } = require("../../src/runtime/runnerStaleMonitor");

function fakeRegistry(staleSnapshots) {
  // staleSnapshots is an array of arrays — each tick consumes one
  // snapshot from the front. Tests script the monitor's perception of
  // the registry state across ticks.
  let i = 0;
  return {
    pruneStaleRunners() {
      if (i >= staleSnapshots.length) return [];
      return staleSnapshots[i++];
    },
  };
}

function fakeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, payload) {
      entries.push({ runId, ...payload });
    },
  };
}

// ── construction guards ────────────────────────────────────────────

test("R3-c-2: throws without a registry that exposes pruneStaleRunners", () => {
  assert.throws(() => new RunnerStaleMonitor({}), /pruneStaleRunners/);
  assert.throws(() => new RunnerStaleMonitor({ registry: {} }), /pruneStaleRunners/);
  assert.throws(() => new RunnerStaleMonitor(), /pruneStaleRunners/);
});

test("R3-c-2: clamps intervalMs to a minimum of 100", () => {
  const reg = fakeRegistry([]);
  const m = new RunnerStaleMonitor({ registry: reg, intervalMs: 1 });
  assert.equal(m.getStats().intervalMs, 100);
  const m2 = new RunnerStaleMonitor({ registry: reg, intervalMs: -5 });
  assert.equal(m2.getStats().intervalMs, 100);
  const m3 = new RunnerStaleMonitor({ registry: reg, intervalMs: 0 });
  assert.equal(m3.getStats().intervalMs, 100);
});

test("R3-c-2: accepts custom intervalMs above the floor", () => {
  const reg = fakeRegistry([]);
  const m = new RunnerStaleMonitor({ registry: reg, intervalMs: 5000 });
  assert.equal(m.getStats().intervalMs, 5000);
});

// ── tick: stale-detection + audit emission ─────────────────────────

test("R3-c-2: tick with no stale hosts → no audit + stats reflect tick count", () => {
  const reg = fakeRegistry([[]]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  assert.equal(led.entries.length, 0);
  const s = m.getStats();
  assert.equal(s.ticks, 1);
  assert.equal(s.pruned, 0);
  assert.equal(s.audited, 0);
});

test("R3-c-2: tick emits runner_host_lost audit for stale host with affected runs", () => {
  const reg = fakeRegistry([[
    { hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 2, affectedRuns: ["rr-1", "rr-2"] },
  ]]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  assert.equal(led.entries.length, 1);
  const entry = led.entries[0];
  assert.equal(entry.runId, "system");
  assert.equal(entry.type, "runner_host_lost");
  assert.equal(entry.data.hostIdentity, "host-a");
  assert.equal(entry.data.elapsedMs, 60_000);
  assert.equal(entry.data.activeRuns, 2);
  assert.deepEqual(entry.data.affectedRuns, ["rr-1", "rr-2"]);
});

test("R3-c-2: idle stale host (affectedRuns empty) → NOT audited", () => {
  // Operator housekeeping, not stranded-run signal. The audit row is
  // for tracking which RUNS were stranded, so a stale host with no
  // claims is intentionally silent in the chain.
  const reg = fakeRegistry([[
    { hostIdentity: "host-idle", elapsedMs: 60_000, activeRuns: 0, affectedRuns: [] },
  ]]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  assert.equal(led.entries.length, 0);
  // Stats track the prune detection but no audit emission.
  const s = m.getStats();
  assert.equal(s.pruned, 1);
  assert.equal(s.audited, 0);
});

test("R3-c-2: dedupe — same stale host across ticks emits the audit ONCE", () => {
  // The host stays stale across ticks. The audit row is single-shot
  // until the host recovers (re-handshake) and goes stale again.
  const staleEntry = {
    hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"],
  };
  const reg = fakeRegistry([
    [staleEntry],
    [staleEntry],
    [staleEntry],
  ]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  m.tick();
  m.tick();
  assert.equal(led.entries.length, 1, "audit emits exactly once for sustained staleness");
  assert.equal(m.getStats().auditedLostHostCount, 1);
});

test("R3-c-2: dedupe set clears when host disappears from stale list (recovery path)", () => {
  // host-a goes stale → audited → recovers (no longer in stale list)
  // → goes stale again → re-audited. Models a runner that bounces.
  const stale = {
    hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"],
  };
  const reg = fakeRegistry([
    [stale],   // tick 1: detected, audited
    [],        // tick 2: recovered (re-handshake)
    [stale],   // tick 3: stale again, re-audit
  ]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  assert.equal(led.entries.length, 1);
  m.tick();
  assert.equal(led.entries.length, 1, "tick 2 should not emit");
  assert.equal(m.getStats().auditedLostHostCount, 0,
    "dedupe set cleared after recovery");
  m.tick();
  assert.equal(led.entries.length, 2, "tick 3 should re-emit after recovery");
});

test("R3-c-2: multiple stale hosts in one tick → one audit row each", () => {
  const reg = fakeRegistry([[
    { hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"] },
    { hostIdentity: "host-b", elapsedMs: 90_000, activeRuns: 2, affectedRuns: ["rr-2", "rr-3"] },
    { hostIdentity: "host-c-idle", elapsedMs: 60_000, activeRuns: 0, affectedRuns: [] },
  ]]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led });
  m.tick();
  assert.equal(led.entries.length, 2,
    "two stranded-run hosts → two audit rows; idle host skipped");
  const hosts = led.entries.map((e) => e.data.hostIdentity).sort();
  assert.deepEqual(hosts, ["host-a", "host-b"]);
});

test("R3-c-2: registry.pruneStaleRunners throwing → onError fires + tick keeps running", () => {
  const errors = [];
  const angryRegistry = {
    pruneStaleRunners() { throw new Error("registry exploded"); },
  };
  const m = new RunnerStaleMonitor({
    registry: angryRegistry,
    onError: (err) => errors.push(err),
  });
  m.tick();
  m.tick();
  assert.equal(errors.length, 2);
  assert.match(errors[0].message, /exploded/);
  // Stats still increment ticks; errors track the failure count.
  const s = m.getStats();
  assert.equal(s.ticks, 2);
  assert.equal(s.errors, 2);
});

test("R3-c-2: ledger.append throwing → host NOT marked audited (retried next tick)", () => {
  // Ledger failure is transient — the dedupe semantic must NOT skip
  // the audit just because the previous attempt failed. Otherwise a
  // single ledger glitch leaves the chain missing the audit row
  // forever.
  const stale = {
    hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"],
  };
  const reg = fakeRegistry([[stale], [stale]]);
  let attempts = 0;
  const flakyLedger = {
    append() {
      attempts += 1;
      if (attempts === 1) throw new Error("disk full");
    },
  };
  const errors = [];
  const m = new RunnerStaleMonitor({
    registry: reg,
    ledger: flakyLedger,
    onError: (err) => errors.push(err),
  });
  m.tick();
  assert.equal(errors.length, 1, "first tick errors on ledger.append");
  assert.equal(m.getStats().auditedLostHostCount, 0,
    "host not marked audited when ledger fails");
  m.tick();
  assert.equal(attempts, 2, "second tick retries the audit append");
  assert.equal(m.getStats().auditedLostHostCount, 1,
    "host marked audited after successful append");
});

test("R3-c-2: missing ledger → tick still runs + dedupe still applies", () => {
  // Some test/dev configurations may want to run the prune cycle for
  // observability without writing audit rows. The monitor must accept
  // a missing ledger gracefully and still preserve dedupe semantics.
  const stale = {
    hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"],
  };
  const reg = fakeRegistry([[stale], [stale]]);
  const m = new RunnerStaleMonitor({ registry: reg });  // no ledger
  m.tick();
  m.tick();
  // Dedupe still works in ledger-less mode (audited count tracks intent).
  const s = m.getStats();
  assert.equal(s.audited, 1);
  assert.equal(s.auditedLostHostCount, 1);
});

// ── start / stop lifecycle ─────────────────────────────────────────

test("R3-c-2: start schedules a timer; stop clears it; both idempotent", () => {
  let scheduled = 0;
  let cleared = 0;
  const fakeSetInterval = (fn, ms) => { scheduled += 1; return { fn, ms }; };
  const fakeClearInterval = () => { cleared += 1; };
  const reg = fakeRegistry([]);
  const m = new RunnerStaleMonitor({
    registry: reg,
    setIntervalImpl: fakeSetInterval,
    clearIntervalImpl: fakeClearInterval,
  });
  assert.equal(m.start(), true);
  assert.equal(scheduled, 1);
  assert.equal(m.start(), false, "second start is a no-op");
  assert.equal(scheduled, 1);
  assert.equal(m.getStats().running, true);
  assert.equal(m.stop(), true);
  assert.equal(cleared, 1);
  assert.equal(m.stop(), false, "second stop is a no-op");
  assert.equal(cleared, 1);
  assert.equal(m.getStats().running, false);
});

test("R3-c-2: start fires the tick callback at intervalMs cadence", async () => {
  // We use the real setInterval here with a tight interval so the
  // test stays fast. This is the only test that exercises real
  // timing; everything else uses tick() directly.
  const stale = {
    hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"],
  };
  let serveStale = true;
  const reg = {
    pruneStaleRunners() { return serveStale ? [stale] : []; },
  };
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led, intervalMs: 100 });
  m.start();
  // Wait for ~3 ticks.
  await new Promise((r) => setTimeout(r, 350));
  m.stop();
  assert.ok(led.entries.length >= 1, "expected at least one audit emission");
  assert.equal(led.entries[0].type, "runner_host_lost");
});

test("R3-c-2: getStats exposes ticks/pruned/audited/errors/running/intervalMs", () => {
  const reg = fakeRegistry([
    [{ hostIdentity: "host-a", elapsedMs: 60_000, activeRuns: 1, affectedRuns: ["rr-1"] }],
    [],
  ]);
  const led = fakeLedger();
  const m = new RunnerStaleMonitor({ registry: reg, ledger: led, intervalMs: 5000 });
  const before = m.getStats();
  assert.equal(before.running, false);
  assert.equal(before.intervalMs, 5000);
  assert.equal(before.ticks, 0);
  m.tick();
  m.tick();
  const after = m.getStats();
  assert.equal(after.ticks, 2);
  assert.equal(after.pruned, 1);
  assert.equal(after.audited, 1);
  assert.equal(after.errors, 0);
});
