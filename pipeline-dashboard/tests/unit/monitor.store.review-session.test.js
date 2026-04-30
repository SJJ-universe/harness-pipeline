// Slice UI-H7-a (Phase D / Phase E1.5, 2026-04-30) — review-session
// store slice unit tests.
//
// The slice is fed by the legacy-bridge translating WS broadcasts
// (review_session_created / codex_stream_chunk / claude_stream_chunk
// / critique_received / handoff_to_claude_* / review_session_archived)
// into store actions. These tests pin the store contract:
//   - upsertReviewSession(sessionId, partial)  — merge semantics
//   - removeReviewSession(sessionId)
//   - selectReviewSession(sessionId | null)
//   - appendReviewChunk(sessionId, side, chunk) — capped per side
//   - setReviewSessionsList(sessions) — replaces map (used by hydrate)
//   - clearReviewSessions()
//   - snapshot.reviewSessions sorted by lastActivityAt desc
//   - snapshot.reviewStreams keyed by sessionId; defensive copies
//   - mutations on snapshot don't leak back into state
//   - reset() clears the entire slice

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore, DEFAULT_MAX_REVIEW_CHUNKS } = require("../../public/js/monitor/store.js");

function makeSession(overrides = {}) {
  return {
    sessionId: "rs-1",
    state: "created",
    source: "manual",
    runId: null,
    label: "First review",
    createdAt: 1000,
    lastActivityAt: 1000,
    ...overrides,
  };
}

// ── snapshot shape ─────────────────────────────────────────────────

test("review slice initial snapshot has empty maps + null selection", () => {
  const store = createMonitorStore();
  const s = store.snapshot();
  assert.deepEqual(s.reviewSessions, []);
  assert.equal(s.selectedReviewSessionId, null);
  assert.deepEqual(s.reviewStreams, {});
});

test("DEFAULT_MAX_REVIEW_CHUNKS exported", () => {
  assert.ok(Number.isFinite(DEFAULT_MAX_REVIEW_CHUNKS));
  assert.ok(DEFAULT_MAX_REVIEW_CHUNKS >= 1);
});

test("createMonitorStore rejects maxReviewChunks < 1", () => {
  assert.throws(() => createMonitorStore({ maxReviewChunks: 0 }),
    /maxReviewChunks must be >= 1/);
  assert.throws(() => createMonitorStore({ maxReviewChunks: -5 }),
    /maxReviewChunks must be >= 1/);
});

// ── upsertReviewSession ────────────────────────────────────────────

test("upsertReviewSession registers a new session", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.equal(s.reviewSessions[0].sessionId, "rs-1");
  assert.equal(s.reviewSessions[0].state, "created");
});

test("upsertReviewSession ignores empty sessionId", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("", makeSession());
  store.upsertReviewSession(null, makeSession());
  store.upsertReviewSession(undefined, makeSession());
  assert.equal(store.snapshot().reviewSessions.length, 0);
});

test("upsertReviewSession merges partial updates", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.upsertReviewSession("rs-1", { state: "awaiting_critique", lastActivityAt: 2000 });
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.equal(s.reviewSessions[0].state, "awaiting_critique");
  assert.equal(s.reviewSessions[0].label, "First review");  // preserved from initial
  assert.equal(s.reviewSessions[0].lastActivityAt, 2000);
});

test("upsertReviewSession defaults lastActivityAt when missing", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { state: "created" });
  const sess = store.snapshot().reviewSessions[0];
  assert.ok(Number.isFinite(sess.lastActivityAt));
});

test("upsertReviewSession critiqueSummary mirrors to streams slice", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    state: "critique_received",
    critiqueSummary: "Two issues found",
    critiqueSeverityCounts: { critical: 1, high: 1, medium: 0, low: 0, note: 0 },
    lastActivityAt: 1500,
  });
  const s = store.snapshot();
  assert.ok(s.reviewStreams["rs-1"]);
  assert.equal(s.reviewStreams["rs-1"].critiqueSummary.summary, "Two issues found");
  assert.deepEqual(s.reviewStreams["rs-1"].critiqueSummary.severityCounts, {
    critical: 1, high: 1, medium: 0, low: 0, note: 0,
  });
});

test("upsertReviewSession claudeSummary mirrors to streams slice", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    state: "claude_received",
    claudeSummary: { summary: "Patched both findings", completedAt: 2500 },
    lastActivityAt: 2500,
  });
  const s = store.snapshot();
  assert.ok(s.reviewStreams["rs-1"]);
  assert.equal(s.reviewStreams["rs-1"].claudeSummary.summary, "Patched both findings");
});

// ── removeReviewSession ────────────────────────────────────────────

test("removeReviewSession drops session + stream + clears selection", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.appendReviewChunk("rs-1", "codex", { chunk: "hi", seq: 1, ts: 1000 });
  store.selectReviewSession("rs-1");
  store.removeReviewSession("rs-1");
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 0);
  assert.deepEqual(s.reviewStreams, {});
  assert.equal(s.selectedReviewSessionId, null);
});

test("removeReviewSession is a no-op for unknown sessionId", () => {
  const store = createMonitorStore();
  let publishCount = 0;
  store.subscribe(() => publishCount++);
  publishCount = 0;
  store.removeReviewSession("nope");
  assert.equal(publishCount, 0);
});

// ── selectReviewSession ────────────────────────────────────────────

test("selectReviewSession sets focus + null deselects", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.selectReviewSession("rs-1");
  assert.equal(store.snapshot().selectedReviewSessionId, "rs-1");
  store.selectReviewSession(null);
  assert.equal(store.snapshot().selectedReviewSessionId, null);
});

test("selectReviewSession allows unknown id (operator may pre-select)", () => {
  const store = createMonitorStore();
  store.selectReviewSession("not-yet-arrived");
  assert.equal(store.snapshot().selectedReviewSessionId, "not-yet-arrived");
});

test("selectReviewSession ignores non-string non-null", () => {
  const store = createMonitorStore();
  store.selectReviewSession(123);
  store.selectReviewSession({});
  store.selectReviewSession("");
  assert.equal(store.snapshot().selectedReviewSessionId, null);
});

// ── appendReviewChunk ──────────────────────────────────────────────

test("appendReviewChunk codex side accumulates", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "first ", seq: 1, ts: 1000 });
  store.appendReviewChunk("rs-1", "codex", { chunk: "second", seq: 2, ts: 1100 });
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].codex.length, 2);
  assert.equal(s.reviewStreams["rs-1"].codex[0].chunk, "first ");
  assert.equal(s.reviewStreams["rs-1"].codex[1].chunk, "second");
  assert.equal(s.reviewStreams["rs-1"].lastSeq, 2);
});

test("appendReviewChunk claude side accumulates separately", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "c1", seq: 1, ts: 1000 });
  store.appendReviewChunk("rs-1", "claude", { chunk: "k1", seq: 2, ts: 1100 });
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].codex.length, 1);
  assert.equal(s.reviewStreams["rs-1"].claude.length, 1);
});

test("appendReviewChunk caps each side at maxReviewChunks", () => {
  const store = createMonitorStore({ maxReviewChunks: 5 });
  for (let i = 1; i <= 10; i++) {
    store.appendReviewChunk("rs-1", "codex", { chunk: `chunk-${i}`, seq: i, ts: 1000 + i });
  }
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].codex.length, 5);
  // Latest 5 retained; eviction is from the front.
  assert.equal(s.reviewStreams["rs-1"].codex[0].seq, 6);
  assert.equal(s.reviewStreams["rs-1"].codex[4].seq, 10);
});

test("appendReviewChunk rejects bad side", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "bash", { chunk: "x", seq: 1 });
  store.appendReviewChunk("rs-1", "", { chunk: "x", seq: 1 });
  assert.deepEqual(store.snapshot().reviewStreams, {});
});

test("appendReviewChunk rejects empty chunk text", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "", seq: 1 });
  assert.deepEqual(store.snapshot().reviewStreams, {});
});

test("appendReviewChunk uses fallback seq when missing", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "a" });
  store.appendReviewChunk("rs-1", "codex", { chunk: "b" });
  const s = store.snapshot();
  assert.equal(s.reviewStreams["rs-1"].codex[0].seq, 1);
  assert.equal(s.reviewStreams["rs-1"].codex[1].seq, 2);
});

// ── setReviewSessionsList ──────────────────────────────────────────

test("setReviewSessionsList replaces map", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("old", makeSession({ sessionId: "old" }));
  store.setReviewSessionsList([
    makeSession({ sessionId: "rs-a", lastActivityAt: 2000 }),
    makeSession({ sessionId: "rs-b", lastActivityAt: 3000 }),
  ]);
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 2);
  // Sorted by lastActivityAt desc
  assert.equal(s.reviewSessions[0].sessionId, "rs-b");
  assert.equal(s.reviewSessions[1].sessionId, "rs-a");
});

test("setReviewSessionsList preserves reviewStreams (chunks live across list refreshes)", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "before-refresh", seq: 1, ts: 1000 });
  store.setReviewSessionsList([makeSession({ sessionId: "rs-1", lastActivityAt: 2000 })]);
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.ok(s.reviewStreams["rs-1"]);
  assert.equal(s.reviewStreams["rs-1"].codex.length, 1);
});

test("setReviewSessionsList nulls out selection if previously selected vanished", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.selectReviewSession("rs-1");
  store.setReviewSessionsList([makeSession({ sessionId: "rs-2" })]);
  assert.equal(store.snapshot().selectedReviewSessionId, null);
});

test("setReviewSessionsList preserves selection if still in list", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.selectReviewSession("rs-1");
  store.setReviewSessionsList([
    makeSession({ sessionId: "rs-1", lastActivityAt: 2000 }),
    makeSession({ sessionId: "rs-2", lastActivityAt: 3000 }),
  ]);
  assert.equal(store.snapshot().selectedReviewSessionId, "rs-1");
});

test("setReviewSessionsList ignores non-array input", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.setReviewSessionsList(null);
  store.setReviewSessionsList({});
  store.setReviewSessionsList("nope");
  assert.equal(store.snapshot().reviewSessions.length, 1);
});

// ── clearReviewSessions ────────────────────────────────────────────

test("clearReviewSessions empties slice", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.appendReviewChunk("rs-1", "codex", { chunk: "x", seq: 1, ts: 1 });
  store.selectReviewSession("rs-1");
  store.clearReviewSessions();
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 0);
  assert.deepEqual(s.reviewStreams, {});
  assert.equal(s.selectedReviewSessionId, null);
});

test("clearReviewSessions is a no-op when slice is empty", () => {
  const store = createMonitorStore();
  let publishCount = 0;
  store.subscribe(() => publishCount++);
  publishCount = 0;
  store.clearReviewSessions();
  assert.equal(publishCount, 0);
});

// ── snapshot defense ───────────────────────────────────────────────

test("snapshot.reviewStreams arrays are defensive copies", () => {
  const store = createMonitorStore();
  store.appendReviewChunk("rs-1", "codex", { chunk: "x", seq: 1, ts: 1000 });
  const s1 = store.snapshot();
  s1.reviewStreams["rs-1"].codex.push({ chunk: "leak", seq: 99, ts: 9999 });
  const s2 = store.snapshot();
  assert.equal(s2.reviewStreams["rs-1"].codex.length, 1);
});

test("snapshot.reviewSessions array sorted by lastActivityAt desc", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("a", makeSession({ sessionId: "a", lastActivityAt: 100 }));
  store.upsertReviewSession("c", makeSession({ sessionId: "c", lastActivityAt: 300 }));
  store.upsertReviewSession("b", makeSession({ sessionId: "b", lastActivityAt: 200 }));
  const s = store.snapshot();
  assert.deepEqual(s.reviewSessions.map((x) => x.sessionId), ["c", "b", "a"]);
});

test("snapshot.reviewSessions entries are defensive copies", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  const s1 = store.snapshot();
  s1.reviewSessions[0].state = "TAMPERED";
  const s2 = store.snapshot();
  assert.equal(s2.reviewSessions[0].state, "created");
});

// ── reset() ────────────────────────────────────────────────────────

test("reset() clears review-session slice", () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", makeSession());
  store.appendReviewChunk("rs-1", "codex", { chunk: "x", seq: 1, ts: 1000 });
  store.selectReviewSession("rs-1");
  store.reset();
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 0);
  assert.deepEqual(s.reviewStreams, {});
  assert.equal(s.selectedReviewSessionId, null);
});

// ── publish semantics ──────────────────────────────────────────────

test("subscribers fire on every successful mutation", () => {
  const store = createMonitorStore();
  let publishCount = 0;
  store.subscribe(() => publishCount++);
  publishCount = 0;
  store.upsertReviewSession("rs-1", makeSession());
  store.appendReviewChunk("rs-1", "codex", { chunk: "x", seq: 1, ts: 1000 });
  store.selectReviewSession("rs-1");
  store.removeReviewSession("rs-1");
  assert.equal(publishCount, 4);
});
