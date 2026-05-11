// Slice R3-e-c (Phase D R3, 2026-04-29) — approval routes integration.
//
// End-to-end check that the HTTP surface boots inside the real server
// and the auth / audit / broadcast wiring all line up. The router is
// already unit-tested at the module level; these tests exercise the
// integration seams: token gate, manager instance reused across
// requests, audit chain emits the right verbs, broadcast fires for
// dashboard subscribers.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { start } = require("../../server");
const { ApprovalManager } = require("../../src/runtime/approvalManager");

const PORT = 4326;
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
  const body = await res.json();
  return body.token;
}

test("R3-e-c: GET /api/approvals/pending returns empty list initially", async () => {
  await withServer(async () => {
    const token = await getToken();
    const res = await fetch(`${BASE}/api/approvals/pending`, {
      headers: { "x-orchestrator-token": token },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.approvals));
    assert.equal(body.approvals.length, 0);
    assert.equal(typeof body.serverTime, "number");
  });
});

test("R3-e-c: state-changing approval endpoints require token", async () => {
  await withServer(async () => {
    // No token header — should 401.
    for (const path of ["/approvals/abc/grant", "/approvals/abc/deny"]) {
      const res = await fetch(`${BASE}/api${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assert.equal(res.status, 401, `expected 401 on ${path} without token`);
    }
  });
});

test("R3-e-c: GET /pending is reachable without token (loopback bind = CSRF)", async () => {
  // Pattern matches every other GET endpoint in the codebase: read-only
  // surfaces are loopback-only by virtue of server bind to 127.0.0.1;
  // only state-changing routes require x-orchestrator-token. Fail-closed
  // for state changes, fail-open for reads — same shape as e.g.
  // /api/server/info, /api/profiles, /api/monitor/bootstrap.
  await withServer(async () => {
    const res = await fetch(`${BASE}/api/approvals/pending`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.approvals));
  });
});

test("R3-e-c: POST /:id/grant on unknown id returns 404", async () => {
  await withServer(async () => {
    const token = await getToken();
    const res = await fetch(`${BASE}/api/approvals/no-such-id/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ deciderId: "operator-1" }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "unknown_or_resolved");
  });
});

test("R3-e-c: POST /:id/deny on unknown id returns 404", async () => {
  await withServer(async () => {
    const token = await getToken();
    const res = await fetch(`${BASE}/api/approvals/no-such-id/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ deciderId: "operator-1", reason: "no" }),
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "unknown_or_resolved");
  });
});

test("R3-e-c: POST /:id/grant validates body field types", async () => {
  await withServer(async () => {
    const token = await getToken();
    // deciderId not a string
    let res = await fetch(`${BASE}/api/approvals/x/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ deciderId: 123 }),
    });
    assert.equal(res.status, 400);
    let body = await res.json();
    assert.equal(body.error, "deciderId_invalid");

    // reason not a string
    res = await fetch(`${BASE}/api/approvals/x/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ reason: { obj: "bad" } }),
    });
    assert.equal(res.status, 400);
    body = await res.json();
    assert.equal(body.error, "reason_invalid");

    // deciderId way too long
    res = await fetch(`${BASE}/api/approvals/x/grant`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ deciderId: "a".repeat(200) }),
    });
    assert.equal(res.status, 400);
    body = await res.json();
    assert.equal(body.error, "deciderId_too_long");

    // reason way too long
    res = await fetch(`${BASE}/api/approvals/x/deny`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-orchestrator-token": token },
      body: JSON.stringify({ reason: "a".repeat(1024) }),
    });
    assert.equal(res.status, 400);
    body = await res.json();
    assert.equal(body.error, "reason_too_long");
  });
});

test("R3-e-c: createApprovalRoutes returns 503 when manager missing (defensive)", async () => {
  // This unit-style assertion drives the router directly so we don't
  // have to spin a whole server. It backstops the defensive-503 path.
  const express = require("express");
  const { createApprovalRoutes } = require("../../src/routes/approvalRoutes");

  const app = express();
  app.use("/api", createApprovalRoutes({ /* no manager */ }));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  // Use a temporary port + listen to issue requests.
  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const port = listener.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/approvals/pending`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "approval_manager_unavailable");
  } finally {
    await new Promise((r) => listener.close(r));
  }
});

test("R3-e-c: pending → grant happy path with isolated manager + router", async () => {
  // Drive the router directly (no auth middleware) so we can exercise
  // request → grant → resolution end-to-end.
  const express = require("express");
  const { createApprovalRoutes } = require("../../src/routes/approvalRoutes");

  const audits = [];
  const broadcasts = [];
  const manager = new ApprovalManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    broadcastFn: (type, data) => broadcasts.push({ type, data }),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const app = express();
  app.use("/api", createApprovalRoutes({ approvalManager: manager }));

  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const port = listener.address().port;
    const base = `http://127.0.0.1:${port}`;

    // Issue a request directly through the manager so we have a known
    // approvalId to grant.
    const promise = manager.request({
      hook: "PreToolUse",
      tool: "Bash",
      args: { command: "echo hi" },
      runId: "r1",
    });
    const id = manager.list()[0].approvalId;

    // GET /pending should now show the request.
    const list = await fetch(`${base}/api/approvals/pending`).then((r) => r.json());
    assert.equal(list.approvals.length, 1);
    assert.equal(list.approvals[0].approvalId, id);
    assert.equal(list.approvals[0].tool, "Bash");

    // Grant via HTTP.
    const grantRes = await fetch(`${base}/api/approvals/${id}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deciderId: "operator-1" }),
    });
    assert.equal(grantRes.status, 200);
    const grantBody = await grantRes.json();
    assert.equal(grantBody.ok, true);
    assert.equal(grantBody.approvalId, id);
    assert.equal(grantBody.resolution, "granted");
    assert.equal(grantBody.deciderId, "operator-1");

    // The promise from request() resolves with the same resolution.
    const result = await promise;
    assert.equal(result.resolution, "granted");
    assert.equal(result.deciderId, "operator-1");

    // Audit + broadcast chain narrates the full lifecycle.
    assert.equal(audits.length, 2);
    assert.equal(audits[0].verb, "runner_hook_approval_requested");
    assert.equal(audits[1].verb, "runner_hook_approval_granted");
    assert.equal(broadcasts[0].type, "approval_requested");
    assert.equal(broadcasts[1].type, "approval_resolved");

    // Re-grant returns 404 (already resolved).
    const reGrant = await fetch(`${base}/api/approvals/${id}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(reGrant.status, 404);
  } finally {
    await new Promise((r) => listener.close(r));
  }
});

test("R3-e-c: pending → deny happy path with isolated manager + router", async () => {
  const express = require("express");
  const { createApprovalRoutes } = require("../../src/routes/approvalRoutes");

  const audits = [];
  const manager = new ApprovalManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  const app = express();
  app.use("/api", createApprovalRoutes({ approvalManager: manager }));

  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const port = listener.address().port;
    const base = `http://127.0.0.1:${port}`;

    const promise = manager.request({
      hook: "PreToolUse", tool: "Edit",
      args: { file_path: "/tmp/x", old_string: "a", new_string: "b" },
    });
    const id = manager.list()[0].approvalId;

    const denyRes = await fetch(`${base}/api/approvals/${id}/deny`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deciderId: "operator-1", reason: "looks dangerous" }),
    });
    assert.equal(denyRes.status, 200);
    const body = await denyRes.json();
    assert.equal(body.resolution, "denied");
    assert.equal(body.reason, "looks dangerous");

    const result = await promise;
    assert.equal(result.resolution, "denied");
    assert.equal(result.reason, "looks dangerous");

    // Audit chain: requested + denied (NOT granted, NOT timeout).
    assert.equal(audits.length, 2);
    assert.equal(audits[1].verb, "runner_hook_approval_denied");
    assert.equal(audits[1].data.reason, "looks dangerous");
  } finally {
    await new Promise((r) => listener.close(r));
  }
});

test("R3-e-c: empty body defaults to deciderId='operator', reason=null", async () => {
  const express = require("express");
  const { createApprovalRoutes, DEFAULT_DECIDER_ID } = require("../../src/routes/approvalRoutes");
  const manager = new ApprovalManager({ setTimeoutFn: () => 0, clearTimeoutFn: () => {} });
  const app = express();
  app.use("/api", createApprovalRoutes({ approvalManager: manager }));

  const listener = await new Promise((resolve) => {
    const l = app.listen(0, "127.0.0.1", () => resolve(l));
  });
  try {
    const port = listener.address().port;
    const base = `http://127.0.0.1:${port}`;

    manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
    const id = manager.list()[0].approvalId;

    const res = await fetch(`${base}/api/approvals/${id}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",  // empty
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.deciderId, DEFAULT_DECIDER_ID);
  } finally {
    await new Promise((r) => listener.close(r));
  }
});
