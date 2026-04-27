// Slice MA2 (Phase D, 2026-04-27) — HarnessMonitorHydrate unit tests.
//
// Drives the hydration helper with a stub fetch + the real
// HarnessMonitorStore + the real HarnessMonitorNormalizer to confirm the
// full bootstrap → store action sequence works end-to-end without a
// browser. Tests cover the happy path, fetch failures (HTTP error +
// network error), and graceful tolerance of missing payload sections.

const test = require("node:test");
const assert = require("node:assert/strict");
const { hydrateMonitorStore } = require("../../public/js/monitor/hydrate");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");

function fakeResponse({ status = 200, body = {}, ok = true } = {}) {
  return {
    ok,
    status,
    async json() { return body; },
    async text() { return typeof body === "string" ? body : JSON.stringify(body); },
  };
}

function fakeFetch(response) {
  let lastCall = null;
  const fn = async (url, opts) => {
    lastCall = { url, opts };
    return response;
  };
  fn.lastCall = () => lastCall;
  return fn;
}

// ── happy path ─────────────────────────────────────────────────────────

test("hydrateMonitorStore populates every store namespace from a full payload", async () => {
  const store = createMonitorStore();
  const payload = {
    server: { pid: 9001, uptime: 12.3, mode: "local", activeChildCount: 1 },
    runs: [
      { id: "default", status: "active", templateId: "general", phase: "B", phaseIdx: 1, startedAt: 1700000000000 },
      { id: "session-2", status: "idle", templateId: null, phase: null, phaseIdx: null, startedAt: null },
    ],
    selectedRunId: "default",
    activeChildren: [{ pid: 101, label: "codex", runId: "default", ageMs: 5000 }],
    activeChildCount: 1,
    recentEvents: [
      { ts: 1, event: { type: "phase_update", data: { runId: "default", phase: "B", status: "active" } } },
      { ts: 2, event: { type: "tool_recorded", data: { runId: "default", tool: "Edit" } } },
      { ts: 3, event: { type: "toast", data: { message: "hi" } } },
    ],
    exportedAt: "2026-04-27T00:00:00.000Z",
  };
  const _fetch = fakeFetch(fakeResponse({ body: payload }));

  const { snapshot, raw } = await hydrateMonitorStore({
    store,
    normalize,
    fetchImpl: _fetch,
  });

  // server summary
  assert.equal(snapshot.server.pid, 9001);
  assert.equal(snapshot.server.activeChildCount, 1);

  // runs
  assert.deepEqual(snapshot.runIds.sort(), ["default", "session-2"]);
  assert.equal(snapshot.runs.default.status, "active");
  assert.equal(snapshot.runs.default.phase, "B");
  assert.equal(snapshot.runs["session-2"].status, "idle");

  // selectedRunId
  assert.equal(snapshot.selectedRunId, "default");

  // activeChildren
  assert.equal(snapshot.activeChildren.length, 1);
  assert.equal(snapshot.activeChildren[0].pid, 101);

  // recentEvents → normalized envelopes pushed into store
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.events[0].type, "phase_update");
  assert.equal(snapshot.events[0].scope, "phase");
  assert.equal(snapshot.events[1].scope, "tool");
  // toast is a global event (no runId) → scope:"global" per normalizer
  assert.equal(snapshot.events[2].scope, "global");

  assert.equal(raw, payload, "raw payload returned for caller debugging");
});

// ── fetch URL + headers ────────────────────────────────────────────────

test("hydrateMonitorStore calls the default URL and forwards headers", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: { server: {}, runs: [], activeChildren: [], recentEvents: [] } }));
  await hydrateMonitorStore({
    store,
    normalize,
    fetchImpl: _fetch,
    headers: { "x-harness-token": "abc" },
  });
  const call = _fetch.lastCall();
  assert.equal(call.url, "/api/monitor/bootstrap");
  assert.equal(call.opts.method, "GET");
  assert.equal(call.opts.headers.Accept, "application/json");
  assert.equal(call.opts.headers["x-harness-token"], "abc");
});

test("hydrateMonitorStore uses a custom URL when provided", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: { server: {}, runs: [], activeChildren: [], recentEvents: [] } }));
  await hydrateMonitorStore({
    store,
    normalize,
    fetchImpl: _fetch,
    url: "/custom/path",
  });
  assert.equal(_fetch.lastCall().url, "/custom/path");
});

// ── selectRun ignored if id unknown ────────────────────────────────────

test("hydrateMonitorStore skips selectRun when the id isn't in the runs list", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: {
    server: {},
    runs: [{ id: "default", status: "idle" }],
    selectedRunId: "ghost-run",   // not in runs → store.selectRun is a no-op
    activeChildren: [],
    recentEvents: [],
  } }));
  const { snapshot } = await hydrateMonitorStore({ store, normalize, fetchImpl: _fetch });
  assert.equal(snapshot.selectedRunId, null, "store guards against unknown runIds");
});

// ── partial payloads ───────────────────────────────────────────────────

test("hydrateMonitorStore tolerates missing optional sections", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: { server: { pid: 1 } } }));
  // Only `server` present — runs, activeChildren, recentEvents all missing.
  const { snapshot } = await hydrateMonitorStore({ store, normalize, fetchImpl: _fetch });
  assert.equal(snapshot.server.pid, 1);
  assert.deepEqual(snapshot.runIds, []);
  assert.deepEqual(snapshot.activeChildren, []);
  assert.deepEqual(snapshot.events, []);
});

test("hydrateMonitorStore drops malformed run entries instead of throwing", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: {
    server: {},
    runs: [
      { id: "ok", status: "active" },
      null,
      { status: "missing-id" },
      "garbage",
      { id: 42, status: "non-string-id" },
    ],
    activeChildren: [],
    recentEvents: [],
  } }));
  const { snapshot } = await hydrateMonitorStore({ store, normalize, fetchImpl: _fetch });
  assert.deepEqual(snapshot.runIds, ["ok"]);
});

// ── error paths ────────────────────────────────────────────────────────

test("hydrateMonitorStore rejects with HTTP status on non-2xx", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({
    ok: false,
    status: 401,
    body: "missing token",
  }));
  await assert.rejects(
    () => hydrateMonitorStore({ store, normalize, fetchImpl: _fetch }),
    (err) => {
      assert.match(err.message, /HTTP 401/);
      assert.equal(err.status, 401);
      return true;
    }
  );
  // Store untouched — partial hydration would be misleading.
  assert.equal(store.snapshot().server, null);
});

test("hydrateMonitorStore rejects when fetch itself throws (network failure)", async () => {
  const store = createMonitorStore();
  const _fetch = async () => { throw new Error("ECONNREFUSED"); };
  await assert.rejects(
    () => hydrateMonitorStore({ store, normalize, fetchImpl: _fetch }),
    /ECONNREFUSED/
  );
  assert.equal(store.snapshot().server, null);
});

test("hydrateMonitorStore rejects when payload is not an object", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: "plain text" }));
  // res.json() will return the string per our fakeResponse — typeof string !== object.
  await assert.rejects(
    () => hydrateMonitorStore({ store, normalize, fetchImpl: _fetch }),
    /not an object/
  );
});

// ── input validation ──────────────────────────────────────────────────

test("hydrateMonitorStore throws if `store` is missing", async () => {
  await assert.rejects(
    () => hydrateMonitorStore({ normalize, fetchImpl: fakeFetch(fakeResponse()) }),
    /must be a HarnessMonitorStore instance/
  );
});

test("hydrateMonitorStore throws if `normalize` is not a function", async () => {
  await assert.rejects(
    () => hydrateMonitorStore({
      store: createMonitorStore(),
      normalize: "not-a-fn",
      fetchImpl: fakeFetch(fakeResponse()),
    }),
    /normalize.*function/
  );
});

test("hydrateMonitorStore throws if no fetch implementation is available", async () => {
  // Save & null out global fetch, then restore so other tests still work.
  const savedFetch = globalThis.fetch;
  // eslint-disable-next-line no-global-assign
  globalThis.fetch = undefined;
  try {
    await assert.rejects(
      () => hydrateMonitorStore({
        store: createMonitorStore(),
        normalize,
        // no fetchImpl, no global fetch
      }),
      /no fetch implementation/
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});
