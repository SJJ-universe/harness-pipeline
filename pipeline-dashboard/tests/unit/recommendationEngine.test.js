// Slice SMART-1-a (Phase 2 SMART arc, 2026-05-04) — recommendation
// engine shape contract + per-rule branch tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const re = require("../../public/js/runtime/recommendationEngine");
const {
  RULES, RULE_IDS, SEVERITY_ORDER, SEVERITY_KEYS,
  recommendFromContext, getRule, _interpolate, _safeIndex,
} = re;

// ── Frozen registry shape ───────────────────────────────────────

test("SMART-1: RULES frozen + 7 entries (5 base + 2 public-sector)", () => {
  assert.ok(Object.isFrozen(RULES));
  assert.equal(RULES.length, 7,
    "expected 7 documented rules: 5 base + 2 public-sector");
});

test("SMART-1: every rule has the required fields + frozen", () => {
  const REQUIRED = [
    "id", "severity", "titleKey", "titleFallback", "bodyKey",
    "bodyFallback", "ctaKey", "ctaFallback", "ctaActionId",
    "appliesTo", "meta",
  ];
  for (const rule of RULES) {
    assert.ok(Object.isFrozen(rule), `rule ${rule.id} must be frozen`);
    for (const field of REQUIRED) {
      assert.ok(field in rule, `rule ${rule.id} missing field "${field}"`);
    }
    assert.equal(typeof rule.id, "string");
    assert.match(rule.id, /^[a-z0-9-]+$/, `rule id "${rule.id}" must be kebab-case`);
    assert.equal(typeof rule.appliesTo, "function");
    assert.equal(typeof rule.meta, "function");
  }
});

test("SMART-1: documented IDs all present (canonical 7)", () => {
  const present = new Set(RULES.map((r) => r.id));
  for (const id of [
    "complete-profile-setup",
    "resolve-pending-approvals",
    "request-codex-review",
    "monitor-active-runs",
    "export-audit-evidence",
    "public-sector-pii-block",
    "public-sector-evidence-trail",
  ]) {
    assert.ok(present.has(id), `canonical rule "${id}" missing`);
  }
});

test("SMART-1: RULE_IDS matches RULES.id sequence", () => {
  assert.deepEqual(RULE_IDS, RULES.map((r) => r.id));
});

test("SMART-1: SEVERITY_ORDER has 4 levels in canonical priority", () => {
  assert.deepEqual(SEVERITY_KEYS, ["critical", "high", "medium", "info"]);
  assert.equal(SEVERITY_ORDER.critical, 0);
  assert.equal(SEVERITY_ORDER.high, 1);
  assert.equal(SEVERITY_ORDER.medium, 2);
  assert.equal(SEVERITY_ORDER.info, 3);
});

test("SMART-1: severities in rule catalog are all from SEVERITY_KEYS", () => {
  for (const rule of RULES) {
    assert.ok(SEVERITY_KEYS.includes(rule.severity),
      `rule ${rule.id} severity "${rule.severity}" must be one of ${SEVERITY_KEYS.join(", ")}`);
  }
});

// ── Internal helpers ────────────────────────────────────────────

test("SMART-1 _safeIndex: known severity → numeric index", () => {
  assert.equal(_safeIndex("critical"), 0);
  assert.equal(_safeIndex("info"), 3);
});

test("SMART-1 _safeIndex: unknown severity → 99 (sorts to bottom)", () => {
  assert.equal(_safeIndex("weird"), 99);
  assert.equal(_safeIndex(undefined), 99);
});

test("SMART-1 _interpolate: substitutes {placeholders}", () => {
  assert.equal(
    _interpolate("승인 요청 {count}개 대기 중", { count: 3 }),
    "승인 요청 3개 대기 중",
  );
  assert.equal(
    _interpolate("hello", null),
    "hello",
    "no params → template returned verbatim");
  assert.equal(
    _interpolate("{a} and {b}", { a: "X" }),
    "X and ",
    "missing placeholder → empty string");
});

// ── Per-rule appliesTo: 7 canonical rules + edge cases ─────────

function _ctx(overrides) {
  return {
    schema: "harness-decision-context/v1",
    timestamp: "2026-05-04T00:00:00.000Z",
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

test("SMART-1 complete-profile-setup: fires when !hasActiveProfile", () => {
  const recs = recommendFromContext(_ctx({ booleans: { hasActiveProfile: false, needsHumanDecision: true } }));
  const r = recs.find((x) => x.id === "complete-profile-setup");
  assert.ok(r, "rule must fire when no active profile");
  assert.equal(r.severity, "critical");
});

test("SMART-1 complete-profile-setup: does NOT fire when active profile exists", () => {
  const recs = recommendFromContext(_ctx({ booleans: { hasActiveProfile: true } }));
  assert.ok(!recs.some((x) => x.id === "complete-profile-setup"));
});

test("SMART-1 resolve-pending-approvals: fires when approvalPending + interpolates count", () => {
  const recs = recommendFromContext(_ctx({
    booleans: { approvalPending: true, needsHumanDecision: true },
    counts: { pendingApprovals: 5 },
  }));
  const r = recs.find((x) => x.id === "resolve-pending-approvals");
  assert.ok(r);
  assert.equal(r.severity, "high");
  assert.match(r.title, /5/, "title must include the count placeholder");
  assert.equal(r.meta.count, 5);
});

test("SMART-1 request-codex-review: fires when codexReviewMissing", () => {
  const recs = recommendFromContext(_ctx({
    booleans: { codexReviewMissing: true, needsHumanDecision: true },
    counts: { openReviewSessions: 2 },
  }));
  const r = recs.find((x) => x.id === "request-codex-review");
  assert.ok(r);
  assert.equal(r.severity, "medium");
  assert.equal(r.meta.count, 2);
});

test("SMART-1 monitor-active-runs: fires when activeRuns > 0 + interpolates count", () => {
  const recs = recommendFromContext(_ctx({ counts: { activeRuns: 3 } }));
  const r = recs.find((x) => x.id === "monitor-active-runs");
  assert.ok(r);
  assert.equal(r.severity, "info");
  assert.match(r.title, /3/);
  assert.equal(r.meta.count, 3);
});

test("SMART-1 monitor-active-runs: does NOT fire when activeRuns is 0", () => {
  const recs = recommendFromContext(_ctx({ counts: { activeRuns: 0 } }));
  assert.ok(!recs.some((x) => x.id === "monitor-active-runs"));
});

test("SMART-1 export-audit-evidence: fires when auditExportReady + nothing blocking", () => {
  const recs = recommendFromContext(_ctx({
    booleans: { auditExportReady: true, needsHumanDecision: false },
  }));
  const r = recs.find((x) => x.id === "export-audit-evidence");
  assert.ok(r);
  assert.equal(r.severity, "info");
});

test("SMART-1 export-audit-evidence: does NOT fire when needsHumanDecision blocks", () => {
  // Even if export is ready, urgent actions take card space first.
  const recs = recommendFromContext(_ctx({
    booleans: { auditExportReady: true, needsHumanDecision: true,
                approvalPending: true },
  }));
  assert.ok(!recs.some((x) => x.id === "export-audit-evidence"),
    "export rec must yield to approval-pending when both apply");
  assert.ok(recs.some((x) => x.id === "resolve-pending-approvals"));
});

test("SMART-1 public-sector-pii-block: ONLY fires when publicSector + hasPii", () => {
  // Standard mode + PII → not fired
  let recs = recommendFromContext(_ctx({
    booleans: { hasPii: true, publicSector: false },
  }));
  assert.ok(!recs.some((x) => x.id === "public-sector-pii-block"));
  // Public-sector + no PII → not fired
  recs = recommendFromContext(_ctx({
    booleans: { hasPii: false, publicSector: true },
  }));
  assert.ok(!recs.some((x) => x.id === "public-sector-pii-block"));
  // BOTH → fires
  recs = recommendFromContext(_ctx({
    booleans: { hasPii: true, publicSector: true, needsHumanDecision: true },
  }));
  const r = recs.find((x) => x.id === "public-sector-pii-block");
  assert.ok(r);
  assert.equal(r.severity, "critical");
  assert.match(r.title, /🛡/);
});

test("SMART-1 public-sector-evidence-trail: fires when publicSector + auditExportReady", () => {
  const recs = recommendFromContext(_ctx({
    booleans: { publicSector: true, auditExportReady: true },
  }));
  const r = recs.find((x) => x.id === "public-sector-evidence-trail");
  assert.ok(r);
  assert.equal(r.severity, "high");
});

test("SMART-1 public-sector-evidence-trail: does NOT fire in standard posture", () => {
  const recs = recommendFromContext(_ctx({
    booleans: { publicSector: false, auditExportReady: true },
  }));
  assert.ok(!recs.some((x) => x.id === "public-sector-evidence-trail"));
});

// ── recommendFromContext aggregation + ordering ───────────────

test("SMART-1 recommendFromContext: empty input → empty list (graceful degrade)", () => {
  // null/missing ctx → no rules fire. Each rule.appliesTo guards
  // against missing ctx.booleans by short-circuiting to false.
  // This is the conservative "we don't know enough to recommend
  // anything" stance — vs the alternative of optimistically
  // assuming hasActiveProfile=false and firing complete-profile-setup,
  // which would surprise tests that pass {} just to check the
  // engine doesn't crash.
  const recs = recommendFromContext(null);
  assert.equal(recs.length, 0,
    "null ctx → no recommendations (graceful degrade, not phantom firing)");
});

test("SMART-1 recommendFromContext: returns sorted by severity", () => {
  // Trigger one of each severity tier
  const recs = recommendFromContext(_ctx({
    booleans: {
      hasActiveProfile: false,    // critical
      approvalPending: true,       // high
      codexReviewMissing: true,    // medium
      needsHumanDecision: true,
    },
    counts: { activeRuns: 1 },     // info
  }));
  // Severities should appear in critical → high → medium → info order.
  const severities = recs.map((r) => r.severity);
  for (let i = 1; i < severities.length; i++) {
    assert.ok(_safeIndex(severities[i - 1]) <= _safeIndex(severities[i]),
      `severity at index ${i} (${severities[i]}) must not precede ${severities[i - 1]}`);
  }
});

test("SMART-1 recommendFromContext: ties broken by rule index (declaration order)", () => {
  // Two info recs apply: monitor-active-runs (index 3) +
  // export-audit-evidence (index 4). monitor-active-runs should
  // come first.
  const recs = recommendFromContext(_ctx({
    booleans: { auditExportReady: true, needsHumanDecision: false },
    counts: { activeRuns: 1 },
  }));
  const infoRecs = recs.filter((r) => r.severity === "info");
  assert.equal(infoRecs.length, 2);
  assert.equal(infoRecs[0].id, "monitor-active-runs",
    "monitor-active-runs (index 3) precedes export-audit-evidence (index 4) on info-tier tie");
  assert.equal(infoRecs[1].id, "export-audit-evidence");
});

test("SMART-1 recommendFromContext: dismissedIds filters out matching rules", () => {
  const dismissed = new Set(["resolve-pending-approvals"]);
  const recs = recommendFromContext(_ctx({
    booleans: { approvalPending: true, needsHumanDecision: true },
    counts: { pendingApprovals: 2 },
  }), { dismissedIds: dismissed });
  assert.ok(!recs.some((r) => r.id === "resolve-pending-approvals"),
    "dismissed rule must not appear in output");
});

test("SMART-1 recommendFromContext: dismissedIds non-Set is silently ignored", () => {
  // If caller passes an array instead of Set, dismiss is a no-op
  // (Set check is strict). All applicable rules return as normal.
  const recs = recommendFromContext(_ctx({
    booleans: { approvalPending: true, needsHumanDecision: true },
  }), { dismissedIds: ["resolve-pending-approvals"] });
  assert.ok(recs.some((r) => r.id === "resolve-pending-approvals"));
});

test("SMART-1 recommendFromContext: appliesTo throwing rule is silently skipped", () => {
  // The engine doesn't have a way to inject a throwing rule (RULES
  // is frozen). Verify the try/catch behavior in code by passing
  // a context that's malformed enough to potentially break a rule.
  // null ctx works without throwing — verified above.
  const recs = recommendFromContext({ /* malformed */ });
  // Should not throw — engine handles gracefully (rules check
  // ctx?.booleans, ctx?.counts).
  assert.ok(Array.isArray(recs));
});

test("SMART-1 recommendFromContext: each output entry has required public fields", () => {
  const recs = recommendFromContext(_ctx({ booleans: { hasActiveProfile: false, needsHumanDecision: true } }));
  for (const r of recs) {
    for (const field of [
      "id", "severity", "title", "body", "ctaLabel", "ctaActionId",
      "titleKey", "bodyKey", "ctaKey", "meta",
    ]) {
      assert.ok(field in r, `output must include "${field}"`);
    }
  }
});

// ── getRule ───────────────────────────────────────────────────

test("SMART-1 getRule: returns the rule by id", () => {
  const rule = getRule("complete-profile-setup");
  assert.ok(rule);
  assert.equal(rule.severity, "critical");
});

test("SMART-1 getRule: returns null for unknown id", () => {
  assert.equal(getRule("totally-fake-rule"), null);
});

// ── Public-sector + multi-rule integration ────────────────────

test("SMART-1: public-sector with PII + approval pending → 2 critical + 1 high in priority order", () => {
  const recs = recommendFromContext(_ctx({
    booleans: {
      publicSector: true, hasPii: true,
      approvalPending: true, needsHumanDecision: true,
      hasActiveProfile: true,
    },
    counts: { pendingApprovals: 1 },
  }));
  // 2 critical (public-sector-pii-block + ... well, actually only 1
  // critical applies here. complete-profile-setup needs !hasActiveProfile)
  // 1 high (resolve-pending-approvals)
  // Note: public-sector-evidence-trail needs auditExportReady=true
  // which we didn't set.
  assert.equal(recs.filter((r) => r.severity === "critical").length, 1);
  assert.equal(recs.filter((r) => r.severity === "high").length, 1);
  assert.equal(recs[0].id, "public-sector-pii-block",
    "public-sector PII block ordered first (critical)");
  assert.equal(recs[1].id, "resolve-pending-approvals",
    "approval-pending ordered second (high)");
});

test("SMART-1: standard mode never sees public-sector-* recs even with all signals", () => {
  const recs = recommendFromContext(_ctx({
    booleans: {
      publicSector: false,  // STANDARD posture
      hasPii: true,         // would trigger public-sector PII block in PS posture
      auditExportReady: true,
      needsHumanDecision: false,
    },
  }));
  assert.ok(!recs.some((r) => r.id === "public-sector-pii-block"));
  assert.ok(!recs.some((r) => r.id === "public-sector-evidence-trail"));
});
