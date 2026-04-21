// Slice AD (Phase 2.5) — fileConflictDetector.clear(runId) wiring.
//
// Reviewer note (2026-04-21): the detector exposed clear(runId) with a
// comment saying it should fire on pipeline_complete, but the only call
// site was hook-router's recordEdit(). That left claims alive forever, so
// a completed run's file ownership would trigger a false
// `file_conflict_warning` broadcast the moment ANY subsequent run
// (including recycled runIds) edited the same path.
//
// This slice wires clear() into three teardown paths. These tests prove
// each one clears correctly, and — critically — that the observable
// effect (no false warning on a later edit) actually holds.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { createFileConflictDetector } = require("../../src/runtime/fileConflictDetector");
const { HookRouter } = require("../../executor/hook-router");

function mk({ maxConcurrent = 3 } = {}) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-conflict-cleanup-"));
  const events = [];
  const broadcast = (e) => events.push(e);
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "E", label: "Build", name: "Build", agent: "claude", allowedTools: ["Edit", "Write"] },
      ],
    },
  };
  const fileConflictDetector = createFileConflictDetector({ broadcast });
  const orchestrator = new PipelineOrchestrator({
    broadcast,
    maxConcurrent,
    fileConflictDetector,
    createExecutor: (runId) =>
      new PipelineExecutor({
        broadcast,
        templates,
        state: new PipelineState(),
        repoRoot,
        fileConflictDetector,
        runId,
      }),
  });
  const router = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });
  router.attachOrchestrator(orchestrator);
  router.attachFileConflictDetector(fileConflictDetector);
  return { orchestrator, router, events, fileConflictDetector };
}

function warningsFor(events, filePath) {
  return events.filter(
    (e) => e.type === "file_conflict_warning" && e.data && e.data.filePath === filePath
  );
}

test("AD: completed run's claims are cleared by PipelineExecutor._complete()", async () => {
  const { orchestrator, router, events, fileConflictDetector } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  await execA.startFromPrompt("do feature A");

  // runA records an Edit on src/a.js (via the hook router so recordEdit fires)
  await router.route("post-tool", {
    session_id: "runA",
    tool_name: "Edit",
    tool_input: { file_path: "src/shared.js" },
    tool_response: {},
  });
  // Claim exists.
  const snapBefore = fileConflictDetector.snapshot();
  assert.ok(snapBefore["src/shared.js"], "runA has claimed src/shared.js");
  assert.ok(snapBefore["src/shared.js"].includes("runA"));

  // runA completes — _complete() should call fileConflictDetector.clear("runA")
  execA._complete("test-complete");

  const snapAfter = fileConflictDetector.snapshot();
  assert.equal(
    snapAfter["src/shared.js"],
    undefined,
    "runA's claim on src/shared.js is gone after _complete"
  );

  // Now runB edits the same file — no false warning because runA no longer owns it.
  events.length = 0;
  const execB = orchestrator.getOrCreateRun("runB");
  await execB.startFromPrompt("do feature B");
  await router.route("post-tool", {
    session_id: "runB",
    tool_name: "Edit",
    tool_input: { file_path: "src/shared.js" },
    tool_response: {},
  });
  assert.equal(
    warningsFor(events, "src/shared.js").length,
    0,
    "runB editing a file that runA already finished with does NOT trigger a false warning"
  );
});

test("AD: resetActive() also clears file claims (manual abort path)", async () => {
  const { orchestrator, router, fileConflictDetector } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  await execA.startFromPrompt("do feature A");

  await router.route("post-tool", {
    session_id: "runA",
    tool_name: "Edit",
    tool_input: { file_path: "src/x.js" },
    tool_response: {},
  });
  assert.ok(fileConflictDetector.snapshot()["src/x.js"], "claim exists before reset");

  execA.resetActive("manual-abort");

  assert.equal(
    fileConflictDetector.snapshot()["src/x.js"],
    undefined,
    "resetActive() drops runA's claim on src/x.js"
  );
});

test("AD: orchestrator.remove(runId) clears the removed run's claims", async () => {
  const { orchestrator, router, fileConflictDetector } = mk();
  const execTemp = orchestrator.getOrCreateRun("temp-run");
  await execTemp.startFromPrompt("anything");

  await router.route("post-tool", {
    session_id: "temp-run",
    tool_name: "Write",
    tool_input: { file_path: "docs/notes.md" },
    tool_response: {},
  });
  assert.ok(fileConflictDetector.snapshot()["docs/notes.md"], "claim exists");

  const removed = orchestrator.remove("temp-run");
  assert.equal(removed, true, "orchestrator returns true for successful remove");

  assert.equal(
    fileConflictDetector.snapshot()["docs/notes.md"],
    undefined,
    "remove(runId) cleared the file claim so a recycled runId starts clean"
  );
});

test("AD: true conflicts still fire during the run (clear is not a silencer)", async () => {
  const { orchestrator, router, events, fileConflictDetector } = mk();
  const execA = orchestrator.getOrCreateRun("runA");
  const execB = orchestrator.getOrCreateRun("runB");
  await execA.startFromPrompt("A");
  await execB.startFromPrompt("B");

  // A edits the file first.
  await router.route("post-tool", {
    session_id: "runA",
    tool_name: "Edit",
    tool_input: { file_path: "src/race.js" },
    tool_response: {},
  });
  // Then B edits the same file while A is still active → this MUST warn.
  events.length = 0;
  await router.route("post-tool", {
    session_id: "runB",
    tool_name: "Edit",
    tool_input: { file_path: "src/race.js" },
    tool_response: {},
  });
  assert.ok(
    warningsFor(events, "src/race.js").length >= 1,
    "concurrent edits on the same path still trigger a conflict warning"
  );

  // Both claimed the file.
  const claim = fileConflictDetector.snapshot()["src/race.js"];
  assert.ok(claim.includes("runA"));
  assert.ok(claim.includes("runB"));
});
