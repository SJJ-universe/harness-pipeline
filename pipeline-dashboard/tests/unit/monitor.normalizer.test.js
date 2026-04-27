// Slice MA1 (Phase D, 2026-04-27) — HarnessMonitorNormalizer unit tests.
//
// The normalizer translates raw broadcast events into the canonical
// envelope `{ type, runId, ts, scope, summary, payload }`. These tests
// lock down the contract for every event family the dashboard already
// handles, plus the global / unknown / idempotency edge cases.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalize,
  normalizeAll,
  isGlobalType,
  scopeOf,
  SCOPE_BY_TYPE,
  GLOBAL_TYPES,
} = require("../../public/js/monitor/normalizer");

// ── happy path: pipeline / phase / tool / gate / codex / subagent / child ─

test("normalize pipeline_start → scope:pipeline + runId carried", () => {
  const env = normalize({ type: "pipeline_start", data: { runId: "A", mode: "live" } });
  assert.equal(env.type, "pipeline_start");
  assert.equal(env.runId, "A");
  assert.equal(env.scope, "pipeline");
  assert.equal(env.payload.mode, "live");
  assert.ok(env.ts > 0);
});

test("normalize phase_update → scope:phase + summary contains phase + status", () => {
  const env = normalize({ type: "phase_update", data: { runId: "A", phase: "B", status: "active" } });
  assert.equal(env.scope, "phase");
  assert.match(env.summary, /phase_update B active/);
});

test("normalize tool_recorded → scope:tool + summary contains tool name", () => {
  const env = normalize({ type: "tool_recorded", data: { runId: "A", tool: "Edit" } });
  assert.equal(env.scope, "tool");
  assert.match(env.summary, /tool_recorded Edit/);
});

test("normalize gate_failed → scope:gate", () => {
  const env = normalize({ type: "gate_failed", data: { runId: "A", phase: "C", reason: "x" } });
  assert.equal(env.scope, "gate");
});

test("normalize codex_progress → scope:codex", () => {
  const env = normalize({ type: "codex_progress", data: { runId: "A", phase: "C", elapsedMs: 1000 } });
  assert.equal(env.scope, "codex");
});

test("normalize subagent_started → scope:subagent + summary identifies session", () => {
  const env = normalize({
    type: "subagent_started",
    data: { runId: "A", session_id: "sub-1", agent_type: "codex" },
  });
  assert.equal(env.scope, "subagent");
  assert.match(env.summary, /subagent_started sub-1/);
});

test("normalize child_registered → scope:global (broadcast everywhere)", () => {
  const env = normalize({ type: "child_registered", data: { pid: 42, label: "claude" } });
  assert.equal(env.scope, "global", "child_registered is on the GLOBAL_TYPES list");
  assert.match(env.summary, /child_registered claude\/42/);
});

test("normalize child_kill_all → scope:global + summary has signal + count", () => {
  const env = normalize({
    type: "child_kill_all",
    data: { signal: "SIGTERM", count: 3, active: 3, at: 12345 },
  });
  assert.equal(env.scope, "global");
  assert.match(env.summary, /child_kill_all SIGTERM count=3/);
});

test("normalize child_queue_depth surfaces inFlight + waiting in summary", () => {
  const env = normalize({
    type: "child_queue_depth",
    data: { inFlight: 2, waiting: 1, max: 2, at: 1, event: "enqueue" },
  });
  assert.equal(env.scope, "global");
  assert.match(env.summary, /child_queue inFlight=2 waiting=1/);
});

// ── global vs scoped event distinction ─────────────────────────────────

test("toast / hook_event / context_alarm are GLOBAL_TYPES", () => {
  assert.ok(GLOBAL_TYPES.has("toast"));
  assert.ok(GLOBAL_TYPES.has("hook_event"));
  assert.ok(GLOBAL_TYPES.has("context_alarm"));
});

test("isGlobalType helper returns true/false correctly", () => {
  assert.equal(isGlobalType("toast"), true);
  assert.equal(isGlobalType("phase_update"), false);
  assert.equal(isGlobalType("totally-made-up"), false);
});

test("global event normalisation uses scope:global even when runId is provided", () => {
  // If a future producer attaches runId to a global event we still
  // honor that (so per-tab views can show it), but the scope stays
  // "global" so consumers know it's broadcastable.
  const env = normalize({ type: "toast", data: { runId: "A", message: "hi" } });
  assert.equal(env.scope, "global");
  assert.equal(env.runId, "A");
});

test("global event with no runId yields runId:null", () => {
  const env = normalize({ type: "toast", data: { message: "hi" } });
  assert.equal(env.runId, null);
});

// ── unknown / unhandled types ─────────────────────────────────────────

test("normalize keeps unknown event types under scope:unknown", () => {
  const env = normalize({ type: "totally-made-up", data: { runId: "A", x: 1 } });
  assert.equal(env.type, "totally-made-up");
  assert.equal(env.scope, "unknown");
  assert.equal(env.runId, "A");
  assert.equal(env.payload.x, 1);
});

// ── input validation ──────────────────────────────────────────────────

test("normalize returns null for nullish / non-object / typeless input", () => {
  assert.equal(normalize(null), null);
  assert.equal(normalize(undefined), null);
  assert.equal(normalize("ping"), null);
  assert.equal(normalize(42), null);
  assert.equal(normalize({}), null, "no `type` field → not normalisable");
  assert.equal(normalize({ type: 42 }), null, "non-string type rejected");
});

test("normalize tolerates missing data / non-object data", () => {
  const a = normalize({ type: "phase_update" });
  assert.equal(a.scope, "phase");
  assert.deepEqual(a.payload, {});
  const b = normalize({ type: "phase_update", data: "garbage" });
  assert.equal(b.scope, "phase");
  assert.deepEqual(b.payload, {});
});

// ── idempotency ───────────────────────────────────────────────────────

test("normalize is idempotent on already-an-envelope input", () => {
  const env = normalize({ type: "phase_update", data: { runId: "A", phase: "B" } });
  const again = normalize(env);
  assert.equal(again.type, env.type);
  assert.equal(again.scope, env.scope);
  assert.equal(again.runId, env.runId);
  assert.deepEqual(again.payload, env.payload);
});

// ── timestamp choice ──────────────────────────────────────────────────

test("normalize prefers data.at, then data.ts, else Date.now()", () => {
  const a = normalize({ type: "child_kill_all", data: { signal: "X", at: 555 } });
  assert.equal(a.ts, 555);
  const b = normalize({ type: "phase_update", data: { runId: "A", ts: 999 } });
  assert.equal(b.ts, 999);
  const c = normalize({ type: "phase_update", data: { runId: "A" } });
  assert.ok(c.ts >= 0);
});

// ── normalizeAll batch ────────────────────────────────────────────────

test("normalizeAll skips non-normalizable entries", () => {
  const out = normalizeAll([
    { type: "phase_update", data: { runId: "A", phase: "B" } },
    null,
    "skip",
    { type: "toast", data: { message: "ok" } },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].scope, "phase");
  assert.equal(out[1].scope, "global");
});

test("normalizeAll on non-array returns empty list", () => {
  assert.deepEqual(normalizeAll(null), []);
  assert.deepEqual(normalizeAll("nope"), []);
  assert.deepEqual(normalizeAll(undefined), []);
});

// ── scopeOf helper ────────────────────────────────────────────────────

test("scopeOf returns the same value as the SCOPE_BY_TYPE table", () => {
  for (const [type, expected] of Object.entries(SCOPE_BY_TYPE)) {
    assert.equal(scopeOf(type), expected, "scopeOf(" + type + ")");
  }
  assert.equal(scopeOf("absent"), "unknown");
});
