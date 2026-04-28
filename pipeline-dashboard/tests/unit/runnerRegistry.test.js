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

test("R1-d: handshake is single-use (replay rejected with bootstrap_consumed)", () => {
  const reg = makeReg();
  const first = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(first.ok, true);
  // Second attempt with same bootstrap is denied — even if the bootstrap
  // is correct, it's already been consumed for this orchestrator process.
  const second = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "bootstrap-aaa" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "bootstrap_consumed");
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

test("R1-d: default bootstrapTokenFor reads HARNESS_REMOTE_RUNNER_TOKEN_<sanitized>", () => {
  // Sanitization: "runner-a/3" → "runner_a_3"
  const old = process.env["HARNESS_REMOTE_RUNNER_TOKEN_runner_a_3"];
  process.env["HARNESS_REMOTE_RUNNER_TOKEN_runner_a_3"] = "env-bootstrap";
  try {
    const reg = new RunnerRegistry();   // default constructor → env path
    const r = reg.handshake({ hostIdentity: "runner-a/3", bootstrapToken: "env-bootstrap" });
    assert.equal(r.ok, true);
  } finally {
    if (old === undefined) delete process.env["HARNESS_REMOTE_RUNNER_TOKEN_runner_a_3"];
    else process.env["HARNESS_REMOTE_RUNNER_TOKEN_runner_a_3"] = old;
  }
});
