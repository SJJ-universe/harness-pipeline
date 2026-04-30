// Slice UI-H9-a (Phase D / Phase E1.5, 2026-04-30) — audit read API tests.
//
// Pins the URL surface, parameter validation, and error mapping so
// future GOV-AUDIT-0 / GOV-RELEASE-0 work doesn't accidentally break
// the drill-down panel's data contract.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");
const { once } = require("node:events");

const {
  createAuditRoutes,
  AUDIT_ERROR_CODES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  _validateRunId,
  _parseLimit,
} = require("../../src/routes/auditRoutes");

// ── Helpers ───────────────────────────────────────────────────────

function makeStubLedger({ entriesByRun = {}, verifyByRun = {} } = {}) {
  return {
    read: (runId) => entriesByRun[runId] || [],
    verifyChain: (runId) => verifyByRun[runId] || { valid: true, entries: 0 },
  };
}

async function startApp(deps) {
  const app = express();
  app.use("/api", createAuditRoutes(deps));
  const server = app.listen(0);
  await once(server, "listening");
  const port = server.address().port;
  return {
    server,
    port,
    base: `http://127.0.0.1:${port}`,
    async close() { server.close(); await once(server, "close"); },
  };
}

async function getJSON(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (err) { reject(err); }
      });
    });
    req.on("error", reject);
  });
}

// ── _validateRunId ────────────────────────────────────────────────

test("UI-H9-a: _validateRunId rejects empty / non-string / oversize / path-traversal", () => {
  assert.equal(_validateRunId(null), null);
  assert.equal(_validateRunId(""), null);
  assert.equal(_validateRunId("   "), null);
  assert.equal(_validateRunId("x".repeat(129)), null);
  assert.equal(_validateRunId("../etc/passwd"), null);
  assert.equal(_validateRunId("hello world"), null);
  assert.equal(_validateRunId("hello/foo"), null);
  // Allowed characters
  assert.equal(_validateRunId("run-abc-123"), "run-abc-123");
  assert.equal(_validateRunId("run_test:1.0"), "run_test:1.0");
  assert.equal(_validateRunId("  trim  "), "trim");
});

// ── _parseLimit ──────────────────────────────────────────────────

test("UI-H9-a: _parseLimit defaults to 256, caps at 1024, floors floats, rejects negatives", () => {
  assert.equal(_parseLimit(undefined), DEFAULT_LIMIT);
  assert.equal(_parseLimit(""), DEFAULT_LIMIT);
  assert.equal(_parseLimit("not-a-number"), DEFAULT_LIMIT);
  assert.equal(_parseLimit("0"), DEFAULT_LIMIT);
  assert.equal(_parseLimit("-1"), DEFAULT_LIMIT);
  assert.equal(_parseLimit("3.7"), 3);
  assert.equal(_parseLimit("100"), 100);
  assert.equal(_parseLimit("9999"), MAX_LIMIT);
});

// ── createAuditRoutes — stub fallback ─────────────────────────────

test("UI-H9-a: createAuditRoutes returns 503 stub when evidenceLedger missing", async () => {
  const harness = await startApp({});
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/whatever`);
    assert.equal(status, 503);
    assert.equal(body.error, AUDIT_ERROR_CODES.ledger_unavailable);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: createAuditRoutes also 503s when ledger missing read/verifyChain", async () => {
  const partial = { read: () => [] }; // missing verifyChain
  const harness = await startApp({ evidenceLedger: partial });
  try {
    const { status } = await getJSON(`${harness.base}/api/audit/runs/x`);
    assert.equal(status, 503);
  } finally {
    await harness.close();
  }
});

// ── GET /api/audit/runs/:runId ───────────────────────────────────

test("UI-H9-a: 400 on invalid runId (oversized)", async () => {
  const ledger = makeStubLedger();
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const longId = "x".repeat(129); // exceeds RUN_ID_MAX_LENGTH=128
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/${longId}`);
    assert.equal(status, 400);
    assert.equal(body.error, AUDIT_ERROR_CODES.invalid_run_id);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: 404 when ledger has no entries for runId", async () => {
  const ledger = makeStubLedger();
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/missing`);
    assert.equal(status, 404);
    assert.equal(body.error, AUDIT_ERROR_CODES.not_found);
    assert.equal(body.runId, "missing");
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: returns entries + chain verify result", async () => {
  const entries = [
    { eventId: "e1", type: "review_session_created", at: "2026-04-30T00:00:00Z" },
    { eventId: "e2", type: "review_session_dispatch_started", at: "2026-04-30T00:00:01Z" },
    { eventId: "e3", type: "review_session_dispatch_completed", at: "2026-04-30T00:00:02Z" },
  ];
  const ledger = makeStubLedger({
    entriesByRun: { run1: entries },
    verifyByRun: { run1: { valid: true, entries: 3 } },
  });
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runId, "run1");
    assert.equal(body.total, 3);
    assert.equal(body.returned, 3);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.entries, entries);
    assert.equal(body.chain.valid, true);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: limits to last N entries when total > limit", async () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ eventId: "e" + i, type: "x", at: String(i) }));
  const ledger = makeStubLedger({
    entriesByRun: { run1: entries },
    verifyByRun: { run1: { valid: true, entries: 10 } },
  });
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { body } = await getJSON(`${harness.base}/api/audit/runs/run1?limit=3`);
    assert.equal(body.total, 10);
    assert.equal(body.returned, 3);
    assert.equal(body.truncated, true);
    assert.equal(body.limit, 3);
    // Last 3 (most recent)
    assert.deepEqual(body.entries.map((e) => e.eventId), ["e7", "e8", "e9"]);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: returns chain verify result when verifyChain throws", async () => {
  const ledger = {
    read: () => [{ eventId: "e1", type: "x" }],
    verifyChain: () => { throw new Error("boom"); },
  };
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1`);
    assert.equal(status, 200);
    assert.equal(body.chain.valid, false);
    assert.equal(body.chain.error, "verify_threw");
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: returns 503 if read throws", async () => {
  const ledger = {
    read: () => { throw new Error("disk read failed"); },
    verifyChain: () => ({ valid: true, entries: 0 }),
  };
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1`);
    assert.equal(status, 503);
    assert.equal(body.error, AUDIT_ERROR_CODES.ledger_unavailable);
  } finally {
    await harness.close();
  }
});

// ── GET /api/audit/runs/:runId/verify ────────────────────────────

test("UI-H9-a: verify endpoint returns chain result + 200", async () => {
  const ledger = makeStubLedger({
    verifyByRun: { run1: { valid: true, entries: 5 } },
  });
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1/verify`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.runId, "run1");
    assert.equal(body.valid, true);
    assert.equal(body.entries, 5);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: verify endpoint returns 404 when entries=0 + valid=true", async () => {
  const ledger = makeStubLedger({
    verifyByRun: { run1: { valid: true, entries: 0 } },
  });
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1/verify`);
    assert.equal(status, 404);
    assert.equal(body.error, AUDIT_ERROR_CODES.not_found);
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: verify endpoint returns 200 with valid:false (broken chain)", async () => {
  const ledger = makeStubLedger({
    verifyByRun: { run1: { valid: false, brokenAt: "evt-3", reason: "previousHash_mismatch", index: 2, entries: 5 } },
  });
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1/verify`);
    assert.equal(status, 200);
    assert.equal(body.valid, false);
    assert.equal(body.brokenAt, "evt-3");
    assert.equal(body.reason, "previousHash_mismatch");
  } finally {
    await harness.close();
  }
});

test("UI-H9-a: verify endpoint returns 503 when verifyChain throws", async () => {
  const ledger = {
    read: () => [],
    verifyChain: () => { throw new Error("boom"); },
  };
  const harness = await startApp({ evidenceLedger: ledger });
  try {
    const { status, body } = await getJSON(`${harness.base}/api/audit/runs/run1/verify`);
    assert.equal(status, 503);
    assert.equal(body.error, AUDIT_ERROR_CODES.ledger_unavailable);
  } finally {
    await harness.close();
  }
});

// ── frozen vocabulary ─────────────────────────────────────────────

test("UI-H9-a: AUDIT_ERROR_CODES is frozen", () => {
  assert.ok(Object.isFrozen(AUDIT_ERROR_CODES));
  assert.equal(AUDIT_ERROR_CODES.invalid_run_id, "invalid_run_id");
  assert.equal(AUDIT_ERROR_CODES.not_found, "not_found");
  assert.equal(AUDIT_ERROR_CODES.ledger_unavailable, "ledger_unavailable");
});
