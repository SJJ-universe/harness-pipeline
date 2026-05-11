// Slice RR0-b (Phase 2 / RELEASE-READY-0, 2026-05-05) — activity-based watchdog.
//
// What this module is
// ───────────────────
// A two-timer watchdog that distinguishes "long but progressing" from
// "stuck". Pre-RR0-b runners use a single setTimeout that hard-kills
// after `defaultTimeoutMs`, so a 25-minute Codex critique that's
// actively streaming output gets killed at the 2-minute interactive
// default — even though Codex is clearly working.
//
// Two-timer model:
//
//   Total timer (hard upper bound)
//     Fires unconditionally at `totalTimeoutMs`. Catches infinite-loop
//     scenarios where the child IS producing output but never returns
//     (or is in a stable but useless state).
//
//   Idle timer (activity-resettable)
//     Fires when no `tick()` has happened for `idleTimeoutMs`. The
//     runner calls tick() on every stdout/stderr chunk. As long as
//     output keeps flowing, the idle timer keeps resetting.
//
//   Whichever fires first → onKill callback. Caller decides what to
//   do (typically child.kill() + audit emit).
//
// Pre-kill warning:
//   At `idleWarningRatio * idleTimeoutMs` (default 0.75 = 75% of idle
//   budget) the watchdog fires onIdleWarning. UI can render
//   "마지막 출력 후 N초 — 자동 종료까지 N초 남음".
//
// Why a separate module from runners
// ──────────────────────────────────
// Pure timer logic, no spawn dependency. Tests can use fake clocks
// without touching child_process. The codex/claude runners just
// inject a watchdog instance + call tick() in their stdout handlers.
// Replacing the timer scheme later (e.g., with a heartbeat protocol
// from inside the child) won't churn runner code.
//
// State machine:
//   IDLE       → caller hasn't called start()
//   ACTIVE     → start() was called; timers running
//   WARNING    → idleWarningRatio fraction elapsed; onIdleWarning fired once
//   KILLED     → onKill fired (via total OR idle timer); caller should
//                clean up and not call tick()/clear() again
//   CLEARED    → caller called clear() (clean shutdown); timers cancelled
//
// Plan reference: RELEASE-READY-0 RR0-b (2026-05-05 user-supplied
// recommendation — "10분 이상 fake runner가 죽지 않는 smoke 추가").

"use strict";

const SCHEMA = "orchestrator-activity-watchdog/v1";

const STATES = Object.freeze({
  IDLE: "idle",
  ACTIVE: "active",
  WARNING: "warning",
  KILLED: "killed",
  CLEARED: "cleared",
});

const KILL_REASONS = Object.freeze({
  TOTAL: "total_timeout",       // hard upper bound exceeded
  IDLE: "idle_timeout",         // no activity for idleTimeoutMs
});

// Bounds (mirror timeoutPolicy.MIN_TIMEOUT_MS / MAX_TIMEOUT_MS so the
// two modules agree on the legal range). Numbers chosen so a watchdog
// can never be configured to "kill instantly" or "never kill".
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;  // 4 hours
const DEFAULT_IDLE_WARNING_RATIO = 0.75;    // warn at 75% of idle budget

function _validatePositiveMs(name, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number (got ${typeof value})`);
  }
  if (value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw new RangeError(
      `${name}=${value} out of range [${MIN_TIMEOUT_MS}, ${MAX_TIMEOUT_MS}]`,
    );
  }
}

/**
 * Create an activity-based watchdog.
 *
 * @param {object} opts
 * @param {number} opts.totalTimeoutMs   Hard upper bound. Fires
 *   unconditionally at this many ms after start(), regardless of
 *   activity.
 * @param {number} opts.idleTimeoutMs    Idle bound. Fires when no
 *   tick() in this many ms. Reset on each tick().
 * @param {number} [opts.idleWarningRatio=0.75] Fraction of idleTimeoutMs
 *   after which onIdleWarning fires once. 0 disables warnings.
 * @param {function} [opts.onIdleWarning] Called once with
 *   { msSinceLastTick, msUntilKill, totalElapsedMs }.
 * @param {function} [opts.onKill]       Called when either timer
 *   fires. Receives { reason: "total_timeout"|"idle_timeout",
 *   msSinceLastTick, totalElapsedMs }.
 * @param {function} [opts.clockFn=Date.now] Testable wall-clock.
 * @param {function} [opts.setTimeoutFn=globalThis.setTimeout] Inject for tests.
 * @param {function} [opts.clearTimeoutFn=globalThis.clearTimeout] Inject for tests.
 * @returns {{
 *   start: () => void,
 *   tick: () => void,
 *   clear: () => void,
 *   snapshot: () => object,
 *   getState: () => string,
 * }}
 */
function createActivityWatchdog(opts = {}) {
  _validatePositiveMs("totalTimeoutMs", opts.totalTimeoutMs);
  _validatePositiveMs("idleTimeoutMs", opts.idleTimeoutMs);
  if (opts.idleTimeoutMs > opts.totalTimeoutMs) {
    // Idle > total is allowed (idle becomes a no-op since total fires
    // first), but it's almost certainly a misconfig — emit a warning
    // so operators see it.
    // We don't throw because tests legitimately use this ordering for
    // "total dominates" scenarios.
  }

  const ratio = (typeof opts.idleWarningRatio === "number"
    && opts.idleWarningRatio >= 0
    && opts.idleWarningRatio < 1)
    ? opts.idleWarningRatio : DEFAULT_IDLE_WARNING_RATIO;

  const onIdleWarning = typeof opts.onIdleWarning === "function" ? opts.onIdleWarning : null;
  const onKill = typeof opts.onKill === "function" ? opts.onKill : null;
  const clockFn = typeof opts.clockFn === "function" ? opts.clockFn : () => Date.now();
  const _setTimeout = opts.setTimeoutFn || setTimeout;
  const _clearTimeout = opts.clearTimeoutFn || clearTimeout;

  let state = STATES.IDLE;
  let startedAt = 0;
  let lastTickAt = 0;
  let totalTimer = null;
  let idleTimer = null;
  let warningTimer = null;
  let warningFired = false;

  function _safeFire(fn, payload) {
    if (!fn) return;
    try { fn(payload); } catch (_) { /* never break the caller */ }
  }

  function _scheduleIdleTimers() {
    if (idleTimer) {
      _clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (warningTimer) {
      _clearTimeout(warningTimer);
      warningTimer = null;
    }

    if (onIdleWarning && ratio > 0 && !warningFired) {
      const warnDelay = Math.max(1, Math.floor(opts.idleTimeoutMs * ratio));
      warningTimer = _setTimeout(() => {
        if (state !== STATES.ACTIVE) return;
        state = STATES.WARNING;
        warningFired = true;
        const now = clockFn();
        _safeFire(onIdleWarning, {
          msSinceLastTick: now - lastTickAt,
          msUntilKill: opts.idleTimeoutMs - (now - lastTickAt),
          totalElapsedMs: now - startedAt,
        });
      }, warnDelay);
    }

    idleTimer = _setTimeout(() => {
      if (state !== STATES.ACTIVE && state !== STATES.WARNING) return;
      state = STATES.KILLED;
      const now = clockFn();
      _safeFire(onKill, {
        reason: KILL_REASONS.IDLE,
        msSinceLastTick: now - lastTickAt,
        totalElapsedMs: now - startedAt,
      });
      _cancelAllTimers();
    }, opts.idleTimeoutMs);
  }

  function _cancelAllTimers() {
    if (totalTimer) { _clearTimeout(totalTimer); totalTimer = null; }
    if (idleTimer) { _clearTimeout(idleTimer); idleTimer = null; }
    if (warningTimer) { _clearTimeout(warningTimer); warningTimer = null; }
  }

  function start() {
    if (state !== STATES.IDLE) {
      throw new Error(`watchdog.start: cannot start from state "${state}"`);
    }
    state = STATES.ACTIVE;
    startedAt = clockFn();
    lastTickAt = startedAt;
    warningFired = false;

    totalTimer = _setTimeout(() => {
      if (state === STATES.KILLED || state === STATES.CLEARED) return;
      state = STATES.KILLED;
      const now = clockFn();
      _safeFire(onKill, {
        reason: KILL_REASONS.TOTAL,
        msSinceLastTick: now - lastTickAt,
        totalElapsedMs: now - startedAt,
      });
      _cancelAllTimers();
    }, opts.totalTimeoutMs);

    _scheduleIdleTimers();
  }

  function tick() {
    if (state !== STATES.ACTIVE && state !== STATES.WARNING) {
      // Killed / cleared — caller should not be ticking. Silent no-op
      // (defensive; common during teardown races).
      return;
    }
    lastTickAt = clockFn();
    // Coming back from WARNING → ACTIVE on a fresh tick is intentional.
    // Operators see "warning cleared" in the UI when the runner
    // resumes producing output.
    state = STATES.ACTIVE;
    warningFired = false;
    _scheduleIdleTimers();
  }

  function clear() {
    if (state === STATES.CLEARED || state === STATES.KILLED) return;
    state = STATES.CLEARED;
    _cancelAllTimers();
  }

  function snapshot() {
    const now = clockFn();
    return {
      state,
      startedAt,
      lastTickAt,
      totalElapsedMs: state === STATES.IDLE ? 0 : now - startedAt,
      msSinceLastTick: state === STATES.IDLE ? 0 : now - lastTickAt,
      totalTimeoutMs: opts.totalTimeoutMs,
      idleTimeoutMs: opts.idleTimeoutMs,
      idleWarningRatio: ratio,
      warningFired,
    };
  }

  function getState() { return state; }

  return { start, tick, clear, snapshot, getState };
}

module.exports = {
  SCHEMA,
  STATES,
  KILL_REASONS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DEFAULT_IDLE_WARNING_RATIO,
  createActivityWatchdog,
};
