// Slice UI-FirstRun-a (Phase D Round UI-P, 2026-05-04) — pure
// classifier that maps the operator's accountStatus state to one of
// six well-defined first-run readiness states. Drives the "지금
// 해야 할 일" (Next Action) card UI-FirstRun-b mounts in the simple
// shell.
//
// Why six states (not three like UI-H8 welcome-overlay):
//   UI-H8 covered the coarsest cut — does any active profile exist?
//   UI-FirstRun is the more honest "what's blocking the operator
//   right now" classifier. It distinguishes:
//
//     1. no-profile             — count=0; nothing exists yet
//     2. no-active-profile      — profiles exist, but none active
//                                 (and posture is NOT public-sector;
//                                 public-sector gets its own state)
//     3. public-sector-incomplete
//                               — public-sector mode + (no active
//                                 profile OR agency setup not run)
//     4. provider-missing       — providerStatus shows Claude or
//                                 Codex CLI not installed
//     5. provider-not-authenticated
//                               — providerStatus shows CLI installed
//                                 but auth missing
//     6. ready                  — everything that can be checked
//                                 cheaply looks fine
//
// Priority: states 1→6 in declared order (first match wins). The
// most blocking issue surfaces first. State 3 supersedes state 2
// when posture is public-sector (the operator's next step is
// agency-aware, not a generic profile switch).
//
// providerStatus is a STORE slice that settings-accounts populates
// AFTER the operator clicks "Test Claude" / "Test Codex" in D3
// settings modal. Until they click, providerStatus is null/empty
// and states 4-5 don't fire — operator simply sees state 6 (ready)
// with "Test Claude / Test Codex" CTAs available. No surprise
// token cost, no auto-probe on first paint.
//
// CTA recommendations per state are returned alongside the state
// ID so the panel doesn't need to mirror this logic.

"use strict";

const FIRST_RUN_STATES = Object.freeze({
  NO_PROFILE: "no-profile",
  NO_ACTIVE_PROFILE: "no-active-profile",
  PUBLIC_SECTOR_INCOMPLETE: "public-sector-incomplete",
  PROVIDER_MISSING: "provider-missing",
  PROVIDER_NOT_AUTHENTICATED: "provider-not-authenticated",
  READY: "ready",
});

// Frozen CTA vocabulary — UI panel renders the CTA IDs into
// localized buttons + wires onClick. Order matters: first CTA in
// the list is the primary action (rendered prominently).
const CTA = Object.freeze({
  CREATE_PROFILE: "create-profile",
  OPEN_SETUP_WIZARD: "open-setup-wizard",
  OPEN_SETTINGS_PROFILES: "open-settings-profiles",
  OPEN_PUBLIC_SECTOR_SETUP: "open-public-sector-setup",
  TEST_CLAUDE: "test-claude",
  TEST_CODEX: "test-codex",
  REOPEN_SETUP_FOR_PROVIDERS: "reopen-setup-for-providers",
  AUTH_CLAUDE: "auth-claude",
  AUTH_CODEX: "auth-codex",
});

// Per-state CTA recommendation. A state can list multiple CTAs;
// panel renders all of them, primary first.
const STATE_CTAS = Object.freeze({
  [FIRST_RUN_STATES.NO_PROFILE]: Object.freeze([
    CTA.OPEN_SETUP_WIZARD,
    CTA.CREATE_PROFILE,
  ]),
  [FIRST_RUN_STATES.NO_ACTIVE_PROFILE]: Object.freeze([
    CTA.OPEN_SETTINGS_PROFILES,
  ]),
  [FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE]: Object.freeze([
    CTA.OPEN_PUBLIC_SECTOR_SETUP,
    CTA.OPEN_SETTINGS_PROFILES,
  ]),
  [FIRST_RUN_STATES.PROVIDER_MISSING]: Object.freeze([
    CTA.REOPEN_SETUP_FOR_PROVIDERS,
  ]),
  [FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED]: Object.freeze([
    CTA.AUTH_CLAUDE,
    CTA.AUTH_CODEX,
  ]),
  [FIRST_RUN_STATES.READY]: Object.freeze([
    CTA.TEST_CLAUDE,
    CTA.TEST_CODEX,
  ]),
});

// ── helpers ─────────────────────────────────────────────────────

function _hasNoProfile(profile) {
  if (!profile) return true;
  if (typeof profile.count !== "number") return true;
  return profile.count === 0;
}

function _hasNoActiveProfile(profile) {
  if (!profile) return true;
  return !profile.activeId;
}

function _runnerLooksMissing(runner) {
  // Tier-1 verdict: installed:false means CLI binary not on PATH.
  return runner && runner.installed === false;
}

function _runnerLooksUnauthenticated(runner) {
  // Tier-2 verdict: installed:true + authenticated:false.
  return runner && runner.installed === true && runner.authenticated === false;
}

function _missingRunners(providerStatus) {
  if (!providerStatus) return [];
  const out = [];
  if (_runnerLooksMissing(providerStatus.claude)) out.push("claude");
  if (_runnerLooksMissing(providerStatus.codex)) out.push("codex");
  return out;
}

function _unauthenticatedRunners(providerStatus) {
  if (!providerStatus) return [];
  const out = [];
  if (_runnerLooksUnauthenticated(providerStatus.claude)) out.push("claude");
  if (_runnerLooksUnauthenticated(providerStatus.codex)) out.push("codex");
  return out;
}

// ── classifier ──────────────────────────────────────────────────

/**
 * Classify operator's first-run state from accountStatus.
 *
 * @param {object} accountStatus  store.snapshot().accountStatus
 *   .profile        {activeId, activeLabel, count, credentialBackend}
 *   .deployment     {mode, publicSector, allowLocalExecutor, ...}
 *   .providerStatus {claude:{installed,authenticated,...},
 *                    codex:{installed,authenticated,...}}  (optional)
 * @returns {object} verdict
 *   .state    one of FIRST_RUN_STATES
 *   .ctas     array of CTA IDs in priority order
 *   .meta     state-specific metadata (e.g., which runners failed)
 */
function classifyFirstRun(accountStatus) {
  const ac = accountStatus || {};
  const profile = ac.profile || null;
  const deployment = ac.deployment || null;
  const providerStatus = ac.providerStatus || null;

  // 1. NO PROFILE — highest priority, blocks every other action.
  if (_hasNoProfile(profile)) {
    return {
      state: FIRST_RUN_STATES.NO_PROFILE,
      ctas: STATE_CTAS[FIRST_RUN_STATES.NO_PROFILE].slice(),
      meta: {},
    };
  }

  // 2 & 3. NO ACTIVE PROFILE — public-sector context overrides.
  if (_hasNoActiveProfile(profile)) {
    if (deployment && deployment.publicSector === true) {
      return {
        state: FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE,
        ctas: STATE_CTAS[FIRST_RUN_STATES.PUBLIC_SECTOR_INCOMPLETE].slice(),
        meta: { reason: "no-active-profile-under-public-sector" },
      };
    }
    return {
      state: FIRST_RUN_STATES.NO_ACTIVE_PROFILE,
      ctas: STATE_CTAS[FIRST_RUN_STATES.NO_ACTIVE_PROFILE].slice(),
      meta: { profileCount: profile.count },
    };
  }

  // Active profile exists from here on.

  // 4. PROVIDER MISSING — only fires when probe data is present.
  const missing = _missingRunners(providerStatus);
  if (missing.length > 0) {
    return {
      state: FIRST_RUN_STATES.PROVIDER_MISSING,
      ctas: STATE_CTAS[FIRST_RUN_STATES.PROVIDER_MISSING].slice(),
      meta: { missing },
    };
  }

  // 5. PROVIDER NOT AUTHENTICATED — only fires when probe data is present.
  const unauth = _unauthenticatedRunners(providerStatus);
  if (unauth.length > 0) {
    return {
      state: FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED,
      ctas: STATE_CTAS[FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED].slice(),
      meta: { unauthenticated: unauth },
    };
  }

  // 6. READY — default. Note: this is "ready" in the sense that no
  // CHECKED state is failing. If providerStatus is null (operator
  // hasn't tested yet), we still return READY but with TEST_CLAUDE /
  // TEST_CODEX CTAs available. Honest framing: "we don't know if
  // your providers are reachable; tap to verify."
  return {
    state: FIRST_RUN_STATES.READY,
    ctas: STATE_CTAS[FIRST_RUN_STATES.READY].slice(),
    meta: { providerStatusKnown: !!providerStatus },
  };
}

module.exports = {
  FIRST_RUN_STATES,
  CTA,
  STATE_CTAS,
  classifyFirstRun,
  // Internal helpers exported for shape testing
  _hasNoProfile,
  _hasNoActiveProfile,
  _missingRunners,
  _unauthenticatedRunners,
};
