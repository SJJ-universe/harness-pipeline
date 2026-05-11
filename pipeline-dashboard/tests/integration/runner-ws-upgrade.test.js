// Slice R1-e-2 (Phase D R1, 2026-04-28) — runner WS upgrade end-to-end.
//
// Boots a minimal http + WebSocketServer matching server.js's wiring:
//   - One WebSocketServer attached to one http.Server
//   - On connection, demux on `req.url` via `isRunnerWsPath`
//   - Runner path → verifyRunnerWsConnection + handleRunnerWsConnection
//   - Other paths → close immediately (this test file doesn't exercise
//     dashboard auth — that's covered by ws-loopback-guard.test.js)
//
// The test then connects with the `ws` client library and asserts:
//   - Valid runJWT → connection accepted, hello frame received
//   - Missing token → close 1008
//   - Forged JWT → close 1008
//   - mode=off → close 1011 (transient — runner can retry)
//
// PLUS a source-grep test on server.js asserting the demux wiring is
// present, so a future commit removing the path-aware demux can't slip
// through (the in-process integration test would still pass — only the
// source-grep catches drift in the production wire).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { WebSocketServer, WebSocket } = require("ws");

const { createRunnerWsAuth, isRunnerWsPath } = require("../../src/server/runnerWsAuth");
const { createRunnerWsHandler, HELLO_TYPE } = require("../../src/server/runnerWsHandler");
const { setupRemoteRunner } = require("../../src/server/remoteRunnerSetup");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const jwt = require("../../src/security/jwt");

// ── mini-server orchestrator ───────────────────────────────────────────

function startMini({ mode = "preview", token = "ws-e2e-token-aaa", ledgerDir = null } = {}) {
  const setup = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: mode, ORCHESTRATOR_TOKEN: token } });
  const ledger = ledgerDir
    ? new EvidenceLedger({ rootDir: ledgerDir, signingKey: setup.ledgerKey })
    : null;

  const verifyRunner = createRunnerWsAuth({ jwtKey: setup.jwtKey, mode: setup.mode });
  const handleRunner = createRunnerWsHandler({ ledger });

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

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
    // Non-runner path is rejected in this minimal orchestrator so the test
    // doesn't accidentally get a "happy" path through the unrelated
    // dashboard auth. server.js uses verifyWsConnection here.
    try { ws.close(1008, "non-runner path"); } catch (_) {}
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        setup,
        ledger,
        close: () => new Promise((r) => {
          wss.close(() => server.close(() => r()));
        }),
      });
    });
  });
}

function buildToken(runId, key, orchestrator = {}) {
  return jwt.issue({
    runId,
    key,
    runDurationMs: 60_000,
    orchestrator: {
      runOrigin: "container-remote",
      sandboxClass: "container-strict",
      hostIdentity: "runner-aaa",
      ...orchestrator,
    },
  });
}

function connectWs(port, urlPath) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${urlPath}`);
    const events = [];
    let resolved = false;
    const finish = (kind, payload) => {
      if (resolved) return;
      resolved = true;
      resolve({ kind, payload, events, ws });
    };
    ws.on("open", () => events.push({ kind: "open" }));
    ws.on("message", (msg) => {
      events.push({ kind: "message", text: msg.toString() });
      // Resolve on first message — that's the hello frame.
      if (!resolved) finish("message", msg.toString());
    });
    ws.on("close", (code, reason) => {
      events.push({ kind: "close", code, reason: String(reason) });
      finish("close", { code, reason: String(reason) });
    });
    ws.on("error", () => { /* swallow — close event arrives anyway */ });
    setTimeout(() => finish("timeout", null), 1000);
  });
}

// ── happy path ────────────────────────────────────────────────────

test("R1-e-2: valid runJWT → upgrade accepted + hello frame", async () => {
  const orchestrator = await startMini();
  const token = buildToken("rr-1", orchestrator.setup.jwtKey);

  const result = await connectWs(orchestrator.port, `/api/runner/events?runId=rr-1&token=${token}`);
  try {
    assert.equal(result.kind, "message", "first event should be the hello frame");
    const msg = JSON.parse(result.payload);
    assert.equal(msg.type, HELLO_TYPE);
    assert.equal(msg.runId, "rr-1");
    assert.equal(typeof msg.ts, "number");
  } finally {
    try { result.ws.close(); } catch (_) {}
    await orchestrator.close();
  }
});

// ── auth rejections ───────────────────────────────────────────────

test("R1-e-2: no runId/token → close 1008", async () => {
  const orchestrator = await startMini();
  const result = await connectWs(orchestrator.port, "/api/runner/events");
  try {
    assert.equal(result.kind, "close");
    assert.equal(result.payload.code, 1008);
    assert.match(result.payload.reason, /required/);
  } finally {
    await orchestrator.close();
  }
});

test("R1-e-2: forged JWT (different key) → close 1008", async () => {
  const orchestrator = await startMini({ token: "real-token" });
  const otherSetup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: "different-token" },
  });
  const forged = buildToken("rr-1", otherSetup.jwtKey);

  const result = await connectWs(orchestrator.port, `/api/runner/events?runId=rr-1&token=${forged}`);
  try {
    assert.equal(result.kind, "close");
    assert.equal(result.payload.code, 1008);
  } finally {
    await orchestrator.close();
  }
});

test("R1-e-2: mode=off → close 1011 (transient, retryable)", async () => {
  const orchestrator = await startMini({ mode: "off" });
  const result = await connectWs(orchestrator.port, "/api/runner/events?runId=rr-1&token=anything");
  try {
    assert.equal(result.kind, "close");
    assert.equal(result.payload.code, 1011);
    assert.match(result.payload.reason, /not configured/i);
  } finally {
    await orchestrator.close();
  }
});

// ── ledger audit trail ────────────────────────────────────────────

test("R1-e-2: connect emits runner_ws_connected; close emits runner_ws_disconnected", async () => {
  const os = require("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r1e2-ledger-"));
  const orchestrator = await startMini({ ledgerDir: tmp });
  try {
    const token = buildToken("rr-audit-1", orchestrator.setup.jwtKey);
    const result = await connectWs(orchestrator.port, `/api/runner/events?runId=rr-audit-1&token=${token}`);
    try { result.ws.close(1000, "test done"); } catch (_) {}
    // Wait briefly for close to propagate to ledger.
    await new Promise((r) => setTimeout(r, 100));

    const file = path.join(tmp, "rr-audit-1", "ledger.jsonl");
    const lines = fs.readFileSync(file, "utf-8").trim().split("\n").map(JSON.parse);
    const types = lines.map((l) => l.type);
    assert.ok(types.includes("runner_ws_connected"), "expected runner_ws_connected");
    assert.ok(types.includes("runner_ws_disconnected"), "expected runner_ws_disconnected");

    // Audit chain validates (HMAC-signed since signingKey was set).
    const v = orchestrator.ledger.verifyChain("rr-audit-1");
    assert.equal(v.valid, true, "chain verify must succeed: " + (v.reason || ""));
  } finally {
    await orchestrator.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── source-grep on server.js ──────────────────────────────────────

test("R1-e-2: server.js wires path-aware demux with createRunnerWsAuth", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../../server.js"), "utf-8");
  // Demux predicate must be present + invoked before the dashboard gate.
  assert.match(src, /isRunnerWsPath\(req\.url\)/, "server.js must demux on isRunnerWsPath(req.url)");
  // Both factories must be wired with the remote runner's JWT key + mode.
  assert.match(src, /createRunnerWsAuth\(\{[\s\S]*?jwtKey:\s*_remoteRunner\.jwtKey/, "must construct verifyRunnerWsConnection from _remoteRunner.jwtKey");
  assert.match(src, /createRunnerWsHandler\(/, "must construct handleRunnerWsConnection");
  // Order check: demux comes before verifyWsConnection invocation.
  const demuxIdx = src.search(/isRunnerWsPath\(req\.url\)/);
  const dashIdx = src.search(/verifyWsConnection\(req\)/);
  assert.ok(demuxIdx > 0 && dashIdx > 0 && demuxIdx < dashIdx,
    "isRunnerWsPath demux must execute before verifyWsConnection");
});
