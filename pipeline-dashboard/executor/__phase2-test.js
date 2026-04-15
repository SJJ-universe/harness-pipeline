// Phase 2 verification harness — exercises PipelineExecutor in isolation
// without affecting the running server's executor instance (which the
// developer's own Claude session is attached to via hooks).
//
// Run: node executor/__phase2-test.js

const { PipelineExecutor } = require("./pipeline-executor");
const templates = require("../pipeline-templates.json");

function makeFakeCodex(result = { ok: true, summary: "no issues", findings: [] }) {
  return {
    calls: 0,
    async exec(prompt, opts) {
      this.calls++;
      return { ...result, _prompt: prompt.slice(0, 80) };
    },
  };
}

function collect() {
  const events = [];
  return { events, broadcast: (e) => events.push(e) };
}

async function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAIL: " + msg);
  console.log("  ok  " + msg);
}

async function test1_activation() {
  console.log("\n[1] activation + task detection");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({ broadcast, templates, codex });
  ex.setEnabled(true);

  await ex.startFromPrompt("please debug the server.js file and fix bugs");
  const s = ex.getStatus();
  await assert(s.active === true, "pipeline active");
  await assert(s.templateId === "default", "default template chosen");
  await assert(s.phase === "A", "phase A entered");
  await assert(events.some((e) => e.type === "auto_pipeline_detect"), "auto_pipeline_detect broadcast");
  await assert(events.some((e) => e.type === "phase_update" && e.data.phase === "A" && e.data.status === "active"), "phase A active broadcast");
}

async function test2_allowed_tools_block() {
  console.log("\n[2] allowedTools enforcement");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({ broadcast, templates, codex });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a new feature");

  // Post-bec58ce tuning: Bash is allowed in Phase A for read-only exploration
  // (git log, ls, npm test for baseline verify). Edit/Write are still blocked.
  const blockEdit = await ex.onPreTool("Edit", { file_path: "/tmp/x" });
  await assert(blockEdit && blockEdit.decision === "block", "Edit blocked in Phase A");
  await assert(/Edit/.test(blockEdit.reason), "reason mentions Edit");

  const allowBash = await ex.onPreTool("Bash", { command: "git status" });
  await assert(!allowBash.decision, "Bash allowed in Phase A (post-tuning)");

  const allowRead = await ex.onPreTool("Read", { file_path: "/tmp/x" });
  await assert(!allowRead.decision, "Read allowed in Phase A");

  const allowGlob = await ex.onPreTool("Glob", { pattern: "**/*.js" });
  await assert(!allowGlob.decision, "Glob allowed in Phase A");
}

async function test3_phase_advance() {
  console.log("\n[3] phase advance on Stop");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({ broadcast, templates, codex });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a feature");

  // Phase A → B (requires 3 tools to pass gate)
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Grep", { pattern: "foo" });
  await ex.onStop({});
  let s = ex.getStatus();
  await assert(s.phase === "B", "advanced to Phase B");

  // Phase B → C requires plan artifact
  await ex.onPostTool("Write", { filePath: "/tmp/plan-001.md" });
  const beforeCodex = codex.calls;
  await ex.onStop({});
  s = ex.getStatus();
  await assert(codex.calls === beforeCodex + 1, "Codex invoked on Phase C entry");
  // With no critical findings, Codex phase auto-advances past D and into E (because
  // C's cycle logic only loops back on critical/high findings)
  await assert(["D", "E"].includes(s.phase), `after Codex advanced to D or E (got ${s.phase})`);
}

async function test4_codex_cycle_with_findings() {
  console.log("\n[4] Codex critical findings trigger cycle");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex({
    ok: true,
    summary: "critical issue found",
    findings: [{ severity: "critical", message: "SQL injection" }],
  });
  const ex = new PipelineExecutor({ broadcast, templates, codex });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement");
  // Satisfy Phase A gate (3 tools)
  await ex.onPostTool("Read", { filePath: "/a" });
  await ex.onPostTool("Read", { filePath: "/b" });
  await ex.onPostTool("Grep", { pattern: "foo" });
  await ex.onStop({});
  // Satisfy Phase B gate (plan artifact)
  await ex.onPostTool("Write", { filePath: "/tmp/plan.md" });
  await ex.onStop({});
  const s = ex.getStatus();
  await assert(s.iteration >= 1, `cycle iteration incremented (got ${s.iteration})`);
  await assert(s.phase === "D", `looped back to Phase D (got ${s.phase})`);
  await assert(events.some((e) => e.type === "cycle_iteration"), "cycle_iteration broadcast");
}

async function test5_disabled_noop() {
  console.log("\n[5] disabled executor is a no-op");
  const { events, broadcast } = collect();
  const codex = makeFakeCodex();
  const ex = new PipelineExecutor({ broadcast, templates, codex });
  // Not enabled
  await ex.startFromPrompt("please implement");
  let s = ex.getStatus();
  await assert(s.active === false, "disabled startFromPrompt did not activate");

  const block = await ex.onPreTool("Bash", {});
  await assert(!block.decision, "disabled onPreTool does not block");
}

async function test6_setEnabled_false_clears_active() {
  console.log("\n[6] setEnabled(false) clears active state");
  const { events, broadcast } = collect();
  const ex = new PipelineExecutor({ broadcast, templates, codex: makeFakeCodex() });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement");
  await assert(ex.getStatus().active === true, "active after start");
  ex.setEnabled(false);
  await assert(ex.getStatus().active === false, "active cleared on disable");
  await assert(events.some((e) => e.type === "pipeline_complete" && e.data.reason === "disabled"), "pipeline_complete with reason=disabled");
}

(async () => {
  try {
    await test1_activation();
    await test2_allowed_tools_block();
    await test3_phase_advance();
    await test4_codex_cycle_with_findings();
    await test5_disabled_noop();
    await test6_setEnabled_false_clears_active();
    console.log("\nALL PHASE 2 TESTS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nFAILED:", err.message);
    process.exit(1);
  }
})();
