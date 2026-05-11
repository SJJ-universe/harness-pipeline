// UX-POLISH-1 (2026-05-11) — selectIterationSummary +
// selectProgressMilestones unit tests.
//
// Pure selector tests: snapshot shape in, structured object out. No
// store, no DOM. Covers the contract the findings drawer + chat panel
// consume to render the new iteration section + progress bubbles.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../../public/js/monitor/product-shell-data");

// ── Helper: build a minimal snapshot shape ───────────────────────

function makeSnap({ runId = "r1", findings = [], history = [], runState = "awaiting_critique",
                    runStatus = "active", phases = [], completedAt = null,
                    metrics = null, errorMessage = null, events = [] } = {}) {
  const runDetails = new Map();
  runDetails.set(runId, {
    findings: findings,
    run: {
      id: runId,
      status: runStatus,
      phases: phases,
      completedAt: completedAt,
      metrics: metrics,
      errorMessage: errorMessage,
    },
  });
  const reviewSessions = new Map();
  reviewSessions.set("s1", {
    sessionId: "s1",
    runId: runId,
    state: runState,
    history: history,
    lastActivityAt: history.length > 0 ? history[history.length - 1].at : "2026-05-11T10:00:00Z",
  });
  return {
    runs: new Map([[runId, { id: runId, status: runStatus }]]),
    runDetails: runDetails,
    reviewSessions: reviewSessions,
    events: events,
    selectedRunId: runId,
  };
}

// ── selectIterationSummary ───────────────────────────────────────

test("UX-POLISH-1 selectIterationSummary: null when no findings + no history", () => {
  const snap = makeSnap({ findings: [], history: [], runState: "created" });
  assert.equal(data.selectIterationSummary(snap, "r1"), null);
});

test("UX-POLISH-1 selectIterationSummary: counts codex turns as iterations", () => {
  const snap = makeSnap({
    history: [
      { actor: "claude", at: "2026-05-11T10:00:00Z", text: "plan" },
      { actor: "codex",  at: "2026-05-11T10:00:10Z", text: "critique 1" },
      { actor: "claude", at: "2026-05-11T10:00:20Z", text: "revise" },
      { actor: "codex",  at: "2026-05-11T10:00:35Z", text: "critique 2" },
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.iterations, 2, "exactly 2 codex turns → 2 iterations");
});

test("UX-POLISH-1 selectIterationSummary: groups drivers by severity with sample message", () => {
  const snap = makeSnap({
    findings: [
      { severity: "critical", message: "null ref in foo.js" },
      { severity: "high",     message: "unused import" },
      { severity: "high",     message: "another high" },
      { severity: "medium",   message: "minor" },
    ],
    history: [{ actor: "codex", at: "2026-05-11T10:00:10Z", text: "critique" }],
  });
  const s = data.selectIterationSummary(snap, "r1");
  // Severity order: critical, high, medium, low, note
  assert.equal(s.drivers.length, 3);
  assert.equal(s.drivers[0].severity, "critical");
  assert.equal(s.drivers[0].count, 1);
  assert.match(s.drivers[0].sampleMessage, /null ref/);
  assert.equal(s.drivers[1].severity, "high");
  assert.equal(s.drivers[1].count, 2);
  assert.equal(s.drivers[1].sampleMessage, "unused import");
  assert.equal(s.drivers[2].severity, "medium");
});

test("UX-POLISH-1 selectIterationSummary: timeline derives duration from consecutive codex turns", () => {
  const snap = makeSnap({
    history: [
      { actor: "codex", at: "2026-05-11T10:00:00Z", text: "c1" },
      { actor: "codex", at: "2026-05-11T10:00:12Z", text: "c2" },
      { actor: "codex", at: "2026-05-11T10:00:35Z", text: "c3" },
    ],
    runState: "archived",
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.timeline.length, 3);
  assert.equal(s.timeline[0].n, 1);
  assert.equal(s.timeline[0].durationMs, 12000);
  assert.equal(s.timeline[1].durationMs, 23000);
  // Last turn with no follow-up + session archived → status done (no
  // duration data available).
  assert.equal(s.timeline[2].status, "done");
  assert.equal(s.timeline[2].durationMs, null);
});

test("UX-POLISH-1 selectIterationSummary: active session marks last iteration as 'active'", () => {
  const snap = makeSnap({
    history: [{ actor: "codex", at: "2026-05-11T10:00:00Z" }],
    runState: "awaiting_critique",  // session still live
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.timeline[0].status, "active");
});

// ── selectProgressMilestones ─────────────────────────────────────

test("UX-POLISH-1 selectProgressMilestones: empty snap → empty array", () => {
  assert.deepEqual(data.selectProgressMilestones(null, "r1", 0), []);
  assert.deepEqual(data.selectProgressMilestones({}, "r1", 0), []);
});

test("UX-POLISH-1 selectProgressMilestones: phase_enter milestones from run.phases", () => {
  const snap = makeSnap({
    phases: [
      { id: "B", label: "PLAN",     activatedAt: "2026-05-11T10:00:00Z" },
      { id: "C", label: "CRITIQUE", activatedAt: "2026-05-11T10:00:15Z" },
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const phases = ms.filter(function (m) { return m.kind === "phase_enter"; });
  assert.equal(phases.length, 2);
  assert.equal(phases[0].params.phase, "PLAN");
  assert.equal(phases[1].params.phase, "CRITIQUE");
  // Stable IDs allow dedupe.
  assert.equal(phases[0].id, "phase:r1:B");
  assert.equal(phases[1].id, "phase:r1:C");
});

test("UX-POLISH-1 selectProgressMilestones: iteration_done emitted per codex turn", () => {
  const snap = makeSnap({
    history: [
      { actor: "codex", at: "2026-05-11T10:00:10Z", severityCounts: { critical: 0, high: 1 } },
      { actor: "codex", at: "2026-05-11T10:00:30Z", severityCounts: { critical: 1, high: 2 } },
    ],
    runState: "archived",
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const dones = ms.filter(function (m) { return m.kind === "iteration_done"; });
  assert.equal(dones.length, 2);
  assert.equal(dones[0].params.n, 1);
  assert.equal(dones[0].params.c, 0);
  assert.equal(dones[0].params.h, 1);
  assert.equal(dones[1].params.n, 2);
  assert.equal(dones[1].params.c, 1);
  assert.equal(dones[1].params.h, 2);
});

test("UX-POLISH-1 selectProgressMilestones: sinceTs filters out older milestones", () => {
  const snap = makeSnap({
    history: [
      { actor: "codex", at: "2026-05-11T10:00:10Z" },
      { actor: "codex", at: "2026-05-11T10:00:30Z" },
    ],
  });
  const cutoff = Date.parse("2026-05-11T10:00:20Z");
  const ms = data.selectProgressMilestones(snap, "r1", cutoff);
  const dones = ms.filter(function (m) { return m.kind === "iteration_done"; });
  // Only the second codex turn is newer than cutoff.
  assert.equal(dones.length, 1);
  assert.equal(dones[0].params.n, 2,
    "iteration number still derived from full history walk, not sinceTs slice");
});

test("UX-POLISH-1 selectProgressMilestones: pipeline_complete when run.completedAt set", () => {
  const snap = makeSnap({
    runStatus: "completed",
    completedAt: "2026-05-11T10:05:00Z",
    metrics: { elapsedMs: 47500 },
    history: [{ actor: "codex", at: "2026-05-11T10:00:10Z" }],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const complete = ms.filter(function (m) { return m.kind === "pipeline_complete"; });
  assert.equal(complete.length, 1);
  assert.equal(complete[0].params.iters, 1);
  assert.equal(complete[0].params.sec, 47.5);
});

test("UX-POLISH-1 selectProgressMilestones: pipeline_error on failed runs", () => {
  const snap = makeSnap({
    runStatus: "failed",
    completedAt: "2026-05-11T10:01:00Z",
    errorMessage: "codex unreachable",
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const errors = ms.filter(function (m) { return m.kind === "pipeline_error"; });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].params.msg, "codex unreachable");
});

test("UX-POLISH-1 selectProgressMilestones: results are sorted by timestamp ascending", () => {
  const snap = makeSnap({
    phases: [{ id: "C", label: "CRITIQUE", activatedAt: "2026-05-11T10:00:05Z" }],
    history: [
      { actor: "codex", at: "2026-05-11T10:00:30Z" },
      { actor: "codex", at: "2026-05-11T10:00:15Z" },
    ],
    runStatus: "completed",
    completedAt: "2026-05-11T10:00:45Z",
    metrics: { elapsedMs: 45000 },
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  for (let i = 1; i < ms.length; i += 1) {
    assert.ok(ms[i].ts >= ms[i - 1].ts,
      "milestone " + i + " ts " + ms[i].ts + " >= prev ts " + ms[i - 1].ts);
  }
});
