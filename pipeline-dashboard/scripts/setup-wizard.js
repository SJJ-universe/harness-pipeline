#!/usr/bin/env node
// scripts/setup-wizard.js — Slice D2-d (Phase E1.5, 2026-04-29)
//
// Interactive first-run wizard. Two tracks:
//
//   STANDARD     — operator runs Claude/Codex with their own account.
//                  8 steps: Node check → Claude CLI → Codex CLI →
//                  profile fields → workspace probe → optional auth
//                  test → optional Codex auth test → finalize.
//
//   PUBLIC-SECTOR — agency deployment with sandbox runner. Operator
//                  collects agency-layer profile fields (accountType,
//                  workspaceMode, dataClassification, egressPolicyId)
//                  + acknowledges signed/offline release scope. Local
//                  CLI discovery is SKIPPED — the agency profile uses
//                  a remote sandbox runner, not local Claude/Codex.
//
// Track is chosen by HARNESS_DEPLOYMENT_PROFILE env (read at start).
// Operator can also pass --public-sector / --standard to override.
//
// Why a Node script with thin .ps1 / .sh wrappers:
//
//   - JSON parsing + interactive Read-Host on Windows + read on POSIX
//     gets painful in pure-shell. PowerShell's ConvertFrom-Json works
//     but bash needs jq (not always installed).
//   - We already have launcher-cli.js as a "PowerShell + bash share
//     a Node helper" precedent. This wizard follows the same pattern.
//   - The .ps1 / .sh wrappers are one-liners that invoke `node` with
//     the right path so operators get the discoverable .ps1 / .sh
//     filenames the spec calls for.
//
// Inputs the wizard reads:
//
//   - HARNESS_BASE_URL          (default http://127.0.0.1:4201)
//   - HARNESS_TOKEN             (else read from .harness/local-token)
//   - HARNESS_DEPLOYMENT_PROFILE
//   - HARNESS_NO_TTY            (skip prompts, fail-closed if any
//                                required input was supposed to be
//                                interactive — useful for CI)
//
// Exit codes:
//   0 — success (profile created, optionally set active)
//   1 — operator aborted (Ctrl+C / "no" at confirmation)
//   2 — server unreachable / probe failed / setup blocked
//   3 — invalid input (bad CLI args / non-TTY without flags)
//
// What this script deliberately does NOT do:
//   - Start the harness server. The launcher is responsible for that.
//     If the server isn't reachable, the wizard prints an actionable
//     message and exits with code 2.
//   - Spend tokens. Tier 3 (canRun) is opt-in via --tier3 + interactive
//     consent prompt. The wizard's default uses tier1+2 only.
//   - Write profile files directly. Always goes through /api/setup/*
//     so the audit chain captures the operator's actions.

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const VERSION = "0.1.0-d2d";
const DEFAULT_BASE_URL = "http://127.0.0.1:4201";
const TOKEN_FILE_RELATIVE = path.join(".harness", "local-token");

// ── arg parsing ─────────────────────────────────────────────────

function parseArgs(argv) {
  // Tiny flag parser. Recognized flags:
  //   --base-url <url>        override HARNESS_BASE_URL
  //   --token <token>         override HARNESS_TOKEN / .harness/local-token
  //   --standard              force standard track
  //   --public-sector         force public-sector track
  //   --tier3                 enable tier-3 (token-spending) provider tests
  //   --no-prompt             refuse to ask interactive questions
  //   --version               print version and exit 0
  //   --help                  print help and exit 0
  const out = { mode: null, baseUrl: null, token: null, tier3: false, noPrompt: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") return { command: "help" };
    if (a === "--version" || a === "-v") return { command: "version" };
    if (a === "--standard") out.mode = "standard";
    else if (a === "--public-sector") out.mode = "public-sector";
    else if (a === "--tier3") out.tier3 = true;
    else if (a === "--no-prompt") out.noPrompt = true;
    else if (a === "--base-url") out.baseUrl = argv[++i] || null;
    else if (a === "--token") out.token = argv[++i] || null;
    else {
      return { command: "error", error: `unknown argument: ${a}` };
    }
  }
  return { command: "run", ...out };
}

function printHelp() {
  process.stdout.write([
    "harness setup wizard (D2-d)",
    "",
    "Usage:",
    "  node scripts/setup-wizard.js [options]",
    "",
    "Options:",
    "  --standard            Force standard track (override env)",
    "  --public-sector       Force public-sector track (override env)",
    "  --tier3               Allow tier-3 (token-spending) provider tests",
    "  --no-prompt           Refuse interactive prompts (CI-friendly)",
    "  --base-url <url>      Override HARNESS_BASE_URL",
    "  --token <token>       Override HARNESS_TOKEN / .harness/local-token",
    "  --version             Print version and exit",
    "  --help                Print this help and exit",
    "",
    "Track selection (when neither --standard nor --public-sector is given):",
    "  HARNESS_DEPLOYMENT_PROFILE=public-sector → public-sector track",
    "  Otherwise                                → standard track",
    "",
    "",
  ].join("\n"));
}

// ── env / token resolution ─────────────────────────────────────

function resolveBaseUrl(args, env) {
  return args.baseUrl || env.HARNESS_BASE_URL || DEFAULT_BASE_URL;
}

function resolveToken(args, env, repoRoot) {
  if (args.token) return args.token;
  if (env.HARNESS_TOKEN) return env.HARNESS_TOKEN;
  // Fall back to .harness/local-token in the repo root.
  const tokenFile = path.join(repoRoot, TOKEN_FILE_RELATIVE);
  try {
    const contents = fs.readFileSync(tokenFile, "utf-8").trim();
    if (contents) return contents;
  } catch (_) { /* file may not exist yet */ }
  return null;
}

function resolveTrack(args, env) {
  if (args.mode) return args.mode;
  if (env.HARNESS_DEPLOYMENT_PROFILE === "public-sector") return "public-sector";
  return "standard";
}

// ── readline helpers ────────────────────────────────────────────

function makePrompt(noPrompt) {
  if (noPrompt) {
    return {
      async ask() {
        throw new Error("interactive prompt blocked by --no-prompt");
      },
      async confirm() {
        throw new Error("interactive prompt blocked by --no-prompt");
      },
      close() {},
    };
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return {
    async ask(question, defaultValue) {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      return new Promise((resolve) => {
        rl.question(`${question}${suffix}: `, (answer) => {
          const trimmed = (answer || "").trim();
          resolve(trimmed.length > 0 ? trimmed : (defaultValue || ""));
        });
      });
    },
    async confirm(question, defaultYes = false) {
      const hint = defaultYes ? "[Y/n]" : "[y/N]";
      return new Promise((resolve) => {
        rl.question(`${question} ${hint}: `, (answer) => {
          const trimmed = (answer || "").trim().toLowerCase();
          if (trimmed.length === 0) return resolve(defaultYes);
          resolve(trimmed === "y" || trimmed === "yes");
        });
      });
    },
    close() { rl.close(); },
  };
}

// ── HTTP helper ─────────────────────────────────────────────────

async function postJson({ baseUrl, token, path: p, body, fetchImpl }) {
  const fetcher = fetchImpl || global.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("fetch is unavailable in this Node runtime");
  }
  const headers = { "content-type": "application/json" };
  if (token) headers["x-harness-token"] = token;
  const url = baseUrl.replace(/\/+$/, "") + p;
  let res;
  try {
    res = await fetcher(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
  } catch (err) {
    return { ok: false, status: null, error: `network: ${err.message}` };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  return { ok: res.ok, status: res.status, body: json, text };
}

// ── output helpers ──────────────────────────────────────────────

const COLORS = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function color(s, c) {
  if (!process.stdout.isTTY) return s;
  return (COLORS[c] || "") + s + COLORS.reset;
}

function printHeader(text) {
  process.stdout.write("\n" + color("━━━ " + text + " ━━━", "bold") + "\n");
}

function printOk(text) {
  process.stdout.write(color("  ✓ ", "green") + text + "\n");
}

function printWarn(text) {
  process.stdout.write(color("  ! ", "yellow") + text + "\n");
}

function printErr(text) {
  process.stdout.write(color("  ✗ ", "red") + text + "\n");
}

function printInfo(text) {
  process.stdout.write("    " + color(text, "cyan") + "\n");
}

// ── steps ──────────────────────────────────────────────────────

async function stepProbeNode(ctx) {
  printHeader("Step 1: Node.js version");
  const r = await postJson({
    ...ctx,
    path: "/api/setup/probe-node",
  });
  if (!r.ok) {
    printErr(`server unreachable: ${r.error || r.text}`);
    return { ok: false, fatal: true };
  }
  const b = r.body;
  if (b.satisfiesMinimum) {
    printOk(`Node ${b.version} (≥ ${b.minimumRequired})`);
    return { ok: true };
  }
  printErr(`Node ${b.version} is below required ${b.minimumRequired}`);
  printInfo(`Install Node ≥ ${b.minimumRequired} from https://nodejs.org/ and re-run.`);
  return { ok: false, fatal: true };
}

async function stepProbeCli(ctx, name, optional) {
  printHeader(`Step: ${name} CLI discovery`);
  const r = await postJson({ ...ctx, path: "/api/setup/probe-cli", body: { name } });
  if (!r.ok) {
    printErr(`probe failed: ${r.error || r.text}`);
    return { ok: false, fatal: !optional };
  }
  if (r.body.found) {
    printOk(`${name} found at ${r.body.path}`);
    if (r.body.paths.length > 1) {
      printInfo(`Other matches: ${r.body.paths.slice(1).join(", ")}`);
    }
    return { ok: true, path: r.body.path };
  }
  if (optional) {
    printWarn(`${name} not found on PATH (optional — continuing)`);
    return { ok: true, found: false };
  }
  printErr(`${name} not found on PATH`);
  printInfo(`Install ${name} CLI and re-run setup.`);
  return { ok: false, fatal: true };
}

async function stepProbeWorkspace(ctx, workspacePath) {
  printHeader("Step: Workspace path");
  const r = await postJson({
    ...ctx,
    path: "/api/setup/probe-workspace",
    body: { workspacePath },
  });
  if (!r.ok) {
    printErr(`probe failed: ${r.error || r.text}`);
    return { ok: false, fatal: true };
  }
  if (r.body.ok) {
    printOk(`Writable: ${r.body.normalizedPath}`);
    return { ok: true, normalizedPath: r.body.normalizedPath };
  }
  printErr(`Workspace probe failed: ${r.body.error}`);
  return { ok: false, fatal: false };
}

async function stepTestProvider(ctx, runner, profileId, opts = {}) {
  printHeader(`Step: Test ${runner} authentication`);
  const mode = opts.tier3 ? "tier1+2+3" : "tier1+2";
  const body = { runner, mode };
  if (profileId) body.profileId = profileId;
  if (opts.tier3) body.consentToTier3 = true;
  const r = await postJson({ ...ctx, path: "/api/setup/probe-provider", body });
  if (!r.ok) {
    printErr(`probe failed: ${r.error || r.text}`);
    return { ok: false };
  }
  const b = r.body;
  if (b.errorCode === "PUBLIC_SECTOR_BLOCKED") {
    printWarn(`${runner} probe refused under public-sector policy (use sandbox runner)`);
    return { ok: false, code: b.errorCode };
  }
  if (b.errorCode) {
    printErr(`${runner}: ${b.errorCode} (${b.details && b.details.stderr ? b.details.stderr.split("\n")[0] : "no details"})`);
    return { ok: false, code: b.errorCode };
  }
  if (b.installed && b.authenticated) {
    const label = b.accountLabel ? ` (account: ${b.accountLabel})` : "";
    printOk(`${runner} authenticated${label}, version ${b.details.cliVersion || "unknown"}`);
    if (opts.tier3 && b.canRun) {
      printOk(`${runner} tier-3 model call succeeded (tokens spent)`);
    }
    return { ok: true };
  }
  if (b.installed) {
    printWarn(`${runner} installed but not authenticated`);
    return { ok: false };
  }
  printWarn(`${runner} not installed (probe path: ${b.details.cliPath || "n/a"})`);
  return { ok: false };
}

async function stepFinalize(ctx, profile, setActive) {
  printHeader("Step: Finalize");
  const r = await postJson({
    ...ctx,
    path: "/api/setup/finalize",
    body: { profile, setActive: !!setActive },
  });
  if (!r.ok) {
    if (r.body && r.body.error === "active_run_blocks_setup") {
      printErr("Setup is blocked by an active run. Stop the run and re-run setup.");
      return { ok: false, fatal: true };
    }
    if (r.body && r.body.details && Array.isArray(r.body.details)) {
      printErr(`Profile rejected by policy:`);
      for (const d of r.body.details) printInfo(d);
      return { ok: false, fatal: true };
    }
    printErr(`Finalize failed: ${r.body && r.body.message ? r.body.message : r.text}`);
    return { ok: false, fatal: true };
  }
  if (r.body.switchError) {
    printWarn(`Profile created but switch failed: ${r.body.switchError}`);
    printInfo(`Use \`POST /api/profiles/${profile.id}/switch\` to retry.`);
    return { ok: true, profile: r.body.profile, activeProfileId: null };
  }
  printOk(`Profile "${r.body.profile.id}" created${r.body.activeProfileId ? " and set active" : ""}`);
  return { ok: true, profile: r.body.profile, activeProfileId: r.body.activeProfileId };
}

// ── tracks ─────────────────────────────────────────────────────

async function runStandardTrack(ctx) {
  process.stdout.write(color("\nHarness Setup — Standard Track\n", "bold"));

  const node = await stepProbeNode(ctx);
  if (!node.ok) return { ok: false, exitCode: 2 };

  const claudeCli = await stepProbeCli(ctx, "claude", false);
  if (!claudeCli.ok) return { ok: false, exitCode: 2 };

  const codexCli = await stepProbeCli(ctx, "codex", true);
  // codex is optional — wizard continues either way

  printHeader("Step: Profile fields");
  const id = (await ctx.prompt.ask("Profile id (lowercase, no spaces)", "personal"))
    .toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const label = await ctx.prompt.ask("Profile label", "Personal");
  const defaultWs = process.platform === "win32"
    ? path.join(process.env.USERPROFILE || "C:\\", "harness-workspace")
    : path.join(process.env.HOME || "/tmp", "harness-workspace");
  const workspacePath = await ctx.prompt.ask("Workspace path", defaultWs);

  const ws = await stepProbeWorkspace(ctx, workspacePath);
  if (!ws.ok) return { ok: false, exitCode: 2 };

  // Optional auth tests — wizard offers but operator can skip.
  let testClaude = false;
  if (claudeCli.path) {
    testClaude = await ctx.prompt.confirm("Test Claude authentication now?", true);
  }
  if (testClaude) {
    let tier3 = false;
    if (ctx.args.tier3) {
      tier3 = await ctx.prompt.confirm(
        "Tier-3 test will spend a tiny amount of provider tokens. Proceed?",
        false,
      );
    }
    await stepTestProvider(ctx, "claude", null, { tier3 });
  }

  let testCodex = false;
  if (codexCli.path) {
    testCodex = await ctx.prompt.confirm("Test Codex authentication now?", false);
  }
  if (testCodex) {
    await stepTestProvider(ctx, "codex", null);
  }

  const setActive = await ctx.prompt.confirm(
    `Set "${id}" as the active profile?`,
    true,
  );

  const profile = {
    id,
    label,
    workspacePath: ws.normalizedPath,
    activeProvider: "claude",
    secretIds: [],
  };

  const fin = await stepFinalize(ctx, profile, setActive);
  if (!fin.ok) return { ok: false, exitCode: 2 };

  process.stdout.write(color("\nSetup complete.\n", "green"));
  return { ok: true, exitCode: 0 };
}

async function runPublicSectorTrack(ctx) {
  process.stdout.write(color("\nHarness Setup — Public-Sector Track\n", "bold"));
  printInfo("Local provider CLIs are NOT used in public-sector mode.");
  printInfo("Provider dispatch must go through a sandbox runner.");
  printInfo("This wizard collects the AGENCY profile fields. Sandbox-runner");
  printInfo("connectivity is verified by a separate probe (future GOV-* slice).");

  const node = await stepProbeNode(ctx);
  if (!node.ok) return { ok: false, exitCode: 2 };

  printHeader("Step: Agency profile fields");
  const id = (await ctx.prompt.ask("Profile id (lowercase, no spaces)", "agency"))
    .toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const label = await ctx.prompt.ask("Agency profile label", "Agency");
  const dataClassification = await ctx.prompt.ask(
    "Data classification (e.g. internal, confidential)",
    "internal",
  );
  const egressPolicyId = await ctx.prompt.ask(
    "Egress policy id (agency allowlist identifier)",
    "agency-default-egress",
  );
  // workspacePath is informational under public-sector — the actual
  // workspace lives in the sandbox runner. We still capture a label
  // so audit logs carry the operator-recognizable name.
  const workspacePath = await ctx.prompt.ask(
    "Workspace label (advisory; sandbox runner is authoritative)",
    `sandbox:${id}`,
  );

  printInfo("Acknowledgments (no automatic verification — operator-driven):");
  const ackSandbox = await ctx.prompt.confirm(
    "Sandbox runner is configured (HARNESS_REMOTE_MODE / runner host)?",
    false,
  );
  if (!ackSandbox) {
    printErr("Setup aborted — sandbox runner must be configured before profile creation.");
    return { ok: false, exitCode: 1 };
  }
  const ackPii = await ctx.prompt.confirm(
    "PII scanner is enabled (GOV-PII-0 inline gate active)?",
    true,
  );
  if (!ackPii) printWarn("PII scanner acknowledgment skipped — proceeding without.");

  const ackRelease = await ctx.prompt.confirm(
    "This installation came from a TRUSTED internal release channel " +
    "(not a public download)?",
    false,
  );
  if (!ackRelease) {
    printErr("Setup aborted — public-sector deployments require a signed/internal release.");
    return { ok: false, exitCode: 1 };
  }

  const setActive = await ctx.prompt.confirm(
    `Set "${id}" as the active profile?`,
    true,
  );

  const profile = {
    id,
    label,
    workspacePath,
    activeProvider: "claude",
    secretIds: [],
    // D1-gov-2 agency-layer fields:
    accountType: "agency_managed",
    workspaceMode: "sandbox",
    dataClassification,
    egressPolicyId,
  };

  const fin = await stepFinalize(ctx, profile, setActive);
  if (!fin.ok) return { ok: false, exitCode: 2 };

  process.stdout.write(color("\nPublic-sector setup complete.\n", "green"));
  printInfo("Next steps:");
  printInfo("  - Verify sandbox runner connectivity");
  printInfo("  - Configure egress allowlist for " + egressPolicyId);
  printInfo("  - Confirm credential backend is keychain (not plaintext)");
  return { ok: true, exitCode: 0 };
}

// ── main ───────────────────────────────────────────────────────

async function main(argv, env, opts = {}) {
  const args = parseArgs(argv);
  if (args.command === "help") { printHelp(); return 0; }
  if (args.command === "version") {
    process.stdout.write(`setup-wizard ${VERSION}\n`);
    return 0;
  }
  if (args.command === "error") {
    process.stderr.write(`error: ${args.error}\n`);
    return 3;
  }

  const repoRoot = opts.repoRoot || process.cwd();
  const baseUrl = resolveBaseUrl(args, env);
  const token = resolveToken(args, env, repoRoot);
  const track = resolveTrack(args, env);
  const noPrompt = !!(args.noPrompt || env.HARNESS_NO_TTY);

  if (!token) {
    process.stderr.write(
      "error: no HARNESS_TOKEN found. Start the harness server first " +
      "(it creates .harness/local-token), or pass --token <value>.\n",
    );
    return 2;
  }

  const prompt = opts.promptImpl || makePrompt(noPrompt);
  const ctx = { baseUrl, token, args, prompt, fetchImpl: opts.fetchImpl };

  process.stdout.write(`Harness Setup Wizard ${VERSION}\n`);
  process.stdout.write(`  Base URL: ${baseUrl}\n`);
  process.stdout.write(`  Track:    ${track}\n`);

  let result;
  try {
    if (track === "public-sector") {
      result = await runPublicSectorTrack(ctx);
    } else {
      result = await runStandardTrack(ctx);
    }
  } catch (err) {
    process.stderr.write(`\nfatal: ${err.message}\n`);
    return 2;
  } finally {
    prompt.close();
  }

  return result && Number.isFinite(result.exitCode) ? result.exitCode : 0;
}

if (require.main === module) {
  main(process.argv.slice(2), process.env)
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`fatal: ${err && err.message ? err.message : err}\n`);
      process.exit(2);
    });
}

module.exports = {
  main,
  parseArgs,
  resolveBaseUrl,
  resolveToken,
  resolveTrack,
  postJson,
  // Steps exposed for tests
  stepProbeNode,
  stepProbeCli,
  stepProbeWorkspace,
  stepTestProvider,
  stepFinalize,
  runStandardTrack,
  runPublicSectorTrack,
};
