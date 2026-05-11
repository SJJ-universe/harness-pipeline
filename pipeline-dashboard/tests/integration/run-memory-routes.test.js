// Slice S4-b (Phase 2 / SMART-4, 2026-05-05) — run-memory route integration.
//
// Pins:
//   - GET /api/runs/:runId/memory returns 200 + record after recordRunMemory
//   - 404 when no record exists (still emits run_memory_accessed audit)
//   - 400 on malformed runId
//   - 503 when ledger.read throws
//   - run_memory_accessed audit emits on found AND not-found reads
//   - run_memory_accessed audit does NOT emit on 400 (malformed input)
//   - Audit data carries recordedAt/truncated/redacted metadata
//   - Public-sector recorded → response carries already-redacted record
//   - Throwing auditFn does not break route

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const runMemory = require("../../src/runtime/runMemory");
const { createRunMemoryRoutes } = require("../../src/routes/runMemoryRoutes");

// ── Fixtures ──────────────────────────────────────────────────────

function makeTempLedgerDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-run-memory-test-"));
  return dir;
}

async function withServer({
  ledgerOverrides = null,
  auditTracking = "auto",
} = {}, fn) {
  const dir = makeTempLedgerDir();
  let ledger;
  if (ledgerOverrides) {
    ledger = ledgerOverrides;
  } else {
    ledger = new EvidenceLedger({ rootDir: dir });
  }

  const auditCalls = [];
  let auditFn;
  if (auditTracking === "throw") {
    auditFn = () => { throw new Error("audit DB down"); };
  } else if (auditTracking === "skip") {
    auditFn = undefined;
  } else {
    auditFn = (verb, data) => auditCalls.push({ verb, data });
  }

  const app = express();
  app.use("/api", createRunMemoryRoutes({
    evidenceLedger: ledger,
    auditFn,
  }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  try {
    await fn({ port, ledger, auditCalls, dir });
  } finally {
    await new Promise((r) => server.close(r));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function httpGet(port, path) {
  return await new Promise((resolve, reject) => {
    const req = http.request({
      method: "GET", host: "127.0.0.1", port, path,
      headers: { Accept: "application/json" },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────

test("S4-b routes: GET /api/runs/:runId/memory with recorded → 200 + record", async () => {
  await withServer({}, async ({ port, ledger, auditCalls }) => {
    runMemory.recordRunMemory({
      runId: "run-A", inputs: { goal: "review auth" }, ledger, env: {},
      deploymentProfile: { publicSector: false },
      clockFn: () => "2026-05-05T00:00:00Z",
    });
    const res = await httpGet(port, "/api/runs/run-A/memory");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.runId, "run-A");
    assert.equal(res.body.recordedAt, "2026-05-05T00:00:00Z");
    assert.equal(res.body.memory.fields.goal, "review auth");
    // Audit fired with found:true
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].verb, "run_memory_accessed");
    assert.equal(auditCalls[0].data.found, true);
    assert.equal(auditCalls[0].data.runId, "run-A");
    assert.equal(auditCalls[0].data.recordedAt, "2026-05-05T00:00:00Z");
    assert.equal(auditCalls[0].data.truncated, false);
    assert.equal(auditCalls[0].data.redacted, false);
  });
});

test("S4-b routes: 404 when runId has no run_memory_recorded → audit STILL emits", async () => {
  await withServer({}, async ({ port, auditCalls }) => {
    const res = await httpGet(port, "/api/runs/run-B/memory");
    assert.equal(res.status, 404);
    assert.equal(res.body.error, "not_found");
    assert.equal(res.body.runId, "run-B");
    // Audit fires even on 404 — operator tracking sees "tried to
    // read run-B but no memory was there"
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].data.found, false);
    assert.equal(auditCalls[0].data.runId, "run-B");
  });
});

test("S4-b routes: 404 audit data does NOT carry record metadata", async () => {
  await withServer({}, async ({ port, auditCalls }) => {
    await httpGet(port, "/api/runs/missing-run/memory");
    assert.equal(auditCalls[0].data.recordedAt, undefined);
    assert.equal(auditCalls[0].data.truncated, undefined);
  });
});

test("S4-b routes: 400 on malformed runId — NO audit emit", async () => {
  await withServer({}, async ({ port, auditCalls }) => {
    // Path traversal attempt
    const res = await httpGet(port, "/api/runs/..%2Fetc%2Fpasswd/memory");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_run_id");
    // Audit does NOT fire on 400 — that's an operator UI bug, not a
    // forensic event. Plan §S §S-SMART-4 doc's audit policy.
    assert.equal(auditCalls.length, 0);
  });
});

test("S4-b routes: 400 on empty runId is unreachable (express path won't match) — make sure long ID still 400s", async () => {
  await withServer({}, async ({ port }) => {
    // 130-char runId — over 128 cap
    const longId = "x".repeat(130);
    const res = await httpGet(port, `/api/runs/${longId}/memory`);
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "invalid_run_id");
  });
});

test("S4-b routes: 503 when ledger.read throws", async () => {
  const brokenLedger = {
    read() { throw new Error("ledger I/O fail"); },
  };
  await withServer({ ledgerOverrides: brokenLedger }, async ({ port, auditCalls }) => {
    const res = await httpGet(port, "/api/runs/run-X/memory");
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "ledger_unavailable");
    // 503 still emits audit with error metadata
    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].data.found, false);
    assert.equal(auditCalls[0].data.error, "ledger_read_failed");
  });
});

test("S4-b routes: missing evidenceLedger dep → router stubs 503 every call", async () => {
  const app = express();
  // No deps at all
  app.use("/api", createRunMemoryRoutes({}));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    const res = await httpGet(port, "/api/runs/anything/memory");
    assert.equal(res.status, 503);
    assert.equal(res.body.error, "ledger_unavailable");
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("S4-b routes: throwing auditFn → route still 200 (defensive)", async () => {
  await withServer({ auditTracking: "throw" }, async ({ port, ledger }) => {
    runMemory.recordRunMemory({
      runId: "run-T", inputs: { goal: "x" }, ledger, env: {},
      deploymentProfile: { publicSector: false },
    });
    const res = await httpGet(port, "/api/runs/run-T/memory");
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
  });
});

test("S4-b routes: missing auditFn → route still works, no audit dropped silently", async () => {
  await withServer({ auditTracking: "skip" }, async ({ port, ledger }) => {
    runMemory.recordRunMemory({
      runId: "run-S", inputs: { goal: "x" }, ledger, env: {},
      deploymentProfile: { publicSector: false },
    });
    const res = await httpGet(port, "/api/runs/run-S/memory");
    assert.equal(res.status, 200);
  });
});

test("S4-b routes: public-sector recorded record arrives ALREADY redacted", async () => {
  await withServer({}, async ({ port, ledger }) => {
    runMemory.recordRunMemory({
      runId: "run-PS",
      inputs: { goal: "review jane.doe@example.com config" },
      ledger, env: {},
      deploymentProfile: { publicSector: true },
    });
    const res = await httpGet(port, "/api/runs/run-PS/memory");
    assert.equal(res.status, 200);
    // Raw email NEVER on the wire — recorder did the redact at write
    assert.ok(!JSON.stringify(res.body).includes("jane.doe@example.com"));
    assert.ok(res.body.memory.fields.goal.includes("[REDACTED:email]"));
    assert.equal(res.body.memory.redacted, true);
    assert.ok(res.body.memory.redactedTypes.includes("email"));
  });
});

test("S4-b routes: latest record wins when multiple recorded", async () => {
  await withServer({}, async ({ port, ledger }) => {
    runMemory.recordRunMemory({
      runId: "run-M", inputs: { goal: "first" }, ledger, env: {},
      deploymentProfile: { publicSector: false },
      clockFn: () => "T1",
    });
    runMemory.recordRunMemory({
      runId: "run-M", inputs: { goal: "second" }, ledger, env: {},
      deploymentProfile: { publicSector: false },
      clockFn: () => "T2",
    });
    const res = await httpGet(port, "/api/runs/run-M/memory");
    assert.equal(res.status, 200);
    assert.equal(res.body.memory.fields.goal, "second");
    assert.equal(res.body.recordedAt, "T2");
  });
});

test("S4-b routes: truncated record metadata propagates through to audit", async () => {
  await withServer({}, async ({ port, ledger, auditCalls }) => {
    runMemory.recordRunMemory({
      runId: "run-Tr",
      inputs: { goal: "g".repeat(500), changeSummary: "x" },
      ledger, env: {},
      deploymentProfile: { publicSector: false },
    });
    const res = await httpGet(port, "/api/runs/run-Tr/memory");
    assert.equal(res.status, 200);
    assert.equal(res.body.memory.truncated, true);
    assert.equal(auditCalls[0].data.truncated, true);
  });
});

test("S4-b routes: opt-out ledger has only an opt-out marker → 404", async () => {
  // recordRunMemory with opt-out env never appends; getRunMemory
  // returns null; route 404s.
  await withServer({}, async ({ port, ledger }) => {
    runMemory.recordRunMemory({
      runId: "run-OptOut",
      inputs: { goal: "x" }, ledger,
      env: { ORCHESTRATOR_RUN_MEMORY_DISABLE: "1" },
      deploymentProfile: { publicSector: false },
    });
    const res = await httpGet(port, "/api/runs/run-OptOut/memory");
    assert.equal(res.status, 404);
  });
});
