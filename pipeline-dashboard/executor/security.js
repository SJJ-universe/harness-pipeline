// P0-1 — Server permission boundary.
//
// Three primitives:
//   1. isLoopbackAddress(ip) — 127.0.0.1 / ::1 / ::ffff:127.0.0.1
//   2. resolveBindHost(env)  — default 127.0.0.1, opt-in via HARNESS_HOST
//   3. createTokenMiddleware({ getToken }) — Express middleware that bypasses
//      loopback requests and enforces X-Harness-Token on non-loopback.
//   4. verifyWsOrigin({ req, getToken }) — matching rule for WS upgrades.
//
// Policy:
//   - When no token is configured, everything passes (backwards-compatible
//     local dev). Server startup prints a warning if a non-loopback bind is
//     combined with an unset token.
//   - When a token IS configured, non-loopback requests must present it via
//     `X-Harness-Token` header OR `?token=` query string (for WS upgrade).
//   - Loopback clients are always allowed (the bind host is the boundary).

const url = require("url");

function isLoopbackAddress(addr) {
  if (!addr || typeof addr !== "string") return false;
  if (addr === "127.0.0.1") return true;
  if (addr === "::1") return true;
  if (addr === "::ffff:127.0.0.1") return true;
  return false;
}

function resolveBindHost(env) {
  const e = env || {};
  const host = (e.HARNESS_HOST && String(e.HARNESS_HOST).trim()) || "127.0.0.1";
  const loopbackOnly = host === "127.0.0.1" || host === "::1" || host === "localhost";
  return { host, loopbackOnly };
}

function extractToken(req) {
  const headerToken =
    req.headers &&
    (req.headers["x-harness-token"] || req.headers["X-Harness-Token"]);
  if (headerToken) return String(headerToken);

  if (req.query && req.query.token) return String(req.query.token);

  if (req.url) {
    try {
      const parsed = url.parse(req.url, true);
      if (parsed.query && parsed.query.token) return String(parsed.query.token);
    } catch (_) {}
  }
  return "";
}

function remoteAddr(req) {
  return (req && req.socket && req.socket.remoteAddress) || "";
}

function createTokenMiddleware({ getToken }) {
  return function tokenMiddleware(req, res, next) {
    const expected = (typeof getToken === "function" && getToken()) || "";
    if (!expected) return next();

    if (isLoopbackAddress(remoteAddr(req))) return next();

    const provided = extractToken(req);
    if (provided && provided === expected) return next();

    return res.status(401).json({
      error: "unauthorized",
      hint:
        "Non-loopback request requires X-Harness-Token header or ?token= query param",
    });
  };
}

function verifyWsOrigin({ req, getToken }) {
  const expected = (typeof getToken === "function" && getToken()) || "";
  if (!expected) return true;
  if (isLoopbackAddress(remoteAddr(req))) return true;
  const provided = extractToken(req);
  return !!provided && provided === expected;
}

module.exports = {
  isLoopbackAddress,
  resolveBindHost,
  createTokenMiddleware,
  verifyWsOrigin,
};
