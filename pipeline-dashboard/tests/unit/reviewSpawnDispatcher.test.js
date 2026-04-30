// Slice UI-H7-f (Phase D / Phase E1.5, 2026-04-30) — review-session
// spawn dispatcher unit tests.
//
// Pins:
//   - Constructor validation (manager required)
//   - Action types: dispatchCodex / dispatchClaude / dispatchFollowUpCodex
//   - Pre-flight gates: session not found / archived / runner missing /
//     in-flight collision / public-sector posture for Claude only /
//     invalid input
//   - In-flight tracking: get / isInFlight / snapshot / size
//   - Audit emission: dispatch_started / completed / failed / blocked
//   - Fire-and-forget: route returns immediately, runner runs in BG
//   - In-flight cleared on completion (success OR failure OR throw)
//   - Prompt builders include session label + instruction + (Claude) critique

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ReviewSpawnDispatcher, ACTION_TYPES, DISPATCH_ERROR_CODES,
  DISPATCH_AUDIT_VERBS,
} = require("../../src/runtime/reviewSpawnDispatcher");
const {
  ReviewSessionManager,
} = require("../../src/runtime/reviewSessionManager");

// ── Fakes ────────────────────────────────────────────────────────

function makeManagerWithSession(sessionState = "created", overrides = {}) {
  const manager = new ReviewSessionManager();
  const session = manager.create({
    initialPlan: "test plan body", label: "test session",
    ...overrides,
  });
  // Force the state to match what the routes would have transitioned
  // to before calling the dispatcher (sendCodex → AWAITING_CRITIQUE,
  // handBackClaude → AWAITING_CLAUDE).
  if (sessionState !== "created") {
    manager._sessions.get(session.sessionId).state = sessionState;
  }
  return { manager, sessionId: session.sessionId };
}

function makeFakeRunner({ result = { ok: true }, throwOnExec = false } = {}) {
  const calls = [];
  return {
    calls,
    exec: async (prompt, opts) => {
      calls.push({ prompt, opts });
      if (throwOnExec) throw new Error("runner exploded");
      return result;
    },
  };
}

function captureAudit() {
  const calls = [];
  return {
    auditFn: (verb, data) => calls.push({ verb, data }),
    calls,
    findVerbs(verb) { return calls.filter((c) => c.verb === verb); },
  };
}

// Wait for the dispatcher's async fire-and-forget to settle. Calling
// twice covers Promise resolution + the .then handler.
async function settle() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

// ── Construction guards ──────────────────────────────────────────

test("UI-H7-f: constructor requires reviewSessionManager", () => {
  assert.throws(() => new ReviewSpawnDispatcher({}),
    /reviewSessionManager with .get\(\) is required/);
  assert.throws(() => new ReviewSpawnDispatcher({ reviewSessionManager: {} }),
    /reviewSessionManager with .get\(\) is required/);
});

test("UI-H7-f: ACTION_TYPES + DISPATCH_AUDIT_VERBS are frozen exports", () => {
  assert.equal(ACTION_TYPES.SEND_CODEX, "send-codex");
  assert.equal(ACTION_TYPES.HAND_BACK_CLAUDE, "hand-back-claude");
  assert.equal(ACTION_TYPES.FOLLOW_UP_CODEX, "follow-up-codex");
  assert.ok(Object.isFrozen(ACTION_TYPES));
  assert.ok(Object.isFrozen(DISPATCH_AUDIT_VERBS));
  assert.equal(DISPATCH_AUDIT_VERBS.length, 4);
  assert.deepEqual([...DISPATCH_AUDIT_VERBS], [
    "review_session_dispatch_started",
    "review_session_dispatch_completed",
    "review_session_dispatch_failed",
    "review_session_dispatch_blocked",
  ]);
});

// ── dispatchCodex happy path ─────────────────────────────────────

test("UI-H7-f: dispatchCodex spawns runner with reviewSessionId hint", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner();
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: audit.auditFn,
  });

  const ack = await d.dispatchCodex(sessionId, { instruction: "Security review" });
  assert.equal(ack.ok, true);
  assert.equal(ack.actionType, "send-codex");
  assert.equal(ack.runner, "codex");
  assert.ok(Number.isFinite(ack.startedAt));

  // Runner was invoked with reviewSessionId hint
  await settle();
  assert.equal(codex.calls.length, 1);
  assert.equal(codex.calls[0].opts.reviewSessionId, sessionId);
  assert.match(codex.calls[0].prompt, /Security review/);
  assert.match(codex.calls[0].prompt, /test session/);  // label
  assert.match(codex.calls[0].prompt, /test plan body/);  // initialPlan
});

test("UI-H7-f: dispatchCodex emits dispatch_started + dispatch_completed audit", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner({ result: { ok: true } });
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: audit.auditFn,
  });

  await d.dispatchCodex(sessionId, { instruction: "x" });
  await settle();

  const started = audit.findVerbs("review_session_dispatch_started");
  const completed = audit.findVerbs("review_session_dispatch_completed");
  assert.equal(started.length, 1);
  assert.equal(completed.length, 1);
  assert.equal(started[0].data.sessionId, sessionId);
  assert.equal(started[0].data.actionType, "send-codex");
  assert.equal(started[0].data.runner, "codex");
  assert.equal(completed[0].data.sessionId, sessionId);
  assert.ok(Number.isFinite(completed[0].data.elapsedMs));
});

test("UI-H7-f: dispatchCodex clears in-flight after completion", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  // Slow runner so we can verify in-flight tracking BEFORE completion.
  const codex = {
    exec: () => new Promise((r) => setTimeout(() => r({ ok: true }), 50)),
  };
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
  });

  await d.dispatchCodex(sessionId, { instruction: "x" });
  // While awaiting the runner, in-flight is set
  assert.equal(d.size(), 1);
  assert.equal(d.isInFlight(sessionId), true);
  await new Promise((r) => setTimeout(r, 100));
  // After completion, in-flight is cleared
  assert.equal(d.size(), 0);
  assert.equal(d.isInFlight(sessionId), false);
});

// ── dispatchCodex failure path ───────────────────────────────────

test("UI-H7-f: runner returns ok:false → dispatch_failed audit + in-flight cleared", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner({
    result: { ok: false, error: "exit code 1", exitCode: 1 },
  });
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: audit.auditFn,
  });

  await d.dispatchCodex(sessionId, { instruction: "x" });
  await settle();

  const failed = audit.findVerbs("review_session_dispatch_failed");
  const completed = audit.findVerbs("review_session_dispatch_completed");
  assert.equal(failed.length, 1);
  assert.equal(completed.length, 0);
  assert.equal(failed[0].data.sessionId, sessionId);
  assert.match(failed[0].data.reason, /exit code 1/);
  assert.equal(d.size(), 0);
});

test("UI-H7-f: runner throws → dispatch_failed audit + in-flight cleared", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner({ throwOnExec: true });
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: audit.auditFn,
  });

  await d.dispatchCodex(sessionId, { instruction: "x" });
  await settle();

  const failed = audit.findVerbs("review_session_dispatch_failed");
  assert.equal(failed.length, 1);
  assert.match(failed[0].data.reason, /runner exploded/);
  assert.equal(d.size(), 0);
});

// ── In-flight collision ──────────────────────────────────────────

test("UI-H7-f: same sessionId double-dispatch throws + emits dispatch_blocked audit", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  // Slow runner so the first dispatch stays in-flight while we
  // attempt the second
  const codex = {
    exec: () => new Promise((resolve) => {
      setTimeout(() => resolve({ ok: true }), 50);
    }),
  };
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: audit.auditFn,
  });

  await d.dispatchCodex(sessionId, { instruction: "first" });
  // Second dispatch while first still running
  await assert.rejects(
    () => d.dispatchCodex(sessionId, { instruction: "second" }),
    (err) =>
      err.code === DISPATCH_ERROR_CODES.DISPATCH_ALREADY_IN_FLIGHT
      && err.message.includes("already has an in-flight"),
  );

  const blocked = audit.findVerbs("review_session_dispatch_blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].data.reason, "already_in_flight");

  // Wait for first dispatch to complete + clean up
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(d.size(), 0);
});

// ── Pre-flight gates ─────────────────────────────────────────────

test("UI-H7-f: dispatch on unknown session → DISPATCH_SESSION_NOT_FOUND", async () => {
  const { manager } = makeManagerWithSession();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: makeFakeRunner(),
  });
  await assert.rejects(
    () => d.dispatchCodex("nope-this-id-doesnt-exist", { instruction: "x" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_SESSION_NOT_FOUND,
  );
});

test("UI-H7-f: dispatch on archived session → DISPATCH_SESSION_INVALID_STATE", async () => {
  const { manager, sessionId } = makeManagerWithSession();
  manager.archive(sessionId);
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: makeFakeRunner(),
  });
  await assert.rejects(
    () => d.dispatchCodex(sessionId, { instruction: "x" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_SESSION_INVALID_STATE,
  );
});

test("UI-H7-f: dispatch with no codex runner wired → DISPATCH_RUNNER_UNAVAILABLE", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const d = new ReviewSpawnDispatcher({ reviewSessionManager: manager });
  await assert.rejects(
    () => d.dispatchCodex(sessionId, { instruction: "x" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_RUNNER_UNAVAILABLE,
  );
});

test("UI-H7-f: dispatch with no claude runner wired → DISPATCH_RUNNER_UNAVAILABLE", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_claude");
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: makeFakeRunner(),
    /* no claudeRunner */
  });
  await assert.rejects(
    () => d.dispatchClaude(sessionId, { instruction: "x" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_RUNNER_UNAVAILABLE,
  );
});

test("UI-H7-f: empty sessionId → DISPATCH_INVALID_INPUT", async () => {
  const { manager } = makeManagerWithSession();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: makeFakeRunner(),
  });
  await assert.rejects(
    () => d.dispatchCodex("", { instruction: "x" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
  );
});

test("UI-H7-f: empty instruction → DISPATCH_INVALID_INPUT", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: makeFakeRunner(),
  });
  await assert.rejects(
    () => d.dispatchCodex(sessionId, { instruction: "" }),
    (err) => err.code === DISPATCH_ERROR_CODES.DISPATCH_INVALID_INPUT,
  );
});

// ── Public-sector posture (Claude only) ───────────────────────────

test("UI-H7-f: dispatchClaude under publicSector + !allowLocalExecutor → DISPATCH_LOCAL_EXECUTOR_DISABLED", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_claude");
  const claude = makeFakeRunner();
  const audit = captureAudit();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, claudeRunner: claude,
    auditFn: audit.auditFn,
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
  });

  await assert.rejects(
    () => d.dispatchClaude(sessionId, { instruction: "x" }),
    (err) =>
      err.code === DISPATCH_ERROR_CODES.DISPATCH_LOCAL_EXECUTOR_DISABLED
      && err.message.includes("Public-sector posture"),
  );
  // Audit row recorded
  const blocked = audit.findVerbs("review_session_dispatch_blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].data.reason, "local_executor_disabled");
  // Runner never invoked
  assert.equal(claude.calls.length, 0);
});

test("UI-H7-f: dispatchCodex is ALLOWED under publicSector (Codex is read-only)", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    deploymentProfile: { publicSector: true, allowLocalExecutor: false },
  });

  // Should NOT throw
  const ack = await d.dispatchCodex(sessionId, { instruction: "x" });
  assert.equal(ack.ok, true);
});

test("UI-H7-f: dispatchClaude in standard posture spawns claude runner", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_claude");
  const claude = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, claudeRunner: claude,
    deploymentProfile: { publicSector: false, allowLocalExecutor: true },
  });

  const ack = await d.dispatchClaude(sessionId, {
    instruction: "Apply Codex's findings",
  });
  await settle();
  assert.equal(ack.ok, true);
  assert.equal(claude.calls.length, 1);
  assert.equal(claude.calls[0].opts.reviewSessionId, sessionId);
  assert.match(claude.calls[0].prompt, /Apply Codex's findings/);
});

// ── Prompt builder shapes ────────────────────────────────────────

test("UI-H7-f: Codex prompt includes severity-tag instruction", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
  });
  await d.dispatchCodex(sessionId, { instruction: "x" });
  await settle();
  const prompt = codex.calls[0].prompt;
  assert.match(prompt, /\[critical\]/);
  assert.match(prompt, /\[high\]/);
  assert.match(prompt, /\[medium\]/);
  assert.match(prompt, /\[low\]/);
});

test("UI-H7-f: Claude prompt includes critique summary when available", async () => {
  const { manager, sessionId } = makeManagerWithSession("critique_received");
  // Manually inject a critique_received history entry
  manager._sessions.get(sessionId).history.push({
    at: 1000, kind: "critique_received", by: "codex",
    summary: "2 critical findings: SQL injection and XSS",
  });
  manager._sessions.get(sessionId).state = "awaiting_claude";  // post-handBack

  const claude = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, claudeRunner: claude,
    deploymentProfile: { publicSector: false, allowLocalExecutor: true },
  });
  await d.dispatchClaude(sessionId, { instruction: "fix them", includeCritique: true });
  await settle();
  const prompt = claude.calls[0].prompt;
  assert.match(prompt, /SQL injection and XSS/);
});

test("UI-H7-f: Claude prompt includeCritique:false omits critique block", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_claude");
  manager._sessions.get(sessionId).history.push({
    at: 1, kind: "critique_received", by: "codex",
    summary: "should not appear in prompt",
  });
  const claude = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, claudeRunner: claude,
    deploymentProfile: { publicSector: false, allowLocalExecutor: true },
  });
  await d.dispatchClaude(sessionId, { instruction: "fix x", includeCritique: false });
  await settle();
  const prompt = claude.calls[0].prompt;
  assert.equal(prompt.includes("should not appear in prompt"), false);
});

// ── Follow-up Codex ──────────────────────────────────────────────

test("UI-H7-f: dispatchFollowUpCodex spawns codex with question prompt", async () => {
  const { manager, sessionId } = makeManagerWithSession("critique_received");
  const codex = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
  });
  await d.dispatchFollowUpCodex(sessionId, { question: "Why is line 42 unsafe?" });
  await settle();
  assert.equal(codex.calls.length, 1);
  assert.equal(codex.calls[0].opts.reviewSessionId, sessionId);
  assert.match(codex.calls[0].prompt, /Why is line 42 unsafe/);
  assert.match(codex.calls[0].prompt, /follow-up/);
});

// ── Snapshot + getInFlight ───────────────────────────────────────

test("UI-H7-f: snapshot returns sorted in-flight entries", async () => {
  const { manager: mgr1 } = makeManagerWithSession("awaiting_critique");
  const sess1 = mgr1.create({ label: "first" });
  const sess2 = mgr1.create({ label: "second" });
  mgr1._sessions.get(sess1.sessionId).state = "awaiting_critique";
  mgr1._sessions.get(sess2.sessionId).state = "awaiting_critique";

  let timeCounter = 1000;
  const codex = {
    exec: () => new Promise((r) => setTimeout(() => r({ ok: true }), 100)),
  };
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: mgr1, codexRunner: codex,
    clockFn: () => ++timeCounter,
  });

  await d.dispatchCodex(sess1.sessionId, { instruction: "x" });
  await d.dispatchCodex(sess2.sessionId, { instruction: "y" });

  const snap = d.snapshot();
  assert.equal(snap.length, 2);
  assert.ok(snap[0].startedAt < snap[1].startedAt);
  assert.equal(snap[0].sessionId, sess1.sessionId);
  await new Promise((r) => setTimeout(r, 150));  // let them complete
  assert.equal(d.size(), 0);
});

test("UI-H7-f: getInFlight returns null for unknown / settles", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  // Slow runner so we can verify mid-flight state.
  const codex = {
    exec: () => new Promise((r) => setTimeout(() => r({ ok: true }), 50)),
  };
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
  });

  assert.equal(d.getInFlight("nope"), null);
  assert.equal(d.getInFlight(sessionId), null);

  await d.dispatchCodex(sessionId, { instruction: "x" });
  // Mid-flight: getInFlight returns the entry
  const entry = d.getInFlight(sessionId);
  assert.ok(entry);
  assert.equal(entry.actionType, "send-codex");
  assert.equal(entry.runner, "codex");

  await new Promise((r) => setTimeout(r, 100));
  // Post-settle: getInFlight returns null
  assert.equal(d.getInFlight(sessionId), null);
});

// ── Defensive ────────────────────────────────────────────────────

test("UI-H7-f: dispatcher tolerates audit-throwing auditFn", async () => {
  const { manager, sessionId } = makeManagerWithSession("awaiting_critique");
  const codex = makeFakeRunner();
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
    auditFn: () => { throw new Error("audit broke"); },
  });
  // Should not throw
  await d.dispatchCodex(sessionId, { instruction: "x" });
  await settle();
  assert.equal(codex.calls.length, 1);
});

test("UI-H7-f: empty sessionId for getInFlight returns null", () => {
  const { manager } = makeManagerWithSession();
  const d = new ReviewSpawnDispatcher({ reviewSessionManager: manager });
  assert.equal(d.getInFlight(""), null);
  assert.equal(d.getInFlight(null), null);
  assert.equal(d.getInFlight(123), null);
});

// ── Integration with manager state machine ───────────────────────

test("UI-H7-f: dispatched runner pipes back via manager.recordCodexChunk + recordCritiqueReceived", async () => {
  const broadcast = [];
  const manager = new ReviewSessionManager({
    broadcastFn: (type, data) => broadcast.push({ type, data }),
  });
  const session = manager.create({ label: "live-test" });
  manager.sendCodex(session.sessionId, { instruction: "review" });

  // Simulated codex runner that, on exec, records chunks + critique
  // back into the manager (mirrors what the real runner does via
  // executor/codex-runner.js with the reviewSessionId hint).
  const codex = {
    exec: async (_prompt, opts) => {
      manager.recordCodexChunk(opts.reviewSessionId, { text: "chunk-1" });
      manager.recordCodexChunk(opts.reviewSessionId, { text: "chunk-2" });
      manager.recordCritiqueReceived(opts.reviewSessionId, {
        summary: "1 issue", severityCounts: { critical: 0, high: 1, medium: 0, low: 0, note: 0 },
      });
      return { ok: true };
    },
  };
  const d = new ReviewSpawnDispatcher({
    reviewSessionManager: manager, codexRunner: codex,
  });

  await d.dispatchCodex(session.sessionId, { instruction: "review" });
  await settle();

  // Verify state transition + broadcasts
  const after = manager.get(session.sessionId);
  assert.equal(after.state, "critique_received");

  const chunks = broadcast.filter((b) => b.type === "codex_stream_chunk");
  assert.equal(chunks.length, 2);
  const critiqueDone = broadcast.filter((b) => b.type === "critique_received");
  assert.equal(critiqueDone.length, 1);
  assert.equal(critiqueDone[0].data.summary, "1 issue");
});
