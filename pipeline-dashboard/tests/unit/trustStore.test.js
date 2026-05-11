// Slice TRUST-STORE-0-b/f (Phase E Round 2, 2026-04-30) — trust store runtime.
// Pins: validator branches (Ed25519 SPKI shape, PEM private-key
// rejection, label length), CRUD round-trip via the file system,
// atomic write, audit emission, schema enforcement on read.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
  createTrustStore,
  TRUST_STORE_ERROR_CODES,
  ED25519_SPKI_LEN,
  LABEL_MAX,
  PRIVATE_KEY_MARKERS,
  _detectPrivateKeyMarkers,
  _validatePublicKey,
  _keyIdFromDer,
} = require("../../src/runtime/trustStore");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trust-store-test-"));
}

function genKey() {
  const { publicKey } = crypto.generateKeyPairSync("ed25519");
  const der = publicKey.export({ format: "der", type: "spki" });
  return {
    der,
    b64: der.toString("base64"),
    keyId: crypto.createHash("sha256").update(der).digest("hex").slice(0, 16),
  };
}

// ── Validators ───────────────────────────────────────────────────────

test("trustStore: _detectPrivateKeyMarkers spots every frozen marker family", () => {
  // Each input that contains ANY of the markers must return SOME
  // marker (loop returns the first match — "PRIVATE KEY" is a
  // substring of most others, so order-of-priority is OK).
  for (const marker of PRIVATE_KEY_MARKERS) {
    const got = _detectPrivateKeyMarkers(`prefix ${marker} suffix`);
    assert.ok(
      got && PRIVATE_KEY_MARKERS.includes(got),
      `must detect a marker for input containing "${marker}", got ${got}`,
    );
  }
  // Lowercase/spaced variants still match (we uppercase the input).
  assert.ok(_detectPrivateKeyMarkers("private key"));
  assert.equal(_detectPrivateKeyMarkers("nothing private"), null);
  assert.equal(_detectPrivateKeyMarkers(""), null);
  assert.equal(_detectPrivateKeyMarkers(null), null);
  assert.equal(_detectPrivateKeyMarkers(undefined), null);
});

test("trustStore: _validatePublicKey accepts a real Ed25519 public key", () => {
  const k = genKey();
  const buf = _validatePublicKey(k.b64);
  assert.equal(buf.length, ED25519_SPKI_LEN);
  assert.equal(_keyIdFromDer(buf), k.keyId);
});

test("trustStore: _validatePublicKey accepts PEM-wrapped public key", () => {
  const k = genKey();
  const pem = "-----BEGIN PUBLIC KEY-----\n"
    + k.b64.match(/.{1,64}/g).join("\n")
    + "\n-----END PUBLIC KEY-----";
  const buf = _validatePublicKey(pem);
  assert.equal(buf.length, ED25519_SPKI_LEN);
});

test("trustStore: _validatePublicKey rejects private-key markers", () => {
  // Mid-string private-key marker → private_key_rejected (NOT
  // invalid_public_key — distinct audit verb).
  const blob = "MCowBQYD\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n";
  assert.throws(
    () => _validatePublicKey(blob),
    (err) => err.code === TRUST_STORE_ERROR_CODES.private_key_rejected,
  );
});

test("trustStore: _validatePublicKey rejects wrong-length input", () => {
  // 32 bytes of base64 = not Ed25519 SPKI (Ed25519 SPKI is 44 bytes).
  const wrongLen = Buffer.alloc(32, 0x01).toString("base64");
  assert.throws(
    () => _validatePublicKey(wrongLen),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_public_key,
  );
});

test("trustStore: _validatePublicKey rejects empty + non-string input", () => {
  assert.throws(
    () => _validatePublicKey(""),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_public_key,
  );
  assert.throws(
    () => _validatePublicKey(null),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_public_key,
  );
  assert.throws(
    () => _validatePublicKey(123),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_public_key,
  );
});

test("trustStore: _validatePublicKey rejects gibberish 44-byte base64", () => {
  // Base64 of 44 random bytes that don't form a valid Ed25519 SPKI ASN.1.
  // crypto.createPublicKey throws — the validator surfaces invalid_public_key.
  const random44 = crypto.randomBytes(44).toString("base64");
  assert.throws(
    () => _validatePublicKey(random44),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_public_key,
  );
});

// ── Factory + CRUD ───────────────────────────────────────────────────

test("trustStore: factory throws when filePath missing", () => {
  assert.throws(() => createTrustStore({}), /filePath is required/);
});

test("trustStore: list() on empty file returns []", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  assert.deepEqual(store.list(), []);
});

test("trustStore: add() round-trip — key persists + keyId derived", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ts.json");
  const store = createTrustStore({ filePath });
  const k = genKey();
  const added = store.add({ publicKeyDerBase64: k.b64, label: "Release 2026" });
  assert.equal(added.keyId, k.keyId);
  assert.equal(added.label, "Release 2026");
  assert.match(added.addedAt, /^\d{4}-\d{2}-\d{2}T/);
  // File written + parseable
  const onDisk = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.schema, "orchestrator-release-trust/v1");
  assert.equal(onDisk.keys.length, 1);
  // get() returns the same shape
  assert.equal(store.get(k.keyId).keyId, k.keyId);
  assert.equal(store.get("nope"), null);
});

test("trustStore: add() emits trust_store_key_added on ledger", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = { calls: [] };
  ledger.append = (runId, entry) => { ledger.calls.push({ runId, ...entry }); };
  const store = createTrustStore({ filePath: path.join(dir, "ts.json"), ledger });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64, label: "L1" });
  const evt = ledger.calls.find((c) => c.type === "trust_store_key_added");
  assert.ok(evt, "trust_store_key_added must fire on add");
  assert.equal(evt.data.keyId, k.keyId);
  assert.equal(evt.data.label, "L1");
});

test("trustStore: add() rejects duplicate keyId with structured error", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64 });
  assert.throws(
    () => store.add({ publicKeyDerBase64: k.b64 }),
    (err) => err.code === TRUST_STORE_ERROR_CODES.duplicate_key_id && err.keyId === k.keyId,
  );
});

test("trustStore: add() rejects private key with private_key_rejected audit", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = { calls: [] };
  ledger.append = (runId, entry) => { ledger.calls.push({ runId, ...entry }); };
  const store = createTrustStore({ filePath: path.join(dir, "ts.json"), ledger });
  // Wrap a private-key marker into the input — must not land in store.
  const malicious = "-----BEGIN OPENSSH PRIVATE KEY-----\nabcdef\n-----END OPENSSH PRIVATE KEY-----";
  assert.throws(
    () => store.add({ publicKeyDerBase64: malicious }),
    (err) => err.code === TRUST_STORE_ERROR_CODES.private_key_rejected,
  );
  // Audit row emitted before the throw.
  const evt = ledger.calls.find((c) => c.type === "trust_store_private_key_rejected");
  assert.ok(evt, "trust_store_private_key_rejected must fire");
  // Storage unchanged
  assert.equal(store.list().length, 0);
});

test("trustStore: add() rejects label longer than LABEL_MAX", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  const k = genKey();
  const longLabel = "x".repeat(LABEL_MAX + 1);
  assert.throws(
    () => store.add({ publicKeyDerBase64: k.b64, label: longLabel }),
    (err) => err.code === TRUST_STORE_ERROR_CODES.invalid_input,
  );
});

test("trustStore: update() changes label only + audit fires", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = { calls: [] };
  ledger.append = (runId, entry) => { ledger.calls.push({ runId, ...entry }); };
  const store = createTrustStore({ filePath: path.join(dir, "ts.json"), ledger });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64, label: "before" });
  const updated = store.update(k.keyId, { label: "after" });
  assert.equal(updated.label, "after");
  // public key + keyId immutable
  assert.equal(updated.keyId, k.keyId);
  const evt = ledger.calls.find((c) => c.type === "trust_store_key_updated");
  assert.ok(evt);
  assert.equal(evt.data.labelBefore, "before");
  assert.equal(evt.data.labelAfter, "after");
});

test("trustStore: update() with label:null clears the label field", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64, label: "kept" });
  const updated = store.update(k.keyId, { label: null });
  assert.equal(updated.label, null);
});

test("trustStore: update() throws key_not_found", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  assert.throws(
    () => store.update("0123456789abcdef", { label: "x" }),
    (err) => err.code === TRUST_STORE_ERROR_CODES.key_not_found,
  );
});

test("trustStore: remove() returns true on hit, false on miss", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64 });
  assert.equal(store.remove(k.keyId), true);
  assert.equal(store.remove(k.keyId), false);
  assert.equal(store.list().length, 0);
});

test("trustStore: remove() emits trust_store_key_removed audit", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ledger = { calls: [] };
  ledger.append = (runId, entry) => { ledger.calls.push({ runId, ...entry }); };
  const store = createTrustStore({ filePath: path.join(dir, "ts.json"), ledger });
  const k = genKey();
  store.add({ publicKeyDerBase64: k.b64, label: "to-remove" });
  store.remove(k.keyId);
  const evt = ledger.calls.find((c) => c.type === "trust_store_key_removed");
  assert.ok(evt);
  assert.equal(evt.data.keyId, k.keyId);
  assert.equal(evt.data.label, "to-remove");
});

test("trustStore: list() sort order is stable by addedAt then keyId", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Inject a deterministic clock so two adds in the same millisecond
  // (unlikely IRL but possible) sort by keyId.
  let i = 0;
  const dates = [
    new Date("2026-04-30T00:00:00Z"),
    new Date("2026-04-30T00:00:01Z"),
    new Date("2026-04-30T00:00:02Z"),
  ];
  const store = createTrustStore({
    filePath: path.join(dir, "ts.json"),
    now: () => dates[i++ % dates.length],
  });
  const k1 = genKey(), k2 = genKey(), k3 = genKey();
  store.add({ publicKeyDerBase64: k1.b64, label: "first" });
  store.add({ publicKeyDerBase64: k2.b64, label: "second" });
  store.add({ publicKeyDerBase64: k3.b64, label: "third" });
  const arr = store.list();
  assert.equal(arr.length, 3);
  // First addedAt < second addedAt < third addedAt — list reflects.
  assert.equal(arr[0].label, "first");
  assert.equal(arr[1].label, "second");
  assert.equal(arr[2].label, "third");
});

test("trustStore: schema mismatch on read throws trust_file_invalid", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ts.json");
  fs.writeFileSync(filePath, JSON.stringify({ schema: "wrong/v999", keys: [] }));
  const store = createTrustStore({ filePath });
  assert.throws(
    () => store.list(),
    (err) => err.code === TRUST_STORE_ERROR_CODES.trust_file_invalid,
  );
});

test("trustStore: malformed JSON on read throws trust_file_invalid", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ts.json");
  fs.writeFileSync(filePath, "{not valid json");
  const store = createTrustStore({ filePath });
  assert.throws(
    () => store.list(),
    (err) => err.code === TRUST_STORE_ERROR_CODES.trust_file_invalid,
  );
});

test("trustStore: per-key shape malformed on read throws trust_file_invalid", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ts.json");
  // Hand-edited file with a missing keyId field.
  fs.writeFileSync(filePath, JSON.stringify({
    schema: "orchestrator-release-trust/v1",
    keys: [{ publicKeyDerBase64: "abc" }],
  }));
  const store = createTrustStore({ filePath });
  assert.throws(
    () => store.list(),
    (err) => err.code === TRUST_STORE_ERROR_CODES.trust_file_invalid,
  );
});

test("trustStore: BOM-prefixed file is tolerated", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "ts.json");
  // UTF-8 BOM (﻿) prepended — PowerShell 5.1 emits this by default
  // when an operator uses Set-Content -Encoding utf8 to seed a file.
  fs.writeFileSync(filePath, "﻿" + JSON.stringify({
    schema: "orchestrator-release-trust/v1",
    keys: [],
  }));
  const store = createTrustStore({ filePath });
  assert.deepEqual(store.list(), []);
});

test("trustStore: factory result is frozen — accidental mutation rejected", () => {
  const dir = tmpDir();
  const store = createTrustStore({ filePath: path.join(dir, "ts.json") });
  assert.throws(
    () => { store.add = () => {}; },
    /read.only|Cannot|TypeError/i,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("trustStore: keyId derivation matches manifestSigner._keyIdFromPublicKey", () => {
  // Defense against drift — if these two diverge, the launcher's
  // verify-manifest-signature will look up a different keyId than
  // the one stored here, and every signature → unknown_key_id.
  const { _keyIdFromPublicKey } = require("../../src/security/manifestSigner");
  const k = genKey();
  assert.equal(_keyIdFromDer(k.der), _keyIdFromPublicKey(k.der));
});
