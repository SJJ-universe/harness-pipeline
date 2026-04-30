// Slice E3-F1-a (Phase E, 2026-04-30) — trust-store-path resolver tests.
//
// The resolver is the SINGLE source of truth for "where does the trust
// file live?" between the launcher (install path, F1-b/d) and the future
// TRUST-STORE-0 management UI. A regression here means the launcher
// loads the wrong trust file from the file the UI just wrote — silent
// drift. Tests pin every priority-chain branch + every OS default.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const RESOLVER_PATH = path.resolve(
  __dirname, "..", "..", "scripts", "launcher", "trust-store-path.js",
);
const { resolveTrustStorePath, FILENAME, SOURCES } = require(RESOLVER_PATH);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ts-path-test-"));
}

test("resolver: CLI flag wins over every other source", () => {
  const dir = tmpDir();
  const flagPath = path.join(dir, "explicit.json");
  // Even with all other envs set, --trust-store overrides.
  const r = resolveTrustStorePath({
    cliFlag: flagPath,
    env: {
      HARNESS_TRUST_STORE: path.join(dir, "env.json"),
      HARNESS_CONFIG_DIR: dir,
    },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.path, flagPath);
  assert.equal(r.source, SOURCES.CLI_FLAG);
  // exists=false because we never created the file — the flag is honored
  // even when the file is missing (lets caller surface the mistake).
  assert.equal(r.exists, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: HARNESS_TRUST_STORE wins over CONFIG_DIR + OS default", () => {
  const dir = tmpDir();
  const envPath = path.join(dir, "env-direct.json");
  fs.writeFileSync(envPath, "{}");
  const r = resolveTrustStorePath({
    env: {
      HARNESS_TRUST_STORE: envPath,
      HARNESS_CONFIG_DIR: dir,
    },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.path, envPath);
  assert.equal(r.source, SOURCES.ENV_TRUST_STORE);
  assert.equal(r.exists, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: HARNESS_CONFIG_DIR appends FILENAME", () => {
  const dir = tmpDir();
  // No file yet — exists must be false but path must be deterministic.
  const r = resolveTrustStorePath({
    env: { HARNESS_CONFIG_DIR: dir },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.path, path.join(dir, FILENAME));
  assert.equal(r.source, SOURCES.ENV_CONFIG_DIR);
  assert.equal(r.exists, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: Windows OS default uses %APPDATA%/HarnessPipeline", () => {
  const dir = tmpDir();
  const appdata = path.join(dir, "AppData", "Roaming");
  fs.mkdirSync(appdata, { recursive: true });
  const r = resolveTrustStorePath({
    env: { APPDATA: appdata },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.path, path.join(appdata, "HarnessPipeline", FILENAME));
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: macOS OS default uses Library/Application Support", () => {
  const dir = tmpDir();
  const r = resolveTrustStorePath({
    env: {},
    platform: "darwin",
    homedir: dir,
  });
  assert.equal(r.path, path.join(
    dir, "Library", "Application Support", "HarnessPipeline", FILENAME,
  ));
  assert.equal(r.source, SOURCES.OS_DEFAULT);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: Linux OS default follows XDG (XDG_CONFIG_HOME wins over ~/.config)", () => {
  const dir = tmpDir();
  const xdg = path.join(dir, "custom-xdg");
  const r1 = resolveTrustStorePath({
    env: { XDG_CONFIG_HOME: xdg },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r1.path, path.join(xdg, "HarnessPipeline", FILENAME));

  // Without XDG_CONFIG_HOME, fall back to ~/.config.
  const r2 = resolveTrustStorePath({
    env: {},
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r2.path, path.join(dir, ".config", "HarnessPipeline", FILENAME));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: portable install fallback only fires when OS default missing", () => {
  const dir = tmpDir();
  const homedir = path.join(dir, "home");
  const installDir = path.join(dir, "install-root");
  fs.mkdirSync(homedir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });

  // OS default doesn't exist; portable file does → portable wins.
  const portablePath = path.join(installDir, FILENAME);
  fs.writeFileSync(portablePath, "{}");
  const r1 = resolveTrustStorePath({
    env: {},
    platform: "linux",
    homedir,
    installDir,
  });
  assert.equal(r1.path, portablePath);
  assert.equal(r1.source, SOURCES.PORTABLE_INSTALL);

  // Now place an OS-default file too. OS default wins (per priority).
  const osPath = path.join(homedir, ".config", "HarnessPipeline", FILENAME);
  fs.mkdirSync(path.dirname(osPath), { recursive: true });
  fs.writeFileSync(osPath, "{}");
  const r2 = resolveTrustStorePath({
    env: {},
    platform: "linux",
    homedir,
    installDir,
  });
  assert.equal(r2.path, osPath);
  assert.equal(r2.source, SOURCES.OS_DEFAULT);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: priority order documented in source matches behavior", () => {
  // Sanity check: cliFlag > env-trust-store > config-dir > os-default
  // (portable install only when os-default is missing).
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "AppData", "Roaming", "HarnessPipeline"), { recursive: true });

  // 1. With cliFlag set + everything else: cliFlag wins.
  let r = resolveTrustStorePath({
    cliFlag: "/cli-flag-path",
    env: {
      HARNESS_TRUST_STORE: "/env-direct-path",
      HARNESS_CONFIG_DIR: "/config-dir",
      APPDATA: path.join(dir, "AppData", "Roaming"),
    },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.CLI_FLAG);

  // 2. Drop cliFlag: env direct wins.
  r = resolveTrustStorePath({
    env: {
      HARNESS_TRUST_STORE: "/env-direct-path",
      HARNESS_CONFIG_DIR: "/config-dir",
      APPDATA: path.join(dir, "AppData", "Roaming"),
    },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.ENV_TRUST_STORE);

  // 3. Drop env direct: config-dir wins.
  r = resolveTrustStorePath({
    env: {
      HARNESS_CONFIG_DIR: "/config-dir",
      APPDATA: path.join(dir, "AppData", "Roaming"),
    },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.ENV_CONFIG_DIR);

  // 4. Drop config-dir: os-default wins.
  r = resolveTrustStorePath({
    env: { APPDATA: path.join(dir, "AppData", "Roaming") },
    platform: "win32",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.OS_DEFAULT);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: empty/whitespace cliFlag is ignored", () => {
  const dir = tmpDir();
  const envPath = path.join(dir, "x.json");
  fs.writeFileSync(envPath, "{}");
  // Empty string is treated as "no flag" — falls through to env.
  const r = resolveTrustStorePath({
    cliFlag: "",
    env: { HARNESS_TRUST_STORE: envPath },
    platform: "linux",
    homedir: dir,
  });
  assert.equal(r.source, SOURCES.ENV_TRUST_STORE);
  assert.equal(r.path, envPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolver: result object is frozen (immutable across callers)", () => {
  const r = resolveTrustStorePath({
    env: { HARNESS_TRUST_STORE: "/some/path" },
    platform: "linux",
    homedir: os.tmpdir(),
  });
  assert.throws(() => { r.path = "/mutated"; }, /read.only|Cannot|TypeError/i,
    "result must be frozen so a downstream caller can't mutate the audit-emitted source",
  );
});

test("resolver: SOURCES vocabulary is frozen", () => {
  assert.throws(() => { SOURCES.NEW_KEY = "new"; }, /read.only|Cannot|TypeError/i);
  // Five canonical sources — mirrors the priority chain.
  const expected = ["cli-flag", "env-trust-store", "env-config-dir", "os-default", "portable-install"];
  const got = Object.values(SOURCES).sort();
  assert.deepEqual(got, expected.sort());
});
