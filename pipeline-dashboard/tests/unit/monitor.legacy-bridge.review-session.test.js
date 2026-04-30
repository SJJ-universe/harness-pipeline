// Slice UI-H7-a (Phase D / Phase E1.5, 2026-04-30) — legacy-bridge
// review-session lifecycle + chunk routing tests.
//
// Pins the contract: when a review-session WS event arrives, the
// bridge should:
//   1. NOT push it to the events ring (own slice exists)
//   2. Update reviewSessions / reviewStreams via the store actions
//   3. Bump stats.reviewSyncs once per consumed event

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store.js");
const { install } = require("../../public/js/monitor/legacy-bridge.js");

function passthroughNormalize(raw) {
  // Bridge passes the raw event through normalize(); for these tests
  // we don't care about the envelope shape since we expect chunks to
  // skip pushEvent entirely.
  return { type: raw && raw.type, data: raw && raw.data, ts: Date.now() };
}

function setupBridge() {
  const store = createMonitorStore();
  let tap = null;
  const dispatcher = {
    addTap(fn) { tap = fn; return () => { tap = null; }; },
  };
  const handle = install({
    store,
    normalize: passthroughNormalize,
    dispatcher,
    fetchImpl: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    setIntervalFn: () => null,
    clearIntervalFn: () => {},
  });
  return { store, handle, fire: (event) => tap && tap(event) };
}

// ── lifecycle: review_session_created ──────────────────────────────

test("review_session_created (initial) → upsertReviewSession + skip events ring", () => {
  const { store, handle, fire } = setupBridge();
  fire({
    type: "review_session_created",
    data: { sessionId: "rs-1", source: "manual", runId: null,
            label: "First", createdAt: 1000 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.equal(s.reviewSessions[0].sessionId, "rs-1");
  assert.equal(s.reviewSessions[0].state, "created");
  assert.equal(s.reviewSessions[0].label, "First");
  // Events ring untouched — review-relay has its own slice
  assert.equal(s.events.length, 0);
  assert.equal(handle.stats().reviewSyncs, 1);
  assert.equal(handle.stats().eventsForwarded, 0);
});

test("review_session_created (sendCodex re-broadcast) merges state", () => {
  const { store, handle, fire } = setupBridge();
  fire({
    type: "review_session_created",
    data: { sessionId: "rs-1", source: "manual", createdAt: 1000 },
  });
  fire({
    type: "review_session_created",
    data: { sessionId: "rs-1", state: "awaiting_critique", dispatchedAt: 1100 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.equal(s.reviewSessions[0].state, "awaiting_critique");
  assert.equal(s.reviewSessions[0].source, "manual");  // preserved
  assert.equal(s.reviewSessions[0].lastActivityAt, 1100);
  assert.equal(handle.stats().reviewSyncs, 2);
});

// ── chunks: codex_stream_chunk + claude_stream_chunk ───────────────

test("codex_stream_chunk → appendReviewChunk + skip events ring", () => {
  const { store, handle, fire } = setupBridge();
  fire({
    type: "codex_stream_chunk",
    data: { sessionId: "rs-1", chunk: "Critique starts here.",
            seq: 1, ts: 2000 },
  });
  const s = store.snapshot();
  assert.ok(s.reviewStreams["rs-1"]);
  assert.equal(s.reviewStreams["rs-1"].codex.length, 1);
  assert.equal(s.reviewStreams["rs-1"].codex[0].chunk, "Critique starts here.");
  assert.equal(s.events.length, 0);
  assert.equal(handle.stats().reviewSyncs, 1);
});

test("claude_stream_chunk lands on claude side", () => {
  const { store, handle, fire } = setupBridge();
  fire({
    type: "claude_stream_chunk",
    data: { sessionId: "rs-1", chunk: "Applying patch...", seq: 1, ts: 3000 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].claude.length, 1);
  assert.equal(s.reviewStreams["rs-1"].claude[0].chunk, "Applying patch...");
  assert.equal(s.reviewStreams["rs-1"].codex.length, 0);
});

test("interleaved codex + claude chunks accumulate independently", () => {
  const { store, fire } = setupBridge();
  fire({ type: "codex_stream_chunk", data: { sessionId: "rs-1", chunk: "c1", seq: 1, ts: 1 } });
  fire({ type: "claude_stream_chunk", data: { sessionId: "rs-1", chunk: "k1", seq: 2, ts: 2 } });
  fire({ type: "codex_stream_chunk", data: { sessionId: "rs-1", chunk: "c2", seq: 3, ts: 3 } });
  fire({ type: "claude_stream_chunk", data: { sessionId: "rs-1", chunk: "k2", seq: 4, ts: 4 } });
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].codex.length, 2);
  assert.equal(s.reviewStreams["rs-1"].claude.length, 2);
});

// ── lifecycle: critique_received ───────────────────────────────────

test("critique_received → state + critique summary in stream slice", () => {
  const { store, fire } = setupBridge();
  fire({
    type: "critique_received",
    data: {
      sessionId: "rs-1",
      summary: "2 critical, 1 high",
      severityCounts: { critical: 2, high: 1, medium: 0, low: 0, note: 0 },
      receivedAt: 5000,
    },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "critique_received");
  assert.equal(s.reviewStreams["rs-1"].critiqueSummary.summary, "2 critical, 1 high");
  assert.equal(s.reviewStreams["rs-1"].critiqueSummary.severityCounts.critical, 2);
});

// ── lifecycle: handoff_to_claude_requested ─────────────────────────

test("handoff_to_claude_requested → state awaiting_claude + includeCritique flag", () => {
  const { store, fire } = setupBridge();
  fire({
    type: "handoff_to_claude_requested",
    data: { sessionId: "rs-1", includeCritique: true, dispatchedAt: 6000 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "awaiting_claude");
  assert.equal(s.reviewSessions[0].includeCritique, true);
});

// ── lifecycle: handoff_to_claude_completed ─────────────────────────

test("handoff_to_claude_completed → state claude_received + claudeSummary in stream slice", () => {
  const { store, fire } = setupBridge();
  fire({
    type: "handoff_to_claude_completed",
    data: { sessionId: "rs-1", summary: "Patched both findings", completedAt: 7000 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "claude_received");
  assert.equal(s.reviewStreams["rs-1"].claudeSummary.summary, "Patched both findings");
});

// ── lifecycle: review_session_archived ─────────────────────────────

test("review_session_archived → state archived", () => {
  const { store, fire } = setupBridge();
  fire({
    type: "review_session_archived",
    data: { sessionId: "rs-1", reason: "operator-closed", archivedAt: 8000 },
  });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "archived");
  assert.equal(s.reviewSessions[0].archivedAt, 8000);
  assert.equal(s.reviewSessions[0].archiveReason, "operator-closed");
});

// ── interaction with other slices ──────────────────────────────────

test("review-session events do not collide with approval events", () => {
  const { store, handle, fire } = setupBridge();
  fire({
    type: "approval_requested",
    data: {
      approvalId: "appr-1", hook: "PreToolUse", tool: "Bash",
      args: {}, argsHash: "x".repeat(64), argsSummary: "...",
      runId: "run-1", hostIdentity: "host-A", source: "remote_hook",
      piiContext: null, timeoutMs: 30000, requestedAt: 1000, expiresAt: 31000,
    },
  });
  fire({ type: "codex_stream_chunk", data: { sessionId: "rs-1", chunk: "x", seq: 1, ts: 1 } });
  const s = store.snapshot();
  assert.equal(s.pendingApprovals.length, 1);
  assert.ok(s.reviewStreams["rs-1"]);
  assert.equal(handle.stats().reviewSyncs, 1);
  assert.equal(handle.stats().approvalSyncs, 1);
});

test("non-review events still flow through pushEvent", () => {
  const { store, handle, fire } = setupBridge();
  fire({ type: "phase_update", data: { runId: "run-1", phase: "plan" } });
  // Bridge pushes through normalize → store.pushEvent so events ring grows
  assert.equal(store.snapshot().events.length, 1);
  assert.equal(handle.stats().eventsForwarded, 1);
  assert.equal(handle.stats().reviewSyncs, 0);
});

// ── defensive ──────────────────────────────────────────────────────

test("review event missing sessionId is ignored (returns false from sync)", () => {
  const { store, handle, fire } = setupBridge();
  fire({ type: "codex_stream_chunk", data: { chunk: "x", seq: 1 } });
  // No sessionId → sync returns false → falls through to pushEvent path
  // Result: events ring receives the event (bridge defers to default path)
  assert.equal(handle.stats().reviewSyncs, 0);
});

test("test hook _syncReviewSessionFromEvent exposed", () => {
  const { handle, fire } = setupBridge();
  // Just smoke — the test hook callable returning the same boolean
  // semantic as the dispatcher path.
  const consumed = handle._syncReviewSessionFromEvent({
    type: "review_session_created",
    data: { sessionId: "rs-99", createdAt: 1 },
  });
  assert.equal(consumed, true);
  fire({ type: "review_session_created", data: { sessionId: "rs-99", createdAt: 1 } });
});
