// Slice POL-b (Phase 2 / POLICY-UX-0, 2026-05-05) — policy pack catalog API.
//
// Endpoints:
//
//   GET /api/policy-packs
//     No body. Returns:
//       {
//         schema: "harness-policy-pack/v1",
//         currentPack: { modeId, label, ... },     // resolved profile
//         packs: [...5 packs with full rule fields],
//         metadata: {
//           hardGatesEffectiveMode: "hard"|"warn",  // POL-a runtime mode
//           runMemoryEffective: true|false,         // POL-a runtime
//           hardGatesEnvOverride: bool,             // operator set HARNESS_HARD_GATES
//           runMemoryEnvOverride: bool,             // HARNESS_RUN_MEMORY_DISABLE
//         }
//       }
//
// Why a NEW route vs. extending /api/server/info
// ──────────────────────────────────────────────
// /api/server/info returns the RESOLVED profile (single pack). The
// POL-b route exposes the FULL CATALOG with comparison metadata so
// operators can decide which pack to pick. Different audiences:
//   /api/server/info     — "what am I running?" (every UI panel polls)
//   /api/policy-packs    — "what could I switch to?" (UI catalog page)
//
// Read-only — operator changes pack via env restart, not via this route.
// Documented in POL-c UI panel + POLICY-UX-0 closeout. Restricting to
// read-only is intentional: changing deployment posture mid-run would
// require auditing + atomic re-resolution + restart of every runner;
// out of scope for this round.

"use strict";

const express = require("express");

const policyPackRegistry = require("../policy/policyPackRegistry");
const policyGates = require("../policy/policyGates");

const ROUTE_ERROR_CODES = Object.freeze({
  registry_unavailable: "registry_unavailable",
});

function _writeError(res, status, code, extra = null) {
  const body = { ok: false, error: code };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return res.status(status).json(body);
}

/**
 * @param {object} deps
 * @param {object} [deps.deploymentProfile] - resolveDeploymentProfile() result
 *   from server.js boot. Used to populate metadata.currentPack.
 * @param {object} [deps.env=process.env] - injected for tests
 * @returns {express.Router}
 */
function createPolicyPackRoutes(deps = {}) {
  const router = express.Router();
  const env = deps.env || (typeof process !== "undefined" ? process.env : {});
  const deploymentProfile = deps.deploymentProfile || null;

  router.get("/policy-packs", (_req, res) => {
    let packs;
    try {
      packs = policyPackRegistry.listPacks();
    } catch (_err) {
      return _writeError(res, 503, ROUTE_ERROR_CODES.registry_unavailable);
    }
    if (!Array.isArray(packs) || packs.length === 0) {
      return _writeError(res, 503, ROUTE_ERROR_CODES.registry_unavailable);
    }

    // Resolve current pack id from deploymentProfile (if present)
    const currentPackId = deploymentProfile && deploymentProfile.pack
      ? deploymentProfile.pack
      : null;

    // POL-a runtime metadata: what mode is actually in effect right now?
    const hardGatesEffectiveMode = policyGates.resolveGateMode(env, deploymentProfile);
    const hardGatesEnv = String(env.HARNESS_HARD_GATES || "").trim().toLowerCase();
    const runMemoryEnv = String(env.HARNESS_RUN_MEMORY_DISABLE || "").trim().toLowerCase();
    const hardGatesEnvOverride = hardGatesEnv === "1" || hardGatesEnv === "true"
      || hardGatesEnv === "hard" || hardGatesEnv === "0"
      || hardGatesEnv === "false" || hardGatesEnv === "warn"
      || hardGatesEnv === "no";
    const runMemoryEnvOverride = runMemoryEnv === "1" || runMemoryEnv === "true"
      || runMemoryEnv === "yes";
    const runMemoryEffective = !runMemoryEnvOverride
      && (!deploymentProfile || deploymentProfile.runMemoryEnabled !== false);

    return res.json({
      schema: policyPackRegistry.SCHEMA,
      currentPack: currentPackId,
      packs: packs.map((p) => ({
        modeId: p.modeId,
        label: p.label,
        description: p.description,
        publicSector: p.publicSector,
        allowLocalExecutor: p.allowLocalExecutor,
        allowPersonalAccounts: p.allowPersonalAccounts,
        allowPlaintextSecrets: p.allowPlaintextSecrets,
        requireSandboxWorkspace: p.requireSandboxWorkspace,
        requireAgencyManagedAccount: p.requireAgencyManagedAccount,
        requireSignedManifest: p.requireSignedManifest,
        requirePiiScanBeforeProviderDispatch: p.requirePiiScanBeforeProviderDispatch,
        scannerFailurePolicy: p.scannerFailurePolicy,
        hardGatesDefault: p.hardGatesDefault,
        runMemoryEnabled: p.runMemoryEnabled,
        // Whether this pack is the currently-resolved one
        isCurrent: p.modeId === currentPackId,
      })),
      metadata: {
        hardGatesEffectiveMode,
        runMemoryEffective,
        hardGatesEnvOverride,
        runMemoryEnvOverride,
        // Public-sector requirements text — operators selecting a
        // public-sector pack need to know what's expected of them.
        publicSectorRequirements: [
          "agency-managed account (operator workflow + IT-issued profile)",
          "sandbox workspace (Docker / VM isolation; HARNESS_DEPLOYMENT_PROFILE alone is not enough)",
          "signed manifest (E3-F1 launcher gate + GOV-RELEASE-0 trust-store keys)",
          "PII scan fail-closed (gate refuses provider dispatch on detection)",
          "no plaintext secrets (HARNESS_ALLOW_PLAINTEXT_SECRETS=1 is silently ignored)",
        ],
      },
      serverTime: Date.now(),
    });
  });

  return router;
}

module.exports = {
  createPolicyPackRoutes,
  ROUTE_ERROR_CODES,
};
