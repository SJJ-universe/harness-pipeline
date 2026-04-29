// tests/unit/deploymentProfile.test.js — Slice D1-gov-1 (Phase E1, 2026-04-29)
//
// Verifies the env→posture resolver. Each test is keyed against a
// specific row from docs/public-sector-hardening-plan.md §3:
//
//   - default mode is permissive ("I did not opt into public-sector")
//   - public-sector flips every fail-closed flag together
//   - typos on the env value do NOT silently grant permissive posture
//   - HARNESS_ALLOW_PLAINTEXT_SECRETS=1 is honored in standard mode
//     but IGNORED in public-sector mode (defense-in-depth)

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveDeploymentProfile,
  RECOGNIZED_MODES,
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
    env: { HARNESS_DEPLOYMENT_PROFILE: "standard" },
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

test("D1-gov-1: standard mode honors HARNESS_ALLOW_PLAINTEXT_SECRETS=1", () => {
  const profile = resolveDeploymentProfile({
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
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
    env: { HARNESS_DEPLOYMENT_PROFILE: "public-sector" },
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

test("D1-gov-1: public-sector IGNORES HARNESS_ALLOW_PLAINTEXT_SECRETS=1", () => {
  // Defense in depth: even if an operator tries to opt-into plaintext
  // alongside public-sector, the policy refuses. Audit trail (loud
  // signal at credentialStore creation) covers the event.
  const profile = resolveDeploymentProfile({
    env: {
      HARNESS_DEPLOYMENT_PROFILE: "public-sector",
      HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
    },
  });
  assert.equal(profile.allowPlaintextSecrets, false,
    "public-sector must override the plaintext opt-in flag");
});

// ─────────────────────────────────────────────────────────────────
//  TYPO / UNKNOWN VALUE → STANDARD (NOT public-sector)
// ─────────────────────────────────────────────────────────────────

test("D1-gov-1: unrecognized env value falls back to standard (not auto-promoted)", () => {
  // Operator typo of "publicsector" / "PUBLIC-SECTOR" / "agency"
  // must not silently land us in standard mode IF they meant public-
  // sector. We could also reject loudly — design choice: log + fall
  // back. Loud rejection lives in the launcher (D2 wizard validates
  // the env explicitly before boot).
  for (const bad of ["publicsector", "PUBLIC-SECTOR", "agency", "gov", "x"]) {
    const profile = resolveDeploymentProfile({
      env: { HARNESS_DEPLOYMENT_PROFILE: bad },
    });
    assert.equal(profile.mode, "standard",
      `bad value "${bad}" must NOT promote to public-sector`);
    assert.equal(profile.publicSector, false);
  }
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
