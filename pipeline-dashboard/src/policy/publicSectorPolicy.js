// Slice D1-gov-2 (Phase E1 productization, 2026-04-29) — public-sector policy assertions.
//
// Per docs/public-sector-hardening-plan.md §3+§4. This module:
//   1. Validates an operator-supplied profile against public-sector
//      requirements (accountType, workspaceMode, credentialBackend,
//      dataClassification, egressPolicyId).
//   2. Asserts that local executor paths refuse to run when policy
//      forbids them (`assertLocalExecutorAllowed`).
//
// Wiring contract (which callers consume which export):
//
//   credentialStore (D1-gov-3) — reads `deploymentProfile.allowPlaintextSecrets`
//                                directly; no need to call this module's
//                                validators.
//   profileStore    (D1-gov-4) — calls `validateProfileForPublicSector`
//                                inside `upsert` when profile mode is
//                                public-sector. Errors are bubbled to the
//                                route layer as 400.
//   profileSpawn    (D1-gov-5) — calls `assertLocalExecutorAllowed`
//                                before any direct local spawn path.
//   Claude/Codex runners (D1-d) — call `assertLocalExecutorAllowed`
//                                AGAIN at spawn time (defense in depth —
//                                if profileSpawn is bypassed by a future
//                                refactor, this catches it).
//
// Why the profile schema fields here (accountType, workspaceMode,
// credentialBackend, egressPolicyId) overlap with but differ from
// the D1-b profileStore schema (id, label, workspacePath,
// activeProvider, secretIds):
//
//   D1-b's profileStore was designed for the standard-mode use case
//   ("operator stores Anthropic key for personal account"). The
//   public-sector hardening plan adds AGENCY-LAYER fields that the
//   standard mode doesn't need but public-sector does. The cleanest
//   integration is:
//     - profileStore.upsert accepts the new optional fields
//     - validateProfileForPublicSector enforces them when in public-
//       sector mode
//     - standard-mode profiles still work without the extra fields
//
//   This module knows about both layers. profileStore (D1-b) didn't
//   need to.

"use strict";

const REQUIRED_ACCOUNT_TYPE = "agency_managed";
const REQUIRED_WORKSPACE_MODE = "sandbox";
const PLAINTEXT_BACKENDS = Object.freeze(new Set([
  "plaintext",
  "plaintext_dev_only",
]));

/**
 * Check if a profile is acceptable under public-sector policy.
 *
 * Returns `{ ok, errors }` instead of throwing so the route layer
 * can collect ALL violations at once and present them to the
 * operator in a single response — rather than the operator fixing
 * one issue at a time across N round-trips.
 *
 * @param {object} profile
 *   Raw profile object with public-sector fields. Standard-mode
 *   profileStore upsert input shape (id, label, workspacePath,
 *   activeProvider, secretIds) augmented with public-sector fields:
 *     accountType         — "agency_managed" | "personal" | "client"
 *     workspaceMode       — "sandbox" | "local"
 *     credentialBackend   — "wincred" | "keychain" | "plaintext" | ...
 *     dataClassification  — "internal" | "confidential" | ...
 *     egressPolicyId      — string identifying agency egress allowlist
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateProfileForPublicSector(profile) {
  const errors = [];

  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return {
      ok: false,
      errors: ["public-sector validation: profile must be an object"],
    };
  }

  if (profile.accountType !== REQUIRED_ACCOUNT_TYPE) {
    errors.push(
      `public-sector profiles must use accountType=${REQUIRED_ACCOUNT_TYPE} ` +
      `(got "${profile.accountType}")`,
    );
  }

  if (profile.workspaceMode !== REQUIRED_WORKSPACE_MODE) {
    errors.push(
      `public-sector profiles must use workspaceMode=${REQUIRED_WORKSPACE_MODE} ` +
      `(got "${profile.workspaceMode}")`,
    );
  }

  // credentialBackend is set by the credentialStore at construction
  // time; the profile records which backend it was created against
  // so a mid-run posture flip can refuse to launch under a backend
  // that's no longer policy-acceptable.
  if (PLAINTEXT_BACKENDS.has(profile.credentialBackend)) {
    errors.push(
      `public-sector profiles cannot use plaintext credential backend ` +
      `(got "${profile.credentialBackend}")`,
    );
  }

  // egressPolicyId is required so the runner knows which agency
  // allowlist to enforce. Standard-mode profiles don't need this
  // because the runner enforces "report-only" hooks.
  if (typeof profile.egressPolicyId !== "string" || profile.egressPolicyId.length === 0) {
    errors.push(
      "public-sector profiles require egressPolicyId (non-empty string)",
    );
  }

  // dataClassification is informational at the policy layer (the
  // approval flow + auditor evidence consume it). Required because
  // operators must mark every profile with a classification — empty
  // is a configuration mistake.
  if (typeof profile.dataClassification !== "string" || profile.dataClassification.length === 0) {
    errors.push(
      "public-sector profiles require dataClassification (non-empty string)",
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a policy error if local executor paths are forbidden.
 *
 * Designed to be called at spawn time (not just at config time) so a
 * mid-process posture change correctly aborts the next spawn instead
 * of letting an in-flight Claude/Codex child run under stale policy.
 *
 * @param {object} deploymentProfile
 *   Result of `resolveDeploymentProfile()`. The relevant field is
 *   `allowLocalExecutor` (false in public-sector mode).
 * @throws Error with `code: "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED"`
 *   when local executor is forbidden.
 */
function assertLocalExecutorAllowed(deploymentProfile) {
  if (!deploymentProfile) {
    // Defensive: a missing posture object is itself a misconfiguration,
    // but we don't want to crash the orchestrator on first install.
    // Treat as "standard mode", which is what an empty env resolves to.
    return;
  }
  if (deploymentProfile.allowLocalExecutor === false) {
    const err = new Error(
      "local executor disabled by public-sector policy " +
      "(set HARNESS_DEPLOYMENT_PROFILE=standard to allow, or use a " +
      "remote runner via HARNESS_REMOTE_MODE)",
    );
    err.code = "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED";
    throw err;
  }
}

/**
 * Slice GOV-SB-0 (Phase E1.5, 2026-04-29) — sandbox-workspace re-check.
 *
 * D1-gov-2's `validateProfileForPublicSector` already rejects profiles
 * with `workspaceMode !== "sandbox"` at upsert time. This is the
 * spawn-time twin assertion: even if a profile somehow ended up on
 * disk with `workspaceMode === "local"` (older format / hand-edit /
 * mid-flight posture flip from standard → public-sector), refuse to
 * launch under it.
 *
 * Why a separate function from `assertLocalExecutorAllowed`:
 *   - assertLocalExecutorAllowed gates the whole local-executor surface
 *     (no profile required — fires even on the P0 fallback path).
 *   - assertSandboxWorkspaceRequired needs the resolved profile object,
 *     so it lives just past the profileStore.get() call inside
 *     profileSpawn.
 *   - Two distinct error codes let the audit row carry which gate
 *     fired ("local executor surface" vs. "wrong workspace mode for
 *     this profile") so an operator triaging a deny-by-policy can
 *     fix the right thing.
 *
 * @param {object} profile
 *   Resolved profile object from profileStore.get(profileId).
 * @param {object} deploymentProfile
 *   Result of `resolveDeploymentProfile()`. The relevant field is
 *   `requireSandboxWorkspace` (true in public-sector mode).
 * @throws Error with `code: "PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED"`
 *   when public-sector requires sandbox but the profile is local.
 */
function assertSandboxWorkspaceRequired(profile, deploymentProfile) {
  if (!deploymentProfile || deploymentProfile.requireSandboxWorkspace !== true) {
    return;
  }
  if (!profile || typeof profile !== "object") return;
  if (profile.workspaceMode === REQUIRED_WORKSPACE_MODE) return;
  const err = new Error(
    `public-sector policy requires workspaceMode="${REQUIRED_WORKSPACE_MODE}" ` +
    `but profile "${profile.id || "<unknown>"}" has workspaceMode="${profile.workspaceMode || "<unset>"}". ` +
    `Recreate the profile with sandbox workspace, or set HARNESS_DEPLOYMENT_PROFILE=standard.`,
  );
  err.code = "PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED";
  throw err;
}

// Slice GOV-SB-0: stable set of error codes the runner-level audit
// emitter recognizes. When err.code is one of these, the runner emits
// a `local_executor_blocked` ledger row instead of just bubbling the
// failure up. Frozen so a future caller can't extend the policy
// vocabulary without an explicit code change.
const POLICY_BLOCK_CODES = Object.freeze(new Set([
  "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED",
  "PUBLIC_SECTOR_SANDBOX_WORKSPACE_REQUIRED",
  // Slice GOV-APPROVAL-0: write-tool dispatch in public-sector mode
  // requires an approvalManager wired through the hook-router. When
  // missing, the gate refuses every write-tool dispatch and emits
  // the public-sector audit shape rather than the generic
  // `approval_unavailable`.
  "PUBLIC_SECTOR_APPROVAL_MANAGER_REQUIRED",
]));

// Slice GOV-APPROVAL-0 (Phase E1.5, 2026-04-29) — approval gate helpers.

/**
 * @param {object} deploymentProfile
 *   Result of `resolveDeploymentProfile()`. Must have
 *   `requirePiiScanBeforeProviderDispatch` to qualify for write-tool
 *   approval enforcement (the same flag GOV-PII-0 uses — operators
 *   tuning posture flip the same switch for all three layers).
 * @returns {boolean} true when posture mandates per-call approval
 *   for write tools, false otherwise (standard posture defers to
 *   the hook-router's own approvalManager-or-fail-closed policy).
 */
function requiresWriteToolApproval(deploymentProfile) {
  if (!deploymentProfile) return false;
  // Public-sector posture mandates approval when both the local
  // PII gate is required AND the scanner is fail-closed. This is
  // the same set GOV-PII-0 uses for the inline gate; reusing it
  // keeps operators from having to learn a separate posture lever
  // for write-tool approval.
  return deploymentProfile.publicSector === true
    && deploymentProfile.requirePiiScanBeforeProviderDispatch === true;
}

/**
 * Public-sector hard requirement: when posture mandates write-tool
 * approval but no approvalManager is wired into the hook-router,
 * fail loud with a structured error so the operator gets a
 * specific remediation hint ("wire approvalManager") rather than
 * the generic `approval_unavailable` reason.
 *
 * Standard-posture deployments are unaffected — the hook-router's
 * own fail-closed policy already handles the missing-manager case
 * with `approval_unavailable`.
 *
 * @param {object} deploymentProfile
 * @param {object|null} approvalManager
 * @throws Error with `code: "PUBLIC_SECTOR_APPROVAL_MANAGER_REQUIRED"`
 *   when public-sector mandates approval and the manager is missing.
 */
function assertWriteToolApprovalAvailable(deploymentProfile, approvalManager) {
  if (!requiresWriteToolApproval(deploymentProfile)) return;
  if (approvalManager && typeof approvalManager.request === "function") return;
  const err = new Error(
    `public-sector policy requires per-call approval for write tools ` +
    `(Bash/Edit/Write) but no approvalManager is wired into the hook-router. ` +
    `Construct HookRouter with { approvalManager } pointing at the same ` +
    `instance the /api/approvals routes use, or set ` +
    `HARNESS_DEPLOYMENT_PROFILE=standard.`,
  );
  err.code = "PUBLIC_SECTOR_APPROVAL_MANAGER_REQUIRED";
  throw err;
}

/**
 * Convenience for routes that want a 400-shaped response on policy
 * failure. Returns null when validation passed, or a JSON-ready
 * object otherwise.
 *
 * @param {object} profile
 * @returns {null | { error: string, details: string[] }}
 */
function buildPolicyErrorResponse(profile) {
  const verdict = validateProfileForPublicSector(profile);
  if (verdict.ok) return null;
  return {
    error: "public_sector_profile_policy",
    details: verdict.errors,
  };
}

module.exports = {
  validateProfileForPublicSector,
  assertLocalExecutorAllowed,
  assertSandboxWorkspaceRequired,
  // Slice GOV-APPROVAL-0 additions:
  requiresWriteToolApproval,
  assertWriteToolApprovalAvailable,
  buildPolicyErrorResponse,
  // Exposed for tests + downstream modules that need to know which
  // backends are considered "plaintext" (e.g., credentialStore can
  // read the same constant when deciding what to refuse).
  PLAINTEXT_BACKENDS,
  REQUIRED_ACCOUNT_TYPE,
  REQUIRED_WORKSPACE_MODE,
  POLICY_BLOCK_CODES,
};
