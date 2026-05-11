// Slice R1-h (Phase D R1, 2026-04-28) — server.js ↔ runner-routes wiring.
//
// Boots the real createRunnerRoutes against a real RunnerRegistry + real
// EvidenceLedger (with a signing key) and exercises three rollout-gate
// concerns end-to-end:
//
//   G1  workspace boundary closed by default
//       Default env (ORCHESTRATOR_REMOTE_MODE unset) → every runner route 404s.
//       This is the "fail-closed" posture MG1 §10.1 promises.
//
//   G3-tier1  network egress with rootless-preview Tier 1
//       ORCHESTRATOR_REMOTE_MODE=preview + ORCHESTRATOR_TOKEN set → routes accept a
//       valid bootstrap, return a runnerToken, and the runnerToken
//       successfully verifies on the heartbeat. Tier 1 = no nftables
//       enforcement; the orchestrator still controls the *contract*.
//
//   G7-adjacent  graceful release on orchestrator-side run completion
//       claim → release sequence keeps the registry's activeRuns and
//       runId→host mapping clean. (The full G7 — orchestrator shutdown
//       reaping a remote runner-host — needs R1-e + R1-g.)
//
// We mount only createRunnerRoutes here (not server.js itself) so the
// test exercises the route module in isolation while still wiring the
// real registry + jwt + ledger that production wires.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const express = require("express");

const { createRunnerRoutes } = require("../../src/routes/runnerRoutes");
const { setupRemoteRunner } = require("../../src/server/remoteRunnerSetup");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const jwt = require("../../src/security/jwt");

// ── HTTP helpers ──────────────────────────────────────────────────

function startApp(opts) {
  const app = express();
  app.use(express.json());
  app.use("/api", createRunnerRoutes(opts));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function postJson(port, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? "" : JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: urlPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (_) { resolve({ status: res.statusCode, body: text }); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function makeTempLedgerDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "r1h-ledger-"));
  return dir;
}

// ── G1: workspace boundary closed by default ──────────────────────

test("R1-h G1: ORCHESTRATOR_REMOTE_MODE unset → /api/runner/handshake 404s", async () => {
  const setup = setupRemoteRunner({ env: {} });
  const { port, close } = await startApp({
    runnerRegistry: setup.runnerRegistry,
    jwtKey: setup.jwtKey,
    mode: setup.mode,
  });
  try {
    const r = await postJson(port, "/api/runner/handshake", { hostIdentity: "x" }, {
      Authorization: "Bearer anything",
    });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "remote mode disabled");
  } finally {
    await close();
  }
});

test("R1-h G1: default → /api/runner/heartbeat and /api/runner/hook also 404", async () => {
  const setup = setupRemoteRunner({ env: {} });
  const { port, close } = await startApp({ ...setup });
  try {
    const a = await postJson(port, "/api/runner/heartbeat", { hostIdentity: "x" }, {
      Authorization: "Bearer anything",
    });
    const b = await postJson(port, "/api/runner/hook", { runId: "rr-1" }, {
      Authorization: "Bearer anything",
    });
    assert.equal(a.status, 404);
    assert.equal(b.status, 404);
  } finally {
    await close();
  }
});

// ── G3-tier1: preview mode + valid bootstrap ──────────────────────

test("R1-h G3-tier1: preview + ORCHESTRATOR_TOKEN → handshake → heartbeat round-trip", async () => {
  const TOKEN = "test-ikm-for-r1h-integration-aaa";
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: TOKEN },
  });

  // Inject a known bootstrap via env-driven default. RunnerRegistry's
  // default bootstrapTokenFor reads ORCHESTRATOR_REMOTE_RUNNER_TOKEN_<host>
  // from process.env, so we set + clean up.
  const oldBootstrap = process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a"];
  process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a"] = "bootstrap-aaa";

  try {
    const { port, close } = await startApp({ ...setup });
    try {
      // 1. Handshake
      const hs = await postJson(port, "/api/runner/handshake",
        { hostIdentity: "runner-a", sandboxClass: "container-strict" },
        { Authorization: "Bearer bootstrap-aaa" });
      assert.equal(hs.status, 200);
      assert.equal(typeof hs.body.runnerToken, "string");
      assert.equal(hs.body.runnerToken.length, 64);

      // 2. Heartbeat with the issued runnerToken
      const hb = await postJson(port, "/api/runner/heartbeat",
        { hostIdentity: "runner-a" },
        { Authorization: "Bearer " + hs.body.runnerToken });
      assert.equal(hb.status, 200);
      assert.equal(hb.body.ok, true);

      await close();
    } finally { /* server already closed */ }
  } finally {
    if (oldBootstrap === undefined) delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a"];
    else process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_a"] = oldBootstrap;
  }
});

test("R1-h G3-tier1: bad bootstrap → 401 with reason=bootstrap_invalid", async () => {
  const TOKEN = "test-ikm-for-r1h-integration-bbb";
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: TOKEN },
  });
  const oldBootstrap = process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_b"];
  process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_b"] = "the-correct-one";

  try {
    const { port, close } = await startApp({ ...setup });
    try {
      const r = await postJson(port, "/api/runner/handshake",
        { hostIdentity: "runner-b" },
        { Authorization: "Bearer wrong-bootstrap-1" });  // same length as "the-correct-one" => 15
      assert.equal(r.status, 401);
      assert.equal(r.body.reason, "bootstrap_invalid");
    } finally { await close(); }
  } finally {
    if (oldBootstrap === undefined) delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_b"];
    else process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_b"] = oldBootstrap;
  }
});

test("R1-h G3-tier1: /hook accepts a valid runJWT and acknowledges (R1-e wires routeRemote)", async () => {
  const TOKEN = "test-ikm-for-r1h-jwt-flow-ccc";
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: TOKEN },
  });

  // Forge a runJWT for runId="rr-9" using the same key the route will verify with.
  const token = jwt.issue({
    runId: "rr-9",
    key: setup.jwtKey,
    runDurationMs: 60_000,
    orchestrator: { runOrigin: "container-remote", sandboxClass: "container-strict", hostIdentity: "runner-a" },
  });

  const { port, close } = await startApp({ ...setup });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-9", event: { type: "tool_use", tool: "Read" } },
      { Authorization: "Bearer " + token });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.accepted, true);
  } finally { await close(); }
});

test("R1-h G3-tier1: /hook with invalid JWT → 401 reason=signature", async () => {
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: "real-token-here" },
  });

  // Forge a JWT signed with a *different* key — must be rejected.
  const otherSetup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: "different-token" },
  });
  const forged = jwt.issue({
    runId: "rr-9",
    key: otherSetup.jwtKey,
    runDurationMs: 60_000,
  });

  const { port, close } = await startApp({ ...setup });
  try {
    const r = await postJson(port, "/api/runner/hook",
      { runId: "rr-9" },
      { Authorization: "Bearer " + forged });
    assert.equal(r.status, 401);
    // jwt.js VERIFY_REASONS uses lowercase "signature" (frozen in R1-b).
    assert.equal(r.body.reason, "signature");
  } finally { await close(); }
});

// ── Audit ledger receives entries (R1-c HMAC-signed when key present) ──

test("R1-h: handshake success + failure both append signed audit entries", async () => {
  const TOKEN = "ledger-audit-test-token-xyz";
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: TOKEN },
  });
  const tmp = makeTempLedgerDir();
  const ledger = new EvidenceLedger({ rootDir: tmp, signingKey: setup.ledgerKey });

  const oldBootstrap = process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host"];
  process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host"] = "real-bootstrap";

  try {
    const { port, close } = await startApp({ ...setup, ledger });
    try {
      // Success path
      const ok = await postJson(port, "/api/runner/handshake",
        { hostIdentity: "audit-host" },
        { Authorization: "Bearer real-bootstrap" });
      assert.equal(ok.status, 200);

      // Failure path (different host so it's a clean reject — bad bootstrap)
      process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host_2"] = "right-thing-1";
      const fail = await postJson(port, "/api/runner/handshake",
        { hostIdentity: "audit_host_2" },
        { Authorization: "Bearer wrong-thing-1" });  // same length as "right-thing-1"
      assert.equal(fail.status, 401);
      delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host_2"];

      // Both calls should have generated entries on the system ledger.
      // EvidenceLedger writes to <rootDir>/<runId>/ledger.jsonl.
      const sysFile = path.join(tmp, "system", "ledger.jsonl");
      assert.ok(fs.existsSync(sysFile), "system/ledger.jsonl should exist");
      const lines = fs.readFileSync(sysFile, "utf-8").trim().split("\n").map(JSON.parse);
      assert.ok(lines.length >= 2, "at least 2 entries (one ok, one rejected)");
      // All entries should be signed (sigVer:1) since signingKey is set.
      for (const entry of lines) {
        assert.equal(entry.sigVer, 1);
        assert.equal(typeof entry.sig, "string");
      }
      // Hash chain verifies. verifyChain uses { valid, reason }.
      const v = ledger.verifyChain("system");
      assert.equal(v.valid, true, "chain verify must succeed: " + (v.reason || ""));
    } finally { await close(); }
  } finally {
    if (oldBootstrap === undefined) delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host"];
    else process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_audit_host"] = oldBootstrap;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ── G7-adjacent: claim/release wiring stays consistent ─────────────

test("R1-h G7-adj: claim → release leaves registry clean (idempotent + reassign-safe done in R1-d boost)", async () => {
  const TOKEN = "g7-adj-token-ddd";
  const setup = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: TOKEN },
  });
  const oldBootstrap = process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_g7"];
  process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_g7"] = "boot-g7";

  try {
    const { port, close } = await startApp({ ...setup });
    try {
      // Handshake
      const hs = await postJson(port, "/api/runner/handshake",
        { hostIdentity: "runner-g7" },
        { Authorization: "Bearer boot-g7" });
      assert.equal(hs.status, 200);

      // Direct registry use — orchestrator code does this on dispatch.
      assert.equal(setup.runnerRegistry.claimRunForRunner("rr-77", "runner-g7"), true);
      assert.equal(setup.runnerRegistry.listRunners()[0].activeRuns, 1);

      // Release after run completion (orchestrator side / G7 graceful path).
      assert.equal(setup.runnerRegistry.releaseRun("rr-77"), true);
      assert.equal(setup.runnerRegistry.listRunners()[0].activeRuns, 0);
      assert.equal(setup.runnerRegistry._hostFor("rr-77"), null);
    } finally { await close(); }
  } finally {
    if (oldBootstrap === undefined) delete process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_g7"];
    else process.env["ORCHESTRATOR_REMOTE_RUNNER_TOKEN_runner_g7"] = oldBootstrap;
  }
});
