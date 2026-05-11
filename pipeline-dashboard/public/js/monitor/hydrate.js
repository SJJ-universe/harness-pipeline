// Slice MA2 (Phase D, 2026-04-27) — OrchestratorMonitorHydrate.
//
// Bridges /api/monitor/bootstrap into OrchestratorMonitorStore. DOM-free + UMD
// so Node tests can drive it with a stub fetch implementation, and the
// browser shell (MA3) can call `OrchestratorMonitorHydrate.hydrate({...})`
// during mount without pulling in any framework.
//
// Contract:
//   hydrateMonitorStore({ store, normalize, fetchImpl, url, headers })
//     → Promise<{ snapshot, raw }>
//
//   - store      : OrchestratorMonitorStore instance (required)
//   - normalize  : function(rawEvent) → envelope or null (required)
//                  supplied by the caller so this module stays decoupled
//                  from OrchestratorMonitorNormalizer's exact require path.
//   - fetchImpl  : optional fetch override (defaults to global fetch).
//                  Tests inject a stub; the browser uses window.fetch.
//   - url        : optional override (defaults to /api/monitor/bootstrap).
//   - headers    : optional headers object (auth token, etc.).
//
// On success the store is mutated in this order:
//   1. setServerSummary(payload.server)
//   2. setActiveChildren(payload.activeChildren)
//   3. upsertRun(...) for every run in payload.runs
//   4. selectRun(payload.selectedRunId)
//   5. pushEvent(normalize(entry.event)) for every recentEvent
//
// The order matters because `selectRun` only accepts a runId that already
// exists in the store, and `pushEvent` updates the matching run's
// `lastEventAt` if the run is already registered.
//
// On HTTP failure the function rejects with an Error carrying status +
// message; the store is left untouched. This is intentional — partial
// hydration would leave the dashboard in a confusing in-between state.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorHydrate = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_URL = "/api/monitor/bootstrap";

  async function hydrateMonitorStore({
    store,
    normalize,
    fetchImpl,
    url = DEFAULT_URL,
    headers = {},
  } = {}) {
    if (!store || typeof store.setServerSummary !== "function") {
      throw new Error("hydrateMonitorStore: `store` must be a OrchestratorMonitorStore instance");
    }
    if (typeof normalize !== "function") {
      throw new Error("hydrateMonitorStore: `normalize` must be a function");
    }
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    if (typeof _fetch !== "function") {
      throw new Error("hydrateMonitorStore: no fetch implementation available");
    }

    const res = await _fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
    });
    if (!res || typeof res.ok !== "boolean") {
      throw new Error("hydrateMonitorStore: fetch returned no usable Response");
    }
    if (!res.ok) {
      const text = typeof res.text === "function"
        ? await res.text().catch(() => "")
        : "";
      const err = new Error(
        `monitor bootstrap failed: HTTP ${res.status}${text ? ` — ${text}` : ""}`
      );
      err.status = res.status;
      throw err;
    }

    const payload = typeof res.json === "function" ? await res.json() : null;
    if (!payload || typeof payload !== "object") {
      throw new Error("hydrateMonitorStore: bootstrap response is not an object");
    }

    // ── Apply to store (order matters, see header comment) ──
    if (payload.server && typeof payload.server === "object") {
      store.setServerSummary(payload.server);
    }
    if (Array.isArray(payload.activeChildren)) {
      store.setActiveChildren(payload.activeChildren);
    } else {
      store.setActiveChildren([]);
    }
    if (Array.isArray(payload.runs)) {
      for (const run of payload.runs) {
        if (!run || typeof run.id !== "string") continue;
        // Strip `id` so upsertRun's signature stays clean (it re-injects
        // the id key from the first arg).
        const { id, ...partial } = run;
        store.upsertRun(id, partial);
      }
    }
    // selectRun is a no-op if the runId is unknown, so it's safe to call
    // even when payload.selectedRunId is missing or stale.
    if (typeof payload.selectedRunId === "string") {
      store.selectRun(payload.selectedRunId);
    }
    if (Array.isArray(payload.recentEvents)) {
      for (const entry of payload.recentEvents) {
        // Buffer entries are { ts, event } — extract the inner event so
        // the normalizer sees the same shape it does on live WS frames.
        const raw = entry && typeof entry === "object" && entry.event
          ? entry.event
          : entry;
        const env = normalize(raw);
        if (env) store.pushEvent(env);
      }
    }

    return { snapshot: store.snapshot(), raw: payload };
  }

  // ── Slice MB1 (Phase D Round 2): per-run detail hydration ──────────
  //
  // hydrateRunDetail({ store, runId, fetchImpl, headers, urlPrefix })
  //   → Promise<{ snapshot, raw }>
  //
  //   - store     : OrchestratorMonitorStore instance (required)
  //   - runId     : string (required) — the run to fetch
  //   - fetchImpl : optional fetch override
  //   - headers   : optional headers
  //   - urlPrefix : default "/api/monitor/runs/" — caller can swap for tests
  //
  // On 200: store.setRunDetail(runId, payload), returns { snapshot, raw }.
  // On 404: store.clearRunDetail(runId) (the run vanished — drop stale data),
  //         throws Error with status:404.
  // On other failures: throws with the HTTP status. Store left untouched.
  //
  // Unlike hydrateMonitorStore (which is a one-shot bootstrap), this is
  // expected to be called many times — every tab switch, every selection
  // change. Keep its surface narrow.
  const RUN_DETAIL_PREFIX = "/api/monitor/runs/";

  async function hydrateRunDetail({
    store,
    runId,
    fetchImpl,
    headers = {},
    urlPrefix = RUN_DETAIL_PREFIX,
  } = {}) {
    if (!store || typeof store.setRunDetail !== "function") {
      throw new Error("hydrateRunDetail: `store` must be a OrchestratorMonitorStore instance");
    }
    if (typeof runId !== "string" || runId.length === 0) {
      throw new Error("hydrateRunDetail: `runId` is required");
    }
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    if (typeof _fetch !== "function") {
      throw new Error("hydrateRunDetail: no fetch implementation available");
    }

    const url = urlPrefix + encodeURIComponent(runId);
    const res = await _fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
    });
    if (!res || typeof res.ok !== "boolean") {
      throw new Error("hydrateRunDetail: fetch returned no usable Response");
    }
    if (res.status === 404) {
      // Stale runId — drop the cached detail so panels stop showing it.
      if (typeof store.clearRunDetail === "function") store.clearRunDetail(runId);
      const err = new Error("hydrateRunDetail: run not found (404)");
      err.status = 404;
      throw err;
    }
    if (!res.ok) {
      const text = typeof res.text === "function"
        ? await res.text().catch(() => "")
        : "";
      const err = new Error(
        `run detail failed: HTTP ${res.status}${text ? ` — ${text}` : ""}`
      );
      err.status = res.status;
      throw err;
    }

    const payload = typeof res.json === "function" ? await res.json() : null;
    if (!payload || typeof payload !== "object") {
      throw new Error("hydrateRunDetail: response is not an object");
    }

    store.setRunDetail(runId, payload);
    return { snapshot: store.snapshot(), raw: payload };
  }

  return { hydrateMonitorStore, hydrateRunDetail, DEFAULT_URL, RUN_DETAIL_PREFIX };
});
