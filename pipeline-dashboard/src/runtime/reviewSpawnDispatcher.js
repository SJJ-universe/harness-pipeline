// Slice UI-H7-f (Phase D / Phase E1.5, 2026-04-30) — review-session
// server-side spawn dispatcher.
//
// Closes the deferral chain UI-H7-c left open. UI-H7-c shipped the
// action row + 5-endpoint API + (UI-H7-d) runner reviewSessionId
// hint. What was MISSING: the moment the operator clicks "Send to
// Codex" → POST /api/review-sessions/:id/send-codex, the manager's
// state machine flipped to AWAITING_CRITIQUE but no runner was
// actually spawned. This module is that bridge.
//
// Flow (Codex critique):
//
//   POST /:id/send-codex
//     └→ manager.sendCodex(sessionId, {instruction})
//          (state: CREATED|CRITIQUE_RECEIVED|CLAUDE_RECEIVED → AWAITING_CRITIQUE)
//     └→ dispatcher.dispatchCodex(sessionId, {instruction})
//          ├ enforce: not already in-flight for this sessionId
//          ├ track:   _inFlight.set(sessionId, {actionType, runner})
//          ├ audit:   review_session_dispatch_started
//          └ kick:    codexRunner.exec(prompt, {reviewSessionId})
//                       └→ stdout chunks → manager.recordCodexChunk
//                       └→ close (success) → manager.recordCritiqueReceived
//                       └→ close (any) → dispatcher clears in-flight
//                                       + audit dispatch_completed/failed
//
// Flow (Claude hand-back):
//
//   POST /:id/hand-back-claude
//     └→ manager.handBackClaude(sessionId, {instruction})
//          (state: CRITIQUE_RECEIVED|AWAITING_CRITIQUE → AWAITING_CLAUDE)
//     └→ dispatcher.dispatchClaude(sessionId, {instruction, includeCritique})
//          ├ defense-in-depth: refuse if publicSector + !allowLocalExecutor
//          ├ same in-flight + audit pattern as Codex
//          └ kick: claudeRunner.exec(prompt, {reviewSessionId})
//                    └→ stdout chunks → manager.recordClaudeChunk
//                    └→ close (success) → manager.recordClaudeReceived
//
// Why "fire and forget" not "await":
//   The HTTP route can't keep the connection open for minutes while
//   Codex critiques. The route returns 200 immediately after manager
//   state machine update + dispatcher kick-off. The operator follows
//   live progress via WS broadcasts (codex_stream_chunk / critique_
//   received / claude_stream_chunk / handoff_to_claude_completed).
//   Dispatcher is a coordinator that lives entirely server-side.
//
// Why a separate module:
//   - Routes stay thin (one ~10-line dispatch hook each)
//   - In-flight Map + audit emission live in one testable seam
//   - Future R3-e per-call approval can wedge between dispatcher and
//     runner without touching routes
//   - Public-sector defense-in-depth is one chokepoint, not two
//
// Audit verbs (distinct prefix family `review_session_dispatch_*` so
// a forensic auditor's grep is bounded — these never collide with
// the manager's `review_session_*` lifecycle verbs or the
// `runner_hook_*` family):
//   - review_session_dispatch_started   (kick-off)
//   - review_session_dispatch_completed (runner.exec returned ok)
//   - review_session_dispatch_failed    (runner returned !ok OR threw)
//   - review_session_dispatch_blocked   (in-flight collision OR posture)

"use strict";

const presetLibrary = require("./presetLibrary");

const ACTION_TYPES = Object.freeze({
  SEND_CODEX:       "send-codex",
  HAND_BACK_CLAUDE: "hand-back-claude",
  FOLLOW_UP_CODEX:  "follow-up-codex",
});

const DISPATCH_AUDIT_VERBS = Object.freeze([
  "review_session_dispatch_started",
  "review_session_dispatch_completed",
  "review_session_dispatch_failed",
  "review_session_dispatch_blocked",
]);

// Dispatch error codes — the route layer maps these to HTTP status.
const DISPATCH_ERROR_CODES = Object.freeze({
  DISPATCH_ALREADY_IN_FLIGHT:        "dispatch_already_in_flight",        // 409
  DISPATCH_SESSION_NOT_FOUND:        "dispatch_session_not_found",        // 404
  DISPATCH_SESSION_INVALID_STATE:    "dispatch_session_invalid_state",    // 409
  DISPATCH_LOCAL_EXECUTOR_DISABLED:  "dispatch_local_executor_disabled",  // 409
  DISPATCH_RUNNER_UNAVAILABLE:       "dispatch_runner_unavailable",       // 503
  DISPATCH_INVALID_INPUT:            "dispatch_invalid_input",            // 400
});

// Bounded prompt sizes — the manager already caps instruction at
// 8 KB; we add a defensive ceiling here so a future caller bypassing
// the manager doesn't spawn with an unbounded prompt.
const MAX_PROMPT_LENGTH = 64 * 1024;
const MAX_CRITIQUE_CONTEXT_LENGTH = 16 * 1024;

class ReviewSpawnDispatcher {
  /**
   * @param {object} opts
   * @param {object} opts.reviewSessionManager — manager with .get / .recordX
   * @param {object} [opts.codexRunner]        — codex-runner with .exec
   * @param {object} [opts.claudeRunner]       — claude-runner with .exec
   * @param {function} [opts.auditFn]          — emits dispatch verbs
   * @param {function} [opts.broadcastFn]      — optional WS broadcast
   * @param {function} [opts.clockFn]          — testable wall-clock
   * @param {object} [opts.deploymentProfile]  — public-sector posture source
   */
  constructor(opts = {}) {
    if (!opts.reviewSessionManager
        || typeof opts.reviewSessionManager.get !== "function") {
      throw new Error(
        "ReviewSpawnDispatcher: reviewSessionManager with .get() is required",
      );
    }
    this._manager = opts.reviewSessionManager;
    this._codexRunner = opts.codexRunner || null;
    this._claudeRunner = opts.claudeRunner || null;
    this._auditFn = typeof opts.auditFn === "function" ? opts.auditFn : () => {};
    this._broadcastFn = typeof opts.broadcastFn === "function"
      ? opts.broadcastFn : () => {};
    this._clockFn = typeof opts.clockFn === "function"
      ? opts.clockFn : () => Date.now();
    this._deploymentProfile = opts.deploymentProfile || null;

    // Map<sessionId, { actionType, startedAt, runner }>.
    this._inFlight = new Map();
  }

  /**
   * Spawn a Codex critique for an active session. The manager has
   * already transitioned the session to AWAITING_CRITIQUE before
   * this is called.
   *
   * @param {string} sessionId
   * @param {object} req
   * @param {string} req.instruction — operator's critique focus
   * @param {string} [req.presetId] — Slice S3-b: optional preset key
   *   from `presetLibrary.PRESET_IDS`. When provided, the preset's
   *   codexSystemPrompt + severityTagInstruction wrap the operator
   *   instruction. Unknown presetId throws DISPATCH_INVALID_INPUT
   *   (defense-in-depth — the routes layer is the primary validator).
   * @returns {Promise<object>} { ok, sessionId, actionType, startedAt, presetId }
   *   on synchronous failure: throws Error with .code in DISPATCH_ERROR_CODES
   */
  async dispatchCodex(sessionId, req = {}) {
    return this._dispatchInternal({
      sessionId,
      actionType: ACTION_TYPES.SEND_CODEX,
      runner: this._codexRunner,
      runnerLabel: "codex",
      presetId: req.presetId || null,
      buildPrompt: () => this._buildCodexPrompt(
        req.instruction, sessionId, req.presetId || null,
      ),
      requireLocalExecutor: false,
    });
  }

  /**
   * Spawn a Claude hand-back. Refused under public-sector posture
   * with !allowLocalExecutor. The manager has already transitioned
   * the session to AWAITING_CLAUDE before this is called.
   *
   * @param {string} [req.presetId] — Slice S3-b: optional preset key.
   *   When provided, the preset's claudeSystemPrompt frames the
   *   hand-back instruction.
   */
  async dispatchClaude(sessionId, req = {}) {
    return this._dispatchInternal({
      sessionId,
      actionType: ACTION_TYPES.HAND_BACK_CLAUDE,
      runner: this._claudeRunner,
      runnerLabel: "claude",
      presetId: req.presetId || null,
      buildPrompt: () => this._buildClaudePrompt(
        req.instruction,
        sessionId,
        req.includeCritique !== false,
        req.presetId || null,
      ),
      requireLocalExecutor: true,
    });
  }

  /**
   * Operator follow-up to Codex (read-only critique addendum).
   * Same posture rules as dispatchCodex (always allowed).
   *
   * @param {string} [req.presetId] — Slice S3-b: same as dispatchCodex.
   */
  async dispatchFollowUpCodex(sessionId, req = {}) {
    return this._dispatchInternal({
      sessionId,
      actionType: ACTION_TYPES.FOLLOW_UP_CODEX,
      runner: this._codexRunner,
      runnerLabel: "codex",
      presetId: req.presetId || null,
      buildPrompt: () => this._buildCodexFollowUpPrompt(
        req.question, sessionId, req.presetId || null,
      ),
      requireLocalExecutor: false,
    });
  }

  /**
   * @returns {object|null} active dispatch metadata or null
   */
  getInFlight(sessionId) {
    if (typeof sessionId !== "string" || !sessionId) return null;
    const entry = this._inFlight.get(sessionId);
    if (!entry) return null;
    return {
      sessionId,
      actionType: entry.actionType,
      startedAt: entry.startedAt,
      runner: entry.runner,
    };
  }

  isInFlight(sessionId) {
    return typeof sessionId === "string" && this._inFlight.has(sessionId);
  }

  /**
   * @returns {object[]} array of in-flight entries (sorted by startedAt asc)
   */
  snapshot() {
    const out = [];
    for (const [sessionId, entry] of this._inFlight.entries()) {
      out.push({
        sessionId,
        actionType: entry.actionType,
        startedAt: entry.startedAt,
        runner: entry.runner,
      });
    }
    return out.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
  }

  size() { return this._inFlight.size; }

  // ── Internal ──────────────────────────────────────────────────

  async _dispatchInternal({
    sessionId, actionType, runner, runnerLabel, buildPrompt,
    requireLocalExecutor, presetId = null,
  }) {
    // 1. sessionId shape
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
        "sessionId required",
      );
    }
    // 1b. (Slice S3-b) defense-in-depth presetId validation. Routes
    //     layer is the primary validator (better error message). If a
    //     non-string or unknown presetId reaches the dispatcher, throw
    //     INVALID_INPUT so the operator sees a 400 rather than a silent
    //     fallback to free-form prompt — silent fallback would hide a
    //     bug in a custom caller (e.g., future scripted dispatcher).
    const resolvedPresetId = presetId === null || presetId === undefined
      ? null
      : (typeof presetId === "string" && presetLibrary.isValidPresetId(presetId)
          ? presetId
          : "__invalid__");
    if (resolvedPresetId === "__invalid__") {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
        `unknown presetId: ${presetId}`,
      );
    }
    // 2. session existence
    const session = this._manager.get(sessionId);
    if (!session) {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_SESSION_NOT_FOUND,
        `session ${sessionId} not found`,
      );
    }
    // 3. archived sessions never dispatch
    if (session.state === "archived") {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_SESSION_INVALID_STATE,
        `session ${sessionId} is archived`,
      );
    }
    // 4. defense-in-depth posture for Claude hand-back
    if (requireLocalExecutor && this._isLocalExecutorBlocked()) {
      this._safeAudit("review_session_dispatch_blocked", {
        sessionId, actionType, reason: "local_executor_disabled",
        presetId: resolvedPresetId,
        at: this._clockFn(),
      });
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_LOCAL_EXECUTOR_DISABLED,
        "Public-sector posture forbids local Claude hand-back. " +
        "Use the sandbox runner channel.",
      );
    }
    // 5. runner availability
    if (!runner || typeof runner.exec !== "function") {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_RUNNER_UNAVAILABLE,
        `${runnerLabel} runner is not wired into the dispatcher`,
      );
    }
    // 6. in-flight collision
    if (this._inFlight.has(sessionId)) {
      const existing = this._inFlight.get(sessionId);
      this._safeAudit("review_session_dispatch_blocked", {
        sessionId, actionType, reason: "already_in_flight",
        presetId: resolvedPresetId,
        existingActionType: existing.actionType,
        existingStartedAt: existing.startedAt,
        at: this._clockFn(),
      });
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_ALREADY_IN_FLIGHT,
        `session ${sessionId} already has an in-flight ${existing.actionType}`,
      );
    }
    // 7. prompt build
    let prompt;
    try {
      prompt = buildPrompt();
    } catch (err) {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
        `prompt build failed: ${err && err.message ? err.message : err}`,
      );
    }
    if (typeof prompt !== "string" || prompt.length === 0) {
      throw _dispatchError(
        DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
        "build returned empty prompt",
      );
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
      // Defensive truncation. Manager already caps instruction at 8KB,
      // but a future builder concatenating critique context could
      // overflow. Truncating preserves the dispatch instead of failing
      // it loud — operator still gets useful Codex/Claude output.
      prompt = prompt.slice(0, MAX_PROMPT_LENGTH);
    }

    // 8. record in-flight + audit + kick off
    const startedAt = this._clockFn();
    this._inFlight.set(sessionId, {
      actionType, startedAt, runner: runnerLabel,
      presetId: resolvedPresetId,
    });
    this._safeAudit("review_session_dispatch_started", {
      sessionId, actionType, runner: runnerLabel, startedAt,
      presetId: resolvedPresetId,
    });

    // Fire-and-forget; the runner is responsible for piping chunks
    // back via the manager's record* methods. We attach .then/.catch
    // to clear the in-flight Map + emit completion audit.
    const execPromise = (async () => {
      try {
        return await runner.exec(prompt, { reviewSessionId: sessionId });
      } catch (err) {
        return { ok: false, error: (err && err.message) || String(err) };
      }
    })();

    execPromise.then((result) => {
      this._inFlight.delete(sessionId);
      const completedAt = this._clockFn();
      const elapsedMs = completedAt - startedAt;
      if (result && result.ok === true) {
        this._safeAudit("review_session_dispatch_completed", {
          sessionId, actionType, runner: runnerLabel,
          presetId: resolvedPresetId,
          completedAt, elapsedMs,
        });
      } else {
        const reason = (result && (result.error
          || (result.exitCode != null ? `exit_${result.exitCode}` : "unknown")))
          || "exec_failed";
        this._safeAudit("review_session_dispatch_failed", {
          sessionId, actionType, runner: runnerLabel,
          presetId: resolvedPresetId,
          reason: String(reason).slice(0, 1024),
          completedAt, elapsedMs,
        });
      }
    });
    // Defense — even with the above try/await, attach a final catch
    // so a Promise rejection (rare but possible in test envs that
    // throw synchronously inside the runner adapter) never lands as
    // an unhandled rejection.
    execPromise.catch(() => {
      if (this._inFlight.has(sessionId)) {
        this._inFlight.delete(sessionId);
      }
    });

    return {
      ok: true, sessionId, actionType, runner: runnerLabel, startedAt,
      presetId: resolvedPresetId,
    };
  }

  _isLocalExecutorBlocked() {
    return !!(
      this._deploymentProfile
      && this._deploymentProfile.publicSector === true
      && this._deploymentProfile.allowLocalExecutor === false
    );
  }

  _safeAudit(verb, data) {
    try { this._auditFn(verb, data); } catch (_) { /* never break */ }
  }

  // ── Prompt builders ──────────────────────────────────────────
  //
  // Slice S3-b (2026-05-04): when presetId is provided, the preset's
  // system prompt is prepended as a `[Preset: …]` header block, and
  // the preset's severityTagInstruction REPLACES the default tagging
  // line. The operator's free-form instruction sits between these
  // two — preset frames the lens, instruction provides the focus,
  // severity instruction guides the tagging.
  //
  // Layout:
  //   [Preset: <Label>]
  //   <preset.codexSystemPrompt>
  //   ──────────────
  //   <session label / runId line>
  //   Focus: <operator instruction>
  //   <plan snippet if any>
  //
  //   <preset.severityTagInstruction OR default severity boilerplate>
  //
  // When presetId is null, the original (pre-S3-b) prompt shape is
  // preserved exactly — backwards compat for tests + legacy callers.

  _buildCodexPrompt(instruction, sessionId, presetId) {
    if (typeof instruction !== "string" || instruction.length === 0) {
      throw new Error("instruction required");
    }
    const session = this._manager.get(sessionId);
    const planSnippet = session && typeof session.initialPlan === "string"
      ? session.initialPlan.slice(0, MAX_CRITIQUE_CONTEXT_LENGTH) : "";
    const labelLine = session && session.label
      ? `Session: ${session.label} (${sessionId})\n`
      : `Session: ${sessionId}\n`;
    const planLine = planSnippet
      ? `\nClaude plan to review:\n${planSnippet}\n`
      : "";

    const preset = presetId ? presetLibrary.getPreset(presetId) : null;
    const presetHeader = preset
      ? `[Preset: ${preset.defaultLabel}]\n${preset.codexSystemPrompt}\n──────────────\n`
      : "";
    const severityLine = preset
      ? `\n${preset.severityTagInstruction}`
      : ("\nProvide a structured critique. Use severity tags " +
         "[critical] / [high] / [medium] / [low] for each finding so " +
         "the harness can attribute counts back to the review session.");

    return `${presetHeader}${labelLine}\nFocus: ${instruction}\n${planLine}${severityLine}`;
  }

  _buildClaudePrompt(instruction, sessionId, includeCritique, presetId) {
    if (typeof instruction !== "string" || instruction.length === 0) {
      throw new Error("instruction required");
    }
    const session = this._manager.get(sessionId);
    const labelLine = session && session.label
      ? `Session: ${session.label} (${sessionId})\n`
      : `Session: ${sessionId}\n`;

    // Pull the last critique summary from session history if any.
    let critiqueLine = "";
    if (includeCritique && session && Array.isArray(session.history)) {
      // Walk history backwards for the most recent critique_received.
      for (let i = session.history.length - 1; i >= 0; i--) {
        const entry = session.history[i];
        if (entry && entry.kind === "critique_received") {
          const summary = entry.summary || "(no summary recorded)";
          critiqueLine = `\nCodex critique summary:\n${summary}\n`;
          break;
        }
      }
    }

    const preset = presetId ? presetLibrary.getPreset(presetId) : null;
    const presetHeader = preset
      ? `[Preset: ${preset.defaultLabel}]\n${preset.claudeSystemPrompt}\n──────────────\n`
      : "";

    return `${presetHeader}${labelLine}\nApply the following operator instruction: ${instruction}\n${critiqueLine}`;
  }

  _buildCodexFollowUpPrompt(question, sessionId, presetId) {
    if (typeof question !== "string" || question.length === 0) {
      throw new Error("question required");
    }
    const session = this._manager.get(sessionId);
    const labelLine = session && session.label
      ? `Session: ${session.label} (${sessionId})\n`
      : `Session: ${sessionId}\n`;

    // Follow-ups reuse the codex preset (same lens as the initial
    // critique). Operator's preset choice persists across the session.
    const preset = presetId ? presetLibrary.getPreset(presetId) : null;
    const presetHeader = preset
      ? `[Preset: ${preset.defaultLabel}]\n${preset.codexSystemPrompt}\n──────────────\n`
      : "";
    const severityLine = preset
      ? `\n${preset.severityTagInstruction}`
      : "\nRespond with additional critique or clarification. Same severity " +
        "tags as the initial critique apply.";

    return `${presetHeader}${labelLine}\nOperator follow-up question: ${question}\n${severityLine}`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function _dispatchError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

module.exports = {
  ReviewSpawnDispatcher,
  ACTION_TYPES,
  DISPATCH_AUDIT_VERBS,
  DISPATCH_ERROR_CODES,
  MAX_PROMPT_LENGTH,
  MAX_CRITIQUE_CONTEXT_LENGTH,
};
