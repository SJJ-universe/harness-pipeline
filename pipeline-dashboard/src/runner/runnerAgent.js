// Slice R1-e-3 (Phase D R1, 2026-04-28) — harness-runner agent.
//
// Transport-first agent. Its only responsibility right now is keeping
// a clean channel open to the orchestrator:
//
//   1. POST /api/runner/handshake (bootstrap → runnerToken)
//   2. POST /api/runner/heartbeat every heartbeatIntervalMs (sliding TTL)
//   3. WS open to /api/runner/events with the per-run runJWT
//   4. WS close → backoff + reconnect (capped exponential)
//   5. On graceful shutdown → close WS + stop heartbeat + exit cleanly
//
// What this agent does NOT do (intentionally — those are R1-g and beyond):
//
//   - Speak any business protocol over the WS. R1-g will define
//     `tool_use` / `tool_result` / `agent_started` / `agent_stopped`
//     frames and the matching projections into hookRouter / childRegistry.
//   - Execute Codex/Claude or run user code. R2+ adds run-execution.
//   - Use the HTTPS POST `/api/runner/hook` partition-recovery channel.
//     The fallback path is wired so a future R1-g revision can flip it on.
//
// Why "single run per process" for R1?
//
// MG1 §6 specifies env-driven, heartbeat-driven discovery for the runner
// control plane. R1 ships the "operator launches the agent for a specific
// run" shape: HARNESS_RUN_ID + HARNESS_RUN_JWT come pre-issued. R2 adds
// orchestrator-driven dispatch (push-via-heartbeat or pull-from-queue)
// which removes the operator from the loop.

const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

const STATES = Object.freeze({
  IDLE: "idle",
  HANDSHAKING: "handshaking",
  RUNNING: "running",          // heartbeat + WS both active
  RECONNECTING: "reconnecting",
  SHUTTING_DOWN: "shutting_down",
  STOPPED: "stopped",
});

/**
 * @typedef {object} RunnerAgentConfig
 * @property {string}   bootstrapToken      Required. From operator.
 * @property {string}   hostIdentity        Required. e.g., "runner-a/3".
 * @property {string}   orchestratorUrl     Required. e.g., "http://orch:4201".
 * @property {string}   runId               Required. Pre-assigned by operator/orch.
 * @property {string}   runJwt              Required. Pre-issued by orchestrator.
 * @property {string}   [sandboxClass="container-strict"]
 * @property {object}   [capabilities]
 * @property {number}   [heartbeatIntervalMs=5000]
 * @property {number}   [reconnectBaseMs=1000]
 * @property {number}   [reconnectMaxMs=30000]
 *
 * @typedef {object} RunnerAgentDeps
 * @property {function} [fetchImpl=globalThis.fetch]
 * @property {function} [WebSocketCtor]      The `ws` library's WebSocket. Required.
 * @property {function} [now=Date.now]
 * @property {function} [setTimeoutFn=setTimeout]
 * @property {function} [clearTimeoutFn=clearTimeout]
 * @property {function} [logger=console]
 */

class RunnerAgent {
  constructor(config, deps = {}) {
    // Validate required config strictly. Crash-loop bad config surfaces
    // immediately instead of letting the operator wonder why nothing's
    // happening.
    for (const k of ["bootstrapToken", "hostIdentity", "orchestratorUrl", "runId", "runJwt"]) {
      if (typeof config[k] !== "string" || config[k].length === 0) {
        throw new TypeError(`RunnerAgent: ${k} is required`);
      }
    }

    this.config = {
      sandboxClass: "container-strict",
      capabilities: null,
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
      reconnectBaseMs: DEFAULT_RECONNECT_BASE_MS,
      reconnectMaxMs: DEFAULT_RECONNECT_MAX_MS,
      ...config,
    };
    // Strip trailing slash so URL concat is uniform.
    this.config.orchestratorUrl = this.config.orchestratorUrl.replace(/\/+$/, "");

    this.fetch = deps.fetchImpl || globalThis.fetch;
    this.WebSocketCtor = deps.WebSocketCtor;
    this.now = deps.now || Date.now;
    this.setTimeoutFn = deps.setTimeoutFn || setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn || clearTimeout;
    this.logger = deps.logger || console;

    if (typeof this.fetch !== "function") {
      throw new TypeError("RunnerAgent: fetchImpl required (or global fetch)");
    }
    if (typeof this.WebSocketCtor !== "function") {
      throw new TypeError("RunnerAgent: WebSocketCtor required (e.g., from `ws` lib)");
    }

    this.state = STATES.IDLE;
    this.runnerToken = null;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempt = 0;
    this.ws = null;
    this.helloReceived = false;
    this.stats = {
      heartbeatsOk: 0,
      heartbeatsFailed: 0,
      wsConnects: 0,
      wsDisconnects: 0,
      wsHellos: 0,
      messagesReceived: 0,
    };
  }

  // ── public lifecycle ────────────────────────────────────────────

  async start() {
    if (this.state !== STATES.IDLE) {
      throw new Error(`RunnerAgent.start: invalid state ${this.state}`);
    }
    this.state = STATES.HANDSHAKING;
    await this._handshake();
    this.state = STATES.RUNNING;
    this._scheduleHeartbeat();
    this._connectWs();
  }

  async stop() {
    if (this.state === STATES.STOPPED || this.state === STATES.SHUTTING_DOWN) return;
    this.state = STATES.SHUTTING_DOWN;
    this._cancelHeartbeat();
    this._cancelReconnect();
    if (this.ws) {
      try { this.ws.close(1000, "shutdown"); } catch (_) {}
      this.ws = null;
    }
    this.state = STATES.STOPPED;
  }

  // ── handshake (§8.1 step 1) ─────────────────────────────────────

  async _handshake() {
    const url = this.config.orchestratorUrl + "/api/runner/handshake";
    const body = {
      hostIdentity: this.config.hostIdentity,
      sandboxClass: this.config.sandboxClass,
    };
    if (this.config.capabilities) body.capabilities = this.config.capabilities;

    const res = await this.fetch(url, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + this.config.bootstrapToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`handshake failed: HTTP ${res.status} — ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    if (typeof json.runnerToken !== "string" || json.runnerToken.length === 0) {
      throw new Error("handshake failed: response missing runnerToken");
    }
    this.runnerToken = json.runnerToken;
    this.logger.log("[harness-runner] handshake ok");
  }

  // ── heartbeat (§8.1 step 2) ─────────────────────────────────────

  _scheduleHeartbeat() {
    if (this.state === STATES.STOPPED || this.state === STATES.SHUTTING_DOWN) return;
    this._heartbeatTimer = this.setTimeoutFn(
      () => this._heartbeatTick(),
      this.config.heartbeatIntervalMs,
    );
  }

  _cancelHeartbeat() {
    if (this._heartbeatTimer) {
      this.clearTimeoutFn(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async _heartbeatTick() {
    this._heartbeatTimer = null;
    if (this.state === STATES.STOPPED || this.state === STATES.SHUTTING_DOWN) return;
    try {
      const res = await this.fetch(this.config.orchestratorUrl + "/api/runner/heartbeat", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + this.runnerToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hostIdentity: this.config.hostIdentity }),
      });
      if (res.ok) {
        this.stats.heartbeatsOk += 1;
      } else {
        this.stats.heartbeatsFailed += 1;
        this.logger.warn(`[harness-runner] heartbeat HTTP ${res.status}`);
        if (res.status === 401) {
          // runnerToken rotation case — re-handshake so we don't get
          // stuck in a 401 loop. Future MG1 §9 handling will surface
          // this in the audit ledger as a runner_reauth event.
          await this._handshake().catch((err) => {
            this.logger.error(`[harness-runner] re-handshake failed: ${err.message}`);
          });
        }
      }
    } catch (err) {
      this.stats.heartbeatsFailed += 1;
      this.logger.warn(`[harness-runner] heartbeat error: ${err.message}`);
    }
    this._scheduleHeartbeat();
  }

  // ── WS connect / reconnect (§8.1 step 3) ────────────────────────

  _connectWs() {
    if (this.state === STATES.STOPPED || this.state === STATES.SHUTTING_DOWN) return;

    const wsBase = this.config.orchestratorUrl.replace(/^http/, "ws");
    const url = wsBase
      + "/api/runner/events?runId=" + encodeURIComponent(this.config.runId)
      + "&token=" + encodeURIComponent(this.config.runJwt);

    this.helloReceived = false;
    let ws;
    try {
      ws = new this.WebSocketCtor(url);
    } catch (err) {
      this.logger.error(`[harness-runner] ws ctor threw: ${err.message}`);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on("open", () => {
      this.stats.wsConnects += 1;
      this._reconnectAttempt = 0;       // reset backoff on successful open
      this.logger.log(`[harness-runner] ws open run=${this.config.runId}`);
    });

    ws.on("message", (msg) => {
      this.stats.messagesReceived += 1;
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed && parsed.type === "hello" && parsed.runId === this.config.runId) {
          this.helloReceived = true;
          this.stats.wsHellos += 1;
          this.logger.log(`[harness-runner] ws hello received run=${this.config.runId}`);
        }
        // R1-g will route business frames here.
      } catch (_) { /* malformed — drop */ }
    });

    ws.on("close", (code, reason) => {
      this.stats.wsDisconnects += 1;
      this.logger.log(`[harness-runner] ws close code=${code} reason=${String(reason)}`);
      this.ws = null;
      // 1011 = orchestrator can't honor (mode=off, no key). Don't spin.
      // 1008 = bad credentials. Same — don't spin against a wall.
      if (code === 1011 || code === 1008) {
        this.logger.error(`[harness-runner] ws close ${code} is fatal — agent stopping`);
        this.stop();
        return;
      }
      this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      // Errors usually precede a close; the close handler does the
      // reconnect bookkeeping. Just log here.
      this.logger.warn(`[harness-runner] ws error: ${err && err.message ? err.message : err}`);
    });
  }

  _scheduleReconnect() {
    if (this.state === STATES.STOPPED || this.state === STATES.SHUTTING_DOWN) return;
    this.state = STATES.RECONNECTING;
    const attempt = this._reconnectAttempt + 1;
    this._reconnectAttempt = attempt;
    // Exponential backoff with jitter, capped at reconnectMaxMs.
    const base = this.config.reconnectBaseMs * Math.pow(2, Math.min(attempt - 1, 10));
    const capped = Math.min(base, this.config.reconnectMaxMs);
    // Full jitter: random in [capped/2, capped]
    const delay = Math.floor(capped / 2 + Math.random() * (capped / 2));
    this.logger.log(`[harness-runner] ws reconnect in ${delay}ms (attempt ${attempt})`);
    this._reconnectTimer = this.setTimeoutFn(() => {
      this._reconnectTimer = null;
      this.state = STATES.RUNNING;
      this._connectWs();
    }, delay);
  }

  _cancelReconnect() {
    if (this._reconnectTimer) {
      this.clearTimeoutFn(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

// ── env adapter for runner/index.js ─────────────────────────────────

// R1-k3: per-field validators. A bad numeric env var (NaN / 0 / negative
// / non-integer) used to fall through Number(...) and produce broken
// timer cadences (immediate retry loops on heartbeat, backoff that
// effectively disables itself). Now we fail fast in the same config-
// error path required env missing uses, so a misconfigured runner host
// never starts in a state where it can quietly DDoS the orchestrator.
//
// Minimums are chosen to flag obviously broken values, NOT to enforce a
// specific operational policy. Operators can still pick any value above
// the minimum; the floor exists to catch typos, off-by-one units (e.g.,
// "5" intended as "5000"), and copy-paste accidents.
const _ENV_NUMERIC_MIN_MS = Object.freeze({
  HARNESS_HEARTBEAT_INTERVAL_MS: 1_000,   // sub-second heartbeats spam the orch
  HARNESS_RECONNECT_BASE_MS:     100,     // base must allow fast recovery
  HARNESS_RECONNECT_MAX_MS:      1_000,   // cap below 1s defeats backoff
});

function _parsePositiveIntegerEnv(name, raw) {
  const min = _ENV_NUMERIC_MIN_MS[name];
  // Number("") is 0, Number(undefined) is NaN — but the caller only
  // dispatches here when the env var was set to a non-empty string.
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(
      `invalid ${name}: must be a finite integer ≥ ${min}ms (got ${JSON.stringify(raw)})`,
    );
  }
  return n;
}

function configFromEnv(env = process.env) {
  const required = {
    bootstrapToken: env.HARNESS_BOOTSTRAP_TOKEN,
    hostIdentity: env.HARNESS_HOST_IDENTITY,
    orchestratorUrl: env.HARNESS_ORCHESTRATOR_URL,
    runId: env.HARNESS_RUN_ID,
    runJwt: env.HARNESS_RUN_JWT,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => typeof v !== "string" || v.length === 0)
    .map(([k]) => k);
  if (missing.length > 0) {
    const envKeys = missing.map((k) => "HARNESS_" + k.replace(/([A-Z])/g, "_$1").toUpperCase());
    throw new Error("missing required env: " + envKeys.join(", "));
  }
  const optional = {};
  if (env.HARNESS_SANDBOX_CLASS) optional.sandboxClass = env.HARNESS_SANDBOX_CLASS;
  // R1-k3: each numeric env var goes through validation so a bad value
  // throws *here* (config error path), not at the first timer fire.
  if (env.HARNESS_HEARTBEAT_INTERVAL_MS) {
    optional.heartbeatIntervalMs = _parsePositiveIntegerEnv(
      "HARNESS_HEARTBEAT_INTERVAL_MS", env.HARNESS_HEARTBEAT_INTERVAL_MS,
    );
  }
  if (env.HARNESS_RECONNECT_BASE_MS) {
    optional.reconnectBaseMs = _parsePositiveIntegerEnv(
      "HARNESS_RECONNECT_BASE_MS", env.HARNESS_RECONNECT_BASE_MS,
    );
  }
  if (env.HARNESS_RECONNECT_MAX_MS) {
    optional.reconnectMaxMs = _parsePositiveIntegerEnv(
      "HARNESS_RECONNECT_MAX_MS", env.HARNESS_RECONNECT_MAX_MS,
    );
  }
  return { ...required, ...optional };
}

module.exports = { RunnerAgent, configFromEnv, STATES };
