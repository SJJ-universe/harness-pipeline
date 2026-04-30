#!/usr/bin/env node
// Slice LV-2 (Phase D / Phase E1.5, 2026-04-30) — operator live probe
// for the review-relay chain.
//
// Run this AFTER booting the harness server (harness-start.bat or
// `node start.js`) to verify the end-to-end Codex/Claude review
// relay against REAL Codex/Claude binaries via the running
// dispatcher.
//
// What it does:
//   1. Probe /api/health to confirm the server is up
//   2. GET /api/server/info → display profile + posture
//   3. Auth: GET /api/auth/token → cached for state-changing calls
//   4. POST /api/review-sessions → create a labeled session
//   5. POST /:id/send-codex → expect 200 + dispatched:true + runner:codex
//   6. Poll session state every 1s until critique_received OR timeout
//   7. Display severity counts from session.history
//   8. (--with-followup) POST /:id/follow-up target=codex
//   9. (--with-handback, standard mode only) POST /:id/hand-back-claude
//      → poll until claude_received OR timeout
//   10. (--public-sector probe) Verify hand-back-claude returns 409
//       + claude runner NOT invoked
//   11. Emit evidence JSON to docs/reports/<date>-review-relay-live-verify.json
//
// Modes (CLI flags):
//   --base http://127.0.0.1:4201   override server base URL
//   --label "operator-probe"        review session label
//   --instruction "review for ..."  Codex critique instruction
//   --with-followup                 also probe follow-up Codex
//   --with-handback                 also probe Claude hand-back (standard mode)
//   --posture standard|public-sector  probe variant
//   --timeout-ms 120000             max wait for critique_received
//   --evidence-dir docs/reports     where to write evidence JSON
//   --quiet                         suppress per-step colored output
//   --json                          print evidence JSON to stdout instead
//
// Exit codes:
//   0  PASS — all verified steps succeeded
//   1  FAIL — at least one step failed (evidence still emitted)
//   2  CONFIG — missing prerequisite (server down, no token, etc.)
//
// This script is INTENTIONALLY simple — no external deps beyond Node
// stdlib. It uses globalThis.fetch (Node 18+).

"use strict";

const fs = require("fs");
const path = require("path");

// ── ANSI color helpers (no chalk dep) ─────────────────────────────

const SUPPORTS_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(code, s) { return SUPPORTS_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s; }
const c = {
  green:  (s) => paint(32, s),
  red:    (s) => paint(31, s),
  yellow: (s) => paint(33, s),
  blue:   (s) => paint(34, s),
  cyan:   (s) => paint(36, s),
  bold:   (s) => paint(1, s),
  dim:    (s) => paint(2, s),
};

// ── CLI parser (minimal) ──────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    base: "http://127.0.0.1:4201",
    label: "operator-live-probe",
    instruction: "Review the recent change for security and correctness. Use [critical] [high] [medium] [low] severity tags.",
    withFollowup: false,
    withHandback: false,
    posture: "standard",
    timeoutMs: 120000,
    pollIntervalMs: 1500,
    evidenceDir: null,  // resolved later relative to repo root
    quiet: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--base":          out.base = next; i++; break;
      case "--label":         out.label = next; i++; break;
      case "--instruction":   out.instruction = next; i++; break;
      case "--with-followup": out.withFollowup = true; break;
      case "--with-handback": out.withHandback = true; break;
      case "--posture":       out.posture = next; i++; break;
      case "--timeout-ms":    out.timeoutMs = Number(next); i++; break;
      case "--poll-ms":       out.pollIntervalMs = Number(next); i++; break;
      case "--evidence-dir":  out.evidenceDir = next; i++; break;
      case "--quiet":         out.quiet = true; break;
      case "--json":          out.json = true; out.quiet = true; break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(2);
        }
    }
  }
  return out;
}

function printHelp() {
  console.log(`
Live verification probe for the review-relay chain.

Usage:
  node scripts/live-verify-review-relay.js [options]

Options:
  --base URL              Server base (default: http://127.0.0.1:4201)
  --label STR             Session label
  --instruction STR       Codex critique instruction
  --with-followup         Also exercise follow-up Codex
  --with-handback         Also exercise Claude hand-back (standard mode)
  --posture standard|public-sector
                          Probe variant (default: standard)
  --timeout-ms N          Max wait for critique_received (default: 120000)
  --poll-ms N             Polling interval for state transitions (default: 1500)
  --evidence-dir DIR      Where to write evidence JSON
                          (default: <repo>/docs/reports)
  --quiet                 Suppress colored progress output
  --json                  Print evidence JSON to stdout (implies --quiet)
  --help, -h              Show this help
`);
}

// ── Logger ────────────────────────────────────────────────────────

function makeLogger(quiet) {
  return {
    step: (n, msg) => quiet ? null : console.log(c.cyan(`\n[${n}]`), c.bold(msg)),
    pass: (msg) => quiet ? null : console.log(c.green("  PASS"), msg),
    fail: (msg) => quiet ? null : console.log(c.red("  FAIL"), msg),
    info: (msg) => quiet ? null : console.log(c.dim("       "), msg),
    warn: (msg) => quiet ? null : console.log(c.yellow("  WARN"), msg),
  };
}

// ── HTTP helpers ──────────────────────────────────────────────────

let _cachedToken = null;
async function getToken(base) {
  if (_cachedToken) return _cachedToken;
  const res = await fetch(`${base}/api/auth/token`);
  if (!res.ok) throw new Error(`auth token fetch failed: HTTP ${res.status}`);
  const body = await res.json();
  _cachedToken = body.token;
  return _cachedToken;
}

async function jsonGet(base, path) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function jsonPost(base, path, body) {
  const token = await getToken(base);
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-harness-token": token,
    },
    body: JSON.stringify(body || {}),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body: payload };
}

// ── Probe steps ───────────────────────────────────────────────────

async function step01_health(opts, evidence, log) {
  log.step("01", "Server health probe");
  try {
    const h = await jsonGet(opts.base, "/api/health");
    if (h.status !== "ok" || h.app !== "HarnessPipeline") {
      log.fail(`unexpected health response: ${JSON.stringify(h)}`);
      evidence.steps.push({ name: "health", pass: false, response: h });
      return false;
    }
    log.pass(`/api/health → ${h.status} (app: ${h.app})`);
    evidence.steps.push({ name: "health", pass: true, response: h });
    return true;
  } catch (e) {
    log.fail(`server not reachable: ${e.message}`);
    evidence.steps.push({ name: "health", pass: false, error: e.message });
    return false;
  }
}

async function step02_serverInfo(opts, evidence, log) {
  log.step("02", "Server info + posture");
  const info = await jsonGet(opts.base, "/api/server/info");
  const profile = info.profile || {};
  const deployment = info.deployment || {};
  log.info(`profile.activeId: ${profile.activeId || "(none)"}`);
  log.info(`deployment.mode:  ${deployment.mode || "(unknown)"}`);
  log.info(`deployment.publicSector: ${deployment.publicSector === true ? "YES" : "no"}`);
  log.info(`deployment.allowLocalExecutor: ${deployment.allowLocalExecutor === true ? "YES" : "no"}`);

  // Verify posture matches what operator declared
  const isPS = !!(deployment.publicSector === true);
  const expectedPS = opts.posture === "public-sector";
  if (isPS !== expectedPS) {
    log.warn(`posture mismatch: server reports publicSector=${isPS}, ` +
             `operator declared --posture=${opts.posture}`);
  } else {
    log.pass(`posture matches operator declaration (${opts.posture})`);
  }

  evidence.serverInfo = {
    profile, deployment,
    postureMatch: isPS === expectedPS,
  };
  evidence.steps.push({
    name: "server-info", pass: true, postureMatch: isPS === expectedPS,
  });
  return true;
}

async function step03_createSession(opts, evidence, log) {
  log.step("03", `Create review session "${opts.label}"`);
  const r = await jsonPost(opts.base, "/api/review-sessions", {
    label: opts.label,
    initialPlan: "operator live probe — see scripts/live-verify-review-relay.js",
  });
  if (r.status !== 201) {
    log.fail(`expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    evidence.steps.push({ name: "create-session", pass: false, response: r });
    return null;
  }
  const sessionId = r.body.session.sessionId;
  log.pass(`session created: ${sessionId.slice(0, 8)}…`);
  evidence.sessionId = sessionId;
  evidence.steps.push({ name: "create-session", pass: true, sessionId });
  return sessionId;
}

async function step04_sendCodex(opts, sessionId, evidence, log) {
  log.step("04", `Send to Codex — instruction: "${opts.instruction.slice(0, 60)}..."`);
  const r = await jsonPost(opts.base, `/api/review-sessions/${sessionId}/send-codex`, {
    instruction: opts.instruction,
  });
  if (r.status !== 200) {
    log.fail(`expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    evidence.steps.push({ name: "send-codex", pass: false, response: r });
    return false;
  }
  if (r.body.dispatched !== true) {
    log.fail(`expected dispatched:true, got ${r.body.dispatched}`);
    evidence.steps.push({ name: "send-codex", pass: false, response: r });
    return false;
  }
  if (r.body.runner !== "codex") {
    log.fail(`expected runner:codex, got ${r.body.runner}`);
    evidence.steps.push({ name: "send-codex", pass: false, response: r });
    return false;
  }
  log.pass(`dispatcher kicked codex runner (state: ${r.body.session.state})`);
  evidence.steps.push({
    name: "send-codex", pass: true,
    dispatched: r.body.dispatched, runner: r.body.runner,
    state: r.body.session.state,
  });
  return true;
}

async function step05_pollUntilCritiqueReceived(opts, sessionId, evidence, log) {
  log.step("05", `Poll session state until critique_received (max ${opts.timeoutMs}ms)`);
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < opts.timeoutMs) {
    let snap;
    try {
      snap = await jsonGet(opts.base, `/api/review-sessions/${sessionId}`);
    } catch (e) {
      log.warn(`poll fetch failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
      continue;
    }
    const state = snap.session.state;
    if (state !== lastState) {
      log.info(`state: ${state} (${Date.now() - startedAt}ms)`);
      lastState = state;
    }
    if (state === "critique_received") {
      const elapsedMs = Date.now() - startedAt;
      // Find latest critique_received history entry
      const critiqueEntry = (snap.session.history || []).reverse()
        .find((h) => h.kind === "critique_received");
      log.pass(`Codex critique received in ${elapsedMs}ms`);
      if (critiqueEntry) {
        const sc = critiqueEntry.severityCounts || {};
        log.info(`severityCounts: critical=${sc.critical || 0}, ` +
                 `high=${sc.high || 0}, medium=${sc.medium || 0}, ` +
                 `low=${sc.low || 0}, note=${sc.note || 0}`);
        if (critiqueEntry.summary) {
          log.info(`summary: ${critiqueEntry.summary.slice(0, 120)}...`);
        }
      }
      evidence.steps.push({
        name: "poll-critique-received", pass: true,
        elapsedMs,
        severityCounts: critiqueEntry ? critiqueEntry.severityCounts : null,
        summary: critiqueEntry ? critiqueEntry.summary : null,
      });
      evidence.critiqueReceivedElapsedMs = elapsedMs;
      return true;
    }
    if (state === "archived") {
      log.fail(`session archived before critique arrived`);
      evidence.steps.push({ name: "poll-critique-received", pass: false, finalState: state });
      return false;
    }
    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
  }
  log.fail(`timeout — final state: ${lastState}`);
  evidence.steps.push({ name: "poll-critique-received", pass: false, finalState: lastState, timedOut: true });
  return false;
}

async function step06_followUpCodex(opts, sessionId, evidence, log) {
  log.step("06", "Follow-up to Codex");
  const r = await jsonPost(opts.base, `/api/review-sessions/${sessionId}/follow-up`, {
    question: "Provide one concrete fix suggestion for the highest-severity finding.",
    target: "codex",
  });
  if (r.status !== 200) {
    log.fail(`expected 200, got ${r.status}`);
    evidence.steps.push({ name: "follow-up-codex", pass: false, response: r });
    return false;
  }
  log.pass(`dispatched:${r.body.dispatched}, runner:${r.body.runner || "n/a"}`);
  evidence.steps.push({
    name: "follow-up-codex", pass: true,
    dispatched: r.body.dispatched,
  });
  return true;
}

async function step07_handBackClaude(opts, sessionId, evidence, log) {
  log.step("07", "Hand-back to Claude");
  const r = await jsonPost(opts.base, `/api/review-sessions/${sessionId}/hand-back-claude`, {
    instruction: "Apply the highest-severity finding's fix.",
    includeCritique: true,
  });

  // Public-sector posture: expect 409
  if (opts.posture === "public-sector") {
    if (r.status === 409 && r.body.error === "public_sector_local_executor_disabled") {
      log.pass("public-sector posture correctly returned 409 + public_sector_local_executor_disabled");
      evidence.steps.push({
        name: "hand-back-claude-409", pass: true, status: 409,
        error: r.body.error,
      });
      return true;
    }
    log.fail(`expected 409 + public_sector_local_executor_disabled, ` +
             `got ${r.status} + ${r.body && r.body.error}`);
    evidence.steps.push({
      name: "hand-back-claude-409", pass: false, status: r.status,
      response: r.body,
    });
    return false;
  }

  // Standard posture: expect 200 + dispatched
  if (r.status !== 200) {
    log.fail(`expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    evidence.steps.push({ name: "hand-back-claude", pass: false, response: r });
    return false;
  }
  if (r.body.dispatched !== true || r.body.runner !== "claude") {
    log.fail(`expected dispatched:true + runner:claude, got ${JSON.stringify(r.body)}`);
    evidence.steps.push({ name: "hand-back-claude", pass: false, response: r });
    return false;
  }
  log.pass(`dispatcher kicked claude runner (state: ${r.body.session.state})`);
  evidence.steps.push({
    name: "hand-back-claude", pass: true,
    dispatched: r.body.dispatched, runner: r.body.runner,
  });
  return true;
}

async function step08_pollUntilClaudeReceived(opts, sessionId, evidence, log) {
  log.step("08", `Poll until claude_received (max ${opts.timeoutMs}ms)`);
  const startedAt = Date.now();
  let lastState = null;
  while (Date.now() - startedAt < opts.timeoutMs) {
    let snap;
    try {
      snap = await jsonGet(opts.base, `/api/review-sessions/${sessionId}`);
    } catch (_) {
      await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
      continue;
    }
    const state = snap.session.state;
    if (state !== lastState) {
      log.info(`state: ${state} (${Date.now() - startedAt}ms)`);
      lastState = state;
    }
    if (state === "claude_received") {
      const elapsedMs = Date.now() - startedAt;
      log.pass(`Claude hand-back complete in ${elapsedMs}ms`);
      evidence.steps.push({
        name: "poll-claude-received", pass: true, elapsedMs,
      });
      return true;
    }
    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
  }
  log.fail(`timeout — final state: ${lastState}`);
  evidence.steps.push({
    name: "poll-claude-received", pass: false, finalState: lastState, timedOut: true,
  });
  return false;
}

async function step09_archive(opts, sessionId, evidence, log) {
  log.step("09", "Archive the probe session");
  const r = await jsonPost(opts.base, `/api/review-sessions/${sessionId}/archive`, {
    reason: "live-verification-complete",
  });
  if (r.status !== 200) {
    log.fail(`expected 200, got ${r.status}`);
    evidence.steps.push({ name: "archive", pass: false, response: r });
    return false;
  }
  log.pass(`session archived (alreadyArchived:${!!r.body.alreadyArchived})`);
  evidence.steps.push({ name: "archive", pass: true });
  return true;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const log = makeLogger(opts.quiet);
  const startedAt = new Date().toISOString();
  const evidence = {
    schema: "live-verify-review-relay/v1",
    startedAt,
    options: {
      base: opts.base,
      label: opts.label,
      posture: opts.posture,
      withFollowup: opts.withFollowup,
      withHandback: opts.withHandback,
    },
    steps: [],
    sessionId: null,
    critiqueReceivedElapsedMs: null,
    serverInfo: null,
    verdict: "PENDING",
  };

  if (!opts.quiet) {
    console.log(c.bold(c.cyan("\n═══ Live Verification Round — Review Relay Probe ═══")));
    console.log(c.dim(`base:    ${opts.base}`));
    console.log(c.dim(`posture: ${opts.posture}`));
    console.log(c.dim(`flags:   ` +
      `withFollowup=${opts.withFollowup} withHandback=${opts.withHandback}`));
  }

  // Step 1: health
  if (!await step01_health(opts, evidence, log)) {
    return finish(opts, evidence, "FAIL_SERVER_DOWN", 2);
  }
  // Step 2: server info
  await step02_serverInfo(opts, evidence, log);

  // Step 3: create
  const sessionId = await step03_createSession(opts, evidence, log);
  if (!sessionId) return finish(opts, evidence, "FAIL_CREATE", 1);

  // Step 4: send-codex
  if (!await step04_sendCodex(opts, sessionId, evidence, log)) {
    return finish(opts, evidence, "FAIL_SEND_CODEX", 1);
  }

  // Step 5: poll until critique_received
  if (!await step05_pollUntilCritiqueReceived(opts, sessionId, evidence, log)) {
    return finish(opts, evidence, "FAIL_CRITIQUE_TIMEOUT", 1);
  }

  // Step 6: optional follow-up Codex
  if (opts.withFollowup) {
    if (!await step06_followUpCodex(opts, sessionId, evidence, log)) {
      return finish(opts, evidence, "FAIL_FOLLOWUP", 1);
    }
    // Wait briefly for follow-up to settle (next event broadcast)
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Step 7: hand-back-claude (standard) OR 409 expected (public-sector)
  if (opts.withHandback || opts.posture === "public-sector") {
    if (!await step07_handBackClaude(opts, sessionId, evidence, log)) {
      return finish(opts, evidence, "FAIL_HANDBACK", 1);
    }
    // In standard posture, also poll for claude_received
    if (opts.posture === "standard" && opts.withHandback) {
      if (!await step08_pollUntilClaudeReceived(opts, sessionId, evidence, log)) {
        return finish(opts, evidence, "FAIL_CLAUDE_TIMEOUT", 1);
      }
    }
  }

  // Step 9: archive
  await step09_archive(opts, sessionId, evidence, log);

  return finish(opts, evidence, "PASS", 0);
}

function finish(opts, evidence, verdict, exitCode) {
  evidence.verdict = verdict;
  evidence.completedAt = new Date().toISOString();
  evidence.exitCode = exitCode;

  // Determine evidence dir
  const repoRoot = path.resolve(__dirname, "..");
  const dir = opts.evidenceDir
    ? path.resolve(opts.evidenceDir)
    : path.join(repoRoot, "docs", "reports");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `${today}-review-relay-live-verify.json`;
  const target = path.join(dir, filename);
  fs.writeFileSync(target, JSON.stringify(evidence, null, 2), "utf-8");

  if (opts.json) {
    console.log(JSON.stringify(evidence, null, 2));
  } else {
    const log = makeLogger(opts.quiet);
    if (verdict === "PASS") {
      console.log(c.green(c.bold(`\n✔ ${verdict}`)) +
                  c.dim(`  evidence: ${target}`));
    } else {
      console.log(c.red(c.bold(`\n✖ ${verdict}`)) +
                  c.dim(`  evidence: ${target}`));
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(c.red(`\nUncaught probe error: ${err && err.stack ? err.stack : err}`));
  process.exit(2);
});
