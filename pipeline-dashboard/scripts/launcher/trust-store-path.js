// Slice E3-F1-a (Phase E, 2026-04-30) — shared trust-store path resolver.
//
// Single source of truth for "where does the launcher / TRUST-STORE-0 UI
// look for the manifest-signing trust file?". Both the launcher (install
// path, runs before the server boots) and the future server-side
// TRUST-STORE-0 management UI must agree on this answer — otherwise an
// operator who adds a key in the UI sees the launcher silently load a
// different file on the next install, and the surface looks broken.
//
// Resolution priority (first match wins):
//
//   1. CLI flag --trust-store <path>
//        Explicit operator override. Used by `node scripts/sign-manifest.js
//        verify --trust-store ...` and by the launcher-cli verify-manifest-
//        signature path. The flag is honored even if the file doesn't exist
//        (fail-closed semantics surface that mistake instead of silently
//        falling through to OS default).
//   2. env HARNESS_TRUST_STORE
//        Direct env override. Useful for portable / USB-stick deployments
//        where the operator points the harness at a single file.
//   3. env HARNESS_CONFIG_DIR + "/trust-store.json"
//        When the operator has set a custom config dir (the pattern
//        `configPaths.js` already supports for profile.json), the trust
//        store rides the same dir. This keeps "all per-installation config
//        in one place" for the operator who needs to back up or migrate.
//   4. OS-conventional default:
//        Windows: %APPDATA%/HarnessPipeline/trust-store.json
//        macOS:   ~/Library/Application Support/HarnessPipeline/trust-store.json
//        Linux:   ${XDG_CONFIG_HOME:-~/.config}/HarnessPipeline/trust-store.json
//   5. Portable install fallback: <installDir>/trust-store.json
//        Only when 4 doesn't exist AND the caller passed installDir.
//        Use case: a portable distribution bundles trust-store.json next
//        to the server.js / harness-start so a fresh USB-stick install
//        works without any env setup.
//
// Steps 1–3 are *explicit operator choice* and are returned even if the
// resolved file doesn't exist on disk yet — letting the caller surface
// "you pointed me at X but it isn't there" instead of silently falling
// through. Step 5's existence check is conditional on step 4 missing,
// so an operator who has both an APPDATA and a portable-install file
// gets the APPDATA path (the explicit per-user location wins).
//
// What this returns:
//   {
//     path:    absolute path string (whether or not the file exists)
//     source:  one of SOURCES.* — for forensic logging
//     exists:  boolean — caller decides what to do with non-existent
//   }
//
// Why we don't load + validate the file content here:
//   - Single responsibility: this file finds the path; manifestSigner.
//     loadTrustStore() validates the schema. Splitting them keeps the
//     resolver testable without needing fixture trust files.
//   - Server-side TRUST-STORE-0 will need the same path resolution
//     before its own atomic-write logic runs. The validation belongs
//     there too, not here.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const APP_NAME = "HarnessPipeline";
const FILENAME = "trust-store.json";

// Frozen so a future caller can't mutate the source vocabulary. The
// audit chain (when wired) keys off these values to render which step
// of the chain produced the result.
const SOURCES = Object.freeze({
  CLI_FLAG: "cli-flag",
  ENV_TRUST_STORE: "env-trust-store",
  ENV_CONFIG_DIR: "env-config-dir",
  OS_DEFAULT: "os-default",
  PORTABLE_INSTALL: "portable-install",
});

/**
 * Resolve the trust-store path using the priority chain documented above.
 *
 * @param {object} [opts]
 * @param {string|null} [opts.cliFlag=null]   - --trust-store <path> CLI value
 * @param {object} [opts.env=process.env]     - injected env for tests
 * @param {string|null} [opts.installDir=null] - install dir (portable fallback)
 * @param {string} [opts.platform=process.platform] - test injection
 * @param {string} [opts.homedir=os.homedir()] - test injection
 * @returns {Readonly<{path: string, source: string, exists: boolean}>}
 */
function resolveTrustStorePath(opts = {}) {
  const cliFlag = (typeof opts.cliFlag === "string" && opts.cliFlag.length > 0)
    ? opts.cliFlag : null;
  const env = opts.env || process.env;
  const installDir = (typeof opts.installDir === "string" && opts.installDir.length > 0)
    ? opts.installDir : null;
  const platform = opts.platform || process.platform;
  const homedir = opts.homedir || os.homedir();

  // 1. Explicit CLI flag
  if (cliFlag) {
    return _result(cliFlag, SOURCES.CLI_FLAG);
  }

  // 2. HARNESS_TRUST_STORE direct override
  if (typeof env.HARNESS_TRUST_STORE === "string" && env.HARNESS_TRUST_STORE.length > 0) {
    return _result(env.HARNESS_TRUST_STORE, SOURCES.ENV_TRUST_STORE);
  }

  // 3. HARNESS_CONFIG_DIR + filename
  if (typeof env.HARNESS_CONFIG_DIR === "string" && env.HARNESS_CONFIG_DIR.length > 0) {
    return _result(path.join(env.HARNESS_CONFIG_DIR, FILENAME), SOURCES.ENV_CONFIG_DIR);
  }

  // 4. OS-conventional default
  const osPath = _osDefaultPath(platform, env, homedir);

  // 5. Portable install fallback — only if OS default doesn't exist AND
  //    the caller hinted an installDir.
  if (installDir && !fs.existsSync(osPath)) {
    const portablePath = path.join(installDir, FILENAME);
    if (fs.existsSync(portablePath)) {
      return _result(portablePath, SOURCES.PORTABLE_INSTALL);
    }
  }

  return _result(osPath, SOURCES.OS_DEFAULT);
}

function _osDefaultPath(platform, env, homedir) {
  if (platform === "win32") {
    // %APPDATA% is set by Windows for every login session. Falling back
    // to the homedir-derived path mirrors configPaths.js so an env that
    // strips APPDATA (some CI runners) still produces a deterministic
    // location.
    const appdata = env.APPDATA || path.join(homedir, "AppData", "Roaming");
    return path.join(appdata, APP_NAME, FILENAME);
  }
  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", APP_NAME, FILENAME);
  }
  // Linux / other Unix — XDG Base Directory spec.
  const xdgConfig = (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.length > 0)
    ? env.XDG_CONFIG_HOME : path.join(homedir, ".config");
  return path.join(xdgConfig, APP_NAME, FILENAME);
}

function _result(p, source) {
  return Object.freeze({
    path: p,
    source,
    exists: fs.existsSync(p),
  });
}

module.exports = {
  resolveTrustStorePath,
  APP_NAME,
  FILENAME,
  SOURCES,
};
