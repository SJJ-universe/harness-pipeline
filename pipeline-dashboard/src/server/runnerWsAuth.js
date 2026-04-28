// Slice R1-e-1 (Phase D R1, 2026-04-28) — runner WS upgrade auth gate.
//
// PATH-AWARE DEMUX, NOT a reuse of `wsAuth.js`.
//
// `wsAuth.js` (Slice S1 / MA0) gates dashboard + terminal upgrades using
// the operator-side rules:
//   loopback OR (validateToken(harnessToken) AND trusted Origin)
//
// Runner upgrades have a fundamentally different auth model:
//   - they're NEVER loopback in production (the runner host is remote)
//   - the credential is a per-run JWT, NOT the dashboard token
//   - the audience is a SINGLE runId; one runner-host can't move a JWT
//     across runs without re-issuing
//   - the JWT is short-lived (per-run TTL + 60s grace) so even a leaked
//     token expires automatically
//
// Stuffing both policies into one `verifyWsConnection` function would
// either weaken the dashboard gate (allow non-loopback when a runJWT
// is present) or break the runner flow (require harness-token on top of
// runJWT). Instead, server.js's connection handler demuxes on path and
// hands the request to the right gate.
//
// Wire shape (URL params on the upgrade request):
//   ws://orchestrator/api/runner/events?runId=<id>&token=<runJWT>
//
// Why URL params and not headers? WebSocket clients in many runtimes
// can't set arbitrary upgrade headers (browsers in particular). MG1
// RFC §3.1 calls for the headers approach as a future hardening, but
// for R1-internal-preview the URL is sufficient — the JWT is bound to
// the runId via `aud` and `sub`, so URL-replay across runs fails the
// signature check.
//
// Returns:
//   { ok: true, runId, hostIdentity, runOrigin, sandboxClass, payload }
//   { ok: false, code: <ws-close-code>, reason }
//
// WS close codes:
//   1008 (Policy Violation) — bad request, bad token, expired, etc.
//   1011 (Internal Error)   — server can't honor the upgrade (no key,
//                             mode=off). The runner should retry later.

const jwt = require("../security/jwt");

/**
 * @param {object} opts
 * @param {Buffer|string} [opts.jwtKey]
 *   The HKDF-derived JWT key (info="runner-jwt"). When null/missing,
 *   every upgrade is rejected with 1011 — the runner should treat this
 *   as a transient orchestrator misconfig and back off.
 * @param {"off"|"preview"|"on"} [opts.mode="off"]
 *   Feature flag mirror. When "off", every upgrade is rejected with 1011.
 *   This matches the route-level gate in createRunnerRoutes — the WS
 *   path is NOT a backdoor for disabled HTTP routes.
 */
function createRunnerWsAuth({ jwtKey = null, mode = "off" } = {}) {
  const modeOk = mode === "preview" || mode === "on";
  const keyOk = Buffer.isBuffer(jwtKey) || (typeof jwtKey === "string" && jwtKey.length > 0);
  const enabled = modeOk && keyOk;

  function verifyRunnerWsConnection(req) {
    if (!enabled) {
      // Same shape as wsAuth.js so server.js's demux can use one close path.
      return { ok: false, code: 1011, reason: "runner WS not configured" };
    }

    let url;
    try {
      url = new URL(
        req.url || "/",
        `http://${(req.headers && req.headers.host) || "localhost"}`,
      );
    } catch (_) {
      return { ok: false, code: 1008, reason: "malformed upgrade URL" };
    }

    const runId = url.searchParams.get("runId") || "";
    const token = url.searchParams.get("token") || "";
    if (!runId || !token) {
      return { ok: false, code: 1008, reason: "runId + token required" };
    }

    const result = jwt.verify({ token, runId, key: jwtKey });
    if (!result.ok) {
      // Don't leak the specific reason in the WS close — clients see
      // "JWT rejected" generically. The orchestrator-side ledger entry
      // (added by R1-e-2 when wired) carries the precise reason for
      // forensic use.
      return { ok: false, code: 1008, reason: "JWT rejected", jwtReason: result.reason };
    }

    const harness = (result.payload && result.payload.harness) || {};
    return {
      ok: true,
      runId,
      hostIdentity: typeof harness.hostIdentity === "string" ? harness.hostIdentity : null,
      runOrigin: typeof harness.runOrigin === "string" ? harness.runOrigin : null,
      sandboxClass: typeof harness.sandboxClass === "string" ? harness.sandboxClass : null,
      payload: result.payload,
    };
  }

  return verifyRunnerWsConnection;
}

// Path-aware predicate: server.js's connection handler uses this to
// decide whether to apply the runner gate or the dashboard gate. Kept
// here so the URL contract lives next to its auth.
function isRunnerWsPath(reqUrl) {
  if (typeof reqUrl !== "string") return false;
  // Strip query string then exact-match the canonical path. We don't
  // accept `/api/runner/events/anything` to avoid an attacker smuggling
  // suffix paths.
  const idx = reqUrl.indexOf("?");
  const pathname = idx >= 0 ? reqUrl.slice(0, idx) : reqUrl;
  return pathname === "/api/runner/events";
}

module.exports = { createRunnerWsAuth, isRunnerWsPath };
