// Slice D0-a (Phase E1 productization, 2026-04-28) — configPaths tests.
//
// Pin OS-specific layout decisions so a careless future refactor can't
// silently move %APPDATA%-stored data to %LOCALAPPDATA% (which doesn't
// roam) or vice versa. Also pin the env override contract — portable-
// mode launchers depend on it.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolve, versionInstallDir, APP_NAME } = require("../../src/runtime/configPaths");

// ── env override (portable mode + test isolation) ──────────────────

test("D0-a: HARNESS_CONFIG_DIR env override wins over OS default", () => {
  // Use a POSIX path to keep the test cross-platform — node's path.join
  // produces native separators, so a Windows-style "C:\\portable\\config"
  // expectation would fail on Linux CI. The override mechanism itself
  // doesn't care about path style; both are accepted as opaque strings.
  const r = resolve({
    env: { HARNESS_CONFIG_DIR: "/portable/config" },
    platform: "linux",
    homedir: "/home/sj",
  });
  assert.equal(r.appdataConfig, "/portable/config");
  assert.equal(r.resolvedFrom.config, "env");
  // Profile file lives under the overridden config dir.
  assert.equal(r.profileFile, path.join("/portable/config", "profiles.json"));
});

test("D0-a: HARNESS_DATA_DIR env override wins over OS default", () => {
  const r = resolve({
    env: { HARNESS_DATA_DIR: "/mnt/portable/data" },
    platform: "linux",
    homedir: "/home/sj",
  });
  assert.equal(r.localAppdataData, "/mnt/portable/data");
  assert.equal(r.resolvedFrom.data, "env");
  // Logs / runs / versions all under the overridden data dir.
  // Note: path.join uses platform-native separators (forward / on POSIX,
  // backslash on Windows) — use path.join to construct expected so the
  // test passes on every CI runner.
  assert.equal(r.logDir, path.join("/mnt/portable/data", "logs"));
  assert.equal(r.runDir, path.join("/mnt/portable/data", "runs"));
  assert.equal(r.versionsDir, path.join("/mnt/portable/data", "versions"));
});

test("D0-a: env override is independent — config can be overridden alone", () => {
  // Operator might want config in a roaming/synced folder but data on
  // a local SSD. Each override is independent.
  const r = resolve({
    env: { HARNESS_CONFIG_DIR: "/synced/config" },
    platform: "linux",
    homedir: "/home/sj",
  });
  assert.equal(r.resolvedFrom.config, "env");
  assert.equal(r.resolvedFrom.data, "os-default");
  assert.match(r.localAppdataData, /OrchestratorPipeline/);
});

// ── Windows defaults ───────────────────────────────────────────────
//
// Windows-platform branches in resolve() use path.join, which on a
// POSIX test runner still emits posix separators. We use path.join in
// expected values to match whatever separator the runner is actually
// emitting.

test("D0-a: Windows uses %APPDATA% for config (roaming)", () => {
  const APPDATA = path.join("C:\\Users\\SJ", "AppData", "Roaming");
  const LOCALAPPDATA = path.join("C:\\Users\\SJ", "AppData", "Local");
  const r = resolve({
    env: { APPDATA, LOCALAPPDATA },
    platform: "win32",
    homedir: "C:\\Users\\SJ",
  });
  assert.equal(r.appdataConfig, path.join(APPDATA, "OrchestratorPipeline", "config"));
  assert.equal(r.resolvedFrom.config, "os-default");
});

test("D0-a: Windows uses %LOCALAPPDATA% for data (non-roaming)", () => {
  const APPDATA = path.join("C:\\Users\\SJ", "AppData", "Roaming");
  const LOCALAPPDATA = path.join("C:\\Users\\SJ", "AppData", "Local");
  const r = resolve({
    env: { APPDATA, LOCALAPPDATA },
    platform: "win32",
    homedir: "C:\\Users\\SJ",
  });
  assert.equal(r.localAppdataData, path.join(LOCALAPPDATA, "OrchestratorPipeline"));
  assert.equal(r.resolvedFrom.data, "os-default");
});

test("D0-a: Windows falls back to homedir when APPDATA / LOCALAPPDATA env are absent", () => {
  // Rare but possible (broken process env). The fallback should still
  // yield a sane path, not crash.
  const r = resolve({
    env: {},
    platform: "win32",
    homedir: "C:\\Users\\SJ",
  });
  assert.match(r.appdataConfig, /AppData[\\/]Roaming[\\/]OrchestratorPipeline/);
  assert.match(r.localAppdataData, /AppData[\\/]Local[\\/]OrchestratorPipeline/);
});

// ── macOS defaults ─────────────────────────────────────────────────

test("D0-a: macOS uses ~/Library/Application Support", () => {
  const r = resolve({
    env: {},
    platform: "darwin",
    homedir: "/Users/sj",
  });
  assert.equal(
    r.appdataConfig,
    path.join("/Users/sj", "Library", "Application Support", "OrchestratorPipeline", "config"),
  );
  assert.equal(
    r.localAppdataData,
    path.join("/Users/sj", "Library", "Application Support", "OrchestratorPipeline", "data"),
  );
});

// ── Linux / XDG ────────────────────────────────────────────────────

test("D0-a: Linux follows XDG defaults (~/.config + ~/.local/share)", () => {
  const r = resolve({
    env: {},
    platform: "linux",
    homedir: "/home/sj",
  });
  assert.equal(r.appdataConfig, path.join("/home/sj", ".config", "OrchestratorPipeline"));
  assert.equal(r.localAppdataData, path.join("/home/sj", ".local", "share", "OrchestratorPipeline"));
});

test("D0-a: Linux respects XDG_CONFIG_HOME / XDG_DATA_HOME when set", () => {
  const r = resolve({
    env: {
      XDG_CONFIG_HOME: "/custom/xdg/config",
      XDG_DATA_HOME: "/custom/xdg/data",
    },
    platform: "linux",
    homedir: "/home/sj",
  });
  assert.equal(r.appdataConfig, path.join("/custom/xdg/config", "OrchestratorPipeline"));
  assert.equal(r.localAppdataData, path.join("/custom/xdg/data", "OrchestratorPipeline"));
});

test("D0-a: unknown platform falls back to XDG layout", () => {
  // Defensive: BSD / SunOS / etc. should still get a working config dir.
  const r = resolve({
    env: {},
    platform: "freebsd",
    homedir: "/home/sj",
  });
  assert.equal(r.appdataConfig, path.join("/home/sj", ".config", "OrchestratorPipeline"));
  assert.equal(r.localAppdataData, path.join("/home/sj", ".local", "share", "OrchestratorPipeline"));
});

// ── path components ────────────────────────────────────────────────

test("D0-a: derived paths consistently nest under data/config dirs", () => {
  const r = resolve({
    env: { HARNESS_DATA_DIR: "/data", HARNESS_CONFIG_DIR: "/config" },
  });
  assert.equal(r.logDir, path.join("/data", "logs"));
  assert.equal(r.runDir, path.join("/data", "runs"));
  assert.equal(r.versionsDir, path.join("/data", "versions"));
  assert.equal(r.profileFile, path.join("/config", "profiles.json"));
  assert.equal(r.appName, APP_NAME);
});

// ── versionInstallDir ──────────────────────────────────────────────

test("D0-a: versionInstallDir builds paths under versionsDir/<version>/", () => {
  const dir = versionInstallDir("1.1.0", { env: { HARNESS_DATA_DIR: "/data" } });
  assert.equal(dir, path.join("/data", "versions", "1.1.0"));
});

test("D0-a: versionInstallDir accepts pre-release semver", () => {
  const dir = versionInstallDir("1.1.0-rc.1", { env: { HARNESS_DATA_DIR: "/data" } });
  assert.equal(dir, path.join("/data", "versions", "1.1.0-rc.1"));
});

test("D0-a: versionInstallDir rejects path-traversal attempts", () => {
  // Defense: an attacker who controls the manifest can't escape the
  // version dir by setting version to "../../etc/passwd".
  for (const bad of ["../escape", "..\\escape", "/abs/path", "C:\\abs", "1.2.3/sub", "1.2.3\\sub"]) {
    assert.throws(
      () => versionInstallDir(bad, { env: { HARNESS_DATA_DIR: "/data" } }),
      /invalid version/,
      `expected ${bad} to be rejected`,
    );
  }
});

test("D0-a: versionInstallDir rejects empty / non-string version", () => {
  assert.throws(() => versionInstallDir("", { env: { HARNESS_DATA_DIR: "/data" } }), /non-empty/);
  assert.throws(() => versionInstallDir(null, { env: { HARNESS_DATA_DIR: "/data" } }), /non-empty/);
  assert.throws(() => versionInstallDir(undefined, { env: { HARNESS_DATA_DIR: "/data" } }), /non-empty/);
  assert.throws(() => versionInstallDir(123, { env: { HARNESS_DATA_DIR: "/data" } }), /non-empty/);
});

// ── APP_NAME constant pin ──────────────────────────────────────────

test("D0-a: APP_NAME exposed for caller-side path joins", () => {
  // Uninstall scripts and backup tooling may need APP_NAME directly
  // (e.g. to find ~/.config/OrchestratorPipeline). Pin the export.
  assert.equal(APP_NAME, "OrchestratorPipeline");
});
