// Slice MA2 (Phase D, 2026-04-27) — /api/monitor/bootstrap integration.
//
// Mounts the real createMonitorRoutes against a real PipelineOrchestrator
// (constructed with stub PipelineExecutors), real createChildRegistry, and
// real createEventReplayBuffer to exercise the consolidated bootstrap
// payload end-to-end. The route itself is the unit; the dependencies are
// real because their snapshot/list contracts are what the route depends on.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createMonitorRoutes } = require("../../src/routes/monitorRoutes");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { createEventReplayBuffer } = require("../../src/runtime/eventReplayBuffer");

// ── Stub PipelineExecutor — we want runIds + getReplaySnapshot, not the
// 1216-line real executor. The orchestrator only invokes these two paths
// from the route's perspective.
function makeStubExecutor(runId, snap = { status: "idle" }) {
  return {
    runId,
    getReplaySnapshot() { return snap; },
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

test("/api/monitor/bootstrap returns the canonical shape", async () => {
  const childRegistry = createChildRegistry();
  childRegistry.register({ pid: 101, kill() {} }, { label: "codex", runId: "default" });
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });
  // Append a couple of UI-relevant events so the recentEvents slice is non-empty.
  eventReplayBuffer.append({ type: "phase_update", data: { runId: "default", phase: "B", status: "active" } });
  eventReplayBuffer.append({ type: "tool_recorded", data: { runId: "default", tool: "Edit" } });

  // Build a real orchestrator (single-active mode) wired to a stub executor.
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, {
      status: "active",
      templateId: "general",
      phase: "B",
      phaseIdx: 1,
      startedAt: 1700000000000,
    }),
  });

  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry,
    eventReplayBuffer,
    bootTime: "2026-04-27T00:00:00.000Z",
    mode: "local",
  });
  try {
    const { status, body } = await get(port, "/api/monitor/bootstrap");
    assert.equal(status, 200);

    // ── server summary ──
    assert.ok(body.server, "server section present");
    assert.equal(typeof body.server.pid, "number");
    assert.equal(typeof body.server.uptime, "number");
    assert.equal(body.server.bootTime, "2026-04-27T00:00:00.000Z");
    assert.equal(body.server.mode, "local");
    assert.equal(body.server.activeChildCount, 1);

    // ── runs ──
    assert.ok(Array.isArray(body.runs));
    assert.equal(body.runs.length, 1, "single-active orchestrator → one run");
    assert.equal(body.runs[0].id, "default");
    assert.equal(body.runs[0].status, "active");
    assert.equal(body.runs[0].templateId, "general");
    assert.equal(body.runs[0].phase, "B");
    assert.equal(body.runs[0].phaseIdx, 1);
    assert.equal(body.runs[0].startedAt, 1700000000000);

    // ── selectedRunId ──
    assert.equal(body.selectedRunId, "default", "matches orchestrator.getActive().runId");

    // ── activeChildren ──
    assert.ok(Array.isArray(body.activeChildren));
    assert.equal(body.activeChildren.length, 1);
    assert.equal(body.activeChildren[0].pid, 101);
    assert.equal(body.activeChildren[0].label, "codex");

    // ── recentEvents (raw replay buffer entries) ──
    assert.ok(Array.isArray(body.recentEvents));
    assert.equal(body.recentEvents.length, 2);
    assert.equal(body.recentEvents[0].event.type, "phase_update");
    assert.equal(body.recentEvents[1].event.type, "tool_recorded");
    // shape is { ts, event }, matching eventReplayBuffer.snapshot()
    assert.equal(typeof body.recentEvents[0].ts, "number");

    // ── exportedAt ──
    assert.equal(typeof body.exportedAt, "string");
    assert.match(body.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  } finally {
    server.close();
  }
});

// ── multi-run case ─────────────────────────────────────────────────────

test("/api/monitor/bootstrap lists every run the orchestrator knows", async () => {
  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 5,
    createExecutor: (runId) => makeStubExecutor(runId, {
      status: runId === "default" ? "active" : "idle",
      templateId: runId === "default" ? "general" : null,
    }),
  });
  // Force a second run to exist via the orchestrator's lazy-create path.
  pipelineOrchestrator.getOrCreateRun("session-2");
  pipelineOrchestrator.getOrCreateRun("session-3");

  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/bootstrap");
    assert.equal(status, 200);
    assert.equal(body.runs.length, 3, "default + session-2 + session-3");
    const ids = body.runs.map((r) => r.id).sort();
    assert.deepEqual(ids, ["default", "session-2", "session-3"]);
    // selectedRunId still points at the orchestrator's default for now —
    // Slice U / MA3+ will let the user pin a different selection.
    assert.equal(body.selectedRunId, "default");
  } finally {
    server.close();
  }
});

// ── recentEventLimit caps the response ─────────────────────────────────

test("/api/monitor/bootstrap caps recentEvents at recentEventLimit", async () => {
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 500 });
  for (let i = 0; i < 250; i++) {
    eventReplayBuffer.append({
      type: "tool_recorded",
      data: { runId: "default", tool: "Edit", index: i },
    });
  }
  const { server, port } = await startApp({
    pipelineOrchestrator: new PipelineOrchestrator({
      createExecutor: (runId) => makeStubExecutor(runId),
    }),
    childRegistry: createChildRegistry(),
    eventReplayBuffer,
    recentEventLimit: 100,
  });
  try {
    const { body } = await get(port, "/api/monitor/bootstrap");
    assert.equal(body.recentEvents.length, 100, "respects recentEventLimit");
    // Most recent N retained — last index should be 249.
    assert.equal(body.recentEvents[body.recentEvents.length - 1].event.data.index, 249);
    assert.equal(body.recentEvents[0].event.data.index, 150);
  } finally {
    server.close();
  }
});

// ── graceful degradation when subsystems missing ──────────────────────

test("/api/monitor/bootstrap returns safe defaults when dependencies are null", async () => {
  // Worst case: route mounted before orchestrator/childRegistry/buffer exist
  // (e.g. very early boot). Endpoint must NOT 500.
  const { server, port } = await startApp({});
  try {
    const { status, body } = await get(port, "/api/monitor/bootstrap");
    assert.equal(status, 200);
    assert.ok(body.server, "server summary always present");
    assert.deepEqual(body.runs, []);
    assert.equal(body.selectedRunId, null);
    assert.deepEqual(body.activeChildren, []);
    assert.equal(body.activeChildCount, 0);
    assert.deepEqual(body.recentEvents, []);
    assert.equal(typeof body.exportedAt, "string");
  } finally {
    server.close();
  }
});

// ── childRegistry that throws is contained ─────────────────────────────

test("/api/monitor/bootstrap survives a childRegistry that throws", async () => {
  const angryRegistry = {
    snapshot() { throw new Error("registry blew up"); },
    size() { throw new Error("size blew up"); },
  };
  const { server, port } = await startApp({
    childRegistry: angryRegistry,
    pipelineOrchestrator: new PipelineOrchestrator({
      createExecutor: (runId) => makeStubExecutor(runId),
    }),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/bootstrap");
    assert.equal(status, 200, "registry throw must not 500 the bootstrap");
    assert.deepEqual(body.activeChildren, []);
    assert.equal(body.activeChildCount, 0);
  } finally {
    server.close();
  }
});

// ── source-level wiring anchor ────────────────────────────────────────

test("server.js wires monitor routes after the orchestrator", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../server.js"), "utf-8"
  );
  // The createMonitorRoutes call must mention pipelineOrchestrator + childRegistry
  // + eventReplayBuffer + bootTime — proves the route gets fully wired.
  const idx = SRC.indexOf("createMonitorRoutes({");
  assert.ok(idx > -1, "createMonitorRoutes call exists");
  const block = SRC.slice(idx, idx + 600);
  assert.match(block, /pipelineOrchestrator/, "orchestrator passed in");
  assert.match(block, /childRegistry/, "childRegistry passed in");
  assert.match(block, /eventReplayBuffer/, "replay buffer passed in");
  assert.match(block, /bootTime/, "boot time passed in");
  assert.match(block, /Slice MA2/, "Slice MA2 traceability tag attached");
});
