// Slice POL-c (Phase 2 / POLICY-UX-0, 2026-05-05) — legacy-bridge
// policyPacks one-shot fetch tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { install } = require("../../public/js/monitor/legacy-bridge");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");
const dispatcher = require("../../public/js/event-dispatcher");

function fakeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok, status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function fakeFetch(routeMap) {
  // routeMap: { "/api/server/info": response, "/api/policy-packs": response }
  const allCalls = [];
  return {
    fn: async (url, _opts) => {
      allCalls.push(url);
      if (url in routeMap) return routeMap[url];
      // Default: return success with empty body
      return fakeResponse({});
    },
    calls: () => allCalls.slice(),
  };
}

function manualInterval() {
  return {
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  };
}

const samplePolicyPacksPayload = {
  schema: "orchestrator-policy-pack/v1",
  currentPack: "finance-high-privacy",
  packs: [
    { modeId: "finance-high-privacy", label: "Finance High-Privacy",
      hardGatesDefault: true, isCurrent: true },
  ],
  metadata: {
    hardGatesEffectiveMode: "hard",
    runMemoryEffective: true,
    hardGatesEnvOverride: false,
    runMemoryEnvOverride: false,
    publicSectorRequirements: ["agency-managed"],
  },
  serverTime: 1_000_000,
};

// ── One-shot fetch on install ─────────────────────────────────────

test("POL-c bridge: install triggers ONE policy-packs fetch + populates store", async () => {
  const store = createMonitorStore();
  const interval = manualInterval();
  const fetch = fakeFetch({
    "/api/policy-packs": fakeResponse({ body: samplePolicyPacksPayload }),
  });
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: fetch.fn,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });

  // Wait for promise to flush
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const policyPacksCalls = fetch.calls().filter((u) => u === "/api/policy-packs");
  assert.equal(policyPacksCalls.length, 1, "exactly one policy-packs fetch on install");

  // Store populated
  const snap = store.snapshot();
  assert.ok(snap.policyPacks);
  assert.equal(snap.policyPacks.currentPack, "finance-high-privacy");

  // Stats counter ticked
  const stats = handle.stats();
  assert.equal(stats.policyPacksRefreshes, 1);

  handle.destroy();
});

test("POL-c bridge: HTTP error → policyPacksErrors counter ticks; store stays null", async () => {
  const store = createMonitorStore();
  const interval = manualInterval();
  const fetch = fakeFetch({
    "/api/policy-packs": fakeResponse({ ok: false, status: 503 }),
  });
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: fetch.fn,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  const stats = handle.stats();
  assert.equal(stats.policyPacksErrors, 1);
  assert.equal(stats.policyPacksRefreshes, undefined);
  assert.equal(store.snapshot().policyPacks, null);

  handle.destroy();
});

test("POL-c bridge: network throw → policyPacksErrors counter ticks", async () => {
  const store = createMonitorStore();
  const interval = manualInterval();
  const throwingFetch = async () => { throw new Error("offline"); };
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: throwingFetch,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(handle.stats().policyPacksErrors, 1);
  assert.equal(store.snapshot().policyPacks, null);
  handle.destroy();
});

test("POL-c bridge: refreshPolicyPacks() exposed for manual re-fetch", async () => {
  const store = createMonitorStore();
  const interval = manualInterval();
  const fetch = fakeFetch({
    "/api/policy-packs": fakeResponse({ body: samplePolicyPacksPayload }),
  });
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: fetch.fn,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });
  await new Promise((r) => setImmediate(r));

  // Manual re-fetch
  await handle.refreshPolicyPacks();

  const policyPacksCalls = fetch.calls().filter((u) => u === "/api/policy-packs");
  assert.equal(policyPacksCalls.length, 2, "second fetch from explicit call");
  // Idempotent payload → no second publish (same JSON content)
  // (we can't easily test publish count here without subscribing earlier)

  handle.destroy();
});

test("POL-c bridge: NON-JSON body → policyPacksErrors (defensive)", async () => {
  const store = createMonitorStore();
  const interval = manualInterval();
  const malformedResponse = {
    ok: true, status: 200,
    async json() { throw new Error("not JSON"); },
  };
  const fetch = fakeFetch({
    "/api/policy-packs": malformedResponse,
  });
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: fetch.fn,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(handle.stats().policyPacksErrors, 1);
  assert.equal(store.snapshot().policyPacks, null);

  handle.destroy();
});

test("POL-c bridge: foreign schema in response → store unchanged but no error", async () => {
  // Bridge calls store.setPolicyPacks; the slice's own schema check
  // rejects foreign schemas. From the bridge's perspective the HTTP
  // call succeeded (counter ticks "refreshes" not "errors").
  const store = createMonitorStore();
  const interval = manualInterval();
  const fetch = fakeFetch({
    "/api/policy-packs": fakeResponse({ body: { schema: "evil/v9", packs: [] } }),
  });
  if (typeof dispatcher.clearTaps === "function") dispatcher.clearTaps();

  const handle = install({
    store,
    normalize,
    dispatcher,
    fetchImpl: fetch.fn,
    setIntervalFn: interval.setIntervalFn,
    clearIntervalFn: interval.clearIntervalFn,
  });

  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  // HTTP succeeded — refreshes counter ticks
  assert.equal(handle.stats().policyPacksRefreshes, 1);
  // But store rejected foreign schema
  assert.equal(store.snapshot().policyPacks, null);

  handle.destroy();
});
