// Slice R3-e-a (Phase D R3, 2026-04-29) — approval contract lint.
//
// These tests are paranoid in the same spirit as the R2.5-a lint:
// the approval surface is the one place a future contributor is
// most tempted to widen ("just one more write tool") without
// reviewing what that means for the threat model. The lint pins:
//
//   - WRITE_TOOLS_REQUIRING_APPROVAL stays exactly the R3-e-scoped set
//   - WRITE_TOOL_DATA_KEYS covers every entry in the set
//   - APPROVAL_AUDIT_VERBS narrate a four-state lifecycle
//   - APPROVAL_RESOLUTIONS stays bounded
//   - the helpers behave on garbage input
//   - R2.5 invariants are still preserved (negative pin)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const c = require("../../src/runtime/remoteHookBridgeContract");

// ── Top-level shape ────────────────────────────────────────────────

test("R3-e-a: approval-related exports are present", () => {
  for (const name of [
    "WRITE_TOOLS_REQUIRING_APPROVAL",
    "WRITE_TOOL_DATA_KEYS",
    "isWriteToolRequiringApproval",
    "getWriteToolDataKeys",
    "APPROVAL_AUDIT_VERBS",
    "APPROVAL_RESOLUTIONS",
    "DEFAULT_APPROVAL_TIMEOUT_MS",
  ]) {
    assert.ok(name in c, "missing approval export: " + name);
  }
});

test("R3-e-a: every approval constant collection is frozen", () => {
  for (const name of [
    "WRITE_TOOLS_REQUIRING_APPROVAL",
    "WRITE_TOOL_DATA_KEYS",
    "APPROVAL_AUDIT_VERBS",
    "APPROVAL_RESOLUTIONS",
  ]) {
    assert.ok(Object.isFrozen(c[name]),
      `${name} must be Object.freeze'd to block runtime widening`);
  }
});

// ── Write tool allowlist ───────────────────────────────────────────

test("R3-e-a: WRITE_TOOLS_REQUIRING_APPROVAL is exactly Bash / Edit / Write", () => {
  // Pin the exact set so widening triggers a code-review-visible diff
  // here. WebFetch / WebSearch / Task are intentionally NOT in the
  // approval set — they hit external networks (egress concern, R3-b)
  // or spawn subagents (local-only, out of R3 scope).
  assert.deepEqual(
    [...c.WRITE_TOOLS_REQUIRING_APPROVAL].sort(),
    ["Bash", "Edit", "Write"],
    "WRITE_TOOLS_REQUIRING_APPROVAL surface widened — review against contract §2b",
  );
});

test("R3-e-a: write-approval set is DISJOINT from ALLOWED_TOOLS (R2.5 invariant)", () => {
  // The R2.5 invariant is: read-only tools dispatch without approval.
  // If any tool ever appears in BOTH sets, a future router refactor
  // could accidentally double-gate a Read with approval (operator-
  // hostile) or skip approval on a Bash (security regression).
  for (const t of c.WRITE_TOOLS_REQUIRING_APPROVAL) {
    assert.ok(!c.ALLOWED_TOOLS.includes(t),
      `${t} appears in both ALLOWED_TOOLS and WRITE_TOOLS_REQUIRING_APPROVAL`);
  }
});

test("R3-e-a: ALLOWED_TOOLS still pinned to the R2.5 read-only set", () => {
  // Negative pin: R3-e adds the WRITE_* set but MUST NOT widen
  // ALLOWED_TOOLS. This test backstops the existing R2.5-a pin so a
  // refactor that conflates the two sets fails loud here too.
  assert.deepEqual(
    [...c.ALLOWED_TOOLS].sort(),
    ["Glob", "Grep", "Read"],
    "ALLOWED_TOOLS widened beyond R2.5 read-only scope by R3-e-a — review",
  );
});

test("R3-e-a: WRITE_TOOL_DATA_KEYS has an entry for every approval-set tool", () => {
  for (const tool of c.WRITE_TOOLS_REQUIRING_APPROVAL) {
    const keys = c.WRITE_TOOL_DATA_KEYS[tool];
    assert.ok(Array.isArray(keys),
      `WRITE_TOOL_DATA_KEYS missing array entry for ${tool}`);
    assert.ok(Object.isFrozen(keys), `${tool} keys must be frozen`);
    assert.ok(keys.length > 0, `${tool} must have at least one declared arg key`);
  }
});

test("R3-e-a: WRITE_TOOL_DATA_KEYS pins each tool's argument shape", () => {
  // Pin to the exact wire-format keys the approval card surfaces.
  // Widening happens via a contract-update PR with this test edited.
  assert.deepEqual(
    [...c.WRITE_TOOL_DATA_KEYS.Bash].sort(),
    ["command", "description", "run_in_background", "timeout"],
  );
  assert.deepEqual(
    [...c.WRITE_TOOL_DATA_KEYS.Edit].sort(),
    ["file_path", "new_string", "old_string", "replace_all"],
  );
  assert.deepEqual(
    [...c.WRITE_TOOL_DATA_KEYS.Write].sort(),
    ["content", "file_path"],
  );
});

// ── Helpers ────────────────────────────────────────────────────────

test("R3-e-a: isWriteToolRequiringApproval matches every approval-set tool", () => {
  for (const t of c.WRITE_TOOLS_REQUIRING_APPROVAL) {
    assert.equal(c.isWriteToolRequiringApproval(t), true,
      `isWriteToolRequiringApproval(${t}) should be true`);
  }
});

test("R3-e-a: isWriteToolRequiringApproval rejects ALLOWED_TOOLS (read-only)", () => {
  for (const t of c.ALLOWED_TOOLS) {
    assert.equal(c.isWriteToolRequiringApproval(t), false,
      `${t} is read-only — should not require approval`);
  }
});

test("R3-e-a: isWriteToolRequiringApproval safely rejects garbage input", () => {
  // Any caller is going to feed user-supplied strings (or worse) into
  // this helper. It must never throw, never coerce, never match by
  // accident. The contract is "string-equal to a member of the set".
  for (const v of [null, undefined, 0, 1, true, false, {}, [], () => {}]) {
    assert.equal(c.isWriteToolRequiringApproval(v), false,
      `garbage input ${String(v)} must not match`);
  }
  assert.equal(c.isWriteToolRequiringApproval(""), false);
  assert.equal(c.isWriteToolRequiringApproval("bash"), false, "case-sensitive");
  assert.equal(c.isWriteToolRequiringApproval("BASH"), false, "case-sensitive");
});

test("R3-e-a: getWriteToolDataKeys returns the per-tool key list", () => {
  const bashKeys = c.getWriteToolDataKeys("Bash");
  assert.ok(Array.isArray(bashKeys));
  assert.ok(bashKeys.includes("command"));
  // Reference equality with the frozen const — caller must not be
  // able to mutate it. (Frozen tested separately above.)
  assert.equal(bashKeys, c.WRITE_TOOL_DATA_KEYS.Bash);
});

test("R3-e-a: getWriteToolDataKeys returns undefined for non-approval tools", () => {
  assert.equal(c.getWriteToolDataKeys("Read"), undefined);
  assert.equal(c.getWriteToolDataKeys("Grep"), undefined);
  assert.equal(c.getWriteToolDataKeys(""), undefined);
  assert.equal(c.getWriteToolDataKeys(null), undefined);
  assert.equal(c.getWriteToolDataKeys(123), undefined);
});

// ── Audit verbs ────────────────────────────────────────────────────

test("R3-e-a: APPROVAL_AUDIT_VERBS narrates the four-state lifecycle", () => {
  // Pin the exact set. Removal forces an audit-chain migration story;
  // addition forces a contract update and operator-doc refresh.
  assert.deepEqual(
    [...c.APPROVAL_AUDIT_VERBS].sort(),
    [
      "runner_hook_approval_denied",
      "runner_hook_approval_granted",
      "runner_hook_approval_requested",
      "runner_hook_approval_timeout",
    ],
  );
});

test("R3-e-a: APPROVAL_AUDIT_VERBS is DISJOINT from R2.5's AUDIT_VERBS", () => {
  // Distinct verb prefix is the whole point of the new family —
  // a forensic auditor's grep for `runner_hook_rejected` keeps
  // returning only sanitization-time rejections, not approval denies.
  for (const v of c.APPROVAL_AUDIT_VERBS) {
    assert.ok(!c.AUDIT_VERBS.includes(v),
      `${v} would create a verb collision with the R2.5 AUDIT_VERBS family`);
  }
});

test("R3-e-a: every approval verb starts with runner_hook_approval_ prefix", () => {
  for (const v of c.APPROVAL_AUDIT_VERBS) {
    assert.ok(v.startsWith("runner_hook_approval_"),
      `${v} must start with runner_hook_approval_ for grep distinctness`);
  }
});

// ── Resolutions ────────────────────────────────────────────────────

test("R3-e-a: APPROVAL_RESOLUTIONS is exactly granted/denied/timeout/cancelled", () => {
  assert.deepEqual(
    [...c.APPROVAL_RESOLUTIONS].sort(),
    ["cancelled", "denied", "granted", "timeout"],
  );
});

test("R3-e-a: granted is the only positive resolution", () => {
  // Multiple positive resolutions would risk a router refactor that
  // grants on (granted | other-positive) and skips audit narration.
  // Pinning here forces any future broadening to be explicit.
  const positive = c.APPROVAL_RESOLUTIONS.filter((r) => r === "granted");
  assert.equal(positive.length, 1, "exactly one positive resolution");
});

// ── Default timeout ────────────────────────────────────────────────

test("R3-e-a: DEFAULT_APPROVAL_TIMEOUT_MS is reasonable", () => {
  // The plan locks 30s as the operator-UX sweet spot. Lower bound
  // 1s prevents a regression to "always timeout"; upper bound
  // 5 minutes prevents a stuck approval from parking the runner.
  assert.equal(typeof c.DEFAULT_APPROVAL_TIMEOUT_MS, "number");
  assert.ok(c.DEFAULT_APPROVAL_TIMEOUT_MS >= 1000);
  assert.ok(c.DEFAULT_APPROVAL_TIMEOUT_MS <= 5 * 60 * 1000);
  // Lock the precise value the plan committed to.
  assert.equal(c.DEFAULT_APPROVAL_TIMEOUT_MS, 30000);
});
