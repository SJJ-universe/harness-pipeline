// Slice R2.5-a (Phase D R2.5, 2026-04-28) — contract lint.
//
// These tests are intentionally PARANOID. The contract module is the
// only thing standing between an attacker on the runner side and the
// orchestrator's executor; the lint catches the kinds of changes an
// inattentive contributor might wave through during a refactor:
//
//   - secretly widening ALLOWED_HOOKS (adding SessionStart, Bash, etc.)
//   - secretly widening ALLOWED_TOOLS (adding Write / Bash for R2.5)
//   - dropping a `Object.freeze` so a runtime mutation could redirect
//     dispatch (extremely unlikely but cheap to check)
//   - changing the audit verb vocabulary in a way that breaks the
//     forensic narrative
//   - extending REJECT_REASONS without tests covering the new reason

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const c = require("../../src/runtime/remoteHookBridgeContract");

// ── Shape: structural invariants ───────────────────────────────────

test("R2.5-a: top-level exports are present", () => {
  for (const name of [
    "ALLOWED_HOOKS", "ALLOWED_TOOLS",
    "PAYLOAD_SCHEMAS", "EXECUTOR_DISPATCH",
    "BRIDGE_MODES", "DEFAULT_BRIDGE_MODE", "resolveBridgeMode",
    "AUDIT_VERBS", "REJECT_REASONS",
  ]) {
    assert.ok(name in c, "missing export: " + name);
  }
});

test("R2.5-a: every constant collection is frozen (no runtime mutation)", () => {
  for (const name of [
    "ALLOWED_HOOKS", "ALLOWED_TOOLS",
    "PAYLOAD_SCHEMAS", "EXECUTOR_DISPATCH",
    "BRIDGE_MODES", "AUDIT_VERBS", "REJECT_REASONS",
  ]) {
    assert.ok(Object.isFrozen(c[name]),
      `${name} must be Object.freeze'd to block runtime widening`);
  }
});

// ── Hook allowlist ─────────────────────────────────────────────────

test("R2.5-a: ALLOWED_HOOKS is exactly the R2.5-scoped set", () => {
  // Pinning the exact set forces a code review for any expansion.
  assert.deepEqual(
    [...c.ALLOWED_HOOKS].sort(),
    ["PostToolUse", "PreToolUse", "Stop", "SubagentStart", "SubagentStop"],
    "ALLOWED_HOOKS surface widened — review against contract §1",
  );
});

test("R2.5-a: SessionStart / SessionEnd / Notification / PreCompact are NOT in the allowlist", () => {
  // Negative pin: each of these is explicitly deferred per the
  // contract document. A change that adds any of them MUST come with
  // a contract update.
  for (const banned of ["SessionStart", "SessionEnd", "Notification", "PreCompact"]) {
    assert.ok(!c.ALLOWED_HOOKS.includes(banned),
      `${banned} must NOT be in ALLOWED_HOOKS — see contract §1 for the rationale`);
  }
});

// ── Tool allowlist ─────────────────────────────────────────────────

test("R2.5-a: ALLOWED_TOOLS is read-only set for R2.5", () => {
  assert.deepEqual(
    [...c.ALLOWED_TOOLS].sort(),
    ["Glob", "Grep", "Read"],
    "ALLOWED_TOOLS widened beyond R2.5 read-only scope",
  );
});

test("R2.5-a: write-side tools are NOT in ALLOWED_TOOLS (R2.5 read-only)", () => {
  // The reject path for these is `tool_not_allowed`; the bridge
  // refuses to drive the executor with them in R2.5. R3 will design
  // a per-call approval flow before opening any of them.
  for (const banned of ["Bash", "Write", "Edit", "WebFetch", "WebSearch", "Task"]) {
    assert.ok(!c.ALLOWED_TOOLS.includes(banned),
      `${banned} must NOT be in ALLOWED_TOOLS — see contract §2`);
  }
});

// ── Payload schemas ────────────────────────────────────────────────

test("R2.5-a: PAYLOAD_SCHEMAS has an entry for every allowed hook", () => {
  for (const hook of c.ALLOWED_HOOKS) {
    assert.ok(c.PAYLOAD_SCHEMAS[hook],
      `PAYLOAD_SCHEMAS missing entry for ${hook} — adding to ALLOWED_HOOKS without a schema is a hole`);
    assert.ok(Object.isFrozen(c.PAYLOAD_SCHEMAS[hook]));
    assert.ok(Object.isFrozen(c.PAYLOAD_SCHEMAS[hook].dataKeys));
    assert.ok(Object.isFrozen(c.PAYLOAD_SCHEMAS[hook].dataKeysRequired));
  }
});

test("R2.5-a: PreToolUse + PostToolUse require tool, others do not", () => {
  assert.equal(c.PAYLOAD_SCHEMAS.PreToolUse.requireTool, true);
  assert.equal(c.PAYLOAD_SCHEMAS.PostToolUse.requireTool, true);
  for (const hook of ["Stop", "SubagentStart", "SubagentStop"]) {
    assert.equal(c.PAYLOAD_SCHEMAS[hook].requireTool, false,
      `${hook} should NOT require a tool field — only Pre/PostToolUse do`);
  }
});

test("R2.5-a: subagent hooks require agent_id", () => {
  // The whole point of SubagentStart/Stop is the lifecycle id; passing
  // them without an agent_id would be meaningless and the executor
  // would silently drop them.
  for (const hook of ["SubagentStart", "SubagentStop"]) {
    assert.ok(c.PAYLOAD_SCHEMAS[hook].dataKeysRequired.includes("agent_id"),
      `${hook} must list agent_id in dataKeysRequired`);
  }
});

test("R2.5-a: PostToolUse caps the response payload size", () => {
  // Without the cap, an attacker could exhaust the orchestrator's
  // ledger or memory by sending a huge response payload through.
  assert.ok(typeof c.PAYLOAD_SCHEMAS.PostToolUse.responseMaxBytes === "number");
  assert.ok(c.PAYLOAD_SCHEMAS.PostToolUse.responseMaxBytes >= 1024);
  assert.ok(c.PAYLOAD_SCHEMAS.PostToolUse.responseMaxBytes <= 64 * 1024,
    "responseMaxBytes higher than 64KB starts to defeat the cap intent");
});

// ── Executor dispatch ──────────────────────────────────────────────

test("R2.5-a: EXECUTOR_DISPATCH covers every allowed hook", () => {
  for (const hook of c.ALLOWED_HOOKS) {
    const dispatch = c.EXECUTOR_DISPATCH[hook];
    assert.ok(dispatch, `EXECUTOR_DISPATCH missing entry for ${hook}`);
    assert.ok(typeof dispatch.method === "string" && dispatch.method.startsWith("on"));
    assert.ok(Array.isArray(dispatch.args) && Object.isFrozen(dispatch.args));
  }
});

test("R2.5-a: dispatch method names match the executor's actual signatures", () => {
  // Pin each method to the executor signature it expects to call.
  // If pipeline-executor.js renames a method, this fails here AND in
  // dispatch tests — fail-loud rather than silently no-op.
  assert.equal(c.EXECUTOR_DISPATCH.PreToolUse.method,    "onPreTool");
  assert.equal(c.EXECUTOR_DISPATCH.PostToolUse.method,   "onPostTool");
  assert.equal(c.EXECUTOR_DISPATCH.Stop.method,          "onStop");
  assert.equal(c.EXECUTOR_DISPATCH.SubagentStart.method, "onSubagentStart");
  assert.equal(c.EXECUTOR_DISPATCH.SubagentStop.method,  "onSubagentStop");
});

test("R2.5-a: dispatch args use only documented binding keys", () => {
  // The dispatcher reads sanitized payload at these keys; anything
  // else means a sanitization step the contract didn't anticipate.
  const allowed = new Set(["tool", "response", "_data"]);
  for (const hook of c.ALLOWED_HOOKS) {
    for (const arg of c.EXECUTOR_DISPATCH[hook].args) {
      assert.ok(allowed.has(arg),
        `${hook}.args includes unrecognized binding key ${arg}`);
    }
  }
});

// ── Bridge mode taxonomy ───────────────────────────────────────────

test("R2.5-a: BRIDGE_MODES is exactly off / report / dispatch", () => {
  assert.deepEqual([...c.BRIDGE_MODES], ["off", "report", "dispatch"]);
});

test("R2.5-a: DEFAULT_BRIDGE_MODE is 'off' (opt-in upgrade path)", () => {
  // Existing R1/R2 deployments upgrading to R2.5 must see no behavior
  // change unless they explicitly set ORCHESTRATOR_REMOTE_BRIDGE_MODE.
  assert.equal(c.DEFAULT_BRIDGE_MODE, "off");
});

test("R2.5-a: resolveBridgeMode parses env values correctly", () => {
  assert.equal(c.resolveBridgeMode({}), "off");
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "" }), "off");
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "off" }), "off");
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "report" }), "report");
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "dispatch" }), "dispatch");
  // Whitespace + casing tolerance.
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "  REPORT " }), "report");
  // Unrecognized falls back to default (safe).
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "yolo" }), "off");
  assert.equal(c.resolveBridgeMode({ ORCHESTRATOR_REMOTE_BRIDGE_MODE: "true" }), "off");
});

// ── Audit verbs ────────────────────────────────────────────────────

test("R2.5-a: AUDIT_VERBS has exactly the R2.5-narrated lifecycle", () => {
  assert.deepEqual(
    [...c.AUDIT_VERBS].sort(),
    [
      "runner_hook_dispatch_error",
      "runner_hook_dispatched",
      "runner_hook_rejected",
      "runner_hook_routed",
      "runner_hook_sanitized",
    ],
  );
});

test("R2.5-a: AUDIT_VERBS preserves R1-k2's runner_hook_routed for backward compat", () => {
  // R2 deployments grep for `runner_hook_routed`; R2.5 must keep
  // emitting it on every accepted frame. Don't rename without a
  // migration story.
  assert.ok(c.AUDIT_VERBS.includes("runner_hook_routed"));
});

// ── Reject reasons ─────────────────────────────────────────────────

test("R2.5-a: REJECT_REASONS covers every gate the validator can fire", () => {
  // Pin the set so a future contributor adding a new reject path
  // either reuses an existing reason or extends this constant. The
  // operator-facing vocabulary stays bounded.
  assert.deepEqual(
    [...c.REJECT_REASONS].sort(),
    [
      "data_invalid_type",
      "data_required_missing",
      "frame_malformed",
      "hook_missing",
      "hook_not_allowed",
      "response_oversize",
      "tool_not_allowed",
      "tool_required_missing",
    ],
  );
});

// ── Cross-references ───────────────────────────────────────────────

test("R2.5-a: every dataKey in dataKeysRequired is also listed in dataKeys", () => {
  // A required key that's not also "allowed" would be impossible to
  // satisfy; fail loud here rather than at runtime.
  for (const hook of c.ALLOWED_HOOKS) {
    const schema = c.PAYLOAD_SCHEMAS[hook];
    for (const required of schema.dataKeysRequired) {
      assert.ok(schema.dataKeys.includes(required),
        `${hook}.dataKeysRequired contains ${required} which is not in dataKeys`);
    }
  }
});
