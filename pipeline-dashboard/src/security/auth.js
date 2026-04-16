const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function ensureToken(repoRoot) {
  if (process.env.HARNESS_TOKEN && process.env.HARNESS_TOKEN.trim()) {
    return process.env.HARNESS_TOKEN.trim();
  }

  const dir = path.join(repoRoot, ".harness");
  const tokenPath = path.join(dir, "local-token");
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, "utf-8").trim();
    if (token) return token;
  }

  fs.mkdirSync(dir, { recursive: true });
  const token = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(tokenPath, token + "\n", { encoding: "utf-8", mode: 0o600 });
  const gitignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, "*\n", "utf-8");
  return token;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf-8");
  const right = Buffer.from(String(b || ""), "utf-8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseHost(value) {
  if (!value) return "";
  const raw = String(value).trim();
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch (_) {
    return raw.split(":")[0].toLowerCase();
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  );
}

function isLoopbackAddress(address) {
  const value = String(address || "").toLowerCase();
  return (
    value === "::1" ||
    value === "127.0.0.1" ||
    value.startsWith("127.") ||
    value === "::ffff:127.0.0.1" ||
    value.startsWith("::ffff:127.")
  );
}

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self' ws: wss:; img-src 'self' data:; font-src 'self' https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
}

function createAuthMiddleware({ repoRoot, host = "127.0.0.1", allowRemote = false } = {}) {
  const token = ensureToken(repoRoot || process.cwd());
  const configuredHost = parseHost(host);

  function requireTrustedOrigin(req, res, next) {
    if (!allowRemote && !isLoopbackAddress(req.socket.remoteAddress)) {
      return res.status(403).json({ error: "remote clients are disabled" });
    }

    const hostHeader = parseHost(req.headers.host);
    if (!allowRemote && hostHeader && !isLoopbackHost(hostHeader) && hostHeader !== configuredHost) {
      return res.status(403).json({ error: "untrusted host header" });
    }

    const originHeader = req.headers.origin;
    if (originHeader) {
      const originHost = parseHost(originHeader);
      if (!isLoopbackHost(originHost) && originHost !== configuredHost) {
        return res.status(403).json({ error: "untrusted origin" });
      }
    }
    next();
  }

  function requireStateChangingToken(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const supplied = req.headers["x-harness-token"];
    if (!safeEqual(supplied, token)) {
      return res.status(401).json({ error: "missing or invalid harness token" });
    }
    next();
  }

  function validateToken(candidate) {
    return safeEqual(candidate, token);
  }

  return {
    token,
    requireTrustedOrigin,
    requireStateChangingToken,
    validateToken,
  };
}

module.exports = {
  ensureToken,
  createAuthMiddleware,
  securityHeaders,
  isLoopbackAddress,
  isLoopbackHost,
};
