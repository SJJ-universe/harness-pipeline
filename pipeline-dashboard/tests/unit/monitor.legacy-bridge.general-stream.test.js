// PRODUCT-LIVE-STREAM-0 (2026-05-07) — emergency projection bridge tests.
//
// Verifies the legacy-bridge changes that wire general-task pipeline
// events into:
//   1. run.phaseIdx via phase letter → MOCK_STAGES idx mapping (Gap A)
//   2. synthetic review session `general:<runId>` for dual-terminals
//      live output (Gap B)
//   3. pipeline_complete error detection via errors.length > 0 (Gap D)
//   4. pipeline_start phaseIdx 0 seed when phase field absent (Gap E)
//   5. Phase B/D active → Claude terminal status line (Gap F)
//   6. synthetic session source/streamOnly tags (Gap G)
//   7. codex_progress source gate — only general-pipeline (Gap H)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/monitor/legacy-bridge");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");
const dispatcher = require("../../public/js/event-dispatcher");

function makeBridge(store) {
  dispatcher._resetForTests();
  return install({
    store, normalize, dispatcher,
    fetchImpl: null,
    setIntervalFn: () => null,
  });
}

// ── Gap A: phase letter → phaseIdx mapping ────────────────────────────

test("PLS-0: phase_update {phase:'A'} → run.phaseIdx === 0", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R", template: "default" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "A", status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 0);
});

test("PLS-0: phase_update {phase:'B'} → phaseIdx 0 (PLAN)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "B", status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 0);
});

test("PLS-0: phase_update {phase:'C'} → phaseIdx 1 (CRITIQUE)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "C", status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 1);
});

test("PLS-0: phase_update {phase:'D'} → phaseIdx 2 (REVISE)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "D", status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 2);
});

test("PLS-0: explicit phaseIdx wins over phase letter mapping", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "B", phaseIdx: 5, status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 5);
});

test("PLS-0: phase_update with unknown letter → phaseIdx unchanged", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "B", status: "active" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 0);
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "ZZZ", status: "active" },
  });
  // Unknown letter → fallback returns null → phaseIdx stays at last valid value.
  assert.equal(store.snapshot().runs.R.phaseIdx, 0);
});

// ── Gap E: pipeline_start phaseIdx seed ───────────────────────────────

test("PLS-0 Gap E: pipeline_start without phase → phaseIdx 0 seed", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "pipeline_start",
    data: { runId: "R", template: "default" /* no phase, no phaseIdx */ },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 0);
});

test("PLS-0 Gap E: pipeline_start with phase 'C' → phaseIdx 1", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "pipeline_start",
    data: { runId: "R", phase: "C" },
  });
  assert.equal(store.snapshot().runs.R.phaseIdx, 1);
});

// ── Gap D: pipeline_complete error detection ──────────────────────────

test("PLS-0 Gap D: pipeline_complete with errors:[] → completed + phaseIdx 6", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "R", errors: [], at: 999 },
  });
  const r = store.snapshot().runs.R;
  assert.equal(r.status, "completed");
  assert.equal(r.phaseIdx, 6);
  assert.equal(r.completedAt, 999);
});

test("PLS-0 Gap D: pipeline_complete with non-empty errors → status:error", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "R", errors: [{ phase: "general", message: "boom" }] },
  });
  const r = store.snapshot().runs.R;
  assert.equal(r.status, "error");
  // phaseIdx should NOT have been bumped to 6 on failure.
  assert.notEqual(r.phaseIdx, 6);
});

test("PLS-0 Gap D: pipeline_complete with failed:true → status:error", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "R", failed: true },
  });
  assert.equal(store.snapshot().runs.R.status, "error");
});

// ── Gap B + G + H: synthetic session for general-task ──────────────────

test("PLS-0 Gap B: codex_progress (general-pipeline) → reviewStreams['general:R'].codex.length === 1", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "hello\n", elapsedMs: 10 },
  });
  const snap = store.snapshot();
  const streams = snap.reviewStreams["general:R"];
  assert.ok(streams, "synthetic session stream should exist");
  assert.equal(streams.codex.length, 1);
  assert.equal(streams.codex[0].chunk, "hello\n");
});

test("PLS-0 Gap H: codex_progress without source → no synthetic stream", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", stdout: "x" /* no source */ },
  });
  const snap = store.snapshot();
  assert.equal(Object.prototype.hasOwnProperty.call(snap.reviewStreams, "general:R"), false);
});

test("PLS-0 Gap H: codex_progress with source:'review-session' → no synthetic stream", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "review-session", stdout: "x" },
  });
  const snap = store.snapshot();
  assert.equal(Object.prototype.hasOwnProperty.call(snap.reviewStreams, "general:R"), false);
});

test("PLS-0 Gap G: synthetic session has source:'general' + streamOnly:true", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "x" },
  });
  const session = store.snapshot().reviewSessions.find(function (s) { return s.sessionId === "general:R"; });
  assert.ok(session);
  assert.equal(session.source, "general");
  assert.equal(session.streamOnly, true);
  assert.equal(session.runId, "R");
});

test("PLS-0: codex_progress with empty stdout/stderr → no chunk appended", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "", stderr: "" },
  });
  const snap = store.snapshot();
  // Session may be upserted but no chunk
  const streams = snap.reviewStreams["general:R"];
  if (streams) assert.equal(streams.codex.length, 0);
});

test("PLS-0: codex_progress with stderr fallback → captured", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "", stderr: "warn line" },
  });
  const streams = store.snapshot().reviewStreams["general:R"];
  assert.equal(streams.codex.length, 1);
  assert.equal(streams.codex[0].chunk, "warn line");
});

// ── Gap F: phase_update Claude status lines ────────────────────────────

test("PLS-0 Gap F: phase_update {B, active} → Claude side gets status line", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "B", status: "active" },
  });
  const streams = store.snapshot().reviewStreams["general:R"];
  assert.ok(streams);
  assert.equal(streams.claude.length, 1);
  assert.match(streams.claude[0].chunk, /Claude 계획 생성 중/);
});

test("PLS-0 Gap F: phase_update {D, active} → 'Claude 수정 중...' status line", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "D", status: "active" },
  });
  const streams = store.snapshot().reviewStreams["general:R"];
  assert.equal(streams.claude.length, 1);
  assert.match(streams.claude[0].chunk, /Claude 수정 중/);
});

test("PLS-0 Gap F: phase_update {B, completed} → no Claude chunk (status gate)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "B", status: "completed" },
  });
  const snap = store.snapshot();
  const streams = snap.reviewStreams["general:R"];
  if (streams) assert.equal(streams.claude.length, 0);
});

test("PLS-0 Gap F: phase_update {C, active} → no Claude chunk (Codex phase)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "R", phase: "C", status: "active" },
  });
  const snap = store.snapshot();
  const streams = snap.reviewStreams["general:R"];
  if (streams) assert.equal(streams.claude.length, 0);
});

// ── log_message + general_plan_complete ───────────────────────────────

test("PLS-0: log_message {runId, message} → claude side chunk", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "log_message",
    data: { runId: "R", message: "[B] planner done (3084 chars)" },
  });
  const streams = store.snapshot().reviewStreams["general:R"];
  assert.equal(streams.claude.length, 1);
  assert.equal(streams.claude[0].chunk, "[B] planner done (3084 chars)");
});

test("PLS-0: general_plan_complete {finalPlan} → claude tail + session 'completed'", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "general_plan_complete",
    data: {
      runId: "R", verdict: "CLEAN", iterations: 1,
      finalPlan: "FULL PLAN BODY HERE",
      lastCritique: { summary: "no concerns" },
    },
  });
  const snap = store.snapshot();
  const streams = snap.reviewStreams["general:R"];
  assert.ok(streams.claude.length >= 1);
  assert.match(streams.claude[streams.claude.length - 1].chunk, /최종 plan/);
  assert.ok(streams.codex.length >= 1);
  assert.match(streams.codex[streams.codex.length - 1].chunk, /비평 요약/);
  const session = snap.reviewSessions.find(function (s) { return s.sessionId === "general:R"; });
  assert.equal(session.state, "completed");
});

test("PLS-0: general_plan_complete with finalPlan > 4KB → tail-only", () => {
  const store = createMonitorStore();
  makeBridge(store);
  const big = "A".repeat(5000);
  dispatcher.notifyTaps({
    type: "general_plan_complete",
    data: { runId: "R", finalPlan: big },
  });
  const streams = store.snapshot().reviewStreams["general:R"];
  const last = streams.claude[streams.claude.length - 1].chunk;
  // tail starts with "...\n" prefix when truncated
  assert.match(last, /\.\.\.\n/);
  // total chunk length is bounded — header ("[최종 plan]\n...\n") + 4000 chars.
  assert.ok(last.length < 4100, "should be truncated to ~4KB tail");
});

// ── defensive: missing runId ──────────────────────────────────────────

test("PLS-0: codex_progress without runId → no-op (no crash, no synthetic session)", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { source: "general-pipeline", stdout: "x" /* no runId */ },
  });
  assert.equal(store.snapshot().reviewSessions.length, 0);
});

test("PLS-0: log_message without runId → no-op", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "log_message",
    data: { message: "x" },
  });
  assert.equal(store.snapshot().reviewSessions.length, 0);
});

// ── stats counter ─────────────────────────────────────────────────────

test("PLS-0: bridge.stats().generalStreamSyncs increments per general-pipeline event", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  assert.equal(handle.stats().generalStreamSyncs, 0);
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "x" },
  });
  assert.equal(handle.stats().generalStreamSyncs, 1);
  dispatcher.notifyTaps({
    type: "log_message",
    data: { runId: "R", message: "y" },
  });
  assert.equal(handle.stats().generalStreamSyncs, 2);
});

// ── test hook exposure ────────────────────────────────────────────────

test("PLS-0: _syncGeneralStreamFromEvent exposed on install() return", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  assert.equal(typeof handle._syncGeneralStreamFromEvent, "function");
});

// ── doesn't swallow events ─────────────────────────────────────────────

test("PLS-0: codex_progress synthetic-side-effect does not block run sync", () => {
  // The helper returns false unconditionally — both the synthetic
  // stream side-effect AND the existing _syncRunFromEvent / events-ring
  // path should fire for the same event.
  const store = createMonitorStore();
  const handle = makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { runId: "R" } });
  const beforeSyncs = handle.stats().runSyncs;
  // codex_progress is not a lifecycle type so runSyncs shouldn't move,
  // but eventsForwarded should (it lands in the events ring).
  const beforeEvents = handle.stats().eventsForwarded;
  dispatcher.notifyTaps({
    type: "codex_progress",
    data: { runId: "R", source: "general-pipeline", stdout: "x" },
  });
  // generalStreamSyncs went up
  assert.equal(handle.stats().generalStreamSyncs, 1);
  // eventsForwarded should also increment (helper returned false, so
  // _onLegacyEvent continues into normalize + pushEvent).
  assert.ok(handle.stats().eventsForwarded > beforeEvents,
    "events ring should still receive codex_progress");
  // Run summary was not affected (not a lifecycle event).
  assert.equal(handle.stats().runSyncs, beforeSyncs);
});
