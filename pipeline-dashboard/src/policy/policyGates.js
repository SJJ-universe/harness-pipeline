// Slice S2-a (Phase 2 / SMART-2, 2026-05-05) — policy-backed hard gates.
//
// What this module is
// ───────────────────
// A consolidated, frozen-vocabulary layer for PRE-STATE policy
// enforcement at the dispatcher / routes boundary. Each gate is a pure
// function that returns a structured verdict; callers decide what to
// do (throw or warn) based on the verdict's `mode` + `blocked` fields.
//
// The four gates landed in this slice:
//
//   gatePiiBlock           PII-detected before LLM dispatch
//   gateReleaseSigned      Unsigned manifest under public-sector
//   gateEvidenceExportReady Public-sector release-ready w/o evidence export
//   gateCompletionAllowed  Phase complete with humanDecision pending (post-state)
//
// Why a NEW module vs. extending publicSectorPolicy.js
// ────────────────────────────────────────────────────
// publicSectorPolicy.js owns config-time validation +
// SPAWN-TIME assertions (assertLocalExecutorAllowed,
// assertSandboxWorkspaceRequired, etc.). Its API contract is "throw
// on violation, the runner wraps + emits audit". That works because
// the runner is the only consumer.
//
// SMART-2 hard gates fire at a different layer (BEFORE manager state
// transitions / dispatcher kick-off) AND need to support a
// graduated rollout (warn → hard) AND need a single `policy_gate_*`
// audit vocabulary that operators can grep across runs. The contract
// is "return a verdict; caller emits audit + throws or warns based
// on mode". That's a different shape from publicSectorPolicy's
// throw-and-let-the-runner-emit pattern.
//
// Two modules → no API contract bleed; tests + dashboards lock the
// vocabulary at frozen module load.
//
// Gate ordering (per plan §S §S-SMART-2 v2 diagram)
// ─────────────────────────────────────────────────
//   incoming request
//     │
//     ▼
//   ┌─ Pre-state gates (read-only, hard) ────────────────────────┐
//   │  1. gatePiiBlock(args, deploymentProfile)                  │
//   │  2. gateReleaseSigned(deploymentProfile, manifestSigned)   │
//   │  3. gateEvidenceExportReady(decisionContext)               │
//   └────────────────────────────────────────────────────────────┘
//     │
//     │  (any throw → policy_gate_blocked + return 4xx, NO state mutation)
//     │
//     ▼
//   manager.transition(...)  ← state mutation begins
//     │
//     ▼
//   ┌─ Post-state gates (mid-flight, soft) ──────────────────────┐
//   │  4. gateCompletionAllowed(decisionContext, ...)            │
//   └────────────────────────────────────────────────────────────┘
//     │
//     ▼
//   dispatch / spawn / broadcast
//
// Mode: warn (default) vs hard (ORCHESTRATOR_HARD_GATES=1)
// ───────────────────────────────────────────────────
// Plan §S §S-SMART-2 v2 ships in WARN mode by default so existing
// deployments continue to work. Operators opt into hard mode via
// ORCHESTRATOR_HARD_GATES=1 (or "hard"/"true"). In hard mode, gates that
// detect a violation set `blocked=true` + emit `policy_gate_blocked`;
// callers should turn that into a 4xx HTTP response. In warn mode,
// the same violation sets `ok=true` + emits `policy_gate_warn`;
// callers should toast/log + proceed.
//
// State immutability invariant
// ────────────────────────────
// CRITICAL: when a hard gate blocks, the manager state machine /
// approvalManager queue / runRegistry MUST be untouched. The route
// layer MUST call gates BEFORE manager.transition(). If a gate is
// added AFTER state transition, that's a bug — the test suite has
// state-immutability anchors that fail when half-progressed sessions
// stick around after a hard block.
//
// Audit single-emit invariant
// ───────────────────────────
// CRITICAL: when a hard gate blocks, the route MUST NOT cascade into
// dispatcher.dispatchX (which would emit `review_session_dispatch_failed`
// / `runner_hook_dispatch_error` etc.). The hard gate's own
// `policy_gate_blocked` is the SOLE audit-chain entry for the cycle.
// Tests assert this.

"use strict";

const { resolveDeploymentProfile } = require("./deploymentProfile");
const { scanForPii } = require("../security/piiScanner");

// ── Frozen vocabulary ─────────────────────────────────────────────

const SCHEMA = "orchestrator-policy-gate/v1";

const GATE_MODES = Object.freeze({
  HARD: "hard",
  WARN: "warn",
});

const GATE_NAMES = Object.freeze({
  PII_BLOCK:               "pii_block",
  RELEASE_SIGNED:          "release_signed",
  EVIDENCE_EXPORT_READY:   "evidence_export_ready",
  COMPLETION_ALLOWED:      "completion_allowed",
});

// Frozen reason codes — these end up in audit-chain entries.
// Operators grep these. Adding a new reason is an explicit code change.
const GATE_REASONS = Object.freeze({
  PII_DETECTED:           "pii_detected",
  PII_SCANNER_FAILED:     "pii_scanner_failed",
  RELEASE_UNSIGNED:       "release_unsigned",
  EVIDENCE_NOT_READY:     "evidence_not_ready",
  COMPLETION_PENDING:     "completion_pending",
  // Used when the input is malformed enough that we can't safely
  // apply the gate; treat as "not applicable" (ok=true, no audit).
  NOT_APPLICABLE:         "not_applicable",
});

// Audit verbs — frozen pair (blocked vs warn). Operators grep
// `policy_gate_*` to see all gate activity.
const AUDIT_VERBS = Object.freeze({
  BLOCKED: "policy_gate_blocked",
  WARN:    "policy_gate_warn",
});

// ── Mode resolution ──────────────────────────────────────────────

/**
 * Resolve the gate operating mode from environment + (optionally)
 * deployment profile.
 *
 * Precedence (high → low):
 *   1. env ORCHESTRATOR_HARD_GATES is "1" / "true" / "hard"  → HARD
 *   2. env ORCHESTRATOR_HARD_GATES is "0" / "false" / "warn" / "no" → WARN
 *      (explicit operator override — beats pack default)
 *   3. deploymentProfile.hardGatesDefault === true → HARD
 *      (pack-level default — POL-a wiring per plan §S §S-SMART-5
 *      "Per-pack default ORCHESTRATOR_HARD_GATES override env" deferred)
 *   4. WARN (safe rollout default; existing deployments untouched
 *      unless they pick a pack with hardGatesDefault=true)
 *
 * Backwards compat:
 *   - resolveGateMode(env) — legacy 1-arg call returns same value as
 *     pre-POL-a when env is set explicitly OR when env is unset AND
 *     no deploymentProfile is passed (deploymentProfile is null →
 *     step 3 skipped → falls to step 4 = WARN, identical to legacy)
 *   - All pre-POL-a tests pass unchanged
 *
 * Why explicit env can OVERRIDE pack default to WARN:
 *   An operator running finance-high-privacy (hardGatesDefault=true)
 *   may need to temporarily soften gates during incident triage or
 *   migration. Setting ORCHESTRATOR_HARD_GATES=0 / =warn lets them do
 *   that without changing the pack id (which would also flip
 *   sandbox / signing / etc. requirements). Plan §S §S-SMART-5
 *   anticipates this with the documented escape pattern.
 *
 * @param {object} [env=process.env]
 * @param {object} [deploymentProfile] - resolveDeploymentProfile() result
 * @returns {"hard"|"warn"}
 */
function resolveGateMode(env, deploymentProfile) {
  const e = env || (typeof process !== "undefined" ? process.env : {});
  const raw = String(e.ORCHESTRATOR_HARD_GATES || "").trim().toLowerCase();
  // Step 1: explicit hard
  if (raw === "1" || raw === "true" || raw === "hard") return GATE_MODES.HARD;
  // Step 2: explicit warn (operator override of pack default)
  if (raw === "0" || raw === "false" || raw === "warn" || raw === "no") {
    return GATE_MODES.WARN;
  }
  // Step 3: pack default (POL-a wiring)
  if (deploymentProfile && deploymentProfile.hardGatesDefault === true) {
    return GATE_MODES.HARD;
  }
  // Step 4: safe default
  return GATE_MODES.WARN;
}

// ── Internal helpers ──────────────────────────────────────────────

function _verdict({
  gate, ok, blocked, mode, reason, message, auditData,
}) {
  // Verdicts are frozen — callers can read but not mutate. Audit
  // data is intentionally not frozen so callers can append a runId
  // / sessionId before emit without copying.
  const audit = (reason !== GATE_REASONS.NOT_APPLICABLE && reason !== null)
    ? {
        verb: blocked ? AUDIT_VERBS.BLOCKED : AUDIT_VERBS.WARN,
        data: auditData || {},
      }
    : null;
  return Object.freeze({
    ok: !!ok,
    blocked: !!blocked,
    mode,
    gate,
    reason: reason || null,
    message: message || "",
    audit,
  });
}

function _stringifyArgs(args) {
  if (args === null || args === undefined) return "";
  if (typeof args === "string") return args;
  if (typeof args === "number" || typeof args === "boolean") return String(args);
  try {
    return JSON.stringify(args);
  } catch (_) {
    // Circular / unserializable — fall back to empty + downstream
    // gate returns "scanner failed" so callers know it's not a clean
    // pass.
    return null;
  }
}

// ── Gate 1: PII block ─────────────────────────────────────────────

/**
 * Refuse dispatch when the operator's args/prompt contain PII under
 * public-sector posture. Standard posture emits a warn audit so
 * the operator-dashboard can render a toast but otherwise proceeds.
 *
 * The detection layer (piiScanner) is shared with GOV-PII-0's
 * runner-side enforcement; SMART-2 adds a SECOND chokepoint at the
 * dispatcher pre-state, BEFORE manager.transition. Two-layer
 * defense: route gate catches PII before any state mutation; runner
 * gate catches the leak even if a future bug skips the route gate.
 *
 * @param {object} opts
 * @param {string|object} opts.args - text or arbitrary object to scan
 * @param {object} [opts.deploymentProfile] - resolveDeploymentProfile() result
 * @param {string} [opts.mode] - "hard"|"warn" (default resolveGateMode())
 * @param {string} [opts.source="dispatch_args"]
 * @param {function} [opts.scanFn=scanForPii] - testable injection seam
 * @returns {object} verdict
 */
function gatePiiBlock(opts = {}) {
  const dp = opts.deploymentProfile || resolveDeploymentProfile({});
  // Slice POL-a (POLICY-UX-0): resolveGateMode now consults
  // deploymentProfile.hardGatesDefault when env is unset. Pre-POL-a
  // 1-arg callers (no deploymentProfile) keep legacy behavior.
  const mode = opts.mode || resolveGateMode(undefined, dp);
  const source = opts.source || "dispatch_args";
  const scanFn = typeof opts.scanFn === "function" ? opts.scanFn : scanForPii;

  const text = _stringifyArgs(opts.args);
  if (text === null) {
    // Unserializable input — caller probably passed a circular
    // structure. Don't block (we can't prove PII), but emit a warn
    // so operators see the bypass.
    return _verdict({
      gate: GATE_NAMES.PII_BLOCK,
      ok: true,
      blocked: false,
      mode,
      reason: GATE_REASONS.PII_SCANNER_FAILED,
      message: "PII scanner could not serialize input (circular?). Proceeding without scan.",
      auditData: { gate: GATE_NAMES.PII_BLOCK, source, error: "unserializable" },
    });
  }
  if (text === "") {
    // Empty arg — no PII possible.
    return _verdict({
      gate: GATE_NAMES.PII_BLOCK,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  let scan;
  try {
    scan = scanFn(text);
  } catch (err) {
    // Scanner failure: in hard mode we MUST fail closed (operator
    // wanted strict gates; an unscannable prompt is a strict gate
    // miss). In warn mode we allow + warn.
    const blocked = mode === GATE_MODES.HARD && dp.publicSector === true;
    return _verdict({
      gate: GATE_NAMES.PII_BLOCK,
      ok: !blocked, blocked, mode,
      reason: GATE_REASONS.PII_SCANNER_FAILED,
      message: `PII scanner threw: ${err && err.message ? err.message : err}`,
      auditData: {
        gate: GATE_NAMES.PII_BLOCK, source,
        error: String(err && err.message ? err.message : err).slice(0, 256),
      },
    });
  }

  if (!scan || scan.hasPii !== true) {
    return _verdict({
      gate: GATE_NAMES.PII_BLOCK,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  // PII detected.
  const findingTypes = Array.isArray(scan.findings)
    ? scan.findings.map((f) => f && f.type).filter(Boolean) : [];
  const findingCount = Array.isArray(scan.findings)
    ? scan.findings.reduce((acc, f) => acc + (f && f.count ? f.count : 0), 0)
    : 0;

  // Decision matrix:
  //   public-sector + hard → blocked (refuse dispatch)
  //   public-sector + warn → ok=true, warn audit (operator toast,
  //                          GOV-PII-0 runner gate is the safety net)
  //   standard      + *    → ok=true, warn audit (observability only)
  const blocked = mode === GATE_MODES.HARD && dp.publicSector === true;
  return _verdict({
    gate: GATE_NAMES.PII_BLOCK,
    ok: !blocked,
    blocked,
    mode,
    reason: GATE_REASONS.PII_DETECTED,
    message: blocked
      ? `Public-sector posture + hard gate refuses dispatch: PII detected (${findingTypes.join(", ")}).`
      : `PII detected (${findingTypes.join(", ")}). Operator should review before dispatch.`,
    auditData: {
      gate: GATE_NAMES.PII_BLOCK,
      source,
      publicSector: dp.publicSector === true,
      findingCount,
      findingTypes,
      // Samples are already redacted by the scanner (first 2 + last 2
      // + asterisks). They're safe to land in the audit chain so a
      // forensic auditor can verify the gate fired on real data.
      samples: Array.isArray(scan.findings)
        ? scan.findings.reduce((acc, f) => {
            if (f && f.type && Array.isArray(f.samples) && f.samples.length > 0) {
              acc[f.type] = f.samples.slice(0, 3);
            }
            return acc;
          }, {})
        : {},
    },
  });
}

// ── Gate 2: Release signed ────────────────────────────────────────

/**
 * Refuse install/launch under public-sector posture when the manifest
 * isn't signed. Complements E3-F1 launcher-level signature gate by
 * reasserting the same invariant at runtime — if a runner ever
 * uploads/loads an unsigned manifest mid-process, this gate catches it.
 *
 * @param {object} opts
 * @param {object} [opts.deploymentProfile]
 * @param {boolean} [opts.manifestSigned] - caller-provided signal
 * @param {string} [opts.mode]
 * @param {string} [opts.source="manifest_load"]
 */
function gateReleaseSigned(opts = {}) {
  const dp = opts.deploymentProfile || resolveDeploymentProfile({});
  // POL-a: pack-default mode resolution
  const mode = opts.mode || resolveGateMode(undefined, dp);
  const source = opts.source || "manifest_load";

  // Only applicable when posture mandates signed manifests.
  if (dp.requireSignedManifest !== true) {
    return _verdict({
      gate: GATE_NAMES.RELEASE_SIGNED,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  // Signed → pass through.
  if (opts.manifestSigned === true) {
    return _verdict({
      gate: GATE_NAMES.RELEASE_SIGNED,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  const blocked = mode === GATE_MODES.HARD;
  return _verdict({
    gate: GATE_NAMES.RELEASE_SIGNED,
    ok: !blocked,
    blocked,
    mode,
    reason: GATE_REASONS.RELEASE_UNSIGNED,
    message: blocked
      ? "Public-sector posture + hard gate: unsigned manifest refused. " +
        "Sign the manifest with a trust-store key (E3-F1 + TRUST-STORE-0)."
      : "Public-sector posture: unsigned manifest detected. Operator should " +
        "verify sigVer before proceeding (warn-mode advisory).",
    auditData: {
      gate: GATE_NAMES.RELEASE_SIGNED,
      source,
      publicSector: dp.publicSector === true,
      manifestSigned: opts.manifestSigned === true,
    },
  });
}

// ── Gate 3: Evidence export ready ─────────────────────────────────

/**
 * Refuse public-sector "release-ready" when the audit-evidence
 * export pipeline isn't healthy. Built on top of decisionContext
 * (SMART-0) — which derives `auditExportReady` boolean from
 * GOV-AUDIT-0's auditorBundle module.
 *
 * @param {object} opts
 * @param {object} [opts.decisionContext] - SMART-0 snapshot
 * @param {object} [opts.deploymentProfile]
 * @param {string} [opts.mode]
 * @param {string} [opts.source="release_ready"]
 */
function gateEvidenceExportReady(opts = {}) {
  const dp = opts.deploymentProfile || resolveDeploymentProfile({});
  // POL-a: pack-default mode resolution
  const mode = opts.mode || resolveGateMode(undefined, dp);
  const source = opts.source || "release_ready";

  // Standard posture: evidence export isn't gating; ok always.
  if (dp.publicSector !== true) {
    return _verdict({
      gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  const ctx = opts.decisionContext || null;
  // No context → fail closed in hard mode (we can't verify), warn
  // otherwise.
  if (!ctx || !ctx.booleans) {
    const blocked = mode === GATE_MODES.HARD;
    return _verdict({
      gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
      ok: !blocked, blocked, mode,
      reason: GATE_REASONS.EVIDENCE_NOT_READY,
      message: blocked
        ? "Public-sector + hard gate: decision context unavailable; cannot verify evidence-export readiness."
        : "Decision context unavailable; evidence-export readiness unknown.",
      auditData: {
        gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
        source,
        publicSector: true,
        decisionContextAvailable: false,
      },
    });
  }

  if (ctx.booleans.auditExportReady === true) {
    return _verdict({
      gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  const blocked = mode === GATE_MODES.HARD;
  return _verdict({
    gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
    ok: !blocked,
    blocked,
    mode,
    reason: GATE_REASONS.EVIDENCE_NOT_READY,
    message: blocked
      ? "Public-sector + hard gate: audit-evidence export pipeline not ready. " +
        "Run /api/audit/runs/<runId>/export probe + verify offline before release-ready."
      : "Audit-evidence export pipeline not ready (warn-mode advisory).",
    auditData: {
      gate: GATE_NAMES.EVIDENCE_EXPORT_READY,
      source,
      publicSector: true,
      auditExportReady: false,
    },
  });
}

// ── Gate 4: Completion allowed (post-state, soft) ─────────────────

/**
 * Phase-completion gate. Fires AFTER the state transition (post-state
 * soft gate per plan diagram). When the decision context flags a
 * pending human decision (approval queue, codex critique missing,
 * pii hit under public-sector), warn or block "phase complete"
 * depending on mode.
 *
 * Unlike the pre-state gates, this one CAN run after state mutation
 * — its job is to flag premature completion, not prevent it.
 *
 * @param {object} opts
 * @param {object} [opts.decisionContext]
 * @param {object} [opts.deploymentProfile]
 * @param {string} [opts.phase] - phase id (informational)
 * @param {string} [opts.mode]
 * @param {string} [opts.source="phase_complete"]
 */
function gateCompletionAllowed(opts = {}) {
  const dp = opts.deploymentProfile || resolveDeploymentProfile({});
  // POL-a: pack-default mode resolution
  const mode = opts.mode || resolveGateMode(undefined, dp);
  const source = opts.source || "phase_complete";
  const ctx = opts.decisionContext || null;

  if (!ctx || !ctx.booleans) {
    return _verdict({
      gate: GATE_NAMES.COMPLETION_ALLOWED,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  // No pending human decision → completion ok.
  if (ctx.booleans.needsHumanDecision !== true) {
    return _verdict({
      gate: GATE_NAMES.COMPLETION_ALLOWED,
      ok: true, blocked: false, mode,
      reason: GATE_REASONS.NOT_APPLICABLE,
    });
  }

  // Pending human decision exists. Block in hard mode + public-sector
  // (because public-sector can't auto-progress past pending review).
  // Standard mode always warns only.
  const blocked = mode === GATE_MODES.HARD && dp.publicSector === true;
  return _verdict({
    gate: GATE_NAMES.COMPLETION_ALLOWED,
    ok: !blocked,
    blocked,
    mode,
    reason: GATE_REASONS.COMPLETION_PENDING,
    message: blocked
      ? "Public-sector + hard gate: phase completion blocked while " +
        "human decision is pending (approvals, missing critique, or " +
        "public-sector PII hit)."
      : "Phase completing while a human decision is pending. Operator " +
        "should verify (warn-mode advisory).",
    auditData: {
      gate: GATE_NAMES.COMPLETION_ALLOWED,
      source,
      phase: opts.phase || null,
      publicSector: dp.publicSector === true,
      counts: {
        pendingApprovals: ctx.counts && ctx.counts.pendingApprovals,
        openReviewSessions: ctx.counts && ctx.counts.openReviewSessions,
      },
      booleans: {
        approvalPending: ctx.booleans.approvalPending === true,
        codexReviewMissing: ctx.booleans.codexReviewMissing === true,
        hasPii: ctx.booleans.hasPii === true,
      },
    },
  });
}

// ── Caller-side helpers ───────────────────────────────────────────

/**
 * Run a sequence of gates. Returns at the first BLOCKED verdict so
 * the caller can short-circuit; otherwise returns the array of all
 * verdicts (including warn audits) for the caller to emit.
 *
 * @param {Array<{name, evaluate}>} gates
 *   Each entry is `{name, evaluate: () => verdict}`. Caller pre-binds
 *   gate args at the call site so this stays stateless.
 * @returns {{ blocked: boolean, blockedAt: string|null, verdicts: object[] }}
 */
function runGateChain(gates) {
  const verdicts = [];
  for (const g of (gates || [])) {
    if (!g || typeof g.evaluate !== "function") continue;
    let v;
    try {
      v = g.evaluate();
    } catch (err) {
      // Gate threw — treat as scanner failed: hard-block in hard mode.
      v = Object.freeze({
        ok: false,
        blocked: true,
        mode: GATE_MODES.HARD,
        gate: g.name || "unknown",
        reason: GATE_REASONS.PII_SCANNER_FAILED,
        message: `Gate "${g.name}" threw: ${err && err.message ? err.message : err}`,
        audit: {
          verb: AUDIT_VERBS.BLOCKED,
          data: {
            gate: g.name || "unknown",
            error: String(err && err.message ? err.message : err).slice(0, 256),
          },
        },
      });
    }
    verdicts.push(v);
    if (v.blocked) {
      return { blocked: true, blockedAt: v.gate, verdicts };
    }
  }
  return { blocked: false, blockedAt: null, verdicts };
}

module.exports = {
  SCHEMA,
  GATE_MODES,
  GATE_NAMES,
  GATE_REASONS,
  AUDIT_VERBS,
  resolveGateMode,
  gatePiiBlock,
  gateReleaseSigned,
  gateEvidenceExportReady,
  gateCompletionAllowed,
  runGateChain,
};
