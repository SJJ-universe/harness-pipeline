// EvidenceLedger — append-only JSONL event log with hash chain for tamper evidence.
//
// Each entry: { eventId, runId, type, at, dataHash, previousHash, data }
// Hash chain: eventHash = sha256(previousHash + type + dataHash)

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

class EvidenceLedger {
  constructor({ rootDir, ttlMs = 7 * 24 * 3600 * 1000 }) {
    this.rootDir = rootDir;
    this.ttlMs = ttlMs;
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

    const at = new Date().toISOString();
    const dataHash = sha256(JSON.stringify(data));
    const previousHash = this._chainHeads.get(runId) || "0";
    const eventHash = sha256(previousHash + type + dataHash);
    const eventId = `evt-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    const entry = { eventId, runId, type, at, dataHash, previousHash, eventHash, data };
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

module.exports = { EvidenceLedger };
