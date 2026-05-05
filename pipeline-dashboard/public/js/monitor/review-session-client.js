// Slice UI-H7-b (Phase D / Phase E1.5, 2026-04-30) — review-session
// HTTP client.
//
// Thin wrapper over the 5 endpoints in src/routes/reviewSessionRoutes.js:
//
//   POST   /api/review-sessions               → createSession
//   POST   /api/review-sessions/:id/send-codex → sendToCodex
//   POST   /api/review-sessions/:id/follow-up  → followUp
//   POST   /api/review-sessions/:id/hand-back-claude → handBackToClaude
//   GET    /api/review-sessions/:id            → getSession
//   GET    /api/review-sessions                → listSessions
//
// Plus optional store integration:
//   - createSession: writes to store via upsertReviewSession + selectReviewSession
//   - listSessions:  writes to store via setReviewSessionsList
//   - getSession:    writes to store via upsertReviewSession
//
// All state-changing requests rely on the global x-harness-token
// auto-attached by api-client.js's fetch wrapper. Read-only GETs
// follow loopback CSRF (no token needed).
//
// Public-sector posture (UI-H7-e wires the UI layer): the routes
// already 409 hand-back-claude / follow-up target=claude when
// publicSector && !allowLocalExecutor. The client surfaces that
// 409 as a structured error so the UI can render an operator-
// friendly message ("Public-sector posture forbids local Claude.")
// instead of a generic toast.
//
// Test surface: every method takes an explicit `fetchImpl` so unit
// tests can drive without a real server. The default is the global
// fetch (which the api-client wrapper has already augmented with
// the token header).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessReviewSessionClient = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const DEFAULT_BASE = "/api/review-sessions";

  function _resolveFetch(fetchImpl) {
    if (typeof fetchImpl === "function") return fetchImpl;
    if (typeof fetch === "function") return fetch;
    return null;
  }

  // Fields that callers can attach to the route response so the store
  // is updated alongside the network call. None of these are required;
  // omit them when calling raw (e.g., from tests).
  function _attachStoreSync(opts) {
    const store = opts && opts.store;
    if (!store || typeof store !== "object") return null;
    return {
      upsertSession: typeof store.upsertReviewSession === "function"
        ? store.upsertReviewSession.bind(store) : null,
      setList: typeof store.setReviewSessionsList === "function"
        ? store.setReviewSessionsList.bind(store) : null,
      selectSession: typeof store.selectReviewSession === "function"
        ? store.selectReviewSession.bind(store) : null,
    };
  }

  /**
   * Map a fetch failure / non-OK response into a structured Error
   * the UI can render without parsing strings.
   *
   *   error.code       — short code: "network_error", "timeout",
   *                      "public_sector_local_executor_disabled",
   *                      "session_not_found", "invalid_state",
   *                      "review_session_invalid_input", etc.
   *   error.status     — HTTP status (or 0 for network-layer errors)
   *   error.serverData — raw JSON body if available
   */
  function _structuredError(opts) {
    const err = new Error(opts.message || "review_session_request_failed");
    err.code = opts.code || "review_session_request_failed";
    err.status = Number.isFinite(opts.status) ? opts.status : 0;
    if (opts.serverData !== undefined) err.serverData = opts.serverData;
    return err;
  }

  async function _request({ method, url, body, fetchImpl, headers = {} }) {
    const _fetch = _resolveFetch(fetchImpl);
    if (!_fetch) {
      throw _structuredError({
        code: "network_error",
        message: "no fetch implementation",
      });
    }
    const init = {
      method,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let res;
    try {
      res = await _fetch(url, init);
    } catch (e) {
      throw _structuredError({
        code: "network_error",
        message: e && e.message ? e.message : "network failure",
        status: 0,
      });
    }
    if (!res || typeof res.ok !== "boolean") {
      throw _structuredError({
        code: "network_error",
        message: "fetch returned no usable Response",
        status: 0,
      });
    }
    let payload = null;
    try {
      payload = typeof res.json === "function" ? await res.json() : null;
    } catch (_) { /* tolerate non-JSON */ }
    if (!res.ok) {
      const code = (payload && typeof payload === "object" && payload.error)
        || _statusToCode(res.status);
      throw _structuredError({
        code: String(code),
        message: payload && payload.message
          ? payload.message
          : `HTTP ${res.status}`,
        status: res.status,
        serverData: payload,
      });
    }
    return payload;
  }

  function _statusToCode(status) {
    if (status === 404) return "session_not_found";
    if (status === 400) return "invalid_input";
    if (status === 409) return "invalid_state";
    if (status === 503) return "service_unavailable";
    if (status >= 500) return "server_error";
    return "request_failed";
  }

  // ── Public methods ───────────────────────────────────────────────

  /**
   * Create a new review session.
   * @param {object} opts
   * @param {string} [opts.initialPlan]
   * @param {"selected_run"|"manual"} [opts.source]
   * @param {string} [opts.runId]
   * @param {string} [opts.label]
   * @param {object} [opts.store]   — if provided, also writes to store
   * @param {boolean} [opts.select=true] — if store provided, also selects
   * @param {string} [opts.base=DEFAULT_BASE]
   * @param {function} [opts.fetchImpl]
   * @param {object} [opts.headers]
   * @returns {Promise<object>} { ok, session }
   */
  async function createSession(opts = {}) {
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const body = {};
    if (typeof opts.initialPlan === "string") body.initialPlan = opts.initialPlan;
    if (typeof opts.source === "string") body.source = opts.source;
    if (typeof opts.runId === "string") body.runId = opts.runId;
    if (typeof opts.label === "string") body.label = opts.label;

    const payload = await _request({
      method: "POST", url: base, body,
      fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
      if (opts.select !== false && sync.selectSession) {
        sync.selectSession(payload.session.sessionId);
      }
    }
    return payload;
  }

  /**
   * Send Claude's plan to Codex for critique.
   * @param {string} sessionId
   * @param {object} opts
   * @param {string} opts.instruction
   * @param {string[]} [opts.contextEvents]
   * @param {string} [opts.preset]   — Slice S3-d: optional presetId
   *   (e.g. "security", "performance"). Server validates against the
   *   frozen presetLibrary; unknown presetId → 400 invalid_preset.
   * @param {object} [opts.store]
   * @param {string} [opts.base]
   * @param {function} [opts.fetchImpl]
   * @param {object} [opts.headers]
   */
  async function sendToCodex(sessionId, opts = {}) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw _structuredError({ code: "invalid_input", message: "sessionId required" });
    }
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const body = { instruction: opts.instruction };
    if (Array.isArray(opts.contextEvents)) body.contextEvents = opts.contextEvents;
    if (typeof opts.preset === "string" && opts.preset.length > 0) {
      body.preset = opts.preset;
    }

    const payload = await _request({
      method: "POST", url: `${base}/${encodeURIComponent(sessionId)}/send-codex`,
      body, fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
    }
    return payload;
  }

  /**
   * Operator follow-up to Codex or Claude.
   * @param {string} sessionId
   * @param {object} opts
   * @param {string} opts.question
   * @param {"codex"|"claude"} opts.target
   * @param {string} [opts.preset]   — Slice S3-d: optional presetId.
   */
  async function followUp(sessionId, opts = {}) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw _structuredError({ code: "invalid_input", message: "sessionId required" });
    }
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const body = { question: opts.question, target: opts.target };
    if (typeof opts.preset === "string" && opts.preset.length > 0) {
      body.preset = opts.preset;
    }

    const payload = await _request({
      method: "POST", url: `${base}/${encodeURIComponent(sessionId)}/follow-up`,
      body, fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
    }
    return payload;
  }

  /**
   * Hand the (verified) plan back to Claude. May raise 409 in
   * public-sector posture.
   * @param {string} sessionId
   * @param {object} opts
   * @param {string} opts.instruction
   * @param {boolean} [opts.includeCritique=true]
   * @param {string} [opts.preset]   — Slice S3-d: optional presetId.
   */
  async function handBackToClaude(sessionId, opts = {}) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw _structuredError({ code: "invalid_input", message: "sessionId required" });
    }
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const body = { instruction: opts.instruction };
    if (opts.includeCritique === false) body.includeCritique = false;
    if (typeof opts.preset === "string" && opts.preset.length > 0) {
      body.preset = opts.preset;
    }

    const payload = await _request({
      method: "POST",
      url: `${base}/${encodeURIComponent(sessionId)}/hand-back-claude`,
      body, fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
    }
    return payload;
  }

  /**
   * Archive a session (idempotent).
   * @param {string} sessionId
   * @param {object} [opts]
   * @param {string} [opts.reason]
   */
  async function archiveSession(sessionId, opts = {}) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw _structuredError({ code: "invalid_input", message: "sessionId required" });
    }
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const body = {};
    if (typeof opts.reason === "string") body.reason = opts.reason;

    const payload = await _request({
      method: "POST",
      url: `${base}/${encodeURIComponent(sessionId)}/archive`,
      body, fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
    }
    return payload;
  }

  /**
   * Fetch a single session's snapshot.
   */
  async function getSession(sessionId, opts = {}) {
    if (typeof sessionId !== "string" || !sessionId) {
      throw _structuredError({ code: "invalid_input", message: "sessionId required" });
    }
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const payload = await _request({
      method: "GET",
      url: `${base}/${encodeURIComponent(sessionId)}`,
      fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.upsertSession && payload && payload.session) {
      sync.upsertSession(payload.session.sessionId, payload.session);
    }
    return payload;
  }

  /**
   * List all sessions (sorted by lastActivityAt desc per server).
   */
  async function listSessions(opts = {}) {
    const base = typeof opts.base === "string" ? opts.base : DEFAULT_BASE;
    const payload = await _request({
      method: "GET", url: base,
      fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    const sync = _attachStoreSync(opts);
    if (sync && sync.setList && payload && Array.isArray(payload.sessions)) {
      sync.setList(payload.sessions);
    }
    return payload;
  }

  /**
   * Slice S3-d: List the 6 frozen review presets.
   *
   * Calls GET /api/review-presets. Returns {schema, presets, serverTime}
   * where each preset is {presetId, defaultLabel, defaultDescription}
   * (no system prompt body).
   *
   * @param {object} [opts]
   * @param {string} [opts.presetsBase="/api/review-presets"]
   * @param {function} [opts.fetchImpl]
   * @param {object} [opts.headers]
   */
  async function listPresets(opts = {}) {
    const url = typeof opts.presetsBase === "string"
      ? opts.presetsBase
      : "/api/review-presets";
    const payload = await _request({
      method: "GET", url,
      fetchImpl: opts.fetchImpl, headers: opts.headers,
    });
    return payload;
  }

  return {
    createSession,
    sendToCodex,
    followUp,
    handBackToClaude,
    archiveSession,
    getSession,
    listSessions,
    listPresets,
    DEFAULT_BASE,
    // Test hook
    _structuredError,
  };
});
