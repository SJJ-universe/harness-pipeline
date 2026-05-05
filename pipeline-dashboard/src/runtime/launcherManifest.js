// Slice D0-a (Phase E1 productization, 2026-04-28) — release manifest validator.
//
// Tiny module that the harness-start launcher invokes via `node` to:
//   1. Validate a downloaded manifest.json against an expected schema
//   2. Verify SHA256 of a downloaded zip against the manifest
//   3. Parse semver-ish version strings for the install path
//
// Keeping this in JS (not PowerShell/bash) so:
//   - Same logic on Windows / macOS / Linux. Cross-platform parity for
//     free without three implementations to keep in sync.
//   - Unit-testable via `node --test`. PS-only logic would be hard to
//     mock + run in CI.
//   - Launcher scripts (.bat, .sh) shrink to thin wrappers — they
//     download the zip + manifest, then `node ... validateAndExtract`.
//
// Trust scope reminder (per Phase E plan §O-D0):
//
//   D0 is INTERNAL/PRIVATE release scope only. SHA256 trust-on-first-use
//   is sufficient for trusted internal distribution channels. A public
//   release reaches operators via E3 Release Hygiene (manifest signing
//   or GitHub Release asset signed verification). The launcher scripts
//   that consume this module print a banner reminding operators of
//   that scope until E3 lands.

"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

// Regex anchors a semver-ish version: 1.2.3 or 1.2.3-rc.1 or 1.2.3+build.7.
// Strict enough to keep path-traversal and shell-meta out, lenient enough
// to accept GitHub release tags people actually use.
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

// SHA256 hex output length (32 bytes * 2 hex chars).
const SHA256_HEX_LEN = 64;

// Required manifest fields — every release MUST advertise these so the
// launcher can do its job without guesses.
const REQUIRED_FIELDS = [
  "version",      // semver-ish string
  "url",          // https URL to the zip
  "sha256",       // 64-char lowercase hex
  "publishedAt",  // ISO 8601 timestamp
  "minNodeVersion", // semver-ish; launcher refuses to start older runtimes
];

/**
 * Validate manifest schema. Returns either { ok: true, manifest } or
 * { ok: false, errors: [string] } so the launcher can print every
 * validation issue at once instead of one-at-a-time runs.
 *
 * @param {*} raw - parsed JSON object (caller did JSON.parse)
 * @returns {{ ok: boolean, manifest?: object, errors?: string[] }}
 */
function validateManifestSchema(raw) {
  const errors = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["manifest is not a JSON object"] };
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in raw)) errors.push(`missing required field "${f}"`);
  }

  // Field-shape checks (only run when the field is present; bail otherwise).
  if (typeof raw.version === "string" && !VERSION_RE.test(raw.version)) {
    errors.push(`version "${raw.version}" is not a valid semver-ish identifier`);
  }
  if (typeof raw.url === "string" && !/^https:\/\//.test(raw.url)) {
    // SMART-ARC-PROBE-SCHEMA-FIX follow-up (2026-05-05):
    // The fetch-stage validator (launcher-cli validate-manifest-url)
    // already honors HARNESS_ALLOW_INSECURE_MANIFEST_URL=1 with a LOUD
    // warning + dev-only contract. Extending the same env override to
    // the manifest BODY's url field keeps the relaxation surface a
    // single env variable (operators don't have to remember two flags).
    // Production posture (env unset) keeps the strict https:// rule.
    if (process.env.HARNESS_ALLOW_INSECURE_MANIFEST_URL === "1") {
      // Permitted in dev — the upstream validator already warned.
    } else {
      errors.push("url must use https:// (plain http blocked to prevent in-transit tampering)");
    }
  }
  if (typeof raw.sha256 === "string") {
    if (raw.sha256.length !== SHA256_HEX_LEN) {
      errors.push(`sha256 must be ${SHA256_HEX_LEN}-char hex (got ${raw.sha256.length})`);
    }
    if (!/^[0-9a-f]+$/.test(raw.sha256)) {
      errors.push("sha256 must be lowercase hex (mixed-case rejected to keep comparisons trivial)");
    }
  }
  if (typeof raw.publishedAt === "string") {
    if (Number.isNaN(Date.parse(raw.publishedAt))) {
      errors.push(`publishedAt "${raw.publishedAt}" is not a parseable ISO 8601 timestamp`);
    }
  }
  if (typeof raw.minNodeVersion === "string" && !VERSION_RE.test(raw.minNodeVersion)) {
    errors.push(`minNodeVersion "${raw.minNodeVersion}" is not valid semver`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: raw };
}

/**
 * Compute SHA256 of a file synchronously. Used by the launcher right
 * after the zip download finishes — small enough that streaming isn't
 * worth the API complexity (release zips are ~70MB, fine to hash in one
 * pass).
 *
 * @param {string} filePath - absolute path to the file
 * @returns {string} lowercase hex
 */
function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  // Read in 64KB chunks so memory stays bounded for large zips.
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/**
 * Constant-time string comparison for hex strings of equal length.
 * Defense in depth — even though the launcher is local, an attacker
 * with a side-channel could in principle exploit early-exit string
 * comparison to leak info about the expected hash.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeHexEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch (_) {
    return false;
  }
}

/**
 * Verify a downloaded zip against the manifest's expected SHA256.
 * Returns { ok, actual, expected } regardless of outcome so the
 * caller can log both for forensics on mismatch.
 *
 * @param {string} filePath
 * @param {string} expectedSha256
 * @returns {{ ok: boolean, actual: string, expected: string }}
 */
function verifySha256(filePath, expectedSha256) {
  const expected = String(expectedSha256 || "").toLowerCase();
  const actual = sha256OfFile(filePath);
  return {
    ok: timingSafeHexEqual(actual, expected),
    actual,
    expected,
  };
}

/**
 * Compare two semver-ish strings. Returns -1 / 0 / 1 like Array.sort.
 * Pre-release suffixes are not deeply compared (rare for the launcher's
 * concerns); a string with a `-suffix` sorts AFTER the same prefix
 * without one, which is the conservative direction for `minNodeVersion`
 * style checks.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareSemver(a, b) {
  if (typeof a !== "string" || typeof b !== "string") {
    throw new TypeError("compareSemver requires two strings");
  }
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) {
    throw new Error(`compareSemver: invalid version (a=${a}, b=${b})`);
  }
  const aParts = a.split(/[-+]/, 1)[0].split(".").map(Number);
  const bParts = b.split(/[-+]/, 1)[0].split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (aParts[i] < bParts[i]) return -1;
    if (aParts[i] > bParts[i]) return 1;
  }
  // Major.Minor.Patch tie. Pre-release < release; release = release.
  const aPre = a.includes("-");
  const bPre = b.includes("-");
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return 1;
  return 0;
}

/**
 * Helper for the launcher: given a runtime version (e.g. node --version)
 * and a manifest, verify the runtime meets minNodeVersion.
 * Returns { ok: boolean, reason?: string }.
 *
 * @param {string} runtimeVersion - e.g. "v24.0.1" or "24.0.1"
 * @param {object} manifest - validated manifest (post validateManifestSchema)
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkRuntimeVersion(runtimeVersion, manifest) {
  const stripped = String(runtimeVersion || "").replace(/^v/, "");
  if (!VERSION_RE.test(stripped)) {
    return { ok: false, reason: `runtime version "${runtimeVersion}" not valid semver` };
  }
  try {
    const cmp = compareSemver(stripped, manifest.minNodeVersion);
    if (cmp < 0) {
      return {
        ok: false,
        reason: `runtime ${stripped} < required ${manifest.minNodeVersion}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  REQUIRED_FIELDS,
  VERSION_RE,
  SHA256_HEX_LEN,
  validateManifestSchema,
  sha256OfFile,
  timingSafeHexEqual,
  verifySha256,
  compareSemver,
  checkRuntimeVersion,
};
