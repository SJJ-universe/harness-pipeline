// tests/unit/piiGate.test.js — Slice GOV-PII-0 (Phase E1.5, 2026-04-29)
//
// Verifies the deployment-posture-aware enforcement layer that
// turns a piiScanner result into a verdict the runner can act on.
//
// Tested in priority order:
//
//   1. Public-sector posture: hasPii → blocked verdict + audit verb
//      pii_scan_blocked + reason pii_detected.
//   2. Standard posture: hasPii → ok=true verdict + audit verb
//      pii_scan_warn (proceed but emit observability row).
//   3. No PII: ok=true, no audit verb (do not pollute audit chain).
//   4. Audit data shape: source carried, findingTypes listed,
//      samples already redacted (NOT raw).
//   5. Defensive defaults: missing deploymentProfile → standard
//      posture (warn-only).
//   6. AUDIT_VERBS export is stable + frozen.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  enforcePiiGate,
  AUDIT_VERBS,
  REASON_PII_DETECTED,
} = require("../../src/security/piiGate");

const KRN_VALID = "900101-1234568"; // see piiScanner.test.js for derivation

function publicSectorProfile() {
  return {
    mode: "public-sector",
    publicSector: true,
    requirePiiScanBeforeProviderDispatch: true,
    scannerFailurePolicy: "block",
  };
}

function standardProfile() {
  return {
    mode: "standard",
    publicSector: false,
    requirePiiScanBeforeProviderDispatch: false,
    scannerFailurePolicy: "warn",
  };
}

// ─────────────────────────────────────────────────────────────────
//  Public-sector — block path
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: public-sector + KRN in prompt → blocked verdict", () => {
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: publicSectorProfile(),
    source: "claude_prompt",
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.reason, REASON_PII_DETECTED);
  assert.equal(verdict.auditVerb, AUDIT_VERBS.BLOCKED);
  assert.equal(verdict.auditVerb, "pii_scan_blocked");
});

test("GOV-PII-0: public-sector + email in prompt → blocked", () => {
  const verdict = enforcePiiGate("contact: alice@example.com", {
    deploymentProfile: publicSectorProfile(),
  });
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.auditData.findingTypes.includes("email"));
});

test("GOV-PII-0: public-sector + Korean mobile → blocked", () => {
  const verdict = enforcePiiGate("연락처: 010-1234-5678", {
    deploymentProfile: publicSectorProfile(),
  });
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.auditData.findingTypes.includes("phone_kr_mobile"));
});

test("GOV-PII-0: public-sector + no PII → ok, no audit", () => {
  const verdict = enforcePiiGate("Just a normal prompt with no PII.", {
    deploymentProfile: publicSectorProfile(),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.auditVerb, null,
    "no audit row when nothing detected — keeps audit chain clean");
});

// ─────────────────────────────────────────────────────────────────
//  Standard — warn path
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: standard + KRN in prompt → ok=true + warn audit", () => {
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: standardProfile(),
  });
  assert.equal(verdict.ok, true,
    "standard mode never blocks — observability without enforcement");
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.auditVerb, AUDIT_VERBS.WARN);
  assert.equal(verdict.auditVerb, "pii_scan_warn");
});

test("GOV-PII-0: standard + no PII → ok, no audit", () => {
  const verdict = enforcePiiGate("clean prompt", {
    deploymentProfile: standardProfile(),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.auditVerb, null);
});

// ─────────────────────────────────────────────────────────────────
//  Audit data shape
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: audit data carries source label", () => {
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: publicSectorProfile(),
    source: "codex_prompt",
  });
  assert.equal(verdict.auditData.source, "codex_prompt");
});

test("GOV-PII-0: audit data defaults source to 'prompt' when omitted", () => {
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: publicSectorProfile(),
  });
  assert.equal(verdict.auditData.source, "prompt");
});

test("GOV-PII-0: audit data lists findingTypes (NOT counts in the type field)", () => {
  const txt = `KRN: ${KRN_VALID}\nphone: 010-1234-5678\nemail: a@b.com`;
  const verdict = enforcePiiGate(txt, {
    deploymentProfile: publicSectorProfile(),
  });
  assert.ok(Array.isArray(verdict.auditData.findingTypes));
  assert.deepEqual(
    [...verdict.auditData.findingTypes].sort(),
    ["email", "krn", "phone_kr_mobile"].sort(),
  );
  assert.equal(verdict.auditData.findingCount, 3,
    "findingCount is the number of TYPES, not total occurrences");
});

test("GOV-PII-0: audit data samples are ALREADY redacted (NOT raw)", () => {
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: publicSectorProfile(),
  });
  const krnSamples = verdict.auditData.samples.krn;
  assert.ok(Array.isArray(krnSamples));
  for (const s of krnSamples) {
    assert.ok(!s.includes("12345"),
      `audit sample "${s}" must not contain raw digits from KRN`);
    assert.ok(s.includes("*"),
      "samples must be in the asterisked-redaction format from piiScanner");
  }
});

test("GOV-PII-0: audit data does NOT contain the original input text", () => {
  const verdict = enforcePiiGate(`SECRET-PROMPT KRN ${KRN_VALID}`, {
    deploymentProfile: publicSectorProfile(),
  });
  const auditJson = JSON.stringify(verdict.auditData);
  assert.ok(!auditJson.includes("SECRET-PROMPT"),
    "the audit data must NOT echo the operator's prompt");
  assert.ok(!auditJson.includes(KRN_VALID),
    "the audit data must NOT contain the raw PII");
});

// ─────────────────────────────────────────────────────────────────
//  Defensive defaults
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: missing deploymentProfile → defaults to warn (standard posture)", () => {
  // A caller without policy context must NOT accidentally block —
  // standard posture is the safe default.
  const verdict = enforcePiiGate(`KRN: ${KRN_VALID}`, {});
  assert.equal(verdict.ok, true);
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.auditVerb, AUDIT_VERBS.WARN);
});

test("GOV-PII-0: empty input → no PII, no audit", () => {
  const verdict = enforcePiiGate("", {
    deploymentProfile: publicSectorProfile(),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.auditVerb, null);
});

test("GOV-PII-0: only one of (requirePiiScan, scannerFailurePolicy) → still blocks (fail-closed)", () => {
  // Hand-injected mix: just requirePiiScanBeforeProviderDispatch=true.
  const verdict1 = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: { requirePiiScanBeforeProviderDispatch: true },
  });
  assert.equal(verdict1.blocked, true,
    "either signal alone must block — fail-closed");

  // Just scannerFailurePolicy="block".
  const verdict2 = enforcePiiGate(`KRN: ${KRN_VALID}`, {
    deploymentProfile: { scannerFailurePolicy: "block" },
  });
  assert.equal(verdict2.blocked, true);
});

// ─────────────────────────────────────────────────────────────────
//  Exports
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: AUDIT_VERBS is frozen + has both verbs", () => {
  assert.ok(Object.isFrozen(AUDIT_VERBS));
  assert.equal(AUDIT_VERBS.BLOCKED, "pii_scan_blocked");
  assert.equal(AUDIT_VERBS.WARN, "pii_scan_warn");
});

test("GOV-PII-0: REASON_PII_DETECTED is the stable string the runner surfaces", () => {
  assert.equal(REASON_PII_DETECTED, "pii_detected");
});
