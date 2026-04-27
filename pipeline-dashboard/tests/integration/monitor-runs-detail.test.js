// Slice MB1 (Phase D Round 2, 2026-04-27) — /api/monitor/runs/:runId.
//
// Mounts createMonitorRoutes against a real PipelineOrchestrator with
// stub PipelineExecutors, real createChildRegistry, and real
// createEventReplayBuffer. Verifies the per-run detail payload shape +
// 404 / 503 / scoped filter behaviour.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createMonitorRoutes } = require("../../src/routes/monitorRoutes");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { createEventReplayBuffer } = require("../../src/runtime/eventReplayBuffer");

function makeStubExecutor(runId, opts = {}) {
  return {
    runId,
    getReplaySnapshot() {
      return opts.snap || { status: "idle" };
    },
    getSubagentSnapshot() {
      return opts.subagents || [];
    },
  };
}

function startApp(opts = {}) {
  const app = express();
  app.use("/api", createMonitorRoutes(opts));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { reject(new Error("non-json: " + text)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

// ── happy path ─────────────────────────────────────────────────────────

test("/api/monitor/runs/:runId returns canonical run detail", async () => {
  const childRegistry = createChildRegistry();
  childRegistry.register({ pid: 101, kill() {} }, { label: "codex", runId: "default" });
  childRegistry.register({ pid: 202, kill() {} }, { label: "claude", runId: "session-2" });
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });
  // Mix run-scoped + global events so the route's filter is exercised.
  eventReplayBuffer.append({ type: "phase_update", data: { runId: "default", phase: "B" } });
  eventReplayBuffer.append({ type: "tool_recorded", data: { runId: "session-2", tool: "Edit" } });
  eventReplayBuffer.append({ type: "hook_event", data: { kind: "Notification" } }); // global

  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 5,
    createExecutor: (runId) => makeStubExecutor(runId, {
      snap: {
        status: runId === "default" ? "active" : "idle",
        templateId: runId === "default" ? "general" : null,
        phase: runId === "default" ? "B" : null,
        phaseIdx: runId === "default" ? 1 : null,
        startedAt: runId === "default" ? 1700000000000 : null,
        stateSnapshot: {
          findings: runId === "default" ? [
            { severity: "high", message: "missing test" },
            { severity: "low", message: "doc nit" },
          ] : [],
          findingsOverflow: { count: 0, bySeverity: {} },
        },
      },
    }),
  });
  pipelineOrchestrator.getOrCreateRun("session-2");

  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry,
    eventReplayBuffer,
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200);

    // ── run summary ──
    assert.ok(body.run);
    assert.equal(body.run.id, "default");
    assert.equal(body.run.status, "active");
    assert.equal(body.run.templateId, "general");
    assert.equal(body.run.phase, "B");
    assert.equal(body.run.phaseIdx, 1);
    assert.equal(body.run.startedAt, 1700000000000);

    // ── recentEvents — runId match + global passthrough ──
    assert.ok(Array.isArray(body.recentEvents));
    // Should include the phase_update (runId=default) + hook_event (global).
    // Should NOT include the tool_recorded (runId=session-2).
    const types = body.recentEvents.map((e) => e.event.type).sort();
    assert.deepEqual(types, ["hook_event", "phase_update"]);

    // ── children — only this run's children ──
    assert.ok(Array.isArray(body.children));
    assert.equal(body.children.length, 1);
    assert.equal(body.children[0].pid, 101);
    assert.equal(body.children[0].runId, "default");

    // ── subagents — empty in MB1 (MB2 fills) ──
    assert.deepEqual(body.subagents, []);

    // ── findings ──
    assert.ok(Array.isArray(body.findings));
    assert.equal(body.findings.length, 2);
    assert.equal(body.findings[0].severity, "high");

    // ── replayMeta ──
    assert.ok(body.replayMeta);
    assert.equal(body.replayMeta.hasCheckpoint, false);

    assert.equal(typeof body.exportedAt, "string");
  } finally {
    server.close();
  }
});

// ── 404 for unknown runId ─────────────────────────────────────────────

test("/api/monitor/runs/:runId returns 404 when runId not found", async () => {
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/ghost");
    assert.equal(status, 404);
    assert.equal(body.error, "run not found");
    assert.equal(body.runId, "ghost");
  } finally {
    server.close();
  }
});

// ── 503 when orchestrator missing ─────────────────────────────────────

test("/api/monitor/runs/:runId returns 503 when orchestrator is null", async () => {
  // Mount route without an orchestrator (boot race scenario).
  const { server, port } = await startApp({});
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 503);
    assert.match(body.error, /orchestrator/);
  } finally {
    server.close();
  }
});

// ── 200 with recentEventLimit cap ─────────────────────────────────────

test("/api/monitor/runs/:runId caps recentEvents at recentEventLimit", async () => {
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 500 });
  for (let i = 0; i < 250; i++) {
    eventReplayBuffer.append({
      type: "tool_recorded",
      data: { runId: "default", tool: "Edit", index: i },
    });
  }
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "active" } }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer,
    recentEventLimit: 100,
  });
  try {
    const { body } = await get(port, "/api/monitor/runs/default");
    assert.equal(body.recentEvents.length, 100);
    // Newest entries retained — last index should be 249.
    const last = body.recentEvents[body.recentEvents.length - 1].event.data.index;
    assert.equal(last, 249);
  } finally {
    server.close();
  }
});

// ── safe degradation when child/replay subsystems missing ─────────────

test("/api/monitor/runs/:runId tolerates missing childRegistry + eventReplayBuffer", async () => {
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "idle" } }),
  });
  const { server, port } = await startApp({ pipelineOrchestrator });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200);
    assert.deepEqual(body.children, []);
    assert.deepEqual(body.recentEvents, []);
    assert.deepEqual(body.findings, []);
  } finally {
    server.close();
  }
});

// ── MB2: subagents from executor.getSubagentSnapshot ──────────────────

test("/api/monitor/runs/:runId carries subagents from exec.getSubagentSnapshot", async () => {
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, {
      snap: { status: "active" },
      subagents: [
        {
          session_id: "s-1",
          agent_type: "codex",
          parent_session_id: null,
          startedAt: 1700000000000,
          completedAt: null,
          active: true,
          metrics: null,
        },
        {
          session_id: "s-2",
          agent_type: "claude",
          parent_session_id: "s-1",
          startedAt: 1700000001000,
          completedAt: 1700000005000,
          active: false,
          metrics: { toolCount: 3, byTool: { Edit: 2, Read: 1 } },
        },
      ],
    }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200);
    assert.equal(body.subagents.length, 2);
    assert.equal(body.subagents[0].session_id, "s-1");
    assert.equal(body.subagents[0].active, true);
    assert.equal(body.subagents[1].active, false);
    assert.equal(body.subagents[1].metrics.toolCount, 3);
  } finally {
    server.close();
  }
});

// ── executor without getSubagentSnapshot still works ──────────────────

test("/api/monitor/runs/:runId returns subagents:[] when executor lacks the method", async () => {
  // Backward-compat: pre-MB2 executors don't have getSubagentSnapshot.
  // Route must not 500 on that.
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => ({
      runId,
      getReplaySnapshot() { return { status: "idle" }; },
      // intentionally NO getSubagentSnapshot
    }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200);
    assert.deepEqual(body.subagents, []);
  } finally {
    server.close();
  }
});

// ── source-level wiring anchor ────────────────────────────────────────

test("monitorRoutes.js exposes the GET /monitor/runs/:runId route", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../src/routes/monitorRoutes.js"), "utf-8"
  );
  // Anchor: the route declaration string + Slice MB1 traceability comment.
  assert.match(SRC, /router\.get\("\/monitor\/runs\/:runId"/);
  assert.match(SRC, /Slice MB1/);
});
