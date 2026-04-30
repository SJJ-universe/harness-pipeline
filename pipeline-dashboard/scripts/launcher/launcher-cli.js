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
//   node launcher-cli.js validate-manifest-url <url>
//        → exit 0 if the URL is acceptable for fetching a manifest
//        → exit 1 if the URL violates trust scope (non-https, blank, etc.)
//        Centralizes the scheme check so PowerShell + bash can share one
//        source of truth. Set HARNESS_ALLOW_INSECURE_MANIFEST_URL=1 to
//        permit http://, file://, or other schemes for dev/test only.
//        D0-e (Phase E1, 2026-04-29): closes the gap where the manifest
//        fetch URL itself was unverified — we used to validate the *zip*
//        URL inside the manifest but accepted any scheme to fetch the
//        manifest, which is the first thing an MITM attacker would target.
//
//   node launcher-cli.js verify-health <url>
//        → exit 0 if the URL serves a HarnessPipeline /api/health response
//        → exit 1 if the response is missing, non-JSON, or app != "HarnessPipeline"
//        Used by harness-start.bat / .sh to confirm "already running"
//        is actually OUR server — without this discriminator, an
//        unrelated service squatting on port 4201 would let the
//        launcher skip startup and open the browser into someone
//        else's app. D0-e closes that gap.
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

function cmdVerifyHealth(args) {
  // Slice D0-e (Phase E1, 2026-04-29): launcher port-squat defense.
  //
  // The launcher's "already running" branch fires when GET /api/health
  // returns 200. Pre-D0-e the body was {status:"ok"}, indistinguishable
  // from any random "I'm alive" endpoint another service might serve.
  // After D0-e the body includes {app:"HarnessPipeline", healthVersion}
  // and this command checks for that discriminator before the launcher
  // trusts the "already running" path.
  //
  // We use http(s) module directly (not fetch) because the launcher
  // ships with a bare Node and the node_modules dir is the version
  // we just installed — we want this CLI to work even pre-extraction.
  const [url] = args;
  if (!url) fail("verify-health: missing <url> argument", 2);

  const http = require("node:http");
  const https = require("node:https");
  const { URL } = require("node:url");

  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    fail(`verify-health: invalid URL "${url}"`);
  }

  const lib = parsed.protocol === "https:" ? https : http;
  const req = lib.get(url, { timeout: 3000 }, (res) => {
    if (res.statusCode !== 200) {
      process.stderr.write(`verify-health: HTTP ${res.statusCode}\n`);
      res.resume();
      process.exit(1);
    }
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      let body;
      try {
        body = JSON.parse(text);
      } catch (_) {
        process.stderr.write(`verify-health: response is not JSON\n`);
        process.exit(1);
      }
      // Must be a HarnessPipeline server. Accept any healthVersion the
      // server advertises (forward-compatible — newer servers may bump
      // the version when they add fields, but the discriminator stays).
      if (body && body.app === "HarnessPipeline") {
        process.stdout.write(JSON.stringify({
          ok: true,
          app: body.app,
          healthVersion: body.healthVersion,
        }) + "\n");
        process.exit(0);
      }
      process.stderr.write(
        `verify-health: response missing app="HarnessPipeline" ` +
        `(got ${JSON.stringify(body)}) — refusing to assume already-running\n`,
      );
      process.exit(1);
    });
  });
  req.on("timeout", () => {
    try { req.destroy(); } catch (_) {}
    process.stderr.write(`verify-health: request timed out\n`);
    process.exit(1);
  });
  req.on("error", (err) => {
    process.stderr.write(`verify-health: ${err.message}\n`);
    process.exit(1);
  });
}

function cmdValidateManifestUrl(args) {
  // Slice D0-e (Phase E1, 2026-04-29): scheme enforcement for the
  // manifest URL itself (separate from the zip URL inside the manifest,
  // which is checked by validate-manifest-schema). The launcher fetches
  // the manifest before any signature exists, so the only protection
  // we have at that step is "trust the channel" — and that means the
  // channel must be HTTPS.
  //
  // The HARNESS_ALLOW_INSECURE_MANIFEST_URL escape hatch exists for
  // local dev (file:// fixtures, http://localhost test servers). It is
  // off by default and the launcher prints a loud banner whenever a
  // run uses it, so an operator can never quietly drift from the safe
  // default in production.
  const [url] = args;
  if (!url) fail("validate-manifest-url: missing <url> argument", 2);

  if (typeof url !== "string" || url.length === 0) {
    fail("validate-manifest-url: URL must be a non-empty string");
  }

  // Defend against accidental whitespace from CLI args / config files.
  const trimmed = url.trim();
  if (trimmed !== url) {
    fail(`validate-manifest-url: URL has leading/trailing whitespace`);
  }

  const allowInsecure = process.env.HARNESS_ALLOW_INSECURE_MANIFEST_URL === "1";

  // Strict accept: https:// only. Anything else falls through to either
  // the dev-only escape hatch or hard reject. Using URL parsing (not a
  // regex) so we get correct handling of credentials/ports/paths.
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (_) {
    fail(`validate-manifest-url: "${trimmed}" is not a valid URL`);
  }

  if (parsed.protocol === "https:") {
    process.stdout.write(`ok https ${parsed.host}\n`);
    process.exit(0);
  }

  if (allowInsecure) {
    // Loud stderr banner so the operator sees this in any mode (CI,
    // interactive, scheduled task). Exit 0 because the operator opted
    // in, but we want the audit trail.
    process.stderr.write(
      `[validate-manifest-url] WARNING: accepting non-https URL ` +
      `"${trimmed}" because HARNESS_ALLOW_INSECURE_MANIFEST_URL=1. ` +
      `This is dev-only — never enable in production.\n`,
    );
    process.stdout.write(`ok insecure ${parsed.protocol}\n`);
    process.exit(0);
  }

  process.stderr.write(
    `[validate-manifest-url] rejected: "${trimmed}" uses scheme ` +
    `"${parsed.protocol}" (https:// required). Set ` +
    `HARNESS_ALLOW_INSECURE_MANIFEST_URL=1 to override for dev only.\n`,
  );
  process.exit(1);
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

// Slice GOV-RELEASE-0 (2026-04-30): manifest signature verification.
// Used by the launcher when HARNESS_REQUIRE_SIGNED_MANIFEST=1 OR the
// manifest contains a `signature` field (auto-detect). The trust
// store path is resolved via `trust-store-path.js` (Slice E3-F1-a)
// from --trust-store flag, HARNESS_TRUST_STORE env, HARNESS_CONFIG_DIR,
// OS default, or portable install (in priority order). Sharing the
// resolver with the future TRUST-STORE-0 management UI keeps "where
// the trust file lives" answer the same on both sides.
function cmdVerifyManifestSignature(args) {
  const manifestPath = args[0];
  if (!manifestPath) fail("verify-manifest-signature: missing <path>", 2);
  const trustFlagIdx = args.indexOf("--trust-store");
  const cliFlag = (trustFlagIdx >= 0 && args[trustFlagIdx + 1]) || null;
  const installFlagIdx = args.indexOf("--install-dir");
  const installDir = (installFlagIdx >= 0 && args[installFlagIdx + 1]) || null;

  const { resolveTrustStorePath } = require("./trust-store-path");
  const resolved = resolveTrustStorePath({ cliFlag, installDir });
  if (!resolved.exists) {
    // Caller of verify-manifest-signature MUST point at an existing
    // trust file. The matrix in install-version.{ps1,sh} chooses what
    // to do when the trust file is missing (fail-closed by default).
    process.stderr.write(`verify-manifest-signature: trust store not found at ${resolved.path} (source=${resolved.source})\n`);
    process.exit(2);
  }

  let manifest, parsedTrust;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); }
  catch (err) { fail(`cannot read manifest: ${err.message}`, 2); }
  try { parsedTrust = JSON.parse(fs.readFileSync(resolved.path, "utf-8")); }
  catch (err) { fail(`cannot read trust store at ${resolved.path}: ${err.message}`, 2); }
  const { verifyManifestSignature, loadTrustStore } = require("../../src/security/manifestSigner");
  const ts = loadTrustStore(parsedTrust);
  if (!ts.ok) fail(`trust store invalid: ${ts.reason}`, 2);
  const result = verifyManifestSignature({ manifest, trustStore: ts.trustStore });
  if (result.ok) {
    // stdout in machine-parseable form for install-version.{ps1,sh}'s
    // launcher_signature_verified audit emission. Source path is
    // included so forensics can tell which trust file ratified.
    process.stdout.write(JSON.stringify({
      ok: true,
      keyId: result.keyId,
      keyLabel: result.keyLabel || null,
      trustStorePath: resolved.path,
      trustStoreSource: resolved.source,
    }) + "\n");
    process.exit(0);
  }
  // Distinguish unknown_key_id from other failures so install-version
  // can map to its dedicated exit-38 code (vs 37 for everything else).
  // We deliberately do NOT write to stderr here — PowerShell 5.1 with
  // $ErrorActionPreference=Stop crashes on a native exe's stderr line,
  // and the stderr text would just duplicate the JSON message field.
  // The launcher script reads exit code + parses stdout JSON.
  process.stdout.write(JSON.stringify({
    ok: false,
    reason: result.reason,
    detail: result.detail || null,
    message: `signature FAIL: ${result.reason}${result.detail ? " (" + result.detail + ")" : ""}`,
    keyId: result.keyId || null,
    trustStorePath: resolved.path,
    trustStoreSource: resolved.source,
  }) + "\n");
  process.exit(1);
}

// Slice E3-F1-a (Phase E, 2026-04-30): expose trust-store path resolution
// to PowerShell + bash. The launcher scripts need to know "where would
// a trust file live, and is one there now?" before they decide what to
// do under the F1 fail-closed matrix. Centralizing in launcher-cli
// matches the existing pattern (resolve-paths, version-install-dir).
//
// stdout is the resolver's full result as JSON so the calling shell
// can branch on `source` (forensics) and `exists` (matrix decision).
function cmdResolveTrustStorePath(args) {
  let cliFlag = null;
  let installDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trust-store" && i + 1 < args.length) {
      cliFlag = args[i + 1]; i += 1;
    } else if (args[i] === "--install-dir" && i + 1 < args.length) {
      installDir = args[i + 1]; i += 1;
    }
  }
  const { resolveTrustStorePath } = require("./trust-store-path");
  const resolved = resolveTrustStorePath({ cliFlag, installDir });
  process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
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
  "validate-manifest-url": cmdValidateManifestUrl,
  "verify-health": cmdVerifyHealth,
  // GOV-RELEASE-0 + E3-F1
  "verify-manifest-signature": cmdVerifyManifestSignature,
  "resolve-trust-store-path": cmdResolveTrustStorePath,
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
      "  validate-manifest-url <url>",
      "  verify-health <url>",
      "  verify-manifest-signature <path> [--trust-store <path>] [--install-dir <path>]",
      "  resolve-trust-store-path [--trust-store <path>] [--install-dir <path>]",
      "",
    ].join("\n"));
    process.exit(0);
  }
  const handler = COMMANDS[cmd];
  if (!handler) fail(`unknown command "${cmd}" (run with --help)`, 2);
  handler(rest);
}

main();
