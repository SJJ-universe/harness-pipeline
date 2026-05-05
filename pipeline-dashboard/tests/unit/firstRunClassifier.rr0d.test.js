// Slice RR0-d (Phase 2 / RELEASE-READY-0, 2026-05-05) — first-run
// account login guidance tests. Pins:
//   - SAFE_GUIDANCE_PRINCIPLE frozen with stable id + i18n keys
//   - LOGIN_COMMANDS frozen with claude/codex commands + docs URL keys
//   - 3 new CTA constants (COPY_LOGIN_COMMAND_CLAUDE/CODEX,
//     RECHECK_PROVIDERS) frozen + present
//   - PROVIDER_MISSING + PROVIDER_NOT_AUTHENTICATED state CTA lists
//     extended with friendly options
//   - Backward-compat: existing CTA constants retained

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fr = require("../../public/js/runtime/firstRunClassifier");

// ── SAFE_GUIDANCE_PRINCIPLE ───────────────────────────────────────

test("RR0-d: SAFE_GUIDANCE_PRINCIPLE exported + frozen", () => {
  assert.ok(fr.SAFE_GUIDANCE_PRINCIPLE);
  assert.ok(Object.isFrozen(fr.SAFE_GUIDANCE_PRINCIPLE));
});

test("RR0-d: SAFE_GUIDANCE_PRINCIPLE has stable id + i18n keys", () => {
  const p = fr.SAFE_GUIDANCE_PRINCIPLE;
  assert.equal(p.id, "harness-no-credential-collection/v1");
  assert.equal(p.shortKey, "firstRun.safeGuidance.short");
  assert.equal(p.longKey, "firstRun.safeGuidance.long");
});

test("RR0-d: SAFE_GUIDANCE_PRINCIPLE cannot be mutated", () => {
  assert.throws(() => { fr.SAFE_GUIDANCE_PRINCIPLE.id = "tampered"; });
});

// ── LOGIN_COMMANDS ────────────────────────────────────────────────

test("RR0-d: LOGIN_COMMANDS frozen with claude + codex entries", () => {
  assert.ok(fr.LOGIN_COMMANDS);
  assert.ok(Object.isFrozen(fr.LOGIN_COMMANDS));
  assert.ok(fr.LOGIN_COMMANDS.claude);
  assert.ok(fr.LOGIN_COMMANDS.codex);
  assert.ok(Object.isFrozen(fr.LOGIN_COMMANDS.claude));
  assert.ok(Object.isFrozen(fr.LOGIN_COMMANDS.codex));
});

test("RR0-d: LOGIN_COMMANDS.claude has correct shape", () => {
  const c = fr.LOGIN_COMMANDS.claude;
  assert.equal(c.runner, "claude");
  assert.equal(c.command, "claude auth login");
  assert.equal(c.docsUrlKey, "firstRun.docsUrl.claude");
});

test("RR0-d: LOGIN_COMMANDS.codex has correct shape", () => {
  const c = fr.LOGIN_COMMANDS.codex;
  assert.equal(c.runner, "codex");
  assert.equal(c.command, "codex auth login");
  assert.equal(c.docsUrlKey, "firstRun.docsUrl.codex");
});

test("RR0-d: LOGIN_COMMANDS commands cannot be mutated", () => {
  assert.throws(() => { fr.LOGIN_COMMANDS.claude.command = "evil"; });
});

// ── New CTA constants ─────────────────────────────────────────────

test("RR0-d: 3 new CTA constants present", () => {
  assert.equal(fr.CTA.COPY_LOGIN_COMMAND_CLAUDE, "copy-login-command-claude");
  assert.equal(fr.CTA.COPY_LOGIN_COMMAND_CODEX, "copy-login-command-codex");
  assert.equal(fr.CTA.RECHECK_PROVIDERS, "recheck-providers");
});

test("RR0-d: CTA still frozen after RR0-d additions", () => {
  assert.ok(Object.isFrozen(fr.CTA));
  assert.throws(() => { fr.CTA.NEW = "x"; });
});

// ── State CTA list extensions ────────────────────────────────────

test("RR0-d: PROVIDER_MISSING includes RECHECK_PROVIDERS as 2nd action", () => {
  const ctas = fr.STATE_CTAS[fr.FIRST_RUN_STATES.PROVIDER_MISSING];
  assert.equal(ctas[0], fr.CTA.REOPEN_SETUP_FOR_PROVIDERS);
  assert.equal(ctas[1], fr.CTA.RECHECK_PROVIDERS);
  assert.equal(ctas.length, 2);
});

test("RR0-d: PROVIDER_NOT_AUTHENTICATED has 5 CTAs in priority order", () => {
  const ctas = fr.STATE_CTAS[fr.FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED];
  assert.deepEqual(ctas, [
    fr.CTA.AUTH_CLAUDE,                  // primary — open auth flow
    fr.CTA.AUTH_CODEX,
    fr.CTA.COPY_LOGIN_COMMAND_CLAUDE,    // friendly fallback — paste in terminal
    fr.CTA.COPY_LOGIN_COMMAND_CODEX,
    fr.CTA.RECHECK_PROVIDERS,            // tail — refresh status after external login
  ]);
});

// ── Classifier output reflects new CTAs ──────────────────────────

test("RR0-d: classify(unauth claude) returns full RR0-d CTA list", () => {
  const v = fr.classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, fr.FIRST_RUN_STATES.PROVIDER_NOT_AUTHENTICATED);
  assert.ok(v.ctas.includes(fr.CTA.COPY_LOGIN_COMMAND_CLAUDE));
  assert.ok(v.ctas.includes(fr.CTA.COPY_LOGIN_COMMAND_CODEX));
  assert.ok(v.ctas.includes(fr.CTA.RECHECK_PROVIDERS));
});

test("RR0-d: classify(missing claude) returns RECHECK_PROVIDERS CTA", () => {
  const v = fr.classifyFirstRun({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(v.state, fr.FIRST_RUN_STATES.PROVIDER_MISSING);
  assert.ok(v.ctas.includes(fr.CTA.RECHECK_PROVIDERS));
});

// ── Backward compat: pre-RR0-d CTAs still present ───────────────

test("RR0-d: pre-existing CTAs (AUTH/TEST/REOPEN) unchanged", () => {
  const stable = [
    "CREATE_PROFILE", "OPEN_SETUP_WIZARD", "OPEN_SETTINGS_PROFILES",
    "OPEN_PUBLIC_SECTOR_SETUP", "TEST_CLAUDE", "TEST_CODEX",
    "REOPEN_SETUP_FOR_PROVIDERS", "AUTH_CLAUDE", "AUTH_CODEX",
  ];
  for (const id of stable) {
    assert.ok(id in fr.CTA, `pre-RR0-d CTA ${id} preserved`);
  }
});
