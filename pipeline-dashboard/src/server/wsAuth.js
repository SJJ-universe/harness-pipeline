// Slice MA0 (Phase D, 2026-04-27) — extract WS upgrade auth gate factory.
// Original policy: Slice S1 (Phase 3-S) — WS upgrade auth gate. This
// module is a behaviour-preserving lift of the inline helper that lived
// in server.js, so the auth contract stays identical across the move.
// Lives next to the rest of src/server/* and can be unit-tested without
// spinning up the whole HTTP server.
//
// History
//   - Slice S1 (Phase 3-S) introduced verifyWsConnection inline in
//     server.js so the pipeline event WebSocket would follow the same
//     loopback/token/origin policy as the terminal WS subpath.
//   - This module just lifts that function into a factory; the runtime
//     contract is identical.
//
// Policy (one consistent rule for terminal AND pipeline event WS):
//   - loopback remote address → always pass (frictionless local dev)
//   - non-loopback + ALLOW_REMOTE off → close 1008 ("non-loopback ws disabled")
//   - non-loopback + ALLOW_REMOTE on → require valid ?token= AND (when
//     present) a trusted Origin header (loopback host or configured host)
//
// Factory injection lets server.js own ALLOW_REMOTE / HOST / auth /
// isLoopback* without this module reaching into globals.

function createWsAuth({ allowRemote, host, auth, isLoopbackAddress, isLoopbackHost }) {
  if (!auth || typeof auth.validateToken !== "function") {
    throw new Error("createWsAuth requires an `auth` with validateToken()");
  }
  if (typeof isLoopbackAddress !== "function" || typeof isLoopbackHost !== "function") {
    throw new Error("createWsAuth requires isLoopbackAddress + isLoopbackHost helpers");
  }

  function verifyWsConnection(req) {
    const remote = req && req.socket ? req.socket.remoteAddress : null;
    if (isLoopbackAddress(remote)) {
      return { ok: true };
    }
    if (!allowRemote) {
      return { ok: false, code: 1008, reason: "non-loopback ws disabled" };
    }
    let suppliedToken = "";
    try {
      const wsUrl = new URL(
        req.url || "/",
        `http://${(req.headers && req.headers.host) || "localhost"}`
      );
      suppliedToken = wsUrl.searchParams.get("token") || "";
    } catch (_) { /* malformed URL → no token */ }
    if (!auth.validateToken(suppliedToken)) {
      return { ok: false, code: 1008, reason: "missing or invalid harness token" };
    }
    const originHeader = req.headers && req.headers.origin;
    if (originHeader) {
      let originHost = "";
      try { originHost = new URL(originHeader).hostname.toLowerCase(); } catch (_) { /* malformed */ }
      const configuredHost = String(host || "").toLowerCase();
      if (!isLoopbackHost(originHost) && originHost && originHost !== configuredHost) {
        return { ok: false, code: 1008, reason: "untrusted ws origin" };
      }
    }
    return { ok: true };
  }

  return verifyWsConnection;
}

module.exports = { createWsAuth };
