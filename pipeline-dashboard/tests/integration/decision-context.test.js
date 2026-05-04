// Slice SMART-0-b (Phase D Round UI-P / Phase 2 SMART arc, 2026-05-04)
// — integration tests for /api/decision-context.
//
// Mounts the route on a fresh express app with stub adapters
// (no real ApprovalManager / ReviewSessionManager / etc spawned —
// keeps the integration test fast + deterministic).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createDecisionContextRoutes } = require("../../src/routes/decisionContextRoutes");

// ── Test harness ───────────────────────────────────────────────

function _bootApp(adapters) {
  const app = express();
  app.use(express.json());
  app.use("/api", createDecisionContextRoutes(adapters));
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      resolve({
        port,
        base: `http://127.0.0.1:${port}`,
        close: function () {
          return new Promise((r) => server.close(r));
        },
      });
    });
    server.on("error", reject);
  });
}

async function _get(base, path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      base + path,
      { method: "GET", headers: headers || {} },
      function (res) {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", function () {
          let parsed = null;
          try { parsed = JSON.parse(body); } catch (_) { /* keep null */ }
          resolve({ status: res.statusCode, body, json: parsed });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────

test("SMART-0-b: GET /api/decision-context with no adapters → 200 + default snapshot", async () => {
  const handle = await _bootApp({});
  try {
    const res = await _get(handle.base, "/api/decision-context");
    assert.equal(res.status, 200);
    assert.equal(res.json.schema, "harness-decision-context/v1");
    assert.equal(typeof res.json.timestamp, "string");
    // All adapters absent → all sources "absent"
    for (const id of [
      "approvalManager", "reviewSessionManager", "runRegistry",
      "deploymentProfile", "evidenceLedger", "profileStore", "remoteRunner",
    ]) {
      assert.equal(res.json.sources[id], "absent");
    }
    // Counts all 0
    assert.equal(res.json.counts.activeRuns, 0);
    assert.equal(res.json.counts.pendingApprovals, 0);
    assert.equal(res.json.counts.openReviewSessions, 0);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: x-harness-has-pii header → hasPii boolean true in response", async () => {
  const handle = await _bootApp({});
  try {
    const res = await _get(handle.base, "/api/decision-context", {
      "x-harness-has-pii": "1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.booleans.hasPii, true);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: header any-other-value → hasPii false", async () => {
  const handle = await _bootApp({});
  try {
    const res = await _get(handle.base, "/api/decision-context", {
      "x-harness-has-pii": "yes",  // not exactly "1" → false
    });
    assert.equal(res.json.booleans.hasPii, false);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: full adapter set → populated booleans + counts + sources", async () => {
  const handle = await _bootApp({
    approvalManager: { list: () => [{ id: "a1" }, { id: "a2" }] },
    reviewSessionManager: {
      list: () => [
        { state: "active" },
        { state: "awaiting_critique" },
      ],
    },
    runRegistry: {
      list: () => [{ runId: "r1", state: "running" }],
    },
    deploymentProfile: {
      mode: "public-sector",
      publicSector: true,
      requirePiiScan: true,
      requireSandboxWorkspace: true,
    },
    evidenceLedger: { count: () => 25 },
    profileStore: { active: () => ({ id: "agency-1", label: "Agency" }) },
    runnerRegistry: {
      snapshot: () => [{ hostIdentity: "h1", healthy: true }],
    },
  });
  try {
    const res = await _get(handle.base, "/api/decision-context");
    assert.equal(res.status, 200);
    // Booleans
    assert.equal(res.json.booleans.approvalPending, true);
    assert.equal(res.json.booleans.codexReviewMissing, true);
    assert.equal(res.json.booleans.publicSector, true);
    assert.equal(res.json.booleans.hasActiveProfile, true);
    assert.equal(res.json.booleans.auditExportReady, true);
    assert.equal(res.json.booleans.remoteRunnerActive, true);
    assert.equal(res.json.booleans.needsHumanDecision, true);
    // Counts
    assert.equal(res.json.counts.pendingApprovals, 2);
    assert.equal(res.json.counts.openReviewSessions, 2);
    assert.equal(res.json.counts.activeRuns, 1);
    assert.equal(res.json.counts.evidenceLedgerEntries, 25);
    assert.equal(res.json.counts.remoteRunnerCount, 1);
    // Posture
    assert.equal(res.json.posture.publicSector, true);
    assert.equal(res.json.posture.requirePiiScan, true);
    // Sources all ok
    for (const id of [
      "approvalManager", "reviewSessionManager", "runRegistry",
      "deploymentProfile", "evidenceLedger", "profileStore", "remoteRunner",
    ]) {
      assert.equal(res.json.sources[id], "ok",
        `source "${id}" should be ok with full adapters`);
    }
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: throwing adapter surfaces in sources.<id> but doesn't 500 the request", async () => {
  const handle = await _bootApp({
    approvalManager: {
      list: () => { throw new Error("approval down"); },
    },
    profileStore: { active: () => ({ id: "p1" }) },
  });
  try {
    const res = await _get(handle.base, "/api/decision-context");
    assert.equal(res.status, 200, "single-adapter throw must NOT 500");
    assert.equal(res.json.sources.approvalManager.errored, true);
    assert.equal(res.json.sources.approvalManager.message, "approval down");
    // profileStore still works
    assert.equal(res.json.sources.profileStore, "ok");
    assert.equal(res.json.booleans.hasActiveProfile, true);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: runRegistry adapter with .listAll() fallback shape", async () => {
  // Some legacy code paths might use .listAll() instead of .list()
  // — the route's adapter shim handles both.
  const handle = await _bootApp({
    runRegistry: {
      // No .list, only .listAll
      listAll: () => [
        { runId: "r1", state: "running" },
        { runId: "r2", state: "running" },
      ],
    },
  });
  try {
    const res = await _get(handle.base, "/api/decision-context");
    assert.equal(res.status, 200);
    assert.equal(res.json.counts.activeRuns, 2);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: evidenceLedger adapter with .size() fallback shape", async () => {
  const handle = await _bootApp({
    evidenceLedger: {
      // No .count, only .size
      size: () => 99,
    },
  });
  try {
    const res = await _get(handle.base, "/api/decision-context");
    assert.equal(res.status, 200);
    assert.equal(res.json.counts.evidenceLedgerEntries, 99);
    assert.equal(res.json.booleans.auditExportReady, true);
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: response is a fresh snapshot per request (timestamps differ)", async () => {
  const handle = await _bootApp({});
  try {
    const r1 = await _get(handle.base, "/api/decision-context");
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await _get(handle.base, "/api/decision-context");
    assert.notEqual(r1.json.timestamp, r2.json.timestamp,
      "each request must produce a fresh snapshot — timestamps differ");
  } finally {
    await handle.close();
  }
});

test("SMART-0-b: responds with application/json", async () => {
  const handle = await _bootApp({});
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        handle.base + "/api/decision-context",
        { method: "GET" },
        function (rres) {
          let body = "";
          rres.on("data", (chunk) => { body += chunk; });
          rres.on("end", function () {
            resolve({ headers: rres.headers, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.match(res.headers["content-type"] || "", /application\/json/);
    assert.ok(JSON.parse(res.body));
  } finally {
    await handle.close();
  }
});
