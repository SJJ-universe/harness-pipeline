// Slice GOV-PII-0 (Phase E1.5, 2026-04-29) — provider-dispatch PII gate.
//
// Wraps the piiScanner with deployment-posture-aware enforcement:
//
//   public-sector mode:
//     hasPii  → blocked=true, ok=false. Caller (claude-runner /
//               codex-runner) emits a `pii_scan_blocked` audit row
//               and refuses the spawn.
//     no PII  → ok=true. No audit.
//
//   standard mode (or scannerFailurePolicy="warn"):
//     hasPii  → ok=true (do not block), but the verdict carries a
//               `pii_scan_warn` audit verb so the operator can see
//               that the orchestrator considered PII present in the
//               prompt and chose not to block. This is the
//               "observability without blocking" path for non-
//               agency deployments.
//     no PII  → ok=true. No audit.
//
// Why a separate module from piiScanner:
//   The scanner is a pure detector — same answer every call, no
//   posture awareness. The gate adds the policy decision + the
//   audit shape so the runner just consumes the verdict and emits
//   the row. Two modules let unit tests cover the detector against
//   pathological inputs without mocking deploymentProfile, and
//   cover the gate's posture switch without re-testing every regex.
//
// Why the gate emits NEITHER the audit row NOR the spawn refusal:
//   The gate is a function. It returns a verdict object that
//   describes what should happen. The runner has the ledger handle
//   AND the resolve callback, so it owns the side-effects. This is
//   the same pattern as dangerGate.evaluate() in the existing
//   policy/dangerGate.js — pure decision returner.
//
// Audit data shape (the runner spreads {runner, ...auditData} when
// emitting):
//
//   {
//     source: "claude_prompt" | "codex_prompt" | "<custom>",
//     findingCount: integer (number of PII types detected),
//     findingTypes: string[] (the type names — krn / phone_kr / ...),
//     samples: { [type]: redacted_excerpts[] }
//   }
//
// The `samples` entries are ALREADY redacted by the scanner (first
// 2 + last 2 chars + asterisks). They are SAFE to land in the audit
// chain, but D1-f sanitizer is a defense-in-depth backstop if a
// future caller passes raw values by accident.

"use strict";

const { scanForPii } = require("./piiScanner");

// Stable audit verbs. The runner consults these by name when
// emitting; tests + dashboards lock the wire-format vocabulary.
const AUDIT_VERBS = Object.freeze({
  BLOCKED: "pii_scan_blocked",
  WARN: "pii_scan_warn",
});

// Stable failure reason. Carried on the verdict so the runner can
// surface a deterministic string to the caller.
const REASON_PII_DETECTED = "pii_detected";

/**
 * Decide whether to refuse a provider-dispatch path because the
 * caller's prompt (or other free-text payload) contains PII.
 *
 * @param {string} text - prompt or text to scan
 * @param {object} opts
 * @param {object} opts.deploymentProfile - resolveDeploymentProfile() result.
 *   We consult `requirePiiScanBeforeProviderDispatch` (true → block)
 *   AND `scannerFailurePolicy` ("block" → block, anything else → warn).
 * @param {string} [opts.source="prompt"] - free-form label that
 *   travels with the audit row so an operator triaging a deny can
 *   see WHERE the gate fired ("claude_prompt", "codex_prompt", etc.)
 * @param {object} [opts.scanOpts] - forwarded to scanForPii (custom
 *   pattern subset / sample cap). Defaults to all patterns.
 *
 * @returns {{
 *   ok: boolean,                 // false → caller must refuse the spawn
 *   blocked: boolean,            // true ⇔ ok=false ⇔ public-sector hit
 *   scan: object,                // raw scanForPii result (for logging / tests)
 *   reason: string|null,         // REASON_PII_DETECTED when blocked
 *   auditVerb: string|null,      // AUDIT_VERBS.* when an audit row should fire
 *   auditData: object|null,      // data for the audit row (already redacted)
 * }}
 */
function enforcePiiGate(text, opts = {}) {
  const deploymentProfile = opts.deploymentProfile || null;
  const source = typeof opts.source === "string" && opts.source.length > 0
    ? opts.source
    : "prompt";
  const scanOpts = opts.scanOpts || {};

  const scan = scanForPii(text, scanOpts);

  if (!scan.hasPii) {
    return {
      ok: true,
      blocked: false,
      scan,
      reason: null,
      auditVerb: null,
      auditData: null,
    };
  }

  // Build the audit data once — both block and warn paths emit the
  // same shape so the auditor evidence path can read either uniformly.
  const samples = {};
  for (const f of scan.findings) {
    samples[f.type] = f.samples; // already redacted
  }
  const auditData = {
    source,
    findingCount: scan.findings.length,
    findingTypes: scan.findings.map((f) => f.type),
    samples,
  };

  // Block decision:
  //   - public-sector posture has both flags true (block)
  //   - standard posture has both flags false / warn (no block)
  //   - a hand-injected mix that flips just one flag → ANY signal
  //     to block wins (fail-closed)
  const shouldBlock =
    !!(deploymentProfile && deploymentProfile.requirePiiScanBeforeProviderDispatch === true)
    || (deploymentProfile && deploymentProfile.scannerFailurePolicy === "block");

  if (shouldBlock) {
    return {
      ok: false,
      blocked: true,
      scan,
      reason: REASON_PII_DETECTED,
      auditVerb: AUDIT_VERBS.BLOCKED,
      auditData,
    };
  }

  // Standard posture / warn-only: caller proceeds, but the audit
  // row tells the operator the scanner saw something so a future
  // posture flip to public-sector knows what would have been blocked.
  return {
    ok: true,
    blocked: false,
    scan,
    reason: null,
    auditVerb: AUDIT_VERBS.WARN,
    auditData,
  };
}

module.exports = {
  enforcePiiGate,
  AUDIT_VERBS,
  REASON_PII_DETECTED,
};
