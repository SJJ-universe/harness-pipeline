// tests/unit/publicSectorPolicy.test.js — Slice D1-gov-2 (Phase E1, 2026-04-29)
//
// Verifies the public-sector profile validator + spawn-time
// assertion. Tests are aligned to docs/public-sector-hardening-plan.md
// §4 acceptance gates GOV-G02, GOV-G03, GOV-G04.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  validateProfileForPublicSector,
  assertLocalExecutorAllowed,
  buildPolicyErrorResponse,
  PLAINTEXT_BACKENDS,
  REQUIRED_ACCOUNT_TYPE,
  REQUIRED_WORKSPACE_MODE,
} = require("../../src/policy/publicSectorPolicy");

function validProfile(overrides = {}) {
  return {
    accountType: "agency_managed",
    workspaceMode: "sandbox",
    credentialBackend: "wincred",
    dataClassification: "internal",
    egressPolicyId: "agency-llm-egress",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
//  validateProfileForPublicSector
// ─────────────────────────────────────────────────────────────────

test("D1-gov-2: a fully-valid public-sector profile passes", () => {
  const result = validateProfileForPublicSector(validProfile());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test("D1-gov-2 GOV-G02: rejects accountType=personal", () => {
  const result = validateProfileForPublicSector(validProfile({ accountType: "personal" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /personal/);
});

test("D1-gov-2 GOV-G02: rejects accountType=client (only agency_managed allowed)", () => {
  const result = validateProfileForPublicSector(validProfile({ accountType: "client" }));
  assert.equal(result.ok, false);
});

test("D1-gov-2 GOV-G04: rejects workspaceMode=local", () => {
  const result = validateProfileForPublicSector(validProfile({ workspaceMode: "local" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /sandbox/);
});

test("D1-gov-2 GOV-G03: rejects plaintext credential backend", () => {
  for (const backend of ["plaintext", "plaintext_dev_only"]) {
    const result = validateProfileForPublicSector(validProfile({ credentialBackend: backend }));
    assert.equal(result.ok, false, `must reject "${backend}"`);
    assert.match(result.errors.join("\n"), /plaintext/);
  }
});

test("D1-gov-2: rejects missing egressPolicyId", () => {
  const result = validateProfileForPublicSector(validProfile({ egressPolicyId: "" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /egressPolicyId/);
});

test("D1-gov-2: rejects missing dataClassification", () => {
  const result = validateProfileForPublicSector(validProfile({ dataClassification: "" }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /dataClassification/);
});

test("D1-gov-2: collects ALL violations in one pass (operator-friendly)", () => {
  // Operators fixing public-sector profiles need to see every
  // problem in one round-trip, not iterate.
  const result = validateProfileForPublicSector({
    accountType: "personal",
    workspaceMode: "local",
    credentialBackend: "plaintext",
    // egressPolicyId + dataClassification both missing.
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 5,
    `expected 5 violations, got ${result.errors.length}: ${result.errors.join(" | ")}`);
});

test("D1-gov-2: handles a non-object profile defensively", () => {
  for (const bad of [null, undefined, 42, "not-an-object", []]) {
    const result = validateProfileForPublicSector(bad);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /must be an object/);
  }
});

// ─────────────────────────────────────────────────────────────────
//  assertLocalExecutorAllowed
// ─────────────────────────────────────────────────────────────────

test("D1-gov-2: assertLocalExecutorAllowed allows when allowLocalExecutor=true", () => {
  // Standard mode: pass through silently.
  assertLocalExecutorAllowed({ mode: "standard", allowLocalExecutor: true });
});

test("D1-gov-2: assertLocalExecutorAllowed throws with code when forbidden", () => {
  try {
    assertLocalExecutorAllowed({ mode: "public-sector", allowLocalExecutor: false });
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /local executor disabled/);
    assert.equal(err.code, "PUBLIC_SECTOR_LOCAL_EXECUTOR_DISABLED",
      "code must be machine-checkable so the runner can map to the right HTTP status");
  }
});

test("D1-gov-2: assertLocalExecutorAllowed is defensive on missing arg", () => {
  // A nil deploymentProfile is itself a misconfiguration, but the
  // assertion should not crash the orchestrator at boot. Default to
  // "standard" interpretation.
  assertLocalExecutorAllowed(undefined); // no throw
  assertLocalExecutorAllowed(null);      // no throw
});

// ─────────────────────────────────────────────────────────────────
//  buildPolicyErrorResponse
// ─────────────────────────────────────────────────────────────────

test("D1-gov-2: buildPolicyErrorResponse returns null on valid profile", () => {
  assert.equal(buildPolicyErrorResponse(validProfile()), null);
});

test("D1-gov-2: buildPolicyErrorResponse returns route-friendly shape on bad profile", () => {
  const out = buildPolicyErrorResponse(validProfile({ accountType: "personal" }));
  assert.equal(out.error, "public_sector_profile_policy");
  assert.ok(Array.isArray(out.details));
  assert.ok(out.details.length > 0);
});

// ─────────────────────────────────────────────────────────────────
//  EXPORTED CONSTANTS
// ─────────────────────────────────────────────────────────────────

test("D1-gov-2: exported constants match the policy spec", () => {
  // Lock the wire format. Anything depending on these (route
  // schemas, audit verbs, docs) needs the constants to stay stable.
  assert.equal(REQUIRED_ACCOUNT_TYPE, "agency_managed");
  assert.equal(REQUIRED_WORKSPACE_MODE, "sandbox");
  assert.ok(PLAINTEXT_BACKENDS.has("plaintext"));
  assert.ok(PLAINTEXT_BACKENDS.has("plaintext_dev_only"));
  assert.ok(Object.isFrozen(PLAINTEXT_BACKENDS),
    "PLAINTEXT_BACKENDS must be frozen so a future caller can't add a backend");
});
