// Slice UI-H7-b (Phase D / Phase E1.5, 2026-04-30) — review-session
// HTTP client tests.
//
// Pins:
//   - Each method calls the right URL with the right verb + body
//   - Successful response writes to store via upsertReviewSession
//     (createSession also calls selectReviewSession by default)
//   - listSessions writes via setReviewSessionsList
//   - Network errors → structured Error with code "network_error"
//   - HTTP 404 → "session_not_found"
//   - HTTP 409 (public-sector) → "public_sector_local_executor_disabled"
//     (or whatever the server's `error` field is)
//   - HTTP 400 → "review_session_invalid_input" / "invalid_input"
//   - GET methods don't send Content-Type or body

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store.js");
const client = require("../../public/js/monitor/review-session-client.js");

function _capture(stub) {
  // Wraps a fetch stub so we can read the URL + init the SUT used.
  const calls = [];
  const wrapped = async (url, init) => {
    calls.push({ url, init });
    return stub(url, init);
  };
  return { fetchImpl: wrapped, calls };
}

function _okResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}
function _errResponse(status, body) {
  return {
    ok: false,
    status,
    json: async () => body,
  };
}

// ── createSession ─────────────────────────────────────────────────

test("createSession POSTs to /api/review-sessions with body", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "created", createdAt: 1000, lastActivityAt: 1000 },
  }));
  const result = await client.createSession({
    initialPlan: "first plan", source: "manual", label: "Test",
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/review-sessions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.initialPlan, "first plan");
  assert.equal(body.source, "manual");
  assert.equal(body.label, "Test");
  assert.equal(result.ok, true);
});

test("createSession writes to store + auto-selects", async () => {
  const store = createMonitorStore();
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "created", createdAt: 1, lastActivityAt: 1 },
  }));
  await client.createSession({ store, fetchImpl });
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 1);
  assert.equal(s.reviewSessions[0].sessionId, "rs-1");
  assert.equal(s.selectedReviewSessionId, "rs-1");
});

test("createSession with select:false skips selectReviewSession", async () => {
  const store = createMonitorStore();
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "created", createdAt: 1, lastActivityAt: 1 },
  }));
  await client.createSession({ store, select: false, fetchImpl });
  assert.equal(store.snapshot().selectedReviewSessionId, null);
  assert.equal(store.snapshot().reviewSessions.length, 1);
});

// ── sendToCodex ───────────────────────────────────────────────────

test("sendToCodex POSTs to /:id/send-codex", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "awaiting_critique", lastActivityAt: 2 },
    dispatchedAt: 2,
  }));
  await client.sendToCodex("rs-1", {
    instruction: "Review this plan for security",
    contextEvents: ["evt-1", "evt-2"],
    fetchImpl,
  });
  assert.equal(calls[0].url, "/api/review-sessions/rs-1/send-codex");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.instruction, "Review this plan for security");
  assert.deepEqual(body.contextEvents, ["evt-1", "evt-2"]);
});

test("sendToCodex throws structured error when sessionId missing", async () => {
  await assert.rejects(
    () => client.sendToCodex("", { instruction: "x" }),
    (err) => err.code === "invalid_input",
  );
});

test("sendToCodex updates store on success", async () => {
  const store = createMonitorStore();
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "awaiting_critique", lastActivityAt: 2 },
  }));
  await client.sendToCodex("rs-1", { instruction: "x", store, fetchImpl });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "awaiting_critique");
});

// ── followUp ──────────────────────────────────────────────────────

test("followUp POSTs to /:id/follow-up with target", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "awaiting_critique", lastActivityAt: 3 },
  }));
  await client.followUp("rs-1", {
    question: "Why is line 42 unsafe?",
    target: "codex",
    fetchImpl,
  });
  assert.equal(calls[0].url, "/api/review-sessions/rs-1/follow-up");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.question, "Why is line 42 unsafe?");
  assert.equal(body.target, "codex");
});

test("followUp 409 public-sector → public_sector_local_executor_disabled", async () => {
  const { fetchImpl } = _capture(() => _errResponse(409, {
    ok: false,
    error: "public_sector_local_executor_disabled",
    message: "Public-sector posture forbids local-executor follow-ups.",
  }));
  await assert.rejects(
    () => client.followUp("rs-1", { question: "?", target: "claude", fetchImpl }),
    (err) =>
      err.code === "public_sector_local_executor_disabled"
      && err.status === 409
      && err.serverData
      && err.serverData.message.includes("Public-sector"),
  );
});

// ── handBackToClaude ──────────────────────────────────────────────

test("handBackToClaude POSTs with includeCritique:true default", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "awaiting_claude", lastActivityAt: 4 },
    dispatchedAt: 4,
  }));
  await client.handBackToClaude("rs-1", {
    instruction: "Apply Codex's findings",
    fetchImpl,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.instruction, "Apply Codex's findings");
  // includeCritique default is true on server side; client only sends
  // when caller explicitly opts out
  assert.equal(body.includeCritique, undefined);
});

test("handBackToClaude includeCritique:false is explicit", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "awaiting_claude", lastActivityAt: 5 },
  }));
  await client.handBackToClaude("rs-1", {
    instruction: "x", includeCritique: false, fetchImpl,
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.includeCritique, false);
});

test("handBackToClaude 409 public-sector → structured error", async () => {
  const { fetchImpl } = _capture(() => _errResponse(409, {
    ok: false,
    error: "public_sector_local_executor_disabled",
    message: "Use the sandbox runner channel.",
  }));
  await assert.rejects(
    () => client.handBackToClaude("rs-1", { instruction: "x", fetchImpl }),
    (err) =>
      err.code === "public_sector_local_executor_disabled"
      && err.status === 409,
  );
});

// ── getSession ────────────────────────────────────────────────────

test("getSession GETs /:id without Content-Type", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "created", lastActivityAt: 1 },
  }));
  await client.getSession("rs-1", { fetchImpl });
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers["Content-Type"], undefined);
});

test("getSession 404 → session_not_found", async () => {
  const { fetchImpl } = _capture(() => _errResponse(404, {
    ok: false, error: "session_not_found",
  }));
  await assert.rejects(
    () => client.getSession("ghost", { fetchImpl }),
    (err) => err.code === "session_not_found" && err.status === 404,
  );
});

test("getSession updates store", async () => {
  const store = createMonitorStore();
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "critique_received", lastActivityAt: 3 },
  }));
  await client.getSession("rs-1", { store, fetchImpl });
  assert.equal(store.snapshot().reviewSessions[0].state, "critique_received");
});

// ── listSessions ──────────────────────────────────────────────────

test("listSessions GETs /api/review-sessions + writes store list", async () => {
  const store = createMonitorStore();
  const { fetchImpl, calls } = _capture(() => _okResponse({
    sessions: [
      { sessionId: "rs-1", state: "archived",         lastActivityAt: 1000 },
      { sessionId: "rs-2", state: "claude_received",  lastActivityAt: 2000 },
    ],
    serverTime: 9999,
  }));
  await client.listSessions({ store, fetchImpl });
  assert.equal(calls[0].url, "/api/review-sessions");
  assert.equal(calls[0].init.method, "GET");
  const s = store.snapshot();
  assert.equal(s.reviewSessions.length, 2);
});

test("listSessions tolerates non-array sessions field", async () => {
  const { fetchImpl } = _capture(() => _okResponse({ sessions: null }));
  // Just smoke — shouldn't throw, store unchanged
  const store = createMonitorStore();
  const result = await client.listSessions({ store, fetchImpl });
  assert.ok(result);
  assert.equal(store.snapshot().reviewSessions.length, 0);
});

// ── error mapping ─────────────────────────────────────────────────

test("network failure → code:network_error, status:0", async () => {
  const fetchImpl = async () => { throw new Error("ECONNREFUSED"); };
  await assert.rejects(
    () => client.getSession("rs-1", { fetchImpl }),
    (err) =>
      err.code === "network_error"
      && err.status === 0
      && err.message.includes("ECONNREFUSED"),
  );
});

test("HTTP 503 → service_unavailable", async () => {
  const { fetchImpl } = _capture(() => _errResponse(503, {
    ok: false, error: "review_session_manager_unavailable",
  }));
  await assert.rejects(
    () => client.getSession("rs-1", { fetchImpl }),
    (err) => err.status === 503,
  );
});

test("HTTP 400 → invalid_input mapping", async () => {
  const { fetchImpl } = _capture(() => _errResponse(400, {
    ok: false,
    error: "review_session_invalid_input",
    message: "instruction required",
  }));
  await assert.rejects(
    () => client.sendToCodex("rs-1", { instruction: "", fetchImpl }),
    (err) => err.code === "review_session_invalid_input" && err.status === 400,
  );
});

test("HTTP 500+ surfaces server-error code", async () => {
  const { fetchImpl } = _capture(() => _errResponse(500, {
    ok: false, error: "review_session_error", message: "boom",
  }));
  await assert.rejects(
    () => client.getSession("rs-1", { fetchImpl }),
    (err) => err.code === "review_session_error" && err.status === 500,
  );
});

test("missing fetchImpl throws network_error", async () => {
  // Save + nuke globals to simulate node test env without fetch
  const origFetch = globalThis.fetch;
  delete globalThis.fetch;
  try {
    await assert.rejects(
      () => client.getSession("rs-1"),
      (err) => err.code === "network_error",
    );
  } finally {
    if (origFetch) globalThis.fetch = origFetch;
  }
});

// ── archiveSession (UI-H7-c addition) ─────────────────────────────

test("archiveSession POSTs to /:id/archive with reason", async () => {
  const { fetchImpl, calls } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "archived",
               archivedAt: 5, archiveReason: "operator-archive",
               lastActivityAt: 5 },
  }));
  await client.archiveSession("rs-1", { reason: "operator-archive", fetchImpl });
  assert.equal(calls[0].url, "/api/review-sessions/rs-1/archive");
  assert.equal(calls[0].init.method, "POST");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.reason, "operator-archive");
});

test("archiveSession updates store on success", async () => {
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { sessionId: "rs-1", state: "claude_received", lastActivityAt: 1 });
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true,
    session: { sessionId: "rs-1", state: "archived", lastActivityAt: 5 },
  }));
  await client.archiveSession("rs-1", { store, fetchImpl });
  const s = store.snapshot();
  assert.equal(s.reviewSessions[0].state, "archived");
});

test("archiveSession 404 → session_not_found", async () => {
  const { fetchImpl } = _capture(() => _errResponse(404, {
    ok: false, error: "session_not_found",
  }));
  await assert.rejects(
    () => client.archiveSession("ghost", { fetchImpl }),
    (err) => err.code === "session_not_found",
  );
});

test("archiveSession idempotent: alreadyArchived in response is preserved", async () => {
  const { fetchImpl } = _capture(() => _okResponse({
    ok: true, alreadyArchived: true,
    session: { sessionId: "rs-1", state: "archived", lastActivityAt: 5 },
  }));
  const result = await client.archiveSession("rs-1", { fetchImpl });
  assert.equal(result.alreadyArchived, true);
});

test("archiveSession rejects empty sessionId", async () => {
  await assert.rejects(
    () => client.archiveSession(""),
    (err) => err.code === "invalid_input",
  );
});

// ── exports ────────────────────────────────────────────────────────

test("module exposes 7 methods + DEFAULT_BASE", () => {
  assert.equal(typeof client.createSession, "function");
  assert.equal(typeof client.sendToCodex, "function");
  assert.equal(typeof client.followUp, "function");
  assert.equal(typeof client.handBackToClaude, "function");
  assert.equal(typeof client.archiveSession, "function");
  assert.equal(typeof client.getSession, "function");
  assert.equal(typeof client.listSessions, "function");
  assert.equal(client.DEFAULT_BASE, "/api/review-sessions");
});
