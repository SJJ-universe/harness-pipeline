// Slice R1-d (Phase D R1, 2026-04-28) — runner routes integration.
//
// Mounts createRunnerRoutes against a real RunnerRegistry, real
// EvidenceLedger (with HMAC signing) for audit trail, real
// src/security/jwt.js for JWT verify. Verifies every route's auth +
// happy path + rejection codes.
//
// MF1 §4 gate G2 ("Per-run JWT issuance + revocation tested; expired-
// token rejected with 401 + audit log entry") is partially satisfied
// here — JWT path goes through /api/runner/hook with audit-log entries
// on both ok and reject. Full G2 lands when handshake/heartbeat/hook
// are wired into server.js (later R1 slice).

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const express = require("express");
const { createRunnerRoutes } = require("../../src/routes/runnerRoutes");
const { RunnerRegistry } = require("../../src/runtime/runnerRegistry");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const jwt = require("../../src/security/jwt");

function startApp(opts = {}) {
  const app = express();
  app.use(express.json());
  app.use("/api", createRunnerRoutes(opts));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function postJson(port, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body || {}), "utf-8");
    const req = http.request({
      method: "POST", host: "127.0.0.1", port, path: p,
      headers: { "Content-Type": "application/json", "Content-Length": data.length, ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let parsed = null;
        try { parsed = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, text });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function tmpLedgerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "runner-routes-test-"));
}

// ── feature flag ────────────────────────────────────────────────────

test("R1-d: routes 404 when mode='off' (default)", async () => {
  const { server, port } = await startApp({});
  try {
    const r = await postJson(port, "/api/runner/handshake", { hostIdentity: "x" });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "remote mode disabled");
    assert.equal(r.body.mode, "off");
  } finally {
    server.close();
  }
});

test("R1-d: routes 503 when mode='preview' but registry not wired", async () => {
  const { server, port } = await startApp({ mode: "preview" });
  try {
    const r = await postJson(port, "/api/runner/handshake", { hostIdentity: "x" });
    assert.equal(r.status, 503);
  } finally {
    server.close();
  }
});

// ── /api/runner/handshake ──────────────────────────────────────────

test("R1-d: handshake returns runnerToken on valid bootstrap", async () => {
  const reg = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "host-1" ? "boot-1234567890" : null,
  });
  const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview" });
  try {
    const r = await postJson(port, "/api/runner/handshake",
      { hostIdentity: "host-1", capabilities: { gpu: false }, sandboxClass: "container-strict" },
      { Authorization: "Bearer boot-1234567890" });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.runnerToken, "string");
    assert.equal(r.body.runnerToken.length, 64);
  } finally {
    server.close();
  }
});

test("R1-d: handshake rejects with 401 + reason on wrong bootstrap", async () => {
  const reg = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "host-1" ? "boot-1234567890" : null,
  });
  const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview" });
  try {
    const r = await postJson(port, "/api/runner/handshake",
      { hostIdentity: "host-1" },
      { Authorization: "Bearer wrong-token-xx" });   // same length, wrong value
    assert.equal(r.status, 401);
    assert.equal(r.body.reason, "bootstrap_invalid");
  } finally {
    server.close();
  }
});

test("R1-d: handshake 400 when hostIdentity or Authorization missing", async () => {
  const reg = new RunnerRegistry({ bootstrapTokenFor: () => "x".repeat(16) });
  const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview" });
  try {
    const a = await postJson(port, "/api/runner/handshake", {});  // no auth + no body
    assert.equal(a.status, 400);
    const b = await postJson(port, "/api/runner/handshake", { hostIdentity: "h" });  // no auth
    assert.equal(b.status, 400);
  } finally {
    server.close();
  }
});

test("R1-d: handshake writes ledger entries on ok + reject (when ledger wired)", async () => {
  const dir = tmpLedgerDir();
  try {
    const reg = new RunnerRegistry({
      bootstrapTokenFor: (h) => h === "host-1" ? "boot-1234567890" : null,
    });
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview", ledger });
    try {
      // Reject path first (host_unknown).
      await postJson(port, "/api/runner/handshake",
        { hostIdentity: "host-9" },
        { Authorization: "Bearer x" });
      // Success path.
      await postJson(port, "/api/runner/handshake",
        { hostIdentity: "host-1" },
        { Authorization: "Bearer boot-1234567890" });
    } finally {
      server.close();
    }
    const entries = ledger.read("system");
    assert.equal(entries.length, 2);
    assert.equal(entries[0].type, "runner_handshake_rejected");
    assert.equal(entries[0].data.reason, "host_unknown");
    assert.equal(entries[1].type, "runner_handshake_ok");
    assert.equal(entries[1].data.hostIdentity, "host-1");
    // Both entries are signed.
    assert.equal(typeof entries[0].sig, "string");
    assert.equal(entries[1].sigVer, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── /api/runner/heartbeat ──────────────────────────────────────────

test("R1-d: heartbeat happy path with runnerToken from handshake", async () => {
  const reg = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "host-1" ? "boot-1234567890" : null,
  });
  const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview" });
  try {
    const hs = await postJson(port, "/api/runner/handshake",
      { hostIdentity: "host-1" },
      { Authorization: "Bearer boot-1234567890" });
    const tok = hs.body.runnerToken;
    const r = await postJson(port, "/api/runner/heartbeat",
      { hostIdentity: "host-1" },
      { Authorization: "Bearer " + tok });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  } finally {
    server.close();
  }
});

test("R1-d: heartbeat rejects with 401 + reason on wrong runnerToken", async () => {
  const reg = new RunnerRegistry({
    bootstrapTokenFor: (h) => h === "host-1" ? "boot-1234567890" : null,
  });
  const { server, port } = await startApp({ runnerRegistry: reg, mode: "preview" });
  try {
    await postJson(port, "/api/runner/handshake",
      { hostIdentity: "host-1" },
      { Authorization: "Bearer boot-1234567890" });
    const r = await postJson(port, "/api/runner/heartbeat",
      { hostIdentity: "host-1" },
      { Authorization: "Bearer " + "0".repeat(64) });
    assert.equal(r.status, 401);
    assert.equal(r.body.reason, "token_invalid");
  } finally {
    server.close();
  }
});

// ── /api/runner/hook (G2 partial) ──────────────────────────────────

test("R1-d: hook accepts a valid JWT, returns ok + accepted", async () => {
  const reg = new RunnerRegistry();
  const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
  const tok = jwt.issue({ runId: "rr-1", key: jwtKey });
  const { server, port } = await startApp({
    runnerRegistry: reg, mode: "preview", jwtKey,
  });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-1", event: { type: "phase_update", data: { phase: "B" } } },
      { Authorization: "Bearer " + tok });
    assert.equal(r.status, 200);
    assert.equal(r.body.accepted, true);
  } finally {
    server.close();
  }
});

test("R1-d: hook rejects expired JWT with 401 + reason=expired", async () => {
  const reg = new RunnerRegistry();
  const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
  // Issue with iat far in the past so it's already expired.
  const tok = jwt.issue({
    runId: "rr-1", key: jwtKey, runDurationMs: 1000, now: 1000000,
  });
  const { server, port } = await startApp({
    runnerRegistry: reg, mode: "preview", jwtKey,
  });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-1", event: { type: "phase_update", data: {} } },
      { Authorization: "Bearer " + tok });
    assert.equal(r.status, 401);
    assert.equal(r.body.reason, "expired");
  } finally {
    server.close();
  }
});

test("R1-d: hook rejects mismatched runId (aud_mismatch)", async () => {
  const reg = new RunnerRegistry();
  const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
  const tok = jwt.issue({ runId: "rr-1", key: jwtKey });
  const { server, port } = await startApp({
    runnerRegistry: reg, mode: "preview", jwtKey,
  });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-2", event: { type: "phase_update", data: {} } },
      { Authorization: "Bearer " + tok });
    assert.equal(r.status, 401);
    assert.equal(r.body.reason, "aud_mismatch");
  } finally {
    server.close();
  }
});

test("R1-d: hook ledger entry on reject carries the reason code", async () => {
  const dir = tmpLedgerDir();
  try {
    const reg = new RunnerRegistry();
    const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const { server, port } = await startApp({
      runnerRegistry: reg, mode: "preview", jwtKey, ledger,
    });
    try {
      // Garbage token → structure rejection.
      await postJson(port, "/api/runner/hook",
        { runId: "rr-1", event: {} },
        { Authorization: "Bearer not-a-jwt" });
    } finally {
      server.close();
    }
    const entries = ledger.read("rr-1");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, "runner_hook_rejected");
    assert.equal(entries[0].data.reason, "structure");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-d: hook delegates to hookRouter.routeRemote on success", async () => {
  const reg = new RunnerRegistry();
  const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
  const tok = jwt.issue({ runId: "rr-1", key: jwtKey });
  let received = null;
  const hookRouter = {
    routeRemote(runId, payload) {
      received = { runId, payload };
    },
  };
  const { server, port } = await startApp({
    runnerRegistry: reg, mode: "preview", jwtKey, hookRouter,
  });
  try {
    await postJson(port, "/api/runner/hook",
      { runId: "rr-1", event: { type: "tool_recorded", data: { tool: "Edit" } } },
      { Authorization: "Bearer " + tok });
  } finally {
    server.close();
  }
  assert.ok(received, "hookRouter.routeRemote was invoked");
  assert.equal(received.runId, "rr-1");
  assert.equal(received.payload.type, "tool_recorded");
});

test("R1-d: hook returns 500 if hookRouter throws (instead of leaking the error)", async () => {
  const reg = new RunnerRegistry();
  const jwtKey = jwt.deriveJwtKey("test-token-abcdef0123456789");
  const tok = jwt.issue({ runId: "rr-1", key: jwtKey });
  const hookRouter = {
    routeRemote() { throw new Error("downstream blew up"); },
  };
  const { server, port } = await startApp({
    runnerRegistry: reg, mode: "preview", jwtKey, hookRouter,
  });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-1", event: {} },
      { Authorization: "Bearer " + tok });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "hook routing failed");
  } finally {
    server.close();
  }
});
