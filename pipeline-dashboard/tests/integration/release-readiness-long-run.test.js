// Slice RR0-e (Phase 2 / RELEASE-READY-0, 2026-05-05) — release-readiness
// long-run integration smoke.
//
// User specification: "10분 이상 fake runner가 죽지 않는 smoke를 추가합니다."
//
// This test exercises the FULL codex-runner + activityWatchdog +
// timeoutPolicy stack with a fake spawn + fake clock. The runner is
// configured with public_sector preset (codex 30 min total / 60 s
// idle) — pre-RR0 single-timer would have killed it at 2 minutes.
// Post-RR0, the watchdog keeps the runner alive as long as the fake
// child emits stdout chunks more frequently than the 60-second idle
// timeout.
//
// Why the test uses fake clock + fake spawn:
//   - Real 12-minute test would block CI for 12 minutes (unacceptable)
//   - Real 12-minute test would race against actual timer drift
//   - Fake clock + fake spawn lets us simulate 12+ minutes of activity
//     in milliseconds with deterministic behavior
//
// Pinned guarantees:
//   1. With idleTimeoutMs configured, a runner that emits chunks every
//      30 seconds for 12+ minutes does NOT get killed (no idle / no
//      total)
//   2. Idle warning fires at 75% of idleTimeoutMs (45 s by default)
//   3. Going silent past idleTimeoutMs triggers idle kill with
//      reason="idle_timeout"
//   4. Total cap fires at totalTimeoutMs even with constant ticks
//      (30 min cap stops a 31-minute pretend run)
//   5. WS broadcasts (codex_idle_warning, codex_killed_for_idle) fire
//      with the right payload shape

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { CodexRunner } = require("../../executor/codex-runner");

// ── Fake clock + fake setTimeout queue ─────────────────────────────

function makeFakeTimerQueue() {
  let now = 1_000_000;
  let nextId = 1;
  const pending = new Map();

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
        try { nextEntry.fn(); } catch (_) {}
      }
      now = target;
    },
    pendingCount: () => pending.size,
  };
}

// ── Fake child + fake spawn ────────────────────────────────────────

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on: () => {}, write: () => {}, end: () => {} };
  child.killed = false;
  child.kill = function() { this.killed = true; };
  return child;
}

function makeFakeSpawn() {
  const children = [];
  const fn = (_cmd, _args, _opts) => {
    const c = makeFakeChild();
    children.push(c);
    return c;
  };
  return { spawn: fn, children };
}

// ── Test scaffolding ──────────────────────────────────────────────

function makeRunnerWithWatchdog({
  totalTimeoutMs = 30 * 60 * 1000,  // 30 min — public_sector preset
  idleTimeoutMs = 60 * 1000,        // 60 sec
} = {}) {
  const clock = makeFakeTimerQueue();
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    defaultTimeoutMs: totalTimeoutMs,
    idleTimeoutMs,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    clockFn: clock.now,
    flushIntervalMs: 100_000,  // long enough that the flush timer doesn't fire
    flushBytes: 1_000_000,
  });
  return { runner, clock, children, events };
}

// ── Tests ──────────────────────────────────────────────────────────

test("RR0-e smoke: 12-minute fake stream with 30s ticks survives (no kill, no warning)", async () => {
  const { runner, clock, children, events } = makeRunnerWithWatchdog();
  const done = runner.exec("prompt", { phaseId: "long-running", iteration: 1 });
  // Wait for child to spawn (microtask)
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  assert.ok(child, "fake child spawned");

  // Simulate 12 minutes of activity, ticking every 30 seconds (well
  // within 60 s idle threshold).
  for (let i = 0; i < 24; i++) {
    clock.advance(30_000);
    if (!child.killed) child.stdout.emit("data", Buffer.from(`tick ${i}\n`));
  }

  // After 720 s (12 min):
  //  - Total elapsed: 12 min — under 30 min total cap
  //  - Last tick: just now (0 ms since)
  //  - Watchdog state: ACTIVE
  //  - No kill
  assert.equal(child.killed, false, "child must NOT be killed during active stream");

  // No codex_killed_for_idle broadcast
  const killEvents = events.filter((e) => e.type === "codex_killed_for_idle");
  assert.equal(killEvents.length, 0,
    "no codex_killed_for_idle broadcast during active stream");

  // No idle warning either (warning fires at 45 s of silence; we never
  // had 45 s of silence)
  const warnEvents = events.filter((e) => e.type === "codex_idle_warning");
  assert.equal(warnEvents.length, 0,
    "no codex_idle_warning during constant ticks");

  // Clean up: emit close so the runner resolves
  child.emit("close", 0);
  const result = await done;
  assert.equal(result.ok, true);
});

test("RR0-e smoke: 12-min stream then silence triggers warning at 45s, kill at 60s", async () => {
  const { runner, clock, children, events } = makeRunnerWithWatchdog();
  const done = runner.exec("prompt", { phaseId: "long-then-stuck", iteration: 1 });
  await new Promise((r) => setImmediate(r));
  const child = children[0];

  // Stream for 12 minutes
  for (let i = 0; i < 24; i++) {
    clock.advance(30_000);
    if (!child.killed) child.stdout.emit("data", Buffer.from(`tick ${i}\n`));
  }
  assert.equal(child.killed, false);

  // Now go silent. Warning should fire at 45 s elapsed.
  clock.advance(45_000);
  const warnEvents = events.filter((e) => e.type === "codex_idle_warning");
  assert.equal(warnEvents.length, 1, "exactly one idle warning fired");
  assert.equal(warnEvents[0].data.phase, "long-then-stuck");
  assert.ok(warnEvents[0].data.msSinceLastTick >= 45_000);

  // 15 s more (total 60 s of silence) → idle kill
  clock.advance(15_000);
  assert.equal(child.killed, true, "child killed after 60 s of silence");
  const killEvents = events.filter((e) => e.type === "codex_killed_for_idle");
  assert.equal(killEvents.length, 1);
  assert.equal(killEvents[0].data.reason, "idle_timeout");
  assert.ok(killEvents[0].data.msSinceLastTick >= 60_000);

  // Resolve
  child.emit("close", 137);  // SIGKILL exit code
  await done;
});

test("RR0-e smoke: total timeout fires at 30 min even with constant ticks", async () => {
  const { runner, clock, children, events } = makeRunnerWithWatchdog({
    totalTimeoutMs: 30 * 60 * 1000,
    idleTimeoutMs: 60 * 1000,
  });
  const done = runner.exec("prompt", { phaseId: "infinite-loop", iteration: 1 });
  await new Promise((r) => setImmediate(r));
  const child = children[0];

  // Tick every 30 seconds for 31 minutes (62 ticks).
  for (let i = 0; i < 62; i++) {
    clock.advance(30_000);
    if (!child.killed) child.stdout.emit("data", Buffer.from(`tick ${i}\n`));
  }

  // Total cap (30 min) should have fired between tick #59 and #62.
  assert.equal(child.killed, true, "total timeout kills the runner past 30 min");
  const killEvents = events.filter((e) => e.type === "codex_killed_for_idle");
  assert.equal(killEvents.length, 1);
  assert.equal(killEvents[0].data.reason, "total_timeout",
    "kill reason is total_timeout, not idle_timeout");

  child.emit("close", 137);
  await done;
});

test("RR0-e smoke: pre-RR0-b legacy single-timer path (no idleTimeoutMs) preserved", async () => {
  // Construct a runner WITHOUT idleTimeoutMs — runner uses the legacy
  // single setTimeout that hard-kills at totalTimeout regardless of
  // activity. This is the backward-compat path for callers that
  // haven't opted into the watchdog.
  const clock = makeFakeTimerQueue();
  const { spawn, children } = makeFakeSpawn();
  const events = [];
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    defaultTimeoutMs: 5000,
    // Legacy: NO idleTimeoutMs / setTimeoutFn / etc.
    flushIntervalMs: 100_000,
    flushBytes: 1_000_000,
  });
  const done = runner.exec("prompt", { phaseId: "legacy", iteration: 1 });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  assert.ok(child);

  // Even with constant ticks, legacy timer fires at defaultTimeoutMs
  // (5 s in this test). Watchdog isn't engaged so ticks don't reset
  // anything.
  // Note: legacy path uses real setTimeout (not the fake clock), so
  // we can't deterministically advance time here. We just verify the
  // legacy path doesn't throw + watchdog-specific events absent.
  child.stdout.emit("data", Buffer.from("hi\n"));
  child.emit("close", 0);
  await done;

  // No watchdog broadcasts because watchdog wasn't engaged
  const warnEvents = events.filter((e) => e.type === "codex_idle_warning");
  const killEvents = events.filter((e) => e.type === "codex_killed_for_idle");
  assert.equal(warnEvents.length, 0, "no watchdog warnings on legacy path");
  assert.equal(killEvents.length, 0, "no watchdog kills on legacy path");
});

// ── Headline release-readiness assertion ──────────────────────────

test("RR0-e RELEASE-READY-0 headline: public-sector 25-min Codex critique survives under long_run preset (full integration)", async () => {
  // The headline scenario from the user spec: an operator running
  // public-sector posture launches a long Codex critique that takes
  // 25 minutes. Pre-RR0 this would have been killed at minute 2.
  // Post-RR0 it survives.
  const { runner, clock, children, events } = makeRunnerWithWatchdog({
    totalTimeoutMs: 30 * 60 * 1000,  // public_sector preset codex
    idleTimeoutMs: 60 * 1000,
  });
  const done = runner.exec("prompt", {
    phaseId: "security-critique",
    iteration: 1,
    runId: "review-2026-05-05-A",
  });
  await new Promise((r) => setImmediate(r));
  const child = children[0];

  // 25 minutes of streaming, ticking every 30 s (50 ticks).
  for (let i = 0; i < 50; i++) {
    clock.advance(30_000);
    if (!child.killed) {
      // Realistic Codex critique chunks: severity tag + finding text
      const chunk = i === 0
        ? "## Critique\n- [medium] Input validation missing in user_input.js:42\n"
        : i % 5 === 0
          ? `- [low] Naming nit: prefer camelCase at file ${i}\n`
          : `(processing chunk ${i}/50)\n`;
      child.stdout.emit("data", Buffer.from(chunk));
    }
  }

  // 25 min in — should still be alive
  assert.equal(child.killed, false, "25-min critique survives with watchdog");
  const killEvents = events.filter((e) => e.type === "codex_killed_for_idle");
  assert.equal(killEvents.length, 0, "no premature kill");

  // Realistic close
  child.emit("close", 0);
  const result = await done;
  assert.equal(result.ok, true);
  // Codex extracted findings via _extractFindings should include the
  // medium-severity item we emitted
  const mediumCount = (result.findings || []).filter((f) => f.severity === "medium").length;
  assert.ok(mediumCount >= 1, "medium-severity findings parsed from streamed output");
});
