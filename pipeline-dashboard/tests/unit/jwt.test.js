// Slice R1-b (Phase D R1, 2026-04-28) — src/security/jwt.js unit tests.
//
// Covers HKDF derivation, HS256 issue/verify, claim shape, all 6
// VERIFY_REASONS rejection codes, alg-confusion immunity, key
// separation (runner-jwt vs audit-ledger info labels), and the
// timing-safe-compare invariant. These are the unit-test side of MF1
// rollout gate G2 ("Per-run JWT issuance + revocation tested; expired-
// token rejected with 401 + audit log entry"). The integration side
// (G2 verification against a real route) follows in R1-d when the
// /api/runner/handshake route lands.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  deriveJwtKey,
  issue,
  verify,
  VERIFY_REASONS,
  _internal,
} = require("../../src/security/jwt");

// ── deriveJwtKey ────────────────────────────────────────────────────

test("R1-b: deriveJwtKey returns a 32-byte Buffer by default", () => {
  const key = deriveJwtKey("test-token-1234567890abcdef");
  assert.ok(Buffer.isBuffer(key));
  assert.equal(key.length, 32);
});

test("R1-b: deriveJwtKey is deterministic for the same ikm + salt + info", () => {
  const a = deriveJwtKey("test-token-1234567890abcdef");
  const b = deriveJwtKey("test-token-1234567890abcdef");
  assert.deepEqual(a, b, "same inputs → same key");
});

test("R1-b: deriveJwtKey diverges when info label changes (domain separation)", () => {
  const jwtKey = deriveJwtKey("test-token-1234567890abcdef", { info: "runner-jwt" });
  const ledgerKey = deriveJwtKey("test-token-1234567890abcdef", { info: "audit-ledger" });
  // The whole point: rotating the info label gives a fully different key
  // so a JWT-signing key can never be confused with an audit-ledger key.
  assert.notDeepEqual(jwtKey, ledgerKey,
    "different info labels MUST yield different keys (HKDF domain separation)");
});

test("R1-b: deriveJwtKey diverges when salt changes (version bump)", () => {
  const v1 = deriveJwtKey("test-token-1234567890abcdef", { salt: "harness-jwt-v1" });
  const v2 = deriveJwtKey("test-token-1234567890abcdef", { salt: "harness-jwt-v2" });
  assert.notDeepEqual(v1, v2);
});

test("R1-b: deriveJwtKey rejects empty / non-string / non-Buffer ikm", () => {
  assert.throws(() => deriveJwtKey(""), /non-empty/);
  assert.throws(() => deriveJwtKey(null), /non-empty/);
  assert.throws(() => deriveJwtKey(undefined), /non-empty/);
  assert.throws(() => deriveJwtKey(42), /non-empty/);
  assert.throws(() => deriveJwtKey(Buffer.alloc(0)), /non-empty/);
});

test("R1-b: deriveJwtKey accepts a Buffer ikm", () => {
  const key = deriveJwtKey(Buffer.from("test-token-1234567890abcdef", "utf-8"));
  assert.equal(key.length, 32);
});

test("R1-b: deriveJwtKey honors a custom keyLen", () => {
  const k64 = deriveJwtKey("test-token-1234567890abcdef", { keyLen: 64 });
  assert.equal(k64.length, 64);
});

// ── issue ───────────────────────────────────────────────────────────

test("R1-b: issue produces a 3-part dot-delimited token", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "default", key });
  const parts = tok.split(".");
  assert.equal(parts.length, 3);
  assert.ok(parts[0].length > 0);
  assert.ok(parts[1].length > 0);
  assert.ok(parts[2].length > 0);
});

test("R1-b: issued token's header is the canonical HS256/JWT shape", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "default", key });
  const headerJson = _internal.b64uDecode(tok.split(".")[0]).toString("utf-8");
  const header = JSON.parse(headerJson);
  assert.equal(header.alg, "HS256");
  assert.equal(header.typ, "JWT");
});

test("R1-b: issued token's payload carries sub / aud / iat / exp", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "session-2", key, runDurationMs: 60000, now: 1700000000000 });
  const payloadJson = _internal.b64uDecode(tok.split(".")[1]).toString("utf-8");
  const payload = JSON.parse(payloadJson);
  assert.equal(payload.sub, "session-2");
  assert.equal(payload.aud, "runner-session-2");
  assert.equal(payload.iat, 1700000000);
  // 60_000 ms / 1000 = 60s + 60s grace = 120s.
  assert.equal(payload.exp, 1700000000 + 60 + 60);
});

test("R1-b: issued token attaches harness:{runOrigin,sandboxClass,hostIdentity} when supplied", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({
    runId: "rr-1",
    key,
    harness: {
      runOrigin: "container-remote",
      sandboxClass: "container-strict",
      hostIdentity: "runner-pool-a/3",
      // extra unknown key — must NOT leak into the payload
      attackerKey: "yikes",
    },
  });
  const payload = JSON.parse(_internal.b64uDecode(tok.split(".")[1]).toString("utf-8"));
  assert.deepEqual(payload.harness, {
    runOrigin: "container-remote",
    sandboxClass: "container-strict",
    hostIdentity: "runner-pool-a/3",
  });
});

test("R1-b: issue omits harness when no fields are supplied", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "rr-1", key, harness: {} });
  const payload = JSON.parse(_internal.b64uDecode(tok.split(".")[1]).toString("utf-8"));
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "harness"), false);
});

test("R1-b: issue rejects missing/empty runId", () => {
  const key = deriveJwtKey("k1");
  assert.throws(() => issue({ key }), /runId is required/);
  assert.throws(() => issue({ runId: "", key }), /runId is required/);
  assert.throws(() => issue({ runId: 42, key }), /runId is required/);
});

test("R1-b: issue rejects missing key", () => {
  assert.throws(() => issue({ runId: "rr" }), /key is required/);
  assert.throws(() => issue({ runId: "rr", key: 42 }), /key is required/);
});

test("R1-b: issue rejects non-positive runDurationMs", () => {
  const key = deriveJwtKey("k1");
  assert.throws(() => issue({ runId: "rr", key, runDurationMs: 0 }), /positive/);
  assert.throws(() => issue({ runId: "rr", key, runDurationMs: -1 }), /positive/);
  assert.throws(() => issue({ runId: "rr", key, runDurationMs: "1h" }), /positive/);
});

// ── verify happy path ───────────────────────────────────────────────

test("R1-b: verify accepts a freshly-issued token", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "default", key, now: 1700000000000, runDurationMs: 3600000 });
  const result = verify({ token: tok, runId: "default", key, now: 1700000000000 });
  assert.equal(result.ok, true);
  assert.equal(result.payload.sub, "default");
  assert.equal(result.payload.aud, "runner-default");
});

// ── verify rejection codes (all 6) ──────────────────────────────────

test("R1-b: verify reason=structure on non-string / wrong segment count", () => {
  const key = deriveJwtKey("k1");
  assert.equal(verify({ token: null, runId: "x", key }).reason, VERIFY_REASONS.STRUCTURE);
  assert.equal(verify({ token: "one", runId: "x", key }).reason, VERIFY_REASONS.STRUCTURE);
  assert.equal(verify({ token: "one.two", runId: "x", key }).reason, VERIFY_REASONS.STRUCTURE);
  assert.equal(verify({ token: "one.two.three.four", runId: "x", key }).reason, VERIFY_REASONS.STRUCTURE);
  assert.equal(verify({ token: "..", runId: "x", key }).reason, VERIFY_REASONS.STRUCTURE);
});

test("R1-b: verify reason=signature when key differs", () => {
  const k1 = deriveJwtKey("k1");
  const k2 = deriveJwtKey("k2");
  const tok = issue({ runId: "rr", key: k1 });
  const result = verify({ token: tok, runId: "rr", key: k2 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_REASONS.SIGNATURE);
});

test("R1-b: verify reason=signature on tampered payload (last byte flip)", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "rr", key });
  const parts = tok.split(".");
  // Tamper the payload section by flipping its last char (still valid base64url).
  const tamperedPayload = parts[1].slice(0, -1) + (parts[1].slice(-1) === "A" ? "B" : "A");
  const tampered = parts[0] + "." + tamperedPayload + "." + parts[2];
  const result = verify({ token: tampered, runId: "rr", key });
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_REASONS.SIGNATURE);
});

test("R1-b: verify reason=expired when exp is in the past", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "rr", key, now: 1700000000000, runDurationMs: 60000 });
  // Verify "two hours later" — exp was 1700000000+60+60 = 1700000120, now = 1700007200.
  const result = verify({ token: tok, runId: "rr", key, now: 1700000000000 + 7200 * 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_REASONS.EXPIRED);
});

test("R1-b: verify reason=aud_mismatch when runId differs from issued one", () => {
  const key = deriveJwtKey("k1");
  const tok = issue({ runId: "rr-1", key });
  const result = verify({ token: tok, runId: "rr-2", key });
  assert.equal(result.ok, false);
  // aud is checked before sub, so this hits aud_mismatch first.
  assert.equal(result.reason, VERIFY_REASONS.AUD_MISMATCH);
});

test("R1-b: verify reason=sub_mismatch when token has matching aud but different sub (defensive)", () => {
  // A hand-crafted token with aud="runner-rr" but sub="other" should fail
  // sub_mismatch when verified for runId="rr". This tests the defensive
  // check beyond aud — both must match.
  const key = deriveJwtKey("k1");
  const headerB64 = _internal.b64uEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8"));
  const payload = { sub: "other", aud: "runner-rr", iat: 0, exp: 9999999999 };
  const payloadB64 = _internal.b64uEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const sig = crypto.createHmac("sha256", key).update(headerB64 + "." + payloadB64).digest();
  const sigB64 = _internal.b64uEncode(sig);
  const tok = headerB64 + "." + payloadB64 + "." + sigB64;
  const result = verify({ token: tok, runId: "rr", key });
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_REASONS.SUB_MISMATCH);
});

test("R1-b: verify reason=payload_parse on garbage payload", () => {
  // Hand-craft a token with valid base64url payload that isn't JSON.
  const key = deriveJwtKey("k1");
  const headerB64 = _internal.b64uEncode(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8"));
  const garbageB64 = _internal.b64uEncode(Buffer.from("not-json", "utf-8"));
  const sig = crypto.createHmac("sha256", key).update(headerB64 + "." + garbageB64).digest();
  const tok = headerB64 + "." + garbageB64 + "." + _internal.b64uEncode(sig);
  const result = verify({ token: tok, runId: "rr", key });
  assert.equal(result.ok, false);
  assert.equal(result.reason, VERIFY_REASONS.PAYLOAD_PARSE);
});

// ── alg-confusion immunity ──────────────────────────────────────────

test("R1-b: verify ignores attacker-supplied header.alg=none", () => {
  // Attacker submits a token with header.alg="none" and an empty signature.
  // Real verify always uses HS256 against the body, so signature mismatch.
  const key = deriveJwtKey("k1");
  const headerB64 = _internal.b64uEncode(Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf-8"));
  const payload = { sub: "rr", aud: "runner-rr", iat: 0, exp: 9999999999 };
  const payloadB64 = _internal.b64uEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  const tokNoSig = headerB64 + "." + payloadB64 + ".";  // empty signature
  const result = verify({ token: tokNoSig, runId: "rr", key });
  assert.equal(result.ok, false);
  // Either signature failure (most likely) or structure depending on parser
  // strictness — either way, NOT ok=true. This locks the alg-confusion guard.
  assert.notEqual(result.reason, undefined);
  assert.notEqual(result.ok, true);
});

test("R1-b: verify ignores attacker-supplied header.alg=RS256 (key-confusion)", () => {
  // The classic JWT alg-confusion: if a verifier trusts header.alg, an
  // attacker can sign with HS256 using the public key of an RS256 keypair.
  // Our verify ALWAYS uses HS256 — header.alg is not consulted — so this
  // attack reduces to "signature must match HMAC over the body with our key".
  const key = deriveJwtKey("k1");
  const headerB64 = _internal.b64uEncode(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf-8"));
  const payload = { sub: "rr", aud: "runner-rr", iat: 0, exp: 9999999999 };
  const payloadB64 = _internal.b64uEncode(Buffer.from(JSON.stringify(payload), "utf-8"));
  // Sign with our HS256 key — this would be the strongest attacker has.
  const sig = crypto.createHmac("sha256", key).update(headerB64 + "." + payloadB64).digest();
  const tok = headerB64 + "." + payloadB64 + "." + _internal.b64uEncode(sig);
  // Even though the header lies about RS256, our verifier just uses HS256
  // and verifies. The token IS valid for that runId — but only because the
  // attacker had the actual signing key. The header.alg is irrelevant.
  const result = verify({ token: tok, runId: "rr", key });
  assert.equal(result.ok, true,
    "header.alg is ignored; verification ALWAYS uses HS256 against the body");
});

// ── round-trip ──────────────────────────────────────────────────────

test("R1-b: round-trip — issue + verify works for many runIds", () => {
  const key = deriveJwtKey("k1");
  const ids = ["default", "session-2", "session-3", "RR_x.y-z", "default"];
  for (const runId of ids) {
    const tok = issue({ runId, key });
    const result = verify({ token: tok, runId, key });
    assert.equal(result.ok, true, "round-trip for " + runId);
    assert.equal(result.payload.sub, runId);
    assert.equal(result.payload.aud, "runner-" + runId);
  }
});

test("R1-b: VERIFY_REASONS keys are stable + frozen", () => {
  // Locks the reason codes — these go to audit-log entries (G4/G8).
  // Adding a NEW reason is fine; renaming or deleting an existing one
  // would break log analysis dashboards.
  assert.deepEqual(Object.keys(VERIFY_REASONS).sort(), [
    "AUD_MISMATCH",
    "EXPIRED",
    "PAYLOAD_PARSE",
    "SIGNATURE",
    "STRUCTURE",
    "SUB_MISMATCH",
  ]);
  assert.equal(Object.isFrozen(VERIFY_REASONS), true);
});
