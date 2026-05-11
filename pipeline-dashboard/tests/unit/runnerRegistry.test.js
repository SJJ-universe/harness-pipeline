// Slice R1-d (Phase D R1, 2026-04-28) — RunnerRegistry unit tests.
//
// Covers handshake / heartbeat / claim / origin / list and all the
// rejection reasons (host_unknown, bootstrap_invalid, bootstrap_consumed,
// token_invalid, token_expired, host_invalid).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  RunnerRegistry,
  RUNNER_TOKEN_TTL_MS,
  HEARTBEAT_DROP_MS,
} = require("../../src/runtime/runnerRegistry");

function makeReg(opts = {}) {
  // Bootstrap tokens via a closure instead of process.env so tests
  // don't pollute global state.
  const tokens = opts.tokens || { "runner-a/3": "bootstrap-aaa", "runner-b/1": "bootstrap-bbb" };
  return new RunnerRegistry({
    bootstrapTokenFor: (h) => tokens[h],
    now: opts.now,
    runnerTokenTtlMs: opts.runnerTokenTtlMs,
    heartbeatDropMs: opts.heartbeatDropMs,
  });
}

// ── handshake ──────────────────────────────────────────────────────

test("R1-d: handshake issues runnerToken on valid bootstrap", () => {
  const reg = makeReg();
  const r = reg.handshake({
    hostIdentity: "runner-a/3",
    bootstrapToken: "bootstrap-aaa",
    capabilities: { gpu: false },
    sandboxClass: "container-strict",
  });
  assert.equal(r.ok, true);
  assert.equal(typeof r.runnerToken, "string");
  assert.equal(r.runnerToken.length, 64);  // 32 bytes hex
});

test("R1-d: handshake rejects unknown host", () => {
  const reg = makeReg();
  const r = reg.handshake({ hostIdentity: "unknown/1", bootstrapToken: "x" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "host_unknown");
});

test("R1-d: handshake rejects wrong bootstrap (timing-safe)", () => {
  const reg = makeReg();
  const r = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "wrong-token" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "bootstrap_invalid");
});

test("R1-d: handshake rejects empty bootstrap / host", () => {
  const reg = makeReg();
  assert.equal(reg.handshake({ hostIdentity: "runner-a/3" }).reason, "bootstrap_missing");
  assert.equal(reg.handshake({ bootstrapToken: "x" }).reason, "host_invalid");
});

test("R1-d / R3-c-1: handshake replay during a fresh existing entry → host_in_use (collision)", () => {
  // Pre-R3-c, this returned `bootstrap_consumed` for any replay. R3-c-1
  // splits the rejection into two reasons so the routes layer can audit
  // a true collision (existing host healthy + bootstrap reused) separately
  // from a stale-recovery replay. Both stay rejected — single-use is
  // preserved — but `host_in_use` lights up the operator-collision path.
  const reg = makeReg();
  const first = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(first.ok, true);
  // Immediate replay: existing entry is fresh → collision verdict.
  const second = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "host_in_use",
    "fresh existing host + bootstrap replay = collision (R3-G06)");
});

// ── heartbeat ──────────────────────────────────────────────────────

test("R1-d: heartbeat refreshes lastSeen on valid runnerToken", () => {
  let clock = 1000;
  const reg = makeReg({ now: () => clock });
  const handshake = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  // Advance clock a bit, then heartbeat.
  clock = 5000;
  const r = reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: handshake.runnerToken });
  assert.equal(r.ok, true);
  // listRunners().lastSeen reflects the new time.
  const runners = reg.listRunners();
  assert.equal(runners.length, 1);
  assert.equal(runners[0].hostIdentity, "runner-a/3");
  assert.equal(runners[0].health, "healthy");
});

test("R1-d: heartbeat rejects unknown host", () => {
  const reg = makeReg();
  assert.equal(reg.heartbeat({ hostIdentity: "ghost", runnerToken: "x".repeat(64) }).reason, "host_unknown");
});

test("R1-d: heartbeat rejects wrong runnerToken (timing-safe)", () => {
  const reg = makeReg();
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  // 64-char wrong token (same length to defeat the length-prefix shortcut).
  const r = reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: "0".repeat(64) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "token_invalid");
});

test("R1-d: heartbeat rejects expired runnerToken", () => {
  let clock = 1000;
  const reg = makeReg({ now: () => clock, runnerTokenTtlMs: 60_000 });
  const h = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  clock += 60_000 + 1;   // past TTL
  const r = reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: h.runnerToken });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "token_expired");
});

test("R1-d: heartbeat refreshes sliding TTL — repeated heartbeats keep token alive past original TTL", () => {
  // The sliding window MUST anchor on lastSeen, not issuedAt. Otherwise a
  // long-lived runner with continuous heartbeats would still expire after
  // exactly runnerTokenTtlMs from handshake — defeating the whole point of
  // a "sliding" window. Regression guard for an early bug where heartbeat
  // refreshed lastSeen but expiry compared against the original issuedAt.
  let clock = 1000;
  const reg = makeReg({ now: () => clock, runnerTokenTtlMs: 60_000 });
  const h = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  // 30s in — within TTL. Heartbeat refreshes lastSeen → 31_000.
  clock += 30_000;
  assert.equal(reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: h.runnerToken }).ok, true);
  // 40s after that — past the original 60s window from handshake, but the
  // previous heartbeat reset the clock. Should still succeed.
  clock += 40_000;
  assert.equal(reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: h.runnerToken }).ok, true);
  // Now go silent for > TTL — token expires.
  clock += 60_001;
  assert.equal(
    reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: h.runnerToken }).reason,
    "token_expired",
  );
});

test("R1-d: heartbeat token-format mismatch (non-hex / wrong length) → token_invalid", () => {
  const reg = makeReg();
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: "short" }).reason, "token_invalid");
  assert.equal(reg.heartbeat({ hostIdentity: "runner-a/3", runnerToken: "g".repeat(64) }).reason, "token_invalid");
});

// ── claim / release ────────────────────────────────────────────────

test("R1-d: claimRunForRunner binds runId → host", () => {
  const reg = makeReg();
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(reg.claimRunForRunner("rr-1", "runner-a/3"), true);
  assert.equal(reg._hostFor("rr-1"), "runner-a/3");
});

test("R1-d: claimRunForRunner rejects unknown host", () => {
  const reg = makeReg();
  assert.equal(reg.claimRunForRunner("rr-1", "unknown/1"), false);
});

test("R1-d: claimRunForRunner is idempotent for the same (runId, host) — no double-count", () => {
  // Repeated dispatch / retry loops must not inflate activeRuns. This is
  // important for orchestrator retry on transient errors and for replay-
  // driven reassertion after a hook router reconnect.
  const reg = makeReg();
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(reg.claimRunForRunner("rr-1", "runner-a/3"), true);
  assert.equal(reg.claimRunForRunner("rr-1", "runner-a/3"), true);
  assert.equal(reg.listRunners()[0].activeRuns, 1);
});

test("R1-d: claimRunForRunner reassigns runId to a new host (decrement old, increment new)", () => {
  // Failover / local-fallback path: a run originally dispatched to host-a
  // gets reassigned to host-b. The previous host's activeRuns must drop,
  // otherwise stale hosts accumulate phantom runs and `listRunners` /
  // `originForRun` go out of sync with reality.
  const reg = makeReg({ tokens: { "host-a": "ba", "host-b": "bb" } });
  reg.handshake({ hostIdentity: "host-a", bootstrapToken: "ba" });
  reg.handshake({ hostIdentity: "host-b", bootstrapToken: "bb" });
  reg.claimRunForRunner("rr-1", "host-a");
  reg.claimRunForRunner("rr-1", "host-b");
  const byHost = Object.fromEntries(reg.listRunners().map(r => [r.hostIdentity, r.activeRuns]));
  assert.equal(byHost["host-a"], 0);
  assert.equal(byHost["host-b"], 1);
  assert.equal(reg._hostFor("rr-1"), "host-b");
});

test("R1-d: releaseRun decrements activeRuns + unbinds", () => {
  const reg = makeReg();
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  reg.claimRunForRunner("rr-1", "runner-a/3");
  reg.claimRunForRunner("rr-2", "runner-a/3");
  assert.equal(reg.listRunners()[0].activeRuns, 2);
  reg.releaseRun("rr-1");
  assert.equal(reg.listRunners()[0].activeRuns, 1);
  assert.equal(reg._hostFor("rr-1"), null);
});

// ── listRunners health derivation ──────────────────────────────────

test("R1-d: listRunners reports healthy/degraded/unhealthy by elapsed time", () => {
  let clock = 1000;
  const reg = makeReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  // Healthy: same clock as handshake (lastSeen = 1000).
  assert.equal(reg.listRunners()[0].health, "healthy");
  // Degraded: 30..60s elapsed.
  clock += 45_000;
  assert.equal(reg.listRunners()[0].health, "degraded");
  // Unhealthy: > 60s elapsed.
  clock += 30_000;
  assert.equal(reg.listRunners()[0].health, "unhealthy");
});

// ── originForRun ──────────────────────────────────────────────────

test("R1-d: originForRun returns null when run unassigned", () => {
  const reg = makeReg();
  assert.equal(reg.originForRun("rr-1"), null);
});

test("R1-d: originForRun returns container-remote shape after claim", () => {
  const reg = makeReg();
  reg.handshake({
    hostIdentity: "runner-a/3",
    bootstrapToken: "bootstrap-aaa",
    sandboxClass: "container-strict",
  });
  reg.claimRunForRunner("rr-1", "runner-a/3");
  const o = reg.originForRun("rr-1");
  assert.equal(o.runOrigin, "container-remote");
  assert.equal(o.sandboxClass, "container-strict");
  assert.equal(o.hostIdentity, "runner-a/3");
  assert.equal(o.isolationStatus, "healthy");
});

test("R1-d: originForRun isolationStatus tracks heartbeat freshness", () => {
  let clock = 1000;
  const reg = makeReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  reg.claimRunForRunner("rr-1", "runner-a/3");
  assert.equal(reg.originForRun("rr-1").isolationStatus, "healthy");
  clock += 45_000;
  assert.equal(reg.originForRun("rr-1").isolationStatus, "degraded");
  clock += 30_000;
  assert.equal(reg.originForRun("rr-1").isolationStatus, "lost");
});

// ── env-driven default bootstrap ───────────────────────────────────

test("R1-d: default bootstrapTokenFor reads ORCHESTRATOR_REMOTE_RUNNER_TOKEN_<sanitized>", () => {
  // Sanitization: "runner-a/3" → "runner_a_3"
  const old = process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a_3"];
  process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a_3"] = "env-bootstrap";
  try {
    const reg = new RunnerRegistry();   // default constructor → env path
    const r = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "env-bootstrap" });
    assert.equal(r.ok, true);
  } finally {
    if (old === undefined) delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a_3"];
    else process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a_3"] = old;
  }
});

// ── R2.5-d: active-run tracking for monitor visibility ────────────

test("R2.5-d: markRunActive tracks runId + hostIdentity + since timestamp", () => {
  let clock = 5000;
  const reg = makeReg({ now: () => clock });
  assert.equal(reg.markRunActive({ runId: "rr-1", hostIdentity: "host-x" }), true);
  const meta = reg.getActiveRunMeta("rr-1");
  assert.equal(meta.hostIdentity, "host-x");
  assert.equal(meta.since, 5000);
});

test("R2.5-d: markRunActive overwrites on reconnect (idempotent + refreshes since)", () => {
  let clock = 5000;
  const reg = makeReg({ now: () => clock });
  reg.markRunActive({ runId: "rr-1", hostIdentity: "host-x" });
  clock += 10000;
  reg.markRunActive({ runId: "rr-1", hostIdentity: "host-x" });
  assert.equal(reg.getActiveRunMeta("rr-1").since, 15000);
});

test("R2.5-d: markRunActive rejects empty runId or hostIdentity", () => {
  const reg = makeReg();
  assert.equal(reg.markRunActive({ runId: "", hostIdentity: "h" }), false);
  assert.equal(reg.markRunActive({ runId: "r", hostIdentity: "" }), false);
  assert.equal(reg.markRunActive({}), false);
  assert.equal(reg.getActiveRunMeta("r"), null);
});

test("R2.5-d: unmarkRunActive clears entry; idempotent", () => {
  const reg = makeReg();
  reg.markRunActive({ runId: "rr-1", hostIdentity: "host-x" });
  assert.equal(reg.unmarkRunActive("rr-1"), true);
  assert.equal(reg.getActiveRunMeta("rr-1"), null);
  assert.equal(reg.unmarkRunActive("rr-1"), false);  // already gone
  assert.equal(reg.unmarkRunActive("never-existed"), false);
});

test("R2.5-d: listActiveRuns returns every currently-marked run", () => {
  let clock = 1000;
  const reg = makeReg({ now: () => clock });
  reg.markRunActive({ runId: "rr-A", hostIdentity: "host-1" });
  clock += 100;
  reg.markRunActive({ runId: "rr-B", hostIdentity: "host-2" });
  const list = reg.listActiveRuns();
  assert.equal(list.length, 2);
  const a = list.find((r) => r.runId === "rr-A");
  assert.equal(a.hostIdentity, "host-1");
  assert.equal(a.since, 1000);
  const b = list.find((r) => r.runId === "rr-B");
  assert.equal(b.hostIdentity, "host-2");
  assert.equal(b.since, 1100);
});

test("R2.5-d: markRunActive does NOT collide with the existing _runAssignments map (separate concern)", () => {
  // claimRunForRunner is the orchestrator-claim path; markRunActive is
  // the runner-WS-connection path. They MUST stay independent so a
  // future R3 multi-runner can keep the orchestrator's claim semantics
  // separate from the operational "runner has an open WS for this
  // runId" tracking.
  const reg = makeReg();
  reg.handshake({ hostIdentity: "host-x", bootstrapToken: "x".repeat(16) });
  reg._bootstrapTokenFor = () => "x".repeat(16);  // for claim re-test
  reg.markRunActive({ runId: "rr-1", hostIdentity: "host-x" });
  // Sanity: marking does NOT add to runAssignments.
  assert.equal(reg._runAssignments.has("rr-1"), false);
  // And vice versa — claiming does not mark active.
  reg.claimRunForRunner("rr-2", "host-x");
  assert.equal(reg.getActiveRunMeta("rr-2"), null);
});

// ── R3-c-1: pool scheduling + stale detection (multi-runner) ───────

function makeMultiHostReg(opts = {}) {
  const tokens = opts.tokens || {
    "host-1": "boot-1",
    "host-2": "boot-2",
    "host-3": "boot-3",
  };
  return new RunnerRegistry({
    bootstrapTokenFor: (h) => tokens[h],
    now: opts.now,
    heartbeatDropMs: opts.heartbeatDropMs,
    runnerTokenTtlMs: opts.runnerTokenTtlMs,
  });
}

test("R3-c-1: getAssignment returns hostIdentity when claimed, null otherwise", () => {
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(reg.getAssignment("rr-A"), null);
  reg.claimRunForRunner("rr-A", "host-1");
  assert.equal(reg.getAssignment("rr-A"), "host-1");
});

test("R3-c-1: getAssignment returns hostIdentity even when host is stale (caller decides policy)", () => {
  // R3-G09 invariant: the registry doesn't auto-forward a claimed run
  // to a different host. getAssignment continues to return the
  // claimed host so the orchestrator can fail the run with full
  // attribution rather than silently re-dispatching.
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.claimRunForRunner("rr-A", "host-1");
  clock += 60_000; // host-1 lastSeen now 60s old → stale
  assert.equal(reg.getAssignment("rr-A"), "host-1",
    "stale assignment must still surface for the caller to fail explicitly");
});

test("R3-c-1: getAssignment rejects empty / non-string runId", () => {
  const reg = makeMultiHostReg();
  assert.equal(reg.getAssignment(""), null);
  assert.equal(reg.getAssignment(null), null);
  assert.equal(reg.getAssignment(undefined), null);
  assert.equal(reg.getAssignment(123), null);
});

test("R3-c-1: selectFreshRunner returns null on empty registry", () => {
  const reg = makeMultiHostReg();
  assert.equal(reg.selectFreshRunner(), null);
});

test("R3-c-1: selectFreshRunner returns the only registered runner", () => {
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(reg.selectFreshRunner(), "host-1");
});

test("R3-c-1: selectFreshRunner picks the least-loaded host", () => {
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  reg.handshake({ hostIdentity: "host-3", bootstrapToken: "boot-3" });
  // host-1: 2 active, host-2: 0 active, host-3: 1 active.
  reg.claimRunForRunner("rr-1", "host-1");
  reg.claimRunForRunner("rr-2", "host-1");
  reg.claimRunForRunner("rr-3", "host-3");
  assert.equal(reg.selectFreshRunner(), "host-2");
});

test("R3-c-1: selectFreshRunner FIFO tie-break — earliest-registered host wins among equal-load", () => {
  // All three hosts have 0 activeRuns; insertion order is
  // host-1, host-2, host-3 → host-1 wins. This is the documented
  // FIFO tie-break semantic — strict-less-than during the scan
  // means the FIRST equal-load host claimed is kept.
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  reg.handshake({ hostIdentity: "host-3", bootstrapToken: "boot-3" });
  assert.equal(reg.selectFreshRunner(), "host-1");
});

test("R3-c-1: selectFreshRunner round-robin via repeated select+claim — distributes 6 runs across 3 hosts", () => {
  // Operational fairness: 6 simultaneous dispatches, 3 idle runners
  // → each runner gets ≤2 runs. The strict-less-than tie-break
  // wraps because each claim increments the chosen host's activeRuns,
  // making it no longer least-loaded for the next selection.
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  reg.handshake({ hostIdentity: "host-3", bootstrapToken: "boot-3" });
  for (let i = 0; i < 6; i += 1) {
    const runId = `rr-${i}`;
    const host = reg.selectFreshRunner();
    assert.ok(host, `selection ${i} should yield a host`);
    reg.claimRunForRunner(runId, host);
  }
  const counts = Object.fromEntries(
    reg.listRunners().map((r) => [r.hostIdentity, r.activeRuns]),
  );
  assert.equal(counts["host-1"], 2);
  assert.equal(counts["host-2"], 2);
  assert.equal(counts["host-3"], 2);
});

test("R3-c-1: selectFreshRunner skips stale hosts (lastSeen > heartbeatDropMs)", () => {
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  // Bring host-2 in 10s later — its lastSeen is 11_000.
  clock += 10_000;
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  // 35s later: host-1 is 45s stale (1000 → 46_000), host-2 is 35s stale (11_000 → 46_000).
  clock += 35_000;
  // Both stale. selectFreshRunner returns null.
  assert.equal(reg.selectFreshRunner(), null);
});

test("R3-c-1: selectFreshRunner returns the fresh host even when others are stale", () => {
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  clock += 40_000;  // host-1 is now stale
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  // host-2 is fresh, host-1 is stale — selection picks host-2 even
  // though host-1 was registered first.
  assert.equal(reg.selectFreshRunner(), "host-2");
});

test("R3-c-1: selectFreshRunner respects maxConcurrentRunsPerHost", () => {
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  // Saturate host-1 with 2 runs.
  reg.claimRunForRunner("rr-1", "host-1");
  reg.claimRunForRunner("rr-2", "host-1");
  // host-2 has 0 active.
  // With maxConcurrentRunsPerHost=2, host-1 is at the limit → host-2 wins.
  assert.equal(reg.selectFreshRunner({ maxConcurrentRunsPerHost: 2 }), "host-2");
  // Saturate host-2 too.
  reg.claimRunForRunner("rr-3", "host-2");
  reg.claimRunForRunner("rr-4", "host-2");
  // Now both saturated — selection returns null.
  assert.equal(reg.selectFreshRunner({ maxConcurrentRunsPerHost: 2 }), null);
});

test("R3-c-1: selectFreshRunner is pure — repeated calls without claim return the same host", () => {
  // Concurrent-dispatch invariant: if two simultaneous dispatch
  // attempts both select before either claims, they pick the same
  // least-loaded host. The orchestrator MUST claim immediately
  // (synchronously) after selecting to avoid double-dispatch.
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  const a = reg.selectFreshRunner();
  const b = reg.selectFreshRunner();
  const c = reg.selectFreshRunner();
  assert.equal(a, b);
  assert.equal(b, c);
});

test("R3-c-1: pruneStaleRunners returns [] when no host is stale", () => {
  const reg = makeMultiHostReg();
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  assert.deepEqual(reg.pruneStaleRunners(), []);
});

test("R3-c-1: pruneStaleRunners lists stale hosts with elapsed time + activeRuns", () => {
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
  reg.claimRunForRunner("rr-A", "host-1");
  // Time-warp: host-1 stale at 60s, host-2 fresh.
  clock += 30_000;
  reg.heartbeat({
    hostIdentity: "host-2",
    runnerToken: reg.listRunners().find((r) => r.hostIdentity === "host-2") && reg._runners.get("host-2").runnerToken,
  });
  clock += 31_000; // host-1: 61s elapsed, host-2: 31s elapsed
  const stale = reg.pruneStaleRunners();
  // Both are stale (>30s) at this point; longest-silent first is host-1.
  assert.equal(stale.length, 2);
  assert.equal(stale[0].hostIdentity, "host-1");
  assert.ok(stale[0].elapsedMs >= 61_000);
  assert.equal(stale[0].activeRuns, 1);
  assert.deepEqual(stale[0].affectedRuns, ["rr-A"]);
  assert.equal(stale[1].hostIdentity, "host-2");
  assert.equal(stale[1].activeRuns, 0);
  assert.deepEqual(stale[1].affectedRuns, []);
});

test("R3-c-1: pruneStaleRunners aggregates multiple affected runs per host", () => {
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.claimRunForRunner("rr-A", "host-1");
  reg.claimRunForRunner("rr-B", "host-1");
  reg.claimRunForRunner("rr-C", "host-1");
  clock += 60_000;
  const stale = reg.pruneStaleRunners();
  assert.equal(stale.length, 1);
  assert.equal(stale[0].hostIdentity, "host-1");
  assert.equal(stale[0].activeRuns, 3);
  assert.deepEqual(stale[0].affectedRuns.sort(), ["rr-A", "rr-B", "rr-C"]);
});

test("R3-c-1: pruneStaleRunners is observation-only — does NOT mutate _runners or _runAssignments", () => {
  // The orchestrator decides what to do with stale hosts (R3-G09:
  // fail-not-forward). The registry must not unilaterally remove
  // assignments or hosts because that would erase audit context.
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  reg.claimRunForRunner("rr-A", "host-1");
  const runnersBefore = reg.listRunners().length;
  const assignmentBefore = reg.getAssignment("rr-A");
  clock += 60_000;
  reg.pruneStaleRunners();
  reg.pruneStaleRunners();
  reg.pruneStaleRunners();
  const runnersAfter = reg.listRunners().length;
  const assignmentAfter = reg.getAssignment("rr-A");
  assert.equal(runnersBefore, runnersAfter);
  assert.equal(assignmentBefore, assignmentAfter);
});

test("R3-c-1: handshake collision — fresh existing host + bootstrap replay → host_in_use", () => {
  // Same scenario as the R1-d replay test, asserted under the R3-c
  // `host_in_use` reason explicitly. Two operators independently picking
  // the same hostIdentity with valid bootstrap (env-rotated by the second)
  // is the operator-collision case R3-G06 protects against.
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  const first = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(first.ok, true);
  // No time advance — first runner is freshly registered.
  const second = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "host_in_use");
});

test("R3-c-1: handshake collision — heartbeat-aged-but-still-fresh existing host → host_in_use", () => {
  // Existing entry was registered 10s ago + heartbeat 5s ago. Still
  // fresh (under heartbeatDropMs=30s). Second handshake on same
  // bootstrap → collision.
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  const first = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  clock += 10_000;
  reg.heartbeat({ hostIdentity: "host-1", runnerToken: first.runnerToken });
  clock += 5_000; // host-1 lastSeen is now 15_000, age=15s → fresh
  const second = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "host_in_use");
});

test("R3-c-1: handshake replay after stale → bootstrap_consumed (single-use preserved through staleness)", () => {
  // Stale-recovery via same bootstrap is intentionally rejected — the
  // operator must rotate the env value before the runner can rejoin.
  // This keeps single-use bootstrap semantics intact even for
  // long-silent runners. The reason is `bootstrap_consumed` (not
  // `host_in_use`) because the existing host is no longer "in use" —
  // it's just that the bootstrap itself has been consumed.
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  const first = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(first.ok, true);
  clock += 60_000; // host-1 stale (60s > 30s drop)
  const second = reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "bootstrap_consumed",
    "stale rejoin requires env rotation; same bootstrap is consumed");
});

test("R3-c-1: pruneStaleRunners affectedRuns reflects assignments at call time, not at registration time", () => {
  // Snapshot semantics: if a run is claimed AFTER the host went
  // stale, the next prune call includes it. (Unusual flow — the
  // orchestrator's selectFreshRunner skips stale hosts, so
  // claiming for a stale host is operator-driven only.)
  let clock = 1000;
  const reg = makeMultiHostReg({ now: () => clock, heartbeatDropMs: 30_000 });
  reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
  clock += 60_000;  // host-1 stale
  // Snapshot 1: no assignments yet.
  let stale = reg.pruneStaleRunners();
  assert.deepEqual(stale[0].affectedRuns, []);
  // Now claim a run for the stale host (e.g. operator override).
  reg.claimRunForRunner("rr-late", "host-1");
  // Snapshot 2: prune sees the new assignment.
  stale = reg.pruneStaleRunners();
  assert.deepEqual(stale[0].affectedRuns, ["rr-late"]);
});
