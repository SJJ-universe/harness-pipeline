// Hook Decision Adapter — dual-format PreToolUse responses.
//
// Background (Slice F0, v5):
//   Claude Code's PreToolUse hook originally accepted `{ decision: "block",
//   reason }` as the block response. Newer docs promote a structured
//   `hookSpecificOutput.permissionDecision: "allow" | "deny" | "ask"` instead,
//   with the legacy shape deprecated.
//
//   To avoid either (a) locking ourselves to a deprecated field or (b)
//   breaking older installations of Claude Code during the transition, every
//   PreToolUse response in the harness is now built through this adapter
//   which emits BOTH the legacy and modern shapes at once.
//
// Scope:
//   PreToolUse only. Other hooks (Stop, SessionEnd, UserPromptSubmit) still
//   have hook-specific semantics for their "block" output that upstream has
//   not reshaped the same way, so we keep their returns as-is until docs
//   catch up.

/**
 * PreToolUse deny — emits both legacy `decision: "block"` and modern
 * `hookSpecificOutput.permissionDecision: "deny"`.
 *
 * @param {string} reason  Human-readable reason shown to the user / LLM.
 * @param {object} [opts]
 * @param {string} [opts.hookEventName] Defaults to "PreToolUse".
 */
function denyToolUse(reason, { hookEventName = "PreToolUse" } = {}) {
  return {
    // Legacy shape (deprecated but still honored by current Claude Code).
    decision: "block",
    reason,
    // Modern shape (preferred going forward).
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * PreToolUse allow — modern-only, since an empty `{}` has always meant
 * "no opinion, proceed" and adding `decision: "approve"` would override
 * other PreToolUse hooks in the chain.
 */
function allowToolUse({ hookEventName = "PreToolUse" } = {}) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "allow",
    },
  };
}

/**
 * PreToolUse ask — surfaces a confirmation prompt to the user.
 */
function askToolUse(reason, { hookEventName = "PreToolUse" } = {}) {
  return {
    hookSpecificOutput: {
      hookEventName,
      permissionDecision: "ask",
      permissionDecisionReason: reason,
    },
  };
}

module.exports = { denyToolUse, allowToolUse, askToolUse };
