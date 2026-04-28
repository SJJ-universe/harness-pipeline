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

// ── Slice R1-a (Phase D Round MH, 2026-04-28): envelope `origin` field ─
//
// MF1 §3.1: optional top-level `origin` carrying remote-execution metadata.
// Must be omitted when absent (preserves byte-identical local-mode shape)
// and hoisted from event.data.origin when present (raw event path) or
// carried from event.origin (already-envelope path).

test("R1-a: normalize omits `origin` when input has none (local default)", () => {
  const env = normalize({ type: "phase_update", data: { runId: "A", phase: "B" } });
  assert.equal(env.type, "phase_update");
  assert.equal(env.runId, "A");
  // Hard assertion: NO `origin` key on the envelope. byte-identical to today.
  assert.equal(Object.prototype.hasOwnProperty.call(env, "origin"), false,
    "local-mode events MUST NOT add an origin key — MF1 §3.4 invariant 1");
});

test("R1-a: normalize hoists `origin` from event.data.origin (raw remote event)", () => {
  const env = normalize({
    type: "phase_update",
    data: {
      runId: "A",
      phase: "B",
      origin: {
        runOrigin: "container-remote",
        sandboxClass: "container-strict",
        hostIdentity: "runner-pool-a/3",
        isolationStatus: "healthy",
      },
    },
  });
  assert.ok(env.origin, "origin field present");
  assert.equal(env.origin.runOrigin, "container-remote");
  assert.equal(env.origin.sandboxClass, "container-strict");
  assert.equal(env.origin.hostIdentity, "runner-pool-a/3");
  assert.equal(env.origin.isolationStatus, "healthy");
});

test("R1-a: normalize carries `origin` on already-envelope idempotent path", () => {
  const input = {
    type: "phase_update",
    runId: "A",
    ts: 1700000000000,
    scope: "phase",
    summary: "phase_update B",
    payload: { phase: "B" },
    origin: {
      runOrigin: "container-local",
      sandboxClass: "container-strict",
      hostIdentity: "local-runner-1",
      isolationStatus: "healthy",
    },
  };
  const env = normalize(input);
  assert.ok(env.origin);
  assert.equal(env.origin.runOrigin, "container-local");
  assert.equal(env.origin.sandboxClass, "container-strict");
  assert.equal(env.origin.hostIdentity, "local-runner-1");
});

test("R1-a: normalize accepts partial `origin` and copies only known string keys", () => {
  // Partial origin (only some fields): we still copy the present ones and
  // attach the field. Future schema additions go through this gate explicitly.
  const env = normalize({
    type: "phase_update",
    data: { runId: "A", origin: { runOrigin: "container-remote", sandboxClass: 42 } },
  });
  assert.ok(env.origin, "partial origin still attached");
  assert.equal(env.origin.runOrigin, "container-remote");
  // Non-string sandboxClass is dropped by the strict validator.
  assert.equal(Object.prototype.hasOwnProperty.call(env.origin, "sandboxClass"), false);
});

test("R1-a: normalize ignores non-object `origin` (defensive: attacker-supplied)", () => {
  const env = normalize({
    type: "phase_update",
    data: { runId: "A", origin: "container-remote" },  // wrong type
  });
  assert.equal(Object.prototype.hasOwnProperty.call(env, "origin"), false,
    "non-object origin is silently dropped");
});

test("R1-a: normalize prefers event.origin over event.data.origin (envelope-shape input)", () => {
  // When the input has both top-level origin AND data.origin, the top-level
  // wins — it's the canonical envelope shape; data.origin is the raw-event
  // shape. The idempotent path takes top-level first.
  const env = normalize({
    type: "phase_update",
    scope: "phase",
    runId: "A",
    payload: { phase: "B" },
    origin: { runOrigin: "container-remote", sandboxClass: "container-strict",
              hostIdentity: "h-top", isolationStatus: "healthy" },
    data: { origin: { runOrigin: "vm-remote", sandboxClass: "vm-strict",
                       hostIdentity: "h-data", isolationStatus: "lost" } },
  });
  assert.equal(env.origin.runOrigin, "container-remote",
    "top-level origin wins over data.origin on the envelope path");
  assert.equal(env.origin.hostIdentity, "h-top");
});

test("R1-a: normalizeAll preserves `origin` per-element (mixed local + remote)", () => {
  const out = normalizeAll([
    { type: "phase_update", data: { runId: "A", phase: "B" } },             // local
    { type: "phase_update", data: { runId: "B", phase: "C", origin: {
        runOrigin: "container-remote", sandboxClass: "container-strict",
        hostIdentity: "h-2", isolationStatus: "healthy" } } },              // remote
  ]);
  assert.equal(out.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], "origin"), false,
    "local element keeps no origin");
  assert.ok(out[1].origin && out[1].origin.runOrigin === "container-remote",
    "remote element keeps its origin");
});
