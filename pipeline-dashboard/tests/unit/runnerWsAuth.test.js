// Slice R1-e-1 (Phase D R1, 2026-04-28) — runner WS auth unit tests.
//
// Locks the path-aware demux contract that R1-e-2 (server.js wiring)
// depends on:
//
//   - mode/key gating mirrors ORCHESTRATOR_REMOTE_MODE — "off" closes
//     every upgrade with WS code 1011, NOT 1008. This is intentional:
//     1008 is "policy violation" (caller error), 1011 is "internal
//     error" (server can't honor). When the orchestrator is misconfigured
//     the runner should treat it as transient and retry.
//   - URL-param protocol: runId + token both required, neither inferred
//   - JWT verification path uses the same VERIFY_REASONS taxonomy as
//     /api/runner/hook (R1-d), so audit ledger entries are uniform
//   - canonical path predicate: only `/api/runner/events` (exact),
//     NOT a prefix — guards against suffix smuggling

const test = require("node:test");
const assert = require("node:assert/strict");
const { createRunnerWsAuth, isRunnerWsPath } = require("../../src/server/runnerWsAuth");
const { setupRemoteRunner } = require("../../src/server/remoteRunnerSetup");
const jwt = require("../../src/security/jwt");

function setupLive(token = "ws-auth-test-token") {
  return setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: token },
  });
}

function makeReq({ url = "/api/runner/events", host = "127.0.0.1:4201" } = {}) {
  return { url, headers: { host }, socket: { remoteAddress: "10.1.2.3" } };
}

function buildToken(runId, key, orchestrator = {}) {
  return jwt.issue({
    runId,
    key,
    runDurationMs: 60_000,
    orchestrator: { runOrigin: "container-remote", sandboxClass: "container-strict", ...orchestrator },
  });
}

// ── isRunnerWsPath ────────────────────────────────────────────────

test("R1-e-1: isRunnerWsPath matches the canonical path exactly", () => {
  assert.equal(isRunnerWsPath("/api/runner/events"), true);
  assert.equal(isRunnerWsPath("/api/runner/events?runId=x&token=y"), true);
});

test("R1-e-1: isRunnerWsPath rejects suffixes (no `/api/runner/events/foo`)", () => {
  assert.equal(isRunnerWsPath("/api/runner/events/foo"), false);
  assert.equal(isRunnerWsPath("/api/runner/eventsfoo"), false);
  assert.equal(isRunnerWsPath("/api/runner"), false);
  assert.equal(isRunnerWsPath("/api/runner/handshake"), false);
});

test("R1-e-1: isRunnerWsPath rejects non-strings safely", () => {
  assert.equal(isRunnerWsPath(null), false);
  assert.equal(isRunnerWsPath(undefined), false);
  assert.equal(isRunnerWsPath(123), false);
});

// ── disabled when mode=off or key missing ─────────────────────────

test("R1-e-1: mode=off → 1011 (internal error, not 1008)", () => {
  const verify = createRunnerWsAuth({ mode: "off", jwtKey: Buffer.alloc(32) });
  const r = verify(makeReq());
  assert.equal(r.ok, false);
  assert.equal(r.code, 1011);
  assert.match(r.reason, /not configured/i);
});

test("R1-e-1: jwtKey null → 1011 even when mode=preview", () => {
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: null });
  const r = verify(makeReq());
  assert.equal(r.ok, false);
  assert.equal(r.code, 1011);
});

test("R1-e-1: jwtKey empty string → 1011 (truthy guard)", () => {
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: "" });
  const r = verify(makeReq());
  assert.equal(r.ok, false);
  assert.equal(r.code, 1011);
});

// ── URL-param contract ────────────────────────────────────────────

test("R1-e-1: missing runId + token → 1008", () => {
  const setup = setupLive();
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: "/api/runner/events" }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1008);
  assert.match(r.reason, /required/);
});

test("R1-e-1: runId only (token missing) → 1008", () => {
  const setup = setupLive();
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: "/api/runner/events?runId=rr-1" }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1008);
});

test("R1-e-1: token only (runId missing) → 1008", () => {
  const setup = setupLive();
  const token = buildToken("rr-1", setup.jwtKey);
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: `/api/runner/events?token=${token}` }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1008);
});

// ── happy path ────────────────────────────────────────────────────

test("R1-e-1: valid runJWT round-trip → ok + orchestrator sub-claim exposed", () => {
  const setup = setupLive();
  const token = buildToken("rr-42", setup.jwtKey, { hostIdentity: "runner-a" });
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: `/api/runner/events?runId=rr-42&token=${token}` }));
  assert.equal(r.ok, true);
  assert.equal(r.runId, "rr-42");
  assert.equal(r.hostIdentity, "runner-a");
  assert.equal(r.runOrigin, "container-remote");
  assert.equal(r.sandboxClass, "container-strict");
  assert.ok(r.payload);
  assert.equal(r.payload.sub, "rr-42");
});

test("R1-e-1: orchestrator sub-claim is optional — missing fields tolerated", () => {
  const setup = setupLive();
  // Issue a token without `orchestrator` sub-claim — `issue` defaults to {}
  // when orchestrator is omitted.
  const token = jwt.issue({ runId: "rr-99", key: setup.jwtKey, runDurationMs: 60_000 });
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: `/api/runner/events?runId=rr-99&token=${token}` }));
  assert.equal(r.ok, true);
  assert.equal(r.runId, "rr-99");
  assert.equal(r.hostIdentity, null);
  assert.equal(r.runOrigin, null);
  assert.equal(r.sandboxClass, null);
});

// ── JWT rejection ─────────────────────────────────────────────────

test("R1-e-1: forged JWT (wrong key) → 1008 with jwtReason=signature", () => {
  const setupA = setupLive("token-A");
  const setupB = setupLive("token-B");
  // Issue with key B but verify with key A — must fail.
  const token = buildToken("rr-1", setupB.jwtKey);
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setupA.jwtKey });
  const r = verify(makeReq({ url: `/api/runner/events?runId=rr-1&token=${token}` }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1008);
  assert.equal(r.jwtReason, "signature");
  // The visible reason field is generic — the precise reason is in jwtReason
  // and intended for ledger entries, not the WS close frame.
  assert.match(r.reason, /JWT rejected/);
});

test("R1-e-1: runId mismatch (token sub != URL runId) → 1008 sub_mismatch", () => {
  const setup = setupLive();
  // Token issued for rr-A, but URL claims rr-B.
  const token = buildToken("rr-A", setup.jwtKey);
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  const r = verify(makeReq({ url: `/api/runner/events?runId=rr-B&token=${token}` }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1008);
  // jwt.verify checks aud first, then sub — for our issuer that means
  // aud_mismatch fires first since aud uses the URL runId.
  assert.equal(r.jwtReason, "aud_mismatch");
});

// ── malformed URL ─────────────────────────────────────────────────

test("R1-e-1: malformed URL → 1008", () => {
  const setup = setupLive();
  const verify = createRunnerWsAuth({ mode: "preview", jwtKey: setup.jwtKey });
  // Pass an obviously-bad URL — the constructor must throw.
  const r = verify({ url: "http://[bad", headers: {}, socket: {} });
  assert.equal(r.ok, false);
  // Either malformed URL OR missing params — both yield 1008.
  assert.equal(r.code, 1008);
});
