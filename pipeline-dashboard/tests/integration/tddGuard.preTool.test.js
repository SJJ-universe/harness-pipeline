// Slice G (v5) — TDD Guard wired into PipelineExecutor.onPreTool.
//
// Verifies the end-to-end behavior: an Edit PreToolUse on a src file in a
// phase with tddGuard=edit-first receives a deny response shaped by the F0
// HookDecisionAdapter (legacy decision:block + modern hookSpecificOutput),
// broadcasts a tdd_guard_blocked event, and flips to allow after a test
// edit is recorded.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");

function makeExecutor(events = []) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tddg-"));
  const templates = {
    // Single-phase template (D) that has tddGuard — lets us park the executor
    // here without traversing A/B/C setup.
    default: {
      id: "default",
      phases: [
        {
          id: "D",
          label: "Phase D",
          name: "Testing",
          agent: "claude",
          allowedTools: ["Read", "Edit", "Write"],
          tddGuard: {
            stage: "edit-first",
            srcPattern: "^src/.*\\.js$",
            testPattern: "^tests/.*\\.test\\.js$",
            message: "[TDD Guard] test-first required for this phase.",
          },
        },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast: (e) => events.push(e),
    templates,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  return { ex, events };
}

test("src Edit with no prior test edit → deny response + tdd_guard_blocked broadcast", async () => {
  const events = [];
  const { ex } = makeExecutor(events);
  await ex.startFromPrompt("please implement a feature");   // enters Phase D
  const res = await ex.onPreTool("Edit", { file_path: "src/a.js" });

  // HookDecisionAdapter duality — both shapes must be present.
  assert.equal(res.decision, "block", "legacy decision:block missing");
  assert.ok(res.hookSpecificOutput, "modern hookSpecificOutput missing");
  assert.equal(res.hookSpecificOutput.permissionDecision, "deny");
  assert.match(res.reason, /TDD Guard/);
  assert.match(res.hookSpecificOutput.permissionDecisionReason, /TDD Guard/);

  // Distinct broadcast for TDD blocks (not tool_blocked).
  const tddBlocks = events.filter((e) => e.type === "tdd_guard_blocked");
  assert.equal(tddBlocks.length, 1, "exactly one tdd_guard_blocked event expected");
  assert.equal(tddBlocks[0].data.phase, "D");
  assert.equal(tddBlocks[0].data.tool, "Edit");
  assert.equal(tddBlocks[0].data.filePath, "src/a.js");
});

test("test Edit → recorded via onPostTool, then src Edit passes TDD Guard", async () => {
  const events = [];
  const { ex } = makeExecutor(events);
  await ex.startFromPrompt("please implement a feature");

  // Step 1: test file Edit — Guard allows, recorded via onPostTool.
  const testVerdict = await ex.onPreTool("Edit", { file_path: "tests/a.test.js" });
  assert.ok(!testVerdict.decision, "test Edit must NOT be denied");
  await ex.onPostTool("Edit", {}, { file_path: "tests/a.test.js" });

  // Step 2: src Edit — now allowed because a test Edit precedes it.
  const srcVerdict = await ex.onPreTool("Edit", { file_path: "src/a.js" });
  assert.ok(!srcVerdict.decision, `src Edit should pass after test Edit; got ${JSON.stringify(srcVerdict)}`);
});

test("Read on a src file is never blocked by TDD Guard (Edit/Write only)", async () => {
  const events = [];
  const { ex } = makeExecutor(events);
  await ex.startFromPrompt("please implement a feature");
  const res = await ex.onPreTool("Read", { file_path: "src/a.js" });
  assert.ok(!res.decision, "Read must bypass TDD Guard");
});

test("Phases with no tddGuard block are unaffected (regression guard)", async () => {
  // NOTE: use Phase D (not A) because _resolveAgentName maps A→planner which
  // has forbiddenActions=["modify-source"]; using D maps to executor role
  // which permits Edit/Write. This test exercises the TDD Guard bypass path
  // in particular, so we need the phase to be otherwise edit-capable.
  const events = [];
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tddg-nop-"));
  const templates = {
    default: {
      id: "default",
      phases: [
        {
          id: "D", label: "D", name: "Build", agent: "claude",
          allowedTools: ["Read", "Edit", "Write"],
          // No tddGuard — this is the whole point of the test.
        },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast: (e) => events.push(e),
    templates,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  await ex.startFromPrompt("please implement a feature");
  // No prior test edit — but also no guard, so src Edit just works.
  const res = await ex.onPreTool("Edit", { file_path: "src/a.js" });
  assert.ok(!res.decision, `src Edit on guard-less phase must pass; got ${JSON.stringify(res)}`);
  assert.equal(events.filter((e) => e.type === "tdd_guard_blocked").length, 0);
});

test("After block, state.metrics counters do not leak (guard is read-only)", async () => {
  const events = [];
  const { ex } = makeExecutor(events);
  await ex.startFromPrompt("please implement a feature");
  await ex.onPreTool("Edit", { file_path: "src/a.js" });   // blocked
  const before = { ...ex.state.metrics, filesEdited: new Set(ex.state.metrics.filesEdited) };
  await ex.onPreTool("Edit", { file_path: "src/b.js" });   // blocked again
  const after = ex.state.metrics;
  // filesEdited only grows on onPostTool (successful edits), never on PreToolUse.
  assert.equal(after.filesEdited.size, before.filesEdited.size);
});
