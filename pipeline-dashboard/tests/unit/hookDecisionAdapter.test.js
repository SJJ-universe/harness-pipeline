// Slice F0 (v5) — HookDecisionAdapter dual-format regression.
//
// These tests lock the critical invariant: denyToolUse() MUST emit both the
// legacy `decision: "block"` shape AND the modern
// `hookSpecificOutput.permissionDecision: "deny"` shape so that the harness
// is forward- and backward-compatible with Claude Code hook versions.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  denyToolUse,
  allowToolUse,
  askToolUse,
} = require("../../src/hooks/hookDecisionAdapter");

test("denyToolUse emits legacy decision:block + modern permissionDecision:deny", () => {
  const r = denyToolUse("Phase A does not allow Bash");
  // Legacy
  assert.equal(r.decision, "block");
  assert.equal(r.reason, "Phase A does not allow Bash");
  // Modern
  assert.ok(r.hookSpecificOutput, "hookSpecificOutput must be present");
  assert.equal(r.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(r.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(
    r.hookSpecificOutput.permissionDecisionReason,
    "Phase A does not allow Bash"
  );
});

test("denyToolUse reason strings roundtrip identically on both shapes", () => {
  const reason = "멀티바이트 한글 reason with special chars: /foo/bar && ls";
  const r = denyToolUse(reason);
  assert.equal(r.reason, reason);
  assert.equal(r.hookSpecificOutput.permissionDecisionReason, reason);
});

test("allowToolUse emits only modern shape (no legacy decision field)", () => {
  const r = allowToolUse();
  // Legacy fields MUST NOT appear: the old "allow" was implicit ({}).
  // Emitting `decision: "approve"` would override other PreToolUse hooks.
  assert.equal(r.decision, undefined);
  assert.equal(r.reason, undefined);
  // Modern
  assert.equal(r.hookSpecificOutput.permissionDecision, "allow");
  assert.equal(r.hookSpecificOutput.hookEventName, "PreToolUse");
});

test("askToolUse carries reason in modern shape only", () => {
  const r = askToolUse("Uncertain — confirm with user");
  assert.equal(r.decision, undefined);
  assert.equal(r.hookSpecificOutput.permissionDecision, "ask");
  assert.equal(
    r.hookSpecificOutput.permissionDecisionReason,
    "Uncertain — confirm with user"
  );
});

test("hookEventName defaults to PreToolUse but can be overridden", () => {
  const r = denyToolUse("x", { hookEventName: "PreToolUse" });
  assert.equal(r.hookSpecificOutput.hookEventName, "PreToolUse");
  // Defensive: adapter doesn't refuse other event names (future-proof), but
  // consumers should stick to PreToolUse for now.
  const r2 = denyToolUse("x", { hookEventName: "OtherEvent" });
  assert.equal(r2.hookSpecificOutput.hookEventName, "OtherEvent");
});
