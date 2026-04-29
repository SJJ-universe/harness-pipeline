// Slice P0 (Phase E productization, 2026-04-28) — sensitive-env filter.
//
// Single source of truth for filtering sensitive environment variables
// before passing them to child processes. Used by:
//
//   executor/claude-runner.js   spawn(claude, ...) — HARNESS_TOKEN blocked
//   executor/codex-runner.js    spawn(codex, ...)  — HARNESS_TOKEN blocked
//   server.js                   pty.spawn(shell, ...) — HARNESS_TOKEN allowed
//
// Why this lives in src/security/ (not in each runner):
//
// Pre-P0, executor/claude-runner.js:116 passed `env: process.env` raw, and
// executor/codex-runner.js:136 omitted the env option entirely (Node.js
// default = inherit parent env). Result: HARNESS_TOKEN, RUNNER_BOOTSTRAP_TOKEN,
// ANTHROPIC_API_KEY, OPENAI_API_KEY, GITHUB_TOKEN, AWS_SECRET_ACCESS_KEY,
// NPM_TOKEN, etc. all leaked into Claude/Codex child processes. Process
// Explorer / `ps eww` / `/proc/<pid>/environ` then exposed them. If the
// child process is compromised or has logging that includes env, the leak
// becomes persistent.
//
// server.js:410-416 already had this exact pattern for PTY. P0 extracts
// it into a shared module and applies the same filter to spawn paths,
// removing the inconsistency. The Phase E D1 slice (`profileSpawn.js`)
// builds on top of this base — profile-scoped credentials get inject'd
// AFTER the base filter so HARNESS_TOKEN can never accidentally reach
// any child.
//
// Threat model:
//   - Claude/Codex are trusted (we exec them) but the env they see is
//     not part of our security boundary. Don't pass tokens we don't
//     need them to see.
//   - HARNESS_TOKEN: gates the dashboard. Claude/Codex children never
//     need it. PTY children might (operator typed `curl` themselves).
//   - RUNNER_BOOTSTRAP_TOKEN, runJWT keys: runner-side auth. Local
//     children never need it.
//   - Provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY): the
//     spawned CLI may need its OWN copy from a profile config. Never
//     inherit from parent.

"use strict";

/**
 * Regex matching env-var names that look like secrets.
 * Pattern matches case-insensitively against substrings:
 *   TOKEN, SECRET, KEY, PASSWORD, CREDENTIAL
 *
 * False positives caught by `allowKeys` (e.g. operator-defined
 * HARNESS_DEBUG_TOKEN_NOTE that's actually a comment, not a secret).
 */
const SENSITIVE_KEY_RE = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i;

/**
 * Filter sensitive environment variables for child-process spawn.
 *
 * @param {object} parentEnv - Source env (default: process.env)
 * @param {object} [opts]
 * @param {string[]} [opts.extraDrop=[]] - Additional keys to remove
 *   (case-sensitive exact match). Use when a profile or context wants
 *   to drop something the regex doesn't catch.
 * @param {string[]} [opts.allowKeys=[]] - Keys to PRESERVE even if they
 *   match the SENSITIVE_KEY_RE pattern. Used by PTY which needs
 *   HARNESS_TOKEN so an operator can curl their own dashboard from the
 *   terminal.
 * @returns {object} Shallow-copied env object with sensitive keys removed.
 */
function filterSensitiveEnv(parentEnv, opts = {}) {
  const src = parentEnv || {};
  const { extraDrop = [], allowKeys = [] } = opts;
  const dropSet = new Set(extraDrop);
  const allowSet = new Set(allowKeys);
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (dropSet.has(k)) continue;
    if (SENSITIVE_KEY_RE.test(k) && !allowSet.has(k)) continue;
    out[k] = v;
  }
  return out;
}

module.exports = {
  filterSensitiveEnv,
  SENSITIVE_KEY_RE,
};
