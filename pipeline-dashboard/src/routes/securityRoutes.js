// Slice GOV-PII-1-b (Phase E1.5, 2026-04-29) — security scan HTTP API.
//
// One endpoint:
//
//   POST /api/security/scan
//     Body: { content, filename?, source?, depth?, maxBytes? }
//     Response: { ok, blocked, scan, reason, auditVerb, auditData,
//                 filename, sizeBytes, depth }
//
// Used by:
//
//   - Public-sector wizard "import file" step (future GOV-* slices
//     extend setup-wizard's public-sector track to scan attachments
//     before they land in the agency workspace)
//   - Operator-driven file checks via the settings-accounts modal
//     (D3-d already wires the modal; D3-d's scope was profile
//     management — file-scan UI is a follow-up integration point)
//   - Direct CLI / curl usage for one-off operator audits
//
// Why a dedicated /api/security/* prefix (not /api/setup/*):
//
//   /api/setup is the first-run flow + diagnostic surface (D2-c).
//   /api/security is the steady-state security check surface — file
//   scans run repeatedly across the lifetime of a deployment, not
//   just once at install. Two namespaces, two operator stories.
//
// Why a separate audit verb family (pii_file_scan_*) from GOV-PII-0
// (pii_scan_*):
//
//   GOV-PII-0's pii_scan_blocked/warn fires from inline pre-dispatch
//   (claude-runner / codex-runner). pii_file_scan_blocked/warn fires
//   from the file-content scan. Auditors triaging a forensic event
//   need to tell at a glance whether a PII detection happened on
//   prompt-text or on file-content. Same audit shape, different verb
//   prefix.
//
// Posture handling:
//
//   - public-sector posture (requirePiiScanBeforeProviderDispatch=true
//     OR scannerFailurePolicy="block"): hasPii → blocked=true,
//     ok=false, audit verb pii_file_scan_blocked, reason "pii_detected".
//   - standard posture: hasPii → ok=true, blocked=false, audit verb
//     pii_file_scan_warn (observability without enforcement).
//   - clean scan: ok=true, blocked=false, NO audit row (keeps the
//     audit chain quiet under normal operation).
//
// Size caps:
//
//   express.json({ limit: "1mb" }) so a 2MB attachment can't OOM
//   the orchestrator. The scanner's pathological-input cap
//   (maxFindingsPerType=100) prevents huge match counts from
//   exploding the response payload either.

"use strict";

const express = require("express");
const { scanForPii } = require("../security/piiScanner");

// Stable audit verbs (frozen — wire-format lock for forensic queries).
const AUDIT_VERBS = Object.freeze({
  BLOCKED: "pii_file_scan_blocked",
  WARN: "pii_file_scan_warn",
});

const REASON_PII_DETECTED = "pii_detected";

// Default depth for the file-scan endpoint is "deep" — the operator
// is opting INTO a file content scan, so they want the fuller pattern
// set (BRN / driver license / passport in addition to the GOV-PII-0
// inline 5).
const DEFAULT_SCAN_DEPTH = "deep";

const ALLOWED_DEPTHS = Object.freeze(new Set(["inline", "deep"]));

const MAX_CONTENT_BYTES = 1024 * 1024; // 1MB hard cap (mirrors body parser limit)

const DEFAULT_SOURCE = "file_import";

/**
 * Build the security scan router.
 *
 * @param {object} deps
 * @param {object} [deps.ledger] - audit handle. When present, the
 *   route emits pii_file_scan_blocked / pii_file_scan_warn rows on
 *   every match-bearing scan. Clean scans never emit (audit chain
 *   stays quiet under normal operation).
 * @param {object} [deps.deploymentProfile] - resolveDeploymentProfile()
 *   result. The route consults requirePiiScanBeforeProviderDispatch +
 *   scannerFailurePolicy to decide block vs. warn. Missing dep →
 *   defaults to standard posture (warn-only).
 * @param {function} [deps.scanImpl=scanForPii] - injectable for tests.
 * @returns {express.Router}
 */
function createSecurityRoutes(deps = {}) {
  const router = express.Router();
  const ledger = deps.ledger || null;
  const deploymentProfile = deps.deploymentProfile || null;
  const scanImpl = deps.scanImpl || scanForPii;

  // Body parser. 1MB limit so a runaway upload can't OOM the
  // orchestrator; matches MAX_CONTENT_BYTES so the validator has a
  // single source of truth.
  router.use(express.json({ limit: "1mb" }));

  router.post("/security/scan", (req, res) => {
    const body = req.body || {};

    // ── 1. Validate body ────────────────────────────────────
    if (typeof body.content !== "string") {
      return res.status(400).json({
        error: "content_required",
        message: "Body must include `content` as a string.",
      });
    }
    if (body.content.length > MAX_CONTENT_BYTES) {
      return res.status(413).json({
        error: "content_too_large",
        message: `content exceeds ${MAX_CONTENT_BYTES}-byte limit (got ${body.content.length})`,
        limitBytes: MAX_CONTENT_BYTES,
      });
    }

    const depth = ALLOWED_DEPTHS.has(body.depth) ? body.depth : DEFAULT_SCAN_DEPTH;
    const filename = typeof body.filename === "string" && body.filename.length > 0
      ? body.filename
      : null;
    const source = typeof body.source === "string" && body.source.length > 0
      ? body.source
      : DEFAULT_SOURCE;

    // ── 2. Run the scan ─────────────────────────────────────
    let scan;
    try {
      scan = scanImpl(body.content, { depth });
    } catch (err) {
      return res.status(500).json({
        error: "scan_failed",
        message: err && err.message ? err.message : "scanner threw",
      });
    }

    // ── 3. Posture decision ────────────────────────────────
    // Mirror GOV-PII-0 piiGate logic: ANY signal blocks.
    const requirePiiScan = !!(deploymentProfile
      && deploymentProfile.requirePiiScanBeforeProviderDispatch === true);
    const failClosed = !!(deploymentProfile
      && deploymentProfile.scannerFailurePolicy === "block");
    const shouldBlock = requirePiiScan || failClosed;

    let auditVerb = null;
    let blocked = false;
    let reason = null;
    if (scan.hasPii) {
      if (shouldBlock) {
        auditVerb = AUDIT_VERBS.BLOCKED;
        blocked = true;
        reason = REASON_PII_DETECTED;
      } else {
        auditVerb = AUDIT_VERBS.WARN;
      }
    }

    // ── 4. Build audit data (already-redacted samples per scanner) ─
    const samples = {};
    for (const f of scan.findings) samples[f.type] = f.samples;
    const auditData = {
      source,
      filename,
      sizeBytes: body.content.length,
      depth,
      findingCount: scan.findings.length,
      findingTypes: scan.findings.map((f) => f.type),
      samples,
    };

    // ── 5. Emit audit row (best-effort; never break the response) ─
    if (ledger && auditVerb) {
      try {
        ledger.append("system", { type: auditVerb, data: auditData });
      } catch (_) { /* keep response intact */ }
    }

    // ── 6. Respond ──────────────────────────────────────────
    res.json({
      ok: !blocked,
      blocked,
      scan: {
        hasPii: scan.hasPii,
        findings: scan.findings,
        elapsedMs: scan.elapsedMs,
      },
      reason,
      auditVerb,
      // Echo audit data only when an audit row fired — clean scans
      // get a slim response.
      auditData: auditVerb ? auditData : null,
      filename,
      sizeBytes: body.content.length,
      depth,
    });
  });

  return router;
}

module.exports = {
  createSecurityRoutes,
  AUDIT_VERBS,
  REASON_PII_DETECTED,
  DEFAULT_SCAN_DEPTH,
  ALLOWED_DEPTHS,
  MAX_CONTENT_BYTES,
  DEFAULT_SOURCE,
};
