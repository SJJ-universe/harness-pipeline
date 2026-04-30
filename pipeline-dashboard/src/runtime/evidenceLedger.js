// EvidenceLedger — append-only JSONL event log with hash chain for tamper evidence.
//
// Each entry: { eventId, runId, type, at, dataHash, previousHash, data }
// Hash chain: eventHash = sha256(previousHash + type + dataHash)
//
// Slice R1-c (Phase D R1, 2026-04-28) — HMAC signature extension.
//
// MG1 RFC §5 lifts the ledger from "tamper-evident within a chain" to
// "tamper-evident with cryptographic forgery resistance":
//
//   - Entry shape extends with `sig` (HMAC-SHA256 hex) + `sigVer: 1`.
//   - sig signs canonical concat of: eventId|runId|type|at|dataHash|previousHash
//   - The signing key is a separate HKDF derivative (info="audit-ledger")
//     from the JWT key (info="runner-jwt"). Same `HARNESS_TOKEN`, two
//     keyspaces, no overlap.
//
// Backwards compat:
//   - The constructor's `signingKey` parameter is OPTIONAL. When null
//     (today's default + every caller that didn't migrate), append()
//     omits the `sig`/`sigVer` fields entirely. Existing entries in
//     existing JSONL files keep working — they just don't have
//     signature-verifiability beyond the hash chain.
//   - `verifyChain()` is a NEW method (per MG1 §5.4 spec). The old
//     `verify()` stays put with its original return shape so existing
//     callers / tests don't break.
//
// R2 backlog (MG3 §5.5.1):
//   - `kid` field on signed entries to support key rotation with
//     retained verify keys. R1 ships single-live-key; R2 fills the kid
//     retroactively (zero-schema-change migration).

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Canonical concat used for signing. Stable order is critical — changing
// it would invalidate every previously-signed entry.
function _canonicalConcat(entry) {
  return entry.eventId + "|"
       + entry.runId + "|"
       + entry.type + "|"
       + entry.at + "|"
       + entry.dataHash + "|"
       + entry.previousHash;
}

function _hmacHex(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

function _timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Stable rejection codes — intended for audit-log entries.
const VERIFY_CHAIN_REASONS = Object.freeze({
  PREVIOUS_HASH_MISMATCH: "previousHash_mismatch",
  DATA_HASH_MISMATCH:     "dataHash_mismatch",
  EVENT_HASH_MISMATCH:    "eventHash_mismatch",
  SIGNATURE_MISMATCH:     "signature_mismatch",
  SIG_PRESENT_NO_KEY:     "sig_present_but_no_key",
  UNKNOWN_SIG_VER:        "unknown_sigVer",
});

class EvidenceLedger {
  constructor({ rootDir, ttlMs = 7 * 24 * 3600 * 1000, signingKey = null, sanitizer = null }) {
    this.rootDir = rootDir;
    this.ttlMs = ttlMs;
    // Slice D1-f (Phase E1, 2026-04-29): optional sanitizer applied
    // to entry.data before computing the dataHash. When wired (server.js
    // passes `sanitizer: sanitizeAuditData` from src/security/auditSanitizer.js),
    // any audit field whose KEY name looks like a secret (TOKEN/SECRET/
    // KEY/PASSWORD/CREDENTIAL) gets replaced with a structured redaction
    // marker BEFORE the entry lands on disk. The hash chain (and the
    // optional R1-c HMAC signature) cover the sanitized form — so the
    // audit chain is consistent with what's persisted, not with what
    // the caller passed.
    //
    // Backwards compat: when sanitizer=null (today's default + every
    // existing test), append() behaves exactly as before. server.js
    // wires the production sanitizer; tests opt out for clarity.
    if (sanitizer !== null && typeof sanitizer !== "function") {
      throw new TypeError("EvidenceLedger: sanitizer must be a function or null");
    }
    this.sanitizer = sanitizer;
    // R1-c: optional HMAC signing key. Buffer or string; null → no signing.
    if (signingKey != null && !Buffer.isBuffer(signingKey) && typeof signingKey !== "string") {
      throw new TypeError("EvidenceLedger: signingKey must be Buffer, string, or null");
    }
    this.signingKey = signingKey == null
      ? null
      : (Buffer.isBuffer(signingKey) ? signingKey : Buffer.from(signingKey, "utf-8"));
    // In-memory chain heads per runId for fast append
    this._chainHeads = new Map();
  }

  _runDir(runId) {
    return path.join(this.rootDir, runId);
  }

  _ledgerPath(runId) {
    return path.join(this._runDir(runId), "ledger.jsonl");
  }

  append(runId, { type, data }) {
    const dir = this._runDir(runId);
    fs.mkdirSync(dir, { recursive: true });

    // Slice D1-f: sanitize BEFORE hashing so the dataHash and
    // eventHash reflect what actually lands on disk. If the
    // sanitizer is null (default), the data is passed through
    // unchanged — exact same behavior as pre-D1-f.
    const sanitizedData = this.sanitizer ? this.sanitizer(data) : data;

    const at = new Date().toISOString();
    const dataHash = sha256(JSON.stringify(sanitizedData));
    const previousHash = this._chainHeads.get(runId) || "0";
    const eventHash = sha256(previousHash + type + dataHash);
    const eventId = `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const entry = { eventId, runId, type, at, dataHash, previousHash, eventHash, data: sanitizedData };

    // R1-c: HMAC signature when a signing key is configured. The hash chain
    // already detects in-place tampering; the signature blocks an attacker
    // who can rewrite the ENTIRE file (chain + all entries) but doesn't
    // hold the key. sig signs the canonical pre-eventHash inputs so a
    // future kid/multi-key model (R2) can re-verify against historical
    // entries.
    if (this.signingKey) {
      entry.sig = _hmacHex(this.signingKey, _canonicalConcat(entry));
      entry.sigVer = 1;
    }

    fs.appendFileSync(this._ledgerPath(runId), JSON.stringify(entry) + "\n", "utf-8");
    this._chainHeads.set(runId, eventHash);

    return entry;
  }

  read(runId) {
    const p = this._ledgerPath(runId);
    if (!fs.existsSync(p)) return [];
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n").filter(Boolean);
    return lines.map((l) => {
      try { return JSON.parse(l); } catch (_) { return null; }
    }).filter(Boolean);
  }

  // Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30): enumerate every runId
  // that has a ledger.jsonl file under rootDir. Used by the auditor-
  // bundle byWindow mode to span the audit chain across all runs in
  // a date range.
  //
  // Defensive: rootDir may not exist (fresh install). Subdirs without
  // a ledger.jsonl (e.g. an artifact-only directory) are skipped so
  // the result is exactly "runs the ledger has anything for".
  listRuns() {
    if (!fs.existsSync(this.rootDir)) return [];
    const out = [];
    let entries;
    try { entries = fs.readdirSync(this.rootDir); }
    catch (_) { return []; }
    for (const name of entries) {
      try {
        const p = path.join(this.rootDir, name, "ledger.jsonl");
        if (fs.existsSync(p)) out.push(name);
      } catch (_) { /* defensive: skip unreadable subdir */ }
    }
    return out.sort();
  }

  verify(runId) {
    const entries = this.read(runId);
    if (entries.length === 0) return { valid: true, entries: 0, errors: [] };

    const errors = [];
    let expectedPrev = "0";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.previousHash !== expectedPrev) {
        errors.push({ index: i, eventId: e.eventId, error: `previousHash mismatch: expected ${expectedPrev}, got ${e.previousHash}` });
      }
      const expectedEventHash = sha256(e.previousHash + e.type + e.dataHash);
      if (e.eventHash !== expectedEventHash) {
        errors.push({ index: i, eventId: e.eventId, error: `eventHash mismatch` });
      }
      expectedPrev = e.eventHash;
    }

    return { valid: errors.length === 0, entries: entries.length, errors };
  }

  // R1-c: full chain + signature verification per MG1 RFC §5.4.
  //
  // Walks every entry in order and asserts:
  //   (1) previousHash matches actual previous entry's eventHash
  //   (2) dataHash matches sha256(JSON.stringify(data))
  //   (3) eventHash matches sha256(previousHash + type + dataHash)
  //   (4) sig (when present) matches HMAC over canonical concat
  //
  // Returns:
  //   { valid: true, entries: N }
  //   { valid: false, brokenAt: <eventId>, reason: <code>, index: N }
  //
  // Reasons (stable, frozen — see VERIFY_CHAIN_REASONS export):
  //   "previousHash_mismatch" — chain link broken
  //   "dataHash_mismatch"     — data field was edited after signing
  //   "eventHash_mismatch"    — eventHash recomputed from declared inputs differs
  //   "signature_mismatch"    — HMAC verification failed
  //   "sig_present_but_no_key" — entry has sig field but ledger has no key
  //   "unknown_sigVer"        — sigVer is not 1 (forward-compat guard)
  //
  // When the ledger's signingKey is null AND no entries carry sig, the
  // result is structurally indistinguishable from `verify()` running
  // green — pre-R1 ledgers still pass cleanly.
  verifyChain(runId) {
    const entries = this.read(runId);
    if (entries.length === 0) return { valid: true, entries: 0 };

    let expectedPrev = "0";
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];

      // (1) chain link
      if (e.previousHash !== expectedPrev) {
        return {
          valid: false,
          brokenAt: e.eventId,
          reason: VERIFY_CHAIN_REASONS.PREVIOUS_HASH_MISMATCH,
          index: i,
        };
      }

      // (2) dataHash matches the actual data field
      const expectedDataHash = sha256(JSON.stringify(e.data));
      if (e.dataHash !== expectedDataHash) {
        return {
          valid: false,
          brokenAt: e.eventId,
          reason: VERIFY_CHAIN_REASONS.DATA_HASH_MISMATCH,
          index: i,
        };
      }

      // (3) eventHash matches the declared inputs
      const expectedEventHash = sha256(e.previousHash + e.type + e.dataHash);
      if (e.eventHash !== expectedEventHash) {
        return {
          valid: false,
          brokenAt: e.eventId,
          reason: VERIFY_CHAIN_REASONS.EVENT_HASH_MISMATCH,
          index: i,
        };
      }

      // (4) signature (when present)
      if (e.sig != null) {
        if (e.sigVer !== 1) {
          // Forward-compat guard: future sigVer values must be handled
          // explicitly; we don't silently accept "looks valid".
          return {
            valid: false,
            brokenAt: e.eventId,
            reason: VERIFY_CHAIN_REASONS.UNKNOWN_SIG_VER,
            index: i,
          };
        }
        if (!this.signingKey) {
          // Caller didn't provide a key but the ledger has signed entries.
          // Refuse rather than silently treating sig as decorative.
          return {
            valid: false,
            brokenAt: e.eventId,
            reason: VERIFY_CHAIN_REASONS.SIG_PRESENT_NO_KEY,
            index: i,
          };
        }
        const expectedSig = _hmacHex(this.signingKey, _canonicalConcat(e));
        if (!_timingSafeEqualHex(e.sig, expectedSig)) {
          return {
            valid: false,
            brokenAt: e.eventId,
            reason: VERIFY_CHAIN_REASONS.SIGNATURE_MISMATCH,
            index: i,
          };
        }
      }

      expectedPrev = e.eventHash;
    }

    return { valid: true, entries: entries.length };
  }

  cleanup() {
    if (!fs.existsSync(this.rootDir)) return { removed: 0 };
    const now = Date.now();
    let removed = 0;
    try {
      for (const entry of fs.readdirSync(this.rootDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(this.rootDir, entry.name);
        try {
          const stat = fs.statSync(dir);
          if (now - stat.mtimeMs > this.ttlMs) {
            fs.rmSync(dir, { recursive: true, force: true });
            removed++;
          }
        } catch (_) {}
      }
    } catch (_) {}
    return { removed };
  }
}

module.exports = { EvidenceLedger, VERIFY_CHAIN_REASONS };
