// tests/unit/providerProbe.test.js — Slice D2-b (Phase E1.5, 2026-04-29)
//
// Verifies the 3-tier provider probe contract:
//
//   tier 1 (installed)     — `<bin> --version`
//   tier 2 (authenticated) — `<bin> auth status` with profile env
//   tier 3 (canRun)        — minimal model call, SPENDS tokens
//
// And the security gates:
//   - public-sector posture refuses ALL tiers (defense-in-depth)
//   - unsupported runner → UNSUPPORTED_RUNNER (no spawn)
//   - mode gating: tier1 stops at tier1, tier1+2 stops at tier2,
//     tier1+2+3 runs all three
//
// All tests use injected cliProbeImpl + spawnImpl so no real CLIs
// or networks are touched. The probe NEVER spawns when input is
// rejected by the security gates.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const {
  probeProvider,
  RUNNER_CONFIG,
  ERROR_CODES,
  PROBE_MODES,
  TIER_TIMEOUT_MS,
} = require("../../src/runtime/providerProbe");

// ── stubs ──────────────────────────────────────────────────────

function stubCliProbe(returns) {
  // returns: object OR function(name) → object
  function impl(name, opts) {
    impl.calls.push({ name, opts });
    return typeof returns === "function" ? returns(name, opts) : returns;
  }
  impl.calls = [];
  return impl;
}

function stubSpawn(scenarios) {
  // scenarios is an array OR a function(callIndex, cmd, args, options) → scenario
  // Each scenario: { exitCode, stdout, stderr, timedOut?, throwErr?, errorEvent? }
  function impl(cmd, args, options) {
    const idx = impl.calls.length;
    impl.calls.push({ cmd, args, options });
    const scenario = typeof scenarios === "function"
      ? scenarios(idx, cmd, args, options)
      : (Array.isArray(scenarios) ? scenarios[idx] : scenarios);
    if (scenario && scenario.throwErr) throw scenario.throwErr;

    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    process.nextTick(() => {
      if (scenario && scenario.errorEvent) {
        child.emit("error", scenario.errorEvent);
        return;
      }
      if (scenario && scenario.timedOut) {
        // timedOut path: probe will trigger child.kill() after timeoutMs;
        // we simulate by NEVER emitting close so the timer fires.
        // For the test we fast-forward the timer (via real timers + small
        // timeout overrides where used); here we just leave the event
        // loop free.
        return;
      }
      if (scenario && scenario.stdout) {
        child.stdout.emit("data", Buffer.from(scenario.stdout));
      }
      if (scenario && scenario.stderr) {
        child.stderr.emit("data", Buffer.from(scenario.stderr));
      }
      child.emit("close", scenario ? scenario.exitCode : 0);
    });
    return child;
  }
  impl.calls = [];
  return impl;
}

function makeProfileStore(profiles = []) {
  const map = new Map();
  for (const p of profiles) map.set(p.id, p);
  return { get(id) { return map.get(id) || null; } };
}

function makeCredentialStore(map = {}) {
  return {
    async getSecret(profileId, key) {
      return (map[profileId] && map[profileId][key]) || null;
    },
  };
}

function sandboxProfile(id = "personal") {
  return {
    id,
    label: `Profile ${id}`,
    workspacePath: "/tmp/ws",
    activeProvider: "claude",
    secretIds: ["ANTHROPIC_API_KEY"],
    workspaceMode: "sandbox",
  };
}

const standardProfile = Object.freeze({
  publicSector: false,
  allowLocalExecutor: true,
  requireSandboxWorkspace: false,
});

const publicSectorProfile = Object.freeze({
  publicSector: true,
  allowLocalExecutor: false,
  requireSandboxWorkspace: true,
});

// ─────────────────────────────────────────────────────────────────
//  RUNNER VALIDATION
// ─────────────────────────────────────────────────────────────────

test("D2-b: unsupported runner → UNSUPPORTED_RUNNER + no cliProbe call", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/x" });
  const spawnImpl = stubSpawn([{ exitCode: 0, stdout: "1.0.0\n" }]);
  const result = await probeProvider({
    runner: "ghost",
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.UNSUPPORTED_RUNNER);
  assert.equal(result.installed, false);
  assert.equal(cliProbeImpl.calls.length, 0,
    "discoverCli must NEVER be called for an unsupported runner");
  assert.equal(spawnImpl.calls.length, 0);
});

// ─────────────────────────────────────────────────────────────────
//  PUBLIC-SECTOR DEFENSE-IN-DEPTH
// ─────────────────────────────────────────────────────────────────

test("D2-b: public-sector posture refuses every mode (no spawn)", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([{ exitCode: 0, stdout: "1.0.0" }]);
  for (const mode of [PROBE_MODES.TIER1, PROBE_MODES.TIER1_2, PROBE_MODES.TIER1_2_3]) {
    const result = await probeProvider({
      runner: "claude",
      mode,
      deploymentProfile: publicSectorProfile,
      cliProbeImpl,
      spawnImpl,
    });
    assert.equal(result.errorCode, ERROR_CODES.PUBLIC_SECTOR_BLOCKED,
      `mode=${mode} must refuse under public-sector`);
    assert.equal(result.installed, false);
    assert.equal(result.canRun, false);
  }
  assert.equal(cliProbeImpl.calls.length, 0,
    "discoverCli must NEVER fire under public-sector posture");
  assert.equal(spawnImpl.calls.length, 0,
    "spawn must NEVER fire under public-sector posture");
});

// ─────────────────────────────────────────────────────────────────
//  TIER 1 — installed
// ─────────────────────────────────────────────────────────────────

test("D2-b: tier1 + cli not on PATH → NOT_INSTALLED + no spawn", async () => {
  const cliProbeImpl = stubCliProbe({ found: false, error: "claude not on PATH" });
  const spawnImpl = stubSpawn([]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_INSTALLED);
  assert.equal(result.installed, false);
  assert.equal(spawnImpl.calls.length, 0);
});

test("D2-b: tier1 + cli found + version succeeds → installed:true, authenticated:null", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "claude 1.2.3\n", stderr: "" },
  ]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, null);
  assert.equal(result.installed, true);
  assert.equal(result.authenticated, null,
    "tier1 mode must NOT measure authenticated");
  assert.equal(result.canRun, false);
  assert.equal(result.spendsTokens, false);
  assert.equal(result.details.cliPath, "/bin/claude");
  assert.equal(result.details.cliVersion, "1.2.3");
  assert.equal(result.details.probeMode, "tier1");
  assert.equal(spawnImpl.calls.length, 1);
  assert.deepEqual(spawnImpl.calls[0].args, ["--version"]);
});

test("D2-b: tier1 spawn shell:false (security baseline)", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([{ exitCode: 0, stdout: "1.0.0" }]);
  await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(spawnImpl.calls[0].options.shell, false);
  assert.equal(spawnImpl.calls[0].options.windowsHide, true);
});

test("D2-b: tier1 + version exits non-zero → NOT_INSTALLED + clipped stderr", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 127, stdout: "", stderr: "command not found" },
  ]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_INSTALLED);
  assert.match(result.details.stderr, /command not found/);
});

// ─────────────────────────────────────────────────────────────────
//  TIER 2 — authenticated
// ─────────────────────────────────────────────────────────────────

test("D2-b: tier1+2 + both succeed → installed:true, authenticated:true, accountLabel extracted", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "claude 1.2.3\n" },              // tier 1
    { exitCode: 0, stdout: "Logged in as: alice@example.com\nplan: pro\n" }, // tier 2
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.installed, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.canRun, false);
  assert.equal(result.errorCode, null);
  assert.equal(result.accountLabel, "alice@example.com");
  assert.equal(result.spendsTokens, false,
    "tier1+2 mode does NOT spend tokens");
  assert.equal(spawnImpl.calls.length, 2);
  assert.deepEqual(spawnImpl.calls[1].args, ["auth", "status"]);
});

test("D2-b: tier1+2 + auth status exits non-zero → NOT_AUTHENTICATED", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },
    { exitCode: 1, stdout: "", stderr: "Not authenticated. Run `claude login`." },
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.installed, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.errorCode, ERROR_CODES.NOT_AUTHENTICATED);
  assert.match(result.details.stderr, /Not authenticated/);
});

test("D2-b: tier1+2 + tier1 fails short-circuits BEFORE tier2 spawn", async () => {
  const cliProbeImpl = stubCliProbe({ found: false, error: "not found" });
  const spawnImpl = stubSpawn([]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_INSTALLED);
  assert.equal(spawnImpl.calls.length, 0,
    "tier 2 must NOT run when tier 1 short-circuited");
});

test("D2-b: tier1+2 without profile uses filtered parent env (no profile required)", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },
    { exitCode: 0, stdout: "Logged in as: bob@example.com" },
  ]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    // No profile / profileStore / credentialStore
    env: { PATH: "/x", ANTHROPIC_API_KEY: "leak" },
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.authenticated, true);
  // Tier 2 spawn env must have parent's ANTHROPIC_API_KEY STRIPPED
  // (filterSensitiveEnv applied) — the CLI is supposed to read its
  // own creds from disk, not inherit them from the harness.
  assert.equal(spawnImpl.calls[1].options.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(spawnImpl.calls[1].options.env.PATH, "/x");
});

test("D2-b: tier1+2 + missing credential surfaces NOT_AUTHENTICATED", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([{ exitCode: 0, stdout: "1.0.0" }]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    // credentialStore returns null for ANTHROPIC_API_KEY → buildSpawnEnv throws
    credentialStore: makeCredentialStore({}),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_AUTHENTICATED);
  assert.match(result.details.stderr, /requires secret "ANTHROPIC_API_KEY"/);
  assert.equal(spawnImpl.calls.length, 1,
    "tier 2 must NOT spawn when credential missing");
});

// ─────────────────────────────────────────────────────────────────
//  TIER 3 — canRun (token-spending)
// ─────────────────────────────────────────────────────────────────

test("D2-b: tier1+2+3 + all succeed → canRun:true, spendsTokens:true", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },                          // tier 1
    { exitCode: 0, stdout: "Logged in as: alice@example.com" }, // tier 2
    { exitCode: 0, stdout: "ok\n" },                            // tier 3
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2_3,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.canRun, true);
  assert.equal(result.spendsTokens, true);
  assert.equal(result.errorCode, null);
  assert.equal(spawnImpl.calls.length, 3);
});

test("D2-b: tier1+2+3 + tier3 hits rate-limit → RATE_LIMITED", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },
    { exitCode: 0, stdout: "Logged in as: a@b.com" },
    { exitCode: 1, stdout: "", stderr: "Error 429: rate limit exceeded" },
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2_3,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.RATE_LIMITED);
  assert.equal(result.canRun, false);
  assert.equal(result.spendsTokens, true,
    "tier 3 still ran (consumed tokens) — spendsTokens stays true even on failure");
});

test("D2-b: tier1+2+3 + tier3 unknown failure → UNKNOWN", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },
    { exitCode: 0, stdout: "Logged in as: a@b.com" },
    { exitCode: 2, stdout: "", stderr: "internal error: foo bar" },
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2_3,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.UNKNOWN);
  assert.match(result.details.stderr, /internal error/);
});

test("D2-b: tier1+2+3 + tier2 fails short-circuits BEFORE tier3", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "1.0.0" },
    { exitCode: 1, stdout: "", stderr: "Not authenticated" },
    // tier 3 should NEVER fire
  ]);
  const profile = sandboxProfile("personal");
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1_2_3,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { ANTHROPIC_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_AUTHENTICATED);
  assert.equal(result.spendsTokens, false,
    "tier 3 didn't fire → no tokens spent");
  assert.equal(spawnImpl.calls.length, 2);
});

// ─────────────────────────────────────────────────────────────────
//  VERSION + ACCOUNT-LABEL PARSING
// ─────────────────────────────────────────────────────────────────

test("D2-b: parses semver-like versions from various output shapes", async () => {
  const cases = [
    { stdout: "claude 1.2.3", expected: "1.2.3" },
    { stdout: "Claude Code v1.2.3\n", expected: "1.2.3" },
    { stdout: "1.2.3-beta.4", expected: "1.2.3-beta.4" },
    { stdout: "version: 0.1.0\n(c) 2026", expected: "0.1.0" },
    { stdout: "no version here", expected: null },
  ];
  for (const c of cases) {
    const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
    const spawnImpl = stubSpawn([{ exitCode: 0, stdout: c.stdout }]);
    const result = await probeProvider({
      runner: "claude",
      mode: PROBE_MODES.TIER1,
      deploymentProfile: standardProfile,
      cliProbeImpl,
      spawnImpl,
    });
    assert.equal(result.details.cliVersion, c.expected,
      `version parsing for "${c.stdout}"`);
  }
});

test("D2-b: extracts accountLabel from various 'auth status' formats", async () => {
  const cases = [
    "Logged in as: alice@example.com\nplan: pro",
    "Account: bob@org.com",
    "Authenticated as carol@example.com",
  ];
  for (const stdout of cases) {
    const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
    const spawnImpl = stubSpawn([
      { exitCode: 0, stdout: "1.0.0" },
      { exitCode: 0, stdout },
    ]);
    const result = await probeProvider({
      runner: "claude",
      mode: PROBE_MODES.TIER1_2,
      deploymentProfile: standardProfile,
      env: { PATH: "/x" },
      cliProbeImpl,
      spawnImpl,
    });
    assert.ok(result.accountLabel,
      `accountLabel should be parsed from "${stdout}"`);
    assert.match(result.accountLabel, /@/);
  }
});

// ─────────────────────────────────────────────────────────────────
//  SPAWN ERROR HANDLING
// ─────────────────────────────────────────────────────────────────

test("D2-b: tier1 spawn throws → returns NOT_INSTALLED with operator-readable error", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([{ throwErr: new Error("EACCES: permission denied") }]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.errorCode, ERROR_CODES.NOT_INSTALLED);
  assert.match(result.details.stderr, /permission denied/);
});

// ─────────────────────────────────────────────────────────────────
//  CODEX RUNNER (mirror coverage)
// ─────────────────────────────────────────────────────────────────

test("D2-b: codex runner uses 'codex --version' + 'codex auth status'", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/codex" });
  const spawnImpl = stubSpawn([
    { exitCode: 0, stdout: "codex 0.1.0" },
    { exitCode: 0, stdout: "Logged in as: dev@example.com" },
  ]);
  const profile = { ...sandboxProfile("personal"), secretIds: ["OPENAI_API_KEY"] };
  const result = await probeProvider({
    runner: "codex",
    mode: PROBE_MODES.TIER1_2,
    deploymentProfile: standardProfile,
    profile,
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ personal: { OPENAI_API_KEY: "sk-x" } }),
    cliProbeImpl,
    spawnImpl,
  });
  assert.equal(result.installed, true);
  assert.equal(result.authenticated, true);
  assert.equal(cliProbeImpl.calls[0].name, "codex");
  assert.deepEqual(spawnImpl.calls[0].args, ["--version"]);
  assert.deepEqual(spawnImpl.calls[1].args, ["auth", "status"]);
});

// ─────────────────────────────────────────────────────────────────
//  RETURN SHAPE LOCK
// ─────────────────────────────────────────────────────────────────

test("D2-b: result shape contains every documented field", async () => {
  const cliProbeImpl = stubCliProbe({ found: true, path: "/bin/claude" });
  const spawnImpl = stubSpawn([{ exitCode: 0, stdout: "1.0.0" }]);
  const result = await probeProvider({
    runner: "claude",
    mode: PROBE_MODES.TIER1,
    deploymentProfile: standardProfile,
    cliProbeImpl,
    spawnImpl,
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["accountLabel", "authenticated", "canRun", "details", "errorCode", "installed", "spendsTokens"].sort(),
  );
  assert.deepEqual(
    Object.keys(result.details).sort(),
    ["cliPath", "cliVersion", "elapsedMs", "lastTestedAt", "probeMode", "stderr"].sort(),
  );
  assert.equal(typeof result.details.elapsedMs, "number");
  assert.match(result.details.lastTestedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// ─────────────────────────────────────────────────────────────────
//  EXPORTED CONSTANTS
// ─────────────────────────────────────────────────────────────────

test("D2-b: ERROR_CODES + PROBE_MODES + RUNNER_CONFIG are frozen", () => {
  assert.ok(Object.isFrozen(ERROR_CODES));
  assert.ok(Object.isFrozen(PROBE_MODES));
  assert.ok(Object.isFrozen(RUNNER_CONFIG));
  assert.ok(Object.isFrozen(RUNNER_CONFIG.claude));
  assert.ok(Object.isFrozen(RUNNER_CONFIG.codex));
  // Stable codes the route + wizard layers depend on:
  assert.equal(ERROR_CODES.NOT_INSTALLED, "NOT_INSTALLED");
  assert.equal(ERROR_CODES.NOT_AUTHENTICATED, "NOT_AUTHENTICATED");
  assert.equal(ERROR_CODES.PUBLIC_SECTOR_BLOCKED, "PUBLIC_SECTOR_BLOCKED");
  assert.equal(ERROR_CODES.RATE_LIMITED, "RATE_LIMITED");
  assert.equal(ERROR_CODES.UNSUPPORTED_RUNNER, "UNSUPPORTED_RUNNER");
  assert.equal(PROBE_MODES.TIER1, "tier1");
  assert.equal(PROBE_MODES.TIER1_2, "tier1+2");
  assert.equal(PROBE_MODES.TIER1_2_3, "tier1+2+3");
  // Tier 3 must have a longer timeout than tier 1/2 (real model call).
  assert.ok(TIER_TIMEOUT_MS.TIER3 > TIER_TIMEOUT_MS.TIER1);
});
