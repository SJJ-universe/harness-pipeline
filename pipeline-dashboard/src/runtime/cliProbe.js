// Slice D2-a (Phase E1.5, 2026-04-29) — cross-platform CLI discovery.
//
// `discoverCli(name)` resolves a CLI binary's filesystem path by
// searching PATH. Used by:
//
//   src/runtime/providerProbe.js (D2-b)   — locates `claude` / `codex`
//   src/routes/setupRoutes.js   (D2-c)    — POST /api/setup/probe-{claude,codex,node}
//   scripts/setup-wizard.{ps1,sh} (D2-d)  — first-run discovery step
//
// Why a dedicated module rather than inline in each caller:
//
//   - Single test surface for the cross-platform (Windows `where`,
//     POSIX `which`) + line-ending split (Windows CRLF, POSIX LF) +
//     command-injection guard.
//   - The probe is also useful for D3 (UI account-status indicators)
//     which will call the same discovery surface for live "Claude
//     CLI installed?" badges. One implementation, multiple consumers.
//
// Security:
//
//   - `name` is strictly allowlisted via /^[A-Za-z][A-Za-z0-9_.-]*$/
//     so path traversal (`../bin/claude`), absolute paths
//     (`/usr/bin/claude`), and shell metacharacters (`claude;rm`,
//     `claude|cat`) ALL refuse. The probe is not a "run anything by
//     name" tool — it answers "is the CLI named X on this user's
//     PATH?" for a known short list of CLIs.
//   - `shell: false` on every spawnSync call so even a hypothetical
//     bypass of the name allowlist couldn't open a shell.
//   - 5-second timeout so a hung `where`/`which` (eg. unresponsive
//     PATH entry) cannot hang the wizard.
//
// What this function deliberately does NOT do:
//
//   - Validate the discovered binary's signature / SBOM. The wizard
//     trusts the user's PATH choice — if the operator put a forged
//     `claude` first, they have a bigger problem than D2 can solve.
//   - Run the binary. That's providerProbe.js's job (D2-b) and is a
//     separate trust step (token spend / network).
//   - Cache results. The wizard re-probes on each step so the
//     operator can install a CLI mid-flow and re-check.

"use strict";

const { spawnSync } = require("child_process");

// CLI-name allowlist regex. Letters / digits / underscore / dot / dash.
// Must start with a letter (kills numeric-only names that could be
// confused with PIDs). Length is bounded by a separate check so a
// pathological name doesn't pass through to spawn.
const CLI_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const CLI_NAME_MAX_LENGTH = 64;
const PROBE_TIMEOUT_MS = 5000;

/**
 * Resolve a CLI binary's path on the user's system.
 *
 * @param {string} name - binary name. Must match CLI_NAME_REGEX +
 *   length ≤ CLI_NAME_MAX_LENGTH.
 * @param {object} [opts]
 * @param {function} [opts.spawnImpl=spawnSync] - inject for tests.
 * @param {object} [opts.env=process.env] - inject env for tests.
 * @param {number} [opts.timeoutMs=PROBE_TIMEOUT_MS] - per-call timeout.
 * @param {string} [opts.platform=process.platform] - inject for tests.
 *
 * @returns {{
 *   found: boolean,
 *   name: string,             // echoed for caller convenience
 *   path: string | null,      // first-hit path (or null)
 *   paths: string[],          // ALL hits (where / which can return many)
 *   error: string | null,     // operator-readable when not found
 *   raw: string,              // raw command output for debugging
 *   timedOut: boolean,        // true ⇔ probe timed out
 * }}
 */
function discoverCli(name, opts = {}) {
  if (typeof name !== "string" || name.length === 0) {
    return _failure(name, "cli name required", "");
  }
  if (name.length > CLI_NAME_MAX_LENGTH) {
    return _failure(name, `cli name too long (>${CLI_NAME_MAX_LENGTH} chars)`, "");
  }
  if (!CLI_NAME_REGEX.test(name)) {
    return _failure(
      name,
      `cli name "${_clip(name)}" contains characters that are not allowed (only letters/digits/.-_)`,
      "",
    );
  }

  const platform = opts.platform || process.platform;
  const spawnImpl = opts.spawnImpl || spawnSync;
  const env = opts.env || process.env;
  const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
    ? opts.timeoutMs
    : PROBE_TIMEOUT_MS;

  const cmd = platform === "win32" ? "where" : "which";

  let result;
  try {
    result = spawnImpl(cmd, [name], {
      env,
      timeout: timeoutMs,
      encoding: "utf-8",
      // shell: false is the security baseline — even if the name
      // allowlist somehow let through a metacharacter, no shell
      // means no injection.
      shell: false,
      windowsHide: true,
    });
  } catch (err) {
    return _failure(name, `probe spawn failed: ${err.message}`, "");
  }

  if (!result) {
    return _failure(name, "probe returned no result (spawnImpl bug?)", "");
  }

  // spawnSync sets `signal` on timeout-kill; on Windows the same
  // condition is reported via result.error.code === 'ETIMEDOUT'.
  const timedOut = result.signal === "SIGTERM"
    || (result.error && /ETIMEDOUT/i.test(String(result.error.code || result.error.message || "")));
  if (timedOut) {
    return {
      found: false,
      name,
      path: null,
      paths: [],
      error: `probe for "${name}" timed out after ${timeoutMs}ms`,
      raw: "",
      timedOut: true,
    };
  }

  if (result.error) {
    return _failure(name, `probe error: ${result.error.message}`, String(result.stderr || ""));
  }

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "").trim();
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  // status===0 is the canonical success on POSIX. Windows `where`
  // returns 0 on hits + non-zero on miss; we treat lines.length===0
  // the same regardless of platform so the contract is uniform.
  if (result.status !== 0 || lines.length === 0) {
    return {
      found: false,
      name,
      path: null,
      paths: [],
      error: stderr || `${name} not on PATH`,
      raw: stdout,
      timedOut: false,
    };
  }

  return {
    found: true,
    name,
    path: lines[0],
    paths: lines,
    error: null,
    raw: stdout,
    timedOut: false,
  };
}

// ── helpers ────────────────────────────────────────────────────

function _failure(name, error, raw) {
  return {
    found: false,
    name: typeof name === "string" ? name : "",
    path: null,
    paths: [],
    error,
    raw: typeof raw === "string" ? raw : "",
    timedOut: false,
  };
}

// Clip a name for inclusion in error messages without echoing a huge
// pathological input back to the operator.
function _clip(s) {
  if (typeof s !== "string") return "";
  if (s.length <= 32) return s;
  return s.slice(0, 32) + "…";
}

module.exports = {
  discoverCli,
  CLI_NAME_REGEX,
  CLI_NAME_MAX_LENGTH,
  PROBE_TIMEOUT_MS,
};
