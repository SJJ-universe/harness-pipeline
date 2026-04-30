// Slice GOV-RELEASE-0 (Phase E1.5, 2026-04-30) — manifest signer unit tests.
// Pins Ed25519 keypair gen / sign / verify / trust-store gates / negative
// branches + frozen vocabulary.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const signer = require("../../src/security/manifestSigner");

// ── Vocabulary ────────────────────────────────────────────────────

test("GOV-RELEASE-0: SIGNER_ERROR_CODES is frozen", () => {
  assert.ok(Object.isFrozen(signer.SIGNER_ERROR_CODES));
  assert.equal(signer.SIGNER_ERROR_CODES.signature_mismatch, "signature_mismatch");
  assert.equal(signer.SIGNER_ERROR_CODES.unknown_key_id, "unknown_key_id");
  assert.equal(signer.SIGNER_ERROR_CODES.no_trusted_keys, "no_trusted_keys");
});

test("GOV-RELEASE-0: COVERAGE_FIELDS is frozen + stable order", () => {
  assert.ok(Object.isFrozen(signer.COVERAGE_FIELDS));
  assert.deepEqual(signer.COVERAGE_FIELDS, [
    "version", "publishedAt", "url", "sha256", "minNodeVersion", "publicSectorOnly",
  ]);
});

// ── _stableStringify / _projectForSigning / _keyIdFromPublicKey ──

test("GOV-RELEASE-0: _stableStringify sorts keys recursively", () => {
  const a = signer._stableStringify({ b: 1, a: { y: 1, x: 2 } });
  const b = signer._stableStringify({ a: { x: 2, y: 1 }, b: 1 });
  assert.equal(a, b);
});

test("GOV-RELEASE-0: _projectForSigning includes only coverage fields", () => {
  const m = { version: "1.0", url: "u", sha256: "h", extraNonsense: "ignored" };
  const projection = signer._projectForSigning(m);
  assert.equal(projection.version, "1.0");
  assert.equal(projection.url, "u");
  assert.equal(projection.sha256, "h");
  // null when not present
  assert.equal(projection.minNodeVersion, null);
  // extra fields excluded
  assert.equal(projection.extraNonsense, undefined);
});

test("GOV-RELEASE-0: _keyIdFromPublicKey returns 16-hex deterministic id", () => {
  const buf = Buffer.from("sample-public-key-bytes");
  const id = signer._keyIdFromPublicKey(buf);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(signer._keyIdFromPublicKey(buf), id, "deterministic");
});

// ── generateKeyPair ───────────────────────────────────────────────

test("GOV-RELEASE-0: generateKeyPair returns Ed25519 keypair with valid keyId", () => {
  const kp = signer.generateKeyPair();
  assert.equal(kp.alg, "Ed25519");
  assert.equal(kp.schema, signer.SCHEMA_KEY_PAIR);
  assert.match(kp.keyId, /^[0-9a-f]{16}$/);
  assert.match(kp.publicKeyDerBase64, /^[A-Za-z0-9+/=]+$/);
  assert.match(kp.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.match(kp.privateKeyPem, /END PRIVATE KEY/);
});

// ── signManifest + verifyManifestSignature round-trip ───────────

function _trustStoreFromKeyPair(kp, label = "default") {
  return {
    schema: signer.SCHEMA_TRUST,
    keys: [{
      keyId: kp.keyId,
      label,
      publicKeyDerBase64: kp.publicKeyDerBase64,
      addedAt: kp.createdAt,
    }],
  };
}

test("GOV-RELEASE-0: signManifest + verifyManifestSignature round-trip succeeds", () => {
  const kp = signer.generateKeyPair();
  const manifest = {
    version: "1.0.0",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example/h.zip",
    sha256: "abc123",
    minNodeVersion: "24.0.0",
  };
  const sig = signer.signManifest({
    manifest, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId,
  });
  const signed = { ...manifest, signature: sig };
  const result = signer.verifyManifestSignature({
    manifest: signed,
    trustStore: _trustStoreFromKeyPair(kp),
  });
  assert.equal(result.ok, true);
  assert.equal(result.keyId, kp.keyId);
  assert.equal(result.keyLabel, "default");
});

test("GOV-RELEASE-0: signature is deterministic across encoding-equivalent manifests", () => {
  const kp = signer.generateKeyPair();
  const m1 = {
    sha256: "abc",
    version: "1.0",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://x",
    minNodeVersion: "24.0.0",
  };
  // Same logical manifest, different key insertion order
  const m2 = {
    minNodeVersion: "24.0.0",
    url: "https://x",
    publishedAt: "2026-04-30T00:00:00Z",
    version: "1.0",
    sha256: "abc",
  };
  const fixedAt = "2026-04-30T05:00:00.000Z";
  const sig1 = signer.signManifest({ manifest: m1, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId, signedAt: fixedAt });
  const sig2 = signer.signManifest({ manifest: m2, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId, signedAt: fixedAt });
  // Ed25519 is deterministic given identical input + key, so two
  // encoding-equivalent manifests produce the same signature.
  assert.equal(sig1.value, sig2.value);
});

test("GOV-RELEASE-0: verify detects tampered url field (signature_mismatch)", () => {
  const kp = signer.generateKeyPair();
  const manifest = { version: "1.0", url: "https://good", sha256: "h", publishedAt: "T", minNodeVersion: "24.0.0" };
  const sig = signer.signManifest({ manifest, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId });
  const tampered = { ...manifest, url: "https://evil", signature: sig };
  const result = signer.verifyManifestSignature({
    manifest: tampered,
    trustStore: _trustStoreFromKeyPair(kp),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "signature_mismatch");
});

test("GOV-RELEASE-0: verify detects unknown keyId", () => {
  const kp1 = signer.generateKeyPair();
  const kp2 = signer.generateKeyPair();
  const manifest = { version: "1.0", url: "https://x", sha256: "h", publishedAt: "T", minNodeVersion: "24.0.0" };
  const sig = signer.signManifest({ manifest, privateKeyPem: kp1.privateKeyPem, keyId: kp1.keyId });
  const signed = { ...manifest, signature: sig };
  // Trust store only contains kp2; sig was made by kp1
  const result = signer.verifyManifestSignature({
    manifest: signed,
    trustStore: _trustStoreFromKeyPair(kp2),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_key_id");
});

test("GOV-RELEASE-0: verify rejects manifest without signature field", () => {
  const kp = signer.generateKeyPair();
  const result = signer.verifyManifestSignature({
    manifest: { version: "1.0", url: "https://x" },
    trustStore: _trustStoreFromKeyPair(kp),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_signature");
});

test("GOV-RELEASE-0: verify rejects unknown alg", () => {
  const kp = signer.generateKeyPair();
  const result = signer.verifyManifestSignature({
    manifest: { version: "1.0", url: "https://x", signature: { alg: "RSA-SHA256", keyId: "x", value: "y" } },
    trustStore: _trustStoreFromKeyPair(kp),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_alg");
});

test("GOV-RELEASE-0: verify rejects empty trust store", () => {
  const kp = signer.generateKeyPair();
  const manifest = { version: "1.0", url: "https://x", sha256: "h", publishedAt: "T", minNodeVersion: "24.0.0" };
  const sig = signer.signManifest({ manifest, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId });
  const result = signer.verifyManifestSignature({
    manifest: { ...manifest, signature: sig },
    trustStore: { schema: signer.SCHEMA_TRUST, keys: [] },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_trusted_keys");
});

test("GOV-RELEASE-0: verify rejects garbage manifest", () => {
  const kp = signer.generateKeyPair();
  const trust = _trustStoreFromKeyPair(kp);
  assert.equal(signer.verifyManifestSignature({ manifest: null, trustStore: trust }).ok, false);
  assert.equal(signer.verifyManifestSignature({ manifest: 42, trustStore: trust }).ok, false);
});

test("GOV-RELEASE-0: verify enforces requireCoverage (coverage_mismatch)", () => {
  const kp = signer.generateKeyPair();
  const manifest = { version: "1.0", url: "https://x", sha256: "h", publishedAt: "T", minNodeVersion: "24.0.0" };
  // Sign with reduced coverage missing publicSectorOnly
  const customCoverage = ["version", "publishedAt", "url", "sha256", "minNodeVersion"];
  const sig = signer.signManifest({
    manifest, privateKeyPem: kp.privateKeyPem, keyId: kp.keyId,
    coverage: customCoverage,
  });
  const trustStore = _trustStoreFromKeyPair(kp);
  trustStore.requireCoverage = ["version", "url", "publicSectorOnly"];
  const result = signer.verifyManifestSignature({
    manifest: { ...manifest, signature: sig },
    trustStore,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "coverage_mismatch");
  assert.equal(result.missing, "publicSectorOnly");
});

// ── loadTrustStore ────────────────────────────────────────────────

test("GOV-RELEASE-0: loadTrustStore validates schema + key shape", () => {
  // Invalid garbage
  assert.equal(signer.loadTrustStore(null).ok, false);
  assert.equal(signer.loadTrustStore({}).ok, false);
  assert.equal(signer.loadTrustStore({ schema: "wrong", keys: [] }).ok, false);
  assert.equal(signer.loadTrustStore({ schema: signer.SCHEMA_TRUST, keys: "not-array" }).ok, false);
  assert.equal(signer.loadTrustStore({ schema: signer.SCHEMA_TRUST, keys: [{ keyId: 1 }] }).ok, false);
  // Valid
  const ok = signer.loadTrustStore({ schema: signer.SCHEMA_TRUST, keys: [{ keyId: "abc", publicKeyDerBase64: "==" }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.trustStore.keys.length, 1);
});

// ── signManifest input validation ────────────────────────────────

test("GOV-RELEASE-0: signManifest throws on invalid input", () => {
  const kp = signer.generateKeyPair();
  assert.throws(() => signer.signManifest({}), /manifest must be an object/);
  assert.throws(() => signer.signManifest({ manifest: {} }), /privateKeyPem/);
  assert.throws(() => signer.signManifest({ manifest: {}, privateKeyPem: kp.privateKeyPem }), /keyId/);
});
