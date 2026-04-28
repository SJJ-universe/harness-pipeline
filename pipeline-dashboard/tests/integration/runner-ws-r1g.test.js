// Slice R1-g (Phase D R1, 2026-04-28) — end-to-end WS frame routing.
//
// Boots the full transport stack on both sides:
//   - real express + RunnerRoutes
//   - real http + WebSocketServer + isRunnerWsPath demux
//   - real createRunnerWsAuth + createRunnerWsHandler
//   - real createChildRegistry + real HookRouter
//   - real RunnerAgent connecting from the test
//
// Then drives the agent's WS to send agent_started / agent_stopped /
// hook frames and asserts the orchestrator-side projections fired.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const { createRunnerRoutes } = require("../../src/routes/runnerRoutes");
const { createRunnerWsAuth, isRunnerWsPath } = require("../../src/server/runnerWsAuth");
const { createRunnerWsHandler } = require("../../src/server/runnerWsHandler");
const { setupRemoteRunner } = require("../../src/server/remoteRunnerSetup");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { HookRouter } = require("../../executor/hook-router");
const { RunnerAgent } = require("../../src/runner/runnerAgent");
const jwt = require("../../src/security/jwt");

const QUIET = { log: () => {}, warn: () => {}, error: () => {} };

// ── full stack mini-orchestrator ──────────────────────────────────

function startOrchestrator({ token = "r1g-token", bootstrapMap = {}, ledgerDir = null } = {}) {
  const setup = setupRemoteRunner({
    env: { HARNESS_REMOTE_MODE: "preview", HARNESS_TOKEN: token },
  });
  setup.runnerRegistry._bootstrapTokenFor = (h) => bootstrapMap[h] || null;

  const ledger = ledgerDir
    ? new EvidenceLedger({ rootDir: ledgerDir, signingKey: setup.ledgerKey })
    : null;
  const broadcasts = [];
  const broadcast = (e) => broadcasts.push(e);
  const childRegistry = createChildRegistry({ broadcast });
  const hookRouter = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });

  const app = express();
  app.use(express.json());
  app.use("/api", createRunnerRoutes({
    runnerRegistry: setup.runnerRegistry,
    jwtKey: setup.jwtKey,
    mode: setup.mode,
    ledger,
  }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });
  const verifyRunner = createRunnerWsAuth({ jwtKey: setup.jwtKey, mode: setup.mode });
  const handleRunner = createRunnerWsHandler({ ledger, childRegistry, hookRouter });

  wss.on("connection", (ws, req) => {
    if (isRunnerWsPath(req.url)) {
      const verdict = verifyRunner(req);
      if (!verdict.ok) {
        try { ws.close(verdict.code, verdict.reason); } catch (_) {}
        return;
      }
      handleRunner(ws, req, verdict);
      return;
    }
    try { ws.close(1008, "non-runner path"); } catch (_) {}
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        registry: setup.runnerRegistry,
        childRegistry,
        hookRouter,
        ledger,
        broadcasts,
        jwtKey: setup.jwtKey,
        close: () => new Promise((r) => {
          wss.close(() => server.close(() => r()));
        }),
      });
    });
  });
}

function buildToken(runId, key, harness = {}) {
  return jwt.issue({
    runId,
    key,
    runDurationMs: 60_000,
    harness: {
      runOrigin: "container-remote",
      sandboxClass: "container-strict",
      hostIdentity: "runner-r1g",
      ...harness,
    },
  });
}

async function waitFor(predicate, { timeoutMs = 2000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

async function startAgent(orch, runId, { hostIdentity = "runner-r1g", bootstrap = "boot-r1g" } = {}) {
  const runJwt = buildToken(runId, orch.jwtKey, { hostIdentity });
  const agent = new RunnerAgent(
    {
      bootstrapToken: bootstrap,
      hostIdentity,
      orchestratorUrl: orch.url,
      runId,
      runJwt,
      heartbeatIntervalMs: 5000,        // not stressing heartbeats this round
    },
    { WebSocketCtor: WebSocket, logger: QUIET },
  );
  await agent.start();
  await waitFor(() => agent.helloReceived);
  return agent;
}

// ── tests ─────────────────────────────────────────────────────────

test("R1-g E2E: agent_started frame from runner → childRegistry has remote child", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
  });
  const agent = await startAgent(orch, "rr-1");
  try {
    // Send agent_started directly via the agent's open ws.
    agent.ws.send(JSON.stringify({
      type: "agent_started",
      id: "claude-aaa",
      label: "claude",
      agentType: "claude",
    }));
    const projected = await waitFor(
      () => orch.childRegistry.snapshot().some((c) => c.id === "claude-aaa"),
      { timeoutMs: 1000 },
    );
    assert.equal(projected, true, "childRegistry should see the remote agent");
    const snap = orch.childRegistry.snapshot();
    const row = snap.find((c) => c.id === "claude-aaa");
    assert.equal(row.remote, true);
    assert.equal(row.runId, "rr-1");
    assert.equal(row.hostIdentity, "runner-r1g");
    assert.equal(row.agentType, "claude");
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-g E2E: agent_stopped removes the remote child", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
  });
  const agent = await startAgent(orch, "rr-2");
  try {
    agent.ws.send(JSON.stringify({ type: "agent_started", id: "x", label: "x" }));
    await waitFor(() => orch.childRegistry.size() === 1);
    agent.ws.send(JSON.stringify({ type: "agent_stopped", id: "x" }));
    const cleared = await waitFor(() => orch.childRegistry.size() === 0);
    assert.equal(cleared, true);
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-g E2E: hook frame fans out via hookRouter.routeRemote with verified runId", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
  });
  const agent = await startAgent(orch, "rr-3");
  try {
    agent.ws.send(JSON.stringify({
      type: "hook",
      event: { hook: "PreToolUse", tool: "Read", data: { file: "x.js" } },
    }));
    const arrived = await waitFor(
      () => orch.broadcasts.some((b) => b.type === "runner_hook"),
      { timeoutMs: 1000 },
    );
    assert.equal(arrived, true);
    const evt = orch.broadcasts.find((b) => b.type === "runner_hook");
    assert.equal(evt.data.runId, "rr-3", "verdict.runId is authoritative");
    assert.equal(evt.data.origin, "container-remote");
    assert.equal(evt.data.event.hook, "PreToolUse");
    assert.equal(evt.data.event.tool, "Read");
    // Stats reflect the routing.
    const stats = orch.hookRouter.getStats();
    assert.equal(stats.remoteHooks, 1);
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-g E2E: WS close auto-clears agents the runner forgot to stop", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
  });
  const agent = await startAgent(orch, "rr-4");
  try {
    agent.ws.send(JSON.stringify({ type: "agent_started", id: "leak-1", label: "x" }));
    agent.ws.send(JSON.stringify({ type: "agent_started", id: "leak-2", label: "x" }));
    await waitFor(() => orch.childRegistry.size() === 2);
    // Force-close WS without sending agent_stopped.
    agent.ws.close(1000, "test bye");
    const cleared = await waitFor(() => orch.childRegistry.size() === 0, { timeoutMs: 1500 });
    assert.equal(cleared, true, "auto-cleanup should clear leaked agents");
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-g E2E: runner cannot smuggle hooks under another runId (trust boundary)", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
  });
  const agent = await startAgent(orch, "rr-honest");
  try {
    agent.ws.send(JSON.stringify({
      type: "hook",
      runId: "rr-EVIL",                             // attacker-supplied
      event: { hook: "Stop", tool: null, data: {} },
    }));
    const arrived = await waitFor(
      () => orch.broadcasts.some((b) => b.type === "runner_hook"),
      { timeoutMs: 1000 },
    );
    assert.equal(arrived, true);
    const evt = orch.broadcasts.find((b) => b.type === "runner_hook");
    assert.equal(evt.data.runId, "rr-honest", "JWT runId wins over frame body");
    assert.notEqual(evt.data.runId, "rr-EVIL");
  } finally {
    await agent.stop();
    await orch.close();
  }
});

// ── R1-k1: cross-run id namespace ─────────────────────────────────
//
// Two runs from two DIFFERENT runner hosts pick the same agent id —
// pre-R1-k1 the bare-id key would collapse both projections into one
// entry and one agent_stopped would clobber both. Single-host across
// two runs can't be exercised via integration test (bootstrap is
// single-use per hostIdentity by design — see runnerRegistry §8.1.1);
// the unit suite covers the in-process registry semantics regardless.

test("R1-k1 E2E: two hosts running different runs may share an agent id without colliding", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-A": "boot-A", "runner-B": "boot-B" },
  });
  const a1 = await startAgent(orch, "rr-A", { hostIdentity: "runner-A", bootstrap: "boot-A" });
  const a2 = await startAgent(orch, "rr-B", { hostIdentity: "runner-B", bootstrap: "boot-B" });
  try {
    a1.ws.send(JSON.stringify({ type: "agent_started", id: "claude-aaa", label: "x" }));
    a2.ws.send(JSON.stringify({ type: "agent_started", id: "claude-aaa", label: "x" }));
    const both = await waitFor(() => orch.childRegistry.size() === 2, { timeoutMs: 1500 });
    assert.equal(both, true, "both projections must coexist (no id collision)");
    const collisionsByRun = orch.childRegistry.snapshot()
      .filter((s) => s.id === "claude-aaa")
      .map((s) => s.runId)
      .sort();
    assert.deepEqual(collisionsByRun, ["rr-A", "rr-B"]);
    // Stop on host A: only A's projection should be removed.
    a1.ws.send(JSON.stringify({ type: "agent_stopped", id: "claude-aaa" }));
    const oneLeft = await waitFor(() => orch.childRegistry.size() === 1, { timeoutMs: 1500 });
    assert.equal(oneLeft, true, "stop in rr-A must not touch rr-B");
    const survivor = orch.childRegistry.snapshot()[0];
    assert.equal(survivor.runId, "rr-B");
    assert.equal(survivor.id, "claude-aaa");
    assert.equal(survivor.hostIdentity, "runner-B");
  } finally {
    await a1.stop();
    await a2.stop();
    await orch.close();
  }
});

test("R1-k1 E2E: forced WS close on host A only auto-clears that connection's children", async () => {
  // Verifies the auto-cleanup path is also scoped — when one connection
  // dies abruptly, the other host's projections must survive.
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-A": "boot-A", "runner-B": "boot-B" },
  });
  const a1 = await startAgent(orch, "rr-A", { hostIdentity: "runner-A", bootstrap: "boot-A" });
  const a2 = await startAgent(orch, "rr-B", { hostIdentity: "runner-B", bootstrap: "boot-B" });
  try {
    a1.ws.send(JSON.stringify({ type: "agent_started", id: "claude-aaa", label: "x" }));
    a2.ws.send(JSON.stringify({ type: "agent_started", id: "claude-aaa", label: "x" }));
    a2.ws.send(JSON.stringify({ type: "agent_started", id: "extra-bbb", label: "x" }));
    await waitFor(() => orch.childRegistry.size() === 3);
    // Force-close only host A's connection — host B's WS stays open.
    a1.ws.close(1000, "test bye");
    // After auto-cleanup: only host A's claude-aaa is gone (1 entry cleared).
    const settled = await waitFor(() => orch.childRegistry.size() === 2, { timeoutMs: 1500 });
    assert.equal(settled, true);
    const ids = orch.childRegistry.snapshot()
      .map((s) => `${s.runId}:${s.id}`)
      .sort();
    assert.deepEqual(ids, ["rr-B:claude-aaa", "rr-B:extra-bbb"]);
  } finally {
    await a1.stop();
    await a2.stop();
    await orch.close();
  }
});

test("R1-g/R1-k2 E2E: ledger captures every routed frame in chain (incl. hook success)", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r1g-ledger-"));
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-r1g": "boot-r1g" },
    ledgerDir: tmp,
  });
  const agent = await startAgent(orch, "rr-audit");
  try {
    agent.ws.send(JSON.stringify({ type: "agent_started", id: "a-aaa", label: "claude" }));
    agent.ws.send(JSON.stringify({
      type: "hook",
      event: { hook: "PreToolUse", tool: "Read", data: { file: "secret.env" } },
    }));
    agent.ws.send(JSON.stringify({
      type: "hook",
      event: { hook: "Stop", tool: null, data: {} },
    }));
    agent.ws.send(JSON.stringify({ type: "agent_stopped", id: "a-aaa" }));

    await waitFor(() => orch.childRegistry.size() === 0);
    // Wait for both routed-hook ledger entries to land.
    await waitFor(() => {
      try {
        const file = path.join(tmp, "rr-audit", "ledger.jsonl");
        const lines = fs.readFileSync(file, "utf-8").trim().split("\n").map(JSON.parse);
        return lines.filter((l) => l.type === "runner_hook_routed").length >= 2;
      } catch (_) { return false; }
    }, { timeoutMs: 1500 });

    const file = path.join(tmp, "rr-audit", "ledger.jsonl");
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n").map(JSON.parse);
    const types = lines.map((l) => l.type);
    assert.ok(types.includes("runner_ws_connected"));
    assert.ok(types.includes("runner_agent_started"));
    assert.ok(types.includes("runner_agent_stopped"));
    // R1-k2: every successful hook crosses the audit chain too.
    const routed = lines.filter((l) => l.type === "runner_hook_routed");
    assert.equal(routed.length, 2, "expected one runner_hook_routed per accepted hook");
    assert.equal(routed[0].data.hook, "PreToolUse");
    assert.equal(routed[0].data.tool, "Read");
    // R1-k2: payload data must NOT be persisted to the chain.
    assert.equal(routed[0].data.data, undefined);
    assert.equal(routed[0].data.file, undefined);
    assert.equal(routed[1].data.hook, "Stop");
    assert.equal(routed[1].data.tool, null);
    // Chain still verifies under HMAC after the additional entries.
    assert.equal(orch.ledger.verifyChain("rr-audit").valid, true);
  } finally {
    await agent.stop();
    await orch.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
