// Slice R1-h2 (Phase D R1, 2026-04-28) — runner ↔ monitor wiring.
//
// CAUGHT BY REVIEW: server.js previously mounted createMonitorRoutes
// without `runnerProvider`, so /api/monitor/bootstrap.runners stayed
// [] and /api/monitor/runs/:runId.origin stayed local-default — even
// after a runner had handshaken successfully. R1-a built the API
// contract; R1-h built the registry; R1-h2 closes the wiring loop.
//
// This test exercises the loop end-to-end:
//
//   1. Build a real RunnerRegistry.
//   2. Mount real createMonitorRoutes with that registry as runnerProvider.
//   3. Drive the registry through a real handshake + claim sequence.
//   4. Hit /api/monitor/bootstrap and assert runners[] includes the host.
//   5. Hit /api/monitor/runs/:runId and assert origin reflects the
//      remote state (runOrigin=container-remote, hostIdentity=...).
//
// PLUS a source-grep test that locks server.js's wiring so a future
// commit can't silently remove `runnerProvider:` and slip the regression
// through ("the integration test still passes" because the integration
// test mounts its own router — only the source-grep catches drift in
// the production wire).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const { createMonitorRoutes } = require("../../src/routes/monitorRoutes");
const { RunnerRegistry } = require("../../src/runtime/runnerRegistry");
const { PipelineOrchestrator } = require("../../executor/pipeline-orchestrator");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { createEventReplayBuffer } = require("../../src/runtime/eventReplayBuffer");

// ── HTTP helpers ──────────────────────────────────────────────────

function startApp(opts) {
  const app = express();
  app.use(express.json());
  app.use("/api", createMonitorRoutes(opts));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (_) { resolve({ status: res.statusCode, body: text }); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function makeStubExecutor(runId, snap = { status: "active", phaseIdx: 0 }) {
  return {
    runId,
    getReplaySnapshot() { return snap; },
    getSubagentSnapshot() { return []; },
  };
}

// ── runnerProvider wiring (the actual integration) ────────────────

test("R1-h2: monitor/bootstrap.runners reflects RunnerRegistry.listRunners()", async () => {
  const runnerRegistry = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "runner-x" ? "boot-x" : null,
  });

  // Real handshake → registry tracks the host.
  const hs = runnerRegistry.handshake({
    hostIdentity: "runner-x",
    bootstrapToken: "boot-x",
    sandboxClass: "container-strict",
  });
  assert.equal(hs.ok, true);

  const orchestrator = new PipelineOrchestrator({
    createExecutor: (rid) => makeStubExecutor(rid),
    maxConcurrent: 5,
  });
  orchestrator.getOrCreateRun("default");

  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });

  const { port, close } = await startApp({
    pipelineOrchestrator: orchestrator,
    childRegistry,
    eventReplayBuffer,
    bootTime: new Date().toISOString(),
    mode: "local",
    runnerProvider: runnerRegistry,
  });

  try {
    const r = await get(port, "/api/monitor/bootstrap");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.runners), "bootstrap.runners must be an array");
    assert.equal(r.body.runners.length, 1, "the handshaken host should be visible");
    const row = r.body.runners[0];
    assert.equal(row.hostIdentity, "runner-x");
    assert.equal(row.sandboxClass, "container-strict");
    assert.equal(row.health, "healthy");
    assert.equal(row.activeRuns, 0);
  } finally { await close(); }
});

test("R1-h2: monitor/runs/:runId.origin reflects RunnerRegistry.originForRun(runId)", async () => {
  const runnerRegistry = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "runner-y" ? "boot-y" : null,
  });

  runnerRegistry.handshake({
    hostIdentity: "runner-y",
    bootstrapToken: "boot-y",
    sandboxClass: "container-strict",
  });
  // Bind a real runId to the runner — what the orchestrator does at dispatch.
  assert.equal(runnerRegistry.claimRunForRunner("rr-1234", "runner-y"), true);

  const orchestrator = new PipelineOrchestrator({
    createExecutor: (rid) => makeStubExecutor(rid),
    maxConcurrent: 5,
  });
  orchestrator.getOrCreateRun("rr-1234");

  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });

  const { port, close } = await startApp({
    pipelineOrchestrator: orchestrator,
    childRegistry,
    eventReplayBuffer,
    bootTime: new Date().toISOString(),
    mode: "local",
    runnerProvider: runnerRegistry,
  });

  try {
    const r = await get(port, "/api/monitor/runs/rr-1234");
    assert.equal(r.status, 200);
    assert.ok(r.body.origin, "run detail must include origin");
    assert.equal(r.body.origin.runOrigin, "container-remote");
    assert.equal(r.body.origin.sandboxClass, "container-strict");
    assert.equal(r.body.origin.hostIdentity, "runner-y");
    assert.equal(r.body.origin.isolationStatus, "healthy");
  } finally { await close(); }
});

test("R1-h2: monitor/runs/:runId.origin still defaults to local when run is unclaimed", async () => {
  // Even with a registry wired, an unclaimed run should report local defaults.
  // This guards against the inverse regression — if originForRun returned
  // a synthetic remote shape for null runs, every local run would mis-render.
  const runnerRegistry = new RunnerRegistry();

  const orchestrator = new PipelineOrchestrator({
    createExecutor: (rid) => makeStubExecutor(rid),
    maxConcurrent: 5,
  });
  orchestrator.getOrCreateRun("local-only-run");

  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });

  const { port, close } = await startApp({
    pipelineOrchestrator: orchestrator,
    childRegistry,
    eventReplayBuffer,
    bootTime: new Date().toISOString(),
    mode: "local",
    runnerProvider: runnerRegistry,
  });

  try {
    const r = await get(port, "/api/monitor/runs/local-only-run");
    assert.equal(r.status, 200);
    assert.equal(r.body.origin.runOrigin, "local");
    assert.equal(r.body.origin.sandboxClass, "none");
    assert.equal(r.body.origin.hostIdentity, "local");
    assert.equal(r.body.origin.isolationStatus, "healthy");
  } finally { await close(); }
});

test("R1-h2: monitor/bootstrap.runners stays [] when no runnerProvider is wired", async () => {
  // Backwards-compat: a route mounted without runnerProvider must still
  // return the (empty) array shape, never undefined or 500.
  const orchestrator = new PipelineOrchestrator({
    createExecutor: (rid) => makeStubExecutor(rid),
    maxConcurrent: 5,
  });
  orchestrator.getOrCreateRun("default");

  const childRegistry = createChildRegistry();
  const eventReplayBuffer = createEventReplayBuffer({ maxSize: 50 });

  const { port, close } = await startApp({
    pipelineOrchestrator: orchestrator,
    childRegistry,
    eventReplayBuffer,
    bootTime: new Date().toISOString(),
    mode: "local",
    // runnerProvider intentionally omitted
  });

  try {
    const r = await get(port, "/api/monitor/bootstrap");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.runners));
    assert.equal(r.body.runners.length, 0);
  } finally { await close(); }
});

// ── source-grep: lock server.js's wiring so it doesn't drift away ─

test("R1-h2: server.js wires runnerProvider into createMonitorRoutes", () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../server.js"),
    "utf-8",
  );
  // The mount must pass runnerProvider sourced from the remoteRunnerSetup
  // result. Without this line, /api/monitor/bootstrap.runners stays [] and
  // /api/monitor/runs/:runId.origin stays local-default in production
  // even when HARNESS_REMOTE_MODE=preview is set. Keep this assertion in
  // sync with server.js — if you rename _remoteRunner, update both ends.
  assert.match(
    src,
    /runnerProvider:\s*_remoteRunner\.runnerRegistry/,
    "server.js must pass runnerProvider:_remoteRunner.runnerRegistry to createMonitorRoutes — wiring caught by R1-h2 review",
  );
});
