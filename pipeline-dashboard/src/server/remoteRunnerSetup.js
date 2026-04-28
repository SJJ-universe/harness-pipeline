// Slice R1-h (Phase D R1, 2026-04-28) — remote-runner subsystem wiring.
//
// Centralizes the env reads + key derivations needed to bring up the
// `/api/runner/*` HTTP routes. Returns a single object that server.js
// passes to `createRunnerRoutes` and `EvidenceLedger`. Keeping this
// out of server.js means tests can exercise the wiring policy without
// booting the full server.
//
// Policy:
//
//   HARNESS_REMOTE_MODE   =  "off" | "preview" | "on"
//                            (default "off" → all runner routes 404)
//   HARNESS_TOKEN         =  ikm for HKDF. When mode≠off but token
//                            missing → setup returns a disabled shape
//                            with `error: "token_missing"` so server.js
//                            can log + still 503 instead of crashing.
//
// Keys (per MG1 RFC §4 / §5):
//
//   jwtKey     = HKDF(token, salt="harness-jwt-v1", info="runner-jwt")
//   ledgerKey  = HKDF(token, salt="harness-jwt-v1", info="audit-ledger")
//
// Same salt + different info gives two independent keyspaces. JWT key
// compromise ≠ ledger key compromise.

const { RunnerRegistry } = require("../runtime/runnerRegistry");
const { deriveJwtKey } = require("../security/jwt");

const VALID_MODES = new Set(["off", "preview", "on"]);

function _readMode(env) {
  const raw = (env && env.HARNESS_REMOTE_MODE) || "off";
  return VALID_MODES.has(raw) ? raw : "off";
}

/**
 * @param {object} [opts]
 * @param {object} [opts.env]    - process.env override (tests).
 * @param {string} [opts.mode]   - explicit mode override (tests).
 * @param {string} [opts.token]  - explicit HARNESS_TOKEN override (tests).
 * @returns {{
 *   mode: "off"|"preview"|"on",
 *   runnerRegistry: RunnerRegistry|null,
 *   jwtKey: Buffer|null,
 *   ledgerKey: Buffer|null,
 *   error: string|null,
 * }}
 */
function setupRemoteRunner(opts = {}) {
  const env = opts.env || process.env;
  const mode = opts.mode || _readMode(env);
  const token = opts.token != null ? opts.token : env.HARNESS_TOKEN;

  // Off / unset → don't construct anything. server.js will still call
  // createRunnerRoutes with mode="off" so the routes uniformly 404.
  if (mode === "off") {
    return { mode, runnerRegistry: null, jwtKey: null, ledgerKey: null, error: null };
  }

  // preview / on but no token → degraded. Routes mount with mode but no
  // registry, so they 503 instead of accepting unauthenticated bootstraps.
  if (typeof token !== "string" || token.length === 0) {
    return { mode, runnerRegistry: null, jwtKey: null, ledgerKey: null, error: "token_missing" };
  }

  // Both keys derive from the same IKM but use different `info` labels —
  // domain separation. Salt is shared and versioned ("harness-jwt-v1")
  // so a future key-rotation event can be a single salt bump.
  const jwtKey = deriveJwtKey(token, { info: "runner-jwt" });
  const ledgerKey = deriveJwtKey(token, { info: "audit-ledger" });

  return {
    mode,
    runnerRegistry: new RunnerRegistry(),
    jwtKey,
    ledgerKey,
    error: null,
  };
}

module.exports = { setupRemoteRunner };
