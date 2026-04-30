// Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30) — auditor bundle CLI smoke.
//
// Drives the verifier script end-to-end: build a real bundle from a
// stub ledger, write to disk, run the script, assert exit + summary.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const auditor = require("../../src/runtime/auditorBundle");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "verify-auditor-bundle.js");

function makeStubLedger({ entriesByRun = {}, chainByRun = {} } = {}) {
  return {
    read: (runId) => entriesByRun[runId] || [],
    verifyChain: (runId) => chainByRun[runId] || { valid: true, entries: 0 },
    listRuns: () => Object.keys(entriesByRun),
  };
}

function writeBundle(bundle) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auditor-bundle-smoke-"));
  const file = path.join(tmp, "bundle.json");
  fs.writeFileSync(file, JSON.stringify(bundle), "utf-8");
  return { dir: tmp, file };
}

test("GOV-AUDIT-0 smoke: --help exits 0", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf-8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});

test("GOV-AUDIT-0 smoke: missing path exits 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "/path/does/not/exist.json"], { encoding: "utf-8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not found/);
});

test("GOV-AUDIT-0 smoke: malformed JSON exits 2", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auditor-bundle-smoke-"));
  const file = path.join(tmp, "bad.json");
  fs.writeFileSync(file, "{not json", "utf-8");
  const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf-8" });
  assert.equal(r.status, 2);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("GOV-AUDIT-0 smoke: unsealed bundle PASS", () => {
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1",
    clockFn: () => "2026-04-30T05:00:00.000Z",
  });
  const { dir, file } = writeBundle(bundle);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf-8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /RESULT: PASS/);
    assert.match(r.stdout, /alg=none/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-AUDIT-0 smoke: tampered entries → exit 1, FAIL", () => {
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1",
    clockFn: () => "T",
  });
  bundle.entries[0].type = "tampered";
  const { dir, file } = writeBundle(bundle);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf-8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /RESULT: FAIL/);
    assert.match(r.stdout, /entries_hash_mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-AUDIT-0 smoke: sealed bundle verifies with --key", () => {
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const sealKeyHex = sealKey.toString("hex");
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1", sealKey,
    clockFn: () => "T",
  });
  const { dir, file } = writeBundle(bundle);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file, "--key", sealKeyHex], { encoding: "utf-8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /RESULT: PASS/);
    assert.match(r.stdout, /sealed:.*yes/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-AUDIT-0 smoke: sealed bundle without --key reports key required", () => {
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1", sealKey,
    clockFn: () => "T",
  });
  const { dir, file } = writeBundle(bundle);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf-8" });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /key_required_for_sealed_bundle/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-AUDIT-0 smoke: HARNESS_AUDIT_KEY env works as alternative to --key", () => {
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const sealKey = crypto.randomBytes(32);
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1", sealKey,
    clockFn: () => "T",
  });
  const { dir, file } = writeBundle(bundle);
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file], {
      encoding: "utf-8",
      env: { ...process.env, HARNESS_AUDIT_KEY: sealKey.toString("hex") },
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /RESULT: PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-AUDIT-0 smoke: handles wrapped {ok,bundle} response shape", () => {
  // POST /api/audit/runs/:runId/export returns { ok, bundle }; the
  // operator may save the entire response as JSON. Verifier must
  // unwrap.
  const ledger = makeStubLedger({
    entriesByRun: { run1: [{ eventId: "e1", at: "2026-04-30T00:00:00Z", type: "x" }] },
    chainByRun: { run1: { valid: true, entries: 1 } },
  });
  const bundle = auditor.buildByRun({
    evidenceLedger: ledger, runId: "run1",
    clockFn: () => "T",
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "auditor-bundle-smoke-"));
  const file = path.join(tmp, "wrapped.json");
  fs.writeFileSync(file, JSON.stringify({ ok: true, bundle }), "utf-8");
  try {
    const r = spawnSync(process.execPath, [SCRIPT, file], { encoding: "utf-8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /RESULT: PASS/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
