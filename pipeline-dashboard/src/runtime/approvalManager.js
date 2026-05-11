// Slice R3-e-b (Phase D R3, 2026-04-29) — per-call approval manager.
//
// `ApprovalManager` is the in-memory state machine that gates write-
// tool dispatches behind operator approval (R3-e). The contract is:
//
//   1. Caller (hook-router._dispatchSanitized) inspects the sanitized
//      payload. If the tool is in WRITE_TOOLS_REQUIRING_APPROVAL, it
//      calls `manager.request({...}) → Promise`.
//   2. Manager registers a pending request (frozen snapshot), starts
//      a TTL timer, emits `runner_hook_approval_requested` on the
//      audit chain, and broadcasts `approval_requested` to dashboard
//      clients.
//   3. The pending promise resolves when one of these fires:
//        - operator hits POST /api/approvals/:id/grant → resolution=granted
//        - operator hits POST /api/approvals/:id/deny  → resolution=denied
//        - TTL elapses without an operator decision    → resolution=timeout
//        - caller cancels (run completed / WS dropped) → resolution=cancelled
//   4. Manager emits the corresponding audit verb +
//      `approval_resolved` broadcast, then deletes the pending entry.
//
// Why a dedicated module:
//
//   - the same instance is the source of truth for the routes layer
//     (slice R3-e-c) AND the hook-router (slice R3-e-d). A free
//     function would force the routes to import the router module
//     just to find the request map.
//   - the lifecycle is naturally state-machine-shaped (pending →
//     resolved → purged). Encapsulating it makes the test surface
//     small (this file) instead of spread across router + routes.
//   - GOV-APPROVAL-0 (slice 5) extends the request payload with PII
//     context. A dedicated module keeps that addition local.
//
// Threat model: the manager NEVER trusts an `approvalId` it didn't
// generate. Every grant/deny call validates against the live pending
// map, so a forged approvalId is a no-op. The audit chain records
// the resolver (granted/denied) verb only when the manager's own
// state transition fires; a forged-id POST returns an "unknown_id"
// error to the caller and emits no audit row.

"use strict";

const crypto = require("crypto");

const {
  APPROVAL_RESOLUTIONS,
  DEFAULT_APPROVAL_TIMEOUT_MS,
  WRITE_TOOLS_REQUIRING_APPROVAL,
  WRITE_TOOL_DATA_KEYS,
} = require("./remoteHookBridgeContract");

// Resolution constants — mirrored from the contract for ergonomics.
// The lint test in approvalManager.test.js asserts these stay in sync.
const RESOLUTION_GRANTED   = "granted";
const RESOLUTION_DENIED    = "denied";
const RESOLUTION_TIMEOUT   = "timeout";
const RESOLUTION_CANCELLED = "cancelled";

// argsSummary cap. The card UI surfaces this verbatim, so anything
// longer would smear the layout. 80 chars matches Phase E's
// "approval card 운영자 친화" gate (Part O O-uxgates).
const ARGS_SUMMARY_MAX_LENGTH = 80;

/**
 * Compute a deterministic sha256 hex digest of an args object. The
 * digest is the R3-G15 "exact (tool, args-hash) tuple" — operators
 * can grant `Bash echo hi` once and have a subsequent `Bash rm -rf /`
 * land in a fresh approval (different hash, different decision).
 *
 * Stable serialization: object keys sorted alphabetically before
 * stringify so {a:1,b:2} and {b:2,a:1} hash identically.
 *
 * @param {object} args
 * @returns {string} 64-char hex sha256
 */
function _hashArgs(args) {
  const canonical = _canonicalize(args);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function _canonicalize(value) {
  // Stable JSON: sort object keys, recurse into nested objects/arrays.
  // Doesn't handle non-JSON values (Symbol, function) — caller is
  // expected to pass plain wire-format data.
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(_canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ":" + _canonicalize(value[k]));
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(String(value));
}

/**
 * Build a short, operator-readable summary of the args record.
 * Per-tool heuristics so the card UI can render meaningful one-liners
 * without re-parsing the wire format.
 *
 * @param {string} tool
 * @param {object} args
 * @returns {string} ≤ ARGS_SUMMARY_MAX_LENGTH chars
 */
function _summarizeArgs(tool, args) {
  if (!args || typeof args !== "object") return "";
  let s = "";
  if (tool === "Bash") {
    s = String(args.command || "");
  } else if (tool === "Edit") {
    const path = String(args.file_path || "");
    const scope = args.replace_all ? "all" : "one";
    s = `${path} (${scope})`;
  } else if (tool === "Write") {
    const path = String(args.file_path || "");
    const len = typeof args.content === "string" ? args.content.length : 0;
    s = `${path} (${len} bytes)`;
  } else {
    // Unknown tool — give the operator something rather than empty.
    try { s = JSON.stringify(args); } catch (_) { s = String(args); }
  }
  if (s.length > ARGS_SUMMARY_MAX_LENGTH) {
    return s.slice(0, ARGS_SUMMARY_MAX_LENGTH - 1) + "…";
  }
  return s;
}

/**
 * Filter the caller-supplied args to ONLY the keys declared for this
 * tool in WRITE_TOOL_DATA_KEYS. Mirrors the sanitizer's defensive-
 * copy pattern: even if the caller passes extra keys (e.g. through
 * a future router refactor), the audit chain + broadcast only sees
 * the contract-frozen surface.
 *
 * @param {string} tool
 * @param {object} args
 * @returns {object} new object, never aliased to the input
 */
function _filterArgs(tool, args) {
  const allowed = WRITE_TOOL_DATA_KEYS[tool];
  if (!allowed || !args || typeof args !== "object") return {};
  const out = {};
  for (const key of allowed) {
    if (key in args) out[key] = args[key];
  }
  return out;
}

class ApprovalManager {
  /**
   * @param {object} opts
   * @param {function} [opts.auditFn=(verb, data) => {}] — called for
   *   every state transition. Constructor accepts a no-op so unit
   *   tests don't have to wire a ledger.
   * @param {function} [opts.broadcastFn=(type, data) => {}] — called
   *   for `approval_requested` + `approval_resolved` events. WS
   *   handler subscribes here.
   * @param {number} [opts.timeoutMs] — default per-request TTL.
   *   Falls back to env `ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS`, then
   *   to DEFAULT_APPROVAL_TIMEOUT_MS (30000).
   * @param {function} [opts.setTimeoutFn=setTimeout] — testable
   *   timer scheduling.
   * @param {function} [opts.clearTimeoutFn=clearTimeout] — testable
   *   cancellation.
   * @param {function} [opts.clockFn=Date.now] — testable wall-clock.
   * @param {function} [opts.idFn] — approvalId generator. Default:
   *   crypto.randomUUID().
   */
  constructor(opts = {}) {
    this._auditFn = typeof opts.auditFn === "function" ? opts.auditFn : () => {};
    this._broadcastFn = typeof opts.broadcastFn === "function" ? opts.broadcastFn : () => {};
    this._setTimeoutFn = typeof opts.setTimeoutFn === "function" ? opts.setTimeoutFn : setTimeout;
    this._clearTimeoutFn = typeof opts.clearTimeoutFn === "function" ? opts.clearTimeoutFn : clearTimeout;
    this._clockFn = typeof opts.clockFn === "function" ? opts.clockFn : () => Date.now();
    this._idFn = typeof opts.idFn === "function" ? opts.idFn : () => crypto.randomUUID();

    // Prefer explicit option > env > default. The env knob is the
    // operator-facing way to tune the TTL without code changes
    // (Phase E1.5 D-spec Section 3 calls it out as configurable).
    let timeoutMs = opts.timeoutMs;
    if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      const envRaw = process.env.ORCHESTRATOR_REMOTE_APPROVAL_TIMEOUT_MS;
      const envParsed = Number(envRaw);
      timeoutMs = (Number.isFinite(envParsed) && envParsed > 0) ? envParsed : DEFAULT_APPROVAL_TIMEOUT_MS;
    }
    this._defaultTimeoutMs = timeoutMs;

    // pending: Map<approvalId, _PendingRequest>
    this._pending = new Map();
  }

  /**
   * Request operator approval for a tool dispatch.
   *
   * @param {object} req
   * @param {string} req.hook            — hook name (PreToolUse/PostToolUse/...)
   * @param {string} req.tool            — must be in WRITE_TOOLS_REQUIRING_APPROVAL
   * @param {object} req.args            — tool args. Filtered to WRITE_TOOL_DATA_KEYS.
   * @param {string} [req.runId]         — orchestrator runId (audit context)
   * @param {string} [req.hostIdentity]  — runner host identity (audit context)
   * @param {string} [req.source="remote_hook"] — provenance label.
   * @param {object} [req.piiContext]    — GOV-APPROVAL-0 slot. {hasPii, findingTypes, samples}.
   * @param {number} [req.timeoutMs]     — per-call override of default TTL.
   * @returns {Promise<{approvalId, resolution, decidedAt, deciderId?, reason?}>}
   *   resolves once the operator decides, the TTL fires, or someone
   *   cancels the request. NEVER rejects on operator decision; only
   *   throws synchronously for invalid input.
   */
  request(req) {
    if (!req || typeof req !== "object") {
      throw new Error("approval_request_invalid: req must be an object");
    }
    const { hook, tool, args, runId, hostIdentity, source, piiContext, timeoutMs } = req;
    if (typeof hook !== "string" || hook.length === 0) {
      throw new Error("approval_request_invalid: hook required");
    }
    if (typeof tool !== "string" || tool.length === 0) {
      throw new Error("approval_request_invalid: tool required");
    }
    if (!WRITE_TOOLS_REQUIRING_APPROVAL.includes(tool)) {
      throw new Error(`approval_request_invalid: ${tool} not in WRITE_TOOLS_REQUIRING_APPROVAL`);
    }

    const filteredArgs = _filterArgs(tool, args || {});
    const argsHash = _hashArgs(filteredArgs);
    const argsSummary = _summarizeArgs(tool, filteredArgs);

    const ttl = (typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0)
      ? timeoutMs : this._defaultTimeoutMs;

    const approvalId = this._idFn();
    const requestedAt = this._clockFn();
    const expiresAt = requestedAt + ttl;

    // Frozen snapshot the routes/UI render against. Mutation of this
    // object during the request lifetime is forbidden — callers
    // observe via list()/get() which return defensive copies.
    const snapshot = Object.freeze({
      approvalId,
      hook,
      tool,
      args: Object.freeze({ ...filteredArgs }),
      argsHash,
      argsSummary,
      runId: runId || null,
      hostIdentity: hostIdentity || null,
      source: source || "remote_hook",
      piiContext: piiContext ? Object.freeze({
        hasPii: !!piiContext.hasPii,
        findingTypes: Array.isArray(piiContext.findingTypes)
          ? Object.freeze([...piiContext.findingTypes]) : Object.freeze([]),
        samples: piiContext.samples && typeof piiContext.samples === "object"
          ? Object.freeze({ ...piiContext.samples }) : Object.freeze({}),
      }) : null,
      timeoutMs: ttl,
      requestedAt,
      expiresAt,
    });

    let resolveOuter;
    const promise = new Promise((resolve) => { resolveOuter = resolve; });

    // Schedule the timeout. The timer resolves the promise as
    // "timeout" if no operator decision arrived by then.
    const timer = this._setTimeoutFn(() => {
      this._resolveInternal(approvalId, RESOLUTION_TIMEOUT, {});
    }, ttl);

    this._pending.set(approvalId, {
      snapshot,
      resolve: resolveOuter,
      timer,
    });

    // Audit + broadcast. Intentionally _after_ the map insert so a
    // forensic auditor seeing `runner_hook_approval_requested` can
    // call list() and find it actually pending.
    this._safeAudit("runner_hook_approval_requested", _auditDataForRequest(snapshot));
    this._safeBroadcast("approval_requested", _broadcastDataForRequest(snapshot));

    return promise;
  }

  /**
   * Operator granted the approval.
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {string} [opts.deciderId] — who pressed the button. Free-form.
   * @returns {boolean} true if the request was pending; false if already resolved.
   */
  grant(approvalId, opts = {}) {
    return this._resolveInternal(approvalId, RESOLUTION_GRANTED, {
      deciderId: opts.deciderId || null,
    });
  }

  /**
   * Operator denied the approval.
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {string} [opts.deciderId]
   * @param {string} [opts.reason] — free-form explanation.
   */
  deny(approvalId, opts = {}) {
    return this._resolveInternal(approvalId, RESOLUTION_DENIED, {
      deciderId: opts.deciderId || null,
      reason: opts.reason || null,
    });
  }

  /**
   * Cancel a pending approval (e.g., run completed before operator
   * decided). Distinct from `denied` so the audit trail tells them
   * apart.
   * @param {string} approvalId
   * @param {object} [opts]
   * @param {string} [opts.reason]
   */
  cancel(approvalId, opts = {}) {
    return this._resolveInternal(approvalId, RESOLUTION_CANCELLED, {
      reason: opts.reason || null,
    });
  }

  /**
   * Cancel every pending approval whose runId matches.
   * @param {string} runId
   * @param {object} [opts]
   * @returns {number} how many requests were cancelled
   */
  cancelByRunId(runId, opts = {}) {
    return this._cancelMatching((s) => s.runId === runId, opts);
  }

  /**
   * Cancel every pending approval whose hostIdentity matches.
   * @param {string} hostIdentity
   * @param {object} [opts]
   * @returns {number} how many requests were cancelled
   */
  cancelByHostIdentity(hostIdentity, opts = {}) {
    return this._cancelMatching((s) => s.hostIdentity === hostIdentity, opts);
  }

  _cancelMatching(predicate, opts) {
    const reason = opts && opts.reason ? opts.reason : null;
    let count = 0;
    // Snapshot the keys first — _resolveInternal mutates the map.
    const ids = [];
    for (const [id, entry] of this._pending) {
      if (predicate(entry.snapshot)) ids.push(id);
    }
    for (const id of ids) {
      if (this._resolveInternal(id, RESOLUTION_CANCELLED, { reason })) count += 1;
    }
    return count;
  }

  /**
   * @param {string} approvalId
   * @returns {object | null} defensive copy of the pending request,
   *   or null if not pending.
   */
  get(approvalId) {
    const entry = this._pending.get(approvalId);
    if (!entry) return null;
    return _shallowClone(entry.snapshot);
  }

  /**
   * @returns {object[]} defensive-copy snapshot of every pending
   *   request, oldest first (insertion order).
   */
  list() {
    const out = [];
    for (const entry of this._pending.values()) {
      out.push(_shallowClone(entry.snapshot));
    }
    return out;
  }

  /**
   * @returns {number} number of pending requests
   */
  size() {
    return this._pending.size;
  }

  // ── internal ────────────────────────────────────────────────────

  _resolveInternal(approvalId, resolution, extra) {
    const entry = this._pending.get(approvalId);
    if (!entry) return false;  // unknown / already-resolved

    if (!APPROVAL_RESOLUTIONS.includes(resolution)) {
      // Defense in depth — caller bug. Convert to cancelled so the
      // promise still resolves; audit chain narrates as cancelled.
      resolution = RESOLUTION_CANCELLED;
    }

    // Stop the timer before any side-effects to avoid a double-fire
    // race when an operator clicks grant within microseconds of
    // the timeout callback firing.
    if (entry.timer) {
      try { this._clearTimeoutFn(entry.timer); } catch (_) { /* noop */ }
    }

    this._pending.delete(approvalId);

    const decidedAt = this._clockFn();
    const result = Object.freeze({
      approvalId,
      resolution,
      decidedAt,
      deciderId: extra && extra.deciderId ? extra.deciderId : null,
      reason: extra && extra.reason ? extra.reason : null,
    });

    // Audit verb depends on resolution.
    const verb = _auditVerbFor(resolution);
    if (verb) {
      this._safeAudit(verb, _auditDataForResolve(entry.snapshot, result));
    }

    // Broadcast every resolution as `approval_resolved` so the UI
    // store can clear the card uniformly.
    this._safeBroadcast("approval_resolved", _broadcastDataForResolve(entry.snapshot, result));

    // Resolve the caller's promise LAST so any synchronous handlers
    // (router gate awaiting this) see the audit + broadcast already
    // emitted.
    try { entry.resolve(result); } catch (_) { /* never throw out */ }
    return true;
  }

  _safeAudit(verb, data) {
    try { this._auditFn(verb, data); } catch (_) { /* never break the manager */ }
  }

  _safeBroadcast(type, data) {
    try { this._broadcastFn(type, data); } catch (_) { /* never break the manager */ }
  }
}

// ── Pure helpers (exported for unit tests) ────────────────────────

function _shallowClone(snapshot) {
  // snapshot is frozen; a defensive copy lets routes/UI mutate
  // freely without affecting the manager's internal state.
  return {
    approvalId: snapshot.approvalId,
    hook: snapshot.hook,
    tool: snapshot.tool,
    args: { ...snapshot.args },
    argsHash: snapshot.argsHash,
    argsSummary: snapshot.argsSummary,
    runId: snapshot.runId,
    hostIdentity: snapshot.hostIdentity,
    source: snapshot.source,
    piiContext: snapshot.piiContext ? {
      hasPii: snapshot.piiContext.hasPii,
      findingTypes: [...snapshot.piiContext.findingTypes],
      samples: { ...snapshot.piiContext.samples },
    } : null,
    timeoutMs: snapshot.timeoutMs,
    requestedAt: snapshot.requestedAt,
    expiresAt: snapshot.expiresAt,
  };
}

function _auditVerbFor(resolution) {
  if (resolution === RESOLUTION_GRANTED) return "runner_hook_approval_granted";
  if (resolution === RESOLUTION_DENIED)  return "runner_hook_approval_denied";
  if (resolution === RESOLUTION_TIMEOUT) return "runner_hook_approval_timeout";
  // CANCELLED: no audit verb fires. The caller (cancelByRunId etc.)
  // already has its own audit narration (run_complete / runner_disconnected).
  return null;
}

function _auditDataForRequest(snapshot) {
  return {
    approvalId: snapshot.approvalId,
    hook: snapshot.hook,
    tool: snapshot.tool,
    runId: snapshot.runId,
    hostIdentity: snapshot.hostIdentity,
    argsHash: snapshot.argsHash,
    argsSummary: snapshot.argsSummary,
    source: snapshot.source,
    piiContext: snapshot.piiContext ? {
      hasPii: snapshot.piiContext.hasPii,
      findingTypes: [...snapshot.piiContext.findingTypes],
    } : null,
    timeoutMs: snapshot.timeoutMs,
    requestedAt: snapshot.requestedAt,
  };
}

function _auditDataForResolve(snapshot, result) {
  return {
    approvalId: snapshot.approvalId,
    runId: snapshot.runId,
    hostIdentity: snapshot.hostIdentity,
    tool: snapshot.tool,
    argsHash: snapshot.argsHash,
    deciderId: result.deciderId,
    reason: result.reason,
    decidedAt: result.decidedAt,
    timeoutMs: snapshot.timeoutMs,
  };
}

function _broadcastDataForRequest(snapshot) {
  return _shallowClone(snapshot);
}

function _broadcastDataForResolve(snapshot, result) {
  return {
    approvalId: snapshot.approvalId,
    resolution: result.resolution,
    decidedAt: result.decidedAt,
    deciderId: result.deciderId,
    reason: result.reason,
    runId: snapshot.runId,
    hostIdentity: snapshot.hostIdentity,
    tool: snapshot.tool,
  };
}

module.exports = {
  ApprovalManager,
  // Internal helpers exported for direct unit testing.
  _hashArgs,
  _summarizeArgs,
  _filterArgs,
  _auditVerbFor,
  ARGS_SUMMARY_MAX_LENGTH,
  RESOLUTION_GRANTED,
  RESOLUTION_DENIED,
  RESOLUTION_TIMEOUT,
  RESOLUTION_CANCELLED,
};
