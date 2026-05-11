// tests/unit/d1d-runner-integration.test.js — Slice D1-d (Phase E1, 2026-04-29)
//
// Verifies that ClaudeRunner + CodexRunner integrate profileSpawn (D1-c)
// correctly, that public-sector defense-in-depth fires from the runner
// itself (not just inside profileSpawn), and that the profile_spawn_env_built
// audit emits with the right shape.
//
// Why a single test file for both runners:
//   The wiring is symmetric (same imports, same constructor args, same
//   spawn-site replacement). Co-locating the tests keeps the contract
//   visible in one place — if a future refactor diverges the two
//   runners, the tests fail together.
//
// What's NOT tested here (separate test files own these):
//   - The actual Claude / Codex CLI invocation (integration tests).
//   - The dangerGate decision path (already covered).
//   - The semaphore acquisition (childSemaphore unit tests).
//   - The CodexRunner streaming/redact pipeline (codex-runner main tests).

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const { ClaudeRunner } = require("../../executor/claude-runner");
const { CodexRunner } = require("../../executor/codex-runner");

// ── stub helpers ──────────────────────────────────────────────

function makeProfileStore(profiles = [], activeId = null) {
  const map = new Map();
  for (const p of profiles) map.set(p.id, p);
  return {
    get(id) { return map.get(id) || null; },
    list() { return Array.from(map.values()); },
    getActive() { return map.get(activeId) || null; },
    getActiveId() { return activeId; },
  };
}

function makeCredentialStore(map = {}) {
  return {
    async getSecret(profileId, key) {
      return (map[profileId] && map[profileId][key]) || null;
    },
  };
}

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) { entries.push({ runId, ...entry }); },
  };
}

function sampleProfile(id = "personal", secretIds = ["ANTHROPIC_API_KEY"]) {
  return {
    id,
    label: `Profile ${id}`,
    workspacePath: process.platform === "win32"
      ? `C:\\workspace\\${id}`
      : `/tmp/workspace/${id}`,
    activeProvider: "claude",
    secretIds,
  };
}

// Fake child for CodexRunner (which accepts spawnImpl injection).
// Returns a stub that synthesizes a "successful exit code 0" sequence
// without actually launching anything. The `env` argument is captured
// so the test can assert what the runner attempted to pass through.
function makeFakeSpawn() {
  const calls = [];
  function spawnImpl(cmd, args, options) {
    calls.push({ cmd, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      on() {},
      write() {},
      end() {},
    };
    child.kill = () => {};
    // Synthesize a minimal success on next tick so the runner's
    // close handler fires and resolves with ok:true. We emit a tiny
    // codex-shaped output so summary/findings extractors don't choke.
    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from("## Summary\nok\n"));
      child.emit("close", 0);
    });
    return child;
  }
  spawnImpl.calls = calls;
  return spawnImpl;
}

// ─────────────────────────────────────────────────────────────────
//  PUBLIC-SECTOR DEFENSE-IN-DEPTH
//
//  These fire BEFORE profileSpawn — even if profileSpawn somehow
//  got bypassed by a future refactor, the runner-level assertion
//  still blocks the local executor path.
// ─────────────────────────────────────────────────────────────────

test("D1-d ClaudeRunner: public-sector mode refuses spawn (defense-in-depth)", async (t) => {
  // We simulate public-sector posture by stubbing process.env for the
  // duration of this test. The runner reads it via resolveDeploymentProfile()
  // at spawn time.
  const prev = process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE;
  process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE = "public-sector";
  t.after(() => {
    if (prev === undefined) delete process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE;
    else process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE = prev;
  });

  // Even WITHOUT profileStore/credentialStore wired (the P0 fallback
  // path), public-sector must still block. This is the defense-in-depth
  // property — the runner doesn't depend on profileSpawn for the gate.
  const runner = new ClaudeRunner({});
  const result = await runner.exec("test prompt", { timeoutMs: 1000 });

  assert.equal(result.ok, false, "public-sector must refuse the spawn");
  assert.equal(result.code, "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED",
    "failure must carry the policy code so callers can map to the right HTTP status");
  assert.match(result.error, /local executor disabled/);
});

test("D1-d CodexRunner: public-sector mode refuses spawn (defense-in-depth)", async (t) => {
  const prev = process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE;
  process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE = "public-sector";
  t.after(() => {
    if (prev === undefined) delete process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE;
    else process.env.ORCHESTRATOR_DEPLOYMENT_PROFILE = prev;
  });

  // Use a fake spawn just so we can verify it never gets called.
  const fakeSpawn = makeFakeSpawn();
  const runner = new CodexRunner({ spawnImpl: fakeSpawn });
  const result = await runner.exec("test prompt", { timeoutMs: 1000 });

  assert.equal(result.ok, false);
  assert.equal(result.code, "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED");
  assert.equal(fakeSpawn.calls.length, 0,
    "spawn must NEVER be invoked when public-sector blocks the path");
});

// ─────────────────────────────────────────────────────────────────
//  buildSpawnEnv FAILURE SURFACES
//
//  When buildSpawnEnv throws (deleted profile / missing credential),
//  the runner must resolve with a structured failure — not an
//  unhandled rejection.
// ─────────────────────────────────────────────────────────────────

test("D1-d ClaudeRunner: deleted profile surfaces structured failure", async () => {
  const profileStore = makeProfileStore([]); // empty — "personal" not present
  const credentialStore = makeCredentialStore({});
  const runner = new ClaudeRunner({ profileStore, credentialStore });

  const result = await runner.exec("test prompt", {
    timeoutMs: 1000,
    profileId: "personal", // doesn't exist
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /spawn env build failed/);
  assert.match(result.error, /no profile with id "personal"/);
});

test("D1-d ClaudeRunner: missing credential refuses spawn (no partial-credential)", async () => {
  const profile = sampleProfile("personal", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const profileStore = makeProfileStore([profile]);
  // credentialStore has only ANTHROPIC_API_KEY, OPENAI is missing.
  const credentialStore = makeCredentialStore({
    personal: { ANTHROPIC_API_KEY: "sk-aaa" },
  });
  const runner = new ClaudeRunner({ profileStore, credentialStore });

  const result = await runner.exec("test prompt", {
    timeoutMs: 1000,
    profileId: "personal",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /requires secret "OPENAI_API_KEY"/);
});

test("D1-d CodexRunner: deleted profile surfaces structured failure", async () => {
  const profileStore = makeProfileStore([]);
  const credentialStore = makeCredentialStore({});
  const fakeSpawn = makeFakeSpawn();
  const runner = new CodexRunner({
    spawnImpl: fakeSpawn,
    profileStore,
    credentialStore,
  });

  const result = await runner.exec("test prompt", {
    timeoutMs: 1000,
    profileId: "ghost",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /no profile with id "ghost"/);
  assert.equal(fakeSpawn.calls.length, 0);
});

test("D1-d CodexRunner: missing credential refuses spawn", async () => {
  const profile = sampleProfile("personal", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const profileStore = makeProfileStore([profile]);
  const credentialStore = makeCredentialStore({
    personal: { ANTHROPIC_API_KEY: "sk-aaa" },
  });
  const fakeSpawn = makeFakeSpawn();
  const runner = new CodexRunner({
    spawnImpl: fakeSpawn,
    profileStore,
    credentialStore,
  });

  const result = await runner.exec("test prompt", {
    timeoutMs: 1000,
    profileId: "personal",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /requires secret "OPENAI_API_KEY"/);
  assert.equal(fakeSpawn.calls.length, 0);
});

// ─────────────────────────────────────────────────────────────────
//  PROFILE-MODE SUCCESS PATH (CodexRunner only — has spawnImpl injection)
//
//  Verifies:
//   - spawn() receives env that contains the injected secret + telemetry
//   - profile_spawn_env_built audit fires with the right metadata
//   - audit data does NOT contain the secret value
// ─────────────────────────────────────────────────────────────────

test("D1-d CodexRunner: profile-mode injects credentials into spawn env", async () => {
  const profile = sampleProfile("personal", ["ANTHROPIC_API_KEY"]);
  const profileStore = makeProfileStore([profile], "personal");
  const credentialStore = makeCredentialStore({
    personal: { ANTHROPIC_API_KEY: "sk-from-profile-keychain" },
  });
  const fakeSpawn = makeFakeSpawn();
  const ledger = makeLedger();

  const runner = new CodexRunner({
    spawnImpl: fakeSpawn,
    profileStore,
    credentialStore,
    ledger,
  });

  // No explicit profileId passed → runner picks up profileStore.getActiveId().
  const result = await runner.exec("test prompt", { timeoutMs: 5000 });

  assert.equal(result.ok, true,
    `expected ok=true, got: ${result.error || result.stderr || JSON.stringify(result)}`);
  assert.equal(fakeSpawn.calls.length, 1, "spawn must be called once");

  // The env passed to spawn must contain the profile's injected credential
  // AND the telemetry env vars.
  const spawnEnv = fakeSpawn.calls[0].options.env;
  assert.equal(spawnEnv.ANTHROPIC_API_KEY, "sk-from-profile-keychain",
    "credential from profileStore must reach spawn env");
  assert.equal(spawnEnv.ORCHESTRATOR_PROFILE_ID, "personal");
  assert.equal(spawnEnv.ORCHESTRATOR_WORKSPACE_PATH, profile.workspacePath);

  // The audit row must fire with profile metadata but NEVER carry the secret.
  const audit = ledger.entries.find((e) => e.type === "profile_spawn_env_built");
  assert.ok(audit, "profile_spawn_env_built must fire on profile-mode spawn");
  assert.equal(audit.data.profileId, "personal");
  assert.equal(audit.data.runner, "codex");
  assert.equal(audit.data.secretsInjected, 1);
  assert.equal(audit.data.workspacePath, profile.workspacePath);

  const text = JSON.stringify(audit);
  assert.ok(!/sk-from-profile-keychain/.test(text),
    "audit MUST NOT include the actual secret value");
});

test("D1-d CodexRunner: P0 fallback path (no profileStore) does NOT emit audit", async () => {
  const fakeSpawn = makeFakeSpawn();
  const ledger = makeLedger();
  const runner = new CodexRunner({
    spawnImpl: fakeSpawn,
    ledger, // ledger present but no profileStore — should NOT emit audit
  });

  const result = await runner.exec("test prompt", { timeoutMs: 5000 });

  assert.equal(result.ok, true);
  assert.equal(fakeSpawn.calls.length, 1);

  const audit = ledger.entries.find((e) => e.type === "profile_spawn_env_built");
  assert.equal(audit, undefined,
    "fallback (P0-only) path must NOT emit profile_spawn_env_built");
});

// ─────────────────────────────────────────────────────────────────
//  CONSTRUCTOR ARG REGRESSION
//
//  Constructing both runners with no D1 args (legacy shape) must
//  still work — pre-D1 callers (tests, server.js wiring before D1
//  rollout) keep working without code change.
// ─────────────────────────────────────────────────────────────────

test("D1-d ClaudeRunner: legacy constructor (no D1 args) still works", () => {
  const runner = new ClaudeRunner({});
  assert.equal(runner.profileStore, null);
  assert.equal(runner.credentialStore, null);
  assert.equal(runner.ledger, null);
});

test("D1-d CodexRunner: legacy constructor (no D1 args) still works", () => {
  const runner = new CodexRunner({});
  assert.equal(runner.profileStore, null);
  assert.equal(runner.credentialStore, null);
  assert.equal(runner.ledger, null);
});
