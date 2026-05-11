// Slice TRUST-STORE-PATH-IT (Phase 2 v2 follow-up, 2026-05-05) —
// integration test that exercises the FULL trust-store path
// precedence chain in one connected sequence.
//
// Closes acceptance criterion #3 of v1.0.0 Blocker #2 (per
// docs/runbooks/v1-blockers.md §3.3): "The trust-store path
// resolver has at least one integration test that exercises the
// full precedence chain (CLI flag → env → portable → AppData →
// fallback)."
//
// Why this is in tests/integration/ (not tests/unit/):
// The existing tests/unit/trustStorePath.test.js verifies each
// source individually. This file exercises the *transitions*
// between sources by holding all-but-one input fixed and dropping
// inputs in order — proving the precedence is exactly as
// documented in the resolver header. It also exercises the
// portable-install fallback step, which the unit test's
// "priority order" walk skips.
//
// In addition, this test loads the committed fixture
// docs/fixtures/trust-store-example.json and verifies it parses
// + the schema string matches what manifestSigner.loadTrustStore
// will accept. That makes the fixture a *living* reference: a
// future schema change without a fixture update fails this test.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RESOLVER = path.join(REPO_ROOT, "scripts", "launcher", "trust-store-path");
const { resolveTrustStorePath, FILENAME, SOURCES } = require(RESOLVER);
const { loadTrustStore } = require("../../src/security/manifestSigner");

const FIXTURE = path.join(REPO_ROOT, "docs", "fixtures", "trust-store-example.json");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trust-path-it-"));
}

// ── Full precedence chain: 5-step walk ───────────────────────

test("TRUST-STORE-PATH-IT: full 5-step precedence chain in one connected walk", () => {
  // Build a real on-disk environment with BOTH the OS-default file
  // AND the portable-install file present, so step 4's "os-default
  // wins over portable when os-default exists" can be exercised.
  const dir = tmpDir();
  const appdataDir = path.join(dir, "AppData", "Roaming");
  const osDefaultDir = path.join(appdataDir, "OrchestratorPipeline");
  fs.mkdirSync(osDefaultDir, { recursive: true });
  const osDefaultPath = path.join(osDefaultDir, FILENAME);
  fs.writeFileSync(osDefaultPath,
    '{"schema":"orchestrator-release-trust/v1","keys":[]}');

  const installDir = path.join(dir, "install");
  fs.mkdirSync(installDir, { recursive: true });
  const portablePath = path.join(installDir, FILENAME);
  fs.writeFileSync(portablePath,
    '{"schema":"orchestrator-release-trust/v1","keys":[]}');

  // ── Step 1: --trust-store flag wins over EVERY other input ──
  let r = resolveTrustStorePath({
    cliFlag: "/cli-flag-path",
    env: {
      ORCHESTRATOR_TRUST_STORE: "/env-direct-path",
      ORCHESTRATOR_CONFIG_DIR: "/env-config-dir",
      APPDATA: appdataDir,
    },
    installDir,
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.CLI_FLAG,
    "step 1: cliFlag must outrank every other input");
  assert.equal(r.path, "/cli-flag-path");

  // ── Step 2: drop --trust-store; ORCHESTRATOR_TRUST_STORE wins ────
  r = resolveTrustStorePath({
    env: {
      ORCHESTRATOR_TRUST_STORE: "/env-direct-path",
      ORCHESTRATOR_CONFIG_DIR: "/env-config-dir",
      APPDATA: appdataDir,
    },
    installDir,
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.ENV_TRUST_STORE,
    "step 2: ORCHESTRATOR_TRUST_STORE must outrank config-dir + os-default + portable");
  assert.equal(r.path, "/env-direct-path");

  // ── Step 3: drop ORCHESTRATOR_TRUST_STORE; ORCHESTRATOR_CONFIG_DIR wins ──
  r = resolveTrustStorePath({
    env: {
      ORCHESTRATOR_CONFIG_DIR: "/env-config-dir",
      APPDATA: appdataDir,
    },
    installDir,
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.ENV_CONFIG_DIR,
    "step 3: ORCHESTRATOR_CONFIG_DIR must outrank os-default + portable");
  assert.equal(r.path, path.join("/env-config-dir", FILENAME));

  // ── Step 4: drop env vars; OS-default wins over portable
  //          (because os-default file EXISTS on disk) ────────
  r = resolveTrustStorePath({
    env: { APPDATA: appdataDir },
    installDir,
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT,
    "step 4: when os-default file exists, it outranks portable-install " +
    "even with installDir hinted and portable file present");
  assert.equal(r.path, osDefaultPath);
  assert.equal(r.exists, true,
    "step 4: existing os-default file is reported as existing");

  // ── Step 5: portable-install fallback fires when:
  //    - env vars dropped
  //    - OS-default file does NOT exist on disk
  //    - installDir hint provided
  //    - portable file DOES exist on disk
  // Build a fresh isolated env where OS-default file is ABSENT.
  const dir2 = tmpDir();
  const appdataDir2 = path.join(dir2, "AppData", "Roaming");
  // Deliberately do NOT create OrchestratorPipeline/trust-store.json
  // under appdataDir2 — the resolver should fall through to
  // portable.
  const installDir2 = path.join(dir2, "install");
  fs.mkdirSync(installDir2, { recursive: true });
  fs.writeFileSync(path.join(installDir2, FILENAME),
    '{"schema":"orchestrator-release-trust/v1","keys":[]}');

  r = resolveTrustStorePath({
    env: { APPDATA: appdataDir2 },
    installDir: installDir2,
    platform: "win32",
    homedir: dir2,
  });
  assert.equal(r.source, SOURCES.PORTABLE_INSTALL,
    "step 5: portable-install fires when os-default missing AND " +
    "portable file exists AND installDir hinted");
  assert.equal(r.path, path.join(installDir2, FILENAME));
  assert.equal(r.exists, true,
    "step 5: portable file is reported as existing");

  // ── Step 6 (degenerate): nothing exists — os-default path
  //          returned even with exists=false ──────────────────
  const dir3 = tmpDir();
  const appdataDir3 = path.join(dir3, "AppData", "Roaming");
  // No file at all, no installDir hint.
  r = resolveTrustStorePath({
    env: { APPDATA: appdataDir3 },
    platform: "win32",
    homedir: dir3,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT,
    "step 6: with no files anywhere and no installDir, os-default " +
    "is the final fallback");
  assert.equal(r.exists, false,
    "step 6: nonexistent os-default path is reported with exists=false " +
    "so callers can fail-closed");

  // ── Cleanup ─────────────────────────────────────────────────
  fs.rmSync(dir,  { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
  fs.rmSync(dir3, { recursive: true, force: true });
});

// ── Cross-platform OS-default path ───────────────────────────

test("TRUST-STORE-PATH-IT: OS-default path varies by platform (Windows / macOS / Linux)", () => {
  const dir = tmpDir();
  // Windows
  let r = resolveTrustStorePath({
    env: { APPDATA: path.join(dir, "AppData", "Roaming") },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  assert.match(r.path, /AppData[\\/]+Roaming[\\/]+OrchestratorPipeline[\\/]+trust-store\.json$/);

  // macOS
  r = resolveTrustStorePath({
    env: {},
    platform: "darwin",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  assert.match(r.path, /Library[\\/]+Application Support[\\/]+OrchestratorPipeline[\\/]+trust-store\.json$/);

  // Linux + XDG_CONFIG_HOME set
  r = resolveTrustStorePath({
    env: { XDG_CONFIG_HOME: path.join(dir, "xdg") },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  assert.match(r.path, /xdg[\\/]+OrchestratorPipeline[\\/]+trust-store\.json$/);

  // Linux + XDG_CONFIG_HOME unset → ~/.config
  r = resolveTrustStorePath({
    env: {},
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  assert.match(r.path, /\.config[\\/]+OrchestratorPipeline[\\/]+trust-store\.json$/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Result object freezing (audit-chain integrity) ──────────

test("TRUST-STORE-PATH-IT: result object is frozen so callers can't mutate the source", () => {
  const r = resolveTrustStorePath({
    env: { ORCHESTRATOR_TRUST_STORE: "/some/path" },
    platform: "linux",
    homedir: os.tmpdir(),
  });
  // Freezing means the audit chain's recorded `source` value can't
  // be tampered with by a downstream caller.
  assert.throws(() => { r.source = "tampered"; },
    /read.only|Cannot|TypeError/i);
  assert.throws(() => { r.path = "/mutated"; },
    /read.only|Cannot|TypeError/i);
});

// ── Fixture coherence: the example trust-store actually parses ──

test("TRUST-STORE-PATH-IT: docs/fixtures/trust-store-example.json parses + matches schema validator", () => {
  assert.ok(fs.existsSync(FIXTURE),
    "docs/fixtures/trust-store-example.json must exist");
  const raw = fs.readFileSync(FIXTURE, "utf-8");
  let data;
  assert.doesNotThrow(() => { data = JSON.parse(raw); },
    "fixture must be valid JSON");
  // The validator from manifestSigner.js is the gate the launcher uses.
  // The fixture must satisfy it (modulo the placeholder DER).
  const result = loadTrustStore(data);
  assert.equal(result.ok, true,
    "fixture must satisfy manifestSigner.loadTrustStore() — schema + keys[].shape");
  assert.equal(result.trustStore.schema, "orchestrator-release-trust/v1");
  assert.ok(Array.isArray(result.trustStore.keys));
  assert.ok(result.trustStore.keys.length >= 1,
    "fixture must show at least one example key entry for documentation");
  // Each key has the load-bearing shape
  for (const k of result.trustStore.keys) {
    assert.equal(typeof k.keyId, "string");
    assert.equal(typeof k.publicKeyDerBase64, "string");
  }
});

test("TRUST-STORE-PATH-IT: fixture publicKeyDerBase64 is clearly a placeholder (not a real key)", () => {
  const data = JSON.parse(fs.readFileSync(FIXTURE, "utf-8"));
  for (const k of data.keys) {
    // The placeholder must be obvious — uppercase REPLACE_ME or
    // similar so an automated scan flags accidental real-key
    // commits.
    assert.match(k.publicKeyDerBase64, /REPLACE_ME|EXAMPLE|placeholder/i,
      "fixture keys must be marked as placeholders so a real key " +
      "isn't mistaken for the example");
  }
});

// ── Cross-coherence with v1-blockers runbook ────────────────

test("TRUST-STORE-PATH-IT: v1-blockers.md §3.4 references the fixture", () => {
  const runbook = fs.readFileSync(
    path.resolve(REPO_ROOT, "docs", "runbooks", "v1-blockers.md"), "utf-8"
  );
  // §3.4 names the trust-store fixture as a place evidence lives.
  assert.match(runbook, /trust-store-example\.json/,
    "v1-blockers.md must point operators at the fixture");
});
