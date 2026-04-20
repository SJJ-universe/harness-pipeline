// Slice A (v4) — SessionStart(source=compact) re-injection contract.
//
// The only reliable channel that feeds post-compact context back into Claude
// is SessionStart's response. onSessionStart({ source: "compact" }) must read
// the summary file written by onPreCompact and return it as `additionalContext`.
// All other SessionStart sources (startup, resume, clear) are pass-through.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");

function makeEnv() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sstart-"));
  const events = [];
  const ex = new PipelineExecutor({
    broadcast: (event) => events.push(event),
    templates: { default: { id: "default", phases: [{ id: "A", label: "A" }] } },
    state: new PipelineState(),
    repoRoot,
  });
  ex.setEnabled(true);
  return { ex, repoRoot };
}

function writeSummary(repoRoot, body) {
  const dir = path.join(repoRoot, ".harness");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "last-compact-summary.md"), body, "utf-8");
}

test("source=compact returns the summary file as additionalContext", async () => {
  const { ex, repoRoot } = makeEnv();
  const summary = "# Harness PreCompact Summary\n- Phase: B\n- Task: test";
  writeSummary(repoRoot, summary);

  const result = await ex.onSessionStart({ source: "compact" });
  assert.equal(result.additionalContext, summary);
});

test("source=compact with no summary file returns empty object", async () => {
  const { ex } = makeEnv();
  const result = await ex.onSessionStart({ source: "compact" });
  assert.deepEqual(result, {});
});

test("source=startup never injects context even if summary exists", async () => {
  const { ex, repoRoot } = makeEnv();
  writeSummary(repoRoot, "# should-not-be-seen\n");

  const result = await ex.onSessionStart({ source: "startup" });
  assert.deepEqual(result, {},
    "startup should not surface the compact summary — that's compact-only");
});

test("source=resume never injects context even if summary exists", async () => {
  const { ex, repoRoot } = makeEnv();
  writeSummary(repoRoot, "# should-not-be-seen\n");

  const result = await ex.onSessionStart({ source: "resume" });
  assert.deepEqual(result, {});
});

test("oversize summary files are re-truncated on read", async () => {
  const { ex, repoRoot } = makeEnv();
  // Simulate a user who manually bloated the summary file past the 2KB cap.
  const huge = "A".repeat(5000);
  writeSummary(repoRoot, huge);

  const result = await ex.onSessionStart({ source: "compact" });
  assert.ok(result.additionalContext, "must still return context");
  const bytes = Buffer.byteLength(result.additionalContext, "utf-8");
  assert.ok(bytes <= 2048 + 64,
    `read-side truncation must re-cap oversize files (got ${bytes} bytes)`);
  assert.match(result.additionalContext, /truncated on read/);
});

test("missing source is treated as non-compact (no-op)", async () => {
  const { ex, repoRoot } = makeEnv();
  writeSummary(repoRoot, "x");
  const result = await ex.onSessionStart({});
  assert.deepEqual(result, {});
});
