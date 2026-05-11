// Slice UI-H4 (Phase D / Phase E1.5, 2026-04-30) — review session
// routes integration tests.
//
// Drives the routes module directly (no full server boot for the
// happy-path tests) + a real-server boot test for token gating.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { ReviewSessionManager } = require("../../src/runtime/reviewSessionManager");
const { createReviewSessionRoutes } = require("../../src/routes/reviewSessionRoutes");
const { start } = require("../../server");

// ── Direct-router helper ──────────────────────────────────────────

async function spinRouter({ deploymentProfile, manager } = {}) {
  const _manager = manager || new ReviewSessionManager();
  const app = express();
  app.use("/api", createReviewSessionRoutes({
    reviewSessionManager: _manager,
    deploymentProfile,
  }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  const port = listener.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    manager: _manager,
    async close() { await new Promise((r) => listener.close(r)); },
  };
}

// ── Server-mode helper (token gating tests) ──────────────────────

const PORT = 4338;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("server did not start");
}

async function withServer(fn) {
  const listener = start(PORT, "127.0.0.1");
  try {
    await waitForServer();
    await fn();
  } finally {
    await new Promise((r) => listener.close(r));
  }
}

async function getToken() {
  const res = await fetch(`${BASE}/api/auth/token`);
  return (await res.json()).token;
}

// ── Construction guards ──────────────────────────────────────────

test("UI-H4: routes return 503 when manager dependency missing", async () => {
  const app = express();
  app.use("/api", createReviewSessionRoutes({}));
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const listener = await new Promise((r) => {
    const l = app.listen(0, "127.0.0.1", () => r(l));
  });
  try {
    const port = listener.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/review-sessions`);
    assert.equal(res.status, 503);
  } finally {
    await new Promise((r) => listener.close(r));
  }
});

// ── GET /review-sessions ────────────────────────────────────────

test("UI-H4: GET /review-sessions returns empty list initially", async () => {
  const ctx = await spinRouter();
  try {
    const res = await fetch(`${ctx.base}/api/review-sessions`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.sessions, []);
    assert.equal(typeof body.serverTime, "number");
  } finally { await ctx.close(); }
});

// ── POST /review-sessions ────────────────────────────────────────

test("UI-H4: POST /review-sessions creates a session (201)", async () => {
  const ctx = await spinRouter();
  try {
    const res = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "selected_run", runId: "r1", label: "Review #1" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.state, "created");
    assert.equal(body.session.source, "selected_run");
    assert.equal(body.session.runId, "r1");
    assert.equal(body.session.label, "Review #1");
  } finally { await ctx.close(); }
});

// ── GET /review-sessions/:id ─────────────────────────────────────

test("UI-H4: GET /review-sessions/:id returns 404 for unknown", async () => {
  const ctx = await spinRouter();
  try {
    const res = await fetch(`${ctx.base}/api/review-sessions/no-such`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "session_not_found");
  } finally { await ctx.close(); }
});

test("UI-H4: GET /review-sessions/:id returns the created session", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Test" }),
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.session.sessionId, session.sessionId);
  } finally { await ctx.close(); }
});

// ── POST /:id/send-codex ─────────────────────────────────────────

test("UI-H4: POST /:id/send-codex transitions to awaiting_critique", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "review the plan" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.state, "awaiting_critique");
    assert.equal(body.session.history[0].kind, "send_codex");
    assert.equal(typeof body.dispatchedAt, "number");
  } finally { await ctx.close(); }
});

test("UI-H4: POST /:id/send-codex 400 on missing instruction", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: "{}",  // no instruction
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /invalid_input|invalid/i);
  } finally { await ctx.close(); }
});

test("UI-H4: POST /:id/send-codex 404 for unknown session", async () => {
  const ctx = await spinRouter();
  try {
    const res = await fetch(`${ctx.base}/api/review-sessions/ghost/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    assert.equal(res.status, 404);
  } finally { await ctx.close(); }
});

// ── POST /:id/follow-up ──────────────────────────────────────────

test("UI-H4: POST /:id/follow-up after send-codex records the question", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/follow-up`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "What about edge cases?", target: "codex" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const fu = body.session.history.find((h) => h.kind === "follow_up");
    assert.ok(fu);
    assert.equal(fu.target, "codex");
  } finally { await ctx.close(); }
});

test("UI-H4: POST /:id/follow-up 409 when session in wrong state (CREATED)", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/follow-up`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x", target: "codex" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "invalid_state");
  } finally { await ctx.close(); }
});

// ── POST /:id/hand-back-claude ──────────────────────────────────

test("UI-H4: POST /:id/hand-back-claude transitions to awaiting_claude", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    // Simulate critique received via direct manager call (route doesn't expose this — it's caller-driven)
    ctx.manager.recordCritiqueReceived(session.sessionId, { summary: "looks good" });
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/hand-back-claude`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "Apply", includeCritique: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.session.state, "awaiting_claude");
  } finally { await ctx.close(); }
});

// ── Slice UI-H7-c: archive route ────────────────────────────────

test("UI-H7-c: POST /:id/archive transitions to archived + emits audit", async () => {
  const auditCalls = [];
  const manager = new ReviewSessionManager({
    auditFn: (verb, data) => { auditCalls.push({ verb, data }); },
  });
  const ctx = await spinRouter({ manager });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "test-archive" }),
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/archive`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "test-archive-reason" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.session.state, "archived");
    assert.equal(body.session.archiveReason, "test-archive-reason");

    // Audit verb emitted exactly once
    const archiveVerbs = auditCalls.filter((a) => a.verb === "review_session_archived");
    assert.equal(archiveVerbs.length, 1);
  } finally { await ctx.close(); }
});

test("UI-H7-c: POST /:id/archive idempotent on already-archived session", async () => {
  const auditCalls = [];
  const manager = new ReviewSessionManager({
    auditFn: (verb, data) => { auditCalls.push({ verb, data }); },
  });
  const ctx = await spinRouter({ manager });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "idempotent" }),
    });
    const { session } = await create.json();
    // First archive
    const r1 = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/archive`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.alreadyArchived, undefined);

    // Second archive — same response, but alreadyArchived flag
    const r2 = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/archive`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.alreadyArchived, true);
    assert.equal(b2.session.state, "archived");

    // Audit verb fired exactly once across both calls
    const archiveVerbs = auditCalls.filter((a) => a.verb === "review_session_archived");
    assert.equal(archiveVerbs.length, 1);
  } finally { await ctx.close(); }
});

test("UI-H7-c: POST /:id/archive 404 for unknown session", async () => {
  const ctx = await spinRouter();
  try {
    const res = await fetch(`${ctx.base}/api/review-sessions/nope/archive`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, "session_not_found");
  } finally { await ctx.close(); }
});

test("UI-H7-c: POST /:id/archive default reason when body empty", async () => {
  const ctx = await spinRouter();
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/archive`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const body = await res.json();
    assert.equal(body.session.archiveReason, "operator-archive");
  } finally { await ctx.close(); }
});

// ── Public-sector posture ────────────────────────────────────────

test("UI-H4: public-sector + allowLocalExecutor=false rejects hand-back-claude with 409", async () => {
  const ctx = await spinRouter({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
  });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/hand-back-claude`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "go" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "public_sector_local_executor_disabled");
    assert.match(body.message, /sandbox/i);
  } finally { await ctx.close(); }
});

test("UI-H4: public-sector + allowLocalExecutor=false rejects follow-up target=claude", async () => {
  const ctx = await spinRouter({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
  });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/follow-up`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x", target: "claude" }),
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.error, "public_sector_local_executor_disabled");
  } finally { await ctx.close(); }
});

test("UI-H4: public-sector ALLOWS follow-up target=codex (read-only critique)", async () => {
  const ctx = await spinRouter({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
  });
  try {
    const create = await fetch(`${ctx.base}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const { session } = await create.json();
    await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/send-codex`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction: "x" }),
    });
    const res = await fetch(`${ctx.base}/api/review-sessions/${session.sessionId}/follow-up`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "x", target: "codex" }),
    });
    assert.equal(res.status, 200);  // codex follow-ups OK in public-sector
  } finally { await ctx.close(); }
});

// ── Token gating (full server boot) ─────────────────────────────

test("UI-H4: state-changing routes require x-orchestrator-token", async () => {
  await withServer(async () => {
    // POST /review-sessions without token → 401
    const res = await fetch(`${BASE}/api/review-sessions`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(res.status, 401);
  });
});

test("UI-H4: GET /review-sessions reachable without token (loopback CSRF)", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/api/review-sessions`);
    assert.equal(res.status, 200);
  });
});

test("UI-H4: state-changing routes succeed with token", async () => {
  await withServer(async () => {
    const token = await getToken();
    const res = await fetch(`${BASE}/api/review-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ label: "Test from server boot" }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.session.label, "Test from server boot");
  });
});
