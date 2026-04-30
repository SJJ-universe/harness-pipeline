// Slice GOV-RELEASE-0 (Phase E1.5, 2026-04-30) — manifest signing.
//
// Public-sector / air-gapped distributors need to verify that a
// release zip + its manifest came from the trusted publisher and
// hasn't been tampered with. Trust-on-first-use SHA256 (D0) is OK
// for internal team distribution but inadequate for public release —
// an attacker who replaces the manifest URL on a compromised mirror
// can substitute a malicious zip + matching SHA256 with no detection.
//
// Solution: Ed25519 detached signature over a canonical-encoded
// projection of the manifest. Detached because the launcher reads
// the manifest BEFORE knowing the signature exists; embedded signing
// would require parse-then-strip-sig-then-verify, more error-prone.
//
// Why Ed25519:
//   - Node.js crypto built-in (no extra dependency, no native build)
//   - 32-byte private key, 32-byte public key, 64-byte signature
//   - Constant-time verification (no padding attacks)
//   - No "key parameter" choices to get wrong (vs RSA/ECDSA)
//   - Wide tooling support (ssh-keygen -t ed25519, age, cosign)
//
// Manifest schema (extends D0's launcher-manifest):
//   {
//     "version": "1.1.0",
//     "publishedAt": "2026-04-30T00:00:00Z",
//     "url": "https://.../harness-pipeline-1.1.0.zip",
//     "sha256": "<hex>",
//     "minNodeVersion": "24.0.0",
//     "publicSectorOnly": false,
//     "signature": {                      // ← GOV-RELEASE-0 addition
//       "alg": "Ed25519",
//       "keyId": "<short-fingerprint>",
//       "value": "<base64>",
//       "coverage": ["version","publishedAt","url","sha256","minNodeVersion"],
//       "signedAt": "2026-04-30T00:00:00Z"
//     }
//   }
//
// What this does NOT do:
//   - No key rotation flow. Trust file is operator-managed.
//   - No revocation. Compromised key → publish a new manifest with
//     a new keyId; trust file updated → next install picks new key.
//   - No public-key infrastructure (PKI / X.509 / cosign keyless).
//     Public keys are distributed out-of-band (operator hands the
//     trust file to the recipient via a separate channel).
//   - No secret-rotation policy. Operator owns the private key.
//   - No HSM integration. Software-only signing (private key is on
//     disk, decrypted with passphrase or wrapped with OS keystore).

"use strict";

const crypto = require("crypto");

const SCHEMA_KEY_PAIR = "harness-release-keypair/v1";
const SCHEMA_TRUST = "harness-release-trust/v1";
const ALG = "Ed25519";

const COVERAGE_FIELDS = Object.freeze([
  "version",
  "publishedAt",
  "url",
  "sha256",
  "minNodeVersion",
  "publicSectorOnly",
]);

// Frozen so a future caller can't mutate.
const SIGNER_ERROR_CODES = Object.freeze({
  invalid_input: "invalid_input",
  unknown_alg: "unknown_alg",
  missing_signature: "missing_signature",
  unknown_key_id: "unknown_key_id",
  signature_mismatch: "signature_mismatch",
  trust_file_invalid: "trust_file_invalid",
  no_trusted_keys: "no_trusted_keys",
  coverage_mismatch: "coverage_mismatch",
});

// Canonical sorted-key JSON encoding so an operator on Linux/Windows/
// Mac all hash the same bytes. Reuses the auditorBundle convention.
function _stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(_stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + _stableStringify(value[k])).join(",") + "}";
}

// Project the manifest down to coverage fields. Any field not in
// COVERAGE_FIELDS is excluded — the signature only covers what's
// declared. Future fields added without bumping coverage can land
// without breaking existing signatures.
function _projectForSigning(manifest, coverage = COVERAGE_FIELDS) {
  const out = {};
  for (const k of coverage) {
    // Always include the field name even when undefined so the
    // canonical encoding is deterministic across publishers (some
    // might omit publicSectorOnly entirely, others might set false).
    out[k] = (manifest && Object.prototype.hasOwnProperty.call(manifest, k))
      ? manifest[k] : null;
  }
  return out;
}

function _keyIdFromPublicKey(pubKeyDer) {
  // Short fingerprint = first 16 hex chars of sha256(DER public key).
  // 64 bits is plenty for "which key signed this?" lookup; security
  // doesn't depend on the keyId — it's just an index into the trust
  // store. The actual signature verification is constant-time over
  // the full public key bytes.
  return crypto.createHash("sha256").update(pubKeyDer).digest("hex").slice(0, 16);
}

// Generate an Ed25519 keypair. Returns DER-encoded public key (raw
// 32 bytes prefixed with the Ed25519 ASN.1 OID) and an unencrypted
// PKCS8 private key. Operators must protect the private key file
// themselves (filesystem permissions, OS keystore, etc.).
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ format: "der", type: "spki" });
  const privPem = privateKey.export({ format: "pem", type: "pkcs8" });
  return Object.freeze({
    schema: SCHEMA_KEY_PAIR,
    alg: ALG,
    keyId: _keyIdFromPublicKey(pubDer),
    publicKeyDerBase64: pubDer.toString("base64"),
    privateKeyPem: privPem,           // string (PEM, unencrypted)
    createdAt: new Date().toISOString(),
  });
}

function _privateKeyFromPem(pem) {
  if (typeof pem !== "string" || !pem.includes("PRIVATE KEY")) {
    throw new Error("manifestSigner: privateKeyPem must be PEM-encoded PKCS8");
  }
  return crypto.createPrivateKey({ key: pem, format: "pem" });
}

function _publicKeyFromDerBase64(b64) {
  const buf = Buffer.from(b64, "base64");
  return crypto.createPublicKey({
    key: buf,
    format: "der",
    type: "spki",
  });
}

function signManifest({ manifest, privateKeyPem, keyId, coverage = COVERAGE_FIELDS, signedAt }) {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("manifestSigner: manifest must be an object");
  }
  if (typeof privateKeyPem !== "string") {
    throw new Error("manifestSigner: privateKeyPem required");
  }
  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new Error("manifestSigner: keyId required");
  }
  const projection = _projectForSigning(manifest, coverage);
  const canonical = _stableStringify(projection);
  const key = _privateKeyFromPem(privateKeyPem);
  // Ed25519 signature in Node.js crypto API: pass null algorithm
  // since the algo is fixed by the key type.
  const sigBuf = crypto.sign(null, Buffer.from(canonical, "utf-8"), key);
  return Object.freeze({
    alg: ALG,
    keyId,
    value: sigBuf.toString("base64"),
    coverage: coverage.slice(),
    signedAt: signedAt || new Date().toISOString(),
  });
}

function verifyManifestSignature({ manifest, trustStore }) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, reason: SIGNER_ERROR_CODES.invalid_input };
  }
  const sig = manifest.signature;
  if (!sig || typeof sig !== "object") {
    return { ok: false, reason: SIGNER_ERROR_CODES.missing_signature };
  }
  if (sig.alg !== ALG) {
    return { ok: false, reason: SIGNER_ERROR_CODES.unknown_alg, alg: sig.alg };
  }
  if (typeof sig.keyId !== "string" || sig.keyId.length === 0) {
    return { ok: false, reason: SIGNER_ERROR_CODES.invalid_input, detail: "keyId" };
  }
  if (typeof sig.value !== "string" || sig.value.length === 0) {
    return { ok: false, reason: SIGNER_ERROR_CODES.invalid_input, detail: "value" };
  }
  if (!trustStore || !Array.isArray(trustStore.keys) || trustStore.keys.length === 0) {
    return { ok: false, reason: SIGNER_ERROR_CODES.no_trusted_keys };
  }
  // Trust-store coverage MUST match what the signer used. Otherwise
  // the projection differs and verification trivially fails.
  const sigCoverage = Array.isArray(sig.coverage) && sig.coverage.length > 0
    ? sig.coverage : COVERAGE_FIELDS.slice();
  if (Array.isArray(trustStore.requireCoverage) && trustStore.requireCoverage.length > 0) {
    // A strict trust store can pin coverage. If pinned, verify the
    // signature only when sigCoverage ⊇ requireCoverage.
    for (const f of trustStore.requireCoverage) {
      if (!sigCoverage.includes(f)) {
        return { ok: false, reason: SIGNER_ERROR_CODES.coverage_mismatch, missing: f };
      }
    }
  }
  const matchedKey = trustStore.keys.find((k) => k && k.keyId === sig.keyId);
  if (!matchedKey) {
    return { ok: false, reason: SIGNER_ERROR_CODES.unknown_key_id, keyId: sig.keyId };
  }
  // Verify
  try {
    const projection = _projectForSigning(manifest, sigCoverage);
    const canonical = _stableStringify(projection);
    const pubKey = _publicKeyFromDerBase64(matchedKey.publicKeyDerBase64);
    const sigBuf = Buffer.from(sig.value, "base64");
    const ok = crypto.verify(null, Buffer.from(canonical, "utf-8"), pubKey, sigBuf);
    if (!ok) return { ok: false, reason: SIGNER_ERROR_CODES.signature_mismatch };
    return {
      ok: true,
      keyId: sig.keyId,
      keyLabel: matchedKey.label || null,
      coverage: sigCoverage.slice(),
    };
  } catch (err) {
    return { ok: false, reason: SIGNER_ERROR_CODES.invalid_input, detail: err.message };
  }
}

function loadTrustStore(parsedJson) {
  if (!parsedJson || typeof parsedJson !== "object") {
    return { ok: false, reason: SIGNER_ERROR_CODES.trust_file_invalid };
  }
  if (parsedJson.schema !== SCHEMA_TRUST) {
    return { ok: false, reason: SIGNER_ERROR_CODES.trust_file_invalid, detail: "schema" };
  }
  if (!Array.isArray(parsedJson.keys)) {
    return { ok: false, reason: SIGNER_ERROR_CODES.trust_file_invalid, detail: "keys" };
  }
  // Validate each key shape
  for (const k of parsedJson.keys) {
    if (!k || typeof k.keyId !== "string" || typeof k.publicKeyDerBase64 !== "string") {
      return { ok: false, reason: SIGNER_ERROR_CODES.trust_file_invalid, detail: "keys[].shape" };
    }
  }
  return { ok: true, trustStore: parsedJson };
}

module.exports = {
  signManifest,
  verifyManifestSignature,
  generateKeyPair,
  loadTrustStore,
  SCHEMA_KEY_PAIR,
  SCHEMA_TRUST,
  ALG,
  COVERAGE_FIELDS,
  SIGNER_ERROR_CODES,
  _stableStringify,
  _projectForSigning,
  _keyIdFromPublicKey,
};
