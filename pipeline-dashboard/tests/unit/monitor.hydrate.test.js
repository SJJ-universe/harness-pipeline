// Slice MA2 (Phase D, 2026-04-27) — HarnessMonitorHydrate unit tests.
//
// Drives the hydration helper with a stub fetch + the real
// HarnessMonitorStore + the real HarnessMonitorNormalizer to confirm the
// full bootstrap → store action sequence works end-to-end without a
// browser. Tests cover the happy path, fetch failures (HTTP error +
// network error), and graceful tolerance of missing payload sections.

const test = require("node:test");
const assert = require("node:assert/strict");
const { hydrateMonitorStore, hydrateRunDetail, RUN_DETAIL_PREFIX } = require("../../public/js/monitor/hydrate");
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

// ── Slice MB1: hydrateRunDetail ──────────────────────────────────────

test("RUN_DETAIL_PREFIX export points at /api/monitor/runs/", () => {
  assert.equal(RUN_DETAIL_PREFIX, "/api/monitor/runs/");
});

test("hydrateRunDetail GETs the right URL + writes payload to runDetails", async () => {
  const store = createMonitorStore();
  const detail = {
    run: { id: "default", status: "active", templateId: "general" },
    recentEvents: [{ ts: 1, event: { type: "phase_update" } }],
    children: [{ pid: 101, label: "codex", runId: "default", ageMs: 100 }],
    subagents: [],
    findings: [],
    findingsOverflow: null,
    replayMeta: { hasCheckpoint: false, savedAt: null },
    exportedAt: "2026-04-27T00:00:00Z",
  };
  const _fetch = fakeFetch(fakeResponse({ body: detail }));
  const { snapshot, raw } = await hydrateRunDetail({
    store, runId: "default", fetchImpl: _fetch,
  });
  const call = _fetch.lastCall();
  assert.equal(call.url, "/api/monitor/runs/default");
  assert.equal(call.opts.method, "GET");
  assert.equal(call.opts.headers.Accept, "application/json");
  assert.deepEqual(snapshot.runDetails.default, detail);
  assert.equal(raw, detail, "raw payload returned for caller debugging");
});

test("hydrateRunDetail URL-encodes the runId for safety", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: { run: { id: "x" } } }));
  await hydrateRunDetail({
    store, runId: "session/2 with spaces", fetchImpl: _fetch,
  });
  // encodeURIComponent: "/" → %2F, " " → %20.
  assert.equal(_fetch.lastCall().url, "/api/monitor/runs/session%2F2%20with%20spaces");
});

test("hydrateRunDetail forwards custom headers + custom URL prefix", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: { run: { id: "x" } } }));
  await hydrateRunDetail({
    store, runId: "x",
    fetchImpl: _fetch,
    headers: { "x-harness-token": "abc" },
    urlPrefix: "/custom/runs/",
  });
  const call = _fetch.lastCall();
  assert.equal(call.url, "/custom/runs/x");
  assert.equal(call.opts.headers["x-harness-token"], "abc");
});

test("hydrateRunDetail on 404 clears the cached detail and throws", async () => {
  const store = createMonitorStore();
  // Pre-seed a detail so we can verify it gets cleared.
  store.setRunDetail("ghost", { run: { id: "ghost", status: "active" } });
  const _fetch = fakeFetch(fakeResponse({ ok: false, status: 404, body: "gone" }));
  await assert.rejects(
    () => hydrateRunDetail({ store, runId: "ghost", fetchImpl: _fetch }),
    (err) => {
      assert.equal(err.status, 404);
      assert.match(err.message, /404/);
      return true;
    }
  );
  assert.equal(store.snapshot().runDetails.ghost, undefined, "stale detail cleared on 404");
});

test("hydrateRunDetail rejects on non-2xx (non-404) without touching the store", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ ok: false, status: 503, body: "down" }));
  await assert.rejects(
    () => hydrateRunDetail({ store, runId: "x", fetchImpl: _fetch }),
    (err) => {
      assert.equal(err.status, 503);
      return true;
    }
  );
  assert.deepEqual(store.snapshot().runDetails, {}, "store untouched on 5xx");
});

test("hydrateRunDetail rejects on missing runId / non-store / no fetch", async () => {
  await assert.rejects(
    () => hydrateRunDetail({ store: createMonitorStore() }),
    /runId.*required/
  );
  await assert.rejects(
    () => hydrateRunDetail({ runId: "x", fetchImpl: fakeFetch(fakeResponse()) }),
    /must be a HarnessMonitorStore/
  );
  // Unset global fetch + omit fetchImpl → should throw.
  const savedFetch = globalThis.fetch;
  // eslint-disable-next-line no-global-assign
  globalThis.fetch = undefined;
  try {
    await assert.rejects(
      () => hydrateRunDetail({ store: createMonitorStore(), runId: "x" }),
      /no fetch implementation/
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test("hydrateRunDetail rejects when payload is not an object", async () => {
  const store = createMonitorStore();
  const _fetch = fakeFetch(fakeResponse({ body: "plain text" }));
  await assert.rejects(
    () => hydrateRunDetail({ store, runId: "x", fetchImpl: _fetch }),
    /not an object/
  );
});
