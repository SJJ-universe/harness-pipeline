// Slice POL-c (Phase 2 / POLICY-UX-0, 2026-05-05) — policyPacks
// store slice tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");

function samplePayload(overrides = {}) {
  return {
    schema: "orchestrator-policy-pack/v1",
    currentPack: "standard",
    packs: [
      { modeId: "standard", label: "Standard", isCurrent: true,
        publicSector: false, hardGatesDefault: false, runMemoryEnabled: true },
      { modeId: "public-sector", label: "Public Sector", isCurrent: false,
        publicSector: true, hardGatesDefault: false, runMemoryEnabled: true },
    ],
    metadata: {
      hardGatesEffectiveMode: "warn",
      runMemoryEffective: true,
      hardGatesEnvOverride: false,
      runMemoryEnvOverride: false,
      publicSectorRequirements: ["agency-managed", "sandbox", "signed manifest"],
    },
    serverTime: 1_000_000,
    ...overrides,
  };
}

// ── Initial state ─────────────────────────────────────────────────

test("POL-c store: snapshot.policyPacks is null initially", () => {
  const store = createMonitorStore();
  assert.equal(store.snapshot().policyPacks, null);
});

// ── setPolicyPacks ────────────────────────────────────────────────

test("setPolicyPacks: lands payload in snapshot", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  const s = store.snapshot();
  assert.ok(s.policyPacks);
  assert.equal(s.policyPacks.schema, "orchestrator-policy-pack/v1");
  assert.equal(s.policyPacks.currentPack, "standard");
  assert.equal(s.policyPacks.packs.length, 2);
  assert.equal(s.policyPacks.metadata.hardGatesEffectiveMode, "warn");
  assert.equal(s.policyPacks.serverTime, 1_000_000);
});

test("setPolicyPacks: foreign schema → no-op (defensive)", () => {
  const store = createMonitorStore();
  store.setPolicyPacks({ schema: "evil/v9", packs: [] });
  assert.equal(store.snapshot().policyPacks, null,
    "schema check rejects foreign payload");
});

test("setPolicyPacks: null/undefined/non-object → no-op", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(null);
  store.setPolicyPacks(undefined);
  store.setPolicyPacks("not an object");
  assert.equal(store.snapshot().policyPacks, null);
});

test("setPolicyPacks: idempotent — same payload no publish", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.setPolicyPacks(samplePayload());
  assert.equal(pubs, 0, "identical payload → no notify-churn");
});

test("setPolicyPacks: different payload → publish", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.setPolicyPacks(samplePayload({ currentPack: "public-sector" }));
  assert.equal(pubs, 1);
  assert.equal(store.snapshot().policyPacks.currentPack, "public-sector");
});

test("setPolicyPacks: missing metadata tolerated → null metadata", () => {
  const store = createMonitorStore();
  store.setPolicyPacks({
    schema: "orchestrator-policy-pack/v1",
    currentPack: null,
    packs: [],
    serverTime: null,
  });
  assert.equal(store.snapshot().policyPacks.metadata, null);
});

test("setPolicyPacks: serverTime updates trigger publish", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload({ serverTime: 1000 }));
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.setPolicyPacks(samplePayload({ serverTime: 2000 }));
  assert.equal(pubs, 1);
});

// ── Snapshot defensive copy ───────────────────────────────────────

test("snapshot policyPacks: shallow-copies inner packs (caller mutation isolated)", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  const s1 = store.snapshot();
  s1.policyPacks.packs[0].modeId = "tampered";
  const s2 = store.snapshot();
  assert.equal(s2.policyPacks.packs[0].modeId, "standard",
    "stored entry not mutated");
});

test("snapshot policyPacks: shallow-copies publicSectorRequirements", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  const s1 = store.snapshot();
  s1.policyPacks.metadata.publicSectorRequirements.push("INJECTED");
  const s2 = store.snapshot();
  assert.equal(s2.policyPacks.metadata.publicSectorRequirements.length, 3,
    "requirements list immutable to caller");
});

// ── clearPolicyPacks ──────────────────────────────────────────────

test("clearPolicyPacks: resets to null + publishes when previously set", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.clearPolicyPacks();
  assert.equal(store.snapshot().policyPacks, null);
  assert.equal(pubs, 1);
});

test("clearPolicyPacks: no-op when already null (no publish)", () => {
  const store = createMonitorStore();
  let pubs = 0;
  store.subscribe(() => { pubs++; });
  store.clearPolicyPacks();
  assert.equal(pubs, 0);
});

// ── reset() clears policyPacks ────────────────────────────────────

test("reset(): clears policyPacks via freshState", () => {
  const store = createMonitorStore();
  store.setPolicyPacks(samplePayload());
  store.reset();
  assert.equal(store.snapshot().policyPacks, null);
});

// ── Subscribe fires ───────────────────────────────────────────────

test("subscribe: setPolicyPacks fires subscriber", () => {
  const store = createMonitorStore();
  let fired = 0;
  store.subscribe(() => { fired++; });
  store.setPolicyPacks(samplePayload());
  assert.equal(fired, 1);
});
