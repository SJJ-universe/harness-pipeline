// Slice R1-h (Phase D R1, 2026-04-28) — remoteRunnerSetup unit tests.
//
// The setup helper is a small env-reader + key-deriver, so the tests are
// also small. They lock the contract that server.js depends on:
//
//   - default mode is "off" (and unrecognized strings fall back to "off")
//   - "preview" / "on" without ORCHESTRATOR_TOKEN return a token_missing
//     degraded shape — server.js logs + still 503s on the routes
//   - jwtKey and ledgerKey both derive from the same token but use
//     different `info` labels, so they're guaranteed not equal

const test = require("node:test");
const assert = require("node:assert/strict");
const { setupRemoteRunner } = require("../../src/server/remoteRunnerSetup");

test("R1-h: default (ORCHESTRATOR_REMOTE_MODE unset) → mode=off, no registry, no keys", () => {
  const out = setupRemoteRunner({ env: {} });
  assert.equal(out.mode, "off");
  assert.equal(out.runnerRegistry, null);
  assert.equal(out.jwtKey, null);
  assert.equal(out.ledgerKey, null);
  assert.equal(out.error, null);
});

test("R1-h: ORCHESTRATOR_REMOTE_MODE=garbage → falls back to off (input not blindly trusted)", () => {
  const out = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "deploy-please" } });
  assert.equal(out.mode, "off");
  assert.equal(out.runnerRegistry, null);
});

test("R1-h: mode=preview + ORCHESTRATOR_TOKEN → registry + both keys derived", () => {
  const out = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "preview", ORCHESTRATOR_TOKEN: "secret-ikm-32-bytes-min-please-ok" },
  });
  assert.equal(out.mode, "preview");
  assert.ok(out.runnerRegistry, "registry should be constructed");
  assert.ok(Buffer.isBuffer(out.jwtKey), "jwtKey should be a Buffer");
  assert.ok(Buffer.isBuffer(out.ledgerKey), "ledgerKey should be a Buffer");
  assert.equal(out.jwtKey.length, 32);
  assert.equal(out.ledgerKey.length, 32);
  assert.equal(out.error, null);
});

test("R1-h: jwtKey ≠ ledgerKey (domain-separation via info= labels)", () => {
  const out = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "on", ORCHESTRATOR_TOKEN: "shared-ikm-for-this-test" },
  });
  // Same IKM, different info → independent keyspaces. Compromising one
  // must NOT compromise the other.
  assert.notEqual(out.jwtKey.toString("hex"), out.ledgerKey.toString("hex"));
});

test("R1-h: mode=preview without ORCHESTRATOR_TOKEN → degraded with error: token_missing", () => {
  const out = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "preview" } });
  assert.equal(out.mode, "preview");
  assert.equal(out.runnerRegistry, null);
  assert.equal(out.jwtKey, null);
  assert.equal(out.ledgerKey, null);
  assert.equal(out.error, "token_missing");
});

test("R1-h: explicit opts override env (mode + token)", () => {
  const out = setupRemoteRunner({
    env: { ORCHESTRATOR_REMOTE_MODE: "off", ORCHESTRATOR_TOKEN: "env-token" },
    mode: "preview",
    token: "explicit-token-overrides",
  });
  assert.equal(out.mode, "preview");
  assert.ok(out.runnerRegistry);
  assert.ok(Buffer.isBuffer(out.jwtKey));
});

test("R1-h: derived keys are deterministic for the same token (same input → same output)", () => {
  const a = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "on", ORCHESTRATOR_TOKEN: "abc-123" } });
  const b = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "on", ORCHESTRATOR_TOKEN: "abc-123" } });
  assert.equal(a.jwtKey.toString("hex"), b.jwtKey.toString("hex"));
  assert.equal(a.ledgerKey.toString("hex"), b.ledgerKey.toString("hex"));
});

test("R1-h: different tokens derive different keys", () => {
  const a = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "on", ORCHESTRATOR_TOKEN: "token-A" } });
  const b = setupRemoteRunner({ env: { ORCHESTRATOR_REMOTE_MODE: "on", ORCHESTRATOR_TOKEN: "token-B" } });
  assert.notEqual(a.jwtKey.toString("hex"), b.jwtKey.toString("hex"));
});
