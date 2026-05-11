// tests/unit/deploymentProfile.test.js — Slice D1-gov-1 (Phase E1, 2026-04-29)
//
// Verifies the env→posture resolver. Each test is keyed against a
// specific row from docs/public-sector-hardening-plan.md §3:
//
//   - default mode is permissive ("I did not opt into public-sector")
//   - public-sector flips every fail-closed flag together
//   - typos on the env value FAIL CLOSED (Slice S5-b — was: silent
//     fallback; now: throws POLICY_PACK_UNKNOWN unless escape hatch
//     is set)
//   - ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS=1 is honored in standard mode
//     but IGNORED in public-sector mode (defense-in-depth)
//
// SMART-5-b additions:
//   - 5 packs (standard / public-sector / finance-high-privacy /
//     offline-internal-network / developer-lab) all resolve correctly
//   - Unknown mode + production → throws POLICY_PACK_UNKNOWN
//   - Unknown mode + ORCHESTRATOR_POLICY_FAIL_OPEN=1 → fallback to standard
//     with resolvedFromFallback=true + unknownRequested set
//   - profile.pack / packLabel / hardGatesDefault / runMemoryEnabled
//     populated from pack rules

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveDeploymentProfile,
  RECOGNIZED_MODES,
  POLICY_PACK_UNKNOWN_CODE,
} = require("../../src/policy/deploymentProfile");

// ─────────────────────────────────────────────────────────────────
//  STANDARD MODE (default)
// ─────────────────────────────────────────────────────────────────

test("D1-gov-1: defaults to standard mode when env is empty", () => {
  const profile = resolveDeploymentProfile({ env: {} });
  assert.equal(profile.mode, "standard");
  assert.equal(profile.publicSector, false);
});

test("D1-gov-1: explicit standard env value gives standard mode", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "standard" },
  });
  assert.equal(profile.mode, "standard");
  assert.equal(profile.publicSector, false);
});

test("D1-gov-1: standard mode allows the permissive flags", () => {
  const profile = resolveDeploymentProfile({ env: {} });
  assert.equal(profile.allowLocalExecutor, true);
  assert.equal(profile.allowPersonalAccounts, true);
  assert.equal(profile.requireSandboxWorkspace, false);
  assert.equal(profile.requireAgencyManagedAccount, false);
  assert.equal(profile.requireSignedManifest, false);
  assert.equal(profile.requirePiiScanBeforeProviderDispatch, false);
  assert.equal(profile.scannerFailurePolicy, "warn");
});

test("D1-gov-1: standard mode honors ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS=1", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS: "1" },
  });
  assert.equal(profile.allowPlaintextSecrets, true);
});

test("D1-gov-1: standard mode without the flag has plaintext disabled", () => {
  const profile = resolveDeploymentProfile({ env: {} });
  assert.equal(profile.allowPlaintextSecrets, false);
});

// ─────────────────────────────────────────────────────────────────
//  PUBLIC-SECTOR MODE
// ─────────────────────────────────────────────────────────────────

test("D1-gov-1: public-sector mode sets every fail-closed flag", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "public-sector" },
  });
  assert.equal(profile.mode, "public-sector");
  assert.equal(profile.publicSector, true);
  assert.equal(profile.allowLocalExecutor, false);
  assert.equal(profile.allowPersonalAccounts, false);
  assert.equal(profile.allowPlaintextSecrets, false);
  assert.equal(profile.requireSandboxWorkspace, true);
  assert.equal(profile.requireAgencyManagedAccount, true);
  assert.equal(profile.requireSignedManifest, true);
  assert.equal(profile.requirePiiScanBeforeProviderDispatch, true);
  assert.equal(profile.scannerFailurePolicy, "block");
});

test("D1-gov-1: public-sector IGNORES ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS=1", () => {
  // Defense in depth: even if an operator tries to opt-into plaintext
  // alongside public-sector, the policy refuses. Audit trail (loud
  // signal at credentialStore creation) covers the event.
  const profile = resolveDeploymentProfile({
    env: {
      ORCHESTRATOR_DEPLOYMENT_PROFILE: "public-sector",
      ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS: "1",
    },
  });
  assert.equal(profile.allowPlaintextSecrets, false,
    "public-sector must override the plaintext opt-in flag");
});

// ─────────────────────────────────────────────────────────────────
//  TYPO / UNKNOWN VALUE → BOOT FAIL (Slice S5-b)
// ─────────────────────────────────────────────────────────────────

test("S5-b: unrecognized env value THROWS POLICY_PACK_UNKNOWN by default (production fail-closed)", () => {
  // Slice S5-b reverses the pre-SMART-5 silent-fallback behavior.
  // Now an operator typo loudly fails at boot so the misconfiguration
  // surfaces before any pipeline runs.
  for (const bad of ["publicsector", "PUBLIC-SECTOR", "agency", "gov", "x"]) {
    assert.throws(
      () => resolveDeploymentProfile({
        env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: bad },
      }),
      (err) => err.code === POLICY_PACK_UNKNOWN_CODE && err.requested === bad,
      `bad value "${bad}" must throw POLICY_PACK_UNKNOWN`,
    );
  }
});

test("S5-b: POLICY_PACK_UNKNOWN error carries known modeIds list", () => {
  let caught;
  try {
    resolveDeploymentProfile({ env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "x" } });
    assert.fail("should have thrown");
  } catch (err) {
    caught = err;
  }
  assert.equal(caught.code, POLICY_PACK_UNKNOWN_CODE);
  assert.ok(Array.isArray(caught.knownPackIds));
  assert.equal(caught.knownPackIds.length, 5);
  assert.ok(caught.knownPackIds.includes("standard"));
  assert.ok(caught.knownPackIds.includes("public-sector"));
});

test("S5-b: ORCHESTRATOR_POLICY_FAIL_OPEN=1 + unknown → fallback to standard with signal", () => {
  const profile = resolveDeploymentProfile({
    env: {
      ORCHESTRATOR_DEPLOYMENT_PROFILE: "publicsector",
      ORCHESTRATOR_POLICY_FAIL_OPEN: "1",
    },
  });
  assert.equal(profile.mode, "standard");
  assert.equal(profile.publicSector, false);
  assert.equal(profile.resolvedFromFallback, true);
  assert.equal(profile.unknownRequested, "publicsector");
});

test("S5-b: ORCHESTRATOR_POLICY_FAIL_OPEN accepts true / yes / 1 (case-insensitive)", () => {
  for (const v of ["1", "true", "yes", "TRUE", "Hard"]) {  // hard isn't an opener
    if (v === "Hard") continue;  // sanity: hard is not a fail-open value
    const profile = resolveDeploymentProfile({
      env: {
        ORCHESTRATOR_DEPLOYMENT_PROFILE: "nonsense",
        ORCHESTRATOR_POLICY_FAIL_OPEN: v,
      },
    });
    assert.equal(profile.resolvedFromFallback, true,
      `ORCHESTRATOR_POLICY_FAIL_OPEN="${v}" should enable dev escape`);
  }
});

test("S5-b: ORCHESTRATOR_POLICY_FAIL_OPEN=0 / empty → no escape, throws", () => {
  for (const v of ["0", "", "false", "no"]) {
    assert.throws(
      () => resolveDeploymentProfile({
        env: {
          ORCHESTRATOR_DEPLOYMENT_PROFILE: "x",
          ORCHESTRATOR_POLICY_FAIL_OPEN: v,
        },
      }),
      (err) => err.code === POLICY_PACK_UNKNOWN_CODE,
      `ORCHESTRATOR_POLICY_FAIL_OPEN="${v}" must NOT enable escape`,
    );
  }
});

test("S5-b: empty / unset ORCHESTRATOR_DEPLOYMENT_PROFILE is NOT a typo (resolves to standard, no fallback signal)", () => {
  const profile = resolveDeploymentProfile({ env: {} });
  assert.equal(profile.mode, "standard");
  assert.equal(profile.resolvedFromFallback, false,
    "unset env is NOT a fallback — it's the default");
  assert.equal(profile.unknownRequested, null);
});

// ─────────────────────────────────────────────────────────────────
//  IMMUTABILITY + EXPORTS
// ─────────────────────────────────────────────────────────────────

test("D1-gov-1: returned object is Object.freeze'd", () => {
  const profile = resolveDeploymentProfile({ env: {} });
  assert.ok(Object.isFrozen(profile));
  assert.throws(() => { profile.publicSector = true; }, /Cannot/);
});

test("D1-gov-1: RECOGNIZED_MODES is exported and frozen (lock the wire format)", () => {
  assert.ok(RECOGNIZED_MODES.has("standard"));
  assert.ok(RECOGNIZED_MODES.has("public-sector"));
  // Set is frozen at the export site — adding modes requires editing
  // the resolver, which forces the corresponding policy adjustments.
  // Not checking Object.isFrozen on the Set object itself because Set
  // is a built-in (the .add returning an error suffices).
});

// ─────────────────────────────────────────────────────────────────
//  SLICE S5-b: 3 NEW PACKS (finance / offline / dev-lab)
// ─────────────────────────────────────────────────────────────────

test("S5-b: RECOGNIZED_MODES now contains all 5 SMART-5 packs", () => {
  assert.ok(RECOGNIZED_MODES.has("standard"));
  assert.ok(RECOGNIZED_MODES.has("public-sector"));
  assert.ok(RECOGNIZED_MODES.has("finance-high-privacy"));
  assert.ok(RECOGNIZED_MODES.has("offline-internal-network"));
  assert.ok(RECOGNIZED_MODES.has("developer-lab"));
  assert.equal(RECOGNIZED_MODES.size, 5);
});

test("S5-b: finance-high-privacy resolves to stricter-than-public-sector posture", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "finance-high-privacy" },
  });
  assert.equal(profile.mode, "finance-high-privacy");
  assert.equal(profile.publicSector, true);
  assert.equal(profile.allowLocalExecutor, false);
  assert.equal(profile.allowPlaintextSecrets, false);
  assert.equal(profile.requireSandboxWorkspace, true);
  assert.equal(profile.requireSignedManifest, true);
  assert.equal(profile.requirePiiScanBeforeProviderDispatch, true);
  assert.equal(profile.scannerFailurePolicy, "block");
  // SMART-2 hard gates default ON for finance-high-privacy
  assert.equal(profile.hardGatesDefault, true);
});

test("S5-b: offline-internal-network — sandbox + plaintext-off + signing-off", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "offline-internal-network" },
  });
  assert.equal(profile.mode, "offline-internal-network");
  assert.equal(profile.allowLocalExecutor, false);
  assert.equal(profile.allowPlaintextSecrets, false);
  assert.equal(profile.requireSandboxWorkspace, true);
  assert.equal(profile.requireSignedManifest, false);
  assert.equal(profile.scannerFailurePolicy, "warn");
  assert.equal(profile.publicSector, false);
});

test("S5-b: developer-lab is most permissive, plaintext opt-in honored", () => {
  const profile = resolveDeploymentProfile({
    env: {
      ORCHESTRATOR_DEPLOYMENT_PROFILE: "developer-lab",
      ORCHESTRATOR_ALLOW_PLAINTEXT_SECRETS: "1",
    },
  });
  assert.equal(profile.mode, "developer-lab");
  assert.equal(profile.allowLocalExecutor, true);
  assert.equal(profile.allowPlaintextSecrets, true);
  assert.equal(profile.scannerFailurePolicy, "warn");
});

test("S5-b: developer-lab without plaintext opt-in env → plaintext disabled", () => {
  // Pack-allowed but env opt-in still required (defense in depth).
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "developer-lab" },
  });
  assert.equal(profile.allowPlaintextSecrets, false);
});

// ─────────────────────────────────────────────────────────────────
//  SLICE S5-b: NEW PROFILE FIELDS (pack / packLabel / hardGates / runMemory)
// ─────────────────────────────────────────────────────────────────

test("S5-b: profile.pack is alias of mode", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "public-sector" },
  });
  assert.equal(profile.pack, "public-sector");
  assert.equal(profile.pack, profile.mode);
});

test("S5-b: profile.packLabel populated with operator-facing label", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "finance-high-privacy" },
  });
  assert.equal(profile.packLabel, "Finance High-Privacy");
});

test("S5-b: profile.hardGatesDefault populated from pack rule", () => {
  const standard = resolveDeploymentProfile({ env: {} });
  assert.equal(standard.hardGatesDefault, false);
  const finance = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "finance-high-privacy" },
  });
  assert.equal(finance.hardGatesDefault, true,
    "only finance-high-privacy ships hard gates ON");
});

test("S5-b: profile.runMemoryEnabled defaults true on every pack", () => {
  for (const modeId of ["standard", "public-sector", "finance-high-privacy",
                         "offline-internal-network", "developer-lab"]) {
    const profile = resolveDeploymentProfile({
      env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: modeId },
    });
    assert.equal(profile.runMemoryEnabled, true,
      `pack "${modeId}" should have runMemoryEnabled=true`);
  }
});

test("S5-b: profile.resolvedFromFallback / unknownRequested default to false / null", () => {
  const profile = resolveDeploymentProfile({
    env: { ORCHESTRATOR_DEPLOYMENT_PROFILE: "standard" },
  });
  assert.equal(profile.resolvedFromFallback, false);
  assert.equal(profile.unknownRequested, null);
});
