// Integration test: Replay mode — deterministic fixture replay
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { HookRouter } = require("../../executor/hook-router");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { QualityGate } = require("../../executor/quality-gate");
const { SkillInjector } = require("../../executor/skill-injector");
const { PipelineAdapter } = require("../../executor/pipeline-adapter");
const { Replay } = require("../../src/runtime/replay");
const pipelineTemplates = require("../../pipeline-templates.json");
const fixture = require("../../fixtures/hooks/replay-default-happy.json");

function createTestEnv() {
  const broadcasts = [];
  const broadcast = (e) => broadcasts.push(e);
  const hookRouter = new HookRouter({ broadcast, sessionWatcher: null });
  const state = new PipelineState();
  const gate = new QualityGate();
  const injector = new SkillInjector({});
  const adapter = new PipelineAdapter({ templates: pipelineTemplates });

  // Mock codex runner for replay — should not be called
  const codex = {
    exec: async () => ({
      ok: true, exitCode: 0, stdout: "## Summary\nOK", stderr: "",
      summary: "OK", findings: [],
    }),
  };

  const executor = new PipelineExecutor({
    broadcast,
    templates: pipelineTemplates,
    codex,
    state,
    gate,
    injector,
    adapter,
    repoRoot: path.resolve(__dirname, "..", ".."),
  });
  hookRouter.attachExecutor(executor);

  return { hookRouter, broadcasts, broadcast };
}

describe("Replay Mode", () => {
  it("replays fixture and produces deterministic output", async () => {
    const { hookRouter, broadcast } = createTestEnv();
    const replay = new Replay({ hookRouter, broadcast });
    const result = await replay.run(fixture);

    assert.equal(result.eventCount, 5);
    assert.ok(result.decisions.length === 5);
    assert.ok(result.broadcastedEvents.length > 0, "should have broadcasted events");
    // No tools should be blocked in the happy path
    assert.equal(result.blockedTools.length, 0);
  });

  it("produces same result on repeated replay", async () => {
    const env1 = createTestEnv();
    const replay1 = new Replay({ hookRouter: env1.hookRouter, broadcast: env1.broadcast });
    const result1 = await replay1.run(fixture);

    const env2 = createTestEnv();
    const replay2 = new Replay({ hookRouter: env2.hookRouter, broadcast: env2.broadcast });
    const result2 = await replay2.run(fixture);

    assert.equal(result1.eventCount, result2.eventCount);
    assert.equal(result1.blockedTools.length, result2.blockedTools.length);
    assert.equal(result1.decisions.length, result2.decisions.length);
  });
});
