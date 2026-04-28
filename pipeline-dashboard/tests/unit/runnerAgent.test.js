// Slice R1-e-3 (Phase D R1, 2026-04-28) — RunnerAgent unit tests.
//
// Locks the agent's transport-only behavior with mocked fetch + ws,
// so the (slow) real-network integration test can stay focused on
// the end-to-end happy path.
//
// Coverage:
//
//   constructor:    required-field validation, dependency injection
//   handshake:      success / non-2xx / malformed response
//   heartbeat:      tick + count + 401 → re-handshake
//   ws connect:     URL shape, hello frame handling
//   ws close:       1008/1011 fatal, others trigger reconnect
//   stop:           cancels timers + closes ws + state goes STOPPED

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { RunnerAgent, configFromEnv, STATES } = require("../../src/runner/runnerAgent");

// ── mocks ──────────────────────────────────────────────────────────

class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    MockWebSocket.lastInstance = this;
  }
  send(data) { this.sent.push(data); }
  close(code, reason) {
    this.readyState = 3;
    // Defer to next tick so the test can listen-then-trigger.
    setImmediate(() => this.emit("close", code, Buffer.from(String(reason || ""))));
  }
}

function makeFetch(handlers) {
  // handlers: Map<urlSubstring, (req) => { ok, status, json: () => any, text: () => string }>
  return async function fetchMock(url, opts = {}) {
    for (const [needle, handler] of handlers.entries()) {
      if (url.indexOf(needle) >= 0) {
        return handler({ url, ...opts });
      }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => "no handler" };
  };
}

function makeQuietLogger() {
  return { log: () => {}, warn: () => {}, error: () => {} };
}

const baseConfig = {
  bootstrapToken: "bootstrap-aaa",
  hostIdentity: "runner-a",
  orchestratorUrl: "http://orch:4201",
  runId: "rr-1",
  runJwt: "header.payload.signature",
};

const baseDeps = (extras = {}) => ({
  WebSocketCtor: MockWebSocket,
  logger: makeQuietLogger(),
  setTimeoutFn: () => null,           // disable real timers in unit tests
  clearTimeoutFn: () => undefined,
  ...extras,
});

// ── constructor ────────────────────────────────────────────────────

test("R1-e-3: constructor validates required fields", () => {
  for (const k of ["bootstrapToken", "hostIdentity", "orchestratorUrl", "runId", "runJwt"]) {
    const cfg = { ...baseConfig, [k]: "" };
    assert.throws(() => new RunnerAgent(cfg, baseDeps({ fetchImpl: () => {} })),
      new RegExp(`${k} is required`));
  }
});

test("R1-e-3: constructor requires fetchImpl + WebSocketCtor", () => {
  // No global fetch in node-test runners isn't a thing in node 24, but
  // we still need to guard the explicit-injection path.
  const origFetch = globalThis.fetch;
  delete globalThis.fetch;
  try {
    assert.throws(() => new RunnerAgent(baseConfig, { WebSocketCtor: MockWebSocket }),
      /fetchImpl required/);
  } finally {
    globalThis.fetch = origFetch;
  }
  assert.throws(() => new RunnerAgent(baseConfig, { fetchImpl: () => {} }),
    /WebSocketCtor required/);
});

test("R1-e-3: constructor strips trailing slash from orchestratorUrl", () => {
  const agent = new RunnerAgent(
    { ...baseConfig, orchestratorUrl: "http://orch:4201///" },
    baseDeps({ fetchImpl: () => {} }),
  );
  assert.equal(agent.config.orchestratorUrl, "http://orch:4201");
});

test("R1-e-3: initial state is IDLE", () => {
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl: () => {} }));
  assert.equal(agent.state, STATES.IDLE);
});

// ── handshake ──────────────────────────────────────────────────────

test("R1-e-3: handshake POSTs Bearer bootstrap and stores runnerToken", async () => {
  let captured;
  const fetchImpl = makeFetch(new Map([
    ["/api/runner/handshake", async (req) => {
      captured = req;
      return {
        ok: true, status: 200,
        json: async () => ({ runnerToken: "x".repeat(64) }),
      };
    }],
  ]));
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  await agent._handshake();
  assert.equal(agent.runnerToken, "x".repeat(64));
  assert.equal(captured.method, "POST");
  assert.equal(captured.headers.Authorization, "Bearer bootstrap-aaa");
  const body = JSON.parse(captured.body);
  assert.equal(body.hostIdentity, "runner-a");
  assert.equal(body.sandboxClass, "container-strict");
});

test("R1-e-3: handshake throws on non-2xx", async () => {
  const fetchImpl = makeFetch(new Map([
    ["/api/runner/handshake", async () => ({
      ok: false, status: 401,
      text: async () => `{"error":"handshake rejected","reason":"bootstrap_invalid"}`,
    })],
  ]));
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  await assert.rejects(() => agent._handshake(), /handshake failed: HTTP 401/);
});

test("R1-e-3: handshake throws when response missing runnerToken", async () => {
  const fetchImpl = makeFetch(new Map([
    ["/api/runner/handshake", async () => ({
      ok: true, status: 200, json: async () => ({}),
    })],
  ]));
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  await assert.rejects(() => agent._handshake(), /missing runnerToken/);
});

// ── heartbeat ──────────────────────────────────────────────────────

test("R1-e-3: heartbeat tick uses runnerToken + bumps stats on 200", async () => {
  let hbReq;
  const fetchImpl = makeFetch(new Map([
    ["/api/runner/heartbeat", async (req) => {
      hbReq = req;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }],
  ]));
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.runnerToken = "the-runner-token";
  agent.state = STATES.RUNNING;
  await agent._heartbeatTick();
  assert.equal(agent.stats.heartbeatsOk, 1);
  assert.equal(agent.stats.heartbeatsFailed, 0);
  assert.equal(hbReq.headers.Authorization, "Bearer the-runner-token");
});

test("R1-e-3: heartbeat 401 triggers re-handshake", async () => {
  let handshakeCount = 0;
  const fetchImpl = makeFetch(new Map([
    ["/api/runner/heartbeat", async () => ({ ok: false, status: 401, json: async () => ({}) })],
    ["/api/runner/handshake", async () => {
      handshakeCount += 1;
      return {
        ok: true, status: 200,
        json: async () => ({ runnerToken: "y".repeat(64) }),
      };
    }],
  ]));
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.runnerToken = "old-token";
  agent.state = STATES.RUNNING;
  await agent._heartbeatTick();
  assert.equal(handshakeCount, 1);
  assert.equal(agent.runnerToken, "y".repeat(64));
  assert.equal(agent.stats.heartbeatsFailed, 1);
});

test("R1-e-3: heartbeat thrown error counts as failure (no crash)", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.runnerToken = "x";
  agent.state = STATES.RUNNING;
  await agent._heartbeatTick();
  assert.equal(agent.stats.heartbeatsFailed, 1);
});

// ── WS connect ─────────────────────────────────────────────────────

test("R1-e-3: _connectWs builds the right URL", () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  assert.ok(agent.ws);
  assert.equal(
    agent.ws.url,
    "ws://orch:4201/api/runner/events?runId=rr-1&token=header.payload.signature",
  );
});

test("R1-e-3: hello frame flips helloReceived + bumps stats", () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  const ws = agent.ws;
  ws.emit("open");
  ws.emit("message", JSON.stringify({ type: "hello", runId: "rr-1", ts: 1 }));
  assert.equal(agent.helloReceived, true);
  assert.equal(agent.stats.wsHellos, 1);
});

test("R1-e-3: hello frame for OTHER runId is ignored", () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  agent.ws.emit("open");
  agent.ws.emit("message", JSON.stringify({ type: "hello", runId: "wrong-run", ts: 1 }));
  assert.equal(agent.helloReceived, false);
  assert.equal(agent.stats.wsHellos, 0);
});

test("R1-e-3: malformed message is dropped silently", () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  agent.ws.emit("open");
  agent.ws.emit("message", "not-json{[}");
  // No crash, and stats.messagesReceived still bumped (1).
  assert.equal(agent.stats.messagesReceived, 1);
  assert.equal(agent.helloReceived, false);
});

test("R1-e-3: ws close 1011 is fatal — agent stops", async () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  const ws = agent.ws;
  ws.emit("close", 1011, Buffer.from("not configured"));
  // stop() is async; give it a microtask.
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.state, STATES.STOPPED);
});

test("R1-e-3: ws close 1008 is fatal — agent stops", async () => {
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({ fetchImpl }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  const ws = agent.ws;
  ws.emit("close", 1008, Buffer.from("JWT rejected"));
  await new Promise((r) => setImmediate(r));
  assert.equal(agent.state, STATES.STOPPED);
});

test("R1-e-3: ws close 1006 (abnormal) triggers reconnect", () => {
  let scheduledDelay;
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({
    fetchImpl,
    setTimeoutFn: (cb, ms) => { scheduledDelay = ms; return 1; },
  }));
  agent.state = STATES.RUNNING;
  agent._connectWs();
  agent.ws.emit("close", 1006, Buffer.from(""));
  assert.equal(agent.state, STATES.RECONNECTING);
  // Backoff: base 1000, attempt 1 → range [500, 1000]
  assert.ok(scheduledDelay >= 500 && scheduledDelay <= 1000,
    `expected 500..1000, got ${scheduledDelay}`);
});

test("R1-e-3: backoff caps at reconnectMaxMs", () => {
  let lastDelay;
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(
    { ...baseConfig, reconnectBaseMs: 1000, reconnectMaxMs: 4000 },
    baseDeps({
      fetchImpl,
      setTimeoutFn: (cb, ms) => { lastDelay = ms; return 1; },
    }),
  );
  agent.state = STATES.RUNNING;
  agent._connectWs();
  // Drive 6 close cycles to exceed the cap (1000, 2000, 4000, 4000...).
  for (let i = 0; i < 6; i++) {
    agent.state = STATES.RUNNING;
    agent._connectWs();
    agent.ws.emit("close", 1006, Buffer.from(""));
  }
  // Last delay should be at-or-below reconnectMaxMs.
  assert.ok(lastDelay <= 4000, `expected ≤ 4000, got ${lastDelay}`);
  assert.ok(lastDelay >= 2000, `expected ≥ 2000 (jitter floor), got ${lastDelay}`);
});

// ── stop ───────────────────────────────────────────────────────────

test("R1-e-3: stop() cancels timers + closes ws + state STOPPED", async () => {
  let cleared = [];
  const fetchImpl = makeFetch(new Map());
  const agent = new RunnerAgent(baseConfig, baseDeps({
    fetchImpl,
    setTimeoutFn: (cb, ms) => Symbol(`timer-${ms}`),
    clearTimeoutFn: (t) => { cleared.push(t); },
  }));
  agent.state = STATES.RUNNING;
  agent._scheduleHeartbeat();
  agent._connectWs();
  await agent.stop();
  assert.equal(agent.state, STATES.STOPPED);
  // At least one clear (heartbeat timer).
  assert.ok(cleared.length >= 1);
});

// ── configFromEnv ──────────────────────────────────────────────────

test("R1-e-3: configFromEnv reads required + optional env keys", () => {
  const env = {
    HARNESS_BOOTSTRAP_TOKEN: "boot",
    HARNESS_HOST_IDENTITY: "host-a",
    HARNESS_ORCHESTRATOR_URL: "http://x",
    HARNESS_RUN_ID: "rr-1",
    HARNESS_RUN_JWT: "j.w.t",
    HARNESS_SANDBOX_CLASS: "vm-strict",
    HARNESS_HEARTBEAT_INTERVAL_MS: "10000",
  };
  const cfg = configFromEnv(env);
  assert.equal(cfg.bootstrapToken, "boot");
  assert.equal(cfg.hostIdentity, "host-a");
  assert.equal(cfg.orchestratorUrl, "http://x");
  assert.equal(cfg.runId, "rr-1");
  assert.equal(cfg.runJwt, "j.w.t");
  assert.equal(cfg.sandboxClass, "vm-strict");
  assert.equal(cfg.heartbeatIntervalMs, 10000);
});

test("R1-e-3: configFromEnv lists all missing required env in one error", () => {
  try {
    configFromEnv({});
    assert.fail("should have thrown");
  } catch (err) {
    assert.match(err.message, /missing required env/);
    // Original config field names get re-rendered into env names.
    for (const expected of [
      "HARNESS_BOOTSTRAP_TOKEN",
      "HARNESS_HOST_IDENTITY",
      "HARNESS_ORCHESTRATOR_URL",
      "HARNESS_RUN_ID",
      "HARNESS_RUN_JWT",
    ]) {
      assert.match(err.message, new RegExp(expected));
    }
  }
});
