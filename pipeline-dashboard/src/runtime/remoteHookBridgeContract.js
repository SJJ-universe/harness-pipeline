// Slice R2.5-a (Phase D R2.5, 2026-04-28) — remote hook execution bridge contract.
//
// This module is the single source of truth for what a remote runner is
// allowed to send through to the local executor. Every remote-side
// frame that wants to drive the executor goes through these gates:
//
//   1. hook name in `ALLOWED_HOOKS` (allowlist; nothing else)
//   2. payload conforms to `PAYLOAD_SCHEMAS[hook]`
//   3. for PreToolUse / PostToolUse: tool name in `ALLOWED_TOOLS`
//   4. dispatch only when the orchestrator's bridge mode permits it
//
// Why a constants module instead of inline schemas:
//
//   - the WS handler, the route, and the runner-side test fixtures all
//     need to agree on the exact shape; a single import keeps them in
//     lockstep.
//   - changes to the allowlist or the dispatch mapping are a code-
//     review-visible diff against this file.
//   - lint tests assert the shape can never widen accidentally —
//     adding an entry to ALLOWED_TOOLS or BRIDGE_MODES gates on
//     conscious review.
//
// What is INTENTIONALLY NOT in scope for R2.5:
//
//   - SessionStart / SessionEnd — session-level state mutations are too
//     broad for the first bridge round.
//   - Notification — operator-targeted, not executor-bound.
//   - PreCompact — compaction state is sensitive to write-side hooks.
//   - Bash / Write / Edit — these have write side-effects; allowing
//     them through a remote bridge requires a per-call approval flow
//     that R3 will design. R2.5 is read-only.
//
// Threat model: the runner's WS frame is untrusted input. The JWT
// verdict's runId + hostIdentity are authoritative; the frame body's
// runId or hostIdentity must NEVER be honored. This module's job is
// to drop everything else.

"use strict";

// ── 1. Hook name allowlist ──────────────────────────────────────────

/**
 * Hook events the remote bridge will dispatch to the local executor.
 * Order chosen to match a typical agent lifecycle (PreTool → PostTool →
 * eventual Stop / Subagent fan-out). Any hook not in this set is
 * rejected with reason `hook_not_allowed`.
 */
const ALLOWED_HOOKS = Object.freeze([
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SubagentStart",
  "SubagentStop",
]);

// ── 2. Tool allowlist (for PreToolUse / PostToolUse) ────────────────

/**
 * Tools whose Pre/PostToolUse hooks the bridge will dispatch in R2.5.
 *
 * R2.5 is deliberately read-only — Read, Grep, Glob have no write
 * side-effects, so dispatching them to the local executor's onPreTool
 * is reversible. Bash / Write / Edit are explicitly NOT here; their
 * hooks pass through the broadcast path (so the dashboard sees them)
 * but never reach the executor. R3 will design a per-call approval
 * flow before opening write tools.
 */
const ALLOWED_TOOLS = Object.freeze(["Read", "Grep", "Glob"]);

// ── 3. Per-hook payload schema ──────────────────────────────────────

/**
 * Each entry describes the SHAPE the bridge will accept. Anything not
 * listed in `dataKeys` is dropped during sanitization (defensive copy);
 * `dataKeysRequired` causes a reject when missing. `responseMaxBytes`
 * caps the PostToolUse response payload before it hits the audit
 * chain.
 *
 * Keys deliberately use a flat allowlist rather than JSON Schema to
 * keep the validator dependency-free + reviewable in one screen.
 */
const PAYLOAD_SCHEMAS = Object.freeze({
  PreToolUse: Object.freeze({
    requireTool: true,
    dataKeys: Object.freeze([
      "file_path",   // Read / Edit
      "path",        // Glob, Grep
      "pattern",     // Grep
      "glob",        // Grep --glob
      "limit",       // Read
      "offset",      // Read
      "head_limit",  // Grep
      "type",        // Grep --type
      "output_mode", // Grep
      "session_id",  // pass-through for executor's _resolveRunId
    ]),
    dataKeysRequired: Object.freeze([]),
  }),
  PostToolUse: Object.freeze({
    requireTool: true,
    dataKeys: Object.freeze([
      "file_path", "path", "pattern", "glob", "limit",
      "offset", "head_limit", "type", "output_mode", "session_id",
    ]),
    dataKeysRequired: Object.freeze([]),
    responseMaxBytes: 4096,
  }),
  Stop: Object.freeze({
    requireTool: false,
    dataKeys: Object.freeze(["session_id"]),
    dataKeysRequired: Object.freeze([]),
  }),
  SubagentStart: Object.freeze({
    requireTool: false,
    dataKeys: Object.freeze([
      "agent_id", "parent_id", "agent_type", "session_id",
    ]),
    dataKeysRequired: Object.freeze(["agent_id"]),
  }),
  SubagentStop: Object.freeze({
    requireTool: false,
    dataKeys: Object.freeze(["agent_id", "session_id"]),
    dataKeysRequired: Object.freeze(["agent_id"]),
  }),
});

// ── 4. Executor dispatch mapping ────────────────────────────────────

/**
 * For each allowed hook, what method on the local executor receives
 * the dispatch and how to bind the sanitized payload to its arguments.
 *
 * `args` describes the positional parameter list. Each entry is a key
 * name; the dispatcher reads the sanitized payload at that key. The
 * special key "_data" means "pass the entire sanitized data object".
 *
 * Why separate from the schema: the schema describes what's ALLOWED
 * across the wire; the dispatch describes what the local executor
 * NEEDS. Decoupling them means the contract (wire-format) can stay
 * stable while the executor signature evolves.
 */
const EXECUTOR_DISPATCH = Object.freeze({
  PreToolUse: Object.freeze({
    method: "onPreTool",
    // executor.onPreTool(tool, input) — input is the sanitized data
    args: Object.freeze(["tool", "_data"]),
  }),
  PostToolUse: Object.freeze({
    method: "onPostTool",
    // executor.onPostTool(tool, response, input)
    args: Object.freeze(["tool", "response", "_data"]),
  }),
  Stop: Object.freeze({
    method: "onStop",
    // executor.onStop(payload)
    args: Object.freeze(["_data"]),
  }),
  SubagentStart: Object.freeze({
    method: "onSubagentStart",
    args: Object.freeze(["_data"]),
  }),
  SubagentStop: Object.freeze({
    method: "onSubagentStop",
    args: Object.freeze(["_data"]),
  }),
});

// ── 5. Bridge mode taxonomy ─────────────────────────────────────────

/**
 * `HARNESS_REMOTE_BRIDGE_MODE` env values:
 *
 *   off       — default. Broadcast-only (R1 behavior). routeRemote
 *               emits `runner_hook_routed` and stops; no validation,
 *               no dispatch. Backward-compatible with every existing
 *               R1 deployment.
 *   report    — Validation runs. Audit chain gets `runner_hook_routed`,
 *               then either `runner_hook_rejected` (with reason) or
 *               `runner_hook_sanitized` (with the sanitized payload).
 *               No dispatch — useful for dry-run evaluation before
 *               flipping to "dispatch" in production.
 *   dispatch  — Full bridge. Sanitized hooks are forwarded to the
 *               local executor's mapped method; `runner_hook_dispatched`
 *               or `runner_hook_dispatch_error` lands in the audit
 *               chain. R2.5's terminal mode.
 */
const BRIDGE_MODES = Object.freeze(["off", "report", "dispatch"]);
const DEFAULT_BRIDGE_MODE = "off";

function resolveBridgeMode(env) {
  // Same defensive parsing pattern as setupRemoteRunner. Anything
  // unrecognized falls back to the safest default.
  const raw = (env && env.HARNESS_REMOTE_BRIDGE_MODE) || "";
  const value = String(raw).trim().toLowerCase();
  if (BRIDGE_MODES.includes(value)) return value;
  return DEFAULT_BRIDGE_MODE;
}

// ── 6. Audit verbs ──────────────────────────────────────────────────

/**
 * Audit-chain entry types the bridge emits. Operators reading the
 * ledger can reconstruct exactly what happened to every remote hook:
 *
 *   runner_hook_routed         — frame entered the router and was
 *                                broadcast to dashboard subscribers
 *                                (R1-k2; preserved for backward compat)
 *   runner_hook_rejected       — frame failed validation; reason field
 *                                names the gate that fired
 *   runner_hook_sanitized      — frame passed validation; dispatch is
 *                                queued (or skipped if mode=report)
 *   runner_hook_dispatched     — local executor method returned
 *   runner_hook_dispatch_error — local executor method threw; error
 *                                field names the failure
 */
const AUDIT_VERBS = Object.freeze([
  "runner_hook_routed",
  "runner_hook_rejected",
  "runner_hook_sanitized",
  "runner_hook_dispatched",
  "runner_hook_dispatch_error",
]);

// ── 7. Reject reasons ───────────────────────────────────────────────

/**
 * Frozen list of reasons the validator can give. Tests pin this so a
 * future contributor adding a new reject path either reuses an
 * existing reason or extends this constant — the operator-facing
 * vocabulary stays bounded.
 */
const REJECT_REASONS = Object.freeze([
  "hook_not_allowed",        // hook name not in ALLOWED_HOOKS
  "hook_missing",            // event.hook not a string
  "tool_required_missing",   // PreTool/PostTool missing tool
  "tool_not_allowed",        // tool not in ALLOWED_TOOLS
  "data_required_missing",   // dataKeysRequired field absent
  "data_invalid_type",       // event.data not an object
  "response_oversize",       // PostTool response > responseMaxBytes
  "frame_malformed",         // top-level frame shape wrong
]);

module.exports = {
  ALLOWED_HOOKS,
  ALLOWED_TOOLS,
  PAYLOAD_SCHEMAS,
  EXECUTOR_DISPATCH,
  BRIDGE_MODES,
  DEFAULT_BRIDGE_MODE,
  resolveBridgeMode,
  AUDIT_VERBS,
  REJECT_REASONS,
};
