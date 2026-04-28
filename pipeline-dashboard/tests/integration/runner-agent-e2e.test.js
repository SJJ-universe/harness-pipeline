// Slice R1-e-3 (Phase D R1, 2026-04-28) — RunnerAgent ↔ orchestrator E2E.
//
// The strongest signal that the R1-e round actually transports a runner
// from cold-start to "WS hello received" without any mocks:
//
//   - real express + RunnerRoutes (R1-d) for /handshake, /heartbeat, /hook
//   - real http + WebSocketServer + path-aware demux (R1-e-2)
//   - real createRunnerWsAuth + createRunnerWsHandler
//   - real RunnerAgent + the ws library + global fetch
//
// The agent bootstraps from a synthetic operator env and the test
// asserts the orchestrator-observed effects (runnerRegistry has the
// host, ledger has the audit trail, hello frame round-tripped).

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
const { RunnerAgent } = require("../../src/runner/runnerAgent");
const jwt = require("../../src/security/jwt");

// ── full-stack mini-orchestrator ──────────────────────────────────

function startOrchestrator({ token = "e2e-token", bootstrapMap = {}, ledgerDir = null } = {}) {
  const setup = setupRemoteRunner({
    env: { HARNESS_REMOTE_MODE: "preview", HARNESS_TOKEN: token },
  });

  // Inject test-controlled bootstrap mapping by replacing the registry's
  // bootstrap lookup. Easier than thrashing process.env.
  setup.runnerRegistry._bootstrapTokenFor = (h) => bootstrapMap[h] || null;

  const ledger = ledgerDir
    ? new EvidenceLedger({ rootDir: ledgerDir, signingKey: setup.ledgerKey })
    : null;

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
  const handleRunner = createRunnerWsHandler({ ledger });

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
        ledger,
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
      hostIdentity: "runner-e2e",
      ...harness,
    },
  });
}

// Wait for a predicate to become true, polling each step ms (default 20ms).
async function waitFor(predicate, { timeoutMs = 2000, stepMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

const QUIET = { log: () => {}, warn: () => {}, error: () => {} };

// ── happy path E2E ────────────────────────────────────────────────

test("R1-e-3 E2E: handshake → heartbeat → WS hello round-trip", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-e2e": "boot-aaa" },
  });
  const runId = "rr-e2e-1";
  const runJwt = buildToken(runId, orch.jwtKey);

  const agent = new RunnerAgent(
    {
      bootstrapToken: "boot-aaa",
      hostIdentity: "runner-e2e",
      orchestratorUrl: orch.url,
      runId,
      runJwt,
      heartbeatIntervalMs: 100,         // fast heartbeat for the test
    },
    {
      WebSocketCtor: WebSocket,
      logger: QUIET,
    },
  );

  try {
    await agent.start();
    // (1) handshake worked → runnerToken set, registry sees the host.
    assert.equal(typeof agent.runnerToken, "string");
    assert.equal(agent.runnerToken.length, 64);

    const runners = orch.registry.listRunners();
    assert.equal(runners.length, 1);
    assert.equal(runners[0].hostIdentity, "runner-e2e");

    // (2) WS hello frame arrives within the timeout.
    const helloReceived = await waitFor(() => agent.helloReceived === true);
    assert.equal(helloReceived, true, "WS hello frame should arrive");
    assert.ok(agent.stats.wsConnects >= 1);
    assert.ok(agent.stats.wsHellos >= 1);

    // (3) at least one heartbeat tick fired (interval 100ms, give 500ms).
    const hbFired = await waitFor(() => agent.stats.heartbeatsOk >= 1, { timeoutMs: 500 });
    assert.equal(hbFired, true, "at least one heartbeat tick should land");
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-e-3 E2E: bad bootstrap → handshake throws + agent never reaches WS", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-x": "the-correct-bootstrap" },
  });
  const runId = "rr-bad-bs";
  const runJwt = buildToken(runId, orch.jwtKey);

  const agent = new RunnerAgent(
    {
      bootstrapToken: "wrong-bootstrap-12345",   // length matters for timing-safe compare
      hostIdentity: "runner-x",
      orchestratorUrl: orch.url,
      runId,
      runJwt,
    },
    { WebSocketCtor: WebSocket, logger: QUIET },
  );

  try {
    await assert.rejects(() => agent.start(), /handshake failed: HTTP 401/);
    assert.equal(agent.stats.wsConnects, 0);
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-e-3 E2E: forged runJWT (different signing key) → ws closes 1008, agent stops", async () => {
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-fake-jwt": "boot-bbb" },
  });
  // Forge a JWT with a different key — orchestrator must reject the WS upgrade.
  const otherSetup = setupRemoteRunner({
    env: { HARNESS_REMOTE_MODE: "preview", HARNESS_TOKEN: "completely-different-token" },
  });
  const forgedJwt = buildToken("rr-forge", otherSetup.jwtKey);

  const agent = new RunnerAgent(
    {
      bootstrapToken: "boot-bbb",
      hostIdentity: "runner-fake-jwt",
      orchestratorUrl: orch.url,
      runId: "rr-forge",
      runJwt: forgedJwt,
      reconnectBaseMs: 50,
      reconnectMaxMs: 100,
    },
    { WebSocketCtor: WebSocket, logger: QUIET },
  );

  try {
    await agent.start();   // handshake works (different from JWT)
    // 1008 close is fatal → agent transitions to STOPPED.
    const stopped = await waitFor(() => agent.state === "stopped", { timeoutMs: 1000 });
    assert.equal(stopped, true, "agent should stop after fatal 1008");
    assert.ok(agent.stats.wsDisconnects >= 1);
    assert.equal(agent.helloReceived, false);
  } finally {
    await agent.stop();
    await orch.close();
  }
});

test("R1-e-3 E2E: ledger captures handshake_ok + ws_connected for the run", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r1e3-e2e-ledger-"));
  const orch = await startOrchestrator({
    bootstrapMap: { "runner-audit-e2e": "boot-zzz" },
    ledgerDir: tmp,
  });
  const runId = "rr-audit-e2e";
  const runJwt = buildToken(runId, orch.jwtKey);

  const agent = new RunnerAgent(
    {
      bootstrapToken: "boot-zzz",
      hostIdentity: "runner-audit-e2e",
      orchestratorUrl: orch.url,
      runId,
      runJwt,
      heartbeatIntervalMs: 1000,
    },
    { WebSocketCtor: WebSocket, logger: QUIET },
  );

  try {
    await agent.start();
    await waitFor(() => agent.helloReceived);

    // System ledger receives handshake entries; per-run ledger receives WS entries.
    const sysFile = path.join(tmp, "system", "ledger.jsonl");
    const sysLines = fs.readFileSync(sysFile, "utf-8").trim().split("\n").map(JSON.parse);
    assert.ok(
      sysLines.some((e) => e.type === "runner_handshake_ok"),
      "system ledger should record runner_handshake_ok",
    );

    const runFile = path.join(tmp, runId, "ledger.jsonl");
    const runLines = fs.readFileSync(runFile, "utf-8").trim().split("\n").map(JSON.parse);
    assert.ok(
      runLines.some((e) => e.type === "runner_ws_connected"),
      `run ledger should record runner_ws_connected (got types: ${runLines.map((l) => l.type).join(",")})`,
    );

    // Both chains verify (HMAC signed).
    assert.equal(orch.ledger.verifyChain("system").valid, true);
    assert.equal(orch.ledger.verifyChain(runId).valid, true);
  } finally {
    await agent.stop();
    await orch.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
