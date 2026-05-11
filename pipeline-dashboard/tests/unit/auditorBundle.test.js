// Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30) — auditor bundle unit tests.
// Pins canonical-encoding, hash determinism, seal HMAC, and the
// roundtrip build → verifyBundle path for byRun + byWindow modes.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const auditor = require("../../src/runtime/auditorBundle");

// ── Stable stringify ─────────────────────────────────────────────

test("GOV-AUDIT-0: _stableStringify sorts object keys recursively", () => {
  const a = auditor._stableStringify({ b: 1, a: 2, nested: { y: 1, x: 2 } });
  const b = auditor._stableStringify({ a: 2, b: 1, nested: { x: 2, y: 1 } });
  assert.equal(a, b);
});

test("GOV-AUDIT-0: _stableStringify preserves array order", () => {
  const a = auditor._stableStringify([1, 2, 3]);
  const b = auditor._stableStringify([3, 2, 1]);
  assert.notEqual(a, b);
});

test("GOV-AUDIT-0: _hashEntries is deterministic across reorderings of object keys", () => {
  const e1 = [{ at: "2026-04-30T00:00:00Z", type: "x", data: { foo: 1, bar: 2 } }];
  const e2 = [{ data: { bar: 2, foo: 1 }, type: "x", at: "2026-04-30T00:00:00Z" }];
  assert.equal(auditor._hashEntries(e1), auditor._hashEntries(e2));
});

test("GOV-AUDIT-0: _hashEntries differs when entries change", () => {
  const e1 = [{ at: "2026-04-30T00:00:00Z", type: "x" }];
  const e2 = [{ at: "2026-04-30T00:00:01Z", type: "x" }];
  assert.notEqual(auditor._hashEntries(e1), auditor._hashEntries(e2));
});

test("GOV-AUDIT-0: _normalizeLimit clamps + defaults", () => {
  assert.equal(auditor._normalizeLimit(undefined), auditor.DEFAULT_LIMIT);
  assert.equal(auditor._normalizeLimit(null), auditor.DEFAULT_LIMIT);
  assert.equal(auditor._normalizeLimit(""), auditor.DEFAULT_LIMIT);
  assert.equal(auditor._normalizeLimit(0), auditor.DEFAULT_LIMIT);
  assert.equal(auditor._normalizeLimit(-5), auditor.DEFAULT_LIMIT);
  assert.equal(auditor._normalizeLimit(50), 50);
  assert.equal(auditor._normalizeLimit(99999), auditor.MAX_LIMIT);
});

test("GOV-AUDIT-0: _entryWithinWindow handles boundaries inclusively", () => {
  const e = { at: "2026-04-30T12:00:00Z" };
  assert.equal(auditor._entryWithinWindow(e, "2026-04-30T11:00:00Z", "2026-04-30T13:00:00Z"), true);
  assert.equal(auditor._entryWithinWindow(e, "2026-04-30T12:00:00Z", "2026-04-30T12:00:00Z"), true);
  assert.equal(auditor._entryWithinWindow(e, "2026-04-30T13:00:00Z", null), false);
  assert.equal(auditor._entryWithinWindow(e, null, "2026-04-30T11:00:00Z"), false);
  assert.equal(auditor._entryWithinWindow({}, null, null), false); // no .at
});

// ── byRun ─────────────────────────────────────────────────────────

function makeStubLedger({ entriesByRun = {}, chainByRun = {} } = {}) {
  return {
    read: (runId) => entriesByRun[runId] || [],
    verifyChain: (runId) => chainByRun[runId] || { valid: true, entries: 0 },
    listRuns: () => Object.keys(entriesByRun),
  };
}

test("GOV-AUDIT-0: buildByRun throws on missing inputs", () => {
  const ledger = makeStubLedger();
  assert.throws(() => auditor.buildByRun({ evidenceLedger: null, runId: "r1" }), /evidenceLedger required/);
  assert.throws(() => auditor.buildByRun({ evidenceLedger: ledger, runId: "" }), /runId required/);
});

test("GOV-AUDIT-0: buildByRun ships entries + chain + computed hashes", () => {
  const entries = [
    { eventId: "e1", at: "2026-04-30T00:00:00Z", type: "review_session_created", data: { foo: 1 } },
    { eventId: "e2", at: "2026-04-30T00:00:01Z", type: "review_session_archived", data: { foo: 2 } },
  ];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 2 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger,
    runId: "r1",
    deployment: { mode: "standard", publicSector: false },
    sealKey: null,
    clockFn: () => "2026-04-30T05:00:00.000Z",
  });
  assert.equal(bundle.schema, auditor.SCHEMA);
  assert.equal(bundle.mode, "byRun");
  assert.equal(bundle.scope.runId, "r1");
  assert.equal(bundle.totalEntries, 2);
  assert.equal(bundle.truncated, false);
  assert.equal(bundle.entries.length, 2);
  assert.equal(bundle.chain.valid, true);
  // entriesHash matches independent recomputation
  assert.equal(bundle.entriesHash, auditor._hashEntries(entries));
  // unsealed (sealKey=null) — alg "none"
  assert.equal(bundle.seal.alg, "none");
  assert.equal(bundle.seal.value, null);
});

test("GOV-AUDIT-0: buildByRun truncates entries when total > limit", () => {
  const entries = Array.from({ length: 5 }, (_, i) => ({
    eventId: "e" + i, at: "2026-04-30T00:00:0" + i + "Z", type: "x",
  }));
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 5 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1", limit: 3,
    clockFn: () => "T",
  });
  assert.equal(bundle.totalEntries, 5);
  assert.equal(bundle.truncated, true);
  assert.equal(bundle.entries.length, 3);
  // Last 3 (most recent)
  assert.deepEqual(bundle.entries.map((e) => e.eventId), ["e2", "e3", "e4"]);
});

test("GOV-AUDIT-0: buildByRun seals when sealKey provided", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const sealKey = Buffer.from("01".repeat(32), "hex");
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1",
    sealKey,
    clockFn: () => "2026-04-30T05:00:00.000Z",
  });
  assert.equal(bundle.seal.alg, "HMAC-SHA256");
  assert.match(bundle.seal.value, /^[0-9a-f]{64}$/);
});

// ── byWindow ──────────────────────────────────────────────────────

test("GOV-AUDIT-0: buildByWindow requires at least one window bound", () => {
  const ledger = makeStubLedger({ entriesByRun: { r1: [] } });
  assert.throws(() => auditor.buildByWindow({
    evidenceLedger: ledger,
    windowFromAt: null, windowToAt: null,
  }), /at least one of windowFromAt/);
});

test("GOV-AUDIT-0: buildByWindow rejects from > to", () => {
  const ledger = makeStubLedger({ entriesByRun: { r1: [] } });
  assert.throws(() => auditor.buildByWindow({
    evidenceLedger: ledger,
    windowFromAt: "2026-05-30T00:00:00Z",
    windowToAt: "2026-04-30T00:00:00Z",
  }), /windowFromAt must be ≤ windowToAt/);
});

test("GOV-AUDIT-0: buildByWindow filters across runs by entry.at", () => {
  const r1 = [
    { eventId: "r1-1", at: "2026-04-30T00:00:00Z", type: "x" },
    { eventId: "r1-2", at: "2026-05-15T00:00:00Z", type: "x" }, // outside
  ];
  const r2 = [
    { eventId: "r2-1", at: "2026-04-30T01:00:00Z", type: "y" },
    { eventId: "r2-2", at: "2026-04-30T02:00:00Z", type: "y" },
  ];
  const ledger = makeStubLedger({
    entriesByRun: { r1, r2 },
    chainByRun: { r1: { valid: true, entries: 2 }, r2: { valid: true, entries: 2 } },
  });
  const bundle = auditor.buildByWindow({
    evidenceLedger: ledger,
    windowFromAt: "2026-04-30T00:00:00Z",
    windowToAt: "2026-04-30T23:59:59Z",
    clockFn: () => "T",
  });
  assert.equal(bundle.mode, "byWindow");
  assert.equal(bundle.totalEntries, 3); // r1-1, r2-1, r2-2 (r1-2 outside window)
  // Sorted ASC by .at
  assert.deepEqual(bundle.entries.map((e) => e.eventId), ["r1-1", "r2-1", "r2-2"]);
  assert.equal(bundle.chain.runCount, 2);
  assert.equal(bundle.chain.valid, true);
});

test("GOV-AUDIT-0: buildByWindow chain.valid=false when ANY run has broken chain", () => {
  const r1 = [{ eventId: "r1-1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const r2 = [{ eventId: "r2-1", at: "2026-04-30T01:00:00Z", type: "y" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1, r2 },
    chainByRun: {
      r1: { valid: true, entries: 1 },
      r2: { valid: false, brokenAt: "r2-1", reason: "previousHash_mismatch", index: 0 },
    },
  });
  const bundle = auditor.buildByWindow({
    evidenceLedger: ledger,
    windowFromAt: "2026-04-30T00:00:00Z",
    windowToAt: "2026-04-30T23:59:59Z",
    clockFn: () => "T",
  });
  assert.equal(bundle.chain.valid, false);
  assert.equal(bundle.chain.runCount, 2);
});

// ── verifyBundle ─────────────────────────────────────────────────

test("GOV-AUDIT-0: verifyBundle round-trips an unsealed bundle", () => {
  const entries = [
    { eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" },
    { eventId: "e2", at: "2026-04-30T00:00:01Z", type: "y" },
  ];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 2 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1",
    clockFn: () => "T",
  });
  const result = auditor.verifyBundle(bundle, null);
  assert.equal(result.ok, true);
  assert.equal(result.sealed, false);
});

test("GOV-AUDIT-0: verifyBundle round-trips a sealed bundle with the same key", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1", sealKey,
    clockFn: () => "T",
  });
  const result = auditor.verifyBundle(bundle, sealKey);
  assert.equal(result.ok, true);
  assert.equal(result.sealed, true);
});

test("GOV-AUDIT-0: verifyBundle detects mutated entries", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1",
    clockFn: () => "T",
  });
  // Tamper: change an entry
  bundle.entries[0].type = "tampered";
  const result = auditor.verifyBundle(bundle, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "entries_hash_mismatch");
});

test("GOV-AUDIT-0: verifyBundle detects mutated chain summary", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1",
    clockFn: () => "T",
  });
  bundle.chain.entries = 99;
  const result = auditor.verifyBundle(bundle, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "chain_hash_mismatch");
});

test("GOV-AUDIT-0: verifyBundle rejects sealed bundle without key", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1", sealKey,
    clockFn: () => "T",
  });
  const result = auditor.verifyBundle(bundle, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "key_required_for_sealed_bundle");
});

test("GOV-AUDIT-0: verifyBundle rejects wrong key on sealed bundle", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1", sealKey,
    clockFn: () => "T",
  });
  const result = auditor.verifyBundle(bundle, wrongKey);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "seal_mismatch");
});

test("GOV-AUDIT-0: verifyBundle reports broken chain inside bundle", () => {
  const entries = [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }];
  const ledger = makeStubLedger({
    entriesByRun: { r1: entries },
    chainByRun: { r1: { valid: false, brokenAt: "e1", reason: "previousHash_mismatch", index: 0, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "r1",
    clockFn: () => "T",
  });
  const result = auditor.verifyBundle(bundle, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "chain_invalid");
});

test("GOV-AUDIT-0: verifyBundle rejects unknown schema", () => {
  const result = auditor.verifyBundle({ schema: "orchestrator-junk/v0", entries: [] }, null);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_schema");
});

test("GOV-AUDIT-0: verifyBundle rejects garbage", () => {
  assert.equal(auditor.verifyBundle(null, null).ok, false);
  assert.equal(auditor.verifyBundle("not an obj", null).ok, false);
  assert.equal(auditor.verifyBundle(42, null).ok, false);
});
