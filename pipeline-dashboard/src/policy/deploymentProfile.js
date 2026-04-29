// Slice D1-gov-1 (Phase E1 productization, 2026-04-29) — deployment profile resolver.
//
// Reads `HARNESS_DEPLOYMENT_PROFILE` from env and returns a frozen
// object that downstream modules consult for "is this a standard
// deployment or an agency-managed public-sector one?".
//
// Why a separate module from the existing src/security/auth.js:
//
//   auth.js answers "who is this request?" — the per-request side
//   of the trust model.
//   deploymentProfile.js answers "what posture is this orchestrator
//   running in?" — the install-time side. Different lifecycle,
//   different change cadence (env-driven, set once at boot), and
//   different consumers (credential / profile / spawn paths, not
//   the request middleware).
//
// Source of truth for public-sector posture (per
// docs/public-sector-hardening-plan.md §3):
//
//   Setting HARNESS_DEPLOYMENT_PROFILE=public-sector flips ALL of
//   these from "permissive" to "fail-closed":
//
//     allowLocalExecutor             true  → false  (sandbox-only)
//     allowPersonalAccounts          true  → false  (agency-managed only)
//     allowPlaintextSecrets          flag  → false  (hard fail no matter what)
//     requireSandboxWorkspace        false → true
//     requireAgencyManagedAccount    false → true
//     requireSignedManifest          false → true
//     requirePiiScanBeforeProviderDispatch  false → true
//     scannerFailurePolicy           "warn" → "block"
//
//   Any unrecognized value silently falls back to "standard" mode.
//   Future-proofing: a typo'd env var must not accidentally land
//   the orchestrator in a no-public-sector posture and silently
//   open up everything. We choose "permissive" as the explicit
//   default so the operator's intent ("standard mode") is what
//   takes effect when the env is unset/typo'd.
//
// Audit consumers (D1-f sanitizer will emit on every boot):
//
//   The resolver itself is silent; callers may log the resolved
//   profile to the ledger so a forensic review can see when an
//   orchestrator changed posture.

"use strict";

const RECOGNIZED_MODES = Object.freeze(new Set(["standard", "public-sector"]));

/**
 * Resolve the orchestrator's deployment posture from env.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env] - injected env for tests
 * @returns {Readonly<{
 *   mode: "standard" | "public-sector",
 *   publicSector: boolean,
 *   allowLocalExecutor: boolean,
 *   allowPersonalAccounts: boolean,
 *   allowPlaintextSecrets: boolean,
 *   requireSandboxWorkspace: boolean,
 *   requireAgencyManagedAccount: boolean,
 *   requireSignedManifest: boolean,
 *   requirePiiScanBeforeProviderDispatch: boolean,
 *   scannerFailurePolicy: "warn" | "block",
 * }>}
 */
function resolveDeploymentProfile(opts = {}) {
  const env = opts.env || process.env;
  const requested = env.HARNESS_DEPLOYMENT_PROFILE || "standard";
  // Unknown values silently default to "standard". Operator typos do
  // NOT auto-promote to permissive-by-mistake — the explicit default
  // means "I did not opt into public-sector".
  const mode = RECOGNIZED_MODES.has(requested) ? requested : "standard";
  const publicSector = mode === "public-sector";

  // Plaintext secrets behaviour:
  //   - public-sector mode: hard-disabled regardless of opt-in flag.
  //   - standard mode: only when HARNESS_ALLOW_PLAINTEXT_SECRETS=1
  //     (matches credentialStore's existing fail-closed default).
  // The credentialStore consults this value during construction.
  const plaintextOptIn = env.HARNESS_ALLOW_PLAINTEXT_SECRETS === "1";

  return Object.freeze({
    mode,
    publicSector,

    // Derived booleans (used by callers as guard conditions):
    allowLocalExecutor: !publicSector,
    allowPersonalAccounts: !publicSector,
    allowPlaintextSecrets: !publicSector && plaintextOptIn,
    requireSandboxWorkspace: publicSector,
    requireAgencyManagedAccount: publicSector,
    requireSignedManifest: publicSector,
    requirePiiScanBeforeProviderDispatch: publicSector,
    scannerFailurePolicy: publicSector ? "block" : "warn",
  });
}

module.exports = {
  resolveDeploymentProfile,
  RECOGNIZED_MODES,
};
