// ORCHESTRATOR-RENAME-1 (2026-05-08) — env var alias bridge.
//
// The dashboard's environment variables historically used HARNESS_* prefix
// (HARNESS_TOKEN, HARNESS_ALLOW_REMOTE, etc.). Round A renamed the tool
// from "Orchestrator" to "Orchestrator"; the canonical env names are now
// ORCHESTRATOR_*. To avoid breaking existing operator setups (.env files,
// docker-compose configs, deployment scripts), this module copies any
// HARNESS_* value into the matching ORCHESTRATOR_* slot when the new key
// is unset.
//
// Contract:
//   applyEnvAliases({ env, log }) — mutates `env` (default: process.env).
//   For each (newKey, oldKey) in ALIAS_MAP:
//     - If env[newKey] is already set, do nothing.
//     - Else if env[oldKey] is set, copy env[oldKey] → env[newKey].
//     - Optionally call log(deprecationMessage) once per copied key.
//
// Must be invoked AS EARLY AS POSSIBLE in the boot sequence — before any
// module reads process.env.ORCHESTRATOR_*. server.js calls it as its
// first executable statement.
//
// Deprecation timeline:
//   - Round A.2 (this): both names accepted, prefer new.
//   - One round later: emit a deprecation warning whenever a HARNESS_*
//     name is read.
//   - Two rounds later: remove the alias bridge, drop HARNESS_* support.

"use strict";

// Generated from a full grep of HARNESS_* occurrences across the
// codebase. Each entry maps the canonical ORCHESTRATOR_* name to the
// legacy HARNESS_* name. Adding a new env var → add it here too so the
// alias bridge stays in sync.
const ALIAS_MAP = Object.freeze({
  ORCHESTRATOR_ALLOW_DANGEROUS_AGENT: "HARNESS_ALLOW_DANGEROUS_AGENT",
  ORCHESTRATOR_ALLOW_INSECURE_MANIFEST_URL: "HARNESS_ALLOW_INSECURE_MANIFEST_URL",
  ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS: "HARNESS_ALLOW_PLAINTEXT_SECRETS",
  ORCHESTRATOR_ALLOW_REMOTE: "HARNESS_ALLOW_REMOTE",
  ORCHESTRATOR_ALLOW_UNSIGNED_MANIFEST: "HARNESS_ALLOW_UNSIGNED_MANIFEST",
  ORCHESTRATOR_AUDIT_KEY: "HARNESS_AUDIT_KEY",
  ORCHESTRATOR_BASE_URL: "HARNESS_BASE_URL",
  ORCHESTRATOR_BOOTSTRAP_TOKEN: "HARNESS_BOOTSTRAP_TOKEN",
  ORCHESTRATOR_CHILD_MAX: "HARNESS_CHILD_MAX",
  ORCHESTRATOR_CHILD_QUEUE_TIMEOUT_MS: "HARNESS_CHILD_QUEUE_TIMEOUT_MS",
  ORCHESTRATOR_CLAUDE_TIMEOUT_MS: "HARNESS_CLAUDE_TIMEOUT_MS",
  ORCHESTRATOR_CODEX_TIMEOUT_MS: "HARNESS_CODEX_TIMEOUT_MS",
  ORCHESTRATOR_CONFIG_DIR: "HARNESS_CONFIG_DIR",
  ORCHESTRATOR_CONTAINER_MODE: "HARNESS_CONTAINER_MODE",
  ORCHESTRATOR_CSP_MODE: "HARNESS_CSP_MODE",
  ORCHESTRATOR_DATA_DIR: "HARNESS_DATA_DIR",
  ORCHESTRATOR_DEBUG: "HARNESS_DEBUG",
  ORCHESTRATOR_DEBUG_TOKEN_NOTE: "HARNESS_DEBUG_TOKEN_NOTE",
  ORCHESTRATOR_DEPLOYMENT_PROFILE: "ORCHESTRATOR_DEPLOYMENT_PROFILE",
  ORCHESTRATOR_ENABLED: "HARNESS_ENABLED",
  ORCHESTRATOR_HARD_GATES: "HARNESS_HARD_GATES",
  ORCHESTRATOR_HEARTBEAT_INTERVAL_MS: "HARNESS_HEARTBEAT_INTERVAL_MS",
  ORCHESTRATOR_HOST: "HARNESS_HOST",
  ORCHESTRATOR_HOST_IDENTITY: "HARNESS_HOST_IDENTITY",
  ORCHESTRATOR_MANIFEST_URL: "HARNESS_MANIFEST_URL",
  ORCHESTRATOR_MAX_RUNS: "ORCHESTRATOR_MAX_RUNS",
  ORCHESTRATOR_MONITOR_MODE: "ORCHESTRATOR_MONITOR_MODE",
  ORCHESTRATOR_NO_BROWSER: "HARNESS_NO_BROWSER",
  ORCHESTRATOR_NO_TTY: "HARNESS_NO_TTY",
  ORCHESTRATOR_PHASE_TIMEOUT_MS: "HARNESS_PHASE_TIMEOUT_MS",
  ORCHESTRATOR_POLICY_FAIL_OPEN: "HARNESS_POLICY_FAIL_OPEN",
  ORCHESTRATOR_PORT: "HARNESS_PORT",
  ORCHESTRATOR_PROFILE_ID: "HARNESS_PROFILE_ID",
  ORCHESTRATOR_READINESS_FORCE_BOOT_ERROR: "HARNESS_READINESS_FORCE_BOOT_ERROR",
  ORCHESTRATOR_READINESS_PORT: "HARNESS_READINESS_PORT",
  ORCHESTRATOR_RECONNECT_BASE_MS: "HARNESS_RECONNECT_BASE_MS",
  ORCHESTRATOR_RECONNECT_MAX_MS: "HARNESS_RECONNECT_MAX_MS",
  ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS: "HARNESS_REMOTE_APPROVAL_TIMEOUT_MS",
  ORCHESTRATOR_REMOTE_BRIDGE_MODE: "HARNESS_REMOTE_BRIDGE_MODE",
  ORCHESTRATOR_REMOTE_FALLBACK: "HARNESS_REMOTE_FALLBACK",
  ORCHESTRATOR_REMOTE_MODE: "HARNESS_REMOTE_MODE",
  ORCHESTRATOR_REMOTE_RUNNERS: "HARNESS_REMOTE_RUNNERS",
  ORCHESTRATOR_REQUIRE_SIGNED_MANIFEST: "HARNESS_REQUIRE_SIGNED_MANIFEST",
  ORCHESTRATOR_ROOT: "ORCHESTRATOR_ROOT",
  ORCHESTRATOR_RUNNER_BYPASS: "HARNESS_RUNNER_BYPASS",
  ORCHESTRATOR_RUNNER_EGRESS_DEBUG: "HARNESS_RUNNER_EGRESS_DEBUG",
  ORCHESTRATOR_RUNNER_HEARTBEAT_MS: "HARNESS_RUNNER_HEARTBEAT_MS",
  ORCHESTRATOR_RUNNER_IMAGE: "HARNESS_RUNNER_IMAGE",
  ORCHESTRATOR_RUNNER_STALE_INTERVAL_MS: "HARNESS_RUNNER_STALE_INTERVAL_MS",
  ORCHESTRATOR_RUNNER_TAG: "HARNESS_RUNNER_TAG",
  ORCHESTRATOR_RUN_ID: "HARNESS_RUN_ID",
  ORCHESTRATOR_RUN_JWT: "HARNESS_RUN_JWT",
  ORCHESTRATOR_RUN_MEMORY_DISABLE: "HARNESS_RUN_MEMORY_DISABLE",
  ORCHESTRATOR_RUN_MEMORY_TTL_MS: "HARNESS_RUN_MEMORY_TTL_MS",
  ORCHESTRATOR_SAMPLE_HOOKS: "HARNESS_SAMPLE_HOOKS",
  ORCHESTRATOR_SANDBOX_CLASS: "HARNESS_SANDBOX_CLASS",
  ORCHESTRATOR_TIMEOUT_PRESET: "HARNESS_TIMEOUT_PRESET",
  ORCHESTRATOR_TIMEOUT_TOTAL_MS: "HARNESS_TIMEOUT_TOTAL_MS",
  ORCHESTRATOR_TOKEN: "HARNESS_TOKEN",
  ORCHESTRATOR_TRUST_STORE: "HARNESS_TRUST_STORE",
  ORCHESTRATOR_VISUAL_LIVE_PORT: "HARNESS_VISUAL_LIVE_PORT",
  ORCHESTRATOR_WORKSPACE_DIR: "HARNESS_WORKSPACE_DIR",
  ORCHESTRATOR_WORKSPACE_PATH: "HARNESS_WORKSPACE_PATH",
  // Special prefix: HARNESS_REMOTE_RUNNER_TOKEN_* (suffix varies)
  // Handled separately in applyEnvAliases (see _aliasPrefixedKeys).
});

const PREFIX_ALIAS_MAP = Object.freeze({
  ORCHESTRATOR_REMOTE_RUNNER_TOKEN_: "HARNESS_REMOTE_RUNNER_TOKEN_",
});

function applyEnvAliases({ env = process.env, log = null } = {}) {
  const copied = [];

  // Exact-name aliases
  for (const [newKey, oldKey] of Object.entries(ALIAS_MAP)) {
    if (env[newKey] !== undefined) continue;  // new name wins
    if (env[oldKey] === undefined) continue;  // nothing to copy
    env[newKey] = env[oldKey];
    copied.push({ from: oldKey, to: newKey });
  }

  // Prefix aliases (e.g. HARNESS_REMOTE_RUNNER_TOKEN_<id>)
  const keys = Object.keys(env);
  for (const [newPrefix, oldPrefix] of Object.entries(PREFIX_ALIAS_MAP)) {
    for (const k of keys) {
      if (!k.startsWith(oldPrefix)) continue;
      const suffix = k.slice(oldPrefix.length);
      const newKey = newPrefix + suffix;
      if (env[newKey] !== undefined) continue;
      env[newKey] = env[k];
      copied.push({ from: k, to: newKey });
    }
  }

  if (typeof log === "function" && copied.length > 0) {
    try {
      log(
        "[envAlias] copied " + copied.length + " HARNESS_* → ORCHESTRATOR_* "
        + "(operator: please migrate your .env to ORCHESTRATOR_*; "
        + "HARNESS_* support is deprecated and will be removed in a future round)",
      );
    } catch (_) { /* defensive */ }
  }

  return copied;
}

module.exports = {
  applyEnvAliases,
  ALIAS_MAP,
  PREFIX_ALIAS_MAP,
};
