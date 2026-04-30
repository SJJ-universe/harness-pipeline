// Slice UI-H3 (Phase D / Phase E1.5, 2026-04-30) — event-filters tests.
//
// Pure helpers; tests pin every input edge.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ef = require("../../public/js/monitor/event-filters");
const {
  filterEventsByScope,
  filterEventsByRunner,
  filterEventsByLabel,
  tailEvents,
  envelopeToLine,
} = ef;

// ── Fixtures ──────────────────────────────────────────────────────

const sampleEvents = [
  { type: "claude_stream_chunk", scope: "claude", payload: { runner: "claude", chunk: "hello" } },
  { type: "codex_stream_chunk",  scope: "codex",  payload: { runner: "codex",  chunk: "world" } },
  { type: "tool_recorded",       scope: "tool",   payload: { tool: "Read", file_path: "/x" } },
  { type: "verify_finished",     scope: "verify", payload: { result: "pass" } },
  { type: "phase_update",        scope: "phase",  payload: { phase: "execute" } },
  { type: "audit_appended",      scope: "audit",  payload: { verb: "x" } },
  { type: "claude_stream_chunk", scope: "claude", payload: { runner: "claude", chunk: "world" } },
];

// ── filterEventsByScope ──────────────────────────────────────────

test("UI-H3: filterEventsByScope returns matching scope only", () => {
  const out = filterEventsByScope(sampleEvents, "claude");
  assert.equal(out.length, 2);
  out.forEach((e) => assert.equal(e.scope, "claude"));
});

test("UI-H3: filterEventsByScope returns empty for unknown scope", () => {
  assert.deepEqual(filterEventsByScope(sampleEvents, "unknown"), []);
});

test("UI-H3: filterEventsByScope handles garbage input", () => {
  assert.deepEqual(filterEventsByScope(null, "claude"), []);
  assert.deepEqual(filterEventsByScope(undefined, "claude"), []);
  assert.deepEqual(filterEventsByScope("not array", "claude"), []);
  assert.deepEqual(filterEventsByScope(sampleEvents, null), []);
  assert.deepEqual(filterEventsByScope(sampleEvents, ""), []);
  assert.deepEqual(filterEventsByScope(sampleEvents, 42), []);
});

test("UI-H3: filterEventsByScope skips non-object entries", () => {
  const dirty = [...sampleEvents, null, undefined, "wat", 0];
  const out = filterEventsByScope(dirty, "claude");
  assert.equal(out.length, 2);
});

// ── filterEventsByRunner ─────────────────────────────────────────

test("UI-H3: filterEventsByRunner returns events whose payload.runner matches", () => {
  const out = filterEventsByRunner(sampleEvents, "codex");
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.runner, "codex");
});

test("UI-H3: filterEventsByRunner returns empty for unknown runner", () => {
  assert.deepEqual(filterEventsByRunner(sampleEvents, "verifier"), []);
});

test("UI-H3: filterEventsByRunner ignores events without payload.runner", () => {
  // tool_recorded has payload but no runner — must be excluded
  const out = filterEventsByRunner(sampleEvents, "Read");
  assert.equal(out.length, 0);
});

test("UI-H3: filterEventsByRunner handles garbage input", () => {
  assert.deepEqual(filterEventsByRunner(null, "claude"), []);
  assert.deepEqual(filterEventsByRunner(sampleEvents, ""), []);
});

// ── filterEventsByLabel (combined) ───────────────────────────────

test("UI-H3: filterEventsByLabel matches by scope OR payload.runner", () => {
  const out = filterEventsByLabel(sampleEvents, "claude");
  assert.equal(out.length, 2);  // both scope=claude AND payload.runner=claude
});

test("UI-H3: filterEventsByLabel accepts an array of matchers (union)", () => {
  const out = filterEventsByLabel(sampleEvents, ["claude", "codex"]);
  assert.equal(out.length, 3);
});

test("UI-H3: filterEventsByLabel deduplicates per-event (an event matched by multiple labels appears once)", () => {
  // claude scope + claude runner — same event, must not duplicate.
  const out = filterEventsByLabel(sampleEvents, ["claude"]);
  // 2 claude entries; both unique events
  assert.equal(out.length, 2);
});

test("UI-H3: filterEventsByLabel returns empty for empty matchers", () => {
  assert.deepEqual(filterEventsByLabel(sampleEvents, []), []);
  assert.deepEqual(filterEventsByLabel(sampleEvents, ""), []);
  assert.deepEqual(filterEventsByLabel(sampleEvents, null), []);
});

// ── tailEvents ───────────────────────────────────────────────────

test("UI-H3: tailEvents returns last N entries", () => {
  const all = [1, 2, 3, 4, 5];
  assert.deepEqual(tailEvents(all, 2), [4, 5]);
  assert.deepEqual(tailEvents(all, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(tailEvents(all, 100), [1, 2, 3, 4, 5]);
});

test("UI-H3: tailEvents handles garbage input", () => {
  assert.deepEqual(tailEvents(null, 5), []);
  assert.deepEqual(tailEvents([1, 2, 3], 0), []);
  assert.deepEqual(tailEvents([1, 2, 3], -1), []);
  assert.deepEqual(tailEvents([1, 2, 3], "hi"), []);
  assert.deepEqual(tailEvents([1, 2, 3], NaN), []);
});

test("UI-H3: tailEvents returns a copy (caller mutation safe)", () => {
  const arr = [1, 2, 3];
  const out = tailEvents(arr, 100);
  out.push(99);
  assert.deepEqual(arr, [1, 2, 3]);
});

// ── envelopeToLine ───────────────────────────────────────────────

test("UI-H3: envelopeToLine prefers payload.chunk", () => {
  assert.equal(envelopeToLine({ payload: { chunk: "hi" } }), "hi");
});

test("UI-H3: envelopeToLine falls through chunk → text → message → summary → type", () => {
  assert.equal(envelopeToLine({ payload: { text: "fallback" } }), "fallback");
  assert.equal(envelopeToLine({ payload: { message: "msg" } }), "msg");
  assert.equal(envelopeToLine({ summary: "sum" }), "sum");
  assert.equal(envelopeToLine({ type: "phase_update" }), "phase_update");
});

test("UI-H3: envelopeToLine handles garbage input", () => {
  assert.equal(envelopeToLine(null), "");
  assert.equal(envelopeToLine(undefined), "");
  assert.equal(envelopeToLine({}), "");
  assert.equal(envelopeToLine({ payload: { chunk: "" } }), "",
    "empty chunk falls through to type which is also empty → ''");
});

test("UI-H3: envelopeToLine prefers chunk over text/message even when text exists", () => {
  // Defensive: chunk wins over other fields if both present.
  const env = {
    payload: { chunk: "win", text: "lose", message: "no" },
    summary: "no",
    type: "no",
  };
  assert.equal(envelopeToLine(env), "win");
});
