// Slice R3-e-c (Phase D R3, 2026-04-29) — approval HTTP API.
//
// Three endpoints exposed under `/api/approvals/*`:
//
//   GET /api/approvals/pending
//     No body. Returns { approvals: [...] } — every pending request
//     the manager currently holds. Defensive copies; the caller can
//     mutate freely without affecting manager state.
//
//   POST /api/approvals/:id/grant
//     Body: { deciderId?: string, reason?: string }
//     Calls approvalManager.grant(id, ...). Returns:
//       200 { ok: true, approvalId, resolution: "granted", decidedAt, deciderId }
//       404 { ok: false, error: "unknown_or_resolved" }   — id never registered
//                                                            or already resolved
//
//   POST /api/approvals/:id/deny
//     Body: { deciderId?: string, reason?: string }
//     Calls approvalManager.deny(id, ...). Returns same shape as
//     grant, with resolution: "denied".
//
// The audit chain entries (runner_hook_approval_granted/denied) are
// emitted by the manager itself via its constructor-injected auditFn,
// NOT by these routes. Wiring at server boot links the two so the
// audit emission is guaranteed even if a future contributor adds a
// new route surface that bypasses these endpoints.
//
// Why a dedicated route module:
//
//   - Setup / profile / security routes already follow this shape;
//     consistency wins over fewer files.
//   - The frontend approval card / panel needs a stable URL surface;
//     embedding the same logic into hookRoutes would conflate two
//     unrelated lifecycles.
//   - Test integration is per-file: dropping into approvalRoutes
//     gives the integration test a tight surface to drive.
//
// Threat model:
//
//   - The auth middleware (loopback only + x-orchestrator-token) is mounted
//     globally; an external caller cannot reach these routes. The
//     route still defends against malformed bodies (deciderId/reason
//     type checks) so a future relaxation of auth doesn't slip
//     unsanitized strings into the audit chain.
//   - approvalId comes from the URL path; a forged id is a no-op
//     because the manager only resolves IDs it generated. The route
//     returns 404 for unknown ids — the audit chain stays clean
//     (no spurious approval_granted / approval_denied verbs).

"use strict";

const express = require("express");

// Bound the deciderId / reason free-text fields so a 1MB string can't
// land in the audit chain. The card UI already truncates; this is
// the server-side backstop.
const DECIDER_ID_MAX_LENGTH = 128;
const REASON_MAX_LENGTH = 512;
const DEFAULT_DECIDER_ID = "operator";

/**
 * Build the approval router.
 *
 * @param {object} deps
 * @param {object} deps.approvalManager  — required. R3-e-b instance.
 * @returns {express.Router}
 */
function createApprovalRoutes(deps = {}) {
  const router = express.Router();
  const manager = deps.approvalManager;

  // The manager is the only mandatory dependency. If it's missing
  // every endpoint returns 503 — defensive degraded mode rather
  // than a confusing 500 inside the handler.
  router.use(express.json({ limit: "32kb" }));
  router.use((_req, _res, next) => {
    if (!manager) {
      const err = new Error("approval_manager_unavailable");
      err.status = 503;
      return next(err);
    }
    next();
  });

  // ── GET /pending ────────────────────────────────────────────────

  router.get("/approvals/pending", (req, res) => {
    // The manager already returns defensive copies; we just unwrap
    // into a `{ approvals: [...] }` envelope so a future addition
    // (e.g., counts, server time) is non-breaking.
    res.json({
      approvals: manager.list(),
      serverTime: Date.now(),
    });
  });

  // ── POST /:id/grant ─────────────────────────────────────────────

  router.post("/approvals/:id/grant", (req, res) => {
    const id = String(req.params.id || "");
    if (id.length === 0) {
      return res.status(400).json({
        ok: false, error: "id_required",
        message: "approvalId required in URL path",
      });
    }
    const opts = _parseDecisionBody(req.body);
    if (opts.error) {
      return res.status(400).json({ ok: false, ...opts.error });
    }

    const wasPending = manager.grant(id, opts.value);
    if (!wasPending) {
      return res.status(404).json({
        ok: false, error: "unknown_or_resolved",
        message: "approvalId not pending (unknown id, already resolved, or cancelled)",
      });
    }
    res.json({
      ok: true,
      approvalId: id,
      resolution: "granted",
      decidedAt: Date.now(),
      deciderId: opts.value.deciderId,
    });
  });

  // ── POST /:id/deny ──────────────────────────────────────────────

  router.post("/approvals/:id/deny", (req, res) => {
    const id = String(req.params.id || "");
    if (id.length === 0) {
      return res.status(400).json({
        ok: false, error: "id_required",
        message: "approvalId required in URL path",
      });
    }
    const opts = _parseDecisionBody(req.body);
    if (opts.error) {
      return res.status(400).json({ ok: false, ...opts.error });
    }

    const wasPending = manager.deny(id, opts.value);
    if (!wasPending) {
      return res.status(404).json({
        ok: false, error: "unknown_or_resolved",
        message: "approvalId not pending (unknown id, already resolved, or cancelled)",
      });
    }
    res.json({
      ok: true,
      approvalId: id,
      resolution: "denied",
      decidedAt: Date.now(),
      deciderId: opts.value.deciderId,
      reason: opts.value.reason,
    });
  });

  return router;
}

// ── Body parser helper ──────────────────────────────────────────────

/**
 * Parse + validate a grant/deny body. Both endpoints share the shape:
 *   { deciderId?: string, reason?: string }
 *
 * Empty / missing → defaults (deciderId="operator", reason=null).
 * Non-string or oversize values → 400.
 *
 * Returns either {value: {deciderId, reason}} on success or
 * {error: {error, message}} on validation failure.
 */
function _parseDecisionBody(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};

  let deciderId = DEFAULT_DECIDER_ID;
  if (b.deciderId !== undefined && b.deciderId !== null) {
    if (typeof b.deciderId !== "string") {
      return { error: { error: "deciderId_invalid", message: "deciderId must be a string" } };
    }
    if (b.deciderId.length > DECIDER_ID_MAX_LENGTH) {
      return { error: { error: "deciderId_too_long", message: `deciderId exceeds ${DECIDER_ID_MAX_LENGTH} chars` } };
    }
    if (b.deciderId.length > 0) deciderId = b.deciderId;
  }

  let reason = null;
  if (b.reason !== undefined && b.reason !== null) {
    if (typeof b.reason !== "string") {
      return { error: { error: "reason_invalid", message: "reason must be a string" } };
    }
    if (b.reason.length > REASON_MAX_LENGTH) {
      return { error: { error: "reason_too_long", message: `reason exceeds ${REASON_MAX_LENGTH} chars` } };
    }
    if (b.reason.length > 0) reason = b.reason;
  }

  return { value: { deciderId, reason } };
}

module.exports = {
  createApprovalRoutes,
  DECIDER_ID_MAX_LENGTH,
  REASON_MAX_LENGTH,
  DEFAULT_DECIDER_ID,
  _parseDecisionBody,
};
