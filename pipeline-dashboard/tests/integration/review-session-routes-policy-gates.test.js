// Slice S2-b (Phase 2 / SMART-2, 2026-05-05) — review-session routes
// pre-state hard-gate integration tests.
//
// Key invariants pinned:
//   1. State-immutability: hard block leaves manager state UNCHANGED
//      and runner is NOT invoked.
//   2. Single audit emit: hard block emits exactly ONE policy_gate_blocked
//      audit entry; dispatcher's *_failed audit must NOT cascade.
//   3. Warn mode default: PII detected under standard posture without
//      ORCHESTRATOR_HARD_GATES=1 → 200 + warn audit + dispatcher proceeds.
//   4. Public-sector + warn: PII detected → 200 + warn audit (operator
//      dashboard renders toast; runner-side GOV-PII-0 is the safety net).
//   5. Public-sector + hard: PII detected → 409 + blocked audit + state
//      preserved + runner not invoked.
//
// Per-test http server pattern (matches review-relay-spawn.test.js).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { ReviewSessionManager } = require("../../src/runtime/reviewSessionManager");
const { ReviewSpawnDispatcher } = require("../../src/runtime/reviewSpawnDispatcher");
const { createReviewSessionRoutes } = require("../../src/routes/reviewSessionRoutes");

// ── Test fixtures ──────────────────────────────────────────────────

function fakeRunner({ ok = true, exitCode = 0, error = null } = {}) {
  const calls = [];
  return {
    calls,
    async exec(prompt, opts) {
      calls.push({ prompt, opts });
      if (error) return { ok: false, error };
      return { ok, exitCode };
    },
  };
}

function recordingAudit() {
  const events = [];
  const fn = (verb, data) => events.push({ verb, data });
  fn.events = events;
  return fn;
}

async function withServer({
  deploymentProfile = null,
  withDispatcher = true,
  hardGates = false,
} = {}, fn) {
  // Save + override env so resolveGateMode() reads the right value
  // for the duration of this test.
  const savedHardGates = process.env.ORCHESTRATOR_HARD_GATES;
  if (hardGates) process.env.ORCHESTRATOR_HARD_GATES = "1";
  else delete process.env.ORCHESTRATOR_HARD_GATES;

  try {
    const audit = recordingAudit();
    const manager = new ReviewSessionManager({
      auditFn: audit,
      clockFn: () => Date.now(),
    });
    const codexRunner = fakeRunner();
    const claudeRunner = fakeRunner();
    const dispatcher = withDispatcher
      ? new ReviewSpawnDispatcher({
          reviewSessionManager: manager,
          codexRunner, claudeRunner,
          auditFn: audit,
          deploymentProfile,
        })
      : null;
    const app = express();
    app.use("/api", createReviewSessionRoutes({
      reviewSessionManager: manager,
      deploymentProfile,
      reviewSpawnDispatcher: dispatcher,
      auditFn: audit,
    }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    try {
      await fn({
        port, manager, dispatcher, codexRunner, claudeRunner, audit, server,
      });
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    if (savedHardGates === undefined) delete process.env.ORCHESTRATOR_HARD_GATES;
    else process.env.ORCHESTRATOR_HARD_GATES = savedHardGates;
  }
}

async function httpJson(method, port, path, body) {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const init = {
    method, host: "127.0.0.1", port, path,
    headers: {
      "Accept": "application/json",
      ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}),
    },
  };
  return await new Promise((resolve, reject) => {
    const req = http.request(init, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed, raw });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function flushPromises() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

// ── Standard posture (publicSector=false) — warn-only behavior ────

test("S2-b: standard mode, no PII, send-codex → 200 + NO policy audit", async () => {
  await withServer({ deploymentProfile: null }, async ({ port, audit, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review the auth flow" });
    assert.equal(send.status, 200);
    assert.equal(send.body.dispatched, true);
    await flushPromises();
    // No policy_gate_* audit because no PII detected
    const policyAudits = audit.events.filter((e) =>
      e.verb === "policy_gate_blocked" || e.verb === "policy_gate_warn");
    assert.equal(policyAudits.length, 0);
    assert.equal(codexRunner.calls.length, 1);
  });
});

test("S2-b: standard mode + PII detected → 200 + policy_gate_warn audit + dispatcher proceeds", async () => {
  await withServer({ deploymentProfile: { publicSector: false } }, async ({ port, audit, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review john.doe@example.com configuration" });
    assert.equal(send.status, 200, "warn mode lets request through");
    assert.equal(send.body.dispatched, true);
    await flushPromises();
    const warnAudits = audit.events.filter((e) => e.verb === "policy_gate_warn");
    assert.equal(warnAudits.length, 1, "exactly one policy_gate_warn audit emitted");
    assert.equal(warnAudits[0].data.gate, "pii_block");
    assert.ok(warnAudits[0].data.findingTypes.includes("email"));
    assert.equal(warnAudits[0].data.publicSector, false);
    // Dispatcher still ran
    assert.equal(codexRunner.calls.length, 1);
  });
});

// ── Public-sector + warn mode (default) ──────────────────────────

test("S2-b: public-sector + warn (default) + PII → 200 + policy_gate_warn + state advanced", async () => {
  // Default mode is warn even under public-sector, per plan §S §S-SMART-2
  // graduated rollout (operators must opt into hard explicitly).
  await withServer({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    hardGates: false,
  }, async ({ port, audit, manager, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review jane.doe@example.com profile" });
    assert.equal(send.status, 200);
    assert.equal(send.body.dispatched, true);
    await flushPromises();
    // policy_gate_warn fired (audit), but state did advance + runner ran.
    const warns = audit.events.filter((e) => e.verb === "policy_gate_warn");
    assert.equal(warns.length, 1);
    assert.equal(warns[0].data.publicSector, true);
    assert.equal(manager.get(id).state, "awaiting_critique");
    assert.equal(codexRunner.calls.length, 1);
  });
});

// ── Public-sector + HARD mode — the headline behavior ────────────

test("S2-b: public-sector + HARD + PII → 409 + policy_gate_blocked + state UNCHANGED + runner NOT invoked", async () => {
  await withServer({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    hardGates: true,
  }, async ({ port, audit, manager, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const beforeState = manager.get(id).state;
    assert.equal(beforeState, "created");

    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review jane.doe@example.com profile" });
    await flushPromises();

    // 1. HTTP 409 with policy_gate_blocked error code
    assert.equal(send.status, 409);
    assert.equal(send.body.error, "policy_gate_blocked");
    assert.equal(send.body.gate, "pii_block");
    assert.equal(send.body.reason, "pii_detected");
    assert.equal(send.body.mode, "hard");
    assert.ok(Array.isArray(send.body.findings.findingTypes));
    assert.ok(send.body.findings.findingTypes.includes("email"));

    // 2. Audit single-emit invariant: exactly one policy_gate_blocked,
    //    and NO review_session_dispatch_failed cascade.
    const blocked = audit.events.filter((e) => e.verb === "policy_gate_blocked");
    assert.equal(blocked.length, 1, "exactly one policy_gate_blocked audit");
    const dispatchFails = audit.events.filter((e) =>
      e.verb === "review_session_dispatch_failed"
      || e.verb === "review_session_dispatch_started");
    assert.equal(dispatchFails.length, 0, "dispatcher MUST NOT have cascaded");

    // 3. State-immutability invariant: manager state unchanged
    assert.equal(manager.get(id).state, "created", "state machine unchanged");

    // 4. Runner not invoked
    assert.equal(codexRunner.calls.length, 0, "runner NOT invoked");
  });
});

test("S2-b: public-sector + HARD + clean instruction → 200 + dispatcher runs", async () => {
  await withServer({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    hardGates: true,
  }, async ({ port, audit, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review the auth flow" });
    assert.equal(send.status, 200);
    assert.equal(send.body.dispatched, true);
    await flushPromises();
    // No policy audit fired (NOT_APPLICABLE → no audit)
    const policyAudits = audit.events.filter((e) =>
      e.verb === "policy_gate_blocked" || e.verb === "policy_gate_warn");
    assert.equal(policyAudits.length, 0);
    assert.equal(codexRunner.calls.length, 1);
  });
});

// ── follow-up route ──────────────────────────────────────────────

test("S2-b: follow-up + public-sector + HARD + PII in question → 409 + state UNCHANGED", async () => {
  await withServer({
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
    hardGates: true,
  }, async ({ port, audit, manager, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    // First send-codex with clean text to get session into a follow-up-able state
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first review" });
    await flushPromises();
    const stateBefore = manager.get(id).state;

    const followUp = await httpJson("POST", port, `/api/review-sessions/${id}/follow-up`,
      { question: "what about jane.doe@example.com permissions?", target: "codex" });
    await flushPromises();

    assert.equal(followUp.status, 409);
    assert.equal(followUp.body.error, "policy_gate_blocked");

    // State machine still at the post-send-codex state
    assert.equal(manager.get(id).state, stateBefore);

    // policy_gate_blocked emitted exactly once
    const blocked = audit.events.filter((e) => e.verb === "policy_gate_blocked");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].data.source, "follow_up_question");

    // Codex was called exactly once for first send-codex; follow-up
    // must NOT have invoked it again.
    assert.equal(codexRunner.calls.length, 1);
  });
});

test("S2-b: follow-up + standard + PII → 200 + warn audit + dispatch", async () => {
  await withServer({
    deploymentProfile: { publicSector: false },
    hardGates: false,
  }, async ({ port, audit, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first" });
    await flushPromises();

    const followUp = await httpJson("POST", port, `/api/review-sessions/${id}/follow-up`,
      { question: "anything about admin@company.com?", target: "codex" });
    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.dispatched, true);
    await flushPromises();
    // Two warn audits: one for send-codex (clean, no), one for follow-up (PII)
    const warns = audit.events.filter((e) => e.verb === "policy_gate_warn");
    assert.equal(warns.length, 1);  // only follow-up has PII
    assert.equal(warns[0].data.source, "follow_up_question");
    assert.equal(codexRunner.calls.length, 2);
  });
});

// ── hand-back-claude route ───────────────────────────────────────

test("S2-b: hand-back-claude + public-sector + HARD + PII → 409 + state UNCHANGED + claude runner NOT invoked", async () => {
  // Note: public-sector + allowLocalExecutor=false also triggers the
  // existing 409 posture gate. We use allowLocalExecutor=true so the
  // posture gate doesn't intercept first — hard gate wins.
  await withServer({
    deploymentProfile: { publicSector: true, allowLocalExecutor: true },
    hardGates: true,
  }, async ({ port, audit, manager, claudeRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review" });
    await flushPromises();
    manager.recordCritiqueReceived(id, {
      summary: "found issues",
      severityCounts: { critical: 0, high: 0, medium: 1, low: 0, note: 0 },
    });
    const stateBefore = manager.get(id).state;
    assert.equal(stateBefore, "critique_received");

    const handBack = await httpJson("POST", port, `/api/review-sessions/${id}/hand-back-claude`,
      { instruction: "fix issues for user jane.doe@example.com" });
    await flushPromises();

    assert.equal(handBack.status, 409);
    assert.equal(handBack.body.error, "policy_gate_blocked");
    assert.equal(handBack.body.gate, "pii_block");

    // State still at critique_received (NOT advanced to awaiting_claude)
    assert.equal(manager.get(id).state, "critique_received");

    // Claude runner not invoked
    assert.equal(claudeRunner.calls.length, 0);

    // Single audit
    const blocked = audit.events.filter((e) => e.verb === "policy_gate_blocked");
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].data.source, "hand_back_instruction");
  });
});

// ── Empty / null instructions don't blow up the gate ─────────────

test("S2-b: empty instruction → gate NOT_APPLICABLE → falls through to manager error", async () => {
  await withServer({
    deploymentProfile: { publicSector: true },
    hardGates: true,
  }, async ({ port, audit, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "" });
    // Manager rejects empty instruction with its own 400; gate didn't block.
    assert.notEqual(send.status, 409);
    assert.notEqual(send.body && send.body.error, "policy_gate_blocked");
    await flushPromises();
    const policyAudits = audit.events.filter((e) =>
      e.verb === "policy_gate_blocked" || e.verb === "policy_gate_warn");
    assert.equal(policyAudits.length, 0);
    // State stays "created" (manager rejected the input shape)
    assert.equal(manager.get(id).state, "created");
  });
});

test("S2-b: missing instruction body field → gate NOT_APPLICABLE", async () => {
  await withServer({
    deploymentProfile: { publicSector: true },
    hardGates: true,
  }, async ({ port, audit }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { /* no instruction */ });
    // Manager rejects missing instruction with 400.
    assert.notEqual(send.status, 409);
    await flushPromises();
    const policyAudits = audit.events.filter((e) =>
      e.verb === "policy_gate_blocked" || e.verb === "policy_gate_warn");
    assert.equal(policyAudits.length, 0);
  });
});

// ── auditFn missing → gate decision still applies ────────────────

test("S2-b: WITHOUT auditFn, blocked decision still 409 (audit silently dropped)", async () => {
  // Build server without auditFn dep
  const savedHardGates = process.env.ORCHESTRATOR_HARD_GATES;
  process.env.ORCHESTRATOR_HARD_GATES = "1";
  try {
    const manager = new ReviewSessionManager({});
    const codexRunner = fakeRunner();
    const dispatcher = new ReviewSpawnDispatcher({
      reviewSessionManager: manager,
      codexRunner,
      deploymentProfile: { publicSector: true },
    });
    const app = express();
    app.use("/api", createReviewSessionRoutes({
      reviewSessionManager: manager,
      deploymentProfile: { publicSector: true },
      reviewSpawnDispatcher: dispatcher,
      // no auditFn
    }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    try {
      const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
      const id = create.body.session.sessionId;
      const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
        { instruction: "review jane.doe@example.com" });
      assert.equal(send.status, 409);
      assert.equal(send.body.error, "policy_gate_blocked");
      assert.equal(manager.get(id).state, "created");
      assert.equal(codexRunner.calls.length, 0);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    if (savedHardGates === undefined) delete process.env.ORCHESTRATOR_HARD_GATES;
    else process.env.ORCHESTRATOR_HARD_GATES = savedHardGates;
  }
});

test("S2-b: auditFn that THROWS does not break the route", async () => {
  const savedHardGates = process.env.ORCHESTRATOR_HARD_GATES;
  delete process.env.ORCHESTRATOR_HARD_GATES;  // warn mode
  try {
    const manager = new ReviewSessionManager({});
    const codexRunner = fakeRunner();
    const dispatcher = new ReviewSpawnDispatcher({
      reviewSessionManager: manager,
      codexRunner,
      deploymentProfile: { publicSector: false },
    });
    const throwingAudit = () => { throw new Error("audit DB down"); };
    const app = express();
    app.use("/api", createReviewSessionRoutes({
      reviewSessionManager: manager,
      deploymentProfile: { publicSector: false },
      reviewSpawnDispatcher: dispatcher,
      auditFn: throwingAudit,
    }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    try {
      const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
      const id = create.body.session.sessionId;
      const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
        { instruction: "review jane.doe@example.com profile" });
      // Warn mode + throwing audit → route still 200
      assert.equal(send.status, 200);
      assert.equal(send.body.dispatched, true);
    } finally {
      await new Promise((r) => server.close(r));
    }
  } finally {
    if (savedHardGates === undefined) delete process.env.ORCHESTRATOR_HARD_GATES;
    else process.env.ORCHESTRATOR_HARD_GATES = savedHardGates;
  }
});

// ── Smart-3 preset still validates BEFORE policy gate ────────────

test("S2-b: invalid preset short-circuits at 400 BEFORE policy gate runs", async () => {
  await withServer({
    deploymentProfile: { publicSector: true },
    hardGates: true,
  }, async ({ port, audit }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T" });
    const id = create.body.session.sessionId;
    // Both invalid preset AND PII — preset wins (validates first).
    const send = await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review jane.doe@example.com", preset: "nonsense" });
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_preset");
    await flushPromises();
    // No policy audit because preset short-circuited
    const policyAudits = audit.events.filter((e) =>
      e.verb === "policy_gate_blocked" || e.verb === "policy_gate_warn");
    assert.equal(policyAudits.length, 0);
  });
});
