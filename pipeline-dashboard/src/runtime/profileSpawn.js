// Slice D1-c (Phase E1 productization, 2026-04-29) — profile-aware spawn env.
//
// `buildSpawnEnv()` is the join point between profileStore (D1-b) and
// credentialStore (D1-a) at spawn time. ClaudeRunner / CodexRunner
// (D1-d) will call this to compose the env they pass to `spawn()`.
//
// Layered model (each layer is verifiable in isolation):
//
//   1. P0 base                    filterSensitiveEnv(parentEnv)
//                                 strips TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL
//                                 from the parent process — the harness
//                                 never inherits operator-shell secrets.
//
//   2. Profile lookup             profileStore.get(profileId)
//                                 throws if id is unknown.
//
//   3. Credential injection       For each `key` in profile.secretIds,
//                                 await credentialStore.getSecret(id, key).
//                                 Refuses to spawn if any secret is null
//                                 (operator either set the credential or
//                                 didn't — partial-credential spawn is
//                                 always wrong).
//
//   4. Telemetry env               HARNESS_PROFILE_ID + HARNESS_WORKSPACE_PATH
//                                 land last so the spawned child can
//                                 self-report which profile it ran under.
//                                 NOT secret material.
//
// Why a separate module (not just inline in the runner):
//
//   - Single test surface for the layering. The runner tests can stay
//     focused on "does the spawn happen" without re-testing env
//     composition.
//   - The same composition is needed by D1-e profileRoutes' "test
//     profile" action (POST /api/profiles/:id/test/{claude,codex}),
//     so a module factor avoids duplication between two callers.
//   - When D2 setup-wizard adds a probe action that also needs
//     profile-scoped env, the wizard reuses this same builder.
//
// Audit verb (D1-d emits this from the runner — buildSpawnEnv itself
// is silent so unit tests don't have to mock a ledger):
//
//   profile_spawn_env_built — carries
//     {profileId, secretsInjected: number, workspacePath, runner}
//
//   The audit value `secretsInjected` is a COUNT, never the key list.
//   D1-f sanitizer adds defensive guards at the ledger layer too.
//
// What this function deliberately does NOT do:
//   - Look at HARNESS_REMOTE_MODE or any runner-host concept. The
//     runner-side trust boundary is separate (R1 territory). Profile
//     credentials are local-only — they NEVER cross the WS to a remote
//     runner.
//   - Modify parentEnv in place. We always defensive-copy through
//     filterSensitiveEnv, so the caller's process.env is never
//     mutated.
//   - Fall back silently when a credential is missing. Every error
//     path throws with an operator-actionable message.

"use strict";

const { filterSensitiveEnv } = require("../security/envFilter");
// Slice D1-gov-5 (Phase E1, 2026-04-29): refuse local spawn paths
// when public-sector policy disables the local executor. Defense-
// in-depth — the same assertion fires from the runners themselves
// (D1-d) so a future refactor that bypasses profileSpawn still
// gets caught.
const { resolveDeploymentProfile } = require("../policy/deploymentProfile");
const {
  assertLocalExecutorAllowed,
  assertSandboxWorkspaceRequired,
} = require("../policy/publicSectorPolicy");

// Telemetry env names that the spawned CLI may read so it knows which
// profile it ran under. These are NOT secret — purely identifying.
const HARNESS_PROFILE_ID = "HARNESS_PROFILE_ID";
const HARNESS_WORKSPACE_PATH = "HARNESS_WORKSPACE_PATH";

/**
 * Compose the env to pass to a child-process spawn for a given profile.
 *
 * @param {object} opts
 * @param {object} opts.parentEnv             - usually process.env
 * @param {string|null} [opts.profileId]      - profile to spawn under;
 *   null → return P0 base only (legacy single-user fallback)
 * @param {object} [opts.profileStore]        - createProfileStore() handle.
 *   Required when profileId is non-null.
 * @param {object} [opts.credentialStore]     - createCredentialStore() handle.
 *   Required when profileId is non-null.
 * @param {object} [opts.baseFilterOpts]      - forwarded to
 *   filterSensitiveEnv (e.g. allowKeys for PTY contexts that need
 *   HARNESS_TOKEN).
 *
 * @returns {Promise<{
 *   env: object,                     // env to pass to spawn()
 *   profile: object|null,            // resolved profile (or null for fallback)
 *   secretsInjected: number,         // count, NOT a list of keys
 *   secretsKeys: string[],           // for audit metadata only;
 *                                    // never include in spawn output
 *   workspacePath: string|null,
 *   profileId: string|null,
 *   mode: "fallback"|"profile"
 * }>}
 *
 * @throws Error when profileId is set but profile not found.
 * @throws Error when a required secret returns null from credentialStore.
 */
async function buildSpawnEnv(opts = {}) {
  const parentEnv = opts.parentEnv || {};
  const profileId = opts.profileId || null;
  const baseFilterOpts = opts.baseFilterOpts || {};

  // ── 0. Public-sector gate (D1-gov-5) ───────────────────────
  // The deploymentProfile resolves whether local-executor paths
  // are permitted in this orchestrator's posture. assertLocalExecutorAllowed
  // throws PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED when public-sector
  // mode forbids the local path. Tests inject a custom profile
  // via opts.deploymentProfile; production callers omit it and we
  // resolve from env.
  const deploymentProfile = opts.deploymentProfile
    || resolveDeploymentProfile({ env: parentEnv });
  assertLocalExecutorAllowed(deploymentProfile);

  // ── 1. P0 base ───────────────────────────────────────────────
  const env = filterSensitiveEnv(parentEnv, baseFilterOpts);

  // ── 2. Fallback (no profile) ────────────────────────────────
  // Legacy single-user mode: no profile selected, no credentials
  // injected, the spawned CLI must read its own creds from
  // wherever it normally does (or fail). This branch is what
  // pre-D1 callers got — keeping it lets the migration to
  // profile-aware spawn happen one runner at a time.
  if (!profileId) {
    return Object.freeze({
      env,
      profile: null,
      secretsInjected: 0,
      secretsKeys: [],
      workspacePath: null,
      profileId: null,
      mode: "fallback",
    });
  }

  if (!opts.profileStore || typeof opts.profileStore.get !== "function") {
    throw new Error(
      "buildSpawnEnv: profileStore is required when profileId is non-null",
    );
  }
  if (!opts.credentialStore || typeof opts.credentialStore.getSecret !== "function") {
    throw new Error(
      "buildSpawnEnv: credentialStore is required when profileId is non-null",
    );
  }

  // ── 3. Profile lookup ───────────────────────────────────────
  const profile = opts.profileStore.get(profileId);
  if (!profile) {
    throw new Error(
      `buildSpawnEnv: no profile with id "${profileId}" — ` +
      `was it deleted between selection and spawn?`,
    );
  }

  // ── 3.5. Sandbox-workspace re-check (Slice GOV-SB-0) ───────
  // D1-gov-2 validates workspaceMode at upsert time, but a profile
  // file could land on disk via legacy formats / hand-edit / a posture
  // flip from standard → public-sector mid-process. Re-check at
  // spawn time so the policy can't be bypassed by leaving the
  // process running across a posture change.
  assertSandboxWorkspaceRequired(profile, deploymentProfile);

  // ── 4. Credential injection ─────────────────────────────────
  // Sequential awaits (not Promise.all) so the order of audit-side
  // observations is deterministic. The operator's secret count is
  // small (typically 1-2 keys), so concurrency wins are noise.
  const injectedKeys = [];
  for (const key of profile.secretIds || []) {
    const value = await opts.credentialStore.getSecret(profileId, key);
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `buildSpawnEnv: profile "${profileId}" requires secret "${key}" ` +
        `but credentialStore returned no value. Run ` +
        `\`setSecret(${profileId}, ${key}, ...)\` first or remove ` +
        `the key from the profile's secretIds.`,
      );
    }
    // Key was already P0-stripped from the env by filterSensitiveEnv;
    // we are now reintroducing it from the trusted profile-store path.
    env[key] = value;
    injectedKeys.push(key);
  }

  // ── 5. Telemetry env ────────────────────────────────────────
  // Don't pollute env namespaces — keep these prefixed and few.
  env[HARNESS_PROFILE_ID] = profile.id;
  env[HARNESS_WORKSPACE_PATH] = profile.workspacePath;

  return Object.freeze({
    env,
    profile,
    secretsInjected: injectedKeys.length,
    secretsKeys: injectedKeys, // for audit metadata; callers MUST NOT echo these to UI
    workspacePath: profile.workspacePath,
    profileId: profile.id,
    mode: "profile",
  });
}

module.exports = {
  buildSpawnEnv,
  HARNESS_PROFILE_ID,
  HARNESS_WORKSPACE_PATH,
};
