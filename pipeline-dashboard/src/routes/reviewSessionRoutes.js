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
// Public-sector posture (deploymentProfile.publicSector === true)
// affects this surface: when wired, a future GOV-* slice can refuse
// local-Bash follow-ups (UI-H5). For now the manager stays pure;
// routes layer carries the policy signal.

"use strict";

const express = require("express");

const MAX_BODY_BYTES = 16 * 1024;  // 16 KB JSON body cap (instruction is the largest field)

function createReviewSessionRoutes(deps = {}) {
  const router = express.Router();
  const manager = deps.reviewSessionManager;
  const deploymentProfile = deps.deploymentProfile || null;

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

  router.post("/review-sessions/:id/send-codex", (req, res) => {
    const id = String(req.params.id || "");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    try {
      const session = manager.sendCodex(id, {
        instruction: body.instruction,
        contextEvents: body.contextEvents,
      });
      res.json({ ok: true, session, dispatchedAt: Date.now() });
    } catch (err) {
      _emitError(res, err);
    }
  });

  // ── POST /:id/follow-up ──────────────────────────────────────

  router.post("/review-sessions/:id/follow-up", (req, res) => {
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

    try {
      const session = manager.followUp(id, {
        question: body.question,
        target: body.target,
      });
      res.json({ ok: true, session });
    } catch (err) {
      _emitError(res, err);
    }
  });

  // ── POST /:id/hand-back-claude ──────────────────────────────

  router.post("/review-sessions/:id/hand-back-claude", (req, res) => {
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

    try {
      const session = manager.handBackClaude(id, {
        instruction: body.instruction,
        includeCritique: body.includeCritique !== false,
      });
      res.json({ ok: true, session, dispatchedAt: Date.now() });
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

module.exports = {
  createReviewSessionRoutes,
  MAX_BODY_BYTES,
};
