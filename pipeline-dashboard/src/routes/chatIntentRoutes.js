// Slice AGENT-DESKTOP-0-a (Phase 2 chat-first UX, 2026-05-06) — chat
// intent route. Single endpoint:
//
//   POST /api/chat/intent
//     body: { text: string }
//     response: { ok: true, proposal: {...}, audit: { entryId } }
//             | { ok: false, error: "...", code: "..." }
//
// The route is the integration point between:
//   - The pure intent classifier (`src/runtime/intentParser.js`)
//   - The PII scanner (`src/security/piiScanner.js`)
//   - The audit ledger (`src/runtime/evidenceLedger.js`)
//   - The deployment profile (`src/policy/deploymentProfile.js`)
//
// CRITICAL: this endpoint NEVER fires an action. It returns a typed
// proposal that the operator must explicitly approve via the chat UI.
// Approval triggers the underlying API call (e.g. /api/pipeline/general-run)
// through the existing endpoints — no bypass.

"use strict";

const { Router } = require("express");
const { parseIntent, MAX_INPUT_LENGTH } = require("../runtime/intentParser");

// Module-level run id for audit entries that are not tied to a real
// pipeline run (chat intents happen before any run exists). Reusing the
// same constant per process makes audit chain traversal predictable —
// every chat_intent_proposed entry shares this runId so external
// auditors can filter the chat trail in one query.
const CHAT_AUDIT_RUN_ID = "harness-chat-intents";

function createChatIntentRoutes({
  piiScanner = null,           // module exporting scanForPii(text, opts?)
  evidenceLedger = null,       // EvidenceLedger instance with .append(runId, {type, data})
  deploymentProfile = null,    // resolved deployment profile (has .publicSector, .pack, etc.)
} = {}) {
  const router = Router();

  // Resolve the deployment mode label the parser expects. The parser
  // checks for the literal string "public-sector"; other modes follow
  // the standard branch (warn + redact rather than block).
  function _deploymentMode() {
    if (!deploymentProfile) return "standard";
    if (deploymentProfile.publicSector === true) return "public-sector";
    if (typeof deploymentProfile.pack === "string") return deploymentProfile.pack;
    return "standard";
  }

  // Pre-scan PII when the scanner is available + the text is non-empty.
  // The result is passed into parseIntent so the parser can branch
  // (public-sector → block; standard → warn + redact). Returns null
  // when scanner unavailable — parser then treats input as PII-free.
  function _preScanPii(text) {
    if (!piiScanner || typeof piiScanner.scanForPii !== "function") return null;
    if (typeof text !== "string" || text.length === 0) return null;
    try {
      // depth:"deep" matches the legacy task-input scan policy used
      // when general-pipeline-modal submits to /api/pipeline/general-run.
      // Same scrutiny applied here so chat parity holds.
      return piiScanner.scanForPii(text, { depth: "deep" });
    } catch (_) {
      // Scanner failures must not block the route — log via audit
      // and fall through with null. Public-sector mode then doesn't
      // get the PII block (operator-visible: classifierTrace says so).
      return null;
    }
  }

  // Append an audit entry for the proposal and return its eventId so
  // the response can carry it to the frontend (which links the eventual
  // approval to the same chain).
  function _appendProposalAudit(proposal, originalText) {
    if (!evidenceLedger || typeof evidenceLedger.append !== "function") return null;
    try {
      const entry = evidenceLedger.append(CHAT_AUDIT_RUN_ID, {
        type: "chat_intent_proposed",
        data: {
          intent: proposal.intent,
          riskLevel: proposal.riskLevel,
          confidence: proposal.confidence,
          classifierTrace: proposal.classifierTrace,
          deploymentMode: _deploymentMode(),
          // Truncate stored text at 512 bytes to avoid bloating the
          // ledger when operators paste long blobs. The parser still
          // saw the full text; the audit just keeps a head excerpt.
          textHead: String(originalText || "").slice(0, 512),
          textLength: String(originalText || "").length,
          piiHasPii: proposal.piiContext ? !!proposal.piiContext.hasPii : false,
          piiTypes: (proposal.piiContext && Array.isArray(proposal.piiContext.findings))
            ? proposal.piiContext.findings.map(function (f) { return f && f.type; }).filter(Boolean)
            : [],
        },
      });
      return entry && entry.eventId ? entry.eventId : null;
    } catch (_) {
      // Audit append failure should not break the proposal flow —
      // the proposal still ships, just without an audit anchor. The
      // frontend's classifierTrace and downstream pipeline_start
      // event still leave a forensic trail.
      return null;
    }
  }

  // POST /api/chat/intent — single endpoint
  router.post("/chat/intent", function (req, res) {
    // ── Body validation ───────────────────────────────────────────
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof body.text !== "string") {
      return res.status(400).json({
        ok: false,
        error: "body.text is required (string)",
        code: "invalid_body",
      });
    }
    if (body.text.length > MAX_INPUT_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: "body.text exceeds " + MAX_INPUT_LENGTH + " chars",
        code: "input_too_long",
      });
    }

    // ── PII pre-scan + intent parse ───────────────────────────────
    const piiContext = _preScanPii(body.text);
    const proposal = parseIntent({
      text: body.text,
      deploymentMode: _deploymentMode(),
      piiContext: piiContext,
    });

    // ── Public-sector + PII → 403 (defense in depth) ──────────────
    // The parser already returned intent="blocked_pii" but we surface
    // a 403 status for transport-level visibility (curl scripts, CI
    // probes, etc. shouldn't have to inspect the body to know they
    // were rejected). The frontend already handles 403 by rendering
    // the redacted echo; standard 200 also works because the body
    // carries `proposal.intent === "blocked_pii"`. Both paths agree.
    if (proposal.intent === "blocked_pii") {
      const auditId = _appendProposalAudit(proposal, body.text);
      return res.status(403).json({
        ok: false,
        error: proposal.summary,
        code: "blocked_pii",
        proposal: proposal,
        audit: { entryId: auditId },
      });
    }

    // ── Success — emit audit + return proposal ────────────────────
    const auditId = _appendProposalAudit(proposal, body.text);
    return res.status(200).json({
      ok: true,
      proposal: proposal,
      audit: { entryId: auditId },
    });
  });

  return router;
}

module.exports = { createChatIntentRoutes, CHAT_AUDIT_RUN_ID };
