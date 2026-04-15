// Phase 3 verification — PipelineState, QualityGate, SkillInjector integration
// Run: node executor/__phase3-test.js

const { PipelineExecutor } = require("./pipeline-executor");
const { PipelineState } = require("./pipeline-state");
const { QualityGate } = require("./quality-gate");
const { SkillInjector } = require("./skill-injector");
const templates = require("../pipeline-templates.json");

function makeFakeCodex(result = { ok: true, summary: "no issues", findings: [] }) {
  return {
    calls: 0,
    lastPrompt: null,
    async exec(prompt) {
      this.calls++;
      this.lastPrompt = prompt;
      return { ...result };
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

async function test1_state_records_tools_and_artifacts() {
  console.log("\n[1] PipelineState records tools, files, artifacts");
  const state = new PipelineState();
  state.reset({ userPrompt: "x", templateId: "default" });
  state.recordTool("A", "Read", { filePath: "/a/b.js" });
  state.recordTool("A", "Glob", { pattern: "**/*.ts" });
  state.recordTool("B", "Write", { filePath: "/tmp/plan-001.md" });
  state.recordTool("E", "Edit", { filePath: "/src/x.js" });
  state.recordTool("E", "Bash", { command: "npm test" });

  assert(state.metrics.toolCount === 5, "5 tools recorded");
  assert(state.metrics.bashCommands === 1, "1 bash command tracked");
  assert(state.metrics.filesEdited.size === 2, "2 files edited (plan + x.js)");
  assert(state.phaseToolCount("A") === 2, "phase A has 2 tools");
  assert(state.phaseToolCount("B") === 1, "phase B has 1 tool");

  state.setArtifact("B", "plan", "/tmp/plan-001.md");
  assert(state.getArtifact("B", "plan") === "/tmp/plan-001.md", "artifact stored");
  assert(state.findArtifact("plan") === "/tmp/plan-001.md", "findArtifact cross-phase lookup");
}

async function test2_gate_min_tools_in_phase() {
  console.log("\n[2] QualityGate: min-tools-in-phase");
  const gate = new QualityGate();
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });
  state.recordTool("A", "Read", { filePath: "/a" });
  state.recordTool("A", "Read", { filePath: "/b" });

  const phase = { id: "A", label: "Phase A", name: "컨텍스트", exitCriteria: [{ type: "min-tools-in-phase", count: 3 }] };
  let r = await gate.evaluate(phase, state);
  assert(r.pass === false, "fails with 2 tools (need 3)");
  assert(r.missing.length === 1, "one missing criterion reported");

  state.recordTool("A", "Grep", { pattern: "foo" });
  r = await gate.evaluate(phase, state);
  assert(r.pass === true, "passes with 3 tools");
}

async function test3_gate_has_artifact_and_no_critical() {
  console.log("\n[3] QualityGate: has-artifact, no-critical-findings");
  const gate = new QualityGate();
  const state = new PipelineState();
  state.reset({ userPrompt: "x" });

  const phaseB = { id: "B", label: "Phase B", name: "계획", exitCriteria: [{ type: "has-artifact", key: "plan" }] };
  let r = await gate.evaluate(phaseB, state);
  assert(r.pass === false, "fails without plan artifact");

  state.setArtifact("B", "plan", "/tmp/plan.md");
  r = await gate.evaluate(phaseB, state);
  assert(r.pass === true, "passes after artifact set");

  const phaseF = { id: "F", label: "Phase F", name: "검증", exitCriteria: [{ type: "no-critical-findings" }] };
  state.setCritique("C", { findings: [{ severity: "medium", message: "x" }] });
  r = await gate.evaluate(phaseF, state);
  assert(r.pass === true, "passes with only medium finding");

  state.setCritique("C", { findings: [{ severity: "critical", message: "bug" }] });
  r = await gate.evaluate(phaseF, state);
  assert(r.pass === false, "fails with critical finding");
}

async function test4_executor_blocks_on_gate_failure() {
  console.log("\n[4] Executor blocks Stop when gate fails");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({
    broadcast,
    templates,
    codex,
    state: new PipelineState(),
    gate: new QualityGate(),
    injector: new SkillInjector({}),
  });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a feature");

  // Phase A requires 3 tools, we have 0 → should block
  let stopResult = await ex.onStop({});
  assert(stopResult.decision === "block", "Stop blocked on empty Phase A");
  assert(/min-tools-in-phase|탐색/i.test(stopResult.reason), "reason mentions tool count");
  assert(ex.getStatus().phase === "A", "still in Phase A after block");
  assert(events.some((e) => e.type === "gate_failed"), "gate_failed broadcast");

  // Record 3 tools → should pass gate → advance to B
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Grep", { pattern: "foo" });
  stopResult = await ex.onStop({});
  assert(!stopResult.decision, "Stop passes after 3 tool calls");
  assert(ex.getStatus().phase === "B", "advanced to Phase B");
}

async function test5_artifact_capture_via_rules() {
  console.log("\n[5] artifactRules capture Write events");
  const { events, broadcast } = collect();
  const state = new PipelineState();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({
    broadcast, templates, codex, state,
    gate: new QualityGate(), injector: new SkillInjector({}),
  });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a feature");

  // Advance to B by satisfying A
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Read", { filePath: "/c" });
  await ex.onStop({});
  assert(ex.getStatus().phase === "B", "in Phase B");

  // Write a non-plan file → no artifact
  await ex.onPostTool("Write", { filePath: "/tmp/readme.md" });
  assert(state.getArtifact("B", "plan") === undefined, "non-plan Write not captured");

  // Write a plan file → artifact captured
  await ex.onPostTool("Write", { filePath: "/tmp/plan-feature.md" });
  assert(state.getArtifact("B", "plan") === "/tmp/plan-feature.md", "plan artifact captured");
  assert(events.some((e) => e.type === "artifact_captured"), "artifact_captured broadcast");

  // Stop should now pass Phase B gate (has-artifact: plan)
  // Then B→C triggers fake Codex auto-run (no findings) which auto-advances to D
  const stop = await ex.onStop({});
  assert(!stop.decision, "Phase B gate passes with plan artifact");
  const phaseAfter = ex.getStatus().phase;
  assert(["C", "D"].includes(phaseAfter), `advanced past B (got ${phaseAfter})`);
  assert(codex.calls === 1, "Codex auto-invoked on Phase C entry");
}

async function test6_gate_bypass_after_max_retries() {
  console.log("\n[6] Gate bypasses after MAX_GATE_RETRIES");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({
    broadcast, templates, codex,
    state: new PipelineState(), gate: new QualityGate(), injector: new SkillInjector({}),
  });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement");

  // Attempt Stop with no tools in Phase A — blocked
  let r = await ex.onStop({});
  assert(r.decision === "block", "1st attempt blocked");
  r = await ex.onStop({});
  assert(r.decision === "block", "2nd attempt blocked");
  r = await ex.onStop({});
  // 3rd attempt should bypass (gateRetries reaches MAX=3)
  assert(!r.decision, "3rd attempt bypasses gate");
  assert(events.some((e) => e.type === "gate_bypassed"), "gate_bypassed broadcast");
  assert(ex.getStatus().phase === "B", "advanced despite failing gate");
}

async function test7_skill_injector_codex_prompt() {
  console.log("\n[7] SkillInjector builds Codex prompt with artifacts + findings");
  const state = new PipelineState();
  state.reset({ userPrompt: "fix the auth bug" });
  state.setArtifact("B", "plan", "- step 1: read auth.js\n- step 2: patch middleware");
  state.setCritique("prior", { findings: [{ severity: "high", message: "race condition" }] });

  const injector = new SkillInjector({});
  const phase = { id: "C", name: "계획 검토", label: "Phase C" };
  const prompt = injector.buildCodexPrompt(phase, state);
  assert(prompt.includes("fix the auth bug"), "prompt includes user goal");
  assert(prompt.includes("Previous Phase Outputs"), "prompt includes prior artifacts section");
  assert(prompt.includes("step 1: read auth.js"), "prompt embeds plan body");
  assert(prompt.includes("race condition"), "prompt lists prior findings");
  assert(prompt.includes("## Summary"), "prompt enforces summary section");
}

async function test8_skill_injector_gathers_registry_content() {
  console.log("\n[8] SkillInjector.gather pulls from registry");
  const fakeRegistry = {
    getSkillContent: (id) => (id === "superpowers:writing-plans" ? "PLAN GUIDE BODY" : null),
  };
  const injector = new SkillInjector({ skillRegistry: fakeRegistry });
  const content = await injector.gather({ skill: "superpowers:writing-plans" });
  assert(content === "PLAN GUIDE BODY", "content loaded from registry");

  const none = await injector.gather({ skill: "nonexistent:x" });
  assert(none === null, "missing skill yields null");

  const noSkill = await injector.gather({});
  assert(noSkill === null, "phase without skill yields null");
}

(async () => {
  try {
    await test1_state_records_tools_and_artifacts();
    await test2_gate_min_tools_in_phase();
    await test3_gate_has_artifact_and_no_critical();
    await test4_executor_blocks_on_gate_failure();
    await test5_artifact_capture_via_rules();
    await test6_gate_bypass_after_max_retries();
    await test7_skill_injector_codex_prompt();
    await test8_skill_injector_gathers_registry_content();
    console.log("\nALL PHASE 3 TESTS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nFAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
