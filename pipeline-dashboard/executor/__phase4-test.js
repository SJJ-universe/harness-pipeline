// Phase 4 verification — PipelineAdapter mutations
// Run: node executor/__phase4-test.js

const { PipelineExecutor } = require("./pipeline-executor");
const { PipelineState } = require("./pipeline-state");
const { QualityGate } = require("./quality-gate");
const { SkillInjector } = require("./skill-injector");
const { PipelineAdapter } = require("./pipeline-adapter");
const templates = require("../pipeline-templates.json");

function makeFakeCodex(result) {
  return {
    calls: 0,
    async exec() {
      this.calls++;
      return result ? { ...result } : { ok: true, summary: "ok", findings: [] };
    },
  };
}

function collect() {
  const events = [];
  return { events, broadcast: (e) => events.push(e) };
}

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAIL: " + msg);
  console.log("  ok  " + msg);
}

function makeExecutor(overrides = {}) {
  const { events, broadcast } = collect();
  const codex = overrides.codex || makeFakeCodex();
  const ex = new PipelineExecutor({
    broadcast,
    templates,
    codex,
    state: new PipelineState(),
    gate: new QualityGate(),
    injector: new SkillInjector({}),
    adapter: overrides.adapter || new PipelineAdapter({ templates }),
  });
  ex.setEnabled(true);
  return { ex, events, codex };
}

async function test1_adapter_returns_null_when_nothing_to_do() {
  console.log("\n[1] Adapter no-op on empty state");
  const adapter = new PipelineAdapter({ templates });
  const active = {
    template: structuredClone(templates.default),
    phaseIdx: 0,
    iteration: 0,
    templateId: "default",
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  const result = await adapter.review(active, state);
  assert(result === null, "no mutation on empty state");
}

async function test2_insert_hotfix_on_critical() {
  console.log("\n[2] insert-phase rule fires on critical finding");
  const adapter = new PipelineAdapter({ templates });
  const active = {
    template: structuredClone(templates.default),
    phaseIdx: 2,
    iteration: 0,
    templateId: "default",
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  state.setCritique("C", { findings: [{ severity: "critical", message: "broken" }] });

  const mutation = await adapter.review(active, state);
  assert(mutation !== null, "mutation produced");
  assert(mutation.type === "insert-phase", "mutation is insert-phase");
  assert(mutation.at === 3, `at = phaseIdx+1 (got ${mutation.at})`);
  assert(mutation.phase.id === "E0", "inserted phase id is E0");
  assert(
    Array.isArray(mutation.phase.exitCriteria) && mutation.phase.exitCriteria.length >= 1,
    "inserted phase has exitCriteria"
  );
  assert(mutation.ruleId === "insert-hotfix-on-critical", "ruleId tagged");
}

async function test3_insert_hotfix_marked_once() {
  console.log("\n[3] insert-hotfix rule does not fire twice");
  const adapter = new PipelineAdapter({ templates });
  const active = {
    template: structuredClone(templates.default),
    phaseIdx: 2,
    iteration: 0,
    templateId: "default",
    _adapterMarks: new Set(["insert-hotfix-on-critical"]),
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  state.setCritique("C", { findings: [{ severity: "critical", message: "still broken" }] });

  const mutation = await adapter.review(active, state);
  assert(mutation === null, "second review is a no-op when already marked");
}

async function test4_switch_template_on_stuck_cycle() {
  console.log("\n[4] switch-template rule fires on stuck cycle");
  const adapter = new PipelineAdapter({ templates });
  const tmpl = structuredClone(templates.default);
  const cyclePhaseIdx = tmpl.phases.findIndex((p) => p.cycle);
  const active = {
    template: tmpl,
    phaseIdx: cyclePhaseIdx,
    iteration: 3,
    templateId: "default",
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  state.setCritique("C", { findings: [{ severity: "high", message: "won't resolve" }] });

  const mutation = await adapter.review(active, state);
  assert(mutation !== null, "mutation produced");
  assert(mutation.type === "switch-template", "mutation is switch-template");
  assert(typeof mutation.templateId === "string", "templateId set");
}

async function test5_switch_template_skipped_when_findings_resolved() {
  console.log("\n[5] switch-template does not fire when findings are resolved");
  const adapter = new PipelineAdapter({ templates });
  const tmpl = structuredClone(templates.default);
  const cyclePhaseIdx = tmpl.phases.findIndex((p) => p.cycle);
  const active = {
    template: tmpl,
    phaseIdx: cyclePhaseIdx,
    iteration: 3,
    templateId: "default",
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  // No critical/high findings — cycle completed naturally
  state.setCritique("C", { findings: [{ severity: "low", message: "nit" }] });

  const mutation = await adapter.review(active, state);
  assert(mutation === null, "no switch when cycle completed naturally");
}

async function test6_merge_testing_when_many_edits() {
  console.log("\n[6] merge-template rule fires on high edit volume");
  const adapter = new PipelineAdapter({ templates });
  const active = {
    template: structuredClone(templates.default),
    phaseIdx: 4,
    iteration: 0,
    templateId: "default",
  };
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  for (let i = 0; i < 25; i++) {
    state.recordTool("E", "Edit", { filePath: `/src/file${i}.js` });
  }

  const mutation = await adapter.review(active, state);
  assert(mutation !== null, "mutation produced");
  assert(mutation.type === "merge-template", "mutation is merge-template");
  assert(Array.isArray(mutation.phases) && mutation.phases.length > 0, "phases populated");
  assert(mutation.phases[0].id.startsWith("T_"), "merged phase ids are prefixed");
}

async function test7_executor_applies_insert_phase_on_advance() {
  console.log("\n[7] Executor splices inserted phase and enters it next");
  const { ex, events } = makeExecutor();
  await ex.startFromPrompt("please implement a feature");

  // Satisfy Phase A gate (3 tools)
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Grep", { pattern: "foo" });
  await ex.onStop({});
  assert(ex.getStatus().phase === "B", "advanced to B after A");

  // Satisfy Phase B gate — plan artifact
  await ex.onPostTool("Write", { filePath: "/tmp/plan-1.md" });

  // Seed a critical finding so adapter inserts a hotfix phase after B
  ex.state.setCritique("B", { findings: [{ severity: "critical", message: "boom" }] });

  await ex.onStop({});
  // After Stop on B: gate passes → _advance → adapter sees critical → inserts E0 at idx+1 → enters E0
  const phase = ex.getStatus().phase;
  assert(phase === "E0", `entered E0 hotfix phase (got ${phase})`);
  assert(
    events.some((e) => e.type === "pipeline_mutated" && e.data.mutationType === "insert-phase"),
    "pipeline_mutated broadcast"
  );
  // Phase list now contains E0
  const phases = ex.active.template.phases.map((p) => p.id);
  assert(phases.includes("E0"), "E0 present in mutated phase list");
}

async function test8_executor_does_not_reinsert_hotfix() {
  console.log("\n[8] Executor does not re-insert same mutation twice");
  const { ex } = makeExecutor();
  await ex.startFromPrompt("please implement a feature");

  // Advance through A
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Grep", { pattern: "foo" });
  await ex.onStop({});

  // B with critical → triggers insert
  await ex.onPostTool("Write", { filePath: "/tmp/plan-1.md" });
  ex.state.setCritique("B", { findings: [{ severity: "critical", message: "boom" }] });
  await ex.onStop({});
  assert(ex.getStatus().phase === "E0", "in E0");
  const countBefore = ex.active.template.phases.filter((p) => p.id === "E0").length;
  assert(countBefore === 1, "exactly one E0");

  // Complete E0: edit a file, then Stop. Critical still in findings → gate would block,
  // but we'll clear findings to simulate hotfix success.
  await ex.onPostTool("Edit", { filePath: "/src/broken.js" });
  ex.state.findings = ex.state.findings.filter((f) => f.severity !== "critical");
  await ex.onStop({});
  // Should advance past E0 without inserting another hotfix
  const countAfter = ex.active.template.phases.filter((p) => p.id === "E0").length;
  assert(countAfter === 1, "still exactly one E0 after second advance");
  assert(ex.getStatus().phase !== "E0", "left E0 phase");
}

async function test9_apply_mutation_switch_template() {
  console.log("\n[9] _applyMutation: switch-template replaces template");
  const { ex } = makeExecutor();
  await ex.startFromPrompt("please implement a feature");
  ex.active.phaseIdx = 2;
  const applied = ex._applyMutation({
    type: "switch-template",
    templateId: "testing",
    ruleId: "test-rule",
    markId: "test-rule",
  });
  assert(applied !== null, "applied returned next idx");
  assert(applied.nextIdx === 0, "nextIdx is 0 after switch");
  assert(ex.active.templateId === "testing", "templateId updated");
  assert(ex.active.template.id === "testing", "template object replaced");
  assert(ex.active._adapterMarks.has("test-rule"), "mark recorded");
}

async function test10_apply_mutation_merge_template() {
  console.log("\n[10] _applyMutation: merge-template splices phases");
  const { ex } = makeExecutor();
  await ex.startFromPrompt("please implement a feature");
  const before = ex.active.template.phases.length;
  const applied = ex._applyMutation({
    type: "merge-template",
    at: 2,
    phases: [{ id: "T_X", name: "injected", label: "T_X" }],
    ruleId: "merge-rule",
  });
  assert(applied !== null, "applied returned next idx");
  assert(applied.nextIdx === 2, "nextIdx is splice position");
  assert(ex.active.template.phases.length === before + 1, "phase count incremented");
  assert(ex.active.template.phases[2].id === "T_X", "phase spliced at correct position");
}

(async () => {
  try {
    await test1_adapter_returns_null_when_nothing_to_do();
    await test2_insert_hotfix_on_critical();
    await test3_insert_hotfix_marked_once();
    await test4_switch_template_on_stuck_cycle();
    await test5_switch_template_skipped_when_findings_resolved();
    await test6_merge_testing_when_many_edits();
    await test7_executor_applies_insert_phase_on_advance();
    await test8_executor_does_not_reinsert_hotfix();
    await test9_apply_mutation_switch_template();
    await test10_apply_mutation_merge_template();
    console.log("\nALL PHASE 4 TESTS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nFAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
