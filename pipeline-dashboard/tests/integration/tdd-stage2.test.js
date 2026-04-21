// Slice Q (v6) — TDD Guard Stage 2 end-to-end via PipelineExecutor.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");

function mkExecutor() {
  const events = [];
  const broadcast = (e) => events.push(e);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tdd2-"));
  // Phase E per the default policy allows Bash with npm test / node prefixes.
  // Stage 2 naturally lives here (test-run phase) rather than Phase D
  // (test-author phase where Bash is globally blocked by default-policy.json).
  const templates = {
    default: {
      id: "default",
      phases: [
        {
          id: "E",
          label: "E",
          name: "TDD Stage 2",
          agent: "claude",
          allowedTools: ["Read", "Edit", "Write", "Bash"],
          tddGuard: {
            stage: "failing-proof",
            srcPattern: "^src/.*\\.js$",
            testPattern: "^tests/.*\\.test\\.js$",
          },
        },
      ],
    },
  };
  const ex = new PipelineExecutor({
    broadcast,
    templates,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  return { ex, events };
}

test("stage 2: blank state → src Edit blocked by stage 1 (no test edit)", async () => {
  const { ex } = mkExecutor();
  await ex.startFromPrompt("please implement a feature");
  const res = await ex.onPreTool("Edit", { file_path: "src/a.js" });
  assert.equal(res.decision, "block");
});

test("stage 2: after test Edit + failing npm test → src Edit allowed", async () => {
  const { ex, events } = mkExecutor();
  await ex.startFromPrompt("please implement a feature");

  // 1) Edit test file
  const r1 = await ex.onPreTool("Edit", { file_path: "tests/a.test.js" });
  assert.ok(!r1.decision, "test Edit must pass guard");
  await ex.onPostTool("Edit", {}, { file_path: "tests/a.test.js" });

  // 2) Run `npm test` — jest output with a failure
  const r2 = await ex.onPreTool("Bash", { command: "npm test" });
  assert.ok(!r2.decision);
  await ex.onPostTool(
    "Bash",
    {
      stdout: "Tests:       1 failed, 0 passed, 1 total",
      exit_code: 1,
    },
    { command: "npm test" }
  );

  // 3) Now src Edit should be allowed (test edit + failing test recorded)
  const r3 = await ex.onPreTool("Edit", { file_path: "src/a.js" });
  assert.ok(!r3.decision, `expected allow, got ${JSON.stringify(r3)}`);
});

test("stage 2: all-passing npm test does NOT unlock src Edit", async () => {
  const { ex } = mkExecutor();
  await ex.startFromPrompt("please implement a feature");
  await ex.onPreTool("Edit", { file_path: "tests/a.test.js" });
  await ex.onPostTool("Edit", {}, { file_path: "tests/a.test.js" });
  await ex.onPreTool("Bash", { command: "npm test" });
  await ex.onPostTool(
    "Bash",
    { stdout: "Tests:       3 passed, 3 total", exit_code: 0 },
    { command: "npm test" }
  );
  const res = await ex.onPreTool("Edit", { file_path: "src/a.js" });
  assert.equal(res.decision, "block");
  assert.match(res.reason, /Stage 2|실패하는 테스트/);
});

test("stage 2: non-test Bash command does not record testRun", async () => {
  const { ex } = mkExecutor();
  await ex.startFromPrompt("please implement a feature");
  // Run a non-test bash (ls)
  await ex.onPreTool("Bash", { command: "ls src/" });
  await ex.onPostTool("Bash", { stdout: "a.js\nb.js" }, { command: "ls src/" });
  const snap = ex.state.snapshot();
  assert.equal(snap.metrics.testRuns, undefined,
    "snapshot shouldn't leak raw testRuns array; recorded metric is in pipelineState.metrics");
  // But state.metrics.testRuns length should be 0 on the executor itself:
  assert.equal(ex.state.metrics.testRuns.length, 0);
});
