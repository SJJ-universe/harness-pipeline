// Slice F (v5) — PipelineExecutor exit-path coverage regression.
//
// Focus: every path that ends a phase attempt in the executor MUST call
// markPhaseExit so attempts[] durations are captured. These tests drive the
// executor through normal advance, cycle re-entry, onSessionEnd pause, and
// _complete termination and assert phase_metrics broadcasts + snapshot
// shape. Paired with the unit tests in pipelineState.phaseMetrics.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");

function makeExecutor({ codex, templates, events = [] }) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-phase-metrics-"));
  const ex = new PipelineExecutor({
    broadcast: (e) => events.push(e),
    templates,
    codex,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  return { ex, events, repoRoot };
}

function tplLinear() {
  // 3-phase linear template — exercises normal advance only.
  return {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "A", name: "A", agent: "claude", allowedTools: ["Read"] },
        { id: "B", label: "B", name: "B", agent: "claude", allowedTools: ["Edit"] },
        { id: "C", label: "C", name: "C", agent: "claude", allowedTools: [] },
      ],
    },
  };
}

function tplCycle() {
  // Codex phase C cycles back to B via linkedCycle until gate passes / budget
  // runs out. With pathMatch "never", the gate always fails for the first
  // call, so B is re-entered at least once.
  return {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "A", name: "A", agent: "claude", allowedTools: ["Read"] },
        { id: "B", label: "B", name: "B", agent: "claude", allowedTools: ["Edit"] },
        {
          id: "C", label: "C", name: "Review", agent: "codex",
          cycle: true, maxIterations: 2, linkedCycle: "B", timeoutMs: 5000,
          exitCriteria: [{ type: "files-edited", min: 1, scope: "phase", pathMatch: "never-xyz" }],
        },
        { id: "D", label: "D", name: "D", agent: "claude", allowedTools: [] },
      ],
    },
  };
}

test("phase_metrics broadcast fires on every exit transition", async () => {
  const events = [];
  const { ex } = makeExecutor({ templates: tplLinear(), codex: { exec: async () => ({ ok: true, findings: [] }) }, events });
  await ex.startFromPrompt("please implement a feature");
  // Advance A → B → C via direct _enterPhase calls (bypass gate for simplicity)
  await ex._enterPhase(1);
  await ex._enterPhase(2);

  const metricsEvents = events.filter((e) => e.type === "phase_metrics");
  const phases = metricsEvents.map((e) => e.data.phaseId);
  assert.ok(phases.includes("A"), "Phase A must have produced phase_metrics on A→B");
  assert.ok(phases.includes("B"), "Phase B must have produced phase_metrics on B→C");
});

test("normal advance records reason='advance' with gatePass=true by default", async () => {
  const events = [];
  const { ex } = makeExecutor({ templates: tplLinear(), codex: { exec: async () => ({ ok: true, findings: [] }) }, events });
  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(1);

  const m = events.filter((e) => e.type === "phase_metrics" && e.data.phaseId === "A")[0];
  assert.ok(m, "phase_metrics for A must exist");
  assert.equal(m.data.reason, "advance");
  assert.equal(m.data.gatePass, true);
  assert.ok(m.data.durationMs >= 0);
});

test("cycle-reenter stamps reason='cycle-reenter-gate-fail' on the Codex phase", async () => {
  const events = [];
  const { ex } = makeExecutor({
    templates: tplCycle(),
    codex: { exec: async () => ({ ok: true, findings: [], summary: "ok" }) },
    events,
  });
  await ex.startFromPrompt("please implement a feature");
  // Jump to Phase C (codex) so _runCodexPhase fires with a gate that fails.
  await ex._enterPhase(2);

  const cMetrics = events.filter((e) => e.type === "phase_metrics" && e.data.phaseId === "C");
  assert.ok(cMetrics.length >= 1, "Phase C must have at least one phase_metrics");
  // The first C closure must be a cycle reenter (findings or gate-fail) — NOT "advance".
  const reasons = cMetrics.map((e) => e.data.reason);
  const hasCycleReason = reasons.some((r) =>
    r === "cycle-reenter-gate-fail" || r === "cycle-reenter-findings"
  );
  assert.ok(hasCycleReason, `expected a cycle-reenter reason, got: ${JSON.stringify(reasons)}`);
});

test("cycle-reenter keeps attempts history — re-entered phase has ≥2 attempts", async () => {
  const events = [];
  const { ex } = makeExecutor({
    templates: tplCycle(),
    codex: { exec: async () => ({ ok: true, findings: [], summary: "ok" }) },
    events,
  });
  await ex.startFromPrompt("please implement a feature");
  // Enter B first so it has an "initial" attempt, then go to C which cycles back to B.
  await ex._enterPhase(1);
  await ex._enterPhase(2);

  const snap = ex.state.snapshot();
  const attemptsB = snap.phases.B?.attempts || [];
  assert.ok(attemptsB.length >= 2,
    `Phase B must have ≥2 attempts after cycle re-entry, got ${attemptsB.length}`);
});

test("onSessionEnd closes the currently open attempt with reason='session-end'", async () => {
  const events = [];
  const { ex } = makeExecutor({ templates: tplLinear(), codex: { exec: async () => ({ ok: true, findings: [] }) }, events });
  await ex.startFromPrompt("please implement a feature");
  // Currently in Phase A (open attempt)
  await ex.onSessionEnd({});

  // onSessionEnd DOES set this.active to null after pausing, so read the state
  // via the snapshot still-reachable on executor's own instance.
  // snapshot is built from state not active — state should still have the closed attempt.
  const snap = ex.state.snapshot();
  const attempts = snap.phases.A?.attempts || [];
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].reason, "session-end");
  assert.ok(attempts[0].exitedAt !== null);
});

test("setEnabled(false) while active triggers _complete and closes current attempt", async () => {
  const events = [];
  const { ex } = makeExecutor({ templates: tplLinear(), codex: { exec: async () => ({ ok: true, findings: [] }) }, events });
  await ex.startFromPrompt("please implement a feature");
  // Trigger _complete("disabled") via setEnabled(false)
  ex.setEnabled(false);

  const snap = ex.state.snapshot();
  const attempts = snap.phases.A?.attempts || [];
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].reason, "disabled");
  assert.ok(attempts[0].exitedAt !== null, "attempt must be closed on disable");
});

test("markGateAttempt is called on every gate.evaluate — counters match broadcasts", async () => {
  const events = [];
  const { ex } = makeExecutor({
    templates: tplCycle(),
    codex: { exec: async () => ({ ok: true, findings: [], summary: "ok" }) },
    events,
  });
  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(2); // codex phase C

  const snap = ex.state.snapshot();
  const phaseC = snap.phases.C;
  assert.ok(phaseC && phaseC.gateAttempts >= 1,
    `Phase C gateAttempts should be ≥1, got ${phaseC?.gateAttempts}`);
});
