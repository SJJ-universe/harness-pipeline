// Slice S3-c (Phase 2 / SMART-3, 2026-05-04) — review-session routes
// preset body validation + GET /api/review-presets discovery endpoint.
//
// Focus area: routes-layer surface ONLY. Dispatcher behavior is
// covered by tests/unit/reviewSpawnDispatcher.preset.test.js. Manager
// state-machine behavior is covered by reviewSessionManager tests.
//
// What's exercised here:
//   - GET /api/review-presets shape (schema + 6 summaries)
//   - POST send-codex with shorthand string preset
//   - POST send-codex with object form { presetId: "..." }
//   - POST send-codex with unknown presetId → 400 + invalid_preset
//   - POST send-codex with malformed preset (array, number) → 400
//   - POST send-codex with no preset (legacy) preserved
//   - presetId surfaces back in response payload
//   - All 3 dispatch routes (send-codex / follow-up / hand-back-claude)
//     accept preset
//   - Preset rejection happens BEFORE state transition (manager not
//     advanced when preset is invalid)
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
const presetLibrary = require("../../src/runtime/presetLibrary");

// ── Test fixtures ──────────────────────────────────────────────────

function fakeRunner({ ok = true, exitCode = 0, error = null, delayMs = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async exec(prompt, opts) {
      calls.push({ prompt, opts });
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
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

async function withServer({ deploymentProfile = null, withDispatcher = true } = {}, fn) {
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
      res.on("data", (chunk) => { raw += chunk; });
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

// ── GET /api/review-presets ─────────────────────────────────────────

test("S3-c routes: GET /api/review-presets returns schema + 6 summaries", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpJson("GET", port, "/api/review-presets");
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, presetLibrary.SCHEMA);
    assert.equal(res.body.presets.length, 6);
    const ids = res.body.presets.map((p) => p.presetId).sort();
    assert.deepEqual(ids, [
      "accuracy", "performance", "privacy",
      "public-sector-audit", "release", "security",
    ]);
    // Sanity: NO system prompt fields (avoid leaking full prompt to UI)
    for (const p of res.body.presets) {
      assert.equal(p.codexSystemPrompt, undefined);
      assert.equal(p.claudeSystemPrompt, undefined);
      assert.equal(p.severityTagInstruction, undefined);
      assert.ok(typeof p.defaultLabel === "string");
      assert.ok(typeof p.defaultDescription === "string");
    }
  });
});

// ── POST /:id/send-codex preset acceptance ─────────────────────────

test("S3-c routes: send-codex without preset preserves legacy 200 + null presetId", async () => {
  await withServer({}, async ({ port, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T1" });
    assert.equal(create.status, 201);
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "review the plan" },
    );
    assert.equal(send.status, 200);
    assert.equal(send.body.ok, true);
    assert.equal(send.body.presetId, null);
    assert.equal(send.body.dispatched, true);
    await flushPromises();
    assert.equal(codexRunner.calls.length, 1);
    assert.ok(!codexRunner.calls[0].prompt.includes("[Preset:"));
  });
});

test("S3-c routes: send-codex with shorthand string preset injects header", async () => {
  await withServer({}, async ({ port, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T2" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "find vulnerabilities", preset: "security" },
    );
    assert.equal(send.status, 200);
    assert.equal(send.body.presetId, "security");
    await flushPromises();
    assert.ok(codexRunner.calls[0].prompt.startsWith("[Preset: Security]"),
      "prompt opens with preset header");
  });
});

test("S3-c routes: send-codex with object preset { presetId } also accepted", async () => {
  await withServer({}, async ({ port, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T3" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: { presetId: "privacy" } },
    );
    assert.equal(send.status, 200);
    assert.equal(send.body.presetId, "privacy");
    await flushPromises();
    assert.ok(codexRunner.calls[0].prompt.startsWith("[Preset: Privacy]"));
  });
});

test("S3-c routes: send-codex with unknown preset → 400 invalid_preset BEFORE state transition", async () => {
  await withServer({}, async ({ port, manager, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T4" });
    const id = create.body.session.sessionId;
    const initialState = manager.get(id).state;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: "nonsense-preset" },
    );
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_preset");
    assert.ok(Array.isArray(send.body.knownPresetIds));
    assert.equal(send.body.knownPresetIds.length, 6);
    // CRITICAL: state machine NOT advanced
    assert.equal(manager.get(id).state, initialState,
      "state must be unchanged on invalid preset");
    // Runner not invoked
    assert.equal(codexRunner.calls.length, 0);
  });
});

test("S3-c routes: send-codex with malformed preset (array) → 400 invalid_input", async () => {
  await withServer({}, async ({ port, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T5" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: ["security"] },
    );
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_input");
    assert.equal(manager.get(id).state, "created");
  });
});

test("S3-c routes: send-codex with malformed preset (number) → 400 invalid_input", async () => {
  await withServer({}, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T6" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: 42 },
    );
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_input");
  });
});

test("S3-c routes: send-codex with object form non-string presetId → 400 invalid_input", async () => {
  await withServer({}, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T7" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: { presetId: 123 } },
    );
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_input");
  });
});

test("S3-c routes: send-codex with object form unknown presetId → 400 invalid_preset", async () => {
  await withServer({}, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T8" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: { presetId: "definitely-not-a-preset" } },
    );
    assert.equal(send.status, 400);
    assert.equal(send.body.error, "invalid_preset");
  });
});

test("S3-c routes: send-codex with preset:null is identical to omission", async () => {
  await withServer({}, async ({ port, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T9" });
    const id = create.body.session.sessionId;
    const send = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: null },
    );
    assert.equal(send.status, 200);
    assert.equal(send.body.presetId, null);
    await flushPromises();
    assert.ok(!codexRunner.calls[0].prompt.includes("[Preset:"));
  });
});

// ── POST /:id/follow-up preset acceptance ──────────────────────────

test("S3-c routes: follow-up target=codex with preset injects header", async () => {
  await withServer({}, async ({ port, codexRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T10" });
    const id = create.body.session.sessionId;
    // Move to a state where follow-up is allowed
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first" });
    await flushPromises();
    const followUp = await httpJson(
      "POST", port, `/api/review-sessions/${id}/follow-up`,
      { question: "any data races?", target: "codex", preset: "performance" },
    );
    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.presetId, "performance");
    await flushPromises();
    // Two calls: send-codex + follow-up. Last is follow-up.
    const fp = codexRunner.calls[codexRunner.calls.length - 1].prompt;
    assert.ok(fp.startsWith("[Preset: Performance]"));
  });
});

test("S3-c routes: follow-up target=claude with preset still accepted (state-only)", async () => {
  await withServer({}, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T11" });
    const id = create.body.session.sessionId;
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first" });
    await flushPromises();
    const followUp = await httpJson(
      "POST", port, `/api/review-sessions/${id}/follow-up`,
      { question: "?", target: "claude", preset: "accuracy" },
    );
    assert.equal(followUp.status, 200);
    assert.equal(followUp.body.dispatched, false);
    // presetId echoed back even though no dispatch
    assert.equal(followUp.body.presetId, "accuracy");
  });
});

test("S3-c routes: follow-up with unknown preset → 400, manager NOT advanced", async () => {
  await withServer({}, async ({ port, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T12" });
    const id = create.body.session.sessionId;
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first" });
    await flushPromises();
    const stateBeforeFollow = manager.get(id).state;
    const followUp = await httpJson(
      "POST", port, `/api/review-sessions/${id}/follow-up`,
      { question: "?", target: "codex", preset: "x-bad" },
    );
    assert.equal(followUp.status, 400);
    assert.equal(followUp.body.error, "invalid_preset");
    // State machine unchanged (no transition into a follow-up history)
    const stateAfter = manager.get(id);
    // The follow-up never got recorded because the route bailed.
    assert.equal(stateAfter.state, stateBeforeFollow);
  });
});

// ── POST /:id/hand-back-claude preset acceptance ────────────────────

test("S3-c routes: hand-back-claude with preset injects claude system prompt", async () => {
  await withServer({}, async ({ port, claudeRunner, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T13" });
    const id = create.body.session.sessionId;
    await httpJson("POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "first" });
    await flushPromises();
    // Manually push to critique_received state so hand-back is valid.
    manager.recordCritiqueReceived(id, {
      summary: "Found SQL injection.",
      severityCounts: { critical: 1, high: 0, medium: 0, low: 0, note: 0 },
    });

    const handBack = await httpJson(
      "POST", port, `/api/review-sessions/${id}/hand-back-claude`,
      { instruction: "fix the injection", preset: "security" },
    );
    assert.equal(handBack.status, 200);
    assert.equal(handBack.body.presetId, "security");
    await flushPromises();
    assert.equal(claudeRunner.calls.length, 1);
    assert.ok(claudeRunner.calls[0].prompt.startsWith("[Preset: Security]"));
  });
});

test("S3-c routes: hand-back-claude with invalid preset → 400 BEFORE posture/state check", async () => {
  await withServer({}, async ({ port, manager, claudeRunner }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T14" });
    const id = create.body.session.sessionId;
    const stateBefore = manager.get(id).state;
    const handBack = await httpJson(
      "POST", port, `/api/review-sessions/${id}/hand-back-claude`,
      { instruction: "x", preset: "x-not-real" },
    );
    assert.equal(handBack.status, 400);
    assert.equal(handBack.body.error, "invalid_preset");
    assert.equal(manager.get(id).state, stateBefore);
    assert.equal(claudeRunner.calls.length, 0);
  });
});

test("S3-c routes: hand-back-claude under public-sector posture → 409 (preset OK first)", async () => {
  // Preset validation happens BEFORE posture check. So a valid preset
  // + public-sector posture still gets 409 from posture, but an invalid
  // preset on the same request would 400.
  const ps = { publicSector: true, allowLocalExecutor: false };
  await withServer({ deploymentProfile: ps }, async ({ port, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T15" });
    const id = create.body.session.sessionId;
    const handBack = await httpJson(
      "POST", port, `/api/review-sessions/${id}/hand-back-claude`,
      { instruction: "x", preset: "security" },
    );
    assert.equal(handBack.status, 409);
    assert.equal(handBack.body.error, "public_sector_local_executor_disabled");
  });
});

test("S3-c routes: hand-back-claude under public-sector + bad preset → 400 preset (preset checked first)", async () => {
  const ps = { publicSector: true, allowLocalExecutor: false };
  await withServer({ deploymentProfile: ps }, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T16" });
    const id = create.body.session.sessionId;
    const handBack = await httpJson(
      "POST", port, `/api/review-sessions/${id}/hand-back-claude`,
      { instruction: "x", preset: "x-not-real" },
    );
    assert.equal(handBack.status, 400);
    assert.equal(handBack.body.error, "invalid_preset");
  });
});

// ── Audit chain wiring ─────────────────────────────────────────────

test("S3-c routes: presetId reaches audit chain via dispatcher", async () => {
  await withServer({}, async ({ port, audit }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T17" });
    const id = create.body.session.sessionId;
    await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: "release" },
    );
    await flushPromises();
    const started = audit.events.find((e) => e.verb === "review_session_dispatch_started");
    assert.ok(started);
    assert.equal(started.data.presetId, "release");
  });
});

// ── No-dispatcher mode (legacy compat) ─────────────────────────────

test("S3-c routes: WITHOUT dispatcher, preset still validated; route returns 200 even though no spawn", async () => {
  await withServer({ withDispatcher: false }, async ({ port }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T18" });
    const id = create.body.session.sessionId;
    // valid preset
    const ok = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: "accuracy" },
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.body.dispatched, false);
    assert.equal(ok.body.presetId, "accuracy");
  });
});

test("S3-c routes: WITHOUT dispatcher, invalid preset still 400", async () => {
  await withServer({ withDispatcher: false }, async ({ port, manager }) => {
    const create = await httpJson("POST", port, "/api/review-sessions", { label: "T19" });
    const id = create.body.session.sessionId;
    const stateBefore = manager.get(id).state;
    const bad = await httpJson(
      "POST", port, `/api/review-sessions/${id}/send-codex`,
      { instruction: "x", preset: "fake-one" },
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "invalid_preset");
    assert.equal(manager.get(id).state, stateBefore);
  });
});
