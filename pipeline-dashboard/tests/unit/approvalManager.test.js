// Slice R3-e-b (Phase D R3, 2026-04-29) — approvalManager unit tests.
//
// The manager IS the state machine; these tests pin every transition
// + every observable side effect. Constructor injection lets us
// drive the timer + clock deterministically and capture every audit
// + broadcast call without spinning up the orchestrator.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ApprovalManager,
  _hashArgs,
  _summarizeArgs,
  _filterArgs,
  _auditVerbFor,
  ARGS_SUMMARY_MAX_LENGTH,
  RESOLUTION_GRANTED,
  RESOLUTION_DENIED,
  RESOLUTION_TIMEOUT,
  RESOLUTION_CANCELLED,
} = require("../../src/runtime/approvalManager");

const {
  APPROVAL_RESOLUTIONS,
  WRITE_TOOL_DATA_KEYS,
  DEFAULT_APPROVAL_TIMEOUT_MS,
} = require("../../src/runtime/remoteHookBridgeContract");

// ── Test harness ───────────────────────────────────────────────────

/**
 * Build a manager whose timer + clock are explicitly controllable.
 * Returns the manager + a `harness` object with helpers to fire
 * timers and capture audit/broadcast calls.
 */
function makeHarness(opts = {}) {
  let nowMs = 1_000_000_000;  // arbitrary fixed start
  const audits = [];
  const broadcasts = [];
  // pendingTimers: Map<id, {ms, cb}>
  const pendingTimers = new Map();
  let nextTimerId = 1;
  let nextApprovalIdN = 1;

  const manager = new ApprovalManager({
    auditFn: (verb, data) => audits.push({ verb, data }),
    broadcastFn: (type, data) => broadcasts.push({ type, data }),
    setTimeoutFn: (cb, ms) => {
      const id = nextTimerId++;
      pendingTimers.set(id, { ms, cb });
      return id;
    },
    clearTimeoutFn: (id) => { pendingTimers.delete(id); },
    clockFn: () => nowMs,
    idFn: () => "test-id-" + (nextApprovalIdN++),
    ...opts,  // override any of the above
  });

  return {
    manager,
    audits,
    broadcasts,
    fireTimers() {
      // Fire every scheduled timer in insertion order, then clear.
      // Keep firing if new timers are scheduled during firing
      // (none expected in this manager but defensive).
      const ids = [...pendingTimers.keys()];
      for (const id of ids) {
        const t = pendingTimers.get(id);
        if (!t) continue;
        pendingTimers.delete(id);
        t.cb();
      }
    },
    pendingTimerCount() { return pendingTimers.size; },
    advanceClock(ms) { nowMs += ms; },
    setClock(ms) { nowMs = ms; },
    clock() { return nowMs; },
  };
}

// ── _hashArgs ──────────────────────────────────────────────────────

test("_hashArgs is deterministic for the same input", () => {
  const a = _hashArgs({ command: "echo hi" });
  const b = _hashArgs({ command: "echo hi" });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("_hashArgs is key-order independent", () => {
  const a = _hashArgs({ a: 1, b: 2 });
  const b = _hashArgs({ b: 2, a: 1 });
  assert.equal(a, b, "stable serialization should hash key-order independently");
});

test("_hashArgs differs for different inputs", () => {
  const a = _hashArgs({ command: "echo hi" });
  const b = _hashArgs({ command: "rm -rf /" });
  assert.notEqual(a, b);
});

test("_hashArgs handles nested objects + arrays", () => {
  const a = _hashArgs({ items: ["a", "b"], opts: { x: 1 } });
  const b = _hashArgs({ opts: { x: 1 }, items: ["a", "b"] });
  assert.equal(a, b);
  const c = _hashArgs({ items: ["b", "a"], opts: { x: 1 } });
  // Array order is significant (Bash command order matters).
  assert.notEqual(a, c);
});

// ── _summarizeArgs ─────────────────────────────────────────────────

test("_summarizeArgs(Bash) shows the command", () => {
  assert.equal(_summarizeArgs("Bash", { command: "echo hi" }), "echo hi");
});

test("_summarizeArgs(Bash) truncates long commands with ellipsis", () => {
  const longCmd = "a".repeat(200);
  const s = _summarizeArgs("Bash", { command: longCmd });
  assert.equal(s.length, ARGS_SUMMARY_MAX_LENGTH);
  assert.ok(s.endsWith("…"));
});

test("_summarizeArgs(Edit) shows file_path + scope", () => {
  assert.equal(_summarizeArgs("Edit", { file_path: "/tmp/x.js", replace_all: false }), "/tmp/x.js (one)");
  assert.equal(_summarizeArgs("Edit", { file_path: "/tmp/x.js", replace_all: true }), "/tmp/x.js (all)");
});

test("_summarizeArgs(Write) shows file_path + content size", () => {
  assert.equal(_summarizeArgs("Write", { file_path: "/tmp/x.js", content: "abc" }), "/tmp/x.js (3 bytes)");
  assert.equal(_summarizeArgs("Write", { file_path: "/tmp/empty" }), "/tmp/empty (0 bytes)");
});

test("_summarizeArgs handles empty / null args gracefully", () => {
  assert.equal(_summarizeArgs("Bash", null), "");
  assert.equal(_summarizeArgs("Bash", undefined), "");
  assert.equal(_summarizeArgs("Bash", {}), "");
});

// ── _filterArgs ────────────────────────────────────────────────────

test("_filterArgs keeps only WRITE_TOOL_DATA_KEYS for the tool", () => {
  const args = {
    command: "echo hi",
    description: "say hi",
    timeout: 5000,
    run_in_background: false,
    // extras that an attacker might smuggle
    secret: "should be dropped",
    __proto__: { evil: true },
    file_path: "should be dropped (Bash doesn't have file_path)",
  };
  const out = _filterArgs("Bash", args);
  assert.deepEqual(Object.keys(out).sort(), WRITE_TOOL_DATA_KEYS.Bash.slice().sort());
  assert.ok(!("secret" in out));
  assert.ok(!("file_path" in out));
});

test("_filterArgs returns {} for non-approval tools", () => {
  assert.deepEqual(_filterArgs("Read", { file_path: "/x" }), {});
  assert.deepEqual(_filterArgs("", {}), {});
  assert.deepEqual(_filterArgs("Bash", null), {});
});

// ── _auditVerbFor ──────────────────────────────────────────────────

test("_auditVerbFor maps every resolution except cancelled", () => {
  assert.equal(_auditVerbFor(RESOLUTION_GRANTED), "runner_hook_approval_granted");
  assert.equal(_auditVerbFor(RESOLUTION_DENIED), "runner_hook_approval_denied");
  assert.equal(_auditVerbFor(RESOLUTION_TIMEOUT), "runner_hook_approval_timeout");
  // cancelled: no audit verb fires (caller already audited the cancel reason)
  assert.equal(_auditVerbFor(RESOLUTION_CANCELLED), null);
});

test("_auditVerbFor in sync with APPROVAL_RESOLUTIONS contract", () => {
  // Every resolution from the contract should map to either a verb
  // or null (cancel). No silent gaps.
  for (const r of APPROVAL_RESOLUTIONS) {
    const v = _auditVerbFor(r);
    assert.ok(v === null || (typeof v === "string" && v.startsWith("runner_hook_approval_")),
      `unexpected verb mapping for ${r}: ${v}`);
  }
});

// ── ApprovalManager: constructor + defaults ────────────────────────

test("ApprovalManager accepts no opts (uses defaults)", () => {
  const m = new ApprovalManager();
  assert.equal(m.size(), 0);
  assert.deepEqual(m.list(), []);
  // Default audit/broadcast are no-ops; nothing observable to assert.
});

test("ApprovalManager honors HARNESS_REMOTE_APPROVAL_TIMEOUT_MS env", () => {
  // Save + restore env so the test is order-independent.
  const saved = process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
  try {
    process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = "12345";
    const h = makeHarness({});
    // Issue a request without per-call timeoutMs — should use env value.
    h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
    const list = h.manager.list();
    assert.equal(list[0].timeoutMs, 12345);
  } finally {
    if (saved === undefined) delete process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
    else process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = saved;
  }
});

test("ApprovalManager rejects garbage env values, falling back to default", () => {
  const saved = process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
  try {
    process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = "not-a-number";
    const h = makeHarness({});
    h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
    assert.equal(h.manager.list()[0].timeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS);
  } finally {
    if (saved === undefined) delete process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
    else process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = saved;
  }
});

test("ApprovalManager rejects negative env timeout (defense)", () => {
  const saved = process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
  try {
    process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = "-100";
    const h = makeHarness({});
    h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
    assert.equal(h.manager.list()[0].timeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS);
  } finally {
    if (saved === undefined) delete process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
    else process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = saved;
  }
});

// ── ApprovalManager.request — input validation ─────────────────────

test("request throws when req is not an object", () => {
  const h = makeHarness();
  assert.throws(() => h.manager.request(null), /approval_request_invalid/);
  assert.throws(() => h.manager.request("not-an-obj"), /approval_request_invalid/);
});

test("request throws when hook missing", () => {
  const h = makeHarness();
  assert.throws(
    () => h.manager.request({ tool: "Bash", args: { command: "x" } }),
    /hook required/,
  );
});

test("request throws when tool missing", () => {
  const h = makeHarness();
  assert.throws(
    () => h.manager.request({ hook: "PreToolUse", args: { command: "x" } }),
    /tool required/,
  );
});

test("request throws when tool not in WRITE_TOOLS_REQUIRING_APPROVAL", () => {
  const h = makeHarness();
  assert.throws(
    () => h.manager.request({ hook: "PreToolUse", tool: "Read", args: {} }),
    /not in WRITE_TOOLS_REQUIRING_APPROVAL/,
  );
});

// ── ApprovalManager.request — happy-path lifecycle ─────────────────

test("request emits requested audit + broadcast and registers as pending", () => {
  const h = makeHarness();
  h.manager.request({
    hook: "PreToolUse",
    tool: "Bash",
    args: { command: "echo hi", description: "test" },
    runId: "run-1",
    hostIdentity: "host-A",
  });

  assert.equal(h.manager.size(), 1);
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].verb, "runner_hook_approval_requested");
  assert.equal(h.audits[0].data.tool, "Bash");
  assert.equal(h.audits[0].data.runId, "run-1");
  assert.equal(h.audits[0].data.hostIdentity, "host-A");
  assert.match(h.audits[0].data.argsHash, /^[0-9a-f]{64}$/);
  assert.equal(h.audits[0].data.source, "remote_hook");
  assert.equal(h.audits[0].data.argsSummary, "echo hi");

  assert.equal(h.broadcasts.length, 1);
  assert.equal(h.broadcasts[0].type, "approval_requested");
  assert.equal(h.broadcasts[0].data.tool, "Bash");
  assert.equal(h.broadcasts[0].data.argsSummary, "echo hi");
});

test("request stores defensively-copied args + per-tool filter", () => {
  const h = makeHarness();
  const argsIn = {
    command: "echo hi",
    description: "test",
    secret: "leaked?",  // should be filtered out
  };
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: argsIn });
  const got = h.manager.list()[0];
  assert.deepEqual(Object.keys(got.args).sort(), ["command", "description"]);
  assert.ok(!("secret" in got.args));

  // Mutating the input does NOT affect the snapshot.
  argsIn.command = "rm -rf /";
  assert.equal(h.manager.list()[0].args.command, "echo hi");
});

test("request honors per-call timeoutMs override", () => {
  const h = makeHarness();
  h.manager.request({
    hook: "PreToolUse", tool: "Bash", args: { command: "x" },
    timeoutMs: 5000,
  });
  assert.equal(h.manager.list()[0].timeoutMs, 5000);
});

test("request returns a promise that resolves on grant", async () => {
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  h.manager.grant(id, { deciderId: "operator-1" });
  const result = await p;
  assert.equal(result.resolution, "granted");
  assert.equal(result.deciderId, "operator-1");
  assert.equal(result.reason, null);
  assert.equal(typeof result.decidedAt, "number");
});

test("request returns a promise that resolves on deny", async () => {
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  h.manager.deny(id, { deciderId: "operator-1", reason: "looks dangerous" });
  const result = await p;
  assert.equal(result.resolution, "denied");
  assert.equal(result.deciderId, "operator-1");
  assert.equal(result.reason, "looks dangerous");
});

test("request returns a promise that resolves on timeout", async () => {
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  h.fireTimers();  // simulate TTL expiry
  const result = await p;
  assert.equal(result.resolution, "timeout");
  assert.equal(result.deciderId, null);
});

// ── ApprovalManager.grant / deny — emissions + idempotency ────────

test("grant fires approval_granted audit + approval_resolved broadcast", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" }, runId: "r1" });
  const id = h.manager.list()[0].approvalId;
  h.manager.grant(id, { deciderId: "op-1" });

  // 2 audits: requested + granted
  assert.equal(h.audits.length, 2);
  assert.equal(h.audits[1].verb, "runner_hook_approval_granted");
  assert.equal(h.audits[1].data.deciderId, "op-1");
  assert.equal(h.audits[1].data.runId, "r1");

  // 2 broadcasts: requested + resolved
  assert.equal(h.broadcasts.length, 2);
  assert.equal(h.broadcasts[1].type, "approval_resolved");
  assert.equal(h.broadcasts[1].data.resolution, "granted");
});

test("deny fires approval_denied audit + approval_resolved broadcast", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" }, runId: "r1" });
  const id = h.manager.list()[0].approvalId;
  h.manager.deny(id, { deciderId: "op-1", reason: "no" });

  assert.equal(h.audits.length, 2);
  assert.equal(h.audits[1].verb, "runner_hook_approval_denied");
  assert.equal(h.audits[1].data.reason, "no");

  assert.equal(h.broadcasts.length, 2);
  assert.equal(h.broadcasts[1].type, "approval_resolved");
  assert.equal(h.broadcasts[1].data.resolution, "denied");
  assert.equal(h.broadcasts[1].data.reason, "no");
});

test("timeout fires approval_timeout audit + approval_resolved broadcast", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  h.fireTimers();
  assert.equal(h.audits.length, 2);
  assert.equal(h.audits[1].verb, "runner_hook_approval_timeout");
  assert.equal(h.broadcasts[1].type, "approval_resolved");
  assert.equal(h.broadcasts[1].data.resolution, "timeout");
});

test("grant on unknown approvalId returns false (no audit, no broadcast)", () => {
  const h = makeHarness();
  const ok = h.manager.grant("not-a-real-id");
  assert.equal(ok, false);
  assert.equal(h.audits.length, 0);
  assert.equal(h.broadcasts.length, 0);
});

test("grant after deny is a no-op (idempotent resolve)", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  assert.equal(h.manager.deny(id), true);
  assert.equal(h.manager.grant(id), false);  // already resolved
  // Audit chain has request + deny only — no spurious grant.
  assert.equal(h.audits.length, 2);
  assert.equal(h.audits[1].verb, "runner_hook_approval_denied");
});

test("timeout cleared by grant — fireTimers does not re-resolve", async () => {
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  h.manager.grant(id, { deciderId: "op-1" });
  // Timer was cleared on grant; fireTimers should be a no-op.
  h.fireTimers();
  assert.equal(h.pendingTimerCount(), 0);
  const result = await p;
  assert.equal(result.resolution, "granted");  // not "timeout"
});

// ── Cancel paths ───────────────────────────────────────────────────

test("cancel resolves the promise as cancelled (no audit verb fires)", async () => {
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  h.manager.cancel(id, { reason: "run completed" });
  const result = await p;
  assert.equal(result.resolution, "cancelled");
  assert.equal(result.reason, "run completed");
  // Audit chain has request only — cancel does NOT emit a runner_hook_approval_* verb.
  // (The caller of cancel — e.g., orchestrator on run-complete — owns its own audit narration.)
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].verb, "runner_hook_approval_requested");
  // But broadcast still fires so UI can clear the card.
  assert.equal(h.broadcasts.length, 2);
  assert.equal(h.broadcasts[1].type, "approval_resolved");
  assert.equal(h.broadcasts[1].data.resolution, "cancelled");
});

test("cancelByRunId cancels every pending approval for that run", async () => {
  const h = makeHarness();
  const p1 = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "a" }, runId: "r1" });
  const p2 = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "b" }, runId: "r2" });
  const p3 = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "c" }, runId: "r1" });
  const count = h.manager.cancelByRunId("r1");
  assert.equal(count, 2);
  assert.equal(h.manager.size(), 1);  // r2 still pending

  // p1 + p3 resolved as cancelled, p2 still pending.
  const r1 = await p1;
  const r3 = await p3;
  assert.equal(r1.resolution, "cancelled");
  assert.equal(r3.resolution, "cancelled");
  // p2 not resolved yet — race timeout to confirm
  let p2Resolved = false;
  p2.then(() => { p2Resolved = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(p2Resolved, false);
  // Now resolve p2 to clean up.
  h.manager.deny(h.manager.list()[0].approvalId);
});

test("cancelByHostIdentity cancels every pending approval for that host", async () => {
  const h = makeHarness();
  const p1 = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "a" }, hostIdentity: "h1" });
  const p2 = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "b" }, hostIdentity: "h2" });
  const count = h.manager.cancelByHostIdentity("h1", { reason: "ws_disconnected" });
  assert.equal(count, 1);
  const r1 = await p1;
  assert.equal(r1.resolution, "cancelled");
  assert.equal(r1.reason, "ws_disconnected");
  // p2 still pending; resolve to clean up.
  h.manager.deny(h.manager.list()[0].approvalId);
  await p2;
});

// ── PII context pass-through (GOV-APPROVAL-0 slot) ────────────────

test("piiContext is passed through to the snapshot + audit", () => {
  const h = makeHarness();
  h.manager.request({
    hook: "PreToolUse", tool: "Bash", args: { command: "echo X" },
    piiContext: {
      hasPii: true,
      findingTypes: ["krn", "email"],
      samples: { krn: ["123456-1******"], email: ["a***@example.com"] },
    },
  });
  const snap = h.manager.list()[0];
  assert.equal(snap.piiContext.hasPii, true);
  assert.deepEqual([...snap.piiContext.findingTypes].sort(), ["email", "krn"]);
  assert.ok("krn" in snap.piiContext.samples);

  // Audit data has the abbreviated PII context (no samples to keep the
  // ledger small + avoid leaking redacted-but-still-suggestive snippets).
  assert.equal(h.audits[0].data.piiContext.hasPii, true);
  assert.deepEqual([...h.audits[0].data.piiContext.findingTypes].sort(), ["email", "krn"]);
  assert.ok(!("samples" in h.audits[0].data.piiContext));
});

test("piiContext absent yields piiContext:null on snapshot + audit", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const snap = h.manager.list()[0];
  assert.equal(snap.piiContext, null);
  assert.equal(h.audits[0].data.piiContext, null);
});

// ── Defensive: never break on caller-supplied auditFn / broadcastFn ─

test("manager survives auditFn that throws", () => {
  // Inject no-op timer functions so the test doesn't leak a real
  // 30-second setTimeout into the test runner's event loop.
  const m = new ApprovalManager({
    auditFn: () => { throw new Error("ledger went boom"); },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  // Should NOT throw out — the manager swallows audit errors.
  assert.doesNotThrow(() => m.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } }));
  assert.equal(m.size(), 1);
});

test("manager survives broadcastFn that throws", () => {
  const m = new ApprovalManager({
    broadcastFn: () => { throw new Error("ws went boom"); },
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
  });
  assert.doesNotThrow(() => m.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } }));
  assert.equal(m.size(), 1);
});

// ── list / get / size accessors ────────────────────────────────────

test("list returns defensive copies (caller mutation does not affect manager)", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const list = h.manager.list();
  list[0].tool = "Edit";
  list[0].args.command = "MUTATED";
  // Manager's internal state stays intact.
  const list2 = h.manager.list();
  assert.equal(list2[0].tool, "Bash");
  assert.equal(list2[0].args.command, "x");
});

test("get returns null for unknown approvalId", () => {
  const h = makeHarness();
  assert.equal(h.manager.get("no-such-id"), null);
});

test("get returns the snapshot for a pending approvalId", () => {
  const h = makeHarness();
  h.manager.request({
    hook: "PreToolUse", tool: "Bash", args: { command: "x" }, runId: "r1",
  });
  const id = h.manager.list()[0].approvalId;
  const got = h.manager.get(id);
  assert.equal(got.tool, "Bash");
  assert.equal(got.runId, "r1");
});

test("get returns null after the approval is resolved", () => {
  const h = makeHarness();
  h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  h.manager.grant(id);
  assert.equal(h.manager.get(id), null);
});

// ── Resolution outside the documented set is normalized ───────────

test("_resolveInternal called with garbage resolution coerces to cancelled (defense in depth)", async () => {
  // Direct internal call via a back door: manager.cancel hands "cancelled".
  // To exercise the normalize path, we have to monkey-patch the manager
  // — this test is the safety net against a future refactor that
  // accidentally passes a typo.
  const h = makeHarness();
  const p = h.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
  const id = h.manager.list()[0].approvalId;
  // Reach into _resolveInternal directly with a bogus resolution.
  h.manager._resolveInternal(id, "broken-state", {});
  const result = await p;
  assert.equal(result.resolution, "cancelled");
});

// ── Cross-check with contract ─────────────────────────────────────

test("default timeout matches DEFAULT_APPROVAL_TIMEOUT_MS contract", () => {
  const m = new ApprovalManager();
  // Bypass env override to confirm the constructor falls back.
  const saved = process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
  try {
    delete process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS;
    const m2 = new ApprovalManager();
    // Issue a request, observe the timeout value.
    const harness = makeHarness();
    harness.manager.request({ hook: "PreToolUse", tool: "Bash", args: { command: "x" } });
    assert.equal(harness.manager.list()[0].timeoutMs, DEFAULT_APPROVAL_TIMEOUT_MS);
  } finally {
    if (saved !== undefined) process.env.HARNESS_REMOTE_APPROVAL_TIMEOUT_MS = saved;
  }
});
