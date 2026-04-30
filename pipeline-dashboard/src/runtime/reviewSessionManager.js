// Slice UI-H4 (Phase D / Phase E1.5, 2026-04-30) — review session manager.
//
// In-memory state machine that tracks Claude ↔ Codex ↔ Claude review
// sessions per UI Plan §UX-H4. The defining flow:
//
//   1. Operator creates a session (POST /api/review-sessions)
//   2. Operator sends Claude's plan to Codex for critique
//      (POST /:id/send-codex) → Codex stream chunks broadcast
//   3. Operator can follow up with their own questions
//      (POST /:id/follow-up, target=codex|claude)
//   4. Operator hands the verified plan back to Claude
//      (POST /:id/hand-back-claude) → Claude stream chunks broadcast
//   5. Bash/Edit/Write tools in Claude's hand-back response trigger
//      the existing R3-e + GOV-APPROVAL-0 approval card flow
//
// Distinct from approvalManager (R3-e-b) by lifecycle:
//   - approvalManager: short-lived (ms-seconds) write-tool gate
//   - reviewSessionManager: long-lived (minutes-hours) operator
//     workflow. Sessions are explicitly archived; no TTL timer.
//
// Mirrors the approvalManager constructor-injection pattern:
//   auditFn / broadcastFn / clockFn / idFn — all testable.
//
// Threat model: sessions are operator-driven. Every state-changing
// route is token-gated via the existing auth middleware. Public-
// sector posture additionally refuses local-Bash follow-ups (handled
// in routes layer, not here — this manager stays pure).
//
// Out of scope for this slice:
//   - Actual Codex / Claude spawning. The manager records the
//     intent + emits WS events; UI-H4-followup wires the executor
//     calls. For now sendCodex / handBackClaude are "dispatch hooks"
//     that callers (routes / future executor integration) consume.
//   - Persistence. Sessions live in process memory. A future
//     GOV-AUDIT-0 slice will persist via evidenceLedger.

"use strict";

const crypto = require("crypto");

// Session state machine states. Frozen vocabulary so a future
// contributor adding a new state forces an explicit code change.
const STATES = Object.freeze({
  CREATED:           "created",            // initial; no actions yet
  AWAITING_CRITIQUE: "awaiting_critique",  // sent to Codex; waiting
  CRITIQUE_RECEIVED: "critique_received",  // Codex returned; operator reviewing
  AWAITING_CLAUDE:   "awaiting_claude",    // handed back to Claude; waiting
  CLAUDE_RECEIVED:   "claude_received",    // Claude responded; operator can iterate
  ARCHIVED:          "archived",           // session closed
});

// Audit verbs the manager emits via auditFn. Distinct prefix
// (`review_session_*`) so a forensic auditor's grep is bounded.
const AUDIT_VERBS = Object.freeze([
  "review_session_created",
  "review_session_send_codex",
  "review_session_follow_up",
  "review_session_hand_back_claude",
  "review_session_archived",
  "review_session_critique_received",
  "review_session_claude_received",
]);

// WS broadcast types for the dashboard. Same prefix family as the
// audit verbs so the UI can filter by type-family.
const BROADCAST_TYPES = Object.freeze([
  "review_session_created",
  "claude_stream_chunk",
  "codex_stream_chunk",
  "critique_received",
  "handoff_to_claude_requested",
  "handoff_to_claude_completed",
  "review_session_archived",
]);

// Body limits for the human-supplied free-text fields. Bounded so
// the audit chain doesn't grow unboundedly per request.
const MAX_INSTRUCTION_LENGTH = 8192;
const MAX_SUMMARY_LENGTH     = 1024;

class ReviewSessionManager {
  /**
   * @param {object} opts
   * @param {function} [opts.auditFn] — emits audit verbs
   * @param {function} [opts.broadcastFn] — emits WS broadcasts
   * @param {function} [opts.clockFn] — testable wall-clock
   * @param {function} [opts.idFn] — sessionId generator (default UUID)
   */
  constructor(opts = {}) {
    this._auditFn = typeof opts.auditFn === "function" ? opts.auditFn : () => {};
    this._broadcastFn = typeof opts.broadcastFn === "function" ? opts.broadcastFn : () => {};
    this._clockFn = typeof opts.clockFn === "function" ? opts.clockFn : () => Date.now();
    this._idFn = typeof opts.idFn === "function" ? opts.idFn : () => crypto.randomUUID();

    // sessions: Map<sessionId, Session>
    this._sessions = new Map();
  }

  /**
   * Create a new review session.
   * @param {object} req
   * @param {string} [req.initialPlan] — optional Claude plan text the
   *   operator imports as the session seed.
   * @param {"selected_run"|"manual"} [req.source="manual"]
   * @param {string} [req.runId] — link to an active pipeline run if any.
   * @param {string} [req.label] — operator-supplied session label.
   * @returns {object} session snapshot
   */
  create(req = {}) {
    const sessionId = this._idFn();
    const now = this._clockFn();

    const initialPlan = typeof req.initialPlan === "string"
      ? req.initialPlan.slice(0, MAX_INSTRUCTION_LENGTH) : null;
    const source = req.source === "selected_run" ? "selected_run" : "manual";
    const runId = typeof req.runId === "string" && req.runId.length > 0
      ? req.runId : null;
    const label = typeof req.label === "string" && req.label.length > 0
      ? req.label.slice(0, MAX_SUMMARY_LENGTH) : null;

    const session = {
      sessionId,
      state: STATES.CREATED,
      source,
      runId,
      label,
      initialPlan,
      history: [],     // [{at, kind, by, text}]
      lastChunkSeq: 0, // monotonic chunk counter for ordering
      createdAt: now,
      lastActivityAt: now,
      archivedAt: null,
      archiveReason: null,
    };
    this._sessions.set(sessionId, session);

    this._safeAudit("review_session_created", {
      sessionId, source, runId, label, createdAt: now,
    });
    this._safeBroadcast("review_session_created", {
      sessionId, source, runId, label, createdAt: now,
    });

    return this._snapshot(session);
  }

  /**
   * Operator sends Claude's plan to Codex for critique.
   *
   * @param {string} sessionId
   * @param {object} req
   * @param {string} req.instruction — what the operator wants Codex
   *   to focus on (security review / efficiency / correctness / ...).
   * @param {string[]} [req.contextEvents] — optional ids of events
   *   from snapshot.events the operator wants Codex to consider.
   * @returns {object|null} session snapshot or null if not found / not creatable
   * @throws Error if input invalid
   */
  sendCodex(sessionId, req) {
    const session = this._mustGet(sessionId);
    this._mustState(session, [STATES.CREATED, STATES.CRITIQUE_RECEIVED, STATES.CLAUDE_RECEIVED]);

    const instruction = this._validateInstruction(req && req.instruction);
    const contextEvents = Array.isArray(req && req.contextEvents)
      ? req.contextEvents.slice(0, 50).filter((e) => typeof e === "string")
      : [];

    const now = this._clockFn();
    session.state = STATES.AWAITING_CRITIQUE;
    session.lastActivityAt = now;
    session.history.push({
      at: now, kind: "send_codex", by: "operator",
      text: instruction.slice(0, MAX_SUMMARY_LENGTH),
      contextEvents,
    });

    this._safeAudit("review_session_send_codex", {
      sessionId, contextEventCount: contextEvents.length, dispatchedAt: now,
    });
    // Broadcast for the UI's review-relay panel to update state.
    // Actual Codex spawn happens via executor integration (UI-H4
    // follow-up); this manager only records the operator's intent.
    this._safeBroadcast("review_session_created", {
      sessionId, state: session.state, dispatchedAt: now,
    });

    return this._snapshot(session);
  }

  /**
   * Operator follows up with a free-form question.
   * @param {string} sessionId
   * @param {object} req
   * @param {string} req.question
   * @param {"codex"|"claude"} req.target
   */
  followUp(sessionId, req) {
    const session = this._mustGet(sessionId);
    if (session.state === STATES.CREATED || session.state === STATES.ARCHIVED) {
      const err = new Error(`review_session_invalid_state: cannot follow up from ${session.state}`);
      err.code = "REVIEW_SESSION_INVALID_STATE";
      throw err;
    }
    const question = this._validateInstruction(req && req.question);
    const target = req && (req.target === "claude" ? "claude" : "codex");

    const now = this._clockFn();
    session.lastActivityAt = now;
    session.history.push({
      at: now, kind: "follow_up", by: "operator",
      target, text: question.slice(0, MAX_SUMMARY_LENGTH),
    });
    this._safeAudit("review_session_follow_up", {
      sessionId, target, dispatchedAt: now,
    });
    return this._snapshot(session);
  }

  /**
   * Operator hands the (verified) plan back to Claude. May trigger
   * approval-card entries when Claude's response includes write-tools.
   * @param {string} sessionId
   * @param {object} req
   * @param {string} req.instruction
   * @param {boolean} [req.includeCritique=true]
   */
  handBackClaude(sessionId, req) {
    const session = this._mustGet(sessionId);
    this._mustState(session, [STATES.CRITIQUE_RECEIVED, STATES.AWAITING_CRITIQUE]);

    const instruction = this._validateInstruction(req && req.instruction);
    const includeCritique = !(req && req.includeCritique === false);

    const now = this._clockFn();
    session.state = STATES.AWAITING_CLAUDE;
    session.lastActivityAt = now;
    session.history.push({
      at: now, kind: "hand_back_claude", by: "operator",
      text: instruction.slice(0, MAX_SUMMARY_LENGTH),
      includeCritique,
    });
    this._safeAudit("review_session_hand_back_claude", {
      sessionId, includeCritique, dispatchedAt: now,
    });
    this._safeBroadcast("handoff_to_claude_requested", {
      sessionId, includeCritique, dispatchedAt: now,
    });
    return this._snapshot(session);
  }

  /**
   * Caller-driven: a critique stream chunk arrived from Codex.
   * @param {string} sessionId
   * @param {object} chunk
   * @param {string} chunk.text
   */
  recordCodexChunk(sessionId, chunk) {
    const session = this._mustGet(sessionId);
    if (session.state === STATES.ARCHIVED) return null;
    const text = chunk && typeof chunk.text === "string" ? chunk.text : "";
    if (text.length === 0) return null;

    const now = this._clockFn();
    session.lastChunkSeq += 1;
    session.lastActivityAt = now;
    this._safeBroadcast("codex_stream_chunk", {
      sessionId, chunk: text.slice(0, MAX_INSTRUCTION_LENGTH),
      seq: session.lastChunkSeq, ts: now,
    });
    return this._snapshot(session);
  }

  /**
   * Caller-driven: Codex critique completed. Operator can now hand
   * back to Claude OR follow up further.
   * @param {string} sessionId
   * @param {object} summary
   * @param {string} [summary.summary]
   * @param {object} [summary.severityCounts]   {critical, high, medium, low, note}
   */
  recordCritiqueReceived(sessionId, summary) {
    const session = this._mustGet(sessionId);
    if (session.state === STATES.ARCHIVED) return null;
    const now = this._clockFn();
    session.state = STATES.CRITIQUE_RECEIVED;
    session.lastActivityAt = now;
    const sum = summary && typeof summary === "object" ? summary : {};
    const summaryText = typeof sum.summary === "string"
      ? sum.summary.slice(0, MAX_SUMMARY_LENGTH) : null;
    const severityCounts = sum.severityCounts && typeof sum.severityCounts === "object"
      ? { ...sum.severityCounts } : null;

    session.history.push({
      at: now, kind: "critique_received", by: "codex",
      summary: summaryText, severityCounts,
    });
    this._safeAudit("review_session_critique_received", {
      sessionId, severityCounts, receivedAt: now,
    });
    this._safeBroadcast("critique_received", {
      sessionId, summary: summaryText, severityCounts, receivedAt: now,
    });
    return this._snapshot(session);
  }

  /**
   * Caller-driven: Claude stream chunk arrived.
   */
  recordClaudeChunk(sessionId, chunk) {
    const session = this._mustGet(sessionId);
    if (session.state === STATES.ARCHIVED) return null;
    const text = chunk && typeof chunk.text === "string" ? chunk.text : "";
    if (text.length === 0) return null;

    const now = this._clockFn();
    session.lastChunkSeq += 1;
    session.lastActivityAt = now;
    this._safeBroadcast("claude_stream_chunk", {
      sessionId, chunk: text.slice(0, MAX_INSTRUCTION_LENGTH),
      seq: session.lastChunkSeq, ts: now,
    });
    return this._snapshot(session);
  }

  /**
   * Caller-driven: Claude finished responding to the hand-back.
   */
  recordClaudeReceived(sessionId, summary) {
    const session = this._mustGet(sessionId);
    if (session.state === STATES.ARCHIVED) return null;
    const now = this._clockFn();
    session.state = STATES.CLAUDE_RECEIVED;
    session.lastActivityAt = now;
    const sum = summary && typeof summary === "object" ? summary : {};
    const summaryText = typeof sum.summary === "string"
      ? sum.summary.slice(0, MAX_SUMMARY_LENGTH) : null;

    session.history.push({
      at: now, kind: "claude_received", by: "claude",
      summary: summaryText,
    });
    this._safeAudit("review_session_claude_received", {
      sessionId, completedAt: now,
    });
    this._safeBroadcast("handoff_to_claude_completed", {
      sessionId, summary: summaryText, completedAt: now,
    });
    return this._snapshot(session);
  }

  /**
   * Operator (or auto-cleanup) archives a session.
   * @param {string} sessionId
   * @param {object} [opts]
   * @param {string} [opts.reason]
   */
  archive(sessionId, opts = {}) {
    const session = this._sessions.get(sessionId);
    if (!session || session.state === STATES.ARCHIVED) return null;
    const now = this._clockFn();
    session.state = STATES.ARCHIVED;
    session.archivedAt = now;
    session.archiveReason = opts.reason ? String(opts.reason).slice(0, MAX_SUMMARY_LENGTH) : null;
    session.lastActivityAt = now;

    this._safeAudit("review_session_archived", {
      sessionId, reason: session.archiveReason, archivedAt: now,
    });
    this._safeBroadcast("review_session_archived", {
      sessionId, reason: session.archiveReason, archivedAt: now,
    });
    return this._snapshot(session);
  }

  /** @returns {object|null} */
  get(sessionId) {
    const session = this._sessions.get(sessionId);
    return session ? this._snapshot(session) : null;
  }

  /** @returns {object[]} sorted by lastActivityAt desc */
  list() {
    const out = [];
    for (const s of this._sessions.values()) out.push(this._snapshot(s));
    out.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    return out;
  }

  size() { return this._sessions.size; }

  // ── Internal ──────────────────────────────────────────────────

  _mustGet(sessionId) {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      const err = new Error("review_session_invalid_id: sessionId required");
      err.code = "REVIEW_SESSION_INVALID_ID";
      throw err;
    }
    const session = this._sessions.get(sessionId);
    if (!session) {
      const err = new Error(`review_session_not_found: ${sessionId}`);
      err.code = "REVIEW_SESSION_NOT_FOUND";
      throw err;
    }
    return session;
  }

  _mustState(session, allowed) {
    if (!allowed.includes(session.state)) {
      const err = new Error(
        `review_session_invalid_state: ${session.state} not in [${allowed.join(",")}]`,
      );
      err.code = "REVIEW_SESSION_INVALID_STATE";
      throw err;
    }
  }

  _validateInstruction(value) {
    if (typeof value !== "string" || value.length === 0) {
      const err = new Error("review_session_invalid_input: instruction/question required");
      err.code = "REVIEW_SESSION_INVALID_INPUT";
      throw err;
    }
    if (value.length > MAX_INSTRUCTION_LENGTH) {
      const err = new Error(`review_session_invalid_input: exceeds ${MAX_INSTRUCTION_LENGTH} chars`);
      err.code = "REVIEW_SESSION_INPUT_TOO_LONG";
      throw err;
    }
    return value;
  }

  _snapshot(session) {
    // Defensive copy. History entries are shallow-copied; nested
    // arrays (contextEvents) deep-copied via slice.
    return {
      sessionId: session.sessionId,
      state: session.state,
      source: session.source,
      runId: session.runId,
      label: session.label,
      initialPlan: session.initialPlan,
      history: session.history.map((h) => ({
        ...h,
        contextEvents: Array.isArray(h.contextEvents) ? [...h.contextEvents] : undefined,
        severityCounts: h.severityCounts ? { ...h.severityCounts } : undefined,
      })),
      lastChunkSeq: session.lastChunkSeq,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      archivedAt: session.archivedAt,
      archiveReason: session.archiveReason,
    };
  }

  _safeAudit(verb, data) {
    try { this._auditFn(verb, data); } catch (_) { /* never break */ }
  }

  _safeBroadcast(type, data) {
    try { this._broadcastFn(type, data); } catch (_) { /* never break */ }
  }
}

module.exports = {
  ReviewSessionManager,
  STATES,
  AUDIT_VERBS,
  BROADCAST_TYPES,
  MAX_INSTRUCTION_LENGTH,
  MAX_SUMMARY_LENGTH,
};
