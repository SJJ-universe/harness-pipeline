// Slice S5-a (Phase 2 / SMART-5, 2026-05-05) — policy pack registry tests.
//
// Pins:
//   - Frozen vocabulary (SCHEMA, PACKS, PACK_IDS, PACK_BY_ID, DEFAULT_PACK_ID)
//   - Exactly 5 packs at exactly the documented modeIds
//   - All packs validated at module load (typo'd boolean / missing
//     field / cross-field invariant violation throws at require time)
//   - Each pack exposes required rule fields with correct types
//   - getPack / isValidModeId behavior
//   - listPackSummaries strips internal rule fields
//   - Pack rule consistency vs. plan §S §S-SMART-5 expectations
//   - GOV-* compatibility checks (public-sector packs satisfy GOV-PII-0
//     fail-closed posture, etc.)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const reg = require("../../src/policy/policyPackRegistry");

// ── Frozen vocabulary ────────────────────────────────────────────

test("policyPackRegistry: SCHEMA constant", () => {
  assert.equal(reg.SCHEMA, "harness-policy-pack/v1");
});

test("policyPackRegistry: ships exactly 5 frozen packs", () => {
  assert.equal(reg.PACKS.length, 5);
  assert.ok(Object.isFrozen(reg.PACKS));
  for (const p of reg.PACKS) {
    assert.ok(Object.isFrozen(p), `${p.modeId} must be frozen`);
  }
});

test("policyPackRegistry: PACK_IDS is sorted + frozen", () => {
  assert.ok(Object.isFrozen(reg.PACK_IDS));
  const sorted = [...reg.PACK_IDS].sort();
  assert.deepEqual(reg.PACK_IDS, sorted);
  assert.deepEqual(reg.PACK_IDS, [
    "developer-lab",
    "finance-high-privacy",
    "offline-internal-network",
    "public-sector",
    "standard",
  ]);
});

test("policyPackRegistry: DEFAULT_PACK_ID = 'standard'", () => {
  assert.equal(reg.DEFAULT_PACK_ID, "standard");
});

// ── getPack / isValidModeId ──────────────────────────────────────

test("getPack: returns frozen pack for known modeId", () => {
  const p = reg.getPack("public-sector");
  assert.ok(p);
  assert.equal(p.modeId, "public-sector");
  assert.ok(Object.isFrozen(p));
});

test("getPack: returns undefined for unknown / non-string", () => {
  assert.equal(reg.getPack("does-not-exist"), undefined);
  assert.equal(reg.getPack(""), undefined);
  assert.equal(reg.getPack(null), undefined);
  assert.equal(reg.getPack(undefined), undefined);
  assert.equal(reg.getPack(42), undefined);
});

test("isValidModeId: returns boolean", () => {
  assert.equal(reg.isValidModeId("standard"), true);
  assert.equal(reg.isValidModeId("public-sector"), true);
  assert.equal(reg.isValidModeId("finance-high-privacy"), true);
  assert.equal(reg.isValidModeId("offline-internal-network"), true);
  assert.equal(reg.isValidModeId("developer-lab"), true);
  assert.equal(reg.isValidModeId("nonsense"), false);
  assert.equal(reg.isValidModeId(""), false);
  assert.equal(reg.isValidModeId(null), false);
});

// ── Required-fields validation ────────────────────────────────────

test("each pack has all required rule fields with correct types", () => {
  const requiredBools = [
    "publicSector",
    "allowLocalExecutor",
    "allowPersonalAccounts",
    "allowPlaintextSecrets",
    "requireSandboxWorkspace",
    "requireAgencyManagedAccount",
    "requireSignedManifest",
    "requirePiiScanBeforeProviderDispatch",
    "hardGatesDefault",
    "runMemoryEnabled",
  ];
  for (const p of reg.PACKS) {
    assert.equal(typeof p.modeId, "string");
    assert.match(p.modeId, /^[a-z][a-z0-9-]*$/);
    assert.ok(p.label.length > 0);
    assert.ok(p.description.length > 0);
    for (const key of requiredBools) {
      assert.equal(typeof p[key], "boolean", `${p.modeId} field ${key}`);
    }
    assert.ok(
      p.scannerFailurePolicy === "warn" || p.scannerFailurePolicy === "block",
      `${p.modeId} scannerFailurePolicy`,
    );
  }
});

test("packs are frozen (mutation throws)", () => {
  const p = reg.getPack("standard");
  assert.throws(() => { p.publicSector = true; });
  assert.throws(() => { p.label = "tampered"; });
});

test("PACKS array cannot accept new entries", () => {
  assert.throws(() => { reg.PACKS.push({ modeId: "evil" }); });
});

// ── Per-pack rule expectations ───────────────────────────────────

test("standard pack: permissive defaults, backward-compatible", () => {
  const p = reg.getPack("standard");
  assert.equal(p.publicSector, false);
  assert.equal(p.allowLocalExecutor, true);
  assert.equal(p.allowPersonalAccounts, true);
  assert.equal(p.allowPlaintextSecrets, true);
  assert.equal(p.requireSandboxWorkspace, false);
  assert.equal(p.requireSignedManifest, false);
  assert.equal(p.requirePiiScanBeforeProviderDispatch, false);
  assert.equal(p.scannerFailurePolicy, "warn");
  assert.equal(p.hardGatesDefault, false);
});

test("public-sector pack: existing 공공기관 posture preserved", () => {
  const p = reg.getPack("public-sector");
  assert.equal(p.publicSector, true);
  assert.equal(p.allowLocalExecutor, false);
  assert.equal(p.allowPersonalAccounts, false);
  assert.equal(p.allowPlaintextSecrets, false);
  assert.equal(p.requireSandboxWorkspace, true);
  assert.equal(p.requireAgencyManagedAccount, true);
  assert.equal(p.requireSignedManifest, true);
  assert.equal(p.requirePiiScanBeforeProviderDispatch, true);
  assert.equal(p.scannerFailurePolicy, "block");
  assert.equal(p.hardGatesDefault, false);  // graduated rollout
});

test("finance-high-privacy: stricter than public-sector (hard gates default ON)", () => {
  const p = reg.getPack("finance-high-privacy");
  assert.equal(p.publicSector, true);
  assert.equal(p.allowLocalExecutor, false);
  assert.equal(p.allowPlaintextSecrets, false);
  assert.equal(p.requireSandboxWorkspace, true);
  assert.equal(p.requireSignedManifest, true);
  assert.equal(p.requirePiiScanBeforeProviderDispatch, true);
  assert.equal(p.scannerFailurePolicy, "block");
  assert.equal(p.hardGatesDefault, true,
    "finance-high-privacy is stricter than public-sector — hard gates default ON");
});

test("offline-internal-network: sandbox + plaintext-off + signing-off", () => {
  const p = reg.getPack("offline-internal-network");
  assert.equal(p.allowLocalExecutor, false);
  assert.equal(p.allowPlaintextSecrets, false);
  assert.equal(p.requireSandboxWorkspace, true);
  assert.equal(p.requireSignedManifest, false,
    "offline networks have no public-key infra; trust comes from isolation");
  assert.equal(p.requirePiiScanBeforeProviderDispatch, false);
  assert.equal(p.scannerFailurePolicy, "warn");
  // Not labeled public-sector — operator may use this for non-government
  // air-gapped deployments.
  assert.equal(p.publicSector, false);
});

test("developer-lab: most permissive, plaintext opt-in OK, warn gates", () => {
  const p = reg.getPack("developer-lab");
  assert.equal(p.publicSector, false);
  assert.equal(p.allowLocalExecutor, true);
  assert.equal(p.allowPersonalAccounts, true);
  assert.equal(p.allowPlaintextSecrets, true);
  assert.equal(p.requireSandboxWorkspace, false);
  assert.equal(p.scannerFailurePolicy, "warn");
  assert.equal(p.hardGatesDefault, false);
});

// ── Cross-field invariants (validated at module load) ────────────

test("public-sector packs MUST have allowLocalExecutor=false", () => {
  for (const p of reg.PACKS) {
    if (p.publicSector) {
      assert.equal(p.allowLocalExecutor, false, `${p.modeId}`);
      assert.equal(p.allowPlaintextSecrets, false, `${p.modeId}`);
      assert.equal(p.requireSandboxWorkspace, true, `${p.modeId}`);
    }
  }
});

// ── listPacks / listPackSummaries ────────────────────────────────

test("listPacks: exposes PACKS array", () => {
  assert.equal(reg.listPacks(), reg.PACKS);
});

test("listPackSummaries: strips internal rule fields", () => {
  const summaries = reg.listPackSummaries();
  assert.equal(summaries.length, 5);
  for (const s of summaries) {
    assert.ok(typeof s.modeId === "string");
    assert.ok(typeof s.label === "string");
    assert.ok(typeof s.description === "string");
    assert.equal(s.publicSector, undefined);
    assert.equal(s.allowLocalExecutor, undefined);
    assert.equal(s.scannerFailurePolicy, undefined);
    assert.equal(s.hardGatesDefault, undefined);
  }
});

// ── GOV-* compatibility ─────────────────────────────────────────

test("GOV compatibility: public-sector packs have requirePiiScan=true → GOV-PII-0 fail-closed posture", () => {
  for (const p of reg.PACKS) {
    if (p.publicSector) {
      assert.equal(p.requirePiiScanBeforeProviderDispatch, true,
        `${p.modeId} must be GOV-PII-0 fail-closed`);
      assert.equal(p.scannerFailurePolicy, "block",
        `${p.modeId} must use scanner block on failure`);
    }
  }
});

test("GOV compatibility: public-sector packs have requireSignedManifest=true → GOV-RELEASE-0", () => {
  // public-sector pack itself
  assert.equal(reg.getPack("public-sector").requireSignedManifest, true);
  // finance-high-privacy is stricter
  assert.equal(reg.getPack("finance-high-privacy").requireSignedManifest, true);
  // offline-internal-network deliberately OFF (no internet → no key infra)
  assert.equal(reg.getPack("offline-internal-network").requireSignedManifest, false);
});

test("GOV compatibility: hardGatesDefault implies stricter dispatcher behavior", () => {
  // Only finance-high-privacy ships hard gates ON by default; others
  // require operator opt-in.
  const hardGatePacks = reg.PACKS.filter((p) => p.hardGatesDefault === true);
  assert.equal(hardGatePacks.length, 1);
  assert.equal(hardGatePacks[0].modeId, "finance-high-privacy");
});

// ── Authoring-mistake guards (would fire at module load) ────────

test("authoring guard: validation runs at module-load time (the registry survives load)", () => {
  // If the registry author mistakenly set publicSector=true with
  // allowLocalExecutor=true, the require() would throw. Loading
  // here at the top of the test file would have already caught
  // it. This test is just an anchor proving "no current pack
  // violates the cross-field invariants".
  assert.ok(reg.PACKS.length > 0);
});
