#!/usr/bin/env node
//
// Slice D0-b (Phase E1 productization, 2026-04-29) — launcher CLI bridge.
//
// Thin Node CLI that exposes `src/runtime/launcherManifest.js` +
// `src/runtime/configPaths.js` to the PowerShell / bash launcher scripts.
// Without this bridge, launcher scripts would re-implement SHA256 / semver
// / OS-aware path resolution in PowerShell and bash — three sources of
// truth, three sets of subtle bugs. Centralizing here keeps cross-platform
// parity guaranteed by `tests/unit/launcherManifest.test.js` (43 tests).
//
// Usage (called by `install-version.ps1`, `check-update.ps1`, `*.sh`):
//
//   node launcher-cli.js validate-manifest <path>
//        → exit 0 + prints validated JSON to stdout
//        → exit 1 + prints errors[] to stderr
//
//   node launcher-cli.js verify-sha256 <file> <expected-hex>
//        → exit 0 if hashes match, exit 1 if mismatch
//        → stdout: JSON {ok, actual, expected}
//
//   node launcher-cli.js compare-semver <a> <b>
//        → exit 0 always (unless invalid semver, exit 2)
//        → stdout: -1 / 0 / 1 (one digit, no newline complications)
//
//   node launcher-cli.js check-runtime <runtimeVersion> <minVersion>
//        → exit 0 if runtime >= minVersion, exit 1 otherwise
//        → stdout: JSON {ok, reason?}
//
//   node launcher-cli.js resolve-paths
//        → exit 0
//        → stdout: JSON {appdataConfig, localAppdataData, versionsDir, ...}
//        → reads HARNESS_CONFIG_DIR / HARNESS_DATA_DIR env overrides
//
//   node launcher-cli.js version-install-dir <version>
//        → exit 0 + prints absolute path
//        → exit 1 if version contains path-traversal chars
//
//   node launcher-cli.js manifest-field <path> <field>
//        → exit 0 + prints the field value (no JSON quoting)
//        → exit 1 if file unreadable or field missing
//        Used by harness-start.bat / .sh to pull a single field out of
//        a manifest without forking a separate `node -e "..."` (which
//        has cmd.exe quoting hell when the manifest path contains spaces).
//
// All commands print machine-readable JSON to stdout (or, for primitives,
// a single token). PowerShell invokes via `$result = & node ...`; bash
// invokes via `result=$(node ...)`. Exit codes are the primary signal —
// stdout/JSON is for forensics on failure.
//
// Why no `commander`/`yargs`: this script ships in the release zip at
// install time, before `node_modules/` exists for the released version.
// Sticking to Node stdlib means the launcher works against a freshly
// downloaded zip without any pre-install npm step.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Resolve the launcher modules relative to this script's location.
// The bridge sits at `scripts/launcher/launcher-cli.js`; the runtime
// modules live at `src/runtime/`. Keep the relative paths explicit so
// the script works regardless of where the release zip was extracted.
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNTIME_DIR = path.join(REPO_ROOT, "src", "runtime");

// Defer `require()` so a failure (missing file, syntax error) yields
// a structured error rather than a stack trace dump that PowerShell
// would have to parse.
function loadRuntime() {
  try {
    return {
      manifest: require(path.join(RUNTIME_DIR, "launcherManifest")),
      paths: require(path.join(RUNTIME_DIR, "configPaths")),
    };
  } catch (err) {
    process.stderr.write(`launcher-cli: failed to load runtime modules from ${RUNTIME_DIR}: ${err.message}\n`);
    process.exit(3);
  }
}

function fail(msg, code = 1) {
  process.stderr.write(`launcher-cli: ${msg}\n`);
  process.exit(code);
}

function cmdValidateManifest(args) {
  const [manifestPath] = args;
  if (!manifestPath) fail("validate-manifest: missing <path> argument", 2);
  let raw;
  try {
    let text = fs.readFileSync(manifestPath, "utf-8");
    // Strip a leading UTF-8 BOM (U+FEFF) if present — PowerShell 5.1's
    // `Set-Content -Encoding utf8` injects one by default, and some
    // HTTPS servers also include a BOM in JSON bodies. JSON.parse rejects
    // BOM-prefixed input, so trim it before parsing.
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    raw = JSON.parse(text);
  } catch (err) {
    fail(`validate-manifest: cannot read/parse "${manifestPath}": ${err.message}`);
  }
  const { manifest } = loadRuntime();
  const result = manifest.validateManifestSchema(raw);
  if (!result.ok) {
    process.stderr.write(`validate-manifest: ${result.errors.length} error(s):\n`);
    for (const e of result.errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(result.manifest, null, 2) + "\n");
  process.exit(0);
}

function cmdVerifySha256(args) {
  const [filePath, expectedHex] = args;
  if (!filePath || !expectedHex) {
    fail("verify-sha256: usage: verify-sha256 <file> <expected-hex>", 2);
  }
  if (!fs.existsSync(filePath)) {
    fail(`verify-sha256: file not found: ${filePath}`);
  }
  const { manifest } = loadRuntime();
  const result = manifest.verifySha256(filePath, expectedHex);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

function cmdCompareSemver(args) {
  const [a, b] = args;
  if (!a || !b) fail("compare-semver: usage: compare-semver <a> <b>", 2);
  const { manifest } = loadRuntime();
  let cmp;
  try {
    cmp = manifest.compareSemver(a, b);
  } catch (err) {
    fail(`compare-semver: ${err.message}`, 2);
  }
  process.stdout.write(String(cmp));
  process.exit(0);
}

function cmdCheckRuntime(args) {
  const [runtimeVersion, minVersion] = args;
  if (!runtimeVersion || !minVersion) {
    fail("check-runtime: usage: check-runtime <runtime-version> <min-version>", 2);
  }
  const { manifest } = loadRuntime();
  const result = manifest.checkRuntimeVersion(runtimeVersion, { minNodeVersion: minVersion });
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

function cmdResolvePaths() {
  const { paths } = loadRuntime();
  const resolved = paths.resolve();
  process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
  process.exit(0);
}

function cmdVersionInstallDir(args) {
  const [version] = args;
  if (!version) fail("version-install-dir: missing <version> argument", 2);
  const { paths } = loadRuntime();
  let dir;
  try {
    dir = paths.versionInstallDir(version);
  } catch (err) {
    fail(`version-install-dir: ${err.message}`);
  }
  process.stdout.write(dir + "\n");
  process.exit(0);
}

function cmdManifestField(args) {
  const [manifestPath, field] = args;
  if (!manifestPath || !field) {
    fail("manifest-field: usage: manifest-field <path> <field>", 2);
  }
  let raw;
  try {
    let text = fs.readFileSync(manifestPath, "utf-8");
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    raw = JSON.parse(text);
  } catch (err) {
    fail(`manifest-field: cannot read/parse "${manifestPath}": ${err.message}`);
  }
  if (raw === null || typeof raw !== "object") {
    fail("manifest-field: manifest is not a JSON object");
  }
  if (!Object.prototype.hasOwnProperty.call(raw, field)) {
    fail(`manifest-field: field "${field}" not present in manifest`);
  }
  // Print the raw value — primitives go to stdout as-is, objects/arrays
  // are JSON-stringified. Trailing newline so PowerShell's pipeline
  // capture works cleanly; bash's `$(... )` strips trailing newlines.
  const v = raw[field];
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    process.stdout.write(String(v) + "\n");
  } else {
    process.stdout.write(JSON.stringify(v) + "\n");
  }
  process.exit(0);
}

const COMMANDS = {
  "validate-manifest": cmdValidateManifest,
  "verify-sha256": cmdVerifySha256,
  "compare-semver": cmdCompareSemver,
  "check-runtime": cmdCheckRuntime,
  "resolve-paths": cmdResolvePaths,
  "version-install-dir": cmdVersionInstallDir,
  "manifest-field": cmdManifestField,
};

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "--help" || cmd === "-h") {
    process.stdout.write([
      "launcher-cli: bridge for harness-start launcher scripts",
      "",
      "Commands:",
      "  validate-manifest <path>",
      "  verify-sha256 <file> <expected-hex>",
      "  compare-semver <a> <b>",
      "  check-runtime <runtime-version> <min-version>",
      "  resolve-paths",
      "  version-install-dir <version>",
      "  manifest-field <path> <field>",
      "",
    ].join("\n"));
    process.exit(0);
  }
  const handler = COMMANDS[cmd];
  if (!handler) fail(`unknown command "${cmd}" (run with --help)`, 2);
  handler(rest);
}

main();
