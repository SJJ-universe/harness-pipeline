// Slice R3-c-2 (Phase D R3, 2026-04-28) — periodic stale-runner monitor.
//
// Wraps RunnerRegistry.pruneStaleRunners() in a setInterval loop and
// emits the `runner_host_lost` audit row when a stale host is detected
// for the FIRST time (single-emit semantics). Re-emits the row only
// after a host re-handshakes (clears its stale state) and goes stale
// again — never spams the chain on every tick.
//
// Why this lives outside the registry:
//
//   - The registry is the source of truth + observation surface. It
//     does not own a clock loop; injecting one would tie the registry
//     to a runtime concern (timers leak in tests, complicate teardown).
//   - The monitor IS the runtime concern — it owns the interval, the
//     dedup state, and the ledger handle. server.js wires it up at
//     startup and tears it down in graceful shutdown.
//
// Audit shape (R3-G07 forensic anchor):
//
//   { type: "runner_host_lost",
//     data: { hostIdentity, elapsedMs, activeRuns,
//             affectedRuns: [<runId>, …] } }
//
// affectedRuns is the list of runIds claimed for the stale host at
// detection time. The audit row's purpose is to mark runs as "stranded"
// — the orchestrator's run-failure path uses the chain to decide what
// to do (R3-G09: fail-not-forward).

"use strict";

/**
 * @typedef {object} RunnerStaleMonitorOptions
 * @property {object} registry        - RunnerRegistry instance.
 * @property {object} [ledger]        - EvidenceLedger to write audit rows.
 *                                      When absent, audit emission is a
 *                                      no-op but the prune cycle still
 *                                      runs (useful for tests that want
 *                                      to observe pruneCount without a
 *                                      real ledger fixture).
 * @property {number} [intervalMs=30000] - Tick period. Default matches
 *                                      heartbeatDropMs so a host that
 *                                      goes silent shows up in the chain
 *                                      within roughly one drop window.
 * @property {function} [setIntervalImpl=setInterval]
 *                                    - Test override for the timer.
 * @property {function} [clearIntervalImpl=clearInterval]
 *                                    - Test override for the timer.
 * @property {function} [onError]     - Optional callback for unexpected
 *                                      errors during a tick. Default
 *                                      logs to console.error.
 */

class RunnerStaleMonitor {
  /**
   * @param {RunnerStaleMonitorOptions} opts
   */
  constructor({
    registry,
    ledger = null,
    intervalMs = 30000,
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
    onError,
  } = {}) {
    if (!registry || typeof registry.pruneStaleRunners !== "function") {
      throw new Error("RunnerStaleMonitor requires a RunnerRegistry with pruneStaleRunners()");
    }
    this._registry = registry;
    this._ledger = ledger && typeof ledger.append === "function" ? ledger : null;
    // intervalMs handling:
    //   - finite number (incl. 0 / negative) → clamp UP to 100ms floor.
    //     The floor exists so a sloppy `intervalMs: 0` doesn't spin a
    //     tight loop.
    //   - NaN / undefined / non-finite → fall back to 30000ms default
    //     (matches RunnerRegistry.heartbeatDropMs so a host that goes
    //     silent shows up in the chain within ~one drop window).
    {
      const n = Number(intervalMs);
      this._intervalMs = Number.isFinite(n) ? Math.max(100, n) : 30000;
    }
    this._setInterval = setIntervalImpl;
    this._clearInterval = clearIntervalImpl;
    this._onError = typeof onError === "function"
      ? onError
      : (err) => { try { console.error("[runnerStaleMonitor] tick error", err); } catch (_) {} };

    this._timer = null;
    // Single-emit dedupe: hostIdentity → true once it has been audited
    // as lost. Cleared when the host disappears from pruneStaleRunners
    // (re-handshake, eviction, env rotation) so a future stale cycle
    // re-audits.
    this._auditedLostHosts = new Set();

    // Diagnostic counters surfaced via getStats() for tests + ops.
    this._stats = {
      ticks: 0,
      pruned: 0,    // total stale-host detections across all ticks
      audited: 0,   // total runner_host_lost rows emitted
      errors: 0,
    };
  }

  /**
   * Start the periodic prune loop. Idempotent — calling start() twice
   * does NOT schedule two timers; the second call returns false.
   * @returns {boolean} true if a timer was started, false if already running.
   */
  start() {
    if (this._timer !== null) return false;
    this._timer = this._setInterval(() => this._tick(), this._intervalMs);
    // Some setInterval implementations return objects with .unref();
    // we don't unref by default because the orchestrator wants the
    // monitor to keep the process alive while it's running. shutdown.js
    // calls stop() explicitly during graceful shutdown.
    return true;
  }

  /**
   * Stop the periodic prune loop. Idempotent — calling stop() twice
   * does not throw; the second call returns false.
   * @returns {boolean} true if a timer was cleared, false if not running.
   */
  stop() {
    if (this._timer === null) return false;
    this._clearInterval(this._timer);
    this._timer = null;
    return true;
  }

  /**
   * Run a single prune cycle synchronously. Useful for tests that want
   * to drive the monitor without a real timer. Public so server.js can
   * call it on demand (e.g. an admin endpoint to force a prune).
   *
   * Behavior:
   *   1. Call registry.pruneStaleRunners() to get current stale list.
   *   2. For each stale host with affectedRuns.length > 0:
   *      - Skip if already in _auditedLostHosts (dedupe).
   *      - Emit runner_host_lost audit row to ledger.
   *      - Add to _auditedLostHosts.
   *   3. Refresh dedupe set: any host that was previously audited but
   *      has now disappeared from the stale list (re-handshake / etc.)
   *      is cleared so a future stale event re-audits.
   *
   * Idle stale hosts (affectedRuns empty) are intentionally NOT audited
   * — operator housekeeping, not security signal. The monitor is for
   * stranded runs, not for "host X has gone away with nothing claimed".
   */
  tick() {
    return this._tick();
  }

  _tick() {
    this._stats.ticks += 1;
    let stale;
    try {
      stale = this._registry.pruneStaleRunners();
    } catch (err) {
      this._stats.errors += 1;
      this._onError(err);
      return;
    }
    this._stats.pruned += stale.length;
    const seenStaleHosts = new Set();
    for (const entry of stale) {
      seenStaleHosts.add(entry.hostIdentity);
      // Idle stale hosts: no stranded runs, no audit. Operator can
      // observe them via /api/server/info or pruneStaleRunners directly.
      if (!entry.affectedRuns || entry.affectedRuns.length === 0) continue;
      if (this._auditedLostHosts.has(entry.hostIdentity)) continue;
      // Emit audit row.
      if (this._ledger) {
        try {
          this._ledger.append("system", {
            type: "runner_host_lost",
            data: {
              hostIdentity: entry.hostIdentity,
              elapsedMs: entry.elapsedMs,
              activeRuns: entry.activeRuns,
              affectedRuns: entry.affectedRuns.slice(),
            },
          });
          this._stats.audited += 1;
        } catch (err) {
          // Ledger failure must not break the timer.
          this._stats.errors += 1;
          this._onError(err);
          // Don't add to _auditedLostHosts — try again on next tick.
          continue;
        }
      } else {
        // No ledger configured: still mark as audited so the dedupe
        // semantic is consistent in tests.
        this._stats.audited += 1;
      }
      this._auditedLostHosts.add(entry.hostIdentity);
    }
    // Clear dedupe entries for hosts that no longer appear stale.
    for (const auditedHost of this._auditedLostHosts) {
      if (!seenStaleHosts.has(auditedHost)) {
        this._auditedLostHosts.delete(auditedHost);
      }
    }
  }

  /** Snapshot of monitor stats for ops + tests. */
  getStats() {
    return {
      running: this._timer !== null,
      intervalMs: this._intervalMs,
      auditedLostHostCount: this._auditedLostHosts.size,
      ...this._stats,
    };
  }

  /** Test-only — forces the dedupe set to a known state. */
  _setAuditedLostHosts(hostIds) {
    this._auditedLostHosts = new Set(hostIds);
  }
}

module.exports = { RunnerStaleMonitor };
