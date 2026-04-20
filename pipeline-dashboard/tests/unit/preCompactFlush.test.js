// Slice A (v4) — PreCompact handler contract.
//
// onPreCompact must (a) force-save the checkpoint (b) write a ≤2KB summary to
// `.harness/last-compact-summary.md` and (c) broadcast `pipeline_compacted`.
// It MUST NOT depend on stdout injection — that path is handled by SessionStart.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { createCheckpointStore } = require("../../executor/checkpoint");

function makeEnv() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-precompact-"));
  const events = [];
  const templates = {
    default: {
      id: "default",
      phases: [
        { id: "A", label: "Phase A", name: "Plan",  allowedTools: ["Read"],
          exitCriteria: [{ type: "min-tools", count: 2, message: "need 2 tools" }] },
        { id: "B", label: "Phase B", name: "Build", allowedTools: ["Edit"] },
      ],
    },
  };
  const checkpointStore = createCheckpointStore({ repoRoot, ttlMs: 60_000 });
  const ex = new PipelineExecutor({
    broadcast: (event) => events.push(event),
    templates,
    state: new PipelineState(),
    repoRoot,
    checkpointStore,
  });
  ex.setEnabled(true);
  return { ex, events, checkpointStore, repoRoot };
}

test("onPreCompact without an active pipeline is a no-op", async () => {
  const { ex, events } = makeEnv();
  const result = await ex.onPreCompact({ trigger: "manual" });
  assert.deepEqual(result, {});
  assert.equal(events.some((e) => e.type === "pipeline_compacted"), false);
});

test("onPreCompact writes summary file + broadcasts pipeline_compacted", async () => {
  const { ex, events, repoRoot } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  events.length = 0;

  await ex.onPreCompact({ trigger: "manual" });

  const summaryPath = path.join(repoRoot, ".harness", "last-compact-summary.md");
  assert.ok(fs.existsSync(summaryPath), "summary file must be written");
  const body = fs.readFileSync(summaryPath, "utf-8");
  assert.ok(Buffer.byteLength(body, "utf-8") <= 2048, "summary must be ≤2KB");
  assert.match(body, /Harness PreCompact Summary/);
  assert.match(body, /Phase:/);
  assert.match(body, /Original task: please implement a feature/);

  const broadcast = events.find((e) => e.type === "pipeline_compacted");
  assert.ok(broadcast, "pipeline_compacted must broadcast");
  assert.ok(broadcast.data.summaryBytes > 0);
});

test("onPreCompact truncates oversize summaries", async () => {
  const { ex, repoRoot } = makeEnv();
  await ex.startFromPrompt("please implement a feature");

  // Force a huge last critique so the summary wants to exceed 2KB. onPreCompact
  // pulls each section with slice() guards, and then caps the whole text at
  // 2KB — this test proves the envelope cap is effective end-to-end.
  ex.active.lastCritique = {
    phase: "A",
    summary: "X".repeat(10_000),
    findings: Array.from({ length: 50 }, (_, i) => ({
      severity: "high",
      message: "very long finding " + "Y".repeat(400) + " #" + i,
    })),
  };

  await ex.onPreCompact({ trigger: "auto" });

  const body = fs.readFileSync(
    path.join(repoRoot, ".harness", "last-compact-summary.md"),
    "utf-8"
  );
  assert.ok(Buffer.byteLength(body, "utf-8") <= 2048,
    `summary exceeded cap: ${Buffer.byteLength(body, "utf-8")} bytes`);
});

test("onPreCompact cancels the pending checkpoint debounce timer", async () => {
  const { ex } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  // Schedule a debounced checkpoint via a blocked tool
  await ex.onPreTool("Bash", { command: "ls" });
  assert.ok(ex._checkpointTimer, "debounce timer should be scheduled");

  await ex.onPreCompact({ trigger: "manual" });

  assert.equal(ex._checkpointTimer, null, "debounce timer must be cleared");
});

test("onPreCompact force-saves the checkpoint regardless of debounce state", async () => {
  const { ex, checkpointStore } = makeEnv();
  await ex.startFromPrompt("please implement a feature");
  // Clear the debounce-scheduled save so we know it was the pre-compact that
  // wrote the checkpoint.
  if (ex._checkpointTimer) { clearTimeout(ex._checkpointTimer); ex._checkpointTimer = null; }
  try { fs.unlinkSync(checkpointStore.path); } catch (_) {}

  await ex.onPreCompact({ trigger: "manual" });

  assert.ok(fs.existsSync(checkpointStore.path),
    "onPreCompact must force-save the checkpoint");
});
