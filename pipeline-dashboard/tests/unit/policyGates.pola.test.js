// Slice POL-a (Phase 2 / POLICY-UX-0, 2026-05-05) — resolveGateMode +
// gate-function precedence with deploymentProfile.hardGatesDefault
// runtime wiring.
//
// Pre-POL-a behavior: resolveGateMode(env) consulted ONLY env.
// Pack with hardGatesDefault=true (finance-high-privacy) had no
// effect at runtime — operator had to ALSO set HARNESS_HARD_GATES=1.
//
// Post-POL-a precedence (verified by these tests):
//   1. env HARNESS_HARD_GATES=1/true/hard → "hard" (operator opt-in)
//   2. env HARNESS_HARD_GATES=0/false/warn/no → "warn" (operator override)
//   3. deploymentProfile.hardGatesDefault === true → "hard" (pack rule)
//   4. WARN (safe default)
//
// Backwards-compat pin: 1-arg callers (no deploymentProfile) get
// the same behavior as pre-POL-a — that's what the existing 48
// policyGates.test.js + 13 routes integration tests anchor.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const policyGates = require("../../src/policy/policyGates");

// ── resolveGateMode precedence matrix ──────────────────────────────

test("POL-a resolveGateMode: env=1 + pack default=warn → hard (env wins)", () => {
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "1" },
    { hardGatesDefault: false },
  );
  assert.equal(mode, "hard");
});

test("POL-a resolveGateMode: env=0 + pack default=true → warn (operator override beats pack)", () => {
  // Operator running finance-high-privacy who needs to soften gates
  // during incident triage / migration. HARNESS_HARD_GATES=0 wins
  // over the pack's hardGatesDefault=true.
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "0" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "warn",
    "explicit warn override beats pack default");
});

test("POL-a resolveGateMode: env=warn + pack default=true → warn", () => {
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "warn" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "warn");
});

test("POL-a resolveGateMode: env=false + pack default=true → warn", () => {
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "false" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "warn");
});

test("POL-a resolveGateMode: env=no + pack default=true → warn", () => {
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "no" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "warn");
});

test("POL-a resolveGateMode: env unset + pack default=true → hard (pack-driven)", () => {
  // The headline POL-a behavior change: pre-POL-a this returned
  // "warn"; post-POL-a it returns "hard" because the pack rule
  // engages when env is unset.
  const mode = policyGates.resolveGateMode(
    {},
    { hardGatesDefault: true },
  );
  assert.equal(mode, "hard",
    "pack hardGatesDefault=true engages when env unset");
});

test("POL-a resolveGateMode: env unset + pack default=false → warn", () => {
  const mode = policyGates.resolveGateMode(
    {},
    { hardGatesDefault: false },
  );
  assert.equal(mode, "warn");
});

test("POL-a resolveGateMode: env unset + no pack → warn (legacy 1-arg behavior)", () => {
  // Backwards-compat pin: 1-arg callers see legacy behavior.
  assert.equal(policyGates.resolveGateMode({}), "warn");
  assert.equal(policyGates.resolveGateMode(), "warn");
});

test("POL-a resolveGateMode: env empty string + pack default=true → hard (empty != explicit)", () => {
  // Empty string env value is treated as unset (whitespace-only also).
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "hard");
});

test("POL-a resolveGateMode: env unrecognized + pack default=true → hard (unknown env doesn't suppress pack)", () => {
  // An unrecognized env value (e.g., HARNESS_HARD_GATES="maybe") is
  // treated as unset rather than as an explicit warn — so the pack
  // default still wins. This matches the principle "explicit override
  // requires recognized truthy/falsy value".
  const mode = policyGates.resolveGateMode(
    { HARNESS_HARD_GATES: "maybe" },
    { hardGatesDefault: true },
  );
  assert.equal(mode, "hard");
});

test("POL-a resolveGateMode: env case-insensitive (FALSE / Hard / WARN)", () => {
  assert.equal(policyGates.resolveGateMode({ HARNESS_HARD_GATES: "FALSE" }, {}), "warn");
  assert.equal(policyGates.resolveGateMode({ HARNESS_HARD_GATES: "Hard" }, {}), "hard");
  assert.equal(policyGates.resolveGateMode({ HARNESS_HARD_GATES: "WARN" }, {}), "warn");
});

// ── Gate function integration ─────────────────────────────────────

test("POL-a gatePiiBlock: pack hardGatesDefault=true + PII + env unset → BLOCKED", () => {
  // Pre-POL-a this would return ok=true (warn audit) even with
  // public-sector posture, because env was unset. Post-POL-a the
  // pack default kicks in.
  const verdict = policyGates.gatePiiBlock({
    args: "review user jane.doe@example.com",
    deploymentProfile: { publicSector: true, hardGatesDefault: true },
    // mode + env intentionally NOT passed — let resolveGateMode pick
  });
  assert.equal(verdict.mode, "hard",
    "pack hardGatesDefault=true engages hard mode when env unset");
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.audit.verb, "policy_gate_blocked");
});

test("POL-a gatePiiBlock: pack hardGatesDefault=false + PII + env unset → ok+warn", () => {
  // public-sector pack (hardGatesDefault=false) preserves graduated
  // rollout — operator must explicitly opt in via HARNESS_HARD_GATES=1.
  const verdict = policyGates.gatePiiBlock({
    args: "review user jane.doe@example.com",
    deploymentProfile: { publicSector: true, hardGatesDefault: false },
  });
  assert.equal(verdict.mode, "warn");
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.audit.verb, "policy_gate_warn");
});

test("POL-a gateReleaseSigned: pack hardGatesDefault=true + unsigned + public-sector → BLOCKED", () => {
  const verdict = policyGates.gateReleaseSigned({
    deploymentProfile: {
      publicSector: true, requireSignedManifest: true,
      hardGatesDefault: true,
    },
    manifestSigned: false,
    // mode unset
  });
  assert.equal(verdict.mode, "hard");
  assert.equal(verdict.blocked, true);
});

test("POL-a gateEvidenceExportReady: pack hardGatesDefault=true + not ready → BLOCKED", () => {
  const verdict = policyGates.gateEvidenceExportReady({
    deploymentProfile: { publicSector: true, hardGatesDefault: true },
    decisionContext: { booleans: { auditExportReady: false } },
  });
  assert.equal(verdict.mode, "hard");
  assert.equal(verdict.blocked, true);
});

test("POL-a gateCompletionAllowed: pack hardGatesDefault=true + pending decision + public-sector → BLOCKED", () => {
  const verdict = policyGates.gateCompletionAllowed({
    deploymentProfile: { publicSector: true, hardGatesDefault: true },
    decisionContext: {
      booleans: { needsHumanDecision: true, approvalPending: true },
      counts: { pendingApprovals: 1 },
    },
  });
  assert.equal(verdict.mode, "hard");
  assert.equal(verdict.blocked, true);
});

// ── Explicit caller mode beats both env + pack ───────────────────

test("POL-a gatePiiBlock: opts.mode='warn' wins over pack hardGatesDefault=true", () => {
  // The opts.mode arg is the highest precedence — used by tests +
  // by callers who already know the operating mode.
  const verdict = policyGates.gatePiiBlock({
    args: "review jane.doe@example.com",
    deploymentProfile: { publicSector: true, hardGatesDefault: true },
    mode: "warn",  // explicit — pack default ignored
  });
  assert.equal(verdict.mode, "warn");
  assert.equal(verdict.blocked, false);
});

// ── Backwards-compat: pre-POL-a 1-arg / no-pack callers ──────────

test("POL-a backwards-compat: gatePiiBlock without deploymentProfile → legacy behavior", () => {
  // Pre-POL-a callers (no deploymentProfile) should see legacy
  // behavior — env is the only source of mode.
  // Without env + without dp → mode="warn" (legacy default)
  const verdict = policyGates.gatePiiBlock({
    args: "review jane.doe@example.com",
    // no deploymentProfile — uses resolveDeploymentProfile({}) internally,
    // which returns standard pack with hardGatesDefault=false
  });
  assert.equal(verdict.mode, "warn",
    "legacy 1-arg callers see warn-default behavior");
});

// ── Realistic scenario: finance-high-privacy operator without env override ──

test("POL-a SCENARIO: finance-high-privacy operator without HARNESS_HARD_GATES → automatic hard mode", () => {
  // The headline POL-a behavior. An operator who chose the
  // finance-high-privacy pack expects strict gates — they should
  // NOT have to ALSO remember to set HARNESS_HARD_GATES=1.
  const verdict = policyGates.gatePiiBlock({
    args: "review user data: SSN 123-45-6789",  // would be detected
    deploymentProfile: {
      publicSector: true,
      hardGatesDefault: true,  // finance-high-privacy pack rule
    },
  });
  assert.equal(verdict.mode, "hard",
    "finance-high-privacy operator gets hard gates without env opt-in");
});

test("POL-a SCENARIO: public-sector operator (graduated rollout) needs HARNESS_HARD_GATES=1", () => {
  // The public-sector pack has hardGatesDefault=false — operator
  // must explicitly enable hard gates. This preserves the SMART-2
  // graduated rollout strategy.
  const verdict = policyGates.gatePiiBlock({
    args: "review jane.doe@example.com",
    deploymentProfile: {
      publicSector: true,
      hardGatesDefault: false,  // public-sector pack rule
    },
    // env unset — graduated rollout default
  });
  assert.equal(verdict.mode, "warn",
    "public-sector defaults to warn — operator opts in via env");
  assert.equal(verdict.blocked, false);
});

test("POL-a SCENARIO: incident triage on finance-high-privacy → operator sets HARNESS_HARD_GATES=0", () => {
  // Operator on finance-high-privacy needs to temporarily soften
  // gates. HARNESS_HARD_GATES=0 lets them do that without changing
  // the pack id (which would also flip sandbox / signing).
  const verdict = policyGates.gatePiiBlock({
    args: "incident-investigation: review jane.doe@example.com",
    deploymentProfile: { publicSector: true, hardGatesDefault: true },
    mode: policyGates.resolveGateMode(
      { HARNESS_HARD_GATES: "0" },
      { publicSector: true, hardGatesDefault: true },
    ),
  });
  assert.equal(verdict.mode, "warn");
  assert.equal(verdict.blocked, false,
    "explicit warn override allows operator to soften gates during triage");
  // Audit still fires (warn audit) so the override is captured
  assert.equal(verdict.audit.verb, "policy_gate_warn");
});
