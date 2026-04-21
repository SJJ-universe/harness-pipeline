// Slice S (v6) — PipelineOrchestrator unit tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PipelineOrchestrator,
  DEFAULT_RUN_ID,
} = require("../../executor/pipeline-orchestrator");

function fakeExecutorFactory() {
  const created = [];
  return {
    created,
    create: (runId) => {
      const exec = {
        runId,
        _phase: null,
        _phaseId: null,
        route: (event, payload) => ({ routed: true, runId, event, payload }),
        _currentPhase: () => ({ id: "A" }),
        active: { templateId: "default" },
      };
      created.push(exec);
      return exec;
    },
  };
}

test("constructor throws without createExecutor", () => {
  assert.throws(() => new PipelineOrchestrator({}), /createExecutor/);
});

test("constructor throws when maxConcurrent < 1", () => {
  const { create } = fakeExecutorFactory();
  assert.throws(
    () => new PipelineOrchestrator({ createExecutor: create, maxConcurrent: 0 }),
    /maxConcurrent/
  );
});

test("bootstrap eagerly creates the default run", () => {
  const { created, create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  assert.equal(created.length, 1);
  assert.equal(created[0].runId, DEFAULT_RUN_ID);
  assert.equal(orch.list().length, 1);
  assert.equal(orch.list()[0], DEFAULT_RUN_ID);
});

test("getActive returns the default run in single-active mode", () => {
  const { create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  assert.equal(orch.getActive().runId, DEFAULT_RUN_ID);
});

test("get(runId) returns the matching executor or null", () => {
  const { create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  assert.ok(orch.get(DEFAULT_RUN_ID));
  assert.equal(orch.get("does-not-exist"), null);
});

test("remove(defaultRunId) is refused to preserve single-active anchor", () => {
  const { create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  assert.equal(orch.remove(DEFAULT_RUN_ID), false);
  assert.equal(orch.list().length, 1);
});

test("canAddRun reflects maxConcurrent headroom", () => {
  const { create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create, maxConcurrent: 1 });
  assert.equal(orch.canAddRun(), false, "already at cap (default run)");

  const orch3 = new PipelineOrchestrator({ createExecutor: create, maxConcurrent: 3 });
  assert.equal(orch3.canAddRun(), true);
});

test("routeHook delegates to the executor's route() method", () => {
  const { created, create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  const result = orch.routeHook(DEFAULT_RUN_ID, "pre-tool", { tool_name: "Edit" });
  assert.equal(result.routed, true);
  assert.equal(result.event, "pre-tool");
  assert.equal(result.runId, DEFAULT_RUN_ID);
});

test("routeHook falls back to active when runId missing", () => {
  const { create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  const result = orch.routeHook("unknown-run", "pre-tool", {});
  // Falls back to getActive() → default
  assert.equal(result.runId, DEFAULT_RUN_ID);
});

test("_resetForTests rebuilds the default run", () => {
  const { created, create } = fakeExecutorFactory();
  const orch = new PipelineOrchestrator({ createExecutor: create });
  const before = created.length;
  orch._resetForTests();
  assert.equal(created.length, before + 1);
  assert.equal(orch.list().length, 1);
});

test("DEFAULT_RUN_ID is 'default' (contract lock)", () => {
  assert.equal(DEFAULT_RUN_ID, "default");
});
