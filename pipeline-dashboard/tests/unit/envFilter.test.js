// Slice P0 (Phase E productization, 2026-04-28) — envFilter unit tests.
//
// Pins down which env keys leak vs. stay. The test fixture mirrors the
// real-world scenario described in the P0 plan: a parent shell with
// HARNESS_TOKEN, RUNNER_BOOTSTRAP_TOKEN, ANTHROPIC_API_KEY, OPENAI_API_KEY,
// GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY, NPM_TOKEN exposed alongside
// benign vars (PATH, HOME, LANG, USERPROFILE).
//
// Why explicit-key assertions vs. snapshot:
// A snapshot would freeze test fixtures into the regression target; if
// someone later adds a new "X_KEY" env in the source data, the snapshot
// would auto-pass even though the real-world leak surface grew. Explicit
// `assert.equal(out.X_KEY, undefined)` forces a deliberate test update
// when the threat model changes.

const test = require("node:test");
const assert = require("node:assert/strict");
const { filterSensitiveEnv, SENSITIVE_KEY_RE } = require("../../src/security/envFilter");

const REAL_WORLD_PARENT_ENV = Object.freeze({
  // Sensitive — must be removed by default.
  HARNESS_TOKEN: "harness-32-byte-hex...",
  RUNNER_BOOTSTRAP_TOKEN: "bootstrap-runner-001",
  ANTHROPIC_API_KEY: "sk-ant-...",
  OPENAI_API_KEY: "sk-...",
  GITHUB_TOKEN: "ghp_...",
  AWS_SECRET_ACCESS_KEY: "...",
  AWS_ACCESS_KEY_ID: "AKIA...",
  NPM_TOKEN: "npm_...",
  GH_TOKEN: "...",
  CLAUDE_TOKEN: "...",
  CODEX_TOKEN: "...",
  ANTHROPIC_AUTH_TOKEN: "...",
  PASSWORD: "p@ss",
  DB_PASSWORD: "p@ss",
  CREDENTIAL_FILE: "/path",
  // Benign — must be preserved.
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/home/sj",
  USERPROFILE: "C:\\Users\\SJ",
  LANG: "ko_KR.UTF-8",
  TMP: "/tmp",
  NODE_ENV: "production",
  HARNESS_PORT: "4201",
  HARNESS_HOST: "127.0.0.1",
  HARNESS_DEBUG: "1",
  HARNESS_REMOTE_MODE: "preview",
  // Edge case: name doesn't match the regex.
  SOME_PUBLIC_VAR: "ok",
});

// ── default behavior (no opts) ─────────────────────────────────────

test("P0: filterSensitiveEnv removes HARNESS_TOKEN by default (Claude/Codex spawn path)", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.HARNESS_TOKEN, undefined,
    "HARNESS_TOKEN must NOT leak to Claude/Codex children");
});

test("P0: filterSensitiveEnv removes runner subsystem tokens", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.RUNNER_BOOTSTRAP_TOKEN, undefined);
});

test("P0: filterSensitiveEnv removes provider API keys", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.ANTHROPIC_API_KEY, undefined);
  assert.equal(out.OPENAI_API_KEY, undefined);
  assert.equal(out.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(out.CLAUDE_TOKEN, undefined);
  assert.equal(out.CODEX_TOKEN, undefined);
});

test("P0: filterSensitiveEnv removes infra/git/cloud secrets", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.GITHUB_TOKEN, undefined);
  assert.equal(out.GH_TOKEN, undefined);
  assert.equal(out.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(out.AWS_ACCESS_KEY_ID, undefined,
    "AWS_ACCESS_KEY_ID matches the KEY pattern; defense-in-depth removes it");
  assert.equal(out.NPM_TOKEN, undefined);
});

test("P0: filterSensitiveEnv removes password / credential file refs", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.PASSWORD, undefined);
  assert.equal(out.DB_PASSWORD, undefined);
  assert.equal(out.CREDENTIAL_FILE, undefined);
});

test("P0: filterSensitiveEnv preserves benign env vars", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.PATH, "/usr/local/bin:/usr/bin");
  assert.equal(out.HOME, "/home/sj");
  assert.equal(out.USERPROFILE, "C:\\Users\\SJ");
  assert.equal(out.LANG, "ko_KR.UTF-8");
  assert.equal(out.TMP, "/tmp");
  assert.equal(out.NODE_ENV, "production");
  assert.equal(out.HARNESS_PORT, "4201");
  assert.equal(out.HARNESS_HOST, "127.0.0.1");
  assert.equal(out.HARNESS_DEBUG, "1");
  assert.equal(out.HARNESS_REMOTE_MODE, "preview");
  assert.equal(out.SOME_PUBLIC_VAR, "ok");
});

test("P0: filterSensitiveEnv does NOT mutate the source env (shallow copy)", () => {
  const src = { ...REAL_WORLD_PARENT_ENV };
  filterSensitiveEnv(src);
  // src must still have all keys intact.
  assert.equal(src.HARNESS_TOKEN, "harness-32-byte-hex...");
  assert.equal(src.PATH, "/usr/local/bin:/usr/bin");
});

// ── allowKeys (PTY path) ───────────────────────────────────────────

test("P0: filterSensitiveEnv allowKeys preserves HARNESS_TOKEN (PTY path)", () => {
  // server.js's PTY spawn passes `allowKeys: ["HARNESS_TOKEN"]` because
  // the operator may type `curl http://127.0.0.1:4201/api/...` from the
  // terminal and needs the token in the env. Other secrets stay blocked.
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV, { allowKeys: ["HARNESS_TOKEN"] });
  assert.equal(out.HARNESS_TOKEN, "harness-32-byte-hex...",
    "HARNESS_TOKEN must be preserved when explicitly allow-listed");
  // Other sensitives remain dropped.
  assert.equal(out.RUNNER_BOOTSTRAP_TOKEN, undefined);
  assert.equal(out.ANTHROPIC_API_KEY, undefined);
  assert.equal(out.OPENAI_API_KEY, undefined);
});

test("P0: filterSensitiveEnv allowKeys with multiple entries", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV, {
    allowKeys: ["HARNESS_TOKEN", "ANTHROPIC_API_KEY"],
  });
  assert.equal(out.HARNESS_TOKEN, "harness-32-byte-hex...");
  assert.equal(out.ANTHROPIC_API_KEY, "sk-ant-...");
  // Not in allow list → dropped.
  assert.equal(out.OPENAI_API_KEY, undefined);
  assert.equal(out.GITHUB_TOKEN, undefined);
});

// ── extraDrop ───────────────────────────────────────────────────────

test("P0: filterSensitiveEnv extraDrop removes specified non-pattern keys", () => {
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV, {
    extraDrop: ["SOME_PUBLIC_VAR", "NODE_ENV"],
  });
  assert.equal(out.SOME_PUBLIC_VAR, undefined);
  assert.equal(out.NODE_ENV, undefined);
  // Pattern matches still removed.
  assert.equal(out.HARNESS_TOKEN, undefined);
  // Other benign preserved.
  assert.equal(out.PATH, "/usr/local/bin:/usr/bin");
});

test("P0: filterSensitiveEnv extraDrop applies before allowKeys (extraDrop wins)", () => {
  // If a key is in BOTH extraDrop AND allowKeys, extraDrop wins (defense
  // in depth — explicit drop is operator intent).
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV, {
    extraDrop: ["HARNESS_TOKEN"],
    allowKeys: ["HARNESS_TOKEN"],
  });
  assert.equal(out.HARNESS_TOKEN, undefined,
    "extraDrop must override allowKeys");
});

// ── input edge cases ───────────────────────────────────────────────

test("P0: filterSensitiveEnv handles null / undefined parentEnv", () => {
  assert.deepEqual(filterSensitiveEnv(null), {});
  assert.deepEqual(filterSensitiveEnv(undefined), {});
  assert.deepEqual(filterSensitiveEnv(), {});
});

test("P0: filterSensitiveEnv handles empty parentEnv", () => {
  assert.deepEqual(filterSensitiveEnv({}), {});
});

test("P0: filterSensitiveEnv with no opts behaves identically to opts={}", () => {
  const a = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  const b = filterSensitiveEnv(REAL_WORLD_PARENT_ENV, {});
  assert.deepEqual(a, b);
});

// ── regex export ───────────────────────────────────────────────────

test("P0: SENSITIVE_KEY_RE matches expected names + rejects benign", () => {
  // Keep the regex pinned so a careless future change can't quietly
  // narrow the threat model.
  for (const sensitive of ["TOKEN", "token", "MyTOKENvar", "API_KEY", "Password",
                            "MY_SECRET", "credential_x", "DB_PASSWORD"]) {
    assert.ok(SENSITIVE_KEY_RE.test(sensitive), `expected ${sensitive} to match`);
  }
  for (const benign of ["PATH", "HOME", "LANG", "USERPROFILE", "NODE_ENV",
                         "HARNESS_PORT", "HARNESS_HOST", "DEBUG", "TMP"]) {
    assert.ok(!SENSITIVE_KEY_RE.test(benign), `expected ${benign} to NOT match`);
  }
});

// ── HARNESS_DEBUG false-positive negative test ─────────────────────

test("P0: HARNESS_DEBUG is preserved (does not match KEY/TOKEN/SECRET pattern)", () => {
  // Sanity check: the regex shouldn't be too aggressive.
  // HARNESS_DEBUG, HARNESS_PORT, HARNESS_HOST, HARNESS_REMOTE_MODE all benign.
  const out = filterSensitiveEnv(REAL_WORLD_PARENT_ENV);
  assert.equal(out.HARNESS_DEBUG, "1");
  assert.equal(out.HARNESS_PORT, "4201");
  assert.equal(out.HARNESS_HOST, "127.0.0.1");
  assert.equal(out.HARNESS_REMOTE_MODE, "preview");
});
