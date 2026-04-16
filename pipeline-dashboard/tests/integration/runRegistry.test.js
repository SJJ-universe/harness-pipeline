const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { RunRegistry } = require("../../src/runtime/runRegistry");

test("RunRegistry writes a replayable run manifest", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-runs-"));
  const registry = new RunRegistry({ rootDir });
  const runId = registry.start({ kind: "unit", input: { prompt: "hello" } });
  registry.append(runId, { type: "stdout", bytes: 5 });
  registry.complete(runId, { ok: true, exitCode: 0, stdout: "done" });

  const manifestPath = path.join(rootDir, runId, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  assert.equal(manifest.kind, "unit");
  assert.equal(manifest.ok, true);
  assert.equal(manifest.events.length, 1);
  assert.ok(manifest.stdoutHash);
});
