// Slice UI-H4 (Phase D / Phase E1.5, 2026-04-30) — review session HTTP API.
//
// Five endpoints under /api/review-sessions/* per UI Plan §UX-H4:
//
//   POST /api/review-sessions
//     Body: { initialPlan?, source?, runId?, label? }
//     Resp: 200 { session }
//
//   POST /api/review-sessions/:id/send-codex
//     Body: { instruction: string, contextEvents?: string[] }
//     Resp: 200 { session, dispatchedAt }
//
//   POST /api/review-sessions/:id/follow-up
//     Body: { question: string, target: "codex"|"claude" }
//     Resp: 200 { session }
//     Public-sector posture: refuses target=local-bash if a future
//     contributor adds it; today only codex/claude allowed.
//
//   POST /api/review-sessions/:id/hand-back-claude
//     Body: { instruction: string, includeCritique?: boolean }
//     Resp: 200 { session, dispatchedAt }
//
//   GET /api/review-sessions/:id
//     Resp: 200 { session } | 404
//
//   GET /api/review-sessions
//     Resp: 200 { sessions: [...] }
//
//   Slice UI-H7-c (2026-04-30):
//   POST /api/review-sessions/:id/archive
//     Body: { reason?: string }
//     Resp: 200 { ok, session } | 404
//
// Public-sector posture (deploymentProfile.publicSector === true)
// affects this surface: when wired, a future GOV-* slice can refuse
// local-Bash follow-ups (UI-H5). For now the manager stays pure;
// routes layer carries the policy signal.
//
// Slice UI-H7-f (Phase D / Phase E1.5, 2026-04-30): the routes now
// hand off to a `reviewSpawnDispatcher` after the manager state-
// machine update succeeds. The dispatcher kicks off the actual
// codex / claude runner spawn with the reviewSessionId hint so
// stdout chunks pipe back to manager.recordCodexChunk /
// recordClaudeChunk. The dispatcher is OPTIONAL — when not wired
// (e.g., legacy callers, future UI-H4-only tests) the routes still
// transition state + return 200 the way they always did. Adding
// the dispatcher closes UI-H4's deferred work.

"use strict";

const express = require("express");

const MAX_BODY_BYTES = 16 * 1024;  // 16 KB JSON body cap (instruction is the largest field)

function createReviewSessionRoutes(deps = {}) {
  const router = express.Router();
  const manager = deps.reviewSessionManager;
  const deploymentProfile = deps.deploymentProfile || null;
  // UI-H7-f: optional spawn dispatcher. When provided, the routes
  // call dispatcher.dispatchCodex / dispatchClaude / dispatchFollowUpCodex
  // immediately after the manager state transition. Errors from the
  // dispatcher (already_in_flight / runner_unavailable / posture)
  // surface to the operator via HTTP status — but state transitions
  // already happened, so the manager + UI know about the attempt.
  const dispatcher = deps.reviewSpawnDispatcher || null;

  router.use(express.json({ limit: "32kb" }));
  router.use((_req, _res, next) => {
    if (!manager) {
      const err = new Error("review_session_manager_unavailable");
      err.status = 503;
      return next(err);
    }
    next();
  });

  // ── GET /api/review-sessions ─────────────────────────────────

  router.get("/review-sessions", (_req, res) => {
    res.json({ sessions: manager.list(), serverTime: Date.now() });
  });

  // ── GET /api/review-sessions/:id ─────────────────────────────

  router.get("/review-sessions/:id", (req, res) => {
    const id = String(req.params.id || "");
    const session = manager.get(id);
    if (!session) {
      return res.status(404).json({ ok: false, error: "session_not_found" });
    }
    res.json({ ok: true, session });
  });

  // ── POST /api/review-sessions ────────────────────────────────

  router.post("/review-sessions", (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const session = manager.create({
        initialPlan: body.initialPlan,
        source: body.source,
        runId: body.runId,
        label: body.label,
      });
      res.status(201).json({ ok: true, session });
    } catch (err) {
      _emitError(res, err);
    }
  });

  // ── POST /:id/send-codex ─────────────────────────────────────

  router.post("/review-sessions/:id/send-codex", async (req, res) => {
    const id = String(req.params.id || "");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    let session;
    // 1. State transition first
    try {
      session = manager.sendCodex(id, {
        instruction: body.instruction,
        contextEvents: body.contextEvents,
      });
    } catch (err) {
      return _emitError(res, err);
    }
    // 2. UI-H7-f: kick off the actual Codex spawn if dispatcher is
    //    wired. Failures here are reported to the operator with
    //    HTTP status, but the manager state transition has already
    //    happened — the UI will see AWAITING_CRITIQUE state and the
    //    failure audit row. Operator can retry by archiving the
    //    session and starting a new one.
    let dispatchAck = null;
    if (dispatcher) {
      try {
        dispatchAck = await dispatcher.dispatchCodex(id, {
          instruction: body.instruction,
        });
      } catch (err) {
        return _emitDispatchError(res, err, { session });
      }
    }
    res.json({
      ok: true, session,
      dispatchedAt: dispatchAck ? dispatchAck.startedAt : Date.now(),
      runner: dispatchAck ? dispatchAck.runner : null,
      dispatched: !!dispatchAck,
    });
  });

  // ── POST /:id/follow-up ──────────────────────────────────────

  router.post("/review-sessions/:id/follow-up", async (req, res) => {
    const id = String(req.params.id || "");
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Public-sector posture: refuse follow-ups targeting "claude" if
    // posture forbids local executor AND deploymentProfile is wired.
    // (Codex critique follow-ups are read-only; safe under public-
    // sector posture.)
    if (
      body.target === "claude"
      && deploymentProfile
      && deploymentProfile.publicSector === true
      && deploymentProfile.allowLocalExecutor === false
    ) {
      return res.status(409).json({
        ok: false,
        error: "public_sector_local_executor_disabled",
        message: "Public-sector posture forbids local-executor follow-ups. " +
                 "Use a sandbox runner or hand back via Codex critique only.",
      });
    }

    let session;
    try {
      session = manager.followUp(id, {
        question: body.question,
        target: body.target,
      });
    } catch (err) {
      return _emitError(res, err);
    }
    // UI-H7-f: kick off Codex follow-up spawn when target=codex AND
    // dispatcher is wired. Claude follow-ups don't spawn here — they
    // go through hand-back-claude. (Public-sector blocks claude
    // already at the route gate above.)
    let dispatchAck = null;
    if (dispatcher && body.target !== "claude") {
      try {
        dispatchAck = await dispatcher.dispatchFollowUpCodex(id, {
          question: body.question,
        });
      } catch (err) {
        return _emitDispatchError(res, err, { session });
      }
    }
    res.json({
      ok: true, session,
      dispatched: !!dispatchAck,
      dispatchedAt: dispatchAck ? dispatchAck.startedAt : null,
    });
  });

  // ── POST /:id/hand-back-claude ──────────────────────────────

  router.post("/review-sessions/:id/hand-back-claude", async (req, res) => {
    const id = String(req.params.id || "");
    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Same posture gate as follow-up: hand-back triggers a Claude
    // spawn that may issue write-tools. Public-sector + no-local-
    // executor → refuse.
    if (
      deploymentProfile
      && deploymentProfile.publicSector === true
      && deploymentProfile.allowLocalExecutor === false
    ) {
      return res.status(409).json({
        ok: false,
        error: "public_sector_local_executor_disabled",
        message: "Public-sector posture forbids handing back to local Claude. " +
                 "Use the sandbox runner channel.",
      });
    }

    let session;
    try {
      session = manager.handBackClaude(id, {
        instruction: body.instruction,
        includeCritique: body.includeCritique !== false,
      });
    } catch (err) {
      return _emitError(res, err);
    }
    // UI-H7-f: kick off Claude spawn after state transition. The
    // dispatcher does its own posture defense-in-depth check + the
    // route gate above provides the primary block. Both must agree.
    let dispatchAck = null;
    if (dispatcher) {
      try {
        dispatchAck = await dispatcher.dispatchClaude(id, {
          instruction: body.instruction,
          includeCritique: body.includeCritique !== false,
        });
      } catch (err) {
        return _emitDispatchError(res, err, { session });
      }
    }
    res.json({
      ok: true, session,
      dispatchedAt: dispatchAck ? dispatchAck.startedAt : Date.now(),
      runner: dispatchAck ? dispatchAck.runner : null,
      dispatched: !!dispatchAck,
    });
  });

  // ── POST /:id/archive (Slice UI-H7-c) ────────────────────────
  //
  // Operator-driven archive. Idempotent: archiving an already-archived
  // session returns 200 with the same snapshot rather than 409. Audit
  // chain still emits review_session_archived once on the first call
  // (manager.archive returns null on the second call, which we treat
  // as "no-op" without re-emitting).
  router.post("/review-sessions/:id/archive", (req, res) => {
    const id = String(req.params.id || "");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const reason = typeof body.reason === "string" && body.reason.length > 0
      ? body.reason.slice(0, 1024) : "operator-archive";
    const existing = manager.get(id);
    if (!existing) {
      return res.status(404).json({ ok: false, error: "session_not_found" });
    }
    if (existing.state === "archived") {
      // Idempotent — no-op on already-archived.
      return res.json({ ok: true, session: existing, alreadyArchived: true });
    }
    try {
      const session = manager.archive(id, { reason });
      if (!session) {
        // Race: between get + archive call, the session vanished.
        return res.status(404).json({ ok: false, error: "session_not_found" });
      }
      res.json({ ok: true, session });
    } catch (err) {
      _emitError(res, err);
    }
  });

  return router;
}

// ── Error mapper ────────────────────────────────────────────────

function _emitError(res, err) {
  const code = err && err.code ? String(err.code) : "review_session_error";
  if (code === "REVIEW_SESSION_NOT_FOUND") {
    return res.status(404).json({ ok: false, error: "session_not_found", message: err.message });
  }
  if (code === "REVIEW_SESSION_INVALID_ID"
      || code === "REVIEW_SESSION_INVALID_INPUT"
      || code === "REVIEW_SESSION_INPUT_TOO_LONG") {
    return res.status(400).json({ ok: false, error: code.toLowerCase(), message: err.message });
  }
  if (code === "REVIEW_SESSION_INVALID_STATE") {
    return res.status(409).json({ ok: false, error: "invalid_state", message: err.message });
  }
  // Unknown — bubble as 500.
  return res.status(500).json({ ok: false, error: "review_session_error", message: err && err.message ? err.message : "unknown" });
}

// UI-H7-f: dispatcher-error mapper. Different shape from manager
// errors (different code prefix `dispatch_*`) so the operator
// dashboard can distinguish "session state machine refused" from
// "spawn dispatcher refused" at decision time. Manager state
// transition is still successful at this point — we include the
// updated session snapshot in the response so the UI doesn't lose
// state visibility.
function _emitDispatchError(res, err, context) {
  const code = err && err.code ? String(err.code) : "dispatch_error";
  const session = context && context.session ? context.session : null;
  const status =
    code === "dispatch_session_not_found"        ? 404 :
    code === "dispatch_invalid_input"            ? 400 :
    code === "dispatch_session_invalid_state"    ? 409 :
    code === "dispatch_already_in_flight"        ? 409 :
    code === "dispatch_local_executor_disabled"  ? 409 :
    code === "dispatch_runner_unavailable"       ? 503 :
                                                    500;
  return res.status(status).json({
    ok: false,
    error: code,
    message: err && err.message ? err.message : "dispatch failure",
    session,  // operator UI keeps state visibility
    stateTransitioned: !!session,
  });
}

module.exports = {
  createReviewSessionRoutes,
  MAX_BODY_BYTES,
};
