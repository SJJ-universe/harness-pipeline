// Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05) — activity watchdog tests.
//
// Pins the two-timer model + state machine with a fake clock + fake
// timer queue so tests are deterministic without setTimeout race
// conditions.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const w = require("../../src/runtime/activityWatchdog");

// ── Fake timer harness ─────────────────────────────────────────────
//
// We don't use node:timers/fake or jest fake timers. A small in-memory
// scheduler keyed by virtual time gives us identical behavior with
// readable assertions.

function makeFakeTimerQueue() {
  let now = 1_000_000;
  let nextId = 1;
  const pending = new Map();  // id → {fireAt, fn}

  return {
    now: () => now,
    setTimeoutFn: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { fireAt: now + ms, fn });
      return id;
    },
    clearTimeoutFn: (id) => { pending.delete(id); },
    advance: (ms) => {
      const target = now + ms;
      while (true) {
        let nextEntry = null;
        let nextId = null;
        for (const [id, entry] of pending) {
          if (entry.fireAt > target) continue;
          if (!nextEntry || entry.fireAt < nextEntry.fireAt) {
            nextEntry = entry;
            nextId = id;
          }
        }
        if (!nextEntry) break;
        now = nextEntry.fireAt;
        pending.delete(nextId);
        try { nextEntry.fn(); } catch (_) { /* swallow */ }
      }
      now = target;
    },
    pendingCount: () => pending.size,
  };
}

function makeWatchdog(overrides = {}) {
  const clock = makeFakeTimerQueue();
  const events = { warnings: [], kills: [] };
  const watchdog = w.createActivityWatchdog({
    totalTimeoutMs: 60_000,    // 60 sec total
    idleTimeoutMs: 10_000,     // 10 sec idle
    idleWarningRatio: 0.75,    // warn at 7.5 sec idle
    onIdleWarning: (p) => events.warnings.push(p),
    onKill: (p) => events.kills.push(p),
    clockFn: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    ...overrides,
  });
  return { watchdog, clock, events };
}

// ── Frozen vocabulary ─────────────────────────────────────────────

test("watchdog: SCHEMA + STATES + KILL_REASONS frozen", () => {
  assert.equal(w.SCHEMA, "harness-activity-watchdog/v1");
  assert.ok(Object.isFrozen(w.STATES));
  assert.ok(Object.isFrozen(w.KILL_REASONS));
  assert.equal(w.STATES.IDLE, "idle");
  assert.equal(w.STATES.ACTIVE, "active");
  assert.equal(w.STATES.WARNING, "warning");
  assert.equal(w.STATES.KILLED, "killed");
  assert.equal(w.STATES.CLEARED, "cleared");
  assert.equal(w.KILL_REASONS.TOTAL, "total_timeout");
  assert.equal(w.KILL_REASONS.IDLE, "idle_timeout");
});

// ── Construction validation ───────────────────────────────────────

test("createActivityWatchdog: rejects non-numeric totalTimeoutMs", () => {
  assert.throws(() => w.createActivityWatchdog({ totalTimeoutMs: "5000", idleTimeoutMs: 1000 }),
    /totalTimeoutMs must be a finite number/);
});

test("createActivityWatchdog: rejects below-MIN totalTimeoutMs", () => {
  assert.throws(() => w.createActivityWatchdog({ totalTimeoutMs: 50, idleTimeoutMs: 1000 }),
    /totalTimeoutMs=50 out of range/);
});

test("createActivityWatchdog: rejects above-MAX idleTimeoutMs", () => {
  assert.throws(() => w.createActivityWatchdog({
    totalTimeoutMs: 5000,
    idleTimeoutMs: 5 * 60 * 60 * 1000,  // 5 hours
  }), /idleTimeoutMs=\d+ out of range/);
});

test("createActivityWatchdog: returns API object before start()", () => {
  const { watchdog } = makeWatchdog();
  assert.equal(typeof watchdog.start, "function");
  assert.equal(typeof watchdog.tick, "function");
  assert.equal(typeof watchdog.clear, "function");
  assert.equal(typeof watchdog.snapshot, "function");
  assert.equal(typeof watchdog.getState, "function");
});

// ── State machine ──────────────────────────────────────────────────

test("state: starts in IDLE before start()", () => {
  const { watchdog } = makeWatchdog();
  assert.equal(watchdog.getState(), "idle");
});

test("state: ACTIVE after start()", () => {
  const { watchdog } = makeWatchdog();
  watchdog.start();
  assert.equal(watchdog.getState(), "active");
});

test("state: start() from non-IDLE throws", () => {
  const { watchdog } = makeWatchdog();
  watchdog.start();
  assert.throws(() => watchdog.start(), /cannot start from state "active"/);
});

test("state: clear() from ACTIVE → CLEARED", () => {
  const { watchdog } = makeWatchdog();
  watchdog.start();
  watchdog.clear();
  assert.equal(watchdog.getState(), "cleared");
});

test("state: clear() is idempotent", () => {
  const { watchdog } = makeWatchdog();
  watchdog.start();
  watchdog.clear();
  watchdog.clear();
  assert.equal(watchdog.getState(), "cleared");
});

// ── Total timer ────────────────────────────────────────────────────

test("total timer: fires onKill at exactly totalTimeoutMs even with constant ticks", () => {
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 5000,
    idleTimeoutMs: 1000,
  });
  watchdog.start();
  // Tick every 500ms — keeps idle timer perpetually reset
  for (let i = 0; i < 12; i++) {
    clock.advance(500);
    if (watchdog.getState() === "active" || watchdog.getState() === "warning") {
      watchdog.tick();
    }
  }
  // After 6 sec elapsed, total (5sec) must have fired
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "total_timeout");
  assert.equal(watchdog.getState(), "killed");
});

test("total timer: fires only ONCE", () => {
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 5000,
    idleTimeoutMs: 100_000,  // way longer; total dominates
  });
  watchdog.start();
  clock.advance(10_000);  // way past total
  assert.equal(events.kills.length, 1);
});

// ── Idle timer ─────────────────────────────────────────────────────

test("idle timer: fires onKill when no tick for idleTimeoutMs", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  clock.advance(11_000);  // past idle (10s) but before total (60s)
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
});

test("idle timer: tick() resets idle countdown", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  clock.advance(8000);
  watchdog.tick();         // reset idle clock
  clock.advance(8000);
  watchdog.tick();         // reset again
  clock.advance(8000);
  watchdog.tick();
  // 24 sec elapsed total, 0 sec since last tick — no kill
  assert.equal(events.kills.length, 0);
  // Now stop ticking and let idle fire
  clock.advance(11_000);
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
});

test("idle warning: fires once at idleWarningRatio (75% of idle budget)", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  // 75% of 10sec = 7.5sec
  clock.advance(7500);
  assert.equal(events.warnings.length, 1);
  assert.ok(events.warnings[0].msSinceLastTick >= 7000);
  assert.ok(events.warnings[0].msUntilKill <= 3000);
});

test("idle warning: fires only once per idle window (not on every tick)", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  clock.advance(7500);  // warning fires
  clock.advance(1000);
  watchdog.tick();      // reset; warning state cleared
  clock.advance(7500);  // warning fires AGAIN (new idle window)
  assert.equal(events.warnings.length, 2);
});

test("idle warning: tick() in WARNING state restores ACTIVE", () => {
  const { watchdog, clock } = makeWatchdog();
  watchdog.start();
  clock.advance(7500);
  assert.equal(watchdog.getState(), "warning");
  watchdog.tick();
  assert.equal(watchdog.getState(), "active");
});

test("idle warning: idleWarningRatio=0 disables warnings", () => {
  const { watchdog, clock, events } = makeWatchdog({ idleWarningRatio: 0 });
  watchdog.start();
  clock.advance(11_000);  // past idle
  assert.equal(events.warnings.length, 0);
  assert.equal(events.kills.length, 1, "but kill still fires");
});

// ── Total beats idle race ──────────────────────────────────────────

test("race: total timer fires before idle (when total < idle and active)", () => {
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 3000,
    idleTimeoutMs: 10_000,
  });
  watchdog.start();
  clock.advance(5000);
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "total_timeout");
});

test("race: idle fires when total > idle and no ticks", () => {
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 100_000,
    idleTimeoutMs: 5000,
  });
  watchdog.start();
  clock.advance(6000);
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
});

// ── clear() cancels timers ────────────────────────────────────────

test("clear: stops total + idle timers from firing", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  clock.advance(2000);
  watchdog.clear();
  clock.advance(100_000);  // way past everything
  assert.equal(events.kills.length, 0);
  assert.equal(events.warnings.length, 0);
  assert.equal(watchdog.getState(), "cleared");
});

test("clear: removes pending timers from queue", () => {
  const { watchdog, clock } = makeWatchdog();
  watchdog.start();
  assert.ok(clock.pendingCount() > 0);
  watchdog.clear();
  assert.equal(clock.pendingCount(), 0);
});

// ── tick() after kill / clear is no-op ────────────────────────────

test("tick: after KILLED is silent no-op (no second kill emit)", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  clock.advance(11_000);  // idle kill
  assert.equal(events.kills.length, 1);
  watchdog.tick();        // ignore
  clock.advance(60_000);
  assert.equal(events.kills.length, 1, "no second kill from late tick");
});

test("tick: after CLEARED is silent no-op", () => {
  const { watchdog, clock, events } = makeWatchdog();
  watchdog.start();
  watchdog.clear();
  watchdog.tick();        // ignore
  clock.advance(60_000);
  assert.equal(events.kills.length, 0);
});

// ── Snapshot ──────────────────────────────────────────────────────

test("snapshot: IDLE state values", () => {
  const { watchdog } = makeWatchdog();
  const snap = watchdog.snapshot();
  assert.equal(snap.state, "idle");
  assert.equal(snap.totalElapsedMs, 0);
  assert.equal(snap.msSinceLastTick, 0);
});

test("snapshot: ACTIVE state shows elapsed + lastActivity", () => {
  const { watchdog, clock } = makeWatchdog();
  watchdog.start();
  clock.advance(3000);
  watchdog.tick();
  clock.advance(1500);
  const snap = watchdog.snapshot();
  assert.equal(snap.state, "active");
  assert.equal(snap.totalElapsedMs, 4500);
  assert.equal(snap.msSinceLastTick, 1500);
  assert.equal(snap.totalTimeoutMs, 60_000);
  assert.equal(snap.idleTimeoutMs, 10_000);
});

test("snapshot: WARNING state has warningFired=true", () => {
  const { watchdog, clock } = makeWatchdog();
  watchdog.start();
  clock.advance(7500);
  const snap = watchdog.snapshot();
  assert.equal(snap.state, "warning");
  assert.equal(snap.warningFired, true);
});

// ── Defensive: callbacks that THROW don't break the watchdog ──────

test("safety: onIdleWarning that throws does not break onKill", () => {
  const { watchdog, clock, events } = makeWatchdog({
    onIdleWarning: () => { events.warnings.push("called"); throw new Error("oops"); },
  });
  watchdog.start();
  clock.advance(7500);
  // warning callback threw, but state machine continues
  assert.equal(watchdog.getState(), "warning");
  clock.advance(2600);  // total 10.1s — past idle
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
});

test("safety: onKill that throws does not corrupt subsequent snapshot", () => {
  const { watchdog, clock, events } = makeWatchdog({
    onKill: (p) => { events.kills.push(p); throw new Error("oops"); },
  });
  watchdog.start();
  clock.advance(11_000);
  // Even though onKill threw, watchdog state should be KILLED + snapshot works
  assert.equal(watchdog.getState(), "killed");
  const snap = watchdog.snapshot();
  assert.equal(snap.state, "killed");
});

// ── No callbacks → still works (silent watchdog) ──────────────────

test("no callbacks: timers fire but no errors", () => {
  const { now, setTimeoutFn, clearTimeoutFn, advance } = makeFakeTimerQueue();
  const watchdog = w.createActivityWatchdog({
    totalTimeoutMs: 5000,
    idleTimeoutMs: 1000,
    clockFn: now,
    setTimeoutFn,
    clearTimeoutFn,
    // No onKill / no onIdleWarning
  });
  watchdog.start();
  advance(2000);  // idle fires silently
  assert.equal(watchdog.getState(), "killed");
});

// ── Realistic "long Codex stream" scenario ────────────────────────

test("scenario: 25-min Codex stream with regular output never kills under long_run preset", () => {
  // long_run preset: codex 20min total. We use 30min total + 60s idle
  // (a hypothetical even-more-permissive config).
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 30 * 60 * 1000,  // 30 min hard cap
    idleTimeoutMs: 60 * 1000,         // 60 sec idle
    idleWarningRatio: 0,              // silent
  });
  watchdog.start();
  // Simulate 25 min of activity, ticking every 30 sec (well within idle)
  for (let i = 0; i < 50; i++) {
    clock.advance(30_000);
    watchdog.tick();
  }
  // 25 min elapsed, 0 sec idle since last tick — no kill yet
  assert.equal(events.kills.length, 0);
  assert.equal(watchdog.getState(), "active");
  // Now let it idle past 60 sec
  clock.advance(61_000);
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
});

test("scenario: 25-min Codex stream that goes silent triggers idle kill cleanly", () => {
  const { watchdog, clock, events } = makeWatchdog({
    totalTimeoutMs: 30 * 60 * 1000,
    idleTimeoutMs: 60 * 1000,
    idleWarningRatio: 0.75,  // warn at 45 sec
  });
  watchdog.start();
  // Stream chunks for 24 minutes
  for (let i = 0; i < 48; i++) {
    clock.advance(30_000);
    watchdog.tick();
  }
  // Then silence for 65 seconds
  clock.advance(45_000);  // warning fires here
  assert.equal(events.warnings.length, 1);
  clock.advance(20_000);  // total 65s — idle kill
  assert.equal(events.kills.length, 1);
  assert.equal(events.kills[0].reason, "idle_timeout");
  assert.ok(events.kills[0].msSinceLastTick >= 60_000);
});
