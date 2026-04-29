// tests/unit/profileSpawn.test.js — Slice D1-c (Phase E1, 2026-04-29)
//
// Verifies the layered env composition that the runner-rewiring slice
// (D1-d) will plug into Claude/Codex spawn paths.
//
// What's tested in priority order:
//
//   1. P0 base baseline — sensitive parent-env keys are STRIPPED.
//      This is THE security baseline: a parent process exporting
//      ANTHROPIC_API_KEY="leak" must NOT have that key visible to
//      a Claude child unless the profile system explicitly injects it.
//
//   2. Fallback mode (profileId=null) returns P0 base only — no
//      profile metadata, no credential injection.
//
//   3. Profile mode injects ONLY the secretIds the profile declares.
//      Keys not in profile.secretIds remain stripped.
//
//   4. Missing credential → throws (refuse partial-credential spawn).
//
//   5. Deleted profile → throws.
//
//   6. Telemetry env (HARNESS_PROFILE_ID + HARNESS_WORKSPACE_PATH)
//      lands AND is non-secret.
//
//   7. Returned object is frozen + the env it carries is a NEW object
//      (caller's process.env is untouched).

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSpawnEnv,
  HARNESS_PROFILE_ID,
  HARNESS_WORKSPACE_PATH,
} = require("../../src/runtime/profileSpawn");

// ── stub stores ────────────────────────────────────────────────

function makeProfileStore(profiles = []) {
  const map = new Map();
  for (const p of profiles) map.set(p.id, p);
  return {
    get(id) { return map.get(id) || null; },
    list() { return Array.from(map.values()); },
  };
}

function makeCredentialStore(map = {}) {
  // map shape: { profileId: { key: value } }
  return {
    async getSecret(profileId, key) {
      return (map[profileId] && map[profileId][key]) || null;
    },
  };
}

function sampleProfile(id, secretIds = ["ANTHROPIC_API_KEY"]) {
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

// ─────────────────────────────────────────────────────────────────
//  P0 BASE (baseline)
// ─────────────────────────────────────────────────────────────────

test("D1-c: parent's sensitive keys are STRIPPED before any profile injection", async () => {
  const parentEnv = {
    PATH: "/usr/bin",
    HOME: "/home/op",
    ANTHROPIC_API_KEY: "operator-shell-leak",
    OPENAI_API_KEY: "another-leak",
    HARNESS_TOKEN: "loop-back-token",
    NORMAL_VAR: "ok",
  };
  // No profile → P0 base only.
  const out = await buildSpawnEnv({ parentEnv });
  // Sensitive keys must be GONE.
  assert.equal(out.env.ANTHROPIC_API_KEY, undefined,
    "parent ANTHROPIC_API_KEY must NOT leak into spawn env");
  assert.equal(out.env.OPENAI_API_KEY, undefined);
  assert.equal(out.env.HARNESS_TOKEN, undefined);
  // Non-sensitive keys must survive.
  assert.equal(out.env.PATH, "/usr/bin");
  assert.equal(out.env.HOME, "/home/op");
  assert.equal(out.env.NORMAL_VAR, "ok");
});

test("D1-c: parentEnv reference is NOT mutated (defensive copy via filter)", async () => {
  const parentEnv = {
    ANTHROPIC_API_KEY: "should-survive-on-parent",
    PATH: "/usr/bin",
  };
  const before = { ...parentEnv };
  await buildSpawnEnv({ parentEnv });
  assert.deepEqual(parentEnv, before,
    "buildSpawnEnv must NOT mutate the caller's parentEnv");
});

// ─────────────────────────────────────────────────────────────────
//  FALLBACK MODE
// ─────────────────────────────────────────────────────────────────

test("D1-c: profileId=null returns mode='fallback' with no credential injection", async () => {
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/usr/bin" },
    profileId: null,
  });
  assert.equal(out.mode, "fallback");
  assert.equal(out.profile, null);
  assert.equal(out.profileId, null);
  assert.equal(out.workspacePath, null);
  assert.equal(out.secretsInjected, 0);
  assert.deepEqual(out.secretsKeys, []);
  // No telemetry env in fallback either.
  assert.equal(out.env[HARNESS_PROFILE_ID], undefined);
  assert.equal(out.env[HARNESS_WORKSPACE_PATH], undefined);
});

test("D1-c: profileId omitted entirely is the same as null", async () => {
  const out = await buildSpawnEnv({ parentEnv: { PATH: "/x" } });
  assert.equal(out.mode, "fallback");
});

// ─────────────────────────────────────────────────────────────────
//  PROFILE MODE
// ─────────────────────────────────────────────────────────────────

test("D1-c: profile mode injects secretIds from credentialStore", async () => {
  const profile = sampleProfile("personal", ["ANTHROPIC_API_KEY"]);
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "operator-leak-stripped" },
    profileId: "personal",
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({
      personal: { ANTHROPIC_API_KEY: "sk-from-profile-keychain" },
    }),
  });
  assert.equal(out.mode, "profile");
  assert.equal(out.profile.id, "personal");
  assert.equal(out.profileId, "personal");
  assert.equal(out.workspacePath, profile.workspacePath);
  assert.equal(out.secretsInjected, 1);
  assert.deepEqual(out.secretsKeys, ["ANTHROPIC_API_KEY"]);
  // The key from credentialStore wins; the parent leak is replaced.
  assert.equal(out.env.ANTHROPIC_API_KEY, "sk-from-profile-keychain");
});

test("D1-c: profile injects multiple keys + only the declared ones", async () => {
  const profile = sampleProfile("multi", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/x" },
    profileId: "multi",
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({
      multi: {
        ANTHROPIC_API_KEY: "anthropic-from-store",
        OPENAI_API_KEY: "openai-from-store",
        // Even if the store has an extra key, it must NOT be injected.
        GITHUB_TOKEN: "should-not-leak",
      },
    }),
  });
  assert.equal(out.env.ANTHROPIC_API_KEY, "anthropic-from-store");
  assert.equal(out.env.OPENAI_API_KEY, "openai-from-store");
  assert.equal(out.env.GITHUB_TOKEN, undefined,
    "credentials NOT in profile.secretIds must NOT be injected");
});

test("D1-c: missing credential throws (no partial-credential spawn)", async () => {
  const profile = sampleProfile("personal", ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: { PATH: "/x" },
      profileId: "personal",
      profileStore: makeProfileStore([profile]),
      credentialStore: makeCredentialStore({
        // OPENAI_API_KEY NOT set → must reject the entire spawn.
        personal: { ANTHROPIC_API_KEY: "ok" },
      }),
    }),
    /requires secret "OPENAI_API_KEY" but credentialStore returned no value/,
  );
});

test("D1-c: deleted profile throws with operator-actionable message", async () => {
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: {},
      profileId: "ghost",
      profileStore: makeProfileStore([]),
      credentialStore: makeCredentialStore({}),
    }),
    /no profile with id "ghost"/,
  );
});

test("D1-c: profile mode without profileStore arg throws (developer error)", async () => {
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: {},
      profileId: "personal",
      // profileStore omitted
      credentialStore: makeCredentialStore({}),
    }),
    /profileStore is required/,
  );
});

test("D1-c: profile mode without credentialStore arg throws (developer error)", async () => {
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: {},
      profileId: "personal",
      profileStore: makeProfileStore([sampleProfile("personal")]),
      // credentialStore omitted
    }),
    /credentialStore is required/,
  );
});

// ─────────────────────────────────────────────────────────────────
//  TELEMETRY ENV
// ─────────────────────────────────────────────────────────────────

test("D1-c: telemetry env (HARNESS_PROFILE_ID + WORKSPACE_PATH) lands in profile mode", async () => {
  const profile = sampleProfile("personal");
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/x" },
    profileId: "personal",
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({
      personal: { ANTHROPIC_API_KEY: "v" },
    }),
  });
  assert.equal(out.env[HARNESS_PROFILE_ID], "personal");
  assert.equal(out.env[HARNESS_WORKSPACE_PATH], profile.workspacePath);
});

test("D1-c: telemetry env names are exported and stable", () => {
  // Lock the wire-format. Anything reading these from the spawned CLI
  // (D2 setup wizard probes, future debug tooling) depends on these
  // exact names.
  assert.equal(HARNESS_PROFILE_ID, "HARNESS_PROFILE_ID");
  assert.equal(HARNESS_WORKSPACE_PATH, "HARNESS_WORKSPACE_PATH");
});

// ─────────────────────────────────────────────────────────────────
//  AUDIT-FRIENDLY METADATA
// ─────────────────────────────────────────────────────────────────

test("D1-c: returned shape includes secretsInjected count + secretsKeys list (for audit)", async () => {
  const profile = sampleProfile("p", ["A", "B"]);
  const out = await buildSpawnEnv({
    parentEnv: {},
    profileId: "p",
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({ p: { A: "1", B: "2" } }),
  });
  assert.equal(out.secretsInjected, 2);
  assert.deepEqual(out.secretsKeys, ["A", "B"]);
});

test("D1-c: profile with empty secretIds → secretsInjected=0, mode='profile' (legitimate)", async () => {
  // Use case: operator wants a profile that just sets workspace path
  // (no provider keys yet, the spawned CLI may pick them up from
  // its own config). buildSpawnEnv accepts this without complaint —
  // the CLI itself will fail-fast if it actually needed a key.
  const profile = sampleProfile("ws-only", []);
  const out = await buildSpawnEnv({
    parentEnv: {},
    profileId: "ws-only",
    profileStore: makeProfileStore([profile]),
    credentialStore: makeCredentialStore({}),
  });
  assert.equal(out.mode, "profile");
  assert.equal(out.secretsInjected, 0);
  assert.deepEqual(out.secretsKeys, []);
  assert.equal(out.env[HARNESS_PROFILE_ID], "ws-only");
});

// ─────────────────────────────────────────────────────────────────
//  IMMUTABILITY
// ─────────────────────────────────────────────────────────────────

test("D1-c: returned object is frozen (caller cannot tamper with profile metadata)", async () => {
  const out = await buildSpawnEnv({ parentEnv: {} });
  assert.ok(Object.isFrozen(out));
  assert.throws(() => { out.profileId = "tampered"; }, /Cannot/);
});

test("D1-c: baseFilterOpts.allowKeys is forwarded to filterSensitiveEnv", async () => {
  // The runner.js / PTY pattern needs HARNESS_TOKEN to pass for
  // operator-typed curl. profileSpawn must respect the same allowKeys
  // forwarding so a custom caller (PTY context) can opt in selectively.
  const parentEnv = {
    HARNESS_TOKEN: "should-survive-with-allowKeys",
    PATH: "/x",
  };
  const out = await buildSpawnEnv({
    parentEnv,
    baseFilterOpts: { allowKeys: ["HARNESS_TOKEN"] },
  });
  assert.equal(out.env.HARNESS_TOKEN, "should-survive-with-allowKeys",
    "allowKeys must override the SENSITIVE_KEY_RE filter");
});

test("D1-c: baseFilterOpts.extraDrop is forwarded (defense for arbitrary names)", async () => {
  const out = await buildSpawnEnv({
    parentEnv: { CUSTOM_ENV: "drop-me", PATH: "/x" },
    baseFilterOpts: { extraDrop: ["CUSTOM_ENV"] },
  });
  assert.equal(out.env.CUSTOM_ENV, undefined);
  assert.equal(out.env.PATH, "/x");
});

// ─────────────────────────────────────────────────────────────────
//  D1-gov-5 — public-sector blocks the local spawn path
// ─────────────────────────────────────────────────────────────────

test("D1-gov-5: public-sector mode REFUSES local spawn (allowLocalExecutor=false)", async () => {
  // Standard mode would silently return P0 base env. Public-sector
  // mode must throw with the policy code so the caller (runner /
  // route) can map to the right HTTP status.
  try {
    await buildSpawnEnv({
      parentEnv: {},
      profileId: null,
      deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    });
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /local executor disabled/);
    assert.equal(err.code, "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED");
  }
});

test("D1-gov-5: standard mode (allowLocalExecutor=true) permits local spawn (no regression)", async () => {
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/x" },
    profileId: null,
    deploymentProfile: { publicSector: false, allowLocalExecutor: true },
  });
  assert.equal(out.mode, "fallback");
  assert.equal(out.env.PATH, "/x");
});

test("D1-gov-5: public-sector blocks BEFORE profile lookup (defense in depth)", async () => {
  // Even with a valid profile + valid credentials, public-sector
  // must refuse — the local executor path is forbidden regardless
  // of profile completeness. This catches the "operator builds a
  // perfect profile then expects to spawn locally" mistake.
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: {},
      profileId: "agency-claude",
      profileStore: makeProfileStore([sampleProfile("agency-claude")]),
      credentialStore: makeCredentialStore({
        "agency-claude": { ANTHROPIC_API_KEY: "v" },
      }),
      deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    }),
    { code: "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED" },
  );
});

test("D1-gov-5: env-driven public-sector (no opts.deploymentProfile) still blocks", async () => {
  // Production callers don't pass deploymentProfile — they expect
  // resolveDeploymentProfile({ env: parentEnv }) to read the env.
  // Verify the env path triggers the same block.
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: { HARNESS_DEPLOYMENT_PROFILE: "public-sector" },
      profileId: null,
    }),
    { code: "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED" },
  );
});

// ─────────────────────────────────────────────────────────────────
//  Slice GOV-SB-0 — spawn-time sandbox-workspace re-check
//
//  D1-gov-2's validateProfileForPublicSector already rejects
//  workspaceMode!="sandbox" at upsert time. GOV-SB-0 adds a second
//  gate at spawn time so a profile that landed via a different code
//  path (legacy file format, hand-edit, posture flip mid-process)
//  still cannot launch a local executor under public-sector.
//
//  We exercise this with a hand-crafted deploymentProfile where
//  allowLocalExecutor:true (so the FIRST gate doesn't fire) but
//  requireSandboxWorkspace:true. The natural env-driven public-
//  sector posture has both flags coupled, so the second gate is
//  belt-and-suspenders for a future schema split.
// ─────────────────────────────────────────────────────────────────

test("GOV-SB-0: blocks profile workspaceMode=local at spawn even if local executor is allowed", async () => {
  const localProfile = {
    ...sampleProfile("local-leak", ["ANTHROPIC_API_KEY"]),
    workspaceMode: "local",
  };
  await assert.rejects(
    () => buildSpawnEnv({
      parentEnv: {},
      profileId: "local-leak",
      profileStore: makeProfileStore([localProfile]),
      credentialStore: makeCredentialStore({
        "local-leak": { ANTHROPIC_API_KEY: "v" },
      }),
      // Custom posture: local executor allowed, but sandbox required.
      // This is the future-proofing scenario.
      deploymentProfile: {
        publicSector: true,
        allowLocalExecutor: true,
        requireSandboxWorkspace: true,
      },
    }),
    { code: "PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED" },
  );
});

test("GOV-SB-0: passes profile workspaceMode=sandbox at spawn (standard sandbox-only success)", async () => {
  const sandboxProfile = {
    ...sampleProfile("sandbox-ok", ["ANTHROPIC_API_KEY"]),
    workspaceMode: "sandbox",
  };
  const out = await buildSpawnEnv({
    parentEnv: { PATH: "/x" },
    profileId: "sandbox-ok",
    profileStore: makeProfileStore([sandboxProfile]),
    credentialStore: makeCredentialStore({
      "sandbox-ok": { ANTHROPIC_API_KEY: "sk-ok" },
    }),
    deploymentProfile: {
      publicSector: true,
      allowLocalExecutor: true,
      requireSandboxWorkspace: true,
    },
  });
  assert.equal(out.mode, "profile");
  assert.equal(out.env.ANTHROPIC_API_KEY, "sk-ok");
});

test("GOV-SB-0: standard mode tolerates workspaceMode=local (no regression)", async () => {
  // The sandbox re-check ONLY fires under public-sector posture.
  // Standard mode users with local profiles must continue to work.
  const localProfile = {
    ...sampleProfile("personal", ["ANTHROPIC_API_KEY"]),
    workspaceMode: "local",
  };
  const out = await buildSpawnEnv({
    parentEnv: {},
    profileId: "personal",
    profileStore: makeProfileStore([localProfile]),
    credentialStore: makeCredentialStore({
      personal: { ANTHROPIC_API_KEY: "v" },
    }),
    deploymentProfile: {
      publicSector: false,
      allowLocalExecutor: true,
      requireSandboxWorkspace: false,
    },
  });
  assert.equal(out.mode, "profile");
});
