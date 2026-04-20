// Slice F (v5) — PipelineState per-phase analytics (attempts[] model).
//
// Locks the invariant that cycle re-entries keep FULL history in attempts[]
// instead of overwriting, and that every exit path correctly closes the
// latest attempt. Also covers gate counter bookkeeping and the snapshot
// shape the UI's analytics panel consumes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PipelineState } = require("../../executor/pipeline-state");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("openPhaseAttempt pushes a fresh open attempt with zeroed counters", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");

  const attempts = s.phaseAttempts("A");
  assert.equal(attempts.length, 1);
  assert.ok(attempts[0].enteredAt > 0);
  assert.equal(attempts[0].exitedAt, null);
  assert.equal(attempts[0].durationMs, null);
  assert.equal(attempts[0].gatePass, null);
  assert.equal(attempts[0].reason, null);
  assert.equal(s.phases.A.gateAttempts, 0);
  assert.equal(s.phases.A.gateFailures, 0);
});

test("markPhaseExit closes the latest attempt, stamps gatePass + reason", async () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  await sleep(5);
  s.markPhaseExit("A", { gatePass: true, reason: "advance" });

  const a = s.phaseAttempts("A")[0];
  assert.ok(a.exitedAt >= a.enteredAt);
  assert.ok(a.durationMs >= 4, `durationMs=${a.durationMs} should be ≥4`);
  assert.equal(a.gatePass, true);
  assert.equal(a.reason, "advance");
});

test("markPhaseExit is idempotent — second call is a no-op", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.markPhaseExit("A", { gatePass: true, reason: "first" });
  const firstExit = s.phaseAttempts("A")[0].exitedAt;

  s.markPhaseExit("A", { gatePass: false, reason: "OVERWRITE" });
  const a = s.phaseAttempts("A")[0];
  assert.equal(a.exitedAt, firstExit);
  assert.equal(a.gatePass, true);
  assert.equal(a.reason, "first");
});

test("openPhaseAttempt defensively closes a still-open prior attempt", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  // Simulate a re-entry that skipped an explicit close (would be a bug in
  // the executor, but we want to keep the state consistent regardless).
  s.openPhaseAttempt("A");

  const attempts = s.phaseAttempts("A");
  assert.equal(attempts.length, 2);
  assert.ok(attempts[0].exitedAt !== null, "first attempt must be auto-closed");
  assert.equal(attempts[0].reason, "reenter-unclosed");
  assert.equal(attempts[0].gatePass, false);
  assert.equal(attempts[1].exitedAt, null);
});

test("markGateAttempt increments counters; failures only on pass=false", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.markGateAttempt("A", true);
  s.markGateAttempt("A", false);
  s.markGateAttempt("A", false);
  assert.equal(s.phases.A.gateAttempts, 3);
  assert.equal(s.phases.A.gateFailures, 2);
});

test("phaseTotalDurationMs sums ALL closed attempts (cycle history preserved)", async () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  await sleep(10);
  s.markPhaseExit("A", { gatePass: false, reason: "cycle-reenter-findings" });
  s.openPhaseAttempt("A");
  await sleep(20);
  s.markPhaseExit("A", { gatePass: true, reason: "advance" });

  const total = s.phaseTotalDurationMs("A");
  const latest = s.phaseLatestDurationMs("A");
  assert.ok(total >= 28, `total=${total}`);
  assert.ok(latest >= 18, `latest=${latest}`);
  assert.ok(latest < total, "latest must be strictly less than total across ≥2 attempts");
});

test("phaseLatestDurationMs returns 0 for a still-open latest attempt", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  // attempt is open → durationMs null → 0
  assert.equal(s.phaseLatestDurationMs("A"), 0);
});

test("snapshot().phases[id] exposes attempts[], total/latest, gate counters", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.markGateAttempt("A", false);
  s.markPhaseExit("A", { gatePass: false, reason: "cycle-reenter-findings" });
  s.openPhaseAttempt("A");
  s.markGateAttempt("A", true);
  s.markPhaseExit("A", { gatePass: true, reason: "advance" });

  const snap = s.snapshot().phases.A;
  assert.equal(snap.attempts.length, 2);
  assert.equal(snap.attempts[0].reason, "cycle-reenter-findings");
  assert.equal(snap.attempts[1].reason, "advance");
  assert.equal(snap.gateAttempts, 2);
  assert.equal(snap.gateFailures, 1);
  assert.ok(snap.totalDurationMs >= 0);
  assert.ok(snap.latestDurationMs >= 0);
});

test("markPhaseExit / phaseAttempts on an unknown phase are silent", () => {
  const s = new PipelineState();
  assert.deepEqual(s.phaseAttempts("NOPE"), []);
  assert.equal(s.phaseTotalDurationMs("NOPE"), 0);
  assert.equal(s.phaseLatestDurationMs("NOPE"), 0);
  // Must not throw
  s.markPhaseExit("NOPE", { gatePass: true, reason: "advance" });
});

test("reset() wipes all per-phase attempts and gate counters", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.markGateAttempt("A", false);
  s.reset({ userPrompt: "new run", templateId: "default" });
  assert.equal(Object.keys(s.phases).length, 0);
  assert.deepEqual(s.phaseAttempts("A"), []);
});

test("recordTool does not interfere with attempts[]", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.recordTool("A", "Bash", {}, { command: "ls" });
  s.markPhaseExit("A", { gatePass: true, reason: "advance" });
  const snap = s.snapshot().phases.A;
  assert.equal(snap.attempts.length, 1);
  assert.equal(snap.toolCount, 1);
});
