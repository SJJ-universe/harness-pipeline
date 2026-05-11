// UX-POLISH-1 + UX-POLISH-2 (2026-05-11) — selectIterationSummary +
// selectProgressMilestones unit tests.
//
// Both selectors are EVENT-BASED in their final form (UX-POLISH-2):
// they walk snap.events rather than session.history / run.phases.
// Production runs for general-task fire codex_started + critique_received
// + pipeline_complete events into the events ring buffer; the synthetic
// review session has empty `history`, so any selector that reaches into
// `history` returns nothing useful for live general-task runs.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../../public/js/monitor/product-shell-data");

// ── Helper: build a minimal event-shaped snapshot ────────────────

function ev(type, dataPayload, ts) {
  return {
    type: type,
    ts: typeof ts === "string" ? Date.parse(ts) : (ts || Date.now()),
    runId: (dataPayload && dataPayload.runId) || null,
    data: dataPayload || {},
  };
}

function makeSnap({ runId = "r1", events = [], findings = [] } = {}) {
  const runDetails = new Map();
  runDetails.set(runId, {
    findings: findings,
    run: { id: runId, status: "active", phases: [], completedAt: null, metrics: null },
  });
  return {
    runs: new Map([[runId, { id: runId, status: "active" }]]),
    runDetails: runDetails,
    reviewSessions: new Map(),
    events: events,
    selectedRunId: runId,
  };
}

// ── selectIterationSummary ───────────────────────────────────────

test("UX-POLISH selectIterationSummary: null when no events + no findings", () => {
  const snap = makeSnap({});
  assert.equal(data.selectIterationSummary(snap, "r1"), null);
});

test("UX-POLISH selectIterationSummary: counts codex_started events as iterations", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",      { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received",  { runId: "r1", iteration: 0, ok: true },
                                                                "2026-05-11T10:00:15Z"),
      ev("codex_started",      { runId: "r1", iteration: 1 }, "2026-05-11T10:00:20Z"),
      ev("critique_received",  { runId: "r1", iteration: 1, ok: true },
                                                                "2026-05-11T10:00:38Z"),
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.iterations, 2);
});

test("UX-POLISH selectIterationSummary: timeline derives duration from start/done event pairs", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true },
                                                              "2026-05-11T10:00:12Z"),
      ev("codex_started",     { runId: "r1", iteration: 1 }, "2026-05-11T10:00:15Z"),
      ev("critique_received", { runId: "r1", iteration: 1, ok: true },
                                                              "2026-05-11T10:00:38Z"),
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.timeline.length, 2);
  assert.equal(s.timeline[0].durationMs, 12000);
  assert.equal(s.timeline[0].status, "done");
  assert.equal(s.timeline[1].durationMs, 23000);
});

test("UX-POLISH selectIterationSummary: unmatched codex_started → active iteration", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true },
                                                              "2026-05-11T10:00:12Z"),
      // 2nd start with no matching critique_received yet
      ev("codex_started",     { runId: "r1", iteration: 1 }, "2026-05-11T10:00:15Z"),
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.iterations, 2);
  assert.equal(s.timeline[1].status, "active");
});

test("UX-POLISH selectIterationSummary: drivers prefer findings from critique_received payload", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", {
        runId: "r1", iteration: 0, ok: false,
        findings: [
          { severity: "critical", message: "null ref in foo.js" },
          { severity: "high",     message: "unused import" },
        ],
      }, "2026-05-11T10:00:12Z"),
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  assert.equal(s.drivers.length, 2);
  assert.equal(s.drivers[0].severity, "critical");
  assert.match(s.drivers[0].sampleMessage, /null ref/);
});

test("UX-POLISH selectIterationSummary: drivers fall back to severityCounts when no findings", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("critique_received", {
        runId: "r1", ok: false,
        severityCounts: { critical: 1, high: 2, medium: 0, low: 0, note: 0 },
      }, "2026-05-11T10:00:12Z"),
    ],
  });
  const s = data.selectIterationSummary(snap, "r1");
  // Without per-finding messages we still surface bucket counts.
  const critRow = s.drivers.find(function (d) { return d.severity === "critical"; });
  const highRow = s.drivers.find(function (d) { return d.severity === "high"; });
  assert.equal(critRow.count, 1);
  assert.equal(highRow.count, 2);
});

// ── selectProgressMilestones ─────────────────────────────────────

test("UX-POLISH selectProgressMilestones: empty snap → empty array", () => {
  assert.deepEqual(data.selectProgressMilestones(null, "r1", 0), []);
  assert.deepEqual(data.selectProgressMilestones({}, "r1", 0), []);
});

test("UX-POLISH selectProgressMilestones: phase_update active → phase_enter (deduped per phase)", () => {
  const snap = makeSnap({
    events: [
      ev("phase_update", { runId: "r1", phase: "B", status: "active" },
                                                            "2026-05-11T10:00:00Z"),
      // duplicate phase_update for same phase should NOT add a 2nd milestone.
      ev("phase_update", { runId: "r1", phase: "B", status: "completed" },
                                                            "2026-05-11T10:00:05Z"),
      ev("phase_update", { runId: "r1", phase: "C", status: "active" },
                                                            "2026-05-11T10:00:08Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const phases = ms.filter(function (m) { return m.kind === "phase_enter"; });
  assert.equal(phases.length, 2, "B + C phase entries, no dup");
  assert.match(phases[0].params.phase, /^B \(PLAN\)$/);
  assert.match(phases[1].params.phase, /^C \(CRITIQUE\)$/);
});

test("UX-POLISH selectProgressMilestones: codex_started → iteration_start (1-indexed)", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started", { runId: "r1", iteration: 0, phase: "C" },
                                                            "2026-05-11T10:00:00Z"),
      ev("codex_started", { runId: "r1", iteration: 1, phase: "C" },
                                                            "2026-05-11T10:00:30Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const starts = ms.filter(function (m) { return m.kind === "iteration_start"; });
  assert.equal(starts.length, 2);
  assert.equal(starts[0].params.n, 1, "iteration 0 → 1번 (1-indexed for display)");
  assert.equal(starts[1].params.n, 2);
});

test("UX-POLISH selectProgressMilestones: critique_received ok=true → iteration_done", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", {
        runId: "r1", iteration: 0, ok: true,
        severityCounts: { critical: 0, high: 1 },
      }, "2026-05-11T10:00:15Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const done = ms.filter(function (m) { return m.kind === "iteration_done"; });
  assert.equal(done.length, 1);
  assert.equal(done[0].params.n, 1);
  assert.equal(done[0].params.c, 0);
  assert.equal(done[0].params.h, 1);
});

test("UX-POLISH selectProgressMilestones: critique_received ok=false → iteration_failed", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", {
        runId: "r1", iteration: 0, ok: false, error: "codex returned non-zero",
      }, "2026-05-11T10:00:15Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const failed = ms.filter(function (m) { return m.kind === "iteration_failed"; });
  assert.equal(failed.length, 1);
  assert.match(failed[0].params.msg, /codex/);
});

test("UX-POLISH selectProgressMilestones: error event → halt_error with phase + node + msg", () => {
  const snap = makeSnap({
    events: [
      ev("error", {
        runId: "r1", phase: "C", node: "plan-critic",
        message: "Codex flagged content for cybersecurity risk",
      }, "2026-05-11T10:00:10Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const halt = ms.filter(function (m) { return m.kind === "halt_error"; });
  assert.equal(halt.length, 1);
  assert.match(halt[0].params.phase, /^C \(CRITIQUE\)$/);
  assert.equal(halt[0].params.node, "plan-critic");
  assert.match(halt[0].params.msg, /cybersecurity risk/);
});

test("UX-POLISH selectProgressMilestones: pipeline_paused → pause", () => {
  const snap = makeSnap({
    events: [
      ev("pipeline_paused", { runId: "r1", reason: "operator paused" },
                                                            "2026-05-11T10:00:10Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const pause = ms.filter(function (m) { return m.kind === "pause"; });
  assert.equal(pause.length, 1);
  assert.equal(pause[0].params.reason, "operator paused");
});

test("UX-POLISH selectProgressMilestones: pipeline_complete failed → halt_failed with reason", () => {
  const snap = makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("codex_started",     { runId: "r1" }, "2026-05-11T10:00:05Z"),
      ev("pipeline_complete", { runId: "r1", failed: true, reason: "codex-critique-failed" },
                                                            "2026-05-11T10:00:30Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const halted = ms.filter(function (m) { return m.kind === "halt_failed"; });
  assert.equal(halted.length, 1);
  assert.equal(halted[0].params.reason, "codex-critique-failed");
  assert.equal(halted[0].params.sec, 30);
});

test("UX-POLISH selectProgressMilestones: pipeline_complete ok → pipeline_complete with iters+sec", () => {
  const snap = makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:05Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true },
                                                            "2026-05-11T10:00:15Z"),
      ev("codex_started",     { runId: "r1", iteration: 1 }, "2026-05-11T10:00:20Z"),
      ev("critique_received", { runId: "r1", iteration: 1, ok: true },
                                                            "2026-05-11T10:00:35Z"),
      ev("pipeline_complete", { runId: "r1", failed: false }, "2026-05-11T10:00:40Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const complete = ms.filter(function (m) { return m.kind === "pipeline_complete"; });
  assert.equal(complete.length, 1);
  assert.equal(complete[0].params.iters, 2);
  assert.equal(complete[0].params.sec, 40);
});

test("UX-POLISH selectProgressMilestones: tool_blocked → tool_blocked", () => {
  const snap = makeSnap({
    events: [
      ev("tool_blocked", {
        runId: "r1", tool: "Bash", reason: "denylist: rm -rf",
      }, "2026-05-11T10:00:10Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  const blocked = ms.filter(function (m) { return m.kind === "tool_blocked"; });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].params.tool, "Bash");
  assert.match(blocked[0].params.reason, /denylist/);
});

test("UX-POLISH selectProgressMilestones: sinceTs filters out older milestones", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started", { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("codex_started", { runId: "r1", iteration: 1 }, "2026-05-11T10:00:30Z"),
    ],
  });
  const cutoff = Date.parse("2026-05-11T10:00:20Z");
  const ms = data.selectProgressMilestones(snap, "r1", cutoff);
  // Iteration counter advances through all events (so the 2nd codex_started
  // is reported as 2번), but only the newer one is visible.
  const starts = ms.filter(function (m) { return m.kind === "iteration_start"; });
  assert.equal(starts.length, 1);
  assert.equal(starts[0].params.n, 2);
});

test("UX-POLISH selectProgressMilestones: results sorted by timestamp ascending", () => {
  const snap = makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("phase_update",      { runId: "r1", phase: "B", status: "active" },
                                                            "2026-05-11T10:00:01Z"),
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:05Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true },
                                                            "2026-05-11T10:00:15Z"),
      ev("pipeline_complete", { runId: "r1" }, "2026-05-11T10:00:20Z"),
    ],
  });
  const ms = data.selectProgressMilestones(snap, "r1", 0);
  for (let i = 1; i < ms.length; i += 1) {
    assert.ok(ms[i].ts >= ms[i - 1].ts);
  }
});

test("UX-POLISH selectProgressMilestones: filters events by runId", () => {
  const snap = makeSnap({
    events: [
      ev("codex_started", { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("codex_started", { runId: "r2" }, "2026-05-11T10:00:05Z"),
      ev("codex_started", { runId: "r1" }, "2026-05-11T10:00:10Z"),
    ],
  });
  const r1 = data.selectProgressMilestones(snap, "r1", 0);
  assert.equal(r1.filter(function (m) { return m.kind === "iteration_start"; }).length, 2);
  const r2 = data.selectProgressMilestones(snap, "r2", 0);
  assert.equal(r2.filter(function (m) { return m.kind === "iteration_start"; }).length, 1);
});
