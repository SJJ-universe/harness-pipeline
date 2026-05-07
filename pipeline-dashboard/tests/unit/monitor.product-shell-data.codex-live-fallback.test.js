// PRODUCT-LIVE-STREAM-0 (2026-05-07) — selectCodexLiveTail fallback tests.
//
// Pins:
//   Gap C: selectCodexLiveTail reads BOTH `streams.codex` (canonical
//          appendReviewChunk shape) AND `streams.codexChunks` (legacy
//          review-relay shape). chunk objects bidirectional too:
//          { chunk: "..." } (canonical) and { text: "..." } (legacy).
//   Gap G: selectActiveReviewSession prefers source !== "general"
//          (real review session beats synthetic projection on same runId).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productShellData = require("../../public/js/monitor/product-shell-data");

// ── Helper: build a minimal snapshot ─────────────────────────────────

function makeSnap({ sessions = [], streams = {} } = {}) {
  return {
    selectedReviewSessionId: null,
    reviewSessions: sessions,
    reviewStreams: streams,
  };
}

// ── Gap C: streams.codex (canonical) ─────────────────────────────────

test("PLS-0 Gap C: selectCodexLiveTail reads streams.codex (canonical)", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [{ chunk: "hello", seq: 1, ts: 1 }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "hello");
});

test("PLS-0 Gap C: selectCodexLiveTail reads streams.codexChunks (legacy review-relay)", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "review-relay" }],
    streams: { S: { codexChunks: [{ text: "legacy", seq: 1, ts: 1 }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "legacy");
});

test("PLS-0 Gap C: chunk shape — c.chunk takes priority over c.text", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [{ chunk: "a", text: "ignored" }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "a");
});

test("PLS-0 Gap C: chunk shape — falls back to c.text when c.chunk absent", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [{ text: "fallback" }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "fallback");
});

test("PLS-0 Gap C: empty arr → null", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, null);
});

test("PLS-0 Gap C: no streams entry → null", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: {},
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, null);
});

test("PLS-0 Gap C: mixed chunk shapes — concat both", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [{ chunk: "a" }, { text: "b" }, { chunk: "c" }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "abc");
});

test("PLS-0 Gap C: maxChars cap respected", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "general" }],
    streams: { S: { codex: [{ chunk: "ABCDEFGHIJ" }] } },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R", 4);
  // Implementation prefixes "…" when truncated.
  assert.match(text, /GHIJ$/);
  assert.ok(text.length <= 5);
});

// ── Gap G: real session preferred over synthetic on same runId ──────

test("PLS-0 Gap G: selectActiveReviewSession prefers real source over 'general'", () => {
  const snap = makeSnap({
    sessions: [
      { sessionId: "general:R", runId: "R", source: "general", streamOnly: true, lastActivityAt: 999 },
      { sessionId: "real-1", runId: "R", source: "review-relay", lastActivityAt: 100 },
    ],
  });
  const session = productShellData.selectActiveReviewSession(snap, "R");
  assert.equal(session.sessionId, "real-1",
    "real session must beat synthetic regardless of recency");
});

test("PLS-0 Gap G: synthetic-only → returned as fallback when no real session", () => {
  const snap = makeSnap({
    sessions: [
      { sessionId: "general:R", runId: "R", source: "general", streamOnly: true },
    ],
  });
  const session = productShellData.selectActiveReviewSession(snap, "R");
  assert.equal(session.sessionId, "general:R");
});

test("PLS-0 Gap G: selectCodexLiveTail through real session when both exist", () => {
  // The selector reuses selectActiveReviewSession, so the real session's
  // streams (NOT the synthetic one's) are what get rendered. This is the
  // hijack-defense end-to-end check.
  const snap = makeSnap({
    sessions: [
      { sessionId: "general:R", runId: "R", source: "general", streamOnly: true },
      { sessionId: "real-1", runId: "R", source: "review-relay" },
    ],
    streams: {
      "general:R": { codex: [{ chunk: "synthetic" }] },
      "real-1": { codex: [{ chunk: "real" }] },
    },
  });
  const text = productShellData.selectCodexLiveTail(snap, "R");
  assert.equal(text, "real",
    "selectCodexLiveTail must read from the real session's streams");
});

// ── No regression: existing single-session flows unaffected ─────────

test("PLS-0: single review session (no synthetic) → returned as before", () => {
  const snap = makeSnap({
    sessions: [{ sessionId: "S", runId: "R", source: "review-relay" }],
  });
  const session = productShellData.selectActiveReviewSession(snap, "R");
  assert.equal(session.sessionId, "S");
});

test("PLS-0: selectedReviewSessionId still wins over priority rules", () => {
  const snap = makeSnap({
    sessions: [
      { sessionId: "selected", runId: "OTHER", source: "review-relay" },
      { sessionId: "general:R", runId: "R", source: "general" },
    ],
  });
  snap.selectedReviewSessionId = "selected";
  const session = productShellData.selectActiveReviewSession(snap, "R");
  assert.equal(session.sessionId, "selected");
});
