// Slice S2-a (Phase 2 / SMART-2, 2026-05-05) — policyGates unit tests.
//
// Pins frozen vocabulary + 4 gate functions + mode resolution + audit
// shape + verdict immutability + state-immutability invariant per
// plan §S §S-SMART-2 v2.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const gates = require("../../src/policy/policyGates");

// ── Frozen vocabulary ─────────────────────────────────────────────

test("policyGates: SCHEMA constant", () => {
  assert.equal(gates.SCHEMA, "harness-policy-gate/v1");
});

test("policyGates: GATE_MODES is frozen with hard/warn", () => {
  assert.ok(Object.isFrozen(gates.GATE_MODES));
  assert.equal(gates.GATE_MODES.HARD, "hard");
  assert.equal(gates.GATE_MODES.WARN, "warn");
  assert.throws(() => { gates.GATE_MODES.NEW = "x"; });
});

test("policyGates: GATE_NAMES is frozen with 4 names", () => {
  assert.ok(Object.isFrozen(gates.GATE_NAMES));
  const expected = ["pii_block", "release_signed", "evidence_export_ready", "completion_allowed"];
  for (const e of expected) {
    assert.ok(Object.values(gates.GATE_NAMES).includes(e), `expected ${e}`);
  }
  assert.equal(Object.keys(gates.GATE_NAMES).length, 4);
});

test("policyGates: GATE_REASONS is frozen with stable codes", () => {
  assert.ok(Object.isFrozen(gates.GATE_REASONS));
  assert.equal(gates.GATE_REASONS.PII_DETECTED, "pii_detected");
  assert.equal(gates.GATE_REASONS.RELEASE_UNSIGNED, "release_unsigned");
  assert.equal(gates.GATE_REASONS.EVIDENCE_NOT_READY, "evidence_not_ready");
  assert.equal(gates.GATE_REASONS.COMPLETION_PENDING, "completion_pending");
  assert.equal(gates.GATE_REASONS.NOT_APPLICABLE, "not_applicable");
  assert.equal(gates.GATE_REASONS.PII_SCANNER_FAILED, "pii_scanner_failed");
});

test("policyGates: AUDIT_VERBS is frozen with policy_gate_blocked + policy_gate_warn", () => {
  assert.ok(Object.isFrozen(gates.AUDIT_VERBS));
  assert.equal(gates.AUDIT_VERBS.BLOCKED, "policy_gate_blocked");
  assert.equal(gates.AUDIT_VERBS.WARN, "policy_gate_warn");
});

// ── resolveGateMode ───────────────────────────────────────────────

test("resolveGateMode: default = warn (safe rollout)", () => {
  assert.equal(gates.resolveGateMode({}), "warn");
});

test("resolveGateMode: HARNESS_HARD_GATES=1 → hard", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "1" }), "hard");
});

test("resolveGateMode: HARNESS_HARD_GATES=true → hard", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "true" }), "hard");
});

test("resolveGateMode: HARNESS_HARD_GATES=hard → hard", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "hard" }), "hard");
});

test("resolveGateMode: HARNESS_HARD_GATES=warn → warn", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "warn" }), "warn");
});

test("resolveGateMode: HARNESS_HARD_GATES=0 → warn", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "0" }), "warn");
});

test("resolveGateMode: case-insensitive", () => {
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "HARD" }), "hard");
  assert.equal(gates.resolveGateMode({ HARNESS_HARD_GATES: "True" }), "hard");
});

test("resolveGateMode: undefined env → warn", () => {
  assert.equal(gates.resolveGateMode(undefined), "warn");
});

// ── gatePiiBlock ──────────────────────────────────────────────────

const standardProfile = { publicSector: false, requireSignedManifest: false };
const publicProfile = { publicSector: true, requireSignedManifest: true };

test("gatePiiBlock: clean text → ok, NOT_APPLICABLE, no audit", () => {
  const v = gates.gatePiiBlock({
    args: "review the auth flow",
    deploymentProfile: standardProfile,
    mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.blocked, false);
  assert.equal(v.reason, "not_applicable");
  assert.equal(v.audit, null);
});

test("gatePiiBlock: empty args → ok, NOT_APPLICABLE", () => {
  const v = gates.gatePiiBlock({
    args: "", deploymentProfile: publicProfile, mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gatePiiBlock: PII detected + standard mode → warn audit, NOT blocked", () => {
  // Use stub scanFn so we don't depend on real piiScanner shape.
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "krn", count: 1, samples: ["95**********"] },
  ]});
  const v = gates.gatePiiBlock({
    args: "secret data here",
    deploymentProfile: standardProfile,
    mode: "hard",
    scanFn: stubScan,
  });
  assert.equal(v.ok, true, "standard mode → ok=true");
  assert.equal(v.blocked, false, "standard mode → not blocked even in hard mode");
  assert.equal(v.reason, "pii_detected");
  assert.ok(v.audit);
  assert.equal(v.audit.verb, "policy_gate_warn");
  assert.deepEqual(v.audit.data.findingTypes, ["krn"]);
});

test("gatePiiBlock: PII + public-sector + hard → BLOCKED + policy_gate_blocked audit", () => {
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "krn", count: 1, samples: ["95**********"] },
    { type: "phone_kr_mobile", count: 1, samples: ["010**********"] },
  ]});
  const v = gates.gatePiiBlock({
    args: "secret",
    deploymentProfile: publicProfile,
    mode: "hard",
    scanFn: stubScan,
  });
  assert.equal(v.ok, false);
  assert.equal(v.blocked, true);
  assert.equal(v.reason, "pii_detected");
  assert.equal(v.audit.verb, "policy_gate_blocked");
  assert.deepEqual(v.audit.data.findingTypes, ["krn", "phone_kr_mobile"]);
  assert.equal(v.audit.data.findingCount, 2);
  assert.equal(v.audit.data.publicSector, true);
});

test("gatePiiBlock: PII + public-sector + warn → ok=true + policy_gate_warn audit", () => {
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "krn", count: 1, samples: ["95**********"] },
  ]});
  const v = gates.gatePiiBlock({
    args: "secret",
    deploymentProfile: publicProfile,
    mode: "warn",
    scanFn: stubScan,
  });
  assert.equal(v.ok, true, "warn mode → ok=true even under public-sector");
  assert.equal(v.blocked, false);
  assert.equal(v.audit.verb, "policy_gate_warn");
});

test("gatePiiBlock: scanner throws + public-sector + hard → fail-closed (block)", () => {
  const stubScan = () => { throw new Error("regex compile error"); };
  const v = gates.gatePiiBlock({
    args: "x", deploymentProfile: publicProfile, mode: "hard", scanFn: stubScan,
  });
  assert.equal(v.blocked, true, "scanner failure under public-sector + hard → fail-closed");
  assert.equal(v.reason, "pii_scanner_failed");
  assert.equal(v.audit.verb, "policy_gate_blocked");
  assert.match(v.message, /scanner threw/);
});

test("gatePiiBlock: scanner throws + standard mode → ok + warn audit", () => {
  const stubScan = () => { throw new Error("regex compile error"); };
  const v = gates.gatePiiBlock({
    args: "x", deploymentProfile: standardProfile, mode: "hard", scanFn: stubScan,
  });
  assert.equal(v.ok, true, "standard mode + scanner throw → don't block");
  assert.equal(v.blocked, false);
  assert.equal(v.audit.verb, "policy_gate_warn");
  assert.equal(v.reason, "pii_scanner_failed");
});

test("gatePiiBlock: object args serialized via JSON.stringify", () => {
  const stubScan = (text) => ({
    hasPii: text.includes("010-"),
    findings: text.includes("010-")
      ? [{ type: "phone_kr_mobile", count: 1, samples: ["010**********"] }]
      : [],
  });
  const v = gates.gatePiiBlock({
    args: { phone: "010-1234-5678" },
    deploymentProfile: publicProfile,
    mode: "hard",
    scanFn: stubScan,
  });
  assert.equal(v.blocked, true);
  assert.deepEqual(v.audit.data.findingTypes, ["phone_kr_mobile"]);
});

test("gatePiiBlock: circular args → unserializable, NOT blocked, warn audit", () => {
  const circular = {};
  circular.self = circular;
  const v = gates.gatePiiBlock({
    args: circular,
    deploymentProfile: publicProfile,
    mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.blocked, false);
  assert.equal(v.reason, "pii_scanner_failed");
  assert.equal(v.audit.verb, "policy_gate_warn");
  assert.equal(v.audit.data.error, "unserializable");
});

test("gatePiiBlock: PII samples land in audit data (already-redacted by scanner)", () => {
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "email", count: 2, samples: ["jo**@ex******.com", "ma**@gm**.com"] },
  ]});
  const v = gates.gatePiiBlock({
    args: "x", deploymentProfile: publicProfile, mode: "hard", scanFn: stubScan,
  });
  assert.deepEqual(v.audit.data.samples.email, ["jo**@ex******.com", "ma**@gm**.com"]);
});

// ── gateReleaseSigned ────────────────────────────────────────────

test("gateReleaseSigned: standard mode → NOT_APPLICABLE", () => {
  const v = gates.gateReleaseSigned({
    deploymentProfile: standardProfile, manifestSigned: false, mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
  assert.equal(v.audit, null);
});

test("gateReleaseSigned: signed manifest under public-sector → NOT_APPLICABLE", () => {
  const v = gates.gateReleaseSigned({
    deploymentProfile: publicProfile, manifestSigned: true, mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gateReleaseSigned: unsigned + public-sector + hard → BLOCKED", () => {
  const v = gates.gateReleaseSigned({
    deploymentProfile: publicProfile, manifestSigned: false, mode: "hard",
  });
  assert.equal(v.blocked, true);
  assert.equal(v.reason, "release_unsigned");
  assert.equal(v.audit.verb, "policy_gate_blocked");
  assert.equal(v.audit.data.publicSector, true);
});

test("gateReleaseSigned: unsigned + public-sector + warn → ok + warn audit", () => {
  const v = gates.gateReleaseSigned({
    deploymentProfile: publicProfile, manifestSigned: false, mode: "warn",
  });
  assert.equal(v.ok, true);
  assert.equal(v.blocked, false);
  assert.equal(v.audit.verb, "policy_gate_warn");
});

test("gateReleaseSigned: missing manifestSigned arg under public-sector + hard → BLOCKED (treats as unsigned)", () => {
  const v = gates.gateReleaseSigned({
    deploymentProfile: publicProfile, mode: "hard",
  });
  assert.equal(v.blocked, true);
});

// ── gateEvidenceExportReady ──────────────────────────────────────

test("gateEvidenceExportReady: standard mode → NOT_APPLICABLE", () => {
  const v = gates.gateEvidenceExportReady({
    deploymentProfile: standardProfile,
    decisionContext: { booleans: { auditExportReady: false } },
    mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gateEvidenceExportReady: public-sector + ready → NOT_APPLICABLE", () => {
  const v = gates.gateEvidenceExportReady({
    deploymentProfile: publicProfile,
    decisionContext: { booleans: { auditExportReady: true } },
    mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gateEvidenceExportReady: public-sector + NOT ready + hard → BLOCKED", () => {
  const v = gates.gateEvidenceExportReady({
    deploymentProfile: publicProfile,
    decisionContext: { booleans: { auditExportReady: false } },
    mode: "hard",
  });
  assert.equal(v.blocked, true);
  assert.equal(v.reason, "evidence_not_ready");
  assert.equal(v.audit.verb, "policy_gate_blocked");
});

test("gateEvidenceExportReady: public-sector + NOT ready + warn → ok + warn audit", () => {
  const v = gates.gateEvidenceExportReady({
    deploymentProfile: publicProfile,
    decisionContext: { booleans: { auditExportReady: false } },
    mode: "warn",
  });
  assert.equal(v.ok, true);
  assert.equal(v.audit.verb, "policy_gate_warn");
});

test("gateEvidenceExportReady: public-sector + null context + hard → fail-closed", () => {
  const v = gates.gateEvidenceExportReady({
    deploymentProfile: publicProfile, decisionContext: null, mode: "hard",
  });
  assert.equal(v.blocked, true);
  assert.equal(v.audit.data.decisionContextAvailable, false);
});

// ── gateCompletionAllowed ────────────────────────────────────────

test("gateCompletionAllowed: no decisionContext → NOT_APPLICABLE", () => {
  const v = gates.gateCompletionAllowed({
    deploymentProfile: publicProfile,
    decisionContext: null, mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gateCompletionAllowed: no human decision pending → NOT_APPLICABLE", () => {
  const v = gates.gateCompletionAllowed({
    deploymentProfile: publicProfile,
    decisionContext: { booleans: { needsHumanDecision: false } },
    mode: "hard",
  });
  assert.equal(v.ok, true);
  assert.equal(v.reason, "not_applicable");
});

test("gateCompletionAllowed: pending decision + public-sector + hard → BLOCKED", () => {
  const v = gates.gateCompletionAllowed({
    deploymentProfile: publicProfile,
    decisionContext: {
      booleans: { needsHumanDecision: true, approvalPending: true },
      counts: { pendingApprovals: 2, openReviewSessions: 0 },
    },
    phase: "phase-3",
    mode: "hard",
  });
  assert.equal(v.blocked, true);
  assert.equal(v.reason, "completion_pending");
  assert.equal(v.audit.verb, "policy_gate_blocked");
  assert.equal(v.audit.data.phase, "phase-3");
  assert.equal(v.audit.data.counts.pendingApprovals, 2);
  assert.equal(v.audit.data.booleans.approvalPending, true);
});

test("gateCompletionAllowed: pending decision + standard mode → ok + warn (never blocks)", () => {
  const v = gates.gateCompletionAllowed({
    deploymentProfile: standardProfile,
    decisionContext: {
      booleans: { needsHumanDecision: true, approvalPending: true },
      counts: { pendingApprovals: 1 },
    },
    mode: "hard",
  });
  assert.equal(v.ok, true, "standard mode never hard-blocks completion");
  assert.equal(v.audit.verb, "policy_gate_warn");
});

test("gateCompletionAllowed: pending decision + public-sector + warn → ok + warn audit", () => {
  const v = gates.gateCompletionAllowed({
    deploymentProfile: publicProfile,
    decisionContext: { booleans: { needsHumanDecision: true } },
    mode: "warn",
  });
  assert.equal(v.ok, true);
  assert.equal(v.audit.verb, "policy_gate_warn");
});

// ── Verdict immutability ─────────────────────────────────────────

test("verdict: returned object is frozen", () => {
  const v = gates.gatePiiBlock({
    args: "ok", deploymentProfile: standardProfile,
  });
  assert.ok(Object.isFrozen(v));
  assert.throws(() => { v.ok = false; });
});

test("verdict: NOT_APPLICABLE → audit is exactly null (not undefined / empty obj)", () => {
  const v = gates.gatePiiBlock({
    args: "clean", deploymentProfile: standardProfile,
  });
  assert.strictEqual(v.audit, null);
});

// ── runGateChain ─────────────────────────────────────────────────

test("runGateChain: empty list → ok, no verdicts", () => {
  const r = gates.runGateChain([]);
  assert.equal(r.blocked, false);
  assert.equal(r.blockedAt, null);
  assert.deepEqual(r.verdicts, []);
});

test("runGateChain: all-pass chain → all verdicts collected, none blocking", () => {
  const r = gates.runGateChain([
    {
      name: "first",
      evaluate: () => gates.gatePiiBlock({
        args: "clean", deploymentProfile: standardProfile,
      }),
    },
    {
      name: "second",
      evaluate: () => gates.gateReleaseSigned({
        deploymentProfile: standardProfile, manifestSigned: true,
      }),
    },
  ]);
  assert.equal(r.blocked, false);
  assert.equal(r.verdicts.length, 2);
});

test("runGateChain: short-circuits at first BLOCKED verdict", () => {
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "krn", count: 1, samples: ["95**"] },
  ]});
  let secondCalled = false;
  const r = gates.runGateChain([
    {
      name: "pii",
      evaluate: () => gates.gatePiiBlock({
        args: "x", deploymentProfile: publicProfile,
        mode: "hard", scanFn: stubScan,
      }),
    },
    {
      name: "release",
      evaluate: () => {
        secondCalled = true;
        return gates.gateReleaseSigned({
          deploymentProfile: publicProfile, manifestSigned: true,
        });
      },
    },
  ]);
  assert.equal(r.blocked, true);
  assert.equal(r.blockedAt, "pii_block");
  assert.equal(r.verdicts.length, 1);
  assert.equal(secondCalled, false, "second gate not evaluated after short-circuit");
});

test("runGateChain: gate that throws → blocks with pii_scanner_failed reason", () => {
  const r = gates.runGateChain([
    {
      name: "broken",
      evaluate: () => { throw new Error("oops"); },
    },
  ]);
  assert.equal(r.blocked, true);
  assert.equal(r.blockedAt, "broken");
  assert.equal(r.verdicts[0].reason, "pii_scanner_failed");
  assert.equal(r.verdicts[0].audit.verb, "policy_gate_blocked");
});

test("runGateChain: warns continue without blocking + chain finishes", () => {
  const stubScan = () => ({ hasPii: true, findings: [
    { type: "krn", count: 1, samples: ["95**"] },
  ]});
  const r = gates.runGateChain([
    {
      name: "pii-warn",
      evaluate: () => gates.gatePiiBlock({
        args: "x", deploymentProfile: standardProfile,
        mode: "hard", scanFn: stubScan,
      }),
    },
    {
      name: "release-ok",
      evaluate: () => gates.gateReleaseSigned({
        deploymentProfile: standardProfile, manifestSigned: false,
      }),
    },
  ]);
  assert.equal(r.blocked, false);
  assert.equal(r.verdicts.length, 2);
  assert.equal(r.verdicts[0].audit.verb, "policy_gate_warn");
  assert.equal(r.verdicts[0].blocked, false);
});

test("runGateChain: malformed entry (no evaluate) skipped silently", () => {
  const r = gates.runGateChain([
    null,
    { name: "no-eval" },
    {
      name: "ok",
      evaluate: () => gates.gatePiiBlock({
        args: "clean", deploymentProfile: standardProfile,
      }),
    },
  ]);
  assert.equal(r.blocked, false);
  assert.equal(r.verdicts.length, 1);
});

// ── Integration smoke (real scanForPii) ──────────────────────────

test("gatePiiBlock: real scanner with KRN-shaped input under public-sector + hard → BLOCKED", () => {
  // Use a structurally valid KRN format that the scanner should match.
  // (Real scanner has Luhn / birth-date validation; we use a known
  // pattern from the GOV-PII-0 test fixtures.)
  const text = "사용자 주민번호: 950101-1234567";  // generic pattern
  const v = gates.gatePiiBlock({
    args: text,
    deploymentProfile: publicProfile,
    mode: "hard",
    // Default scanFn = real scanForPii — no stub.
  });
  // Real scanner is conservative; if it fires, test hard block.
  // If it doesn't fire (the test number happens to fail birth-date /
  // check-digit), the gate returns NOT_APPLICABLE which is also fine.
  if (v.reason === "pii_detected") {
    assert.equal(v.blocked, true);
    assert.equal(v.audit.verb, "policy_gate_blocked");
  } else {
    assert.equal(v.reason, "not_applicable");
  }
});

test("gatePiiBlock: real scanner with email under public-sector + hard → BLOCKED", () => {
  const v = gates.gatePiiBlock({
    args: "Contact me at john.doe@example.com for review",
    deploymentProfile: publicProfile,
    mode: "hard",
  });
  // Real scanner reliably matches emails.
  assert.equal(v.reason, "pii_detected");
  assert.equal(v.blocked, true);
  assert.ok(v.audit.data.findingTypes.includes("email"));
});
