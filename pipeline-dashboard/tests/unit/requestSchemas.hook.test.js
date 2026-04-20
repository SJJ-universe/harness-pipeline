// Slice A (v4) — ALLOWED_HOOK_EVENTS expansion regression.
//
// The five extra Claude Code lifecycle aliases (session-start, subagent-start,
// subagent-stop, notification, pre-compact) are what makes the rest of Slice A
// reachable from /api/hook. If this file ever starts failing, the hook surface
// has silently regressed and /api/hook will start 400ing on new events.

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateHook } = require("../../src/security/requestSchemas");

const NEW_EVENTS = [
  "session-start",
  "subagent-start",
  "subagent-stop",
  "notification",
  "pre-compact",
];

const LEGACY_EVENTS = ["user-prompt", "pre-tool", "post-tool", "stop", "session-end"];

test("validateHook still accepts the original 5 hook aliases", () => {
  for (const event of LEGACY_EVENTS) {
    const parsed = validateHook({ event, payload: {} });
    assert.equal(parsed.event, event);
  }
});

test("validateHook accepts the 5 new lifecycle aliases (Slice A v4)", () => {
  for (const event of NEW_EVENTS) {
    const parsed = validateHook({ event, payload: {} });
    assert.equal(parsed.event, event, `expected ${event} to be allowed`);
  }
});

test("validateHook rejects unknown events and canonical PascalCase names", () => {
  assert.throws(() => validateHook({ event: "unknown", payload: {} }), /not allowed/);
  // Canonical Claude Code event names are PascalCase — we translate them to
  // kebab-case aliases in harness-hook.js / settings.json, and only the
  // kebab-case form is valid at /api/hook.
  assert.throws(() => validateHook({ event: "SessionStart", payload: {} }), /not allowed/);
  assert.throws(() => validateHook({ event: "PreCompact", payload: {} }), /not allowed/);
});

test("validateHook requires a non-empty event string", () => {
  assert.throws(() => validateHook({ payload: {} }), /missing event/);
  assert.throws(() => validateHook({ event: "", payload: {} }), /missing event/);
});

test("validateHook returns empty payload when omitted", () => {
  const parsed = validateHook({ event: "pre-compact" });
  assert.deepEqual(parsed.payload, {});
});
