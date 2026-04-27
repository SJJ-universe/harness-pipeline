// Slice MB4-b (Phase D Round 2, 2026-04-27) — generalPipelineRunner tests.
//
// Behaviour-preserving lift coverage. We don't re-test every Phase B/C/D
// branch (the legacy /api/pipeline/general integration test catches those).
// We DO test the public surface + critical structure to lock the lift:
//   - factory validates inputs
//   - prompt builders produce the expected scaffolds
//   - finalizeGeneralRun computes verdict + broadcasts the right pair of
//     events, regardless of which finalize path triggered
//   - runGeneralPipeline emits the canonical Phase A→B sequence and stops
//     when claudeRunner reports failure (smallest end-to-end smoke).

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGeneralPipelineRunner } = require("../../src/server/generalPipelineRunner");

function makeBroadcastSink() {
  const events = [];
  const fn = (e) => events.push(e);
  fn.events = events;
  fn.byType = (t) => events.filter((e) => e.type === t);
  return fn;
}

function stubExecutor(impls = {}) {
  return {
    exec: impls.exec || (async () => ({ ok: true, text: "stub plan", exitCode: 0 })),
  };
}

// ── input validation ────────────────────────────────────────────────

test("createGeneralPipelineRunner throws when broadcast is not a function", () => {
  assert.throws(() => createGeneralPipelineRunner({
    broadcast: null,
    claudeRunner: stubExecutor(),
    codexRunner: stubExecutor(),
  }), /broadcast must be a function/);
});

test("createGeneralPipelineRunner throws when claudeRunner.exec missing", () => {
  assert.throws(() => createGeneralPipelineRunner({
    broadcast: () => {},
    claudeRunner: {},
    codexRunner: stubExecutor(),
  }), /claudeRunner\.exec required/);
});

test("createGeneralPipelineRunner throws when codexRunner.exec missing", () => {
  assert.throws(() => createGeneralPipelineRunner({
    broadcast: () => {},
    claudeRunner: stubExecutor(),
    codexRunner: {},
  }), /codexRunner\.exec required/);
});

// ── prompt builders ─────────────────────────────────────────────────

test("buildPlannerPrompt scaffolds the Korean planner template + TASK trailer", () => {
  const r = createGeneralPipelineRunner({
    broadcast: () => {}, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.buildPlannerPrompt("write tests for foo");
  assert.match(out, /You are a software planner\./);
  assert.match(out, /# 목표/);
  assert.match(out, /# 범위/);
  assert.match(out, /# 작업 단계/);
  assert.match(out, /# 리스크/);
  assert.match(out, /# 검증/);
  assert.match(out, /TASK: write tests for foo$/);
});

test("buildRefinerPrompt caps prevPlan to 4500 chars and critique to 3000", () => {
  const r = createGeneralPipelineRunner({
    broadcast: () => {}, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const longPlan = "P".repeat(5000);
  const longCritique = "C".repeat(4000);
  const out = r.buildRefinerPrompt("task", longPlan, longCritique);
  assert.equal(out.indexOf("P".repeat(4500)) > -1, true);
  assert.equal(out.indexOf("P".repeat(4501)), -1, "plan capped at 4500");
  assert.equal(out.indexOf("C".repeat(3000)) > -1, true);
  assert.equal(out.indexOf("C".repeat(3001)), -1, "critique capped at 3000");
});

test("buildCriticPrompt caps plan to 6000 chars + bullet format reminder", () => {
  const r = createGeneralPipelineRunner({
    broadcast: () => {}, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const longPlan = "P".repeat(7000);
  const out = r.buildCriticPrompt("task", longPlan);
  assert.match(out, /\[critical\|high\|medium\|low\]/);
  assert.equal(out.indexOf("P".repeat(6000)) > -1, true);
  assert.equal(out.indexOf("P".repeat(6001)), -1, "plan capped at 6000");
});

// ── finalizeGeneralRun verdict mapping ──────────────────────────────

test("finalizeGeneralRun: failed → verdict ERROR + pipeline_complete carries error", () => {
  const broadcast = makeBroadcastSink();
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.finalizeGeneralRun({
    runId: "r1", started: Date.now() - 100, plan: "p", failed: true, reason: "boom",
  });
  assert.equal(out.verdict, "ERROR");
  const completes = broadcast.byType("general_plan_complete");
  assert.equal(completes.length, 1);
  assert.equal(completes[0].data.verdict, "ERROR");
  assert.equal(completes[0].data.failed, true);
  assert.equal(completes[0].data.reason, "boom");
  const pipelineCompletes = broadcast.byType("pipeline_complete");
  assert.equal(pipelineCompletes.length, 1);
  assert.equal(pipelineCompletes[0].data.errors.length, 1);
  assert.equal(pipelineCompletes[0].data.errors[0].message, "boom");
});

test("finalizeGeneralRun: aborted → verdict ABORTED + no errors", () => {
  const broadcast = makeBroadcastSink();
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.finalizeGeneralRun({ runId: "r1", started: Date.now() - 50, aborted: true });
  assert.equal(out.verdict, "ABORTED");
  assert.equal(broadcast.byType("pipeline_complete")[0].data.errors.length, 0);
});

test("finalizeGeneralRun: critical/high findings → CONCERNS verdict", () => {
  const broadcast = makeBroadcastSink();
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.finalizeGeneralRun({
    runId: "r1", started: Date.now(),
    lastCritique: { findings: [{ severity: "high" }, { severity: "low" }] },
    iterations: 2,
  });
  assert.equal(out.verdict, "CONCERNS");
});

test("finalizeGeneralRun: only low findings → CLEAN verdict", () => {
  const broadcast = makeBroadcastSink();
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.finalizeGeneralRun({
    runId: "r1", started: Date.now(),
    lastCritique: { findings: [{ severity: "low" }] },
  });
  assert.equal(out.verdict, "CLEAN");
});

test("finalizeGeneralRun: no critique at all → CLEAN verdict (defensive)", () => {
  const broadcast = makeBroadcastSink();
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: stubExecutor(), codexRunner: stubExecutor(),
  });
  const out = r.finalizeGeneralRun({ runId: "r1", started: Date.now() });
  assert.equal(out.verdict, "CLEAN");
});

// ── runGeneralPipeline canonical Phase A → B sequence ─────────────────

test("runGeneralPipeline: Phase A completes immediately + Phase B requests Claude", async () => {
  const broadcast = makeBroadcastSink();
  let claudeCalled = false;
  const claude = {
    exec: async (prompt) => {
      claudeCalled = true;
      // Verify the planner prompt was passed in.
      assert.match(prompt, /TASK: my task$/);
      return { ok: true, text: "PLAN", exitCode: 0 };
    },
  };
  const codex = {
    exec: async () => ({ ok: true, summary: "looks good", findings: [] }),
  };
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: claude, codexRunner: codex,
    generalRunRef: { active: null }, activeCodexChildren: new Set(),
  });
  const result = await r.runGeneralPipeline("my task", 1, "r1");
  assert.equal(claudeCalled, true);
  // Phase A start + completion broadcast.
  const phaseAUpdates = broadcast.byType("phase_update").filter((e) => e.data.phase === "A");
  assert.ok(phaseAUpdates.find((e) => e.data.status === "active"));
  assert.ok(phaseAUpdates.find((e) => e.data.status === "completed"));
  // Phase B planning fired.
  const phaseBUpdates = broadcast.byType("phase_update").filter((e) => e.data.phase === "B");
  assert.ok(phaseBUpdates.find((e) => e.data.status === "active"));
  assert.ok(phaseBUpdates.find((e) => e.data.status === "completed"));
  // No critical/high → verdict CLEAN.
  assert.equal(result.verdict, "CLEAN");
});

test("runGeneralPipeline: claude planning failure aborts before Phase C", async () => {
  const broadcast = makeBroadcastSink();
  const claude = {
    exec: async () => ({ ok: false, text: null, exitCode: 1, stderr: "claude died" }),
  };
  let codexCalled = false;
  const codex = {
    exec: async () => { codexCalled = true; return { ok: true, findings: [] }; },
  };
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: claude, codexRunner: codex,
    generalRunRef: { active: null }, activeCodexChildren: new Set(),
  });
  const result = await r.runGeneralPipeline("task", 1, "r1");
  assert.equal(result.verdict, "ERROR");
  assert.equal(codexCalled, false, "Phase C never reached when Phase B fails");
  // Error broadcast emitted with phase B context.
  const errors = broadcast.byType("error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].data.phase, "B");
});

test("runGeneralPipeline: aborted via generalRunRef aborts cleanly with ABORTED verdict", async () => {
  const broadcast = makeBroadcastSink();
  const ref = { active: { aborted: false } };
  const claude = {
    // Set aborted right after Phase A completes (which is synchronous-ish).
    exec: async () => { ref.active.aborted = true; return { ok: true, text: "PLAN" }; },
  };
  const r = createGeneralPipelineRunner({
    broadcast, claudeRunner: claude, codexRunner: stubExecutor(),
    generalRunRef: ref, activeCodexChildren: new Set(),
  });
  const result = await r.runGeneralPipeline("t", 3, "r1");
  // Phase B completed, then abort check before Phase C → ABORTED.
  assert.equal(result.verdict, "ABORTED");
});
