// Slice R1-d (Phase D R1, 2026-04-28) — RunnerRegistry.
//
// Tracks remote runner hosts that have completed the handshake (§8.1)
// and provides the look-ups that other modules need:
//
//   - listRunners() / activeRunners() — what monitorRoutes.bootstrap reports.
//   - originForRun(runId) — what monitorRoutes /api/monitor/runs/:runId
//                           uses to decorate the response with `origin`.
//   - claimRunForRunner(runId, hostIdentity) — when the orchestrator
//     assigns a run to a runner, this sticks the mapping so subsequent
//     `originForRun` calls reflect the assignment.
//   - issueRunnerToken(hostIdentity) — opaque 32-byte hex returned at
//     handshake; the runner uses it for heartbeat auth.
//   - verifyRunnerToken(hostIdentity, token) — heartbeat path.
//
// This is the in-process state owner. The HTTP routes (runnerRoutes.js)
// are thin wrappers around it. Persistence is intentionally absent in
// R1: a runner that loses its handshake when the orchestrator restarts
// just re-handshakes — the bootstrap token re-grant policy is operator-
// controlled (typically the same env value, so re-handshake works).
//
// MG1 §8.2 token taxonomy (locked in this module):
//
//   bootstrap   — read from HARNESS_REMOTE_RUNNER_TOKEN_<host> env at
//                 handshake time. Single-use; a successful handshake
//                 marks it consumed in-memory until process restart.
//   runnerToken — 32-byte hex issued here. 24h sliding window, refreshed
//                 on heartbeat. Stored unhashed in memory only — never
//                 written to disk. Compared via timing-safe-equal.
//   runJWT      — issued elsewhere (jwt.js / runnerRoutes); not stored
//                 here. The registry only knows about the runner-host
//                 layer of the auth taxonomy.

const crypto = require("crypto");

const RUNNER_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;  // 24h sliding
const HEARTBEAT_DROP_MS = 30 * 1000;             // 30s inactivity → unhealthy

function _safeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let aBuf, bBuf;
  try {
    aBuf = Buffer.from(a, "hex");
    bBuf = Buffer.from(b, "hex");
  } catch (_) { return false; }
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

class RunnerRegistry {
  /**
   * @param {object} [opts]
   * @param {function} [opts.now=Date.now]   - Override clock (tests).
   * @param {function} [opts.bootstrapTokenFor] - (hostIdentity) → token
   *        Override the env-driven default in tests. The default reads
   *        process.env["HARNESS_REMOTE_RUNNER_TOKEN_" + sanitizedHost].
   * @param {number} [opts.runnerTokenTtlMs] - Sliding window for runnerToken.
   * @param {number} [opts.heartbeatDropMs]  - Inactivity threshold.
   */
  constructor({ now, bootstrapTokenFor, runnerTokenTtlMs, heartbeatDropMs } = {}) {
    this._now = typeof now === "function" ? now : Date.now;
    this._bootstrapTokenFor = typeof bootstrapTokenFor === "function"
      ? bootstrapTokenFor
      : RunnerRegistry._defaultBootstrapTokenFor;
    this._runnerTokenTtlMs = runnerTokenTtlMs || RUNNER_TOKEN_TTL_MS;
    this._heartbeatDropMs = heartbeatDropMs || HEARTBEAT_DROP_MS;

    // hostIdentity → { runnerToken, issuedAt, lastSeen, capabilities,
    //                  sandboxClass, activeRuns, bootstrapConsumed }
    this._runners = new Map();
    // runId → hostIdentity (set when orchestrator claims a run for a runner)
    this._runAssignments = new Map();

    // Slice R2.5-d: track active runner WS connections by runId so the
    // monitor route can surface runner-claimed runs even when no
    // pipeline run was ever created (off / report bridge modes).
    // runId → { hostIdentity, since }
    this._activeRunIds = new Map();
  }

  // ── R2.5-d: active-run tracking for monitor visibility ───────────

  /**
   * Slice R2.5-d: mark a runId as actively-connected by a remote
   * runner. Idempotent — repeated calls overwrite the metadata so a
   * reconnect updates `since`. Returns true on successful mark, false
   * on missing args.
   */
  markRunActive({ runId, hostIdentity } = {}) {
    if (typeof runId !== "string" || runId.length === 0) return false;
    if (typeof hostIdentity !== "string" || hostIdentity.length === 0) return false;
    this._activeRunIds.set(runId, { hostIdentity, since: this._now() });
    return true;
  }

  /**
   * Slice R2.5-d: unmark a runId on WS disconnect. Idempotent. Returns
   * true if the entry existed and was removed.
   */
  unmarkRunActive(runId) {
    if (typeof runId !== "string" || runId.length === 0) return false;
    return this._activeRunIds.delete(runId);
  }

  /**
   * Slice R2.5-d: snapshot of currently active runner-claimed runIds.
   * The monitor route uses this to surface runner-claimed runs that
   * haven't been promoted to pipeline runs yet (off/report modes).
   */
  getActiveRunMeta(runId) {
    if (typeof runId !== "string" || runId.length === 0) return null;
    return this._activeRunIds.get(runId) || null;
  }

  /**
   * Slice R2.5-d: list all currently active runner-claimed runIds for
   * dashboard surfacing.
   */
  listActiveRuns() {
    return Array.from(this._activeRunIds.entries()).map(([runId, meta]) => ({
      runId,
      hostIdentity: meta.hostIdentity,
      since: meta.since,
    }));
  }

  static _defaultBootstrapTokenFor(hostIdentity) {
    // Replace any non-alnum char with `_` for env-var compatibility.
    const sanitized = String(hostIdentity || "").replace(/[^A-Za-z0-9]/g, "_");
    return process.env["HARNESS_REMOTE_RUNNER_TOKEN_" + sanitized];
  }

  // ── handshake (§8.1 step 1) ──────────────────────────────────────

  /**
   * Verify a bootstrap token + record the runner. Returns the freshly-
   * issued runnerToken on success. The bootstrap is single-use: once a
   * handshake completes for a hostIdentity, subsequent handshakes for
   * the same host with the same bootstrap require a re-grant by the
   * operator (handled by restarting the orchestrator + the env var).
   *
   * @returns { ok: true, runnerToken } | { ok: false, reason }
   */
  handshake({ hostIdentity, bootstrapToken, capabilities, sandboxClass }) {
    if (typeof hostIdentity !== "string" || hostIdentity.length === 0) {
      return { ok: false, reason: "host_invalid" };
    }
    if (typeof bootstrapToken !== "string" || bootstrapToken.length === 0) {
      return { ok: false, reason: "bootstrap_missing" };
    }
    const expected = this._bootstrapTokenFor(hostIdentity);
    if (typeof expected !== "string" || expected.length === 0) {
      return { ok: false, reason: "host_unknown" };
    }
    if (bootstrapToken.length !== expected.length) {
      return { ok: false, reason: "bootstrap_invalid" };
    }
    if (!crypto.timingSafeEqual(
      Buffer.from(bootstrapToken, "utf-8"),
      Buffer.from(expected, "utf-8"))
    ) {
      return { ok: false, reason: "bootstrap_invalid" };
    }
    const existing = this._runners.get(hostIdentity);
    if (existing && existing.bootstrapConsumed) {
      // Slice R3-c-1 (Phase D R3): differentiate replay-while-active from
      // replay-after-stale. Both stay rejected — single-use bootstrap is
      // preserved either way — but the routes layer can audit them
      // separately so collision attempts surface in the chain.
      //
      //   host_in_use         existing entry is fresh (lastSeen ≤ drop).
      //                       This is either (a) the same operator
      //                       retrying the handshake, (b) a replay
      //                       attack with a leaked bootstrap, or (c) a
      //                       second operator who rotated env trying
      //                       to claim a hostIdentity that's already
      //                       occupied. Per R3-0 §9.3 Q6 we silent-
      //                       reject — the routes layer emits
      //                       `runner_handshake_collision`.
      //   bootstrap_consumed  existing entry is stale (lastSeen > drop).
      //                       The previous runner has gone silent past
      //                       the heartbeat-drop threshold but the
      //                       single-use semantic still holds: rejoin
      //                       requires env rotation. The routes layer
      //                       emits `runner_handshake_rejected` with
      //                       reason=bootstrap_consumed (existing path).
      const elapsed = this._now() - existing.lastSeen;
      if (elapsed <= this._heartbeatDropMs) {
        return { ok: false, reason: "host_in_use" };
      }
      return { ok: false, reason: "bootstrap_consumed" };
    }

    const runnerToken = crypto.randomBytes(32).toString("hex");
    const now = this._now();
    this._runners.set(hostIdentity, {
      runnerToken,
      issuedAt: now,
      lastSeen: now,
      capabilities: capabilities && typeof capabilities === "object" ? capabilities : null,
      sandboxClass: typeof sandboxClass === "string" ? sandboxClass : "container-strict",
      activeRuns: 0,
      bootstrapConsumed: true,
    });
    return { ok: true, runnerToken };
  }

  // ── heartbeat (§8.1 step 2) ──────────────────────────────────────

  /**
   * Verify a runnerToken + refresh its sliding TTL. Returns ok / fails
   * with one of: host_unknown / token_invalid / token_expired.
   */
  heartbeat({ hostIdentity, runnerToken }) {
    if (typeof hostIdentity !== "string" || hostIdentity.length === 0) {
      return { ok: false, reason: "host_invalid" };
    }
    const r = this._runners.get(hostIdentity);
    if (!r) return { ok: false, reason: "host_unknown" };
    if (typeof runnerToken !== "string" || !_safeEqualHex(runnerToken, r.runnerToken)) {
      return { ok: false, reason: "token_invalid" };
    }
    const now = this._now();
    // Sliding window: anchor expiry on lastSeen, not issuedAt. As long as
    // heartbeats arrive faster than runnerTokenTtlMs the token stays alive;
    // a runner that goes silent for longer than the TTL must re-handshake.
    // (issuedAt is preserved for audit / observability — it's the *anchor*
    // of the original handshake, not a hard expiry deadline.)
    if (now - r.lastSeen > this._runnerTokenTtlMs) {
      return { ok: false, reason: "token_expired" };
    }
    r.lastSeen = now;
    return { ok: true };
  }

  // ── run assignment ───────────────────────────────────────────────

  /**
   * Bind a runId to a hostIdentity so subsequent `originForRun(runId)`
   * lookups know the runner. Called by the orchestrator when a run is
   * dispatched.
   *
   * Idempotency + reassignment invariants:
   *
   *   - Re-claiming the same (runId, hostIdentity) pair is a no-op for
   *     activeRuns. Protects against orchestrator retry loops, double
   *     dispatch, or replay-driven reassertion.
   *   - Claiming an already-bound runId for a *different* host transfers
   *     the run: the previous host's activeRuns is decremented and the
   *     new host's is incremented. Protects against failover / local-
   *     fallback paths leaking phantom activeRuns into stale hosts.
   *
   * These invariants are tested directly in
   * tests/unit/runnerRegistry.test.js — keep them in sync.
   */
  claimRunForRunner(runId, hostIdentity) {
    if (typeof runId !== "string" || runId.length === 0) return false;
    if (!this._runners.has(hostIdentity)) return false;
    const previousHost = this._runAssignments.get(runId);
    if (previousHost === hostIdentity) {
      // Idempotent re-claim — no count change.
      return true;
    }
    if (previousHost) {
      // Transfer: decrement the previous host's activeRuns first.
      const oldR = this._runners.get(previousHost);
      if (oldR && oldR.activeRuns > 0) oldR.activeRuns -= 1;
    }
    this._runAssignments.set(runId, hostIdentity);
    const r = this._runners.get(hostIdentity);
    r.activeRuns += 1;
    return true;
  }

  releaseRun(runId) {
    const host = this._runAssignments.get(runId);
    if (!host) return false;
    const r = this._runners.get(host);
    if (r && r.activeRuns > 0) r.activeRuns -= 1;
    this._runAssignments.delete(runId);
    return true;
  }

  // ── R3-c-1: pool scheduling + stale detection (multi-runner) ─────

  /**
   * Slice R3-c-1 (Phase D R3, 2026-04-28): Public assignment query.
   * Returns the hostIdentity bound to runId or null. Promotes the
   * `_hostFor` test hook to a public surface so the orchestrator's
   * dispatch path can read assignments without depending on the
   * underscore-prefixed private field.
   *
   * Returns the hostIdentity REGARDLESS of host staleness — staleness
   * is a separate concern (see `pruneStaleRunners()`). This avoids
   * conflating "is the run claimed?" with "is the host healthy?",
   * which keeps the host-loss policy in the caller's hands per
   * R3-G09 ("fail not silent forward").
   */
  getAssignment(runId) {
    if (typeof runId !== "string" || runId.length === 0) return null;
    return this._runAssignments.get(runId) || null;
  }

  /**
   * Slice R3-c-1: Pick the least-loaded healthy runner for a fresh
   * dispatch. Returns the hostIdentity or null if no runner is
   * eligible. Does NOT mutate state — the caller is responsible
   * for `claimRunForRunner` after this returns.
   *
   * Selection policy (MG1 §6.3 step 4):
   *   - Eligibility: elapsed (now - lastSeen) ≤ heartbeatDropMs.
   *     Hosts whose last heartbeat exceeds the drop window are
   *     skipped — they're stale and a fresh dispatch to them would
   *     stall.
   *   - Saturation: when `maxConcurrentRunsPerHost` is set, hosts
   *     already at or above that count are skipped (not the same as
   *     stale — these hosts are healthy but full).
   *   - Least-loaded: among eligible+unsaturated hosts, pick the one
   *     with the lowest `activeRuns`.
   *   - FIFO tie-break: when multiple hosts tie on activeRuns, the
   *     one registered earliest (lowest `issuedAt`) wins. Map
   *     iteration order in Node preserves insertion order, so simply
   *     iterating and using strict-less-than achieves FIFO without
   *     an extra sort.
   *
   * This is a pure read of registry state — repeated calls without
   * a `claimRunForRunner` in between return the same answer. The
   * orchestrator MUST claim immediately after selecting to avoid
   * two simultaneous dispatches picking the same least-loaded host.
   *
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrentRunsPerHost=Infinity]
   * @returns {string|null} hostIdentity or null when no eligible host.
   */
  selectFreshRunner({ maxConcurrentRunsPerHost = Infinity } = {}) {
    const now = this._now();
    let best = null;
    let bestActive = Infinity;
    for (const [hostIdentity, r] of this._runners) {
      const elapsed = now - r.lastSeen;
      if (elapsed > this._heartbeatDropMs) continue;        // stale
      if (r.activeRuns >= maxConcurrentRunsPerHost) continue; // saturated
      // Strict-less-than preserves FIFO among equal-load hosts because
      // the Map yields insertion order; the first equal entry wins and
      // no later entry displaces it.
      if (r.activeRuns < bestActive) {
        best = hostIdentity;
        bestActive = r.activeRuns;
      }
    }
    return best;
  }

  /**
   * Slice R3-c-1: Observation of stale runners — those whose lastSeen
   * exceeds heartbeatDropMs. Returns an array of
   *   { hostIdentity, lastSeen, elapsedMs, activeRuns, affectedRuns: [...runIds] }
   * sorted by elapsedMs descending (longest-silent first) so audit
   * + ops surfaces show the most-likely-dead host at the top.
   *
   * Pure observation — does NOT mutate `_runners` or `_runAssignments`.
   * The caller (orchestrator host-loss handler, R3-c-3) decides whether
   * to:
   *   - emit `runner_host_lost` audit entries,
   *   - mark affected runs as failed (R3-G09: fail-not-forward),
   *   - evict the host from `_runners` after a longer silence,
   *   - leave the host in place to recover via re-handshake.
   *
   * Returning the affected runIds with each entry keeps the policy
   * decision in one place — the registry just reports "these are
   * the hosts that have gone silent, these are the runs claimed for
   * each, decide what to do". Affected runs are derived from the
   * snapshot of `_runAssignments` at call time; if the caller is
   * concurrently claiming new runs, the snapshot may miss them but
   * subsequent calls will catch up.
   */
  pruneStaleRunners() {
    const now = this._now();
    const stale = [];
    for (const [hostIdentity, r] of this._runners) {
      const elapsed = now - r.lastSeen;
      if (elapsed <= this._heartbeatDropMs) continue;
      const affectedRuns = [];
      for (const [runId, host] of this._runAssignments) {
        if (host === hostIdentity) affectedRuns.push(runId);
      }
      stale.push({
        hostIdentity,
        lastSeen: new Date(r.lastSeen).toISOString(),
        elapsedMs: elapsed,
        activeRuns: r.activeRuns,
        affectedRuns,
      });
    }
    // Longest-silent first so observability surfaces lead with the
    // most-likely-dead host.
    stale.sort((a, b) => b.elapsedMs - a.elapsedMs);
    return stale;
  }

  // ── monitorRoutes-facing surface ─────────────────────────────────

  /**
   * Returns the list of runners suitable for /api/monitor/bootstrap.runners.
   * Health is derived from lastSeen vs heartbeatDropMs.
   */
  listRunners() {
    const now = this._now();
    const out = [];
    for (const [hostIdentity, r] of this._runners) {
      const elapsed = now - r.lastSeen;
      const health = elapsed <= this._heartbeatDropMs ? "healthy"
                   : elapsed <= this._heartbeatDropMs * 2 ? "degraded"
                   : "unhealthy";
      out.push({
        hostIdentity,
        sandboxClass: r.sandboxClass,
        health,
        activeRuns: r.activeRuns,
        lastSeen: new Date(r.lastSeen).toISOString(),
      });
    }
    return out;
  }

  /**
   * Returns the per-run origin for /api/monitor/runs/:runId. When the
   * runId hasn't been claimed by a runner, returns null so the route
   * falls back to its local-default.
   */
  originForRun(runId) {
    const host = this._runAssignments.get(runId);
    if (!host) return null;
    const r = this._runners.get(host);
    if (!r) return null;
    const now = this._now();
    const elapsed = now - r.lastSeen;
    const isolationStatus = elapsed <= this._heartbeatDropMs ? "healthy"
                          : elapsed <= this._heartbeatDropMs * 2 ? "degraded"
                          : "lost";
    return {
      runOrigin: "container-remote",
      sandboxClass: r.sandboxClass,
      hostIdentity: host,
      isolationStatus,
    };
  }

  // ── test hooks ───────────────────────────────────────────────────

  _runnerCount() { return this._runners.size; }
  _hostFor(runId) { return this._runAssignments.get(runId) || null; }
}

module.exports = { RunnerRegistry, RUNNER_TOKEN_TTL_MS, HEARTBEAT_DROP_MS };
