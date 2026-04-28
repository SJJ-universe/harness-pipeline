// Slice R2.5-b (Phase D R2.5, 2026-04-28) — sanitizer unit tests.
//
// Cover every reject-reason path + the happy path for each ALLOWED_HOOK.
// The sanitizer is a pure function; these tests are fast (no I/O).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeRemoteHook } = require("../../src/runtime/remoteHookSanitizer");
const {
  REJECT_REASONS,
  PAYLOAD_SCHEMAS,
} = require("../../src/runtime/remoteHookBridgeContract");

// ── Reject paths ──────────────────────────────────────────────────

test("R2.5-b: frame_malformed when event is null/undefined/non-object", () => {
  for (const bad of [null, undefined, 7, "hook", []]) {
    const r = sanitizeRemoteHook(bad);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "frame_malformed");
  }
});

test("R2.5-b: hook_missing when event.hook absent or non-string", () => {
  for (const bad of [{}, { hook: null }, { hook: 42 }, { hook: "" }]) {
    const r = sanitizeRemoteHook(bad);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "hook_missing");
  }
});

test("R2.5-b: hook_not_allowed for hooks outside the allowlist", () => {
  for (const banned of ["SessionStart", "Notification", "PreCompact", "Custom"]) {
    const r = sanitizeRemoteHook({ hook: banned, tool: "Read" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "hook_not_allowed");
  }
});

test("R2.5-b: tool_required_missing for PreToolUse / PostToolUse without a tool", () => {
  for (const hook of ["PreToolUse", "PostToolUse"]) {
    const r = sanitizeRemoteHook({ hook });
    assert.equal(r.ok, false, `${hook} without tool should reject`);
    assert.equal(r.reason, "tool_required_missing");
  }
});

test("R2.5-b: tool_not_allowed for write-side tools", () => {
  for (const banned of ["Bash", "Write", "Edit", "WebFetch"]) {
    const r = sanitizeRemoteHook({ hook: "PreToolUse", tool: banned });
    assert.equal(r.ok, false, `tool=${banned} should reject`);
    assert.equal(r.reason, "tool_not_allowed");
  }
});

test("R2.5-b: data_invalid_type when event.data is not an object", () => {
  for (const bad of ["str", 7, true, []]) {
    const r = sanitizeRemoteHook({ hook: "Stop", data: bad });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "data_invalid_type");
  }
});

test("R2.5-b: data_required_missing for SubagentStart without agent_id", () => {
  for (const bad of [
    { hook: "SubagentStart" },                     // no data
    { hook: "SubagentStart", data: {} },           // empty data
    { hook: "SubagentStart", data: { parent_id: "p" } }, // wrong key
    { hook: "SubagentStart", data: { agent_id: "" } },   // empty value
  ]) {
    const r = sanitizeRemoteHook(bad);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "data_required_missing");
  }
});

test("R2.5-b: data_required_missing for SubagentStop without agent_id", () => {
  const r = sanitizeRemoteHook({ hook: "SubagentStop", data: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "data_required_missing");
});

test("R2.5-b: response_oversize for PostToolUse with response > responseMaxBytes", () => {
  const big = "x".repeat(PAYLOAD_SCHEMAS.PostToolUse.responseMaxBytes + 100);
  const r = sanitizeRemoteHook({
    hook: "PostToolUse",
    tool: "Read",
    response: { body: big },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "response_oversize");
});

// ── Happy paths ───────────────────────────────────────────────────

test("R2.5-b: PreToolUse Read happy path produces sanitized {hook, tool, _data}", () => {
  const r = sanitizeRemoteHook({
    hook: "PreToolUse",
    tool: "Read",
    data: { file_path: "/work/in/foo.txt", limit: 100, offset: 0 },
  });
  assert.equal(r.ok, true);
  assert.equal(r.sanitized.hook, "PreToolUse");
  assert.equal(r.sanitized.tool, "Read");
  assert.deepEqual(r.sanitized._data, {
    file_path: "/work/in/foo.txt", limit: 100, offset: 0,
  });
  assert.equal(r.sanitized.response, null);
});

test("R2.5-b: defensive copy drops every key NOT in the allowlist", () => {
  // Operator-side attackers might try to smuggle extra fields hoping
  // the executor honors them (e.g. credentials, paths outside repo).
  // The defensive copy MUST drop everything not explicitly listed.
  const r = sanitizeRemoteHook({
    hook: "PreToolUse",
    tool: "Read",
    data: {
      file_path: "/legit",
      __proto__: { polluted: true },     // prototype pollution
      cmd: "rm -rf /",                   // attacker-injected
      headers: { Authorization: "leak" },
      response: { body: "X" },           // confused with PostTool
      session_id: "ses-1",
    },
  });
  assert.equal(r.ok, true);
  // file_path + session_id ALLOWED; everything else dropped.
  assert.deepEqual(Object.keys(r.sanitized._data).sort(),
    ["file_path", "session_id"]);
  // Prototype pollution check.
  assert.notEqual(r.sanitized._data.polluted, true);
  assert.notEqual(({}).polluted, true, "global prototype must not pollute");
});

test("R2.5-b: PostToolUse with sized response passes through", () => {
  const small = "x".repeat(100);
  const r = sanitizeRemoteHook({
    hook: "PostToolUse",
    tool: "Read",
    data: { file_path: "/x" },
    response: { body: small, exit: 0 },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sanitized.response, { body: small, exit: 0 });
});

test("R2.5-b: PostToolUse response is re-parsed (no aliasing into caller)", () => {
  // The caller might mutate sanitized.response after dispatch; the
  // sanitizer guarantees the response is a fresh object so the
  // caller's mutation can't leak back into the original frame.
  const original = { result: "ok" };
  const r = sanitizeRemoteHook({
    hook: "PostToolUse",
    tool: "Read",
    response: original,
  });
  assert.equal(r.ok, true);
  assert.notStrictEqual(r.sanitized.response, original,
    "sanitized.response must be a different object reference");
  r.sanitized.response.tampered = true;
  assert.notEqual(original.tampered, true);
});

test("R2.5-b: Stop happy path — no tool, optional session_id only", () => {
  const r = sanitizeRemoteHook({ hook: "Stop", data: { session_id: "s1" } });
  assert.equal(r.ok, true);
  assert.equal(r.sanitized.tool, null);
  assert.deepEqual(r.sanitized._data, { session_id: "s1" });
});

test("R2.5-b: Stop accepts absent data (treats as empty)", () => {
  const r = sanitizeRemoteHook({ hook: "Stop" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sanitized._data, {});
});

test("R2.5-b: Stop accepts data: null (defensively coerced to {})", () => {
  const r = sanitizeRemoteHook({ hook: "Stop", data: null });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sanitized._data, {});
});

test("R2.5-b: SubagentStart happy path with agent_id + agent_type", () => {
  const r = sanitizeRemoteHook({
    hook: "SubagentStart",
    data: { agent_id: "a-1", agent_type: "claude", parent_id: "p-1" },
  });
  assert.equal(r.ok, true);
  assert.equal(r.sanitized.hook, "SubagentStart");
  assert.deepEqual(r.sanitized._data, {
    agent_id: "a-1", agent_type: "claude", parent_id: "p-1",
  });
});

test("R2.5-b: SubagentStop happy path", () => {
  const r = sanitizeRemoteHook({
    hook: "SubagentStop",
    data: { agent_id: "a-1", session_id: "s-1" },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.sanitized._data, { agent_id: "a-1", session_id: "s-1" });
});

// ── Reject reasons stay within the frozen vocabulary ──────────────

test("R2.5-b: every emitted reason is in REJECT_REASONS", () => {
  // Drive a few representative bad inputs and check the reason fields
  // never escape the contract's frozen vocabulary.
  const badInputs = [
    null,
    {},
    { hook: "Custom" },
    { hook: "PreToolUse" },
    { hook: "PreToolUse", tool: "Bash" },
    { hook: "Stop", data: 7 },
    { hook: "SubagentStart", data: {} },
    {
      hook: "PostToolUse", tool: "Read",
      response: { body: "z".repeat(PAYLOAD_SCHEMAS.PostToolUse.responseMaxBytes + 1) },
    },
  ];
  for (const input of badInputs) {
    const r = sanitizeRemoteHook(input);
    if (!r.ok) {
      assert.ok(REJECT_REASONS.includes(r.reason),
        `unexpected reason: ${r.reason}`);
    }
  }
});
