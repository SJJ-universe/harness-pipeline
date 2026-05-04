// Slice MB4-a (Phase D Round 2, 2026-04-27) — HarnessMonitorLegacyBridge tests.
//
// Drives install() with stub dispatcher + stub fetch + manual interval
// control (so we don't actually wait 5s in tests). Verifies the two
// halves of the bridge:
//   1. wildcard tap → store.pushEvent (with normalizer integration)
//   2. periodic /api/server/info refresh → setServerSummary +
//      setActiveChildren, with stats counting and graceful degradation.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install, DEFAULT_REFRESH_MS, DEFAULT_INFO_URL } = require("../../public/js/monitor/legacy-bridge");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");
const dispatcher = require("../../public/js/event-dispatcher");

function fakeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

function fakeFetch(response) {
  let lastCall = null;
  const allCalls = [];
  const fn = async (url, opts) => {
    lastCall = { url, opts };
    allCalls.push(lastCall);
    return typeof response === "function" ? response(url) : response;
  };
  fn.lastCall = () => lastCall;
  // Slice SMART-0-c: tests that need to assert about a specific URL
  // (vs the overall last fetch) use .calls() / .findCall(url).
  fn.calls = () => allCalls.slice();
  fn.findCall = (url) => allCalls.find((c) => c.url === url) || null;
  return fn;
}

function manualInterval() {
  // Track scheduled intervals so tests can manually fire them.
  const scheduled = [];
  const setIntervalFn = (fn, ms) => {
    const id = scheduled.length + 1;
    scheduled.push({ id, fn, ms });
    return id;
  };
  const clearIntervalFn = (id) => {
    const i = scheduled.findIndex((s) => s.id === id);
    if (i >= 0) scheduled.splice(i, 1);
  };
  return {
    setIntervalFn, clearIntervalFn,
    scheduled,
    async fire(idx = 0) {
      if (!scheduled[idx]) throw new Error("no scheduled interval at index " + idx);
      await scheduled[idx].fn();
    },
  };
}

// ── input validation ──────────────────────────────────────────────────

test("install throws without store / normalize", () => {
  assert.throws(() => install({ normalize }), /store must be/);
  assert.throws(() => install({ store: createMonitorStore() }), /normalize must be/);
});

test("DEFAULT_REFRESH_MS + DEFAULT_INFO_URL exported", () => {
  assert.equal(typeof DEFAULT_REFRESH_MS, "number");
  assert.equal(DEFAULT_INFO_URL, "/api/server/info");
});

// ── wildcard tap → store.pushEvent ────────────────────────────────────

test("install wires a tap that normalises every event into the store", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize,
    dispatcher,
    setIntervalFn: () => null,
    clearIntervalFn: () => {},
  });
  // Simulate app.js receiving 3 WS events.
  dispatcher.notifyTaps({ type: "phase_update", data: { runId: "default", phase: "B" } });
  dispatcher.notifyTaps({ type: "tool_recorded", data: { runId: "default", tool: "Edit" } });
  dispatcher.notifyTaps({ type: "toast",         data: { message: "hi" } });
  const events = store.snapshot().events;
  assert.equal(events.length, 3);
  assert.equal(events[0].scope, "phase");
  assert.equal(events[1].scope, "tool");
  assert.equal(events[2].scope, "global");
  const stats = handle.stats();
  assert.equal(stats.eventsForwarded, 3);
  assert.equal(stats.eventsDropped, 0);
  handle.destroy();
});

test("non-normalisable events bump eventsDropped without throwing", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize,
    dispatcher,
    setIntervalFn: () => null,
  });
  // No `type` field → normalize returns null.
  dispatcher.notifyTaps({ data: { junk: 1 } });
  dispatcher.notifyTaps(null);
  const stats = handle.stats();
  assert.equal(stats.eventsForwarded, 0);
  assert.ok(stats.eventsDropped >= 1);
  handle.destroy();
});

test("destroy unsubscribes the tap (no further forwarding)", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize,
    dispatcher,
    setIntervalFn: () => null,
  });
  dispatcher.notifyTaps({ type: "phase_update", data: { runId: "default" } });
  assert.equal(store.snapshot().events.length, 1);
  handle.destroy();
  dispatcher.notifyTaps({ type: "tool_recorded", data: { runId: "default", tool: "Edit" } });
  // Still 1 — the post-destroy event was not captured.
  assert.equal(store.snapshot().events.length, 1);
});

// ── periodic /api/server/info refresh ────────────────────────────────

test("scheduled interval calls /api/server/info with Accept header", async () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetch(fakeResponse({
    body: {
      pid: 9001, uptime: 12.5, supervised: true, clients: 1,
      graceMs: 8000, shutdownArmed: false, activeChildCount: 2,
      activeChildren: [{ pid: 11, label: "codex", runId: "default", ageMs: 100 }],
    },
  }));
  const handle = install({
    store, normalize,
    dispatcher,
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
    refreshIntervalMs: 1000,
  });
  assert.equal(ctl.scheduled.length, 1);
  await ctl.fire();
  // Slice SMART-0-c: interval now triggers TWO fetches per tick
  // (server/info + decision-context). Find the server/info call
  // explicitly rather than relying on lastCall (decision-context
  // fires last and would shadow the assertion).
  const call = _fetch.findCall("/api/server/info");
  assert.ok(call, "scheduled interval must fetch /api/server/info");
  assert.equal(call.opts.headers.Accept, "application/json");
  // Server summary applied.
  const snap = store.snapshot();
  assert.equal(snap.server.pid, 9001);
  assert.equal(snap.server.activeChildCount, 2);
  assert.equal(snap.activeChildren.length, 1);
  assert.equal(handle.stats().refreshes, 1);
  handle.destroy();
  assert.equal(ctl.scheduled.length, 0, "interval cleared on destroy");
});

test("refresh() invocation merges new pid/uptime over the existing summary", async () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  store.setServerSummary({ bootTime: "T0", pid: 1, uptime: 0.1, mode: "local" });
  const _fetch = fakeFetch(fakeResponse({
    body: { pid: 99, uptime: 50, supervised: false, activeChildCount: 0 },
  }));
  const handle = install({
    store, normalize, dispatcher,
    fetchImpl: _fetch,
    setIntervalFn: () => null,
  });
  const result = await handle.refresh();
  assert.ok(result);
  const server = store.snapshot().server;
  assert.equal(server.pid, 99);
  assert.equal(server.uptime, 50);
  assert.equal(server.mode, "local", "previous summary fields preserved");
  assert.equal(server.bootTime, "T0", "bootTime not overwritten by /api/server/info");
});

test("refresh() bumps refreshErrors on non-2xx + throw", async () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  // First call: 503; second call: throws.
  let n = 0;
  const handle = install({
    store, normalize, dispatcher,
    fetchImpl: async () => {
      n++;
      if (n === 1) return fakeResponse({ ok: false, status: 503, body: "down" });
      throw new Error("ECONNREFUSED");
    },
    setIntervalFn: () => null,
  });
  await handle.refresh();
  await handle.refresh();
  assert.equal(handle.stats().refreshes, 0);
  assert.equal(handle.stats().refreshErrors, 2);
});

test("refresh() returns null when no fetch implementation is available", async () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    // No fetchImpl + no global fetch in Node.
    fetchImpl: null,
    setIntervalFn: () => null,
  });
  const out = await handle.refresh();
  assert.equal(out, null);
});

test("refreshIntervalMs <= 0 disables the periodic poll", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const ctl = manualInterval();
  install({
    store, normalize, dispatcher,
    fetchImpl: fakeFetch(fakeResponse()),
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
    refreshIntervalMs: 0,
  });
  assert.equal(ctl.scheduled.length, 0);
});

// ── graceful degradation ─────────────────────────────────────────────

test("install with no dispatcher attaches no tap (graceful)", () => {
  const store = createMonitorStore();
  const handle = install({
    store, normalize,
    dispatcher: null,           // no global, no override
    fetchImpl: null,
    setIntervalFn: () => null,
  });
  // Calling destroy must not throw even though there was nothing to clean up.
  assert.doesNotThrow(() => handle.destroy());
});

// ── Slice MC2: lifecycle event → store.upsertRun ─────────────────────

function makeBridge(store) {
  dispatcher._resetForTests();
  return install({
    store, normalize, dispatcher,
    fetchImpl: null,
    setIntervalFn: () => null,
  });
}

test("MC2: run_created upserts a fresh run with status:idle", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  dispatcher.notifyTaps({
    type: "run_created",
    data: { runId: "X", templateId: "general", at: 1700000000000 },
  });
  const r = store.snapshot().runs.X;
  assert.ok(r);
  assert.equal(r.status, "idle");
  assert.equal(r.templateId, "general");
  assert.equal(r.createdAt, 1700000000000);
  assert.equal(handle.stats().runSyncs, 1);
});

test("MC2: pipeline_start upserts status:active + templateId + startedAt + phase", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "pipeline_start",
    data: { runId: "Y", template: "code-review", at: 1, phase: "B", phaseIdx: 1 },
  });
  const r = store.snapshot().runs.Y;
  assert.equal(r.status, "active");
  assert.equal(r.templateId, "code-review");
  assert.equal(r.startedAt, 1);
  assert.equal(r.phase, "B");
  assert.equal(r.phaseIdx, 1);
});

test("MC2: phase_update updates phase + phaseIdx + status:active by default", () => {
  const store = createMonitorStore();
  makeBridge(store);
  store.upsertRun("Z", { status: "active" });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "Z", phase: "C", phaseIdx: 2, status: "active" },
  });
  const r = store.snapshot().runs.Z;
  assert.equal(r.phase, "C");
  assert.equal(r.phaseIdx, 2);
  assert.equal(r.status, "active");
});

test("MC2: phase_update with status:error flips run-level status to error", () => {
  const store = createMonitorStore();
  makeBridge(store);
  store.upsertRun("Z", { status: "active" });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "Z", phase: "C", status: "error" },
  });
  assert.equal(store.snapshot().runs.Z.status, "error");
});

test("MC2: pipeline_paused / pipeline_complete / pipeline_reset update status correctly", () => {
  const store = createMonitorStore();
  makeBridge(store);
  store.upsertRun("R", { status: "active", phase: "B", phaseIdx: 1 });

  dispatcher.notifyTaps({ type: "pipeline_paused", data: { runId: "R" } });
  assert.equal(store.snapshot().runs.R.status, "paused");

  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "R", at: 999 },
  });
  let r = store.snapshot().runs.R;
  assert.equal(r.status, "completed");
  assert.equal(r.completedAt, 999);

  dispatcher.notifyTaps({ type: "pipeline_reset", data: { runId: "R" } });
  r = store.snapshot().runs.R;
  assert.equal(r.status, "idle");
  assert.equal(r.phase, null);
  assert.equal(r.phaseIdx, null);
});

test("MC2: non-lifecycle event types don't bump runSyncs", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  dispatcher.notifyTaps({ type: "tool_recorded", data: { runId: "X", tool: "Edit" } });
  dispatcher.notifyTaps({ type: "toast", data: { message: "hi" } });
  assert.equal(handle.stats().runSyncs, 0);
  // pushEvent still ran, though.
  assert.ok(handle.stats().eventsForwarded >= 1);
});

test("MC2: lifecycle events without runId are skipped (no upsertRun)", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  dispatcher.notifyTaps({ type: "pipeline_start", data: { /* no runId */ template: "x" } });
  assert.deepEqual(store.snapshot().runIds, []);
  assert.equal(handle.stats().runSyncs, 0);
});

test("MC2: bridge picks up a brand-new run after mount (the gap MC2 closes)", () => {
  const store = createMonitorStore();
  // Bootstrap delivered ZERO runs; bridge then sees a run_created.
  assert.deepEqual(store.snapshot().runIds, []);
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "run_created",
    data: { runId: "session-2", templateId: "general", at: 1 },
  });
  assert.deepEqual(store.snapshot().runIds, ["session-2"]);
});

test("MC2: a phase_update sequence on the same run reflects every step in run-summary state", () => {
  const store = createMonitorStore();
  makeBridge(store);
  dispatcher.notifyTaps({
    type: "pipeline_start",
    data: { runId: "S", template: "default", phase: "A", phaseIdx: 0 },
  });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "S", phase: "B", phaseIdx: 1, status: "active" },
  });
  dispatcher.notifyTaps({
    type: "phase_update",
    data: { runId: "S", phase: "C", phaseIdx: 2, status: "active" },
  });
  dispatcher.notifyTaps({
    type: "pipeline_complete",
    data: { runId: "S", at: 555 },
  });
  const r = store.snapshot().runs.S;
  assert.equal(r.status, "completed");
  assert.equal(r.phase, "C");        // phase preserved through complete
  assert.equal(r.phaseIdx, 2);
  assert.equal(r.completedAt, 555);
});

test("MC2: _syncRunFromEvent is exposed as a test hook", () => {
  const store = createMonitorStore();
  const handle = makeBridge(store);
  assert.equal(typeof handle._syncRunFromEvent, "function");
  // Calling directly bypasses the dispatcher tap.
  handle._syncRunFromEvent({ type: "run_created", data: { runId: "T", templateId: "general" } });
  assert.deepEqual(Object.keys(store.snapshot().runs), ["T"]);
});

// ── Slice UX-2-a: approval lifecycle WS events ──────────────────

test("UX-2-a: approval_requested → store.upsertApproval", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });

  dispatcher.notifyTaps({
    type: "approval_requested",
    data: {
      approvalId: "appr-1",
      hook: "PreToolUse",
      tool: "Bash",
      args: { command: "echo hi" },
      argsHash: "deadbeef",
      argsSummary: "echo hi",
      runId: "run-1",
      hostIdentity: "host-A",
      source: "remote_hook",
      piiContext: null,
      timeoutMs: 30000,
      requestedAt: 1000,
      expiresAt: 31000,
    },
  });

  const snap = store.snapshot();
  assert.equal(snap.pendingApprovals.length, 1);
  assert.equal(snap.pendingApprovals[0].approvalId, "appr-1");
  assert.equal(snap.pendingApprovals[0].tool, "Bash");
  assert.equal(handle.stats().approvalSyncs, 1);
  // Approval events should NOT pollute the events ring.
  assert.equal(snap.events.length, 0);
  handle.destroy();
});

test("UX-2-a: approval_resolved → store.resolveApproval", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });

  // Seed a pending approval.
  store.upsertApproval({
    approvalId: "appr-1", tool: "Bash", argsSummary: "x", requestedAt: 100,
  });
  assert.equal(store.snapshot().pendingApprovals.length, 1);

  dispatcher.notifyTaps({
    type: "approval_resolved",
    data: {
      approvalId: "appr-1", resolution: "granted",
      decidedAt: 5000, deciderId: "operator-1",
    },
  });

  assert.equal(store.snapshot().pendingApprovals.length, 0);
  assert.equal(handle.stats().approvalSyncs, 1);
  handle.destroy();
});

test("UX-2-a: approval_resolved with unknown id is a no-op (no exception)", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });

  // No pending entry; resolved arrives anyway (e.g., out-of-order
  // delivery or grant after page refresh).
  dispatcher.notifyTaps({
    type: "approval_resolved",
    data: { approvalId: "ghost-id", resolution: "granted" },
  });

  assert.equal(store.snapshot().pendingApprovals.length, 0);
  // approvalSyncs still bumps because the bridge attempted the
  // resolveApproval call. The store's internal no-op for unknown
  // ids is what makes this safe.
  assert.equal(handle.stats().approvalSyncs, 1);
  handle.destroy();
});

test("UX-2-a: approval events do NOT also push to events ring (precedence)", () => {
  // Approval events have their own slice; routing them through
  // pushEvent too would create duplicate UI cards (one in the
  // pending-approvals slice, one in the events ring) — operator-
  // confusing. The bridge precedence-checks _syncApprovalFromEvent
  // before falling through to pushEvent.
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });

  dispatcher.notifyTaps({
    type: "approval_requested",
    data: { approvalId: "x", tool: "Bash", argsSummary: "y", requestedAt: 1 },
  });
  dispatcher.notifyTaps({
    type: "approval_resolved",
    data: { approvalId: "x", resolution: "denied" },
  });
  dispatcher.notifyTaps({
    type: "tool_recorded",  // non-approval — should land in events
    data: { runId: "default", tool: "Read" },
  });

  const snap = store.snapshot();
  assert.equal(snap.events.length, 1, "only the tool_recorded event lands in the ring");
  assert.equal(snap.events[0].scope, "tool");
  handle.destroy();
});

test("UX-2-a: approval events run BEFORE run sync (lifecycle precedence)", () => {
  // approval_requested doesn't carry a runId in the lifecycle-event
  // sense, so _syncRunFromEvent would no-op anyway. But this test
  // pins the precedence so a future refactor that handles approval
  // events via pushEvent first doesn't regress the slice routing.
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });
  dispatcher.notifyTaps({
    type: "approval_requested",
    data: {
      approvalId: "x", tool: "Bash", argsSummary: "y", requestedAt: 1,
      runId: "run-1",  // present but should NOT trigger upsertRun
    },
  });
  // The approval lifecycle should not have created a run entry.
  assert.equal(Object.keys(store.snapshot().runs).length, 0);
  assert.equal(store.snapshot().pendingApprovals.length, 1);
  handle.destroy();
});

test("UX-2-a: approvalSyncs counter starts at 0 and increments per approval event", () => {
  dispatcher._resetForTests();
  const store = createMonitorStore();
  const handle = install({
    store, normalize, dispatcher,
    setIntervalFn: () => null, clearIntervalFn: () => {},
  });
  assert.equal(handle.stats().approvalSyncs, 0);

  dispatcher.notifyTaps({
    type: "approval_requested",
    data: { approvalId: "a", tool: "Bash", argsSummary: "x", requestedAt: 1 },
  });
  assert.equal(handle.stats().approvalSyncs, 1);

  dispatcher.notifyTaps({
    type: "approval_resolved",
    data: { approvalId: "a", resolution: "granted" },
  });
  assert.equal(handle.stats().approvalSyncs, 2);

  // A non-approval event doesn't bump.
  dispatcher.notifyTaps({ type: "tool_recorded", data: { runId: "x" } });
  assert.equal(handle.stats().approvalSyncs, 2);
  handle.destroy();
});