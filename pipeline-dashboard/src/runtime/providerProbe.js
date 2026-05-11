// Slice D2-b (Phase E1.5, 2026-04-29) — provider 3-tier probe.
//
// `probeProvider({runner, mode, ...})` answers three questions in
// escalating cost:
//
//   tier 1 (installed)      — `<bin> --version` succeeds.
//                             No env, no profile, no tokens. Fast.
//
//   tier 2 (authenticated)  — `<bin> auth status` succeeds with the
//                             profile's env (so credential is wired).
//                             Does NOT spend provider tokens — the
//                             CLI's auth subcommand is local-only by
//                             contract.
//
//   tier 3 (canRun)         — minimal model call (`-p --bare ...`).
//                             SPENDS tokens. Operator must opt in
//                             via `mode: "tier1+2+3"` AND the route
//                             layer must require explicit consent
//                             (handled in D2-c).
//
// Each tier is GATED on the previous tier's success. Tier 1 fail
// short-circuits with `NOT_INSTALLED` and skips tier 2/3. Tier 2 fail
// short-circuits with `NOT_AUTHENTICATED`.
//
// Why this is a separate module from cliProbe + profileSpawn:
//
//   - cliProbe.js (D2-a) finds the binary. providerProbe runs it.
//     The two trust steps are deliberately separated — discovery is
//     a read-only operation; running is a spawn step that consumes
//     the same defense-in-depth gates as ClaudeRunner / CodexRunner.
//   - profileSpawn.js (D1-c) composes the env. providerProbe consumes
//     that contract — it does NOT re-implement the layered env model.
//   - The setup wizard (D2-d) calls providerProbe; the route layer
//     (D2-c) exposes it via `POST /api/setup/probe-{claude,codex}`.
//     Two callers, one implementation.
//
// Public-sector posture:
//
//   `assertLocalExecutorAllowed` from D1-gov-2 fires for tier 2 + 3
//   (they spawn the binary). Tier 1 ALSO spawns (`<bin> --version`)
//   so it ALSO refuses under public-sector — the public-sector wizard
//   track does not use providerProbe at all (it uses a different
//   probe for sandbox-runner connectivity, future GOV-* work). When
//   providerProbe is called under public-sector posture it returns
//   `errorCode: "PUBLIC_SECTOR_BLOCKED"` so the route + wizard can
//   render an operator-actionable message.
//
// Stable error codes (frozen):
//
//   NOT_INSTALLED          — tier 1 failed (binary missing or version
//                            output unparseable)
//   NOT_AUTHENTICATED      — tier 2 failed (auth status reported
//                            negative or unparseable)
//   TIMEOUT                — any tier timed out
//   RATE_LIMITED           — tier 3 detected provider rate-limit
//   PUBLIC_SECTOR_BLOCKED  — deploymentProfile refused local executor
//   UNSUPPORTED_RUNNER     — runner not in {claude, codex}
//   UNKNOWN                — uncategorized failure (last resort)

"use strict";

const { spawn: realSpawn } = require("child_process");
const { discoverCli } = require("./cliProbe");
const { filterSensitiveEnv } = require("../security/envFilter");
const { resolveDeploymentProfile } = require("../policy/deploymentProfile");
const { assertLocalExecutorAllowed } = require("../policy/publicSectorPolicy");
const { buildSpawnEnv } = require("./profileSpawn");

// Per-tier timeouts. Tier 3 needs more time since it's a real model
// call; tiers 1 + 2 should be sub-second under normal conditions.
const TIER_TIMEOUT_MS = Object.freeze({
  TIER1: 5000,
  TIER2: 5000,
  TIER3: 30000,
});

// Stable error vocabulary. Tests + dashboards lock the wire-format
// so a future caller can't extend without an explicit code change.
const ERROR_CODES = Object.freeze({
  NOT_INSTALLED: "NOT_INSTALLED",
  NOT_AUTHENTICATED: "NOT_AUTHENTICATED",
  TIMEOUT: "TIMEOUT",
  RATE_LIMITED: "RATE_LIMITED",
  PUBLIC_SECTOR_BLOCKED: "PUBLIC_SECTOR_BLOCKED",
  UNSUPPORTED_RUNNER: "UNSUPPORTED_RUNNER",
  UNKNOWN: "UNKNOWN",
});

const PROBE_MODES = Object.freeze({
  TIER1: "tier1",
  TIER1_2: "tier1+2",
  TIER1_2_3: "tier1+2+3",
});

// Per-runner CLI shape. Centralized so a future change to the
// claude/codex CLIs only needs to update one table.
const RUNNER_CONFIG = Object.freeze({
  claude: Object.freeze({
    name: "claude",
    versionArgs: ["--version"],
    authArgs: ["auth", "status"],
    // Minimal call: `-p --bare --max-tokens 1 "<single token>"`.
    // --bare strips hooks/auto-discovery so the call doesn't re-enter
    // the orchestrator; --max-tokens 1 caps spend at the absolute minimum.
    minimalCallArgs: ["-p", "--bare", "--max-tokens", "1", "ok"],
    accountLabelRegex: /(?:Logged in as|Account|Authenticated as)[:\s]+(\S+)/i,
  }),
  codex: Object.freeze({
    name: "codex",
    versionArgs: ["--version"],
    authArgs: ["auth", "status"],
    // Codex's minimal call. exec is non-interactive; --skip-git-repo-check
    // matches the shape codex-runner.js already uses.
    minimalCallArgs: ["exec", "--full-auto", "--skip-git-repo-check", "respond ok"],
    accountLabelRegex: /(?:Logged in as|Account|Authenticated as)[:\s]+(\S+)/i,
  }),
});

const RATE_LIMIT_REGEX = /rate.?limit|429|too many requests/i;

/**
 * Probe a Claude / Codex CLI installation + auth state.
 *
 * @param {object} opts
 * @param {"claude"|"codex"} opts.runner
 * @param {"tier1"|"tier1+2"|"tier1+2+3"} [opts.mode="tier1+2"]
 * @param {object} [opts.profile] - profile to inject env from (D1-c).
 *   Required for tier 2+. Tier 1 ignores profile (no env composition).
 * @param {object} [opts.profileStore] - required for tier 2+.
 * @param {object} [opts.credentialStore] - required for tier 2+.
 * @param {object} [opts.env] - parent env. Defaults to process.env.
 * @param {object} [opts.deploymentProfile] - inject for tests; otherwise
 *   resolveDeploymentProfile({env}) is called.
 * @param {function} [opts.cliProbeImpl] - inject discoverCli for tests.
 * @param {function} [opts.spawnImpl] - inject spawn for tests.
 *
 * @returns {Promise<{
 *   installed: boolean,
 *   authenticated: boolean | null,  // null when mode=tier1 (not measured)
 *   canRun: boolean,                // true ⇔ mode=tier1+2+3 succeeded
 *   accountLabel: string | null,    // operator-facing identity (when CLI exposes one)
 *   errorCode: string | null,       // stable from ERROR_CODES
 *   spendsTokens: boolean,          // true ⇔ tier3 actually ran
 *   details: {
 *     cliVersion: string | null,
 *     cliPath: string | null,
 *     lastTestedAt: string,         // ISO 8601
 *     elapsedMs: number,
 *     probeMode: string,
 *     stderr: string | null,        // last-tier stderr (clipped) for debugging
 *   }
 * }>}
 */
async function probeProvider(opts = {}) {
  const start = Date.now();
  const runner = opts.runner;
  const mode = opts.mode || PROBE_MODES.TIER1_2;
  const env = opts.env || process.env;
  const cliProbeImpl = opts.cliProbeImpl || discoverCli;
  const spawnImpl = opts.spawnImpl || realSpawn;
  const deploymentProfile = opts.deploymentProfile
    || resolveDeploymentProfile({ env });

  // ── 0. Validate runner ────────────────────────────────────────
  if (!RUNNER_CONFIG[runner]) {
    return _result({
      installed: false,
      authenticated: null,
      canRun: false,
      errorCode: ERROR_CODES.UNSUPPORTED_RUNNER,
      probeMode: mode,
      details: {
        stderr: `unsupported runner "${runner}" — must be "claude" or "codex"`,
      },
      start,
    });
  }
  const cfg = RUNNER_CONFIG[runner];

  // ── 1. Public-sector defense-in-depth ────────────────────────
  // The local executor (and therefore providerProbe's tiers 1-3)
  // is forbidden under public-sector posture. The wizard's public-
  // sector track uses a different probe; if providerProbe is called
  // anyway, refuse with a stable code.
  try {
    assertLocalExecutorAllowed(deploymentProfile);
  } catch (err) {
    return _result({
      installed: false,
      authenticated: null,
      canRun: false,
      errorCode: ERROR_CODES.PUBLIC_SECTOR_BLOCKED,
      probeMode: mode,
      details: {
        stderr: err.message,
      },
      start,
    });
  }

  // ── 2. TIER 1 — installed (cliProbe + --version) ─────────────
  const cli = cliProbeImpl(cfg.name, { env });
  if (!cli.found) {
    return _result({
      installed: false,
      authenticated: null,
      canRun: false,
      errorCode: ERROR_CODES.NOT_INSTALLED,
      probeMode: mode,
      details: {
        cliPath: null,
        stderr: cli.error || `${cfg.name} not on PATH`,
      },
      start,
    });
  }

  const versionOutcome = await _spawnAndCapture({
    cmd: cli.path,
    args: cfg.versionArgs,
    timeoutMs: TIER_TIMEOUT_MS.TIER1,
    spawnImpl,
    // No profile env on tier 1 — version output should never touch
    // credentials.
    env: filterSensitiveEnv(env),
  });

  if (versionOutcome.timedOut) {
    return _result({
      installed: false,
      authenticated: null,
      canRun: false,
      errorCode: ERROR_CODES.TIMEOUT,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        stderr: `tier 1 (--version) timed out after ${TIER_TIMEOUT_MS.TIER1}ms`,
      },
      start,
    });
  }
  if (versionOutcome.exitCode !== 0) {
    return _result({
      installed: false,
      authenticated: null,
      canRun: false,
      errorCode: ERROR_CODES.NOT_INSTALLED,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        stderr: _clipStderr(versionOutcome.stderr || versionOutcome.stdout),
      },
      start,
    });
  }
  const cliVersion = _parseVersion(versionOutcome.stdout);

  // Stop here if mode=tier1.
  if (mode === PROBE_MODES.TIER1) {
    return _result({
      installed: true,
      authenticated: null,
      canRun: false,
      errorCode: null,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        cliVersion,
      },
      start,
    });
  }

  // ── 3. TIER 2 — authenticated (auth status with profile env) ─
  const tier2Env = await _composeProfileEnv({
    parentEnv: env,
    profile: opts.profile,
    profileStore: opts.profileStore,
    credentialStore: opts.credentialStore,
    deploymentProfile,
  });
  if (tier2Env.error) {
    return _result({
      installed: true,
      authenticated: false,
      canRun: false,
      errorCode: ERROR_CODES.NOT_AUTHENTICATED,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        cliVersion,
        stderr: tier2Env.error,
      },
      start,
    });
  }

  const authOutcome = await _spawnAndCapture({
    cmd: cli.path,
    args: cfg.authArgs,
    timeoutMs: TIER_TIMEOUT_MS.TIER2,
    spawnImpl,
    env: tier2Env.env,
  });

  if (authOutcome.timedOut) {
    return _result({
      installed: true,
      authenticated: false,
      canRun: false,
      errorCode: ERROR_CODES.TIMEOUT,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        cliVersion,
        stderr: `tier 2 (auth status) timed out after ${TIER_TIMEOUT_MS.TIER2}ms`,
      },
      start,
    });
  }
  if (authOutcome.exitCode !== 0) {
    return _result({
      installed: true,
      authenticated: false,
      canRun: false,
      errorCode: ERROR_CODES.NOT_AUTHENTICATED,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        cliVersion,
        stderr: _clipStderr(authOutcome.stderr || authOutcome.stdout),
      },
      start,
    });
  }
  const accountLabel = _extractAccountLabel(authOutcome.stdout, cfg);

  // Stop here if mode=tier1+2.
  if (mode === PROBE_MODES.TIER1_2) {
    return _result({
      installed: true,
      authenticated: true,
      canRun: false,
      errorCode: null,
      accountLabel,
      probeMode: mode,
      details: {
        cliPath: cli.path,
        cliVersion,
      },
      start,
    });
  }

  // ── 4. TIER 3 — canRun (minimal model call, spends tokens) ────
  const tier3Outcome = await _spawnAndCapture({
    cmd: cli.path,
    args: cfg.minimalCallArgs,
    timeoutMs: TIER_TIMEOUT_MS.TIER3,
    spawnImpl,
    env: tier2Env.env, // same profile-composed env as tier 2
  });

  if (tier3Outcome.timedOut) {
    return _result({
      installed: true,
      authenticated: true,
      canRun: false,
      errorCode: ERROR_CODES.TIMEOUT,
      probeMode: mode,
      accountLabel,
      spendsTokens: true,
      details: {
        cliPath: cli.path,
        cliVersion,
        stderr: `tier 3 (minimal call) timed out after ${TIER_TIMEOUT_MS.TIER3}ms`,
      },
      start,
    });
  }
  if (tier3Outcome.exitCode !== 0) {
    const text = `${tier3Outcome.stderr || ""}\n${tier3Outcome.stdout || ""}`;
    const code = RATE_LIMIT_REGEX.test(text)
      ? ERROR_CODES.RATE_LIMITED
      : ERROR_CODES.UNKNOWN;
    return _result({
      installed: true,
      authenticated: true,
      canRun: false,
      errorCode: code,
      probeMode: mode,
      accountLabel,
      spendsTokens: true,
      details: {
        cliPath: cli.path,
        cliVersion,
        stderr: _clipStderr(text),
      },
      start,
    });
  }

  return _result({
    installed: true,
    authenticated: true,
    canRun: true,
    errorCode: null,
    accountLabel,
    probeMode: mode,
    spendsTokens: true,
    details: {
      cliPath: cli.path,
      cliVersion,
    },
    start,
  });
}

// ── helpers ────────────────────────────────────────────────────

async function _composeProfileEnv({ parentEnv, profile, profileStore, credentialStore, deploymentProfile }) {
  // Tier 2/3 need profile credentials in the spawn env. We delegate
  // to buildSpawnEnv (D1-c) so the layered model stays the single
  // source of truth.
  if (!profile && !profileStore) {
    // No profile — fall back to filtered parent env. Useful when the
    // operator wants "is the CLI authenticated under whatever it
    // already has on disk" without going through the orchestrator's
    // profile system.
    return { env: filterSensitiveEnv(parentEnv) };
  }
  try {
    const built = await buildSpawnEnv({
      parentEnv,
      profileId: profile && profile.id,
      profileStore,
      credentialStore,
      deploymentProfile,
    });
    return { env: built.env };
  } catch (err) {
    return { error: err.message };
  }
}

function _spawnAndCapture({ cmd, args, timeoutMs, spawnImpl, env }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(cmd, args, {
        env,
        // Same security baseline as cliProbe.
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      return resolve({
        exitCode: null,
        stdout: "",
        stderr: err.message,
        timedOut: false,
      });
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try { child.kill(); } catch (_) { /* ignore */ }
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (c) => stdoutChunks.push(c));
    }
    if (child.stderr) {
      child.stderr.on("data", (c) => stderrChunks.push(c));
    }

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: "",
        stderr: err.message,
        timedOut,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        timedOut,
      });
    });
  });
}

function _parseVersion(stdout) {
  if (typeof stdout !== "string") return null;
  // First semver-like token wins. Tolerates "claude 1.2.3" /
  // "Claude Code v1.2.3" / "1.2.3-beta.4".
  // No leading \b — that fails on "v1.2.3" because \b between letter
  // and digit is absent. Trailing \b is fine.
  const m = stdout.match(/(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/);
  return m ? m[1] : null;
}

function _extractAccountLabel(stdout, cfg) {
  if (typeof stdout !== "string" || !cfg || !cfg.accountLabelRegex) return null;
  const m = stdout.match(cfg.accountLabelRegex);
  return m ? m[1] : null;
}

function _clipStderr(s) {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 512) return trimmed;
  return trimmed.slice(0, 512) + "…";
}

function _result(parts) {
  const now = Date.now();
  return {
    installed: !!parts.installed,
    authenticated: parts.authenticated == null ? null : !!parts.authenticated,
    canRun: !!parts.canRun,
    accountLabel: parts.accountLabel || null,
    errorCode: parts.errorCode || null,
    spendsTokens: !!parts.spendsTokens,
    details: {
      cliVersion: (parts.details && parts.details.cliVersion) || null,
      cliPath: (parts.details && parts.details.cliPath) || null,
      lastTestedAt: new Date(now).toISOString(),
      elapsedMs: now - (parts.start || now),
      probeMode: parts.probeMode || PROBE_MODES.TIER1_2,
      stderr: (parts.details && parts.details.stderr) || null,
    },
  };
}

module.exports = {
  probeProvider,
  RUNNER_CONFIG,
  ERROR_CODES,
  PROBE_MODES,
  TIER_TIMEOUT_MS,
};
