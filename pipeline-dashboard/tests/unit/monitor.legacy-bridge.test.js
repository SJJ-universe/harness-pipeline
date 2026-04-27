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
  const fn = async (url, opts) => {
    lastCall = { url, opts };
    return typeof response === "function" ? response() : response;
  };
  fn.lastCall = () => lastCall;
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
  const call = _fetch.lastCall();
  assert.equal(call.url, "/api/server/info");
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