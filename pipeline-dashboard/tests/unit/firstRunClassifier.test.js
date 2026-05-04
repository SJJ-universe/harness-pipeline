// Slice UI-FirstRun-a (Phase D Round UI-P, 2026-05-04) — classifier
// shape contract + per-state branch tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const c = require("../../public/js/runtime/firstRunClassifier");
const {
  FIRST_RUN_STATES,
  CTA,
  STATE_CTAS,
  classifyFirstRun,
  _hasNoProfile,
  _hasNoActiveProfile,
  _missingRunners,
  _unauthenticatedRunners,
} = c;

// ── Frozen registry shape ───────────────────────────────────────

test("UI-FirstRun: FIRST_RUN_STATES frozen + 6 entries", () => {
  assert.ok(Object.isFrozen(FIRST_RUN_STATES));
  assert.equal(Object.keys(FIRST_RUN_STATES).length, 6);
  for (const id of [
    "NO_PROFILE", "NO_ACTIVE_PROFILE", "PUBLIC_SECTOR_INCOMPLETE",
    "PROVIDER_MISSING", "PROVIDER_NOT_AUTHENTICATED", "READY",
  ]) {
    assert.ok(id in FIRST_RUN_STATES, `state ${id} missing from registry`);
  }
});

test("UI-FirstRun: CTA frozen + canonical IDs", () => {
  assert.ok(Object.isFrozen(CTA));
  for (const id of [
    "CREATE_PROFILE", "OPEN_SETUP_WIZARD", "OPEN_SETTINGS_PROFILES",
    "OPEN_PUBLIC_SECTOR_SETUP", "TEST_CLAUDE", "TEST_CODEX",
    "REOPEN_SETUP_FOR_PROVIDERS", "AUTH_CLAUDE", "AUTH_CODEX",
  ]) {
    assert.ok(id in CTA, `CTA ${id} missing`);
  }
});

test("UI-FirstRun: STATE_CTAS covers every state + arrays frozen", () => {
  assert.ok(Object.isFrozen(STATE_CTAS));
  for (const stateId of Object.values(FIRST_RUN_STATES)) {
    const ctas = STATE_CTAS[stateId];
    assert.ok(Array.isArray(ctas), `STATE_CTAS missing entry for ${stateId}`);
    assert.ok(Object.isFrozen(ctas), `STATE_CTAS[${stateId}] must be frozen`);
    assert.ok(ctas.length >= 1, `${stateId} must have at least one CTA`);
  }
});

test("UI-FirstRun: state IDs are kebab-case strings", () => {
  for (const stateId of Object.values(FIRST_RUN_STATES)) {
    assert.equal(typeof stateId, "string");
    assert.match(stateId, /^[a-z0-9-]+$/, `state id "${stateId}" must be kebab-case`);
  }
});

// ── Internal helpers ────────────────────────────────────────────

test("UI-FirstRun _hasNoProfile: null/undefined/missing count → true", () => {
  assert.equal(_hasNoProfile(null), true);
  assert.equal(_hasNoProfile(undefined), true);
  assert.equal(_hasNoProfile({}), true);
  assert.equal(_hasNoProfile({ count: 0 }), true);
});

test("UI-FirstRun _hasNoProfile: count > 0 → false", () => {
  assert.equal(_hasNoProfile({ count: 1 }), false);
  assert.equal(_hasNoProfile({ count: 5, activeId: "x" }), false);
});

test("UI-FirstRun _hasNoActiveProfile: null/empty → true", () => {
  assert.equal(_hasNoActiveProfile(null), true);
  assert.equal(_hasNoActiveProfile({}), true);
  assert.equal(_hasNoActiveProfile({ count: 3 }), true);
  assert.equal(_hasNoActiveProfile({ count: 3, activeId: null }), true);
});

test("UI-FirstRun _hasNoActiveProfile: activeId set → false", () => {
  assert.equal(_hasNoActiveProfile({ count: 1, activeId: "p1" }), false);
});

test("UI-FirstRun _missingRunners: detects runner.installed=false", () => {
  assert.deepEqual(_missingRunners(null), []);
  assert.deepEqual(_missingRunners({}), []);
  assert.deepEqual(_missingRunners({
    claude: { installed: false },
    codex: { installed: true },
  }), ["claude"]);
  assert.deepEqual(_missingRunners({
    claude: { installed: false },
    codex: { installed: false },
  }), ["claude", "codex"]);
});

test("UI-FirstRun _unauthenticatedRunners: detects installed=true + authenticated=false", () => {
  assert.deepEqual(_unauthenticatedRunners({
    claude: { installed: true, authenticated: false },
    codex: { installed: true, authenticated: true },
  }), ["claude"]);
  // installed=false should NOT be classified as unauthenticated
  // (it's a different state — provider-missing)
  assert.deepEqual(_unauthenticatedRunners({
    claude: { installed: false },
    codex: { installed: true, authenticated: false },
  }), ["codex"]);
});

// ── Per-state classification ────────────────────────────────────

test("UI-FirstRun classify: empty accountStatus → NO_PROFILE", () => {
  const v = classifyFirstRun(null);
  assert.equal(v.state, FIRST_RUN_STATES.NO_PROFILE);
  assert.deepEqual(v.ctas, STATE_CTAS[FIRST_RUN_STATES.NO_PROFILE].slice());
});

test("UI-FirstRun classify: profile.count=0 → NO_PROFILE", () => {
  const v = classifyFirstRun({ profile: { count: 0 } });
  assert.equal(v.state, FIRST_RUN_STATES.NO_PROFILE);
});

test("UI-FirstRun classify: count>0 + no activeId + standard mode → NO_ACTIVE_PROFILE", () => {
  const v = classifyFirstRun({
    profile: { count: 2, activeId: null },
    deployment: { publicSector: false },
  });
  assert.equal(v.state, FIRST_RUN_STATES.NO_ACTIVE_PROFILE);
  assert.equal(v.meta.profileCount, 2);
  assert.deepEqual(v.ctas, [CTA.OPEN_SETTINGS_PROFILES]);
});

test("UI-FirstRun classify: count>0 + no activeId + public-sector → PUBLIC_SECTOR_INCOMPLETE (not NO_ACTIVE_PROFILE)", () => {
  const v = classifyFirstRun({
    profile: { count: 2, activeId: null },
    deployment: { publicSector: true },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE,
    "public-sector posture supersedes generic no-active-profile");
  assert.equal(v.meta.reason, "no-active-profile-under-public-sector");
  assert.deepEqual(v.ctas, [CTA.OPEN_PUBLIC_SECTOR_SETUP, CTA.OPEN_SETTINGS_PROFILES]);
});

test("UI-FirstRun classify: active profile + no providerStatus → READY (with verify CTAs)", () => {
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    deployment: { publicSector: false },
  });
  assert.equal(v.state, FIRST_RUN_STATES.READY);
  assert.equal(v.meta.providerStatusKnown, false,
    "ready state should mark that provider readiness wasn't verified");
  assert.deepEqual(v.ctas, [CTA.TEST_CLAUDE, CTA.TEST_CODEX]);
});

test("UI-FirstRun classify: active profile + claude not installed → PROVIDER_MISSING", () => {
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    deployment: { publicSector: false },
    providerStatus: {
      claude: { installed: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PROVIDER_MISSING);
  assert.deepEqual(v.meta.missing, ["claude"]);
});

test("UI-FirstRun classify: active profile + both runners missing → PROVIDER_MISSING (both listed)", () => {
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: false },
      codex: { installed: false },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PROVIDER_MISSING);
  assert.deepEqual(v.meta.missing, ["claude", "codex"]);
});

test("UI-FirstRun classify: active profile + claude not authenticated → PROVIDER_NOT_AUTHENTICATED", () => {
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED);
  assert.deepEqual(v.meta.unauthenticated, ["claude"]);
  assert.deepEqual(v.ctas, [CTA.AUTH_CLAUDE, CTA.AUTH_CODEX]);
});

test("UI-FirstRun classify: missing > unauthenticated priority", () => {
  // claude=missing, codex=not-authenticated → MISSING wins (more
  // blocking — operator can't even invoke that CLI)
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: false },
      codex: { installed: true, authenticated: false },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PROVIDER_MISSING);
});

test("UI-FirstRun classify: active profile + all runners healthy → READY", () => {
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: true },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.READY);
  assert.equal(v.meta.providerStatusKnown, true);
});

test("UI-FirstRun classify: providerStatus only has claude (codex unprobed) → READY", () => {
  // codex not in providerStatus means we haven't probed it. Don't
  // FAIL the operator just because they tested only one CLI.
  const v = classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, FIRST_RUN_STATES.READY);
});

test("UI-FirstRun classify: result is mutation-safe (ctas array can be modified by caller)", () => {
  const v1 = classifyFirstRun({ profile: { count: 0 } });
  v1.ctas.push("custom-cta");
  // Re-classifying must NOT see the previous mutation — STATE_CTAS
  // entries are the source of truth (frozen) + classifier returns
  // shallow .slice() copy each call.
  const v2 = classifyFirstRun({ profile: { count: 0 } });
  assert.equal(v2.ctas.length, STATE_CTAS[FIRST_RUN_STATES.NO_PROFILE].length,
    "subsequent classify calls must not inherit caller mutations");
});

// ── Priority ordering edge cases ────────────────────────────────

test("UI-FirstRun priority: NO_PROFILE wins over public-sector flag", () => {
  // Even under public-sector posture, "no profile" is still no-profile
  // (no setup at all yet)
  const v = classifyFirstRun({
    profile: { count: 0 },
    deployment: { publicSector: true },
  });
  assert.equal(v.state, FIRST_RUN_STATES.NO_PROFILE);
});

test("UI-FirstRun priority: PUBLIC_SECTOR_INCOMPLETE wins over provider-missing under public-sector", () => {
  // If active profile is missing under public-sector mode, that's
  // the agency-aware blocker. Provider checks come AFTER the
  // operator picks a profile.
  const v = classifyFirstRun({
    profile: { count: 1, activeId: null },
    deployment: { publicSector: true },
    providerStatus: { claude: { installed: false } },
  });
  assert.equal(v.state, FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE);
});

// ── CTA priority semantics ──────────────────────────────────────

test("UI-FirstRun NO_PROFILE: primary CTA is OPEN_SETUP_WIZARD", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.NO_PROFILE];
  assert.equal(ctas[0], CTA.OPEN_SETUP_WIZARD,
    "first CTA should be the setup wizard — most guided path for first-time operators");
});

test("UI-FirstRun NO_ACTIVE_PROFILE: only CTA is OPEN_SETTINGS_PROFILES", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.NO_ACTIVE_PROFILE];
  assert.deepEqual(ctas, [CTA.OPEN_SETTINGS_PROFILES]);
});

test("UI-FirstRun PUBLIC_SECTOR_INCOMPLETE: primary CTA is OPEN_PUBLIC_SECTOR_SETUP", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE];
  assert.equal(ctas[0], CTA.OPEN_PUBLIC_SECTOR_SETUP);
});

test("UI-FirstRun PROVIDER_MISSING: only CTA is REOPEN_SETUP_FOR_PROVIDERS", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.PROVIDER_MISSING];
  assert.deepEqual(ctas, [CTA.REOPEN_SETUP_FOR_PROVIDERS]);
});

test("UI-FirstRun PROVIDER_NOT_AUTHENTICATED: lists AUTH CTAs in canonical order", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED];
  assert.deepEqual(ctas, [CTA.AUTH_CLAUDE, CTA.AUTH_CODEX]);
});

test("UI-FirstRun READY: lists test CTAs (not auth — providers already authed)", () => {
  const ctas = STATE_CTAS[FIRST_RUN_STATES.READY];
  assert.deepEqual(ctas, [CTA.TEST_CLAUDE, CTA.TEST_CODEX]);
});
