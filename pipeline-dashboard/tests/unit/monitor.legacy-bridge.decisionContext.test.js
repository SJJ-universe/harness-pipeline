// Slice SMART-0-c (Phase 2 SMART arc, 2026-05-04) — legacy-bridge
// → /api/decision-context polling integration tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { install } = require("../../public/js/monitor/legacy-bridge");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");

// Minimal dispatcher stub — refresh-only tests don't need event taps.
function _stubDispatcher() {
  return {
    addTap: () => () => {},
    notifyTaps: () => {},
    _resetForTests: () => {},
  };
}

// Multi-URL fakeFetch — returns different responses per URL.
function fakeFetchByUrl(map) {
  let lastCall = null;
  const allCalls = [];
  const fn = async (url, opts) => {
    lastCall = { url, opts };
    allCalls.push(lastCall);
    const factory = map[url];
    if (typeof factory === "function") return factory();
    if (factory) return factory;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.lastCall = () => lastCall;
  fn.calls = () => allCalls.slice();
  fn.findCall = (url) => allCalls.find((c) => c.url === url) || null;
  return fn;
}

function fakeResponse(body, opts = {}) {
  return {
    ok: opts.ok !== false,
    status: opts.status || 200,
    json: async () => body,
  };
}

function manualInterval() {
  const scheduled = [];
  return {
    setIntervalFn: (fn) => { scheduled.push({ fn }); return scheduled.length; },
    clearIntervalFn: () => {},
    scheduled,
    async fire(idx = 0) {
      if (!scheduled[idx]) throw new Error("no scheduled interval");
      await scheduled[idx].fn();
    },
  };
}

function _validDecisionContext() {
  return {
    schema: "harness-decision-context/v1",
    timestamp: "2026-05-04T00:00:00.000Z",
    booleans: {
      hasPii: false, approvalPending: true, codexReviewMissing: false,
      auditExportReady: true, publicSector: false, hasActiveProfile: true,
      needsHumanDecision: true, remoteRunnerActive: false,
    },
    counts: {
      activeRuns: 1, pendingApprovals: 1, openReviewSessions: 0,
      remoteRunnerCount: 0, evidenceLedgerEntries: 12,
    },
    posture: { mode: "standard", publicSector: false },
    sources: {
      approvalManager: "ok", reviewSessionManager: "ok", runRegistry: "ok",
      deploymentProfile: "ok", evidenceLedger: "ok", profileStore: "ok",
      remoteRunner: "absent",
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────

test("SMART-0-c bridge: refreshDecisionContext exposed in handle API", () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: fakeFetchByUrl({}),
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  assert.equal(typeof handle.refreshDecisionContext, "function");
});

test("SMART-0-c bridge: refreshDecisionContext populates store.decisionContext", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/decision-context": fakeResponse(_validDecisionContext()),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  assert.equal(store.snapshot().decisionContext, null,
    "before refresh: slice is null");
  await handle.refreshDecisionContext();
  const dc = store.snapshot().decisionContext;
  assert.ok(dc, "after refresh: slice populated");
  assert.equal(dc.schema, "harness-decision-context/v1");
  assert.equal(dc.booleans.approvalPending, true);
  assert.equal(dc.counts.evidenceLedgerEntries, 12);
});

test("SMART-0-c bridge: scheduled interval also fires refreshDecisionContext", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/server/info": fakeResponse({ pid: 1, uptime: 1, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false, activeChildCount: 0 }),
    "/api/decision-context": fakeResponse(_validDecisionContext()),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
    refreshIntervalMs: 1000,
  });
  await ctl.fire();
  // Both endpoints hit
  assert.ok(_fetch.findCall("/api/server/info"),
    "scheduled tick must fetch /api/server/info");
  assert.ok(_fetch.findCall("/api/decision-context"),
    "scheduled tick must ALSO fetch /api/decision-context");
  // Slice populated
  assert.ok(store.snapshot().decisionContext);
  assert.equal(handle.stats().decisionContextRefreshes, 1);
  assert.equal(handle.stats().decisionContextErrors, 0);
});

test("SMART-0-c bridge: HTTP error increments decisionContextErrors", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/decision-context": fakeResponse({}, { ok: false, status: 500 }),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  await handle.refreshDecisionContext();
  assert.equal(handle.stats().decisionContextErrors, 1);
  assert.equal(handle.stats().decisionContextRefreshes, 0);
  assert.equal(store.snapshot().decisionContext, null,
    "failed refresh must NOT pollute the slice");
});

test("SMART-0-c bridge: thrown fetch increments decisionContextErrors", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = async () => { throw new Error("network down"); };
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  await handle.refreshDecisionContext();
  assert.equal(handle.stats().decisionContextErrors, 1);
});

test("SMART-0-c bridge: malformed (non-object) JSON body increments errors", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/decision-context": { ok: true, status: 200, json: async () => "not-an-object" },
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  await handle.refreshDecisionContext();
  assert.equal(handle.stats().decisionContextErrors, 1);
});

test("SMART-0-c bridge: wrong-schema payload still ticks success but slice rejects", async () => {
  // Server returns 200 but schema doesn't match — the route's
  // setDecisionContext skips. Bridge counts as success because HTTP
  // succeeded; slice skip is intentional defensiveness in the store.
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/decision-context": fakeResponse({ schema: "wrong/v0" }),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  await handle.refreshDecisionContext();
  assert.equal(handle.stats().decisionContextRefreshes, 1,
    "HTTP succeeded → bridge ticks success");
  assert.equal(store.snapshot().decisionContext, null,
    "but store schema-check rejected the payload");
});

test("SMART-0-c bridge: refreshDecisionContext is no-op when store lacks setDecisionContext", async () => {
  const olderStore = {
    snapshot: () => ({}),
    subscribe: () => () => {},
    pushEvent: () => {},
    bumpCounter: () => {},
    upsertRun: () => {},
    removeRun: () => {},
    selectRun: () => {},
    upsertApproval: () => {},
    resolveApproval: () => {},
    upsertReviewSession: () => {},
    appendReviewChunk: () => {},
    setReviewSessionsList: () => {},
    selectReviewSession: () => {},
    // Note: NO setDecisionContext (older store build)
  };
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/decision-context": fakeResponse(_validDecisionContext()),
  });
  const handle = install({
    store: olderStore, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
  });
  await handle.refreshDecisionContext();
  // No fetch issued because the bridge defensively early-returns
  assert.equal(handle.stats().decisionContextRefreshes, 0);
  assert.equal(_fetch.calls().length, 0,
    "older store without setDecisionContext → bridge skips the fetch entirely");
});

test("SMART-0-c bridge: custom decisionContextUrl override", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/custom/dc-endpoint": fakeResponse(_validDecisionContext()),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
    decisionContextUrl: "/custom/dc-endpoint",
  });
  await handle.refreshDecisionContext();
  assert.ok(_fetch.findCall("/custom/dc-endpoint"),
    "custom decisionContextUrl must be honored");
  assert.equal(handle.stats().decisionContextRefreshes, 1);
});

test("SMART-0-c bridge: decision-context error doesn't poison /api/server/info refresh", async () => {
  const store = createMonitorStore();
  const ctl = manualInterval();
  const _fetch = fakeFetchByUrl({
    "/api/server/info": fakeResponse({ pid: 7, uptime: 1, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false, activeChildCount: 0 }),
    // decision-context errors out
    "/api/decision-context": fakeResponse({}, { ok: false, status: 500 }),
  });
  const handle = install({
    store, normalize,
    dispatcher: _stubDispatcher(),
    fetchImpl: _fetch,
    setIntervalFn: ctl.setIntervalFn,
    clearIntervalFn: ctl.clearIntervalFn,
    refreshIntervalMs: 1000,
  });
  await ctl.fire();
  // /api/server/info still succeeded
  assert.equal(handle.stats().refreshes, 1);
  assert.equal(handle.stats().refreshErrors, 0);
  assert.equal(store.snapshot().server.pid, 7);
  // /api/decision-context errored independently
  assert.equal(handle.stats().decisionContextErrors, 1);
});
