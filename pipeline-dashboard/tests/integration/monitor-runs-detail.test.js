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

// ── Slice R1-a (Phase D Round MH): per-run `origin` field ─────────────

test("R1-a: /api/monitor/runs/:runId returns local-mode `origin` defaults", async () => {
  // Today's deployment: no runnerProvider → every run is local. The route
  // must still always include the field so clients know the canonical shape.
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "active" } }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200);
    assert.ok(body.origin, "origin field always present (MF1 §3.2)");
    assert.equal(body.origin.runOrigin, "local");
    assert.equal(body.origin.sandboxClass, "none");
    assert.equal(body.origin.hostIdentity, "local");
    assert.equal(body.origin.isolationStatus, "healthy");
  } finally {
    server.close();
  }
});

test("R1-a: /api/monitor/runs/:runId surfaces remote `origin` from runnerProvider", async () => {
  const runnerProvider = {
    originForRun(runId) {
      if (runId === "remote-run-1") {
        return {
          runOrigin: "container-remote",
          sandboxClass: "container-strict",
          hostIdentity: "runner-pool-a/3",
          isolationStatus: "healthy",
        };
      }
      return null;
    },
  };
  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 5,
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "active" } }),
  });
  pipelineOrchestrator.getOrCreateRun("remote-run-1");
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
    runnerProvider,
  });
  try {
    const r1 = await get(port, "/api/monitor/runs/remote-run-1");
    assert.equal(r1.body.origin.runOrigin, "container-remote");
    assert.equal(r1.body.origin.sandboxClass, "container-strict");
    assert.equal(r1.body.origin.hostIdentity, "runner-pool-a/3");
    // Other run still gets local defaults (provider returned null).
    const r0 = await get(port, "/api/monitor/runs/default");
    assert.equal(r0.body.origin.runOrigin, "local");
    assert.equal(r0.body.origin.sandboxClass, "none");
  } finally {
    server.close();
  }
});

test("R1-a: /api/monitor/runs/:runId survives a runnerProvider that throws", async () => {
  // Same null-safe policy as bootstrap. Provider failure must not break
  // the per-run detail response — fall through to local defaults.
  const angryProvider = {
    originForRun() { throw new Error("provider blew up"); },
  };
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "idle" } }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
    runnerProvider: angryProvider,
  });
  try {
    const { status, body } = await get(port, "/api/monitor/runs/default");
    assert.equal(status, 200, "provider throw must not 500 the per-run detail");
    assert.equal(body.origin.runOrigin, "local",
      "fallback to local defaults when provider throws");
  } finally {
    server.close();
  }
});

test("R1-a: /api/monitor/runs/:runId fills missing origin sub-fields with local defaults", async () => {
  // Provider returns a partial origin (e.g. an early-stage runner that
  // only knows runOrigin but not sandboxClass yet). Fill the missing
  // fields with the local defaults so the client always sees the full shape.
  const partialProvider = {
    originForRun() {
      return { runOrigin: "container-remote" };  // sandboxClass / hostIdentity / isolationStatus missing
    },
  };
  const pipelineOrchestrator = new PipelineOrchestrator({
    createExecutor: (runId) => makeStubExecutor(runId, { snap: { status: "idle" } }),
  });
  const { server, port } = await startApp({
    pipelineOrchestrator,
    childRegistry: createChildRegistry(),
    eventReplayBuffer: createEventReplayBuffer(),
    runnerProvider: partialProvider,
  });
  try {
    const { body } = await get(port, "/api/monitor/runs/default");
    assert.equal(body.origin.runOrigin, "container-remote");
    assert.equal(body.origin.sandboxClass, "none");
    assert.equal(body.origin.hostIdentity, "local");
    assert.equal(body.origin.isolationStatus, "healthy");
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
  // Slice R1-a anchors: origin defaults + runnerProvider knob.
  assert.match(SRC, /LOCAL_ORIGIN_DEFAULTS/);
  assert.match(SRC, /runnerProvider/);
  assert.match(SRC, /Slice R1-a/);
});

// ── R2.5-d: runner-claimed run fallback ──────────────────────────

test("R2.5-d: monitor/runs/:runId falls back to runnerProvider for runner-claimed runs (no 404)", async () => {
  // The R2 closeout report's known-gap: a runner connects + claims
  // runId="rr-r2-eval-001" but no pipeline run is ever created (off
  // / report bridge mode). Pre-fix, the dashboard saw 404. Post-fix,
  // the route falls back to runnerProvider.getActiveRunMeta(runId)
  // and returns 200 with a "runner-claimed" placeholder shape.
  const childRegistry = createChildRegistry();
  // A remote child registered against this runId should be visible
  // in the children[] array (proves childRegistry filter still runs).
  childRegistry.registerRemote({
    id: "remote-agent-1",
    label: "claude",
    runId: "rr-runner-claimed",
    hostIdentity: "host-r2",
    agentType: "claude",
  });
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });
  // Pipeline orchestrator has no entry for rr-runner-claimed.
  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 1,
    createExecutor: () => makeStubExecutor("default"),
  });
  // Stub runnerProvider that claims to know rr-runner-claimed.
  const runnerProvider = {
    getActiveRunMeta: (runId) => runId === "rr-runner-claimed"
      ? { hostIdentity: "host-r2", since: 1700000000000 }
      : null,
  };

  const { server, port } = await startApp({
    pipelineOrchestrator, childRegistry, eventReplayBuffer, runnerProvider,
  });
  try {
    const resp = await get(port, "/api/monitor/runs/rr-runner-claimed");
    assert.equal(resp.status, 200,
      "runner-claimed run must NOT 404 — closes R2 known-gap");
    // Run shape — placeholder status, runner metadata in origin.
    assert.equal(resp.body.run.id, "rr-runner-claimed");
    assert.equal(resp.body.run.status, "runner-claimed");
    assert.equal(resp.body.run.templateId, null);
    assert.equal(resp.body.run.phase, null);
    // Origin pulled from runnerProvider's metadata.
    assert.equal(resp.body.origin.runOrigin, "container-remote");
    assert.equal(resp.body.origin.sandboxClass, "container-strict");
    assert.equal(resp.body.origin.hostIdentity, "host-r2");
    // Children filtered to this runId (childRegistry already had one).
    assert.equal(resp.body.children.length, 1);
    assert.equal(resp.body.children[0].id, "remote-agent-1");
    assert.equal(resp.body.children[0].runId, "rr-runner-claimed");
    // Other arrays default to empty (no pipeline activity yet).
    assert.deepEqual(resp.body.recentEvents, []);
    assert.deepEqual(resp.body.subagents, []);
    assert.deepEqual(resp.body.findings, []);
    // exportedAt + replayMeta still present.
    assert.ok(resp.body.exportedAt);
    assert.equal(resp.body.replayMeta.hasCheckpoint, false);
  } finally {
    server.close();
  }
});

test("R2.5-d: when runner-claimed runId is unknown to runnerProvider, route still 404s", async () => {
  // Negative regression: the fallback only fires when getActiveRunMeta
  // affirmatively knows the runId. Random unknown runIds still get 404.
  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });
  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 1,
    createExecutor: () => makeStubExecutor("default"),
  });
  const runnerProvider = { getActiveRunMeta: () => null };  // never knows
  const { server, port } = await startApp({
    pipelineOrchestrator, childRegistry, eventReplayBuffer, runnerProvider,
  });
  try {
    const resp = await get(port, "/api/monitor/runs/never-existed");
    assert.equal(resp.status, 404);
    assert.equal(resp.body.error, "run not found");
  } finally {
    server.close();
  }
});

test("R2.5-d: pipeline run takes precedence over runner-claimed (orchestrator wins)", async () => {
  // If a runId exists in BOTH the orchestrator AND runnerProvider, the
  // orchestrator's full pipeline-run detail wins (it has more data).
  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });
  const pipelineOrchestrator = new PipelineOrchestrator({
    maxConcurrent: 5,
    createExecutor: (runId) => makeStubExecutor(runId, {
      snap: { status: "active", templateId: "tpl", phase: "B", phaseIdx: 1, startedAt: 1700000000000 },
    }),
  });
  pipelineOrchestrator.getOrCreateRun("rr-shared");  // creates the executor
  const runnerProvider = {
    getActiveRunMeta: () => ({ hostIdentity: "host-r2", since: 1700000000000 }),
  };
  const { server, port } = await startApp({
    pipelineOrchestrator, childRegistry, eventReplayBuffer, runnerProvider,
  });
  try {
    const resp = await get(port, "/api/monitor/runs/rr-shared");
    assert.equal(resp.status, 200);
    // Orchestrator's status wins — NOT the runner-claimed placeholder.
    assert.equal(resp.body.run.status, "active");
    assert.equal(resp.body.run.templateId, "tpl");
  } finally {
    server.close();
  }
});
