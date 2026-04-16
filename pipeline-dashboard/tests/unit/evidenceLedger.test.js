// Unit test: Evidence Ledger with hash chain + TTL cleanup
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");

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
    const dir = tmpDir();
    const ledger = new EvidenceLedger({ rootDir: dir, ttlMs: 1 }); // 1ms TTL
    ledger.append("old-run", { type: "start", data: {} });

    // Wait briefly so mtime is older than TTL
    const start = Date.now();
    while (Date.now() - start < 10) {} // busy wait 10ms
    const result = ledger.cleanup();
    assert.ok(result.removed >= 1);
    assert.ok(!fs.existsSync(path.join(dir, "old-run")));
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
