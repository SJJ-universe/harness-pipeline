// Slice S5-a (Phase 2 / SMART-5, 2026-05-05) — institutional policy packs.
//
// What this module is
// ───────────────────
// A frozen registry of 5 named deployment "policy packs" — each a
// well-defined preset of all the booleans + thresholds the harness
// reads from `deploymentProfile`. Operators pick one via:
//
//   HARNESS_DEPLOYMENT_PROFILE=<modeId>
//
// and the orchestrator boots with that pack's rules instead of
// hand-tuning a dozen env vars.
//
// 5 frozen packs (alphabetical):
//
//   developer-lab            Permissive; for harness developers running
//                            their own pipelines locally. Plaintext
//                            secrets opt-in OK; warn-mode gates.
//
//   finance-high-privacy     Stricter than public-sector. Local
//                            executor blocked; sandbox required;
//                            signed manifests required; PII scan
//                            fail-CLOSED + hard policy gates by
//                            default. Run-memory writes still go in
//                            (TTL covers retention).
//
//   offline-internal-network Sandbox-required. Plaintext secrets OFF.
//                            Manifest signing OFF (no internet → no
//                            cosign key registry; trust comes from
//                            isolation). PII scan warn-only (operator
//                            still wants observability without
//                            workflow-blocking gates).
//
//   public-sector            The existing 공공기관 posture. Strict
//                            sandbox + signed-manifest + PII fail-
//                            closed. Hard gates default OFF (warn
//                            graduated rollout); operator opts in via
//                            HARNESS_HARD_GATES=1.
//
//   standard                 The pre-SMART-5 default. Permissive
//                            defaults; operator can opt into
//                            plaintext via HARNESS_ALLOW_PLAINTEXT_SECRETS=1.
//                            Backwards-compatible with all pre-SMART-5
//                            harness deployments.
//
// Why a separate module from `deploymentProfile.js`
// ─────────────────────────────────────────────────
// `deploymentProfile.js` is the resolver — it reads env, applies the
// pack, returns a frozen profile. This module IS the data + frozen
// vocabulary so:
//   - tests can lock the per-pack rule shape independent of resolver
//   - GOV-* policy modules (publicSectorPolicy / piiGate / policyGates)
//     can reference pack rules without circular imports
//   - the audit-chain `deployment_profile_resolved` verb (S5-c) can
//     attribute which pack was applied
//
// Pack rule shape — the canonical fields (matches deploymentProfile
// resolver output, plus a few SMART-2/4 additions):
//
//   {
//     modeId: string,           // pack id (kebab-case, ASCII)
//     label: string,            // operator-facing English label
//     description: string,      // 1-line summary of intent
//     publicSector: boolean,    // GOV-* posture flag
//     allowLocalExecutor: bool, // direct claude/codex spawn allowed?
//     allowPersonalAccounts: bool,
//     allowPlaintextSecrets: bool,  // overrides plaintext opt-in env
//     requireSandboxWorkspace: bool,
//     requireAgencyManagedAccount: bool,
//     requireSignedManifest: bool,
//     requirePiiScanBeforeProviderDispatch: bool,
//     scannerFailurePolicy: "warn" | "block",
//     // SMART-2 additions:
//     hardGatesDefault: bool,   // implicit HARNESS_HARD_GATES=1 for this pack
//     // SMART-4 additions:
//     runMemoryEnabled: bool,   // implicit !HARNESS_RUN_MEMORY_DISABLE for this pack
//   }
//
// Pack rules are intentionally OVERRIDABLE by env vars where it
// makes sense (HARNESS_HARD_GATES, HARNESS_RUN_MEMORY_DISABLE) but
// SECURITY-CRITICAL fields (publicSector, allowLocalExecutor, etc.)
// are pack-only — operators can't soften them via env.
//
// Frozen guarantees
// ─────────────────
//   - PACKS array (and each pack object inside it) is Object.freeze'd
//   - PACK_IDS is the canonical sorted list of recognized modeIds
//   - PACK_BY_ID is a frozen lookup by modeId
//   - getPack(modeId) is the only safe accessor; isValidModeId is
//     the predicate

"use strict";

const SCHEMA = "harness-policy-pack/v1";

const RAW_PACKS = [
  {
    modeId: "developer-lab",
    label: "Developer Lab",
    description: "Permissive; harness developers running pipelines locally. Plaintext secrets opt-in OK; warn-mode gates.",
    publicSector: false,
    allowLocalExecutor: true,
    allowPersonalAccounts: true,
    allowPlaintextSecrets: true,    // opt-in via env still required (deploymentProfile gates)
    requireSandboxWorkspace: false,
    requireAgencyManagedAccount: false,
    requireSignedManifest: false,
    requirePiiScanBeforeProviderDispatch: false,
    scannerFailurePolicy: "warn",
    hardGatesDefault: false,
    runMemoryEnabled: true,
  },

  {
    modeId: "finance-high-privacy",
    label: "Finance High-Privacy",
    description: "Stricter than public-sector. Local executor blocked; sandbox required; signed manifests required; PII scan fail-closed; HARD gates default ON.",
    publicSector: true,
    allowLocalExecutor: false,
    allowPersonalAccounts: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requireAgencyManagedAccount: true,
    requireSignedManifest: true,
    requirePiiScanBeforeProviderDispatch: true,
    scannerFailurePolicy: "block",
    hardGatesDefault: true,         // SMART-2 hard gates ON by default for this pack
    runMemoryEnabled: true,
  },

  {
    modeId: "offline-internal-network",
    label: "Offline Internal Network",
    description: "Sandbox-required. Plaintext secrets off. Manifest signing off (no internet → no cosign key registry; trust comes from isolation). PII scan warn-only.",
    publicSector: false,
    allowLocalExecutor: false,
    allowPersonalAccounts: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requireAgencyManagedAccount: false,
    requireSignedManifest: false,   // off — no public key infra in offline net
    requirePiiScanBeforeProviderDispatch: false,
    scannerFailurePolicy: "warn",
    hardGatesDefault: false,
    runMemoryEnabled: true,
  },

  {
    modeId: "public-sector",
    label: "Public Sector",
    description: "Existing 공공기관 posture. Strict sandbox + signed-manifest + PII fail-closed. Hard gates default OFF (warn graduated rollout).",
    publicSector: true,
    allowLocalExecutor: false,
    allowPersonalAccounts: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requireAgencyManagedAccount: true,
    requireSignedManifest: true,
    requirePiiScanBeforeProviderDispatch: true,
    scannerFailurePolicy: "block",
    hardGatesDefault: false,        // operator opts in via env (graduated rollout)
    runMemoryEnabled: true,
  },

  {
    modeId: "standard",
    label: "Standard",
    description: "Pre-SMART-5 default. Permissive; operator opts into plaintext via HARNESS_ALLOW_PLAINTEXT_SECRETS=1. Backwards-compatible.",
    publicSector: false,
    allowLocalExecutor: true,
    allowPersonalAccounts: true,
    allowPlaintextSecrets: true,    // opt-in env still required
    requireSandboxWorkspace: false,
    requireAgencyManagedAccount: false,
    requireSignedManifest: false,
    requirePiiScanBeforeProviderDispatch: false,
    scannerFailurePolicy: "warn",
    hardGatesDefault: false,
    runMemoryEnabled: true,
  },
];

// Validate + freeze each pack at module load. Authoring mistakes
// surface at require()-time rather than first resolveDeploymentProfile.
const PACKS = Object.freeze(RAW_PACKS.map((raw) => {
  if (typeof raw.modeId !== "string" || !/^[a-z][a-z0-9-]*$/.test(raw.modeId)) {
    throw new Error(`policyPackRegistry: invalid modeId "${raw.modeId}"`);
  }
  if (typeof raw.label !== "string" || raw.label.length === 0) {
    throw new Error(`policyPackRegistry: ${raw.modeId} missing label`);
  }
  if (typeof raw.description !== "string" || raw.description.length === 0) {
    throw new Error(`policyPackRegistry: ${raw.modeId} missing description`);
  }
  // Boolean / enum field validation — operator-facing rule keys must
  // be present + correctly typed.
  const requiredBools = [
    "publicSector",
    "allowLocalExecutor",
    "allowPersonalAccounts",
    "allowPlaintextSecrets",
    "requireSandboxWorkspace",
    "requireAgencyManagedAccount",
    "requireSignedManifest",
    "requirePiiScanBeforeProviderDispatch",
    "hardGatesDefault",
    "runMemoryEnabled",
  ];
  for (const key of requiredBools) {
    if (typeof raw[key] !== "boolean") {
      throw new Error(
        `policyPackRegistry: ${raw.modeId} field "${key}" must be boolean (got ${typeof raw[key]})`,
      );
    }
  }
  if (raw.scannerFailurePolicy !== "warn" && raw.scannerFailurePolicy !== "block") {
    throw new Error(
      `policyPackRegistry: ${raw.modeId} scannerFailurePolicy must be "warn" or "block"`,
    );
  }

  // Cross-field invariant: public-sector packs cannot allow local executor
  // or plaintext secrets. This catches authoring mistakes where someone
  // adds a pack with publicSector=true but forgets to flip the related
  // restrictions.
  if (raw.publicSector === true) {
    if (raw.allowLocalExecutor !== false) {
      throw new Error(
        `policyPackRegistry: ${raw.modeId} publicSector=true requires allowLocalExecutor=false`,
      );
    }
    if (raw.allowPlaintextSecrets !== false) {
      throw new Error(
        `policyPackRegistry: ${raw.modeId} publicSector=true requires allowPlaintextSecrets=false`,
      );
    }
    if (raw.requireSandboxWorkspace !== true) {
      throw new Error(
        `policyPackRegistry: ${raw.modeId} publicSector=true requires requireSandboxWorkspace=true`,
      );
    }
  }

  return Object.freeze({
    modeId: raw.modeId,
    label: raw.label,
    description: raw.description,
    publicSector: raw.publicSector,
    allowLocalExecutor: raw.allowLocalExecutor,
    allowPersonalAccounts: raw.allowPersonalAccounts,
    allowPlaintextSecrets: raw.allowPlaintextSecrets,
    requireSandboxWorkspace: raw.requireSandboxWorkspace,
    requireAgencyManagedAccount: raw.requireAgencyManagedAccount,
    requireSignedManifest: raw.requireSignedManifest,
    requirePiiScanBeforeProviderDispatch: raw.requirePiiScanBeforeProviderDispatch,
    scannerFailurePolicy: raw.scannerFailurePolicy,
    hardGatesDefault: raw.hardGatesDefault,
    runMemoryEnabled: raw.runMemoryEnabled,
  });
}));

const PACK_IDS = Object.freeze(PACKS.map((p) => p.modeId).sort());
const PACK_BY_ID = Object.freeze(PACKS.reduce((acc, p) => {
  acc[p.modeId] = p;
  return acc;
}, Object.create(null)));

// Default fallback pack — the standard pack. Used by deploymentProfile
// when env is unset (NOT when env is typo'd; that's a fail-closed boot
// fail per plan §S §S-SMART-5 v2).
const DEFAULT_PACK_ID = "standard";

/**
 * Resolve a modeId to its frozen pack rules.
 * @param {string} modeId
 * @returns {object|undefined}
 */
function getPack(modeId) {
  if (typeof modeId !== "string" || modeId.length === 0) return undefined;
  return PACK_BY_ID[modeId];
}

/**
 * @param {string} modeId
 * @returns {boolean}
 */
function isValidModeId(modeId) {
  return typeof modeId === "string"
    && Object.prototype.hasOwnProperty.call(PACK_BY_ID, modeId);
}

/**
 * Public list — operator-facing pack catalog. Returns the frozen
 * pack array (callers MUST NOT mutate; the array + each entry is
 * frozen).
 * @returns {ReadonlyArray<object>}
 */
function listPacks() {
  return PACKS;
}

/**
 * Slim summary suitable for shipping to the browser. UI catalog
 * pages only need id + label + description, not the full rule set.
 * @returns {ReadonlyArray<{modeId, label, description}>}
 */
function listPackSummaries() {
  return PACKS.map((p) => ({
    modeId: p.modeId,
    label: p.label,
    description: p.description,
  }));
}

module.exports = {
  SCHEMA,
  PACKS,
  PACK_IDS,
  DEFAULT_PACK_ID,
  getPack,
  isValidModeId,
  listPacks,
  listPackSummaries,
};
