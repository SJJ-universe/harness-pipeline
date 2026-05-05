// Slice POL-a (Phase 2 / POLICY-UX-0, 2026-05-05) — recordRunMemory
// + _isOptOut consult deploymentProfile.runMemoryEnabled.
//
// Pre-POL-a: env HARNESS_RUN_MEMORY_DISABLE was the only opt-out.
// Post-POL-a: pack.runMemoryEnabled === false ALSO disables writes.
// All 5 SMART-5 packs ship with runMemoryEnabled=true today, but a
// future "minimal-debug" pack could disable memory at the rule level.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runMemory = require("../../src/runtime/runMemory");

function fakeLedger() {
  const calls = [];
  return {
    calls,
    append(runId, entry) { calls.push({ runId, entry }); },
    read() { return []; },
  };
}

// ── _isOptOut precedence matrix ───────────────────────────────────

test("POL-a _isOptOut: env disable=1 + pack runMemoryEnabled=true → opt out (env wins)", () => {
  assert.equal(
    runMemory._isOptOut(
      { HARNESS_RUN_MEMORY_DISABLE: "1" },
      { runMemoryEnabled: true },
    ),
    true,
  );
});

test("POL-a _isOptOut: env unset + pack runMemoryEnabled=false → opt out (pack rule)", () => {
  assert.equal(
    runMemory._isOptOut(
      {},
      { runMemoryEnabled: false },
    ),
    true,
  );
});

test("POL-a _isOptOut: env unset + pack runMemoryEnabled=true → record", () => {
  assert.equal(
    runMemory._isOptOut(
      {},
      { runMemoryEnabled: true },
    ),
    false,
  );
});

test("POL-a _isOptOut: env disable + pack runMemoryEnabled=false → opt out (both agree)", () => {
  assert.equal(
    runMemory._isOptOut(
      { HARNESS_RUN_MEMORY_DISABLE: "1" },
      { runMemoryEnabled: false },
    ),
    true,
  );
});

test("POL-a _isOptOut: env unset + no pack → record (legacy 1-arg behavior)", () => {
  assert.equal(runMemory._isOptOut({}), false);
  assert.equal(runMemory._isOptOut(), false);
});

test("POL-a _isOptOut: env true / yes / TRUE all opt out (regardless of pack)", () => {
  for (const v of ["true", "yes", "TRUE", "1"]) {
    assert.equal(
      runMemory._isOptOut(
        { HARNESS_RUN_MEMORY_DISABLE: v },
        { runMemoryEnabled: true },
      ),
      true,
      `env=${v} should opt out`,
    );
  }
});

// ── recordRunMemory integration with deploymentProfile ────────────

test("POL-a recordRunMemory: pack runMemoryEnabled=false + env unset → recorded:false", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "pol-a-run-A",
    inputs: { goal: "x" },
    ledger,
    env: {},
    deploymentProfile: { runMemoryEnabled: false },
  });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, "disabled_by_env");
  assert.equal(ledger.calls.length, 0,
    "ledger.append NEVER called when pack disables run memory");
});

test("POL-a recordRunMemory: pack runMemoryEnabled=true + env unset → recorded:true", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "pol-a-run-B",
    inputs: { goal: "x" },
    ledger,
    env: {},
    deploymentProfile: { runMemoryEnabled: true, publicSector: false },
  });
  assert.equal(r.recorded, true);
  assert.equal(ledger.calls.length, 1);
});

test("POL-a recordRunMemory: env opt-out beats pack runMemoryEnabled=true", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "pol-a-run-C",
    inputs: { goal: "x" },
    ledger,
    env: { HARNESS_RUN_MEMORY_DISABLE: "1" },
    deploymentProfile: { runMemoryEnabled: true },
  });
  assert.equal(r.recorded, false,
    "operator HARNESS_RUN_MEMORY_DISABLE wins over pack");
  assert.equal(ledger.calls.length, 0);
});

// ── Backwards-compat: pre-POL-a 1-arg callers ────────────────────

test("POL-a backwards-compat: recordRunMemory without deploymentProfile uses standard pack default", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "pol-a-run-D",
    inputs: { goal: "x" },
    ledger,
    env: {},
    // no deploymentProfile — legacy callers
  });
  assert.equal(r.recorded, true,
    "no pack → step 2 (pack rule) skipped → record by default");
});

// ── Realistic scenario: future minimal-debug pack ────────────────

test("POL-a SCENARIO: hypothetical 'minimal-debug' pack disables memory entirely", () => {
  // A future pack with runMemoryEnabled=false would disable run
  // memory writes for that deployment. Operators don't have to set
  // HARNESS_RUN_MEMORY_DISABLE — the pack handles it.
  const ledger = fakeLedger();
  const minimalDebugPack = {
    publicSector: false,
    runMemoryEnabled: false,
    // ... other rule fields
  };
  for (let i = 0; i < 5; i++) {
    const r = runMemory.recordRunMemory({
      runId: `minimal-${i}`,
      inputs: { goal: "test" },
      ledger,
      env: {},
      deploymentProfile: minimalDebugPack,
    });
    assert.equal(r.recorded, false, `iteration ${i} skipped`);
  }
  assert.equal(ledger.calls.length, 0,
    "minimal-debug pack disables memory across all runs");
});
