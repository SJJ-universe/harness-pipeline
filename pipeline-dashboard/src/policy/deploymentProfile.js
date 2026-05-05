// Slice D1-gov-1 (Phase E1, 2026-04-29) — deployment profile resolver.
// Slice S5-b (Phase 2 / SMART-5, 2026-05-05) — extended to consult
// the policyPackRegistry. The resolver now supports 5 packs (standard
// / public-sector / finance-high-privacy / offline-internal-network
// / developer-lab) and FAILS CLOSED on unknown env values in production
// (escape hatch: HARNESS_POLICY_FAIL_OPEN=1 → standard fallback + warn).
//
// Why a separate module from src/security/auth.js:
//
//   auth.js answers "who is this request?" — the per-request side
//   of the trust model.
//   deploymentProfile.js answers "what posture is this orchestrator
//   running in?" — the install-time side. Different lifecycle,
//   different change cadence (env-driven, set once at boot), and
//   different consumers (credential / profile / spawn paths, not
//   the request middleware).
//
// SMART-5 v2 fail-closed-on-unknown rationale
// ───────────────────────────────────────────
// Pre-SMART-5 behavior: a typo'd HARNESS_DEPLOYMENT_PROFILE silently
// fell back to "standard". An operator who meant to set
// "public-sector" but typed "publicsector" would silently land in a
// permissive posture — exactly the failure mode public-sector
// deployments cannot tolerate.
//
// SMART-5 v2 reverses that: in production (default), an unknown env
// value → throws POLICY_PACK_UNKNOWN error. server.js catches at boot
// and exits 1 with a structured audit row so the operator sees the
// typo before any pipeline runs.
//
// Operators in development / sandbox / migration windows can opt into
// the legacy fall-back-to-standard behavior with HARNESS_POLICY_FAIL_OPEN=1.
// The fallback path emits a `policy_pack_fallback` audit signal in the
// returned profile object so server.js boot can land an audit row
// covering the dev-escape decision.
//
// Backward compat
// ───────────────
//   - Empty / unset HARNESS_DEPLOYMENT_PROFILE → standard pack (no
//     change from pre-SMART-5; the explicit absence of env is NOT a typo)
//   - "standard" / "public-sector" → resolve from registry (same
//     posture rules as pre-SMART-5)
//   - 3 new modes (finance-high-privacy / offline-internal-network /
//     developer-lab) → resolve from registry
//   - Anything else: fail-closed in production, fallback in dev escape
//
// Profile shape additions (vs. pre-SMART-5)
// ─────────────────────────────────────────
//   - pack: string  — modeId of the resolved pack
//   - packLabel: string — operator-facing label
//   - hardGatesDefault: boolean — SMART-2 default for HARNESS_HARD_GATES
//   - runMemoryEnabled: boolean — SMART-4 default for !HARNESS_RUN_MEMORY_DISABLE
//   - resolvedFromFallback: boolean — true when dev-escape fell back
//   - unknownRequested: string|null — the typo'd value when fallback fired

"use strict";

const packRegistry = require("./policyPackRegistry");

// Pre-SMART-5 RECOGNIZED_MODES export. Kept for callers that import
// it directly. Now wraps the registry's PACK_IDS so all 5 modes
// surface, not just the original 2.
const RECOGNIZED_MODES = Object.freeze(new Set(packRegistry.PACK_IDS));

const POLICY_PACK_UNKNOWN_CODE = "POLICY_PACK_UNKNOWN";

function _isFailOpen(env) {
  const v = String(env.HARNESS_POLICY_FAIL_OPEN || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Resolve the orchestrator's deployment posture from env.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env] - injected env for tests
 * @returns {Readonly<{
 *   mode: string,                       // pack modeId (one of PACK_IDS)
 *   pack: string,                       // alias of mode (S5-b)
 *   packLabel: string,                  // operator-facing label (S5-b)
 *   publicSector: boolean,
 *   allowLocalExecutor: boolean,
 *   allowPersonalAccounts: boolean,
 *   allowPlaintextSecrets: boolean,
 *   requireSandboxWorkspace: boolean,
 *   requireAgencyManagedAccount: boolean,
 *   requireSignedManifest: boolean,
 *   requirePiiScanBeforeProviderDispatch: boolean,
 *   scannerFailurePolicy: "warn" | "block",
 *   hardGatesDefault: boolean,          // S5-b: SMART-2 pack default
 *   runMemoryEnabled: boolean,          // S5-b: SMART-4 pack default
 *   resolvedFromFallback: boolean,      // S5-b: true when dev-escape fired
 *   unknownRequested: string|null,      // S5-b: original typo when fallback fired
 * }>}
 *
 * @throws {Error} with `code: POLICY_PACK_UNKNOWN` when env mode is
 *   unknown AND `HARNESS_POLICY_FAIL_OPEN` is not set (production
 *   fail-closed). server.js catches at boot.
 */
function resolveDeploymentProfile(opts = {}) {
  const env = opts.env || process.env;
  const requested = env.HARNESS_DEPLOYMENT_PROFILE;
  const failOpen = _isFailOpen(env);

  let modeId;
  let resolvedFromFallback = false;
  let unknownRequested = null;

  if (!requested || requested.length === 0) {
    // Unset env is NOT a typo — it's the operator saying nothing.
    // Resolve to the registry default (standard); no audit signal,
    // no warning. Backward compat with pre-SMART-5.
    modeId = packRegistry.DEFAULT_PACK_ID;
  } else if (packRegistry.isValidModeId(requested)) {
    modeId = requested;
  } else {
    // Unknown mode requested. SMART-5 v2 decision matrix:
    //   - HARNESS_POLICY_FAIL_OPEN=1 → fall back to standard + signal
    //     in profile.resolvedFromFallback so server.js can audit
    //   - default (production) → throw POLICY_PACK_UNKNOWN
    if (failOpen) {
      modeId = packRegistry.DEFAULT_PACK_ID;
      resolvedFromFallback = true;
      unknownRequested = String(requested);
    } else {
      const err = new Error(
        `Unknown HARNESS_DEPLOYMENT_PROFILE="${requested}". ` +
        `Recognized: ${packRegistry.PACK_IDS.join(", ")}. ` +
        `Set HARNESS_POLICY_FAIL_OPEN=1 to fall back to standard with a warning.`,
      );
      err.code = POLICY_PACK_UNKNOWN_CODE;
      err.requested = String(requested);
      err.knownPackIds = packRegistry.PACK_IDS;
      throw err;
    }
  }

  const pack = packRegistry.getPack(modeId);
  // Defensive — getPack should always return for a validated modeId,
  // but if the registry shape ever drifts, fail loud rather than
  // silently producing a partial profile.
  if (!pack) {
    throw new Error(`policyPackRegistry inconsistency: no pack for "${modeId}"`);
  }

  // Plaintext secrets behaviour:
  //   - pack-level: pack.allowPlaintextSecrets gates whether the
  //     env opt-in even matters
  //   - env-level: HARNESS_ALLOW_PLAINTEXT_SECRETS=1 must ALSO be set
  //   Both together → allowed; either off → blocked.
  // Pre-SMART-5 (binary mode) had this same behavior; SMART-5
  // generalizes it via pack rule.
  const plaintextOptIn = env.HARNESS_ALLOW_PLAINTEXT_SECRETS === "1";

  return Object.freeze({
    mode: pack.modeId,
    pack: pack.modeId,            // S5-b alias
    packLabel: pack.label,        // S5-b
    publicSector: pack.publicSector,
    allowLocalExecutor: pack.allowLocalExecutor,
    allowPersonalAccounts: pack.allowPersonalAccounts,
    allowPlaintextSecrets: pack.allowPlaintextSecrets && plaintextOptIn,
    requireSandboxWorkspace: pack.requireSandboxWorkspace,
    requireAgencyManagedAccount: pack.requireAgencyManagedAccount,
    requireSignedManifest: pack.requireSignedManifest,
    requirePiiScanBeforeProviderDispatch: pack.requirePiiScanBeforeProviderDispatch,
    scannerFailurePolicy: pack.scannerFailurePolicy,
    // S5-b additions:
    hardGatesDefault: pack.hardGatesDefault,
    runMemoryEnabled: pack.runMemoryEnabled,
    resolvedFromFallback,
    unknownRequested,
  });
}

module.exports = {
  resolveDeploymentProfile,
  RECOGNIZED_MODES,
  POLICY_PACK_UNKNOWN_CODE,
};
