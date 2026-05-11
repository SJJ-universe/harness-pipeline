// Slice TRUST-STORE-0-b (Phase E Round 2, 2026-04-30) — trust store runtime.
//
// One trust store = the operator-managed list of Ed25519 public keys
// the launcher accepts as authorized release-manifest signers
// (per E3-F1 + GOV-RELEASE-0). The launcher and the server-side UI
// agree on the same file path via `trustStorePath.js`; this module
// owns the CRUD + atomic-write + schema + audit emission for that
// file.
//
// File layout (`<resolveTrustStorePath().path>`):
//
//   {
//     "schema": "orchestrator-release-trust/v1",
//     "keys": [
//       { keyId: "...", publicKeyDerBase64: "...", label: "Release 2026", addedAt: "..." }
//     ],
//     "requireCoverage": ["version", "publishedAt", ...]   // optional, pinned
//   }
//
// API (mirrors profileStore patterns where it makes sense):
//
//   list()                 → array of public-shape keys (sorted by addedAt)
//   get(keyId)             → single key or null
//   add({ publicKeyDerBase64, label }) → key with derived keyId
//                                        throws { code: "duplicate_key_id" }
//                                        throws { code: "invalid_public_key" }
//                                        throws { code: "private_key_rejected" }
//   update(keyId, { label }) → updated key (only label changes)
//                              throws { code: "key_not_found" }
//   remove(keyId)          → boolean (true if removed)
//   _state()               → for tests
//
// Defense in depth (operator-facing security policy):
//
//   The CRUD module rejects ANY input containing PEM "PRIVATE KEY" or
//   "OPENSSH" markers. The route layer also checks (TS-c), but having
//   the rule here ensures a careless test fixture or future direct
//   import can't slip a private key into the trust file. The audit
//   verb `trust_store_private_key_rejected` fires on detection so a
//   forensic auditor can grep for "did anyone try this?".
//
// Concurrency model:
//
//   Single-orchestrator-writer (same as profileStore.js). The orchestrator
//   process is the sole writer of trust-store.json. Atomic temp→
//   rename guards against crash-mid-write corruption.
//
// Audit verbs (frozen):
//
//   trust_store_key_added
//   trust_store_key_updated
//   trust_store_key_removed
//   trust_store_private_key_rejected   (defense-in-depth signal)
//
//   The route layer (TS-c) emits trust_store_delete_requested for
//   public-sector 2-step confirm — the storage layer never sees that
//   intermediate state.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = "orchestrator-release-trust/v1";

// Ed25519 SPKI DER is exactly 44 bytes: 12-byte ASN.1 header (SubjectPublicKeyInfo
// with OID 1.3.101.112) + 32-byte raw public key. Anything else means the input
// isn't an Ed25519 public key, even if it base64-decodes cleanly.
const ED25519_SPKI_LEN = 44;
const LABEL_MAX = 256;

// PEM markers that signal a private key. Reject loudly if we see any.
// We do NOT try to be clever about partial / case variants — operator
// pasted text shouldn't contain ANY of these markers if they're feeding
// us a public key.
const PRIVATE_KEY_MARKERS = Object.freeze([
  "PRIVATE KEY",
  "BEGIN OPENSSH PRIVATE KEY",
  "BEGIN RSA PRIVATE KEY",
  "BEGIN DSA PRIVATE KEY",
  "BEGIN EC PRIVATE KEY",
  "BEGIN PGP PRIVATE KEY",
  "OPENSSH PRIVATE",
]);

// Frozen so a future caller can't mutate. The route layer maps these
// 1:1 to HTTP status + JSON shape, so changing the vocabulary requires
// updating both.
const TRUST_STORE_ERROR_CODES = Object.freeze({
  invalid_input: "invalid_input",
  invalid_public_key: "invalid_public_key",
  private_key_rejected: "private_key_rejected",
  duplicate_key_id: "duplicate_key_id",
  key_not_found: "key_not_found",
  trust_file_invalid: "trust_file_invalid",
  store_unwritable: "store_unwritable",
});

// ── Helpers ──────────────────────────────────────────────────────────

function _err(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function _isString(v) {
  return typeof v === "string" && v.length > 0;
}

function _checkLabel(label) {
  if (label == null) return null;
  if (typeof label !== "string") {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_input, "label must be a string");
  }
  if (label.length > LABEL_MAX) {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_input, `label too long (max ${LABEL_MAX} chars)`);
  }
  return label;
}

// Detect PEM private-key markers anywhere in the supplied text. Even if
// the base64 fails to decode below, we want a SPECIFIC reason code so
// the operator sees "you pasted a private key" instead of a generic
// "invalid public key".
function _detectPrivateKeyMarkers(text) {
  if (typeof text !== "string") return null;
  const upper = text.toUpperCase();
  for (const marker of PRIVATE_KEY_MARKERS) {
    if (upper.includes(marker)) return marker;
  }
  return null;
}

// Validate a raw publicKeyDerBase64 input. Returns the decoded buffer
// on success; throws an Error with .code on failure.
function _validatePublicKey(b64) {
  if (!_isString(b64)) {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_public_key, "publicKeyDerBase64 must be a non-empty string");
  }
  // Defense-in-depth: catch private-key markers before the base64 path
  // so the audit verb can report `private_key_rejected` distinctly.
  const marker = _detectPrivateKeyMarkers(b64);
  if (marker) {
    throw _err(TRUST_STORE_ERROR_CODES.private_key_rejected,
      `input contains private-key marker "${marker}"`,
      { marker },
    );
  }
  // Trim whitespace + strip any wrapping like "-----BEGIN PUBLIC KEY-----"
  // PEM blocks. We canonicalize to raw base64 of the 44-byte DER.
  const trimmed = b64.trim();
  // PEM-wrapped public key: extract the base64 body. We accept this
  // shape because operators commonly paste the full PEM block. Detect
  // by header presence.
  let base64 = trimmed;
  if (/-----BEGIN PUBLIC KEY-----/i.test(trimmed)) {
    const m = trimmed.match(/-----BEGIN PUBLIC KEY-----([\s\S]*?)-----END PUBLIC KEY-----/);
    if (!m) {
      throw _err(TRUST_STORE_ERROR_CODES.invalid_public_key, "PEM PUBLIC KEY block malformed");
    }
    base64 = m[1].replace(/\s+/g, "");
  }
  let buf;
  try {
    buf = Buffer.from(base64, "base64");
  } catch (_) {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_public_key, "publicKeyDerBase64 not decodable as base64");
  }
  if (buf.length !== ED25519_SPKI_LEN) {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_public_key,
      `decoded public key is ${buf.length} bytes; Ed25519 SPKI requires ${ED25519_SPKI_LEN}`,
      { actualLength: buf.length },
    );
  }
  // Final sanity: the first 12 bytes are the Ed25519 ASN.1 header. We
  // could check the OID exactly, but for our purposes "44 bytes of base64"
  // + Node's createPublicKey acceptance below is enough.
  try {
    crypto.createPublicKey({ key: buf, format: "der", type: "spki" });
  } catch (err) {
    throw _err(TRUST_STORE_ERROR_CODES.invalid_public_key,
      `Node refused to parse the public key: ${err && err.message ? err.message : "unknown"}`,
    );
  }
  return buf;
}

function _keyIdFromDer(buf) {
  // Mirrors manifestSigner._keyIdFromPublicKey — the launcher derives
  // the same fingerprint when verifying a signature. Diverging here
  // would mean "operator added the key, signature carries fingerprint
  // X, store has fingerprint Y" → unknown_key_id failure.
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

// ── Persistence ──────────────────────────────────────────────────────

function _emptyState() {
  return Object.freeze({
    schema: SCHEMA_VERSION,
    keys: [],
  });
}

function _readStateSync(filePath) {
  if (!fs.existsSync(filePath)) return { schema: SCHEMA_VERSION, keys: [] };
  let text;
  try { text = fs.readFileSync(filePath, "utf-8"); }
  catch (err) {
    throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid,
      `cannot read ${filePath}: ${err.message}`,
    );
  }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.trim().length === 0) return { schema: SCHEMA_VERSION, keys: [] };
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) {
    // Parse failure is loud — never silently overwrite a corrupted
    // trust file. Operator must inspect manually.
    throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid,
      `failed to parse ${filePath}: ${err.message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid, "root is not an object");
  }
  if (parsed.schema !== SCHEMA_VERSION) {
    throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid,
      `schema "${parsed.schema}" does not match expected "${SCHEMA_VERSION}"`,
    );
  }
  if (!Array.isArray(parsed.keys)) {
    throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid, "keys must be an array");
  }
  // Validate per-key shape on read so a hand-edit can't sneak past.
  for (const k of parsed.keys) {
    if (!k || typeof k.keyId !== "string" || typeof k.publicKeyDerBase64 !== "string") {
      throw _err(TRUST_STORE_ERROR_CODES.trust_file_invalid, "keys[].shape malformed");
    }
  }
  return {
    schema: SCHEMA_VERSION,
    keys: parsed.keys.slice(),
  };
}

function _writeStateSync(filePath, state) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); }
  catch (err) {
    throw _err(TRUST_STORE_ERROR_CODES.store_unwritable,
      `cannot create dir ${dir}: ${err.message}`,
    );
  }
  // Atomic write: temp + rename. Same pattern as profileStore.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch (_) { /* Windows partial-noop */ }
    fs.renameSync(tmp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (_) { /* defensive */ }
  } catch (err) {
    throw _err(TRUST_STORE_ERROR_CODES.store_unwritable,
      `cannot write ${filePath}: ${err.message}`,
    );
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.filePath - absolute path to trust-store.json
 *                                 (typically resolveTrustStorePath().path)
 * @param {object} [opts.ledger] - EvidenceLedger-shaped { append(runId, entry) }
 * @param {function} [opts.now]  - clock injection (test default)
 */
function createTrustStore(opts = {}) {
  if (typeof opts.filePath !== "string" || opts.filePath.length === 0) {
    throw new Error("trustStore: filePath is required");
  }
  const filePath = opts.filePath;
  const ledger = opts.ledger || null;
  const now = opts.now || (() => new Date());

  function audit(verb, data) {
    if (!ledger) return;
    try { ledger.append("system", { type: verb, data }); }
    catch (_) { /* never break the store on ledger faults */ }
  }

  function _publicShape(k) {
    if (!k) return null;
    return {
      keyId: k.keyId,
      publicKeyDerBase64: k.publicKeyDerBase64,
      label: k.label || null,
      addedAt: k.addedAt || null,
    };
  }

  function list() {
    const state = _readStateSync(filePath);
    // Stable ordering by addedAt then keyId so UI / tests aren't flaky.
    const sorted = state.keys.slice().sort((a, b) => {
      const ta = a.addedAt || "", tb = b.addedAt || "";
      if (ta < tb) return -1;
      if (ta > tb) return 1;
      return a.keyId.localeCompare(b.keyId);
    });
    return sorted.map(_publicShape);
  }

  function get(keyId) {
    if (!_isString(keyId)) return null;
    const state = _readStateSync(filePath);
    const k = state.keys.find((x) => x.keyId === keyId);
    return k ? _publicShape(k) : null;
  }

  function add(input) {
    if (!input || typeof input !== "object") {
      throw _err(TRUST_STORE_ERROR_CODES.invalid_input, "input must be an object");
    }
    const label = _checkLabel(input.label);
    let derBuf;
    try {
      derBuf = _validatePublicKey(input.publicKeyDerBase64);
    } catch (err) {
      // Audit private-key rejection separately so security review
      // can grep "did anyone paste a private key here?".
      if (err.code === TRUST_STORE_ERROR_CODES.private_key_rejected) {
        audit("trust_store_private_key_rejected", { marker: err.marker || "unknown" });
      }
      throw err;
    }
    // Canonical base64 (no whitespace) — even if input was PEM-wrapped,
    // we store the canonical raw form so file diffs are consistent.
    const canonicalB64 = derBuf.toString("base64");
    const keyId = _keyIdFromDer(derBuf);

    const state = _readStateSync(filePath);
    if (state.keys.some((k) => k.keyId === keyId)) {
      throw _err(TRUST_STORE_ERROR_CODES.duplicate_key_id,
        `keyId ${keyId} already in trust store`, { keyId },
      );
    }
    const addedAt = now().toISOString();
    const entry = {
      keyId,
      publicKeyDerBase64: canonicalB64,
      // Don't write `label: null` (smaller JSON); only emit when set.
      ...(label ? { label } : {}),
      addedAt,
    };
    const next = { schema: SCHEMA_VERSION, keys: state.keys.concat([entry]) };
    _writeStateSync(filePath, next);
    audit("trust_store_key_added", { keyId, label: label || null, addedAt });
    return _publicShape(entry);
  }

  function update(keyId, patch) {
    if (!_isString(keyId)) {
      throw _err(TRUST_STORE_ERROR_CODES.invalid_input, "keyId required");
    }
    if (!patch || typeof patch !== "object") {
      throw _err(TRUST_STORE_ERROR_CODES.invalid_input, "patch must be an object");
    }
    // Only `label` is mutable. publicKeyDerBase64 + keyId + addedAt are
    // immutable on a key record — to "rotate" the operator removes +
    // re-adds (so the audit chain has explicit add/remove rows).
    const newLabel = "label" in patch ? _checkLabel(patch.label) : undefined;

    const state = _readStateSync(filePath);
    const idx = state.keys.findIndex((k) => k.keyId === keyId);
    if (idx < 0) {
      throw _err(TRUST_STORE_ERROR_CODES.key_not_found,
        `keyId ${keyId} not in trust store`, { keyId },
      );
    }
    const before = state.keys[idx];
    const next = Object.assign({}, before);
    if (newLabel === null) {
      delete next.label; // explicit clear
    } else if (typeof newLabel === "string") {
      next.label = newLabel;
    }
    state.keys[idx] = next;
    _writeStateSync(filePath, { schema: SCHEMA_VERSION, keys: state.keys });
    audit("trust_store_key_updated", {
      keyId,
      labelBefore: before.label || null,
      labelAfter: next.label || null,
    });
    return _publicShape(next);
  }

  function remove(keyId) {
    if (!_isString(keyId)) {
      throw _err(TRUST_STORE_ERROR_CODES.invalid_input, "keyId required");
    }
    const state = _readStateSync(filePath);
    const idx = state.keys.findIndex((k) => k.keyId === keyId);
    if (idx < 0) return false;
    const before = state.keys[idx];
    state.keys.splice(idx, 1);
    _writeStateSync(filePath, { schema: SCHEMA_VERSION, keys: state.keys });
    audit("trust_store_key_removed", {
      keyId,
      label: before.label || null,
      removedAt: now().toISOString(),
    });
    return true;
  }

  function _state() {
    return _readStateSync(filePath);
  }

  return Object.freeze({
    list,
    get,
    add,
    update,
    remove,
    _state,
  });
}

module.exports = {
  createTrustStore,
  SCHEMA_VERSION,
  TRUST_STORE_ERROR_CODES,
  ED25519_SPKI_LEN,
  LABEL_MAX,
  PRIVATE_KEY_MARKERS,
  // Exposed for unit tests + the route layer (which mirrors the
  // private-key check at the request body level).
  _detectPrivateKeyMarkers,
  _validatePublicKey,
  _keyIdFromDer,
};
