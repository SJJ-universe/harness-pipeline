// Slice SMART-1-BASELINE-a (Phase 2 v2 follow-up, 2026-05-05) —
// recommendation engine baseline rule tests.
//
// The baseline rule (system-ready) fires ONLY when the operator has
// an active profile AND no other rule matches. This prevents the
// recommendations-card from landing on its empty state for "quiet"
// fresh-deployment scenarios while NEVER competing for slot space
// with real urgent recommendations.
//
// Engine contract (verified here):
//   1. RULES contains a `system-ready` entry with isBaseline: true
//   2. recommendFromContext drops baseline matches when any non-
//      baseline rule fires
//   3. recommendFromContext keeps the baseline when no non-baseline
//      rule applies
//   4. The baseline does NOT fire when hasActiveProfile=false (the
//      complete-profile-setup critical rule fires instead and is
//      itself non-baseline, so the baseline would be filtered anyway,
//      but the appliesTo guard makes the contract explicit)
//   5. The baseline rule's appliesTo never throws on missing
//      booleans (defensive — null/undefined ctx → false)
//   6. Public-sector active profile + no other signals → baseline
//      still fires (no public-sector-* rec applies until the
//      operator hits PII or has audit export ready)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const re = require("../../public/js/runtime/recommendationEngine");
const { RULES, recommendFromContext, getRule } = re;

// ── decisionContext stub helper ─────────────────────────────────

function _validDc(overrides) {
  return {
    schema: "harness-decision-context/v1",
    timestamp: "2026-05-05T00:00:00.000Z",
    booleans: Object.assign({
      hasPii: false, approvalPending: false, codexReviewMissing: false,
      auditExportReady: false, publicSector: false, hasActiveProfile: true,
      needsHumanDecision: false, remoteRunnerActive: false,
    }, overrides && overrides.booleans),
    counts: Object.assign({
      activeRuns: 0, pendingApprovals: 0, openReviewSessions: 0,
      remoteRunnerCount: 0, evidenceLedgerEntries: 0,
    }, overrides && overrides.counts),
    posture: { mode: "standard", publicSector: false },
    sources: {},
  };
}

// ── Rule shape ──────────────────────────────────────────────────

test("SMART-1-BASELINE-a: 'system-ready' rule registered + frozen", () => {
  const rule = getRule("system-ready");
  assert.ok(rule, "system-ready rule registered");
  assert.ok(Object.isFrozen(rule), "rule must be frozen");
  assert.equal(rule.severity, "info");
  assert.equal(rule.isBaseline, true,
    "system-ready must carry isBaseline: true");
  assert.equal(rule.ctaActionId, "open-setup-wizard",
    "CTA routes to setup wizard (safe destination — never mutates)");
});

test("SMART-1-BASELINE-a: rules without isBaseline default to non-baseline", () => {
  // All pre-existing rules (not system-ready) should NOT carry
  // isBaseline === true. This codifies the convention.
  for (const rule of RULES) {
    if (rule.id === "system-ready") continue;
    assert.notEqual(rule.isBaseline, true,
      `rule ${rule.id} must not be a baseline rule (only system-ready)`);
  }
});

test("SMART-1-BASELINE-a: only one baseline rule in the registry", () => {
  // Multi-baseline-rule edge cases (filtering / ordering) are out of
  // scope for SMART-1-BASELINE-a. If a future round adds a second
  // baseline, this test must be updated alongside the engine
  // post-processing logic so the new behavior is explicit.
  const baselines = RULES.filter((r) => r.isBaseline === true);
  assert.equal(baselines.length, 1,
    "exactly one baseline rule (system-ready)");
});

// ── Quiet-context behavior ──────────────────────────────────────

test("SMART-1-BASELINE-a: quiet context (hasActiveProfile=true, all else false) → only system-ready", () => {
  const ctx = _validDc({ booleans: { hasActiveProfile: true } });
  const recs = recommendFromContext(ctx);
  assert.equal(recs.length, 1, "exactly one rec");
  assert.equal(recs[0].id, "system-ready");
  assert.equal(recs[0].severity, "info");
  assert.equal(recs[0].isBaseline, true,
    "the rec keeps isBaseline=true so the panel can style it differently if it wants to");
});

test("SMART-1-BASELINE-a: quiet PUBLIC-SECTOR context → still only system-ready", () => {
  // Public-sector rules require positive signals (hasPii or
  // auditExportReady). With both false, no public-sector-* fires —
  // baseline takes over.
  const ctx = _validDc({
    booleans: { hasActiveProfile: true, publicSector: true,
                hasPii: false, auditExportReady: false },
    posture: { mode: "public-sector", publicSector: true },
  });
  const recs = recommendFromContext(ctx);
  assert.equal(recs.length, 1, "exactly one rec");
  assert.equal(recs[0].id, "system-ready");
});

// ── Filtering when non-baseline rules fire ──────────────────────

test("SMART-1-BASELINE-a: when complete-profile-setup fires, baseline is dropped", () => {
  const ctx = _validDc({ booleans: { hasActiveProfile: false } });
  const recs = recommendFromContext(ctx);
  // Should be exactly 1 rec — the critical complete-profile-setup —
  // baseline filtered out
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, "complete-profile-setup");
  assert.equal(recs[0].severity, "critical");
  // Confirm baseline did NOT slip in
  for (const r of recs) {
    assert.notEqual(r.id, "system-ready",
      "baseline must be filtered out when any non-baseline rule fires");
  }
});

test("SMART-1-BASELINE-a: when approval pending fires, baseline is dropped", () => {
  const ctx = _validDc({
    booleans: { hasActiveProfile: true, approvalPending: true },
    counts: { pendingApprovals: 3 },
  });
  const recs = recommendFromContext(ctx);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, "resolve-pending-approvals");
  assert.equal(recs[0].severity, "high");
});

test("SMART-1-BASELINE-a: multiple non-baseline rules → all shown, baseline dropped", () => {
  // PII + approval pending + active runs → 3 non-baseline recs
  const ctx = _validDc({
    booleans: {
      hasActiveProfile: true,
      publicSector: true, hasPii: true,
      approvalPending: true,
    },
    counts: { activeRuns: 2, pendingApprovals: 1 },
    posture: { mode: "public-sector", publicSector: true },
  });
  const recs = recommendFromContext(ctx);
  assert.ok(recs.length >= 2,
    "expected at least 2 recs when multiple signals fire");
  for (const r of recs) {
    assert.notEqual(r.id, "system-ready",
      `baseline must not appear when ${recs.length} non-baseline recs fired`);
  }
});

// ── No-active-profile path ──────────────────────────────────────

test("SMART-1-BASELINE-a: !hasActiveProfile → baseline does not even apply", () => {
  // The baseline appliesTo demands hasActiveProfile=true. So even
  // without the engine's filter, the baseline rule wouldn't fire.
  // This is defense-in-depth: the appliesTo guard means the baseline
  // can never sneak in alongside complete-profile-setup.
  const ctx = _validDc({ booleans: { hasActiveProfile: false } });
  const rule = getRule("system-ready");
  assert.equal(rule.appliesTo(ctx), false,
    "baseline appliesTo returns false when no active profile");
});

// ── Defensive guards ────────────────────────────────────────────

test("SMART-1-BASELINE-a: baseline appliesTo defensive against null ctx", () => {
  const rule = getRule("system-ready");
  assert.equal(rule.appliesTo(null), false);
  assert.equal(rule.appliesTo(undefined), false);
  assert.equal(rule.appliesTo({}), false,
    "missing booleans → baseline does not apply");
  assert.equal(rule.appliesTo({ booleans: {} }), false,
    "missing hasActiveProfile → baseline does not apply");
});

test("SMART-1-BASELINE-a: baseline meta returns empty object", () => {
  const rule = getRule("system-ready");
  const meta = rule.meta(_validDc({ booleans: { hasActiveProfile: true } }));
  assert.deepEqual(meta, {},
    "baseline does not need any meta interpolation today");
});

// ── Dismissal ───────────────────────────────────────────────────

test("SMART-1-BASELINE-a: baseline can be dismissed (operator chose to hide it)", () => {
  const ctx = _validDc({ booleans: { hasActiveProfile: true } });
  const dismissed = new Set(["system-ready"]);
  const recs = recommendFromContext(ctx, { dismissedIds: dismissed });
  assert.equal(recs.length, 0,
    "operator-dismissed baseline → empty rec list (back to empty-state UX)");
});

// ── Output shape ────────────────────────────────────────────────

test("SMART-1-BASELINE-a: baseline output carries isBaseline=true on the rec object", () => {
  const ctx = _validDc({ booleans: { hasActiveProfile: true } });
  const recs = recommendFromContext(ctx);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].isBaseline, true,
    "rec output preserves isBaseline so panels can branch on it");
});

test("SMART-1-BASELINE-a: non-baseline rec output carries isBaseline=false", () => {
  const ctx = _validDc({ booleans: { hasActiveProfile: false } });
  const recs = recommendFromContext(ctx);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].id, "complete-profile-setup");
  assert.equal(recs[0].isBaseline, false,
    "non-baseline recs output isBaseline=false (not undefined)");
});
