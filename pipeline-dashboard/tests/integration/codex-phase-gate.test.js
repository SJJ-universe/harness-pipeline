// Slice B (v4) regression — Codex phase exitCriteria were declaratively
// present but never actually evaluated before the fix at pipeline-executor.js.
// This test asserts the gate ladder IS invoked after a Codex phase runs, and
// that linkedCycle fallback kicks in when the gate blocks.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");

function makeEnv({ critiqueOk = true, findings = [] } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-codex-gate-"));
  const events = [];
  const codexCalls = [];
  // Fake CodexRunner — avoids spawning a real binary.
  const codex = {
    exec: async (_prompt, opts) => {
      codexCalls.push(opts);
      return {
        ok: critiqueOk,
        summary: "fake critique",
        findings,
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
  };
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "Phase A", name: "Plan",   agent: "claude", allowedTools: ["Read"] },
        { id: "B", label: "Phase B", name: "Build",  agent: "claude", allowedTools: ["Edit"] },
        // Codex phase with a gate criterion we'll intentionally fail
        {
          id: "C", label: "Phase C", name: "Review", agent: "codex",
          cycle: true, maxIterations: 3, linkedCycle: "B",
          timeoutMs: 5000,
          exitCriteria: [{ type: "files-edited", min: 1, scope: "phase",
                            pathMatch: "should-never-match-xyz" }],
        },
        { id: "D", label: "Phase D", name: "Done",   agent: "claude", allowedTools: [] },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast: (e) => events.push(e),
    templates,
    codex,
    state: new PipelineState(),
    repoRoot,
    // Route critique persistence into the test's tmp dir so we don't pollute
    // the repo's actual _workspace/ folder when running the suite.
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  return { ex, events, codexCalls };
}

test("Codex phase now broadcasts gate_evaluated (previously missing)", async () => {
  const { ex, events } = makeEnv({ critiqueOk: true, findings: [] });
  await ex.startFromPrompt("please implement a feature");
  // Advance past Phase A/B into Phase C (codex)
  await ex._enterPhase(2);
  // _runCodexPhase runs on phase entry — by now the gate should have fired
  const gateEvents = events.filter((e) => e.type === "gate_evaluated" && e.data.phase === "C");
  assert.ok(gateEvents.length >= 1,
    "Codex phase entry must now trigger gate_evaluated (was a no-op pre-Slice B)");
});

test("Failed gate on a cycle-eligible Codex phase loops back via linkedCycle", async () => {
  const { ex, events } = makeEnv({ critiqueOk: true, findings: [] });
  await ex.startFromPrompt("please implement a feature");
  // Jump to Phase C directly
  await ex._enterPhase(2);

  // Gate uses a pathMatch that can't match anything → block.
  const gateFailed = events.filter(
    (e) => e.type === "gate_failed" && e.data.phase === "C"
  );
  assert.ok(gateFailed.length >= 1,
    "gate_failed must broadcast when Codex phase criterion fails");

  // Since phase.cycle === true and linkedCycle === "B", the executor should
  // have entered Phase B as a retry (iteration + 1).
  const cycleEvents = events.filter(
    (e) => e.type === "cycle_iteration" && e.data.phase === "C"
  );
  assert.ok(cycleEvents.length >= 1,
    "cycle_iteration must fire when gate failure triggers a linkedCycle retry");
  assert.equal(cycleEvents[cycleEvents.length - 1].data.reason, "gate-failed");
});

test("Passing gate advances past Codex phase without cycling", async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-codex-gate-"));
  const events = [];
  const codex = {
    exec: async () => ({ ok: true, summary: "fine", findings: [], exitCode: 0 }),
  };
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "A", name: "A", agent: "claude", allowedTools: ["Read"] },
        {
          id: "C", label: "C", name: "Review", agent: "codex",
          cycle: false, timeoutMs: 5000,
          // only criterion is critique-received, which auto-passes after exec
          exitCriteria: [{ type: "critique-received" }],
        },
        { id: "D", label: "D", name: "D", agent: "claude", allowedTools: [] },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast: (e) => events.push(e),
    templates, codex,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a feature");
  await ex._enterPhase(1); // Codex phase
  // After _runCodexPhase runs: gate passes (critique-received is true) and we advance to D
  const status = ex.getStatus();
  assert.equal(status.phase, "D", "should have advanced past Codex phase when gate passes");
  const gateEvt = events.find((e) => e.type === "gate_evaluated" && e.data.phase === "C");
  assert.ok(gateEvt && gateEvt.data.pass === true);
});
