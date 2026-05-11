// Slice UI-H4 (Phase D / Phase E1.5, 2026-04-30) — review session manager tests.
//
// Pins state machine transitions + audit/broadcast emissions +
// defensive input handling.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ReviewSessionManager,
  STATES,
  AUDIT_VERBS,
  BROADCAST_TYPES,
  MAX_INSTRUCTION_LENGTH,
} = require("../../src/runtime/reviewSessionManager");

// ── Test orchestrator ──────────────────────────────────────────────────

function makeHarness(opts = {}) {
  let now = 1_000_000_000;
  let nextId = 1;
  const audits = [];
  const broadcasts = [];
  const manager = new ReviewSessionManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    broadcastFn: (type, data) => broadcasts.push({ type, data }),
    clockFn: () => now,
    idFn: () => "session-" + (nextId++),
    ...opts,
  });
  return {
    manager, audits, broadcasts,
    advanceClock(ms) { now += ms; },
    setClock(t) { now = t; },
    clock() { return now; },
  };
}

// ── Constants ─────────────────────────────────────────────────────

test("UI-H4: STATES exposes all 6 lifecycle states + frozen", () => {
  assert.equal(STATES.CREATED, "created");
  assert.equal(STATES.AWAITING_CRITIQUE, "awaiting_critique");
  assert.equal(STATES.CRITIQUE_RECEIVED, "critique_received");
  assert.equal(STATES.AWAITING_CLAUDE, "awaiting_claude");
  assert.equal(STATES.CLAUDE_RECEIVED, "claude_received");
  assert.equal(STATES.ARCHIVED, "archived");
  assert.ok(Object.isFrozen(STATES));
});

test("UI-H4: AUDIT_VERBS frozen + every verb starts with review_session_", () => {
  assert.ok(Object.isFrozen(AUDIT_VERBS));
  AUDIT_VERBS.forEach((v) => {
    assert.ok(v.startsWith("review_session_"), `${v} must use review_session_ prefix`);
  });
});

test("UI-H4: BROADCAST_TYPES frozen", () => {
  assert.ok(Object.isFrozen(BROADCAST_TYPES));
  // Spot-check the critical types
  assert.ok(BROADCAST_TYPES.includes("review_session_created"));
  assert.ok(BROADCAST_TYPES.includes("claude_stream_chunk"));
  assert.ok(BROADCAST_TYPES.includes("codex_stream_chunk"));
});

// ── create() ──────────────────────────────────────────────────────

test("UI-H4: create() returns a session with state=created + audit + broadcast", () => {
  const h = makeHarness();
  const session = h.manager.create({ source: "selected_run", runId: "r1", label: "Test" });
  assert.equal(session.state, "created");
  assert.equal(session.source, "selected_run");
  assert.equal(session.runId, "r1");
  assert.equal(session.label, "Test");
  assert.equal(session.history.length, 0);
  assert.equal(typeof session.sessionId, "string");
  assert.equal(session.createdAt, 1_000_000_000);

  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].verb, "review_session_created");
  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.broadcasts[0].type, "review_session_created");
});

test("UI-H4: create() defaults source to 'manual' + null runId/label", () => {
  const h = makeHarness();
  const s = h.manager.create();
  assert.equal(s.source, "manual");
  assert.equal(s.runId, null);
  assert.equal(s.label, null);
});

test("UI-H4: create() truncates oversize initialPlan", () => {
  const h = makeHarness();
  const long = "a".repeat(MAX_INSTRUCTION_LENGTH + 100);
  const s = h.manager.create({ initialPlan: long });
  assert.equal(s.initialPlan.length, MAX_INSTRUCTION_LENGTH);
});

// ── sendCodex() ───────────────────────────────────────────────────

test("UI-H4: sendCodex transitions created → awaiting_critique + audit + broadcast", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.advanceClock(100);
  const next = h.manager.sendCodex(s.sessionId, { instruction: "review the plan" });
  assert.equal(next.state, "awaiting_critique");
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].kind, "send_codex");
  assert.equal(next.history[0].text, "review the plan");

  // Audit + broadcast
  const auditVerbs = h.audits.map((a) => a.verb);
  assert.ok(auditVerbs.includes("review_session_send_codex"));
});

test("UI-H4: sendCodex requires non-empty instruction", () => {
  const h = makeHarness();
  const s = h.manager.create();
  assert.throws(() => h.manager.sendCodex(s.sessionId, {}), /instruction\/question required/);
  assert.throws(() => h.manager.sendCodex(s.sessionId, { instruction: "" }), /instruction\/question required/);
});

test("UI-H4: sendCodex requires valid sessionId", () => {
  const h = makeHarness();
  assert.throws(() => h.manager.sendCodex("ghost", { instruction: "x" }), /not_found/);
  assert.throws(() => h.manager.sendCodex("", { instruction: "x" }), /invalid_id|required/i);
});

test("UI-H4: sendCodex from non-startable state throws", () => {
  const h = makeHarness();
  const s = h.manager.create();
  // Advance to awaiting_critique
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  // Sending again from awaiting_critique should throw
  assert.throws(
    () => h.manager.sendCodex(s.sessionId, { instruction: "again" }),
    /invalid_state/i,
  );
});

// ── recordCritiqueReceived() ─────────────────────────────────────

test("UI-H4: recordCritiqueReceived transitions to critique_received + emits broadcast", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  const next = h.manager.recordCritiqueReceived(s.sessionId, {
    summary: "Looks ok",
    severityCounts: { critical: 0, high: 1, medium: 0 },
  });
  assert.equal(next.state, "critique_received");
  assert.equal(next.history.find((h) => h.kind === "critique_received").summary, "Looks ok");
  assert.ok(h.broadcasts.find((b) => b.type === "critique_received"));
});

// ── followUp() ────────────────────────────────────────────────────

test("UI-H4: followUp records operator question to history", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  h.manager.recordCritiqueReceived(s.sessionId, { summary: "ok" });
  const next = h.manager.followUp(s.sessionId, {
    question: "What about edge cases?", target: "codex",
  });
  const fu = next.history.find((h) => h.kind === "follow_up");
  assert.ok(fu);
  assert.equal(fu.target, "codex");
  assert.equal(fu.text, "What about edge cases?");
});

test("UI-H4: followUp from CREATED state throws (must send to codex first)", () => {
  const h = makeHarness();
  const s = h.manager.create();
  assert.throws(
    () => h.manager.followUp(s.sessionId, { question: "x", target: "codex" }),
    /invalid_state/i,
  );
});

test("UI-H4: followUp default target is 'codex'", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  const next = h.manager.followUp(s.sessionId, { question: "more?" });
  assert.equal(next.history.find((h) => h.kind === "follow_up").target, "codex");
});

// ── handBackClaude() ──────────────────────────────────────────────

test("UI-H4: handBackClaude transitions to awaiting_claude + emits handoff broadcast", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  h.manager.recordCritiqueReceived(s.sessionId, { summary: "ok" });
  const next = h.manager.handBackClaude(s.sessionId, {
    instruction: "Apply the critique",
    includeCritique: true,
  });
  assert.equal(next.state, "awaiting_claude");
  assert.equal(next.history.find((h) => h.kind === "hand_back_claude").includeCritique, true);
  assert.ok(h.broadcasts.find((b) => b.type === "handoff_to_claude_requested"));
});

test("UI-H4: handBackClaude from CREATED throws", () => {
  const h = makeHarness();
  const s = h.manager.create();
  assert.throws(
    () => h.manager.handBackClaude(s.sessionId, { instruction: "go" }),
    /invalid_state/i,
  );
});

// ── recordClaudeReceived() ───────────────────────────────────────

test("UI-H4: recordClaudeReceived transitions to claude_received + emits handoff_completed", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  h.manager.recordCritiqueReceived(s.sessionId, { summary: "ok" });
  h.manager.handBackClaude(s.sessionId, { instruction: "x" });
  const next = h.manager.recordClaudeReceived(s.sessionId, { summary: "Done" });
  assert.equal(next.state, "claude_received");
  assert.ok(h.broadcasts.find((b) => b.type === "handoff_to_claude_completed"));
});

// ── Stream chunks ────────────────────────────────────────────────

test("UI-H4: recordCodexChunk emits codex_stream_chunk broadcast with monotonic seq", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  h.manager.recordCodexChunk(s.sessionId, { text: "first chunk" });
  h.manager.recordCodexChunk(s.sessionId, { text: "second chunk" });

  const chunks = h.broadcasts.filter((b) => b.type === "codex_stream_chunk");
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].data.seq, 1);
  assert.equal(chunks[1].data.seq, 2);
  assert.equal(chunks[0].data.chunk, "first chunk");
});

test("UI-H4: recordClaudeChunk emits claude_stream_chunk broadcast", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  h.manager.recordCritiqueReceived(s.sessionId, { summary: "ok" });
  h.manager.handBackClaude(s.sessionId, { instruction: "x" });
  h.manager.recordClaudeChunk(s.sessionId, { text: "Claude here" });
  assert.ok(h.broadcasts.find(
    (b) => b.type === "claude_stream_chunk" && b.data.chunk === "Claude here"
  ));
});

test("UI-H4: chunk recording on archived session is a no-op", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.archive(s.sessionId);
  const result = h.manager.recordCodexChunk(s.sessionId, { text: "after archive" });
  assert.equal(result, null);
});

test("UI-H4: empty chunk text is ignored", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.sendCodex(s.sessionId, { instruction: "x" });
  const before = h.broadcasts.length;
  h.manager.recordCodexChunk(s.sessionId, { text: "" });
  h.manager.recordCodexChunk(s.sessionId, {});
  assert.equal(h.broadcasts.length, before, "empty chunks emit nothing");
});

// ── archive() ────────────────────────────────────────────────────

test("UI-H4: archive transitions to archived + emits broadcast + audit", () => {
  const h = makeHarness();
  const s = h.manager.create();
  const next = h.manager.archive(s.sessionId, { reason: "operator-canceled" });
  assert.equal(next.state, "archived");
  assert.equal(next.archiveReason, "operator-canceled");
  assert.ok(h.audits.find((a) => a.verb === "review_session_archived"));
});

test("UI-H4: archive on already-archived session is a no-op", () => {
  const h = makeHarness();
  const s = h.manager.create();
  h.manager.archive(s.sessionId);
  const second = h.manager.archive(s.sessionId);
  assert.equal(second, null);
});

test("UI-H4: archive on unknown session is a no-op (no throw)", () => {
  const h = makeHarness();
  const result = h.manager.archive("ghost");
  assert.equal(result, null);
});

// ── list / get / size ────────────────────────────────────────────

test("UI-H4: list() sorts by lastActivityAt desc", () => {
  const h = makeHarness();
  const a = h.manager.create({ label: "A" });
  h.advanceClock(100);
  const b = h.manager.create({ label: "B" });
  h.advanceClock(100);
  // Touch A so its lastActivityAt is most recent
  h.manager.sendCodex(a.sessionId, { instruction: "x" });

  const list = h.manager.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].label, "A", "most recently active first");
});

test("UI-H4: get returns null for unknown session", () => {
  const h = makeHarness();
  assert.equal(h.manager.get("ghost"), null);
});

test("UI-H4: size returns the session count", () => {
  const h = makeHarness();
  assert.equal(h.manager.size(), 0);
  h.manager.create();
  h.manager.create();
  assert.equal(h.manager.size(), 2);
});

// ── Snapshot defensive copies ────────────────────────────────────

test("UI-H4: snapshot returns defensive copies (caller mutation safe)", () => {
  const h = makeHarness();
  const s = h.manager.create({ label: "Test" });
  const snap = h.manager.get(s.sessionId);
  snap.label = "MUTATED";
  snap.history.push({ kind: "fake" });

  const fresh = h.manager.get(s.sessionId);
  assert.equal(fresh.label, "Test");
  assert.equal(fresh.history.length, 0);
});

// ── Defensive: throwing audit/broadcast callbacks ────────────────

test("UI-H4: manager survives auditFn that throws", () => {
  const m = new ReviewSessionManager({
    auditFn: () => { throw new Error("ledger boom"); },
  });
  assert.doesNotThrow(() => m.create({}));
});

test("UI-H4: manager survives broadcastFn that throws", () => {
  const m = new ReviewSessionManager({
    broadcastFn: () => { throw new Error("ws boom"); },
  });
  assert.doesNotThrow(() => m.create({}));
});

// ── Validation errors ─────────────────────────────────────────────

test("UI-H4: oversize instruction throws REVIEW_SESSION_INPUT_TOO_LONG", () => {
  const h = makeHarness();
  const s = h.manager.create();
  let err;
  try {
    h.manager.sendCodex(s.sessionId, {
      instruction: "x".repeat(MAX_INSTRUCTION_LENGTH + 1),
    });
  } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "REVIEW_SESSION_INPUT_TOO_LONG");
});
