// Slice UI-H2 (Phase D / Phase E1.5, 2026-04-30) — horse state machine tests.
//
// computeHorseState is a pure function over (phase, approvalPending,
// verifyResult, reducedMotion). These tests pin every transition.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const HorseSM = require("../../public/js/monitor/horse-state-machine");
const { LANES, STATES, PHASE_TO_LANE, laneIdxForPhase, computeHorseState } = HorseSM;

// ── Constants ──────────────────────────────────────────────────────

test("UI-H2: LANES is exactly 7 entries in canonical order", () => {
  assert.equal(LANES.length, 7);
  const ids = LANES.map((l) => l.id);
  assert.deepEqual(ids, [
    "plan", "critique", "revise", "recheck",
    "execute", "verify", "done",
  ]);
});

test("UI-H2: every LANE has Korean + English labels", () => {
  for (const lane of LANES) {
    assert.equal(typeof lane.ko, "string");
    assert.equal(typeof lane.en, "string");
    assert.ok(lane.ko.length > 0);
    assert.ok(lane.en.length > 0);
  }
});

test("UI-H2: STATES exposes 4 frozen state names", () => {
  assert.equal(STATES.WAITING, "waiting");
  assert.equal(STATES.RUNNING, "running");
  assert.equal(STATES.REARING, "rearing");
  assert.equal(STATES.IDLE, "idle");
  assert.ok(Object.isFrozen(STATES));
});

// ── laneIdxForPhase ───────────────────────────────────────────────

test("UI-H2: laneIdxForPhase maps every canonical phase id", () => {
  for (let i = 0; i < LANES.length; i += 1) {
    assert.equal(laneIdxForPhase(LANES[i].id), i,
      `${LANES[i].id} should map to lane ${i}`);
  }
});

test("UI-H2: laneIdxForPhase honors aliases", () => {
  // Plan family
  assert.equal(laneIdxForPhase("planning"), 0);
  // Critique family
  assert.equal(laneIdxForPhase("critic"), 1);
  // Revise family
  assert.equal(laneIdxForPhase("revision"), 2);
  // Re-check family
  assert.equal(laneIdxForPhase("re-check"), 3);
  assert.equal(laneIdxForPhase("re-critique"), 3);
  assert.equal(laneIdxForPhase("recritique"), 3);
  // Execute family
  assert.equal(laneIdxForPhase("execution"), 4);
  // Verify family
  assert.equal(laneIdxForPhase("verification"), 5);
  // Done family
  assert.equal(laneIdxForPhase("finalize"), 6);
  assert.equal(laneIdxForPhase("sealed"), 6);
  assert.equal(laneIdxForPhase("complete"), 6);
});

test("UI-H2: laneIdxForPhase is case-insensitive + trims", () => {
  assert.equal(laneIdxForPhase("Plan"), 0);
  assert.equal(laneIdxForPhase("  PLAN  "), 0);
  assert.equal(laneIdxForPhase("Critique"), 1);
});

test("UI-H2: laneIdxForPhase returns -1 for unknown / garbage input", () => {
  for (const v of [null, undefined, "", "garbage", "step1", 0, true, {}]) {
    assert.equal(laneIdxForPhase(v), -1, `${String(v)} should yield -1`);
  }
});

// ── computeHorseState — happy paths ────────────────────────────────

test("UI-H2: computeHorseState — running through every phase, no gates", () => {
  for (let i = 0; i < LANES.length - 1; i += 1) {  // skip "done" (idle)
    const r = computeHorseState({ phase: LANES[i].id });
    assert.equal(r.laneIdx, i);
    assert.equal(r.laneName, LANES[i].ko);
    assert.equal(r.displayState, "running");
    assert.equal(r.gate, null);
  }
});

test("UI-H2: computeHorseState — done lane is idle (horse stands at finish)", () => {
  const r = computeHorseState({ phase: "done" });
  assert.equal(r.laneIdx, 6);
  assert.equal(r.displayState, "idle");
  assert.equal(r.gate, null);
});

test("UI-H2: computeHorseState — unknown phase → waiting state", () => {
  for (const phase of [null, undefined, "", "wat", "step99"]) {
    const r = computeHorseState({ phase });
    assert.equal(r.laneIdx, -1);
    assert.equal(r.laneName, "대기 중");
    assert.equal(r.displayState, "waiting");
    assert.equal(r.gate, null);
  }
});

// ── computeHorseState — approval gate (rearing) ────────────────────

test("UI-H2: approvalPending=true at Execute → rearing + gate='approval'", () => {
  const r = computeHorseState({
    phase: "execute",
    approvalPending: true,
  });
  assert.equal(r.laneIdx, 4);
  assert.equal(r.displayState, "rearing");
  assert.equal(r.gate, "approval");
});

test("UI-H2: approvalPending=true at any lane (not just Execute) → rearing", () => {
  // Approval gate fires whenever there's a pending approval, regardless
  // of phase. Per spec: operator sees "horse paused, awaiting your
  // decision" no matter where in the pipeline the request originated.
  for (let i = 0; i < 6; i += 1) {  // skip done lane (which is idle)
    const r = computeHorseState({
      phase: LANES[i].id,
      approvalPending: true,
    });
    assert.equal(r.gate, "approval");
    assert.equal(r.displayState, "rearing");
  }
});

test("UI-H2: approvalPending=true with reducedMotion → idle (no rear animation)", () => {
  const r = computeHorseState({
    phase: "execute",
    approvalPending: true,
    reducedMotion: true,
  });
  assert.equal(r.displayState, "idle",
    "reducedMotion freezes animation but gate flag stays");
  assert.equal(r.gate, "approval");
});

// ── computeHorseState — verify gate ───────────────────────────────

test("UI-H2: verifyResult='fail' at Verify lane → rearing + gate='verify'", () => {
  const r = computeHorseState({
    phase: "verify",
    verifyResult: "fail",
  });
  assert.equal(r.laneIdx, 5);
  assert.equal(r.displayState, "rearing");
  assert.equal(r.gate, "verify");
});

test("UI-H2: verifyResult='pass' at Verify lane → running (no rear)", () => {
  const r = computeHorseState({
    phase: "verify",
    verifyResult: "pass",
  });
  assert.equal(r.displayState, "running");
  assert.equal(r.gate, null);
});

test("UI-H2: verifyResult='fail' at NON-verify lane → no gate (gate is lane-bound)", () => {
  const r = computeHorseState({
    phase: "execute",  // not verify
    verifyResult: "fail",
  });
  assert.equal(r.gate, null,
    "verify gate fires only at lane 5; an upstream verifyResult is metadata");
  assert.equal(r.displayState, "running");
});

test("UI-H2: garbage verifyResult is ignored", () => {
  const r = computeHorseState({
    phase: "verify",
    verifyResult: "wat",
  });
  assert.equal(r.displayState, "running");
  assert.equal(r.gate, null);
});

// ── computeHorseState — gate priority ─────────────────────────────

test("UI-H2: approval gate beats verify gate (approval is operator-blocking)", () => {
  // Both signals true at lane 5 (an approval AND a verify-fail).
  // Approval should win — it's the most actionable for the operator.
  const r = computeHorseState({
    phase: "verify",
    approvalPending: true,
    verifyResult: "fail",
  });
  assert.equal(r.gate, "approval");
  assert.equal(r.displayState, "rearing");
});

// ── computeHorseState — reduced motion ────────────────────────────

test("UI-H2: reducedMotion=true freezes every state to idle (no rearing/running)", () => {
  for (let i = 0; i < LANES.length; i += 1) {
    const r = computeHorseState({
      phase: LANES[i].id,
      reducedMotion: true,
    });
    assert.equal(r.displayState, "idle",
      `lane ${i} (${LANES[i].id}) should be idle with reducedMotion`);
  }
});

test("UI-H2: reducedMotion + unknown phase still yields waiting (sentinel state)", () => {
  const r = computeHorseState({ phase: "wat", reducedMotion: true });
  assert.equal(r.displayState, "waiting",
    "reducedMotion doesn't promote unknown to a real state");
});

// ── Defensive ─────────────────────────────────────────────────────

test("UI-H2: computeHorseState accepts no input (returns waiting)", () => {
  const r = computeHorseState();
  assert.equal(r.laneIdx, -1);
  assert.equal(r.displayState, "waiting");
});

test("UI-H2: computeHorseState ignores garbage input fields", () => {
  // approvalPending non-boolean → coerced to false
  // verifyResult non-string → null
  // reducedMotion non-boolean → false
  const r = computeHorseState({
    phase: "plan",
    approvalPending: 1,         // truthy non-bool
    verifyResult: 123,
    reducedMotion: "yes",
  });
  assert.equal(r.laneIdx, 0);
  assert.equal(r.gate, "approval", "1 is truthy → approvalPending=true");
  assert.equal(r.displayState, "idle", "'yes' is truthy → reducedMotion=true");
});

test("UI-H2: computeHorseState returns frozen object (no caller mutation)", () => {
  const r = computeHorseState({ phase: "plan" });
  assert.ok(Object.isFrozen(r));
});

// ── PHASE_TO_LANE coverage ────────────────────────────────────────

test("UI-H2: every lane id has at least one PHASE_TO_LANE entry", () => {
  const inversed = new Map();
  for (const [phase, idx] of Object.entries(PHASE_TO_LANE)) {
    if (!inversed.has(idx)) inversed.set(idx, []);
    inversed.get(idx).push(phase);
  }
  for (let i = 0; i < LANES.length; i += 1) {
    assert.ok(inversed.has(i), `lane ${i} (${LANES[i].id}) has no phase mappings`);
  }
});

test("UI-H2: PHASE_TO_LANE is frozen (no runtime mutation)", () => {
  assert.ok(Object.isFrozen(PHASE_TO_LANE));
});
