// Slice R1-b (Phase D R1, 2026-04-28) — HS256 JWT for remote-runner auth.
//
// Implements the JWT issuer/verifier specified in MG1 RFC §4:
//
//   Algorithm:  HS256 (HMAC-SHA256, symmetric)
//   Issuer:     orchestrator (self-signed; single-tenant)
//   Key:        HKDF derivative of HARNESS_TOKEN, info="runner-jwt"
//   Lifetime:   per-run; no refresh
//   Claims:     sub=runId, aud=runner-${runId}, iat, exp, harness:{...}
//
// Why hand-rolled instead of pulling in `jsonwebtoken`:
//   - Zero new runtime deps (matches every other src/security/*.js).
//   - Surface area we use is tiny (one alg, one key derivation, fixed
//     header). Pulling jsonwebtoken's ~30 KB for two functions is
//     overkill.
//   - HKDF + HMAC + timing-safe compare are all in node:crypto already.
//
// What this module does NOT do (deliberately):
//   - Refresh tokens. R1 issues per-run; runs are bounded.
//   - Asymmetric (RS256 / ES256). Single-tenant, no third-party verifier.
//   - JWE / encryption. Claims are not secret — they're audit metadata.
//   - Issuer claim (`iss`). Single orchestrator, no need yet.
//   - Audience array. Single string only (canonical "runner-${runId}").
//   - Algorithm negotiation. HS256 is hard-coded; alg-confusion attacks
//     can't pick a different alg from the header (we ignore header.alg
//     on verify).

const crypto = require("crypto");

// ── HKDF key derivation (RFC 5869) ──────────────────────────────────

/**
 * Derive a 32-byte JWT signing key from HARNESS_TOKEN via HKDF-SHA256.
 *
 * @param {string|Buffer} ikm   - The harness token (input keying material).
 * @param {object}        [opts]
 * @param {string}        [opts.salt="harness-jwt-v1"] - Versioned salt; bump
 *                          for breaking key-derivation changes.
 * @param {string}        [opts.info="runner-jwt"] - Domain-separation label.
 *                          Audit ledger uses a different `info` so the keys
 *                          can never overlap.
 * @param {number}        [opts.keyLen=32] - Output length in bytes.
 * @returns {Buffer} - The derived key.
 */
function deriveJwtKey(ikm, opts = {}) {
  const salt = opts.salt || "harness-jwt-v1";
  const info = opts.info || "runner-jwt";
  const keyLen = opts.keyLen || 32;
  if (!ikm || (typeof ikm !== "string" && !Buffer.isBuffer(ikm))) {
    throw new TypeError("deriveJwtKey: ikm must be a non-empty string or Buffer");
  }
  const ikmBuf = Buffer.isBuffer(ikm) ? ikm : Buffer.from(ikm, "utf-8");
  if (ikmBuf.length === 0) {
    throw new TypeError("deriveJwtKey: ikm must be non-empty");
  }
  // crypto.hkdfSync returns an ArrayBuffer; wrap it.
  const derived = crypto.hkdfSync(
    "sha256",
    ikmBuf,
    Buffer.from(salt, "utf-8"),
    Buffer.from(info, "utf-8"),
    keyLen,
  );
  return Buffer.from(derived);
}

// ── base64url helpers ───────────────────────────────────────────────

function b64uEncode(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(String(buf), "utf-8");
  return buf.toString("base64url");
}

function b64uDecode(str) {
  return Buffer.from(String(str), "base64url");
}

// ── canonical header (HS256 only — alg confusion guarded by ignoring
// the header.alg on verify) ─────────────────────────────────────────

const CANONICAL_HEADER_JSON = JSON.stringify({ alg: "HS256", typ: "JWT" });
const CANONICAL_HEADER_B64U = b64uEncode(Buffer.from(CANONICAL_HEADER_JSON, "utf-8"));

// ── HMAC sign / verify ──────────────────────────────────────────────

function _hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

function _timingSafeEqual(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── issue ────────────────────────────────────────────────────────────

/**
 * Issue a per-run JWT.
 *
 * @param {object} opts
 * @param {string} opts.runId        - The run this token is bound to.
 * @param {Buffer|string} opts.key   - The signing key (from deriveJwtKey).
 * @param {number} [opts.runDurationMs=3600000] - Run-declared timeout.
 *                          The token's `exp` is `iat + runDurationMs/1000 + 60`
 *                          (60s grace for last-minute hooks).
 * @param {object} [opts.harness]    - Per-run origin metadata mirrored
 *                          from the monitor envelope (MF1 §3.1):
 *                          { runOrigin, sandboxClass, hostIdentity }.
 * @param {number} [opts.now=Date.now()] - Override clock (tests).
 * @returns {string} - Compact-serialized JWT (`header.payload.sig`).
 */
function issue({ runId, key, runDurationMs = 3600000, harness, now } = {}) {
  if (typeof runId !== "string" || runId.length === 0) {
    throw new TypeError("issue: runId is required (non-empty string)");
  }
  if (!key || (!Buffer.isBuffer(key) && typeof key !== "string")) {
    throw new TypeError("issue: key is required (Buffer or string)");
  }
  if (typeof runDurationMs !== "number" || runDurationMs <= 0) {
    throw new TypeError("issue: runDurationMs must be a positive number");
  }
  const nowMs = typeof now === "number" ? now : Date.now();
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + Math.ceil(runDurationMs / 1000) + 60;  // +60s grace

  const payload = {
    sub: runId,
    aud: "runner-" + runId,
    iat,
    exp,
  };
  if (harness && typeof harness === "object") {
    // Mirror MF1 §3.1 envelope `origin` keys when present.
    const h = {};
    if (typeof harness.runOrigin === "string") h.runOrigin = harness.runOrigin;
    if (typeof harness.sandboxClass === "string") h.sandboxClass = harness.sandboxClass;
    if (typeof harness.hostIdentity === "string") h.hostIdentity = harness.hostIdentity;
    if (Object.keys(h).length > 0) payload.harness = h;
  }

  const payloadB64u = b64uEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const signingInput = CANONICAL_HEADER_B64U + "." + payloadB64u;
  const sig = _hmac(key, signingInput);
  return signingInput + "." + b64uEncode(sig);
}

// ── verify ──────────────────────────────────────────────────────────

const VERIFY_REASONS = Object.freeze({
  STRUCTURE: "structure",
  SIGNATURE: "signature",
  EXPIRED: "expired",
  AUD_MISMATCH: "aud_mismatch",
  SUB_MISMATCH: "sub_mismatch",
  PAYLOAD_PARSE: "payload_parse",
});

/**
 * Verify a JWT against the given runId.
 *
 * Returns:
 *   { ok: true, payload }                 — verified, payload exposed
 *   { ok: false, reason }                 — failure with a stable reason code
 *
 * Reasons (stable, intended for audit-log entries):
 *   "structure"      — not a 3-part dot-delimited token
 *   "payload_parse"  — payload wasn't valid JSON
 *   "signature"      — HMAC mismatch (failed timing-safe compare)
 *   "expired"        — exp < now
 *   "aud_mismatch"   — aud !== "runner-${runId}"
 *   "sub_mismatch"   — sub !== runId
 *
 * Header `alg` is INTENTIONALLY IGNORED — we always verify with HS256
 * regardless of what the header claims, blocking alg-confusion attacks
 * (e.g. token presenting `alg:none` or `alg:RS256`).
 */
function verify({ token, runId, key, now } = {}) {
  if (typeof token !== "string" || typeof runId !== "string" || !key) {
    return { ok: false, reason: VERIFY_REASONS.STRUCTURE };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: VERIFY_REASONS.STRUCTURE };
  }
  const [headerB64u, payloadB64u, sigB64u] = parts;
  if (!headerB64u || !payloadB64u || !sigB64u) {
    return { ok: false, reason: VERIFY_REASONS.STRUCTURE };
  }

  // Recompute the signature with the canonical algorithm. The header.alg
  // is deliberately not consulted — we always HS256.
  const signingInput = headerB64u + "." + payloadB64u;
  const expectedSig = _hmac(key, signingInput);
  let providedSig;
  try { providedSig = b64uDecode(sigB64u); }
  catch (_) { return { ok: false, reason: VERIFY_REASONS.SIGNATURE }; }
  if (!_timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, reason: VERIFY_REASONS.SIGNATURE };
  }

  let payload;
  try { payload = JSON.parse(b64uDecode(payloadB64u).toString("utf-8")); }
  catch (_) { return { ok: false, reason: VERIFY_REASONS.PAYLOAD_PARSE }; }
  if (!payload || typeof payload !== "object") {
    return { ok: false, reason: VERIFY_REASONS.PAYLOAD_PARSE };
  }

  const nowSec = Math.floor((typeof now === "number" ? now : Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec) {
    return { ok: false, reason: VERIFY_REASONS.EXPIRED };
  }
  if (payload.aud !== "runner-" + runId) {
    return { ok: false, reason: VERIFY_REASONS.AUD_MISMATCH };
  }
  if (payload.sub !== runId) {
    return { ok: false, reason: VERIFY_REASONS.SUB_MISMATCH };
  }

  return { ok: true, payload };
}

module.exports = {
  deriveJwtKey,
  issue,
  verify,
  VERIFY_REASONS,
  // Test hooks — exposed under _internal so production code can't grab them.
  _internal: {
    b64uEncode,
    b64uDecode,
    CANONICAL_HEADER_JSON,
    CANONICAL_HEADER_B64U,
  },
};
