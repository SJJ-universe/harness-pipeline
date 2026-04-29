// Slice D0-a (Phase E1 productization, 2026-04-28) — OS-aware config paths.
//
// Single source of truth for "where does the harness store its config /
// data / runs / version installs". Every Phase E module that needs to
// read/write per-installation state goes through `resolve()`.
//
// Why this lives here (not inline in server.js):
//
//   - Cross-platform: Windows uses %APPDATA% (roaming) + %LOCALAPPDATA%
//     (non-roaming), macOS uses ~/Library/Application Support/, Linux
//     follows XDG (`~/.config/...`, `~/.local/share/...`). Inline in
//     server.js would mean three platform branches scattered.
//   - Portable mode: HARNESS_CONFIG_DIR + HARNESS_DATA_DIR env overrides
//     let an operator put everything on a USB stick or a per-user
//     wrapper. Centralizing makes the override one read.
//   - Test isolation: tests can pass synthetic paths via the env
//     overrides without touching real %APPDATA%.
//   - Phase E D0 (launcher) consumes VERSION_DIR; D1 (profileStore)
//     consumes PROFILE_FILE; D2 (wizard) consumes RUN_DIR / LOG_DIR.
//     Each downstream module imports the paths it needs.
//
// Roaming vs. non-roaming distinction (Windows):
//
//   APPDATA  (%APPDATA%)        : roams with the user across machines
//                                 in domain environments. Small, mostly
//                                 settings (profiles.json, preferences).
//   LOCALAPPDATA (%LOCALAPPDATA%): stays on the local machine. Larger
//                                 (logs, run audit chains, version
//                                 installs). Wouldn't make sense to
//                                 sync across machines.
//
// macOS / Linux don't have the same distinction natively; we map both
// names onto the same conventional locations to keep callers happy
// without per-platform branching.

"use strict";

const path = require("node:path");
const os = require("node:os");

const APP_NAME = "HarnessPipeline";

/**
 * Resolve OS-appropriate config + data directories. Reads env overrides
 * first so test fixtures and portable-mode launchers can redirect.
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env] - env source (test injection)
 * @param {string} [opts.platform=process.platform] - "win32" | "darwin" | "linux" | other
 * @param {string} [opts.homedir=os.homedir()] - test injection
 * @returns {{
 *   appName: string,
 *   appdataConfig: string,
 *   localAppdataData: string,
 *   logDir: string,
 *   runDir: string,
 *   versionsDir: string,
 *   profileFile: string,
 *   resolvedFrom: { config: "env"|"os-default", data: "env"|"os-default" }
 * }}
 */
function resolve(opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const homedir = opts.homedir || os.homedir();

  // Step 1: explicit env overrides win.
  const envConfig = env.HARNESS_CONFIG_DIR;
  const envData = env.HARNESS_DATA_DIR;

  // Step 2: OS defaults.
  let osDefaultConfig;
  let osDefaultData;
  if (platform === "win32") {
    // %APPDATA% / %LOCALAPPDATA% — set by Windows for every user session.
    // If absent (rare; e.g. broken process env), fall back to homedir.
    const appdata = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    const localAppdata = env.LOCALAPPDATA || path.join(homedir, "AppData", "Local");
    osDefaultConfig = path.join(appdata, APP_NAME, "config");
    osDefaultData = path.join(localAppdata, APP_NAME);
  } else if (platform === "darwin") {
    // macOS convention: ~/Library/Application Support is the standard
    // location for both config and data. We keep them as sub-folders
    // ("config" and "data") for parity with Windows roam/local split.
    const base = path.join(homedir, "Library", "Application Support", APP_NAME);
    osDefaultConfig = path.join(base, "config");
    osDefaultData = path.join(base, "data");
  } else {
    // Linux / other Unix: XDG Base Directory spec.
    // XDG_CONFIG_HOME defaults to ~/.config, XDG_DATA_HOME to ~/.local/share.
    const xdgConfig = env.XDG_CONFIG_HOME || path.join(homedir, ".config");
    const xdgData = env.XDG_DATA_HOME || path.join(homedir, ".local", "share");
    osDefaultConfig = path.join(xdgConfig, APP_NAME);
    osDefaultData = path.join(xdgData, APP_NAME);
  }

  const appdataConfig = envConfig || osDefaultConfig;
  const localAppdataData = envData || osDefaultData;

  return {
    appName: APP_NAME,
    appdataConfig,
    localAppdataData,
    logDir: path.join(localAppdataData, "logs"),
    runDir: path.join(localAppdataData, "runs"),
    // Versions live under data dir because each install can be ~70MB
    // (node_modules included). Roaming would be wasteful + slow.
    versionsDir: path.join(localAppdataData, "versions"),
    // profiles.json roams (small, user-bound). Phase E D1 consumes this.
    profileFile: path.join(appdataConfig, "profiles.json"),
    resolvedFrom: {
      config: envConfig ? "env" : "os-default",
      data: envData ? "env" : "os-default",
    },
  };
}

/**
 * Resolve the install dir for a specific version.
 * Used by D0 launcher (`install-version.ps1`/`sh`) when extracting a
 * release zip into `versionsDir/<version>/`.
 *
 * @param {string} version - semver-ish, validated by caller
 * @param {object} [opts] - same options as resolve()
 * @returns {string} absolute path
 */
function versionInstallDir(version, opts = {}) {
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("versionInstallDir: version must be a non-empty string");
  }
  // Reject path-traversal attempts. Versions look like "1.2.3" or "1.2.3-rc.1".
  if (/[/\\]|\.\./.test(version)) {
    throw new Error(`versionInstallDir: invalid version "${version}"`);
  }
  const base = resolve(opts);
  return path.join(base.versionsDir, version);
}

module.exports = {
  APP_NAME,
  resolve,
  versionInstallDir,
};
