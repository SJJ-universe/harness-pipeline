// Slice R3-c-2 (Phase D R3, 2026-04-28) — RunnerStaleMonitor wiring + end-to-end.
//
// This file asserts two layers:
//
//   1. server.js source-level wiring — the monitor module is required,
//      instantiated only when the runnerRegistry exists, started in
//      `start()`, and stopped on `server.close`. These greps catch a
//      careless future refactor that drops the wiring or skips the
//      registry-gated guard.
//
//   2. End-to-end with a real RunnerRegistry + real EvidenceLedger.
//      Drives the registry through a stale event, observes the
//      `runner_host_lost` audit row landing in the ledger, and checks
//      single-emit semantics across multiple ticks.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { RunnerRegistry } = require("../../src/runtime/runnerRegistry");
const { RunnerStaleMonitor } = require("../../src/runtime/runnerStaleMonitor");
const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");

function tmpLedgerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "runner-stale-mon-"));
}

// ── server.js source-level wiring ───────────────────────────────────

const SERVER_SRC = fs.readFileSync(
  path.resolve(__dirname, "../../server.js"),
  "utf-8",
);

test("R3-c-2: server.js requires RunnerStaleMonitor", () => {
  assert.match(SERVER_SRC, /require\(.*runnerStaleMonitor/);
});

test("R3-c-2: server.js gates monitor construction on _remoteRunner.runnerRegistry", () => {
  // The monitor must NOT spin up when remote mode is off (registry null).
  // We assert a conditional that references runnerRegistry near the
  // `new RunnerStaleMonitor(` call so the registry-gated guard is
  // visible at the source level.
  const idx = SERVER_SRC.indexOf("new RunnerStaleMonitor(");
  assert.ok(idx > -1, "expected `new RunnerStaleMonitor(` in server.js");
  // 200-char window around the constructor call must contain a check
  // against the registry presence (the `_remoteRunner.runnerRegistry`
  // ternary or equivalent).
  const window = SERVER_SRC.slice(Math.max(0, idx - 200), idx + 200);
  assert.match(window, /_remoteRunner\.runnerRegistry/,
    "monitor construction must be gated on _remoteRunner.runnerRegistry");
});

test("R3-c-2: server.js calls _runnerStaleMonitor.start() in start() and stop() on close", () => {
  // start() invokes start; server.close hook invokes stop. Both inside
  // try/catch so a failing monitor doesn't crash the server.
  assert.match(SERVER_SRC, /_runnerStaleMonitor\.start\(\)/,
    "expected _runnerStaleMonitor.start() call");
  assert.match(SERVER_SRC, /_runnerStaleMonitor\.stop\(\)/,
    "expected _runnerStaleMonitor.stop() call");
});

test("R3-c-2: server.js exposes HARNESS_RUNNER_STALE_INTERVAL_MS env override", () => {
  // Operators can tighten the cadence for faster signal in deployments
  // where host-loss must be reflected in the chain quickly.
  assert.match(SERVER_SRC, /HARNESS_RUNNER_STALE_INTERVAL_MS/,
    "expected HARNESS_RUNNER_STALE_INTERVAL_MS env hook");
});

// ── End-to-end with real registry + real ledger ─────────────────────

function makeReg(opts = {}) {
  const tokens = opts.tokens || { "host-1": "boot-1", "host-2": "boot-2" };
  return new RunnerRegistry({
    bootstrapTokenFor: (h) => tokens[h],
    now: opts.now,
    heartbeatDropMs: opts.heartbeatDropMs || 30_000,
  });
}

test("R3-c-2: end-to-end — stale host with stranded run → runner_host_lost audit row", () => {
  const dir = tmpLedgerDir();
  try {
    let clock = 1000;
    const reg = makeReg({ now: () => clock });
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const monitor = new RunnerStaleMonitor({ registry: reg, ledger });

    // Register host-1 + claim a run.
    reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
    reg.claimRunForRunner("rr-A", "host-1");

    // Tick before staleness — no audit.
    monitor.tick();
    assert.equal(ledger.read("system").length, 0,
      "fresh host should not emit audit");

    // Advance clock past heartbeatDropMs (30s default). host-1 is now stale.
    clock += 60_000;
    monitor.tick();
    const entries = ledger.read("system");
    assert.equal(entries.length, 1, "stale host with claimed run → audit");
    assert.equal(entries[0].type, "runner_host_lost");
    assert.equal(entries[0].data.hostIdentity, "host-1");
    assert.equal(entries[0].data.activeRuns, 1);
    assert.deepEqual(entries[0].data.affectedRuns, ["rr-A"]);
    assert.ok(entries[0].data.elapsedMs >= 60_000);
    // Signed by the ledger.
    assert.equal(typeof entries[0].sig, "string");
    assert.equal(entries[0].sigVer, 1);

    // Subsequent ticks — single-emit semantics.
    monitor.tick();
    monitor.tick();
    assert.equal(ledger.read("system").length, 1,
      "subsequent ticks must NOT re-emit while host stays stale");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R3-c-2: end-to-end — idle stale host (no claimed run) does NOT emit audit", () => {
  const dir = tmpLedgerDir();
  try {
    let clock = 1000;
    const reg = makeReg({ now: () => clock });
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const monitor = new RunnerStaleMonitor({ registry: reg, ledger });

    // Register host-1 but DO NOT claim any run.
    reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
    clock += 60_000;
    monitor.tick();
    monitor.tick();
    assert.equal(ledger.read("system").length, 0,
      "idle stale host produces no audit row (operator housekeeping)");
    // Stats track the prune detection but no audit emission.
    const s = monitor.getStats();
    assert.equal(s.pruned, 2, "registry reports stale on every tick");
    assert.equal(s.audited, 0, "no audit emitted because no stranded runs");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R3-c-2: end-to-end — multiple stale hosts in same tick → one audit each", () => {
  const dir = tmpLedgerDir();
  try {
    let clock = 1000;
    const reg = makeReg({ now: () => clock });
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const monitor = new RunnerStaleMonitor({ registry: reg, ledger });

    reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
    reg.handshake({ hostIdentity: "host-2", bootstrapToken: "boot-2" });
    reg.claimRunForRunner("rr-A", "host-1");
    reg.claimRunForRunner("rr-B", "host-2");
    reg.claimRunForRunner("rr-C", "host-2");

    clock += 60_000;
    monitor.tick();
    const entries = ledger.read("system");
    assert.equal(entries.length, 2, "two stranded-run hosts → two audit rows");
    const byHost = Object.fromEntries(
      entries.map((e) => [e.data.hostIdentity, e]),
    );
    assert.deepEqual(byHost["host-1"].data.affectedRuns, ["rr-A"]);
    assert.deepEqual(byHost["host-2"].data.affectedRuns.sort(), ["rr-B", "rr-C"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R3-c-2: end-to-end — verifyChain succeeds across mixed ledger entries", () => {
  // Audit chain integrity: appending a runner_host_lost row alongside
  // pre-existing entries (handshake_ok / handshake_collision) keeps the
  // hash + HMAC chain intact.
  const dir = tmpLedgerDir();
  try {
    let clock = 1000;
    const reg = makeReg({ now: () => clock });
    const ledger = new EvidenceLedger({
      rootDir: dir,
      signingKey: Buffer.from("0".repeat(32), "utf-8"),
    });
    const monitor = new RunnerStaleMonitor({ registry: reg, ledger });

    // Pre-existing entries: a successful handshake.
    reg.handshake({ hostIdentity: "host-1", bootstrapToken: "boot-1" });
    ledger.append("system", {
      type: "runner_handshake_ok",
      data: { hostIdentity: "host-1" },
    });
    reg.claimRunForRunner("rr-A", "host-1");

    // Trigger stale + audit.
    clock += 60_000;
    monitor.tick();

    // Verify the full chain.
    const result = ledger.verifyChain("system");
    assert.equal(result.valid, true,
      `chain must verify after host_lost row; got ${JSON.stringify(result)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
