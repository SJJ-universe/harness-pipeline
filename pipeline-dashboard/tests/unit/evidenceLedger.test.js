// Unit test: Evidence Ledger with hash chain + TTL cleanup
const { describe, it } = require("node:test");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { EvidenceLedger, VERIFY_CHAIN_REASONS } = require("../../src/runtime/evidenceLedger");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ledger-test-"));
}

describe("EvidenceLedger", () => {
  it("appends entries with hash chain", () => {
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir });
    const e1 = ledger.append("run-1", { type: "run_started", data: { kind: "test" } });
    const e2 = ledger.append("run-1", { type: "policy_decision", data: { decision: "allow" } });

    assert.equal(e1.previousHash, "0");
    assert.equal(e2.previousHash, e1.eventHash);
    assert.ok(e1.eventId.startsWith("evt-"));
    assert.equal(e1.runId, "run-1");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads all entries back", () => {
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir });
    ledger.append("run-2", { type: "a", data: {} });
    ledger.append("run-2", { type: "b", data: { x: 1 } });
    ledger.append("run-2", { type: "c", data: { y: 2 } });
    const entries = ledger.read("run-2");
    assert.equal(entries.length, 3);
    assert.equal(entries[0].type, "a");
    assert.equal(entries[2].type, "c");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("verifies intact hash chain", () => {
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir });
    ledger.append("run-3", { type: "start", data: {} });
    ledger.append("run-3", { type: "end", data: {} });
    const result = ledger.verify("run-3");
    assert.ok(result.valid);
    assert.equal(result.entries, 2);
    assert.equal(result.errors.length, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects tampered hash chain", () => {
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir });
    ledger.append("run-4", { type: "start", data: {} });
    ledger.append("run-4", { type: "end", data: {} });

    // Tamper with the ledger file — change second entry's previousHash
    const p = path.join(dir, "run-4", "ledger.jsonl");
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[1]);
    entry.previousHash = "tampered";
    lines[1] = JSON.stringify(entry);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

    const result = ledger.verify("run-4");
    assert.ok(!result.valid);
    assert.ok(result.errors.length > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("cleans up old runs by TTL", () => {
    // R2-0a stability: pre-fix this test used `ttlMs: 1` + a 10ms busy-wait
    // and racing with `Date.now()`'s 15ms-resolution scheduler tick on
    // Windows occasionally landed `now - mtime` within the 1ms window
    // (both readings collapsed onto the same tick). The cleanup then
    // reported `removed: 0`, the test failed, and the test count dropped
    // by 1 — which sync-scorecard then wrote into the doc markers,
    // tripping the freshness gate on the next CI run. Fix: use a
    // generous TTL and force the dir mtime backwards via fs.utimesSync
    // so the test is deterministic regardless of clock resolution.
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir, ttlMs: 1000 });
    ledger.append("old-run", { type: "start", data: {} });

    // Backdate the run directory's mtime to 5 seconds ago. This makes
    // `now - stat.mtimeMs` reliably 5000ms regardless of how Date.now()
    // and fs.statSync agree on "now".
    const oldDir = path.join(dir, "old-run");
    const fiveSecondsAgoSec = (Date.now() - 5000) / 1000;
    fs.utimesSync(oldDir, fiveSecondsAgoSec, fiveSecondsAgoSec);

    const result = ledger.cleanup();
    assert.ok(result.removed >= 1, "expected cleanup to remove the backdated run");
    assert.ok(!fs.existsSync(oldDir));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT clean up fresh runs (TTL boundary)", () => {
    // R2-0a: companion test locking the negative case — a run that's
    // newer than the TTL must NOT be touched. Ensures cleanup() doesn't
    // sweep too aggressively, which would be the symmetric flake (count
    // jumps UP when a non-stale run is removed prematurely).
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir, ttlMs: 60 * 1000 });
    ledger.append("fresh-run", { type: "start", data: {} });
    const result = ledger.cleanup();
    assert.equal(result.removed, 0, "fresh run should survive cleanup");
    assert.ok(fs.existsSync(path.join(dir, "fresh-run")));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty for non-existent run", () => {
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir });
    assert.deepEqual(ledger.read("no-such-run"), []);
    const v = ledger.verify("no-such-run");
    assert.ok(v.valid);
    assert.equal(v.entries, 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── Slice R1-c (Phase D R1, 2026-04-28): HMAC signature + verifyChain ──
//
// MG1 RFC §5.3-§5.4. Tests cover:
//   - signingKey null (today's behavior — no sig field)
//   - signingKey set (sig + sigVer:1 added; verifyChain green)
//   - tampered data field detected by dataHash check (before sig check)
//   - tampered sig detected by signature_mismatch
//   - sig present but ledger has no key → sig_present_but_no_key
//   - unknown sigVer → unknown_sigVer (forward-compat guard)
//   - HKDF-derived key from a different info label produces different sig
//   - VERIFY_CHAIN_REASONS shape stable + frozen

test("R1-c: signingKey=null preserves today's entry shape (no sig/sigVer fields)", () => {
  const dir = tmpDir();
  try {
    const ledger = new EvidenceLedger({ rootDir: dir });   // no signingKey
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    assert.equal(Object.prototype.hasOwnProperty.call(e, "sig"), false,
      "no signing key → no sig field");
    assert.equal(Object.prototype.hasOwnProperty.call(e, "sigVer"), false,
      "no signing key → no sigVer field");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: signingKey set → entry gains sig (hex) + sigVer:1", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    assert.equal(typeof e.sig, "string");
    assert.match(e.sig, /^[0-9a-f]{64}$/, "sig is sha256-hex (64 chars)");
    assert.equal(e.sigVer, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: signingKey accepts string (converted to Buffer internally)", () => {
  const dir = tmpDir();
  try {
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: "test-key-1234567890abcdef" });
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    assert.equal(typeof e.sig, "string");
    assert.equal(e.sigVer, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: signingKey rejects invalid types (number / object)", () => {
  const dir = tmpDir();
  try {
    assert.throws(() => new EvidenceLedger({ rootDir: dir, signingKey: 42 }),
      /Buffer, string, or null/);
    assert.throws(() => new EvidenceLedger({ rootDir: dir, signingKey: { not: "a key" } }),
      /Buffer, string, or null/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain green on intact signed chain", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    ledger.append("rr", { type: "a", data: { i: 1 } });
    ledger.append("rr", { type: "b", data: { i: 2 } });
    ledger.append("rr", { type: "c", data: { i: 3 } });
    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, true);
    assert.equal(result.entries, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain green on intact UNSIGNED chain (backwards compat)", () => {
  const dir = tmpDir();
  try {
    const ledger = new EvidenceLedger({ rootDir: dir });   // no key
    ledger.append("rr", { type: "a", data: { i: 1 } });
    ledger.append("rr", { type: "b", data: { i: 2 } });
    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, true,
      "ledgers without signing keys still pass verifyChain (hash chain only)");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain detects data field tampering via dataHash mismatch", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    // Tamper the data field on disk.
    const p = path.join(dir, "rr", "ledger.jsonl");
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.data = { phase: "ATTACKER" };  // dataHash now stale
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, false);
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.DATA_HASH_MISMATCH);
    assert.equal(result.brokenAt, e.eventId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain detects signature tampering via signature_mismatch", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    // Tamper the signature only.
    const p = path.join(dir, "rr", "ledger.jsonl");
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.sig = "0".repeat(64);   // wrong sig, valid hex shape
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, false);
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.SIGNATURE_MISMATCH);
    assert.equal(result.brokenAt, e.eventId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain rejects sig-present entry when verifier has no key", () => {
  const dir = tmpDir();
  try {
    // Write the file with a signing-enabled ledger…
    const k1 = crypto.randomBytes(32);
    const writer = new EvidenceLedger({ rootDir: dir, signingKey: k1 });
    const e = writer.append("rr", { type: "a", data: {} });
    // …then verify with a no-key ledger pointed at the same dir.
    const verifier = new EvidenceLedger({ rootDir: dir });   // no key
    const result = verifier.verifyChain("rr");
    assert.equal(result.valid, false);
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.SIG_PRESENT_NO_KEY);
    assert.equal(result.brokenAt, e.eventId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain rejects unknown sigVer (forward-compat guard)", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    const e = ledger.append("rr", { type: "phase_update", data: { phase: "B" } });
    // Bump sigVer to 2 — verifier only knows v1.
    const p = path.join(dir, "rr", "ledger.jsonl");
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    entry.sigVer = 2;
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, false);
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.UNKNOWN_SIG_VER);
    assert.equal(result.brokenAt, e.eventId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: verifyChain detects previous-hash chain tampering", () => {
  const dir = tmpDir();
  try {
    const key = crypto.randomBytes(32);
    const ledger = new EvidenceLedger({ rootDir: dir, signingKey: key });
    ledger.append("rr", { type: "a", data: {} });
    const e2 = ledger.append("rr", { type: "b", data: {} });
    const p = path.join(dir, "rr", "ledger.jsonl");
    const lines = fs.readFileSync(p, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[1]);
    entry.previousHash = "0".repeat(64);   // wrong chain link
    lines[1] = JSON.stringify(entry);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");

    const result = ledger.verifyChain("rr");
    assert.equal(result.valid, false);
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.PREVIOUS_HASH_MISMATCH);
    assert.equal(result.brokenAt, e2.eventId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: signing keys derived from different HKDF info labels produce different sigs", () => {
  // The whole point of MG1 §5.5: JWT key (info=runner-jwt) and audit ledger
  // key (info=audit-ledger) must NEVER overlap. Using the JWT key against
  // an audit ledger MUST fail signature verification.
  const dir = tmpDir();
  try {
    const ikm = crypto.randomBytes(32);
    const jwtKey = crypto.hkdfSync("sha256", ikm, Buffer.from("salt"), Buffer.from("runner-jwt"), 32);
    const ledgerKey = crypto.hkdfSync("sha256", ikm, Buffer.from("salt"), Buffer.from("audit-ledger"), 32);
    const writer = new EvidenceLedger({ rootDir: dir, signingKey: Buffer.from(ledgerKey) });
    const e = writer.append("rr", { type: "a", data: {} });
    // Verifier holds the JWT key by mistake.
    const verifier = new EvidenceLedger({ rootDir: dir, signingKey: Buffer.from(jwtKey) });
    const result = verifier.verifyChain("rr");
    assert.equal(result.valid, false,
      "wrong key → signature mismatch (HKDF domain separation working)");
    assert.equal(result.reason, VERIFY_CHAIN_REASONS.SIGNATURE_MISMATCH);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R1-c: VERIFY_CHAIN_REASONS keys are stable + frozen", () => {
  // Audit-log dashboards key off these reason codes; freezing locks the
  // public contract.
  assert.deepEqual(Object.keys(VERIFY_CHAIN_REASONS).sort(), [
    "DATA_HASH_MISMATCH",
    "EVENT_HASH_MISMATCH",
    "PREVIOUS_HASH_MISMATCH",
    "SIGNATURE_MISMATCH",
    "SIG_PRESENT_NO_KEY",
    "UNKNOWN_SIG_VER",
  ]);
  assert.equal(Object.isFrozen(VERIFY_CHAIN_REASONS), true);
});
