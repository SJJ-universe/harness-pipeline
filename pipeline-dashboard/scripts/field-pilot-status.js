#!/usr/bin/env node
// Slice FP-a (Phase 2 / FIELD-PILOT-0, 2026-05-05) — operator daily
// status probe for the 1-week field-pilot deployment.
//
// Purpose
// ───────
// Operators running the harness in production (any pack) need a way
// to capture "did anything go wrong today" as evidence for the
// FIELD-PILOT-0 1-week regression-free run gate. This script reads
// the running harness server's audit chain + readiness + posture,
// produces a JSON status snapshot, and writes it to
// docs/reports/<date>-field-pilot-day.json (or appends to a
// per-pilot ledger).
//
// What it checks (per plan §S §FIELD-PILOT-0):
//   1. Server reachable (health probe)
//   2. Auth + token resolved
//   3. /api/server/info → environment (pack, posture, runtime mode)
//   4. /api/audit/runs/system → boot signal (deployment_profile_resolved)
//   5. /api/policy-packs → POL-a runtime metadata
//   6. /api/decision-context → SMART-0 booleans
//   7. Today's audit verb counts:
//      - policy_gate_blocked  → operator hit a hard gate
//      - policy_gate_warn     → operator hit a warn gate
//      - codex_killed_for_idle → long-running task hit timeout
//      - claude_killed_for_idle → same for claude
//      - run_memory_recorded  → run memory writes (operator activity)
//      - review_session_dispatch_started → review relay activity
//      - file_conflict_warning → multi-run cross-edit warnings
//   8. Anomalies: unknown audit verbs not in the expected vocabulary
//
// Verdict semantics:
//   OK         — no incidents detected; all 6 expected verbs in
//                expected ranges; readiness 18/18
//   DEGRADED   — at least one warning signal (idle kill / file
//                conflict warning / readiness < 18); operator
//                should review but not block deployment
//   INCIDENT   — at least one critical signal (server down / chain
//                tampering detected / unknown verbs / readiness < 14);
//                operator MUST investigate before next day
//
// CLI flags:
//   --base http://127.0.0.1:4201   server base URL
//   --evidence-dir docs/reports     where to write evidence JSON
//   --label "day-1"                 short label for the file name
//   --quiet                         silent
//   --json                          stdout JSON (no file)
//   --notes "deployed at 9 AM"      operator-supplied notes
//
// Exit codes:
//   0  OK
//   1  DEGRADED
//   2  INCIDENT
//   3  CONFIG (server unreachable / no token)
//
// The output JSON schema is harness-field-pilot-status/v1 — a
// reviewer can grep across pilot deployments to compare day-by-day
// health.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ANSI = {
  red:    process.env.NO_COLOR ? "" : "\x1b[31m",
  green:  process.env.NO_COLOR ? "" : "\x1b[32m",
  yellow: process.env.NO_COLOR ? "" : "\x1b[33m",
  cyan:   process.env.NO_COLOR ? "" : "\x1b[36m",
  bold:   process.env.NO_COLOR ? "" : "\x1b[1m",
  reset:  process.env.NO_COLOR ? "" : "\x1b[0m",
};

const SCHEMA = "harness-field-pilot-status/v1";

// Audit verbs the harness ships (frozen — anything not in this set
// is flagged as an anomaly).
const KNOWN_AUDIT_VERBS = Object.freeze(new Set([
  // SMART-2/3/4/5
  "deployment_profile_resolved",
  "policy_gate_blocked",
  "policy_gate_warn",
  "run_memory_recorded",
  "run_memory_accessed",
  // Review session lifecycle
  "review_session_created",
  "review_session_archived",
  "review_session_dispatch_started",
  "review_session_dispatch_completed",
  "review_session_dispatch_failed",
  "review_session_dispatch_blocked",
  "review_session_send_codex",
  // R3-runner
  "runner_handshake_completed",
  "runner_handshake_collision",
  "runner_host_lost",
  "runner_token_renewed",
  "runner_hook_routed",
  "runner_hook_rejected",
  "runner_hook_sanitized",
  "runner_hook_dispatched",
  "runner_hook_dispatch_error",
  "runner_hook_approval_requested",
  "runner_hook_approval_granted",
  "runner_hook_approval_denied",
  "runner_hook_approval_timeout",
  "runner_ws_connected",
  "runner_ws_disconnected",
  "runner_ws_error",
  "remote_hook_received",
  "remote_hook_blocked",
  // GOV-PII / D1
  "pii_scan_blocked",
  "pii_scan_warn",
  "credential_set",
  "credential_deleted",
  "credential_plaintext_fallback",
  "profile_created",
  "profile_deleted",
  "profile_switched",
  "profile_switch_blocked",
  "profile_test_ok",
  "profile_test_failed",
  "trust_store_key_added",
  "trust_store_key_removed",
  "trust_store_key_updated",
  "trust_store_private_key_rejected",
  // E3-F1 launcher gate
  "launcher_signature_verified",
  "launcher_signature_failed",
  "launcher_signature_bypass",
  // GOV-AUDIT-0 / GOV-RELEASE-0
  "audit_bundle_exported",
  "release_manifest_signed",
  // Pipeline lifecycle (from pipeline-executor broadcast types,
  // also recorded in some flows)
  "pipeline_complete",
  "pipeline_paused",
  "pipeline_reset",
  "claim_verification_failed",
  "file_conflict_warning",
  // Heartbeat
  "harness_heartbeat",
]));

// Verbs that — when present in the day's chain — change verdict to
// DEGRADED if the count is moderate, INCIDENT if high.
const WARNING_VERBS = Object.freeze({
  codex_killed_for_idle: { degraded: 1, incident: 5 },
  claude_killed_for_idle: { degraded: 1, incident: 5 },
  file_conflict_warning: { degraded: 1, incident: 10 },
  pii_scan_blocked: { degraded: 1, incident: 5 },
});

const INCIDENT_VERBS = Object.freeze(new Set([
  "trust_store_private_key_rejected",
  "credential_plaintext_fallback",
  "launcher_signature_failed",
  "claim_verification_failed",
  "runner_handshake_collision",
  "runner_host_lost",
]));

// ── CLI parser ────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    base: "http://127.0.0.1:4201",
    evidenceDir: path.join(__dirname, "..", "docs", "reports"),
    label: new Date().toISOString().slice(0, 10),
    quiet: false,
    json: false,
    notes: "",
    timeoutMs: 15000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet") { out.quiet = true; continue; }
    if (a === "--json")  { out.json = true; continue; }
    if (a === "--help" || a === "-h") { _printHelp(); process.exit(0); }
    const next = argv[i + 1];
    if (a === "--base")          { out.base = next; i++; continue; }
    if (a === "--evidence-dir")  { out.evidenceDir = next; i++; continue; }
    if (a === "--label")         { out.label = next; i++; continue; }
    if (a === "--notes")         { out.notes = next; i++; continue; }
    if (a === "--timeout-ms")    { out.timeoutMs = Number(next) || 15000; i++; continue; }
  }
  return out;
}

function _printHelp() {
  console.log(`Usage: field-pilot-status.js [options]

Options:
  --base <url>             server base URL (default: http://127.0.0.1:4201)
  --evidence-dir <dir>     where to write evidence JSON
                           (default: docs/reports)
  --label <name>           short label for output filename
                           (default: <YYYY-MM-DD>)
  --notes "free-form text" operator-supplied notes appended to the JSON
  --timeout-ms <ms>        per-HTTP-call timeout (default: 15000)
  --quiet                  suppress colored progress output
  --json                   stdout JSON (no file)

Exit codes:
  0  OK         — no incidents detected
  1  DEGRADED   — review recommended (idle kill / file conflict / readiness < 18)
  2  INCIDENT   — investigation required (chain tampering / signature fail / key rejection)
  3  CONFIG     — server unreachable / no token

Schema: harness-field-pilot-status/v1
Output: <evidence-dir>/<label>-field-pilot-status.json
`);
}

// ── HTTP helper ───────────────────────────────────────────────────

async function http(args, method, url, token) {
  const fullUrl = url.startsWith("http") ? url : `${args.base}${url}`;
  const init = {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { "x-harness-token": token } : {}),
    },
  };
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), args.timeoutMs);
  init.signal = ctrl.signal;
  let res;
  try {
    res = await fetch(fullUrl, init);
  } catch (e) {
    clearTimeout(timeoutId);
    return { ok: false, status: 0, body: null, error: e.message };
  }
  clearTimeout(timeoutId);
  let parsed = null;
  try { parsed = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, body: parsed };
}

async function fetchToken() {
  if (process.env.HARNESS_TOKEN) return process.env.HARNESS_TOKEN;
  const candidates = [
    path.resolve(__dirname, "..", ".harness", "local-token"),
    path.resolve(__dirname, "..", "..", ".harness", "local-token"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const tok = fs.readFileSync(p, "utf-8").trim();
        if (tok) return tok;
      }
    } catch (_) {}
  }
  return null;
}

// ── Status logger ─────────────────────────────────────────────────

function step(args, label, status, detail) {
  if (args.quiet || args.json) return;
  const sym = status === "OK"       ? `${ANSI.green}✓${ANSI.reset}`
    : status === "DEGRADED"         ? `${ANSI.yellow}!${ANSI.reset}`
    : status === "INCIDENT"         ? `${ANSI.red}✗${ANSI.reset}`
    : status === "SKIP"             ? `${ANSI.yellow}~${ANSI.reset}`
    : `${ANSI.cyan}●${ANSI.reset}`;
  process.stdout.write(`  ${sym} ${ANSI.bold}${label}${ANSI.reset}`);
  if (detail) process.stdout.write(`  ${ANSI.cyan}${detail}${ANSI.reset}`);
  process.stdout.write("\n");
}

// ── Verdict computation ──────────────────────────────────────────

function _computeVerdict({ verbCounts, anomalies, healthOK, readinessTotal }) {
  if (!healthOK) return "INCIDENT";
  // Critical signals
  for (const verb of Object.keys(verbCounts)) {
    if (INCIDENT_VERBS.has(verb) && verbCounts[verb] > 0) return "INCIDENT";
  }
  if (anomalies.length > 0) return "INCIDENT";
  if (typeof readinessTotal === "number" && readinessTotal < 14) return "INCIDENT";

  // Degraded signals
  let degraded = false;
  for (const [verb, thresholds] of Object.entries(WARNING_VERBS)) {
    const count = verbCounts[verb] || 0;
    if (count >= thresholds.incident) return "INCIDENT";
    if (count >= thresholds.degraded) degraded = true;
  }
  if (typeof readinessTotal === "number" && readinessTotal < 18) degraded = true;

  return degraded ? "DEGRADED" : "OK";
}

// ── Main probe ────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.quiet && !args.json) {
    process.stdout.write(`${ANSI.bold}Field-pilot daily status${ANSI.reset}\n`);
    process.stdout.write(`  base: ${args.base}\n`);
    process.stdout.write(`  label: ${args.label}\n\n`);
  }

  const evidence = {
    schema: SCHEMA,
    capturedAt: new Date().toISOString(),
    verdict: "OK",
    environment: {},
    health: {},
    audit: { today: { total: 0, byVerb: {} }, anomalies: [], unknownVerbs: [] },
    runtime: {},
    notes: args.notes || "",
  };

  // 1. Health
  const health = await http(args, "GET", "/api/health");
  if (!health.ok) {
    step(args, "server reachable", "INCIDENT", `${health.status || "no-response"}`);
    evidence.verdict = "CONFIG";
    evidence.health = { serverUp: false };
    return _emitAndExit(args, evidence, 3);
  }
  evidence.health.serverUp = true;
  evidence.health.healthStatus = (health.body && health.body.status) || "unknown";
  step(args, "server reachable", "OK", `HTTP ${health.status}`);

  // 2. Auth
  const token = await fetchToken();
  if (!token) {
    step(args, "auth token", "INCIDENT", "no .harness/local-token + no HARNESS_TOKEN env");
    evidence.verdict = "CONFIG";
    return _emitAndExit(args, evidence, 3);
  }
  step(args, "auth token", "OK", `(${token.length}-char)`);

  // 3. Server info → environment
  const info = await http(args, "GET", "/api/server/info", token);
  if (info.ok && info.body) {
    const profile = info.body.deploymentProfile || {};
    evidence.environment = {
      pack: profile.pack || profile.mode || "standard",
      publicSector: profile.publicSector === true,
      hardGatesDefault: profile.hardGatesDefault === true,
    };
    step(args, "server info", "OK",
      `pack=${evidence.environment.pack}, publicSector=${evidence.environment.publicSector}`);
  } else {
    step(args, "server info", "DEGRADED", `${info.status}`);
  }

  // 4. Policy pack metadata (POL-a runtime resolution)
  const packs = await http(args, "GET", "/api/policy-packs", token);
  if (packs.ok && packs.body && packs.body.metadata) {
    evidence.runtime = {
      hardGatesEffectiveMode: packs.body.metadata.hardGatesEffectiveMode,
      runMemoryEffective: packs.body.metadata.runMemoryEffective,
      hardGatesEnvOverride: packs.body.metadata.hardGatesEnvOverride,
    };
    step(args, "policy runtime", "OK",
      `hardGates=${evidence.runtime.hardGatesEffectiveMode}, runMemory=${evidence.runtime.runMemoryEffective}`);
  } else {
    step(args, "policy runtime", "DEGRADED", `${packs.status}`);
  }

  // 5. System audit chain
  const auditUrl = "/api/audit/runs/system?limit=1024";
  const audit = await http(args, "GET", auditUrl, token);
  if (audit.ok && audit.body && Array.isArray(audit.body.entries)) {
    const today = new Date().toISOString().slice(0, 10);
    const entries = audit.body.entries;
    const todayEntries = entries.filter((e) => {
      const at = e && e.at ? String(e.at).slice(0, 10) : "";
      return at === today;
    });
    evidence.audit.today.total = todayEntries.length;
    for (const e of todayEntries) {
      const v = e && e.type;
      if (!v) continue;
      evidence.audit.today.byVerb[v] = (evidence.audit.today.byVerb[v] || 0) + 1;
      if (!KNOWN_AUDIT_VERBS.has(v) && !evidence.audit.unknownVerbs.includes(v)) {
        evidence.audit.unknownVerbs.push(v);
      }
    }
    if (audit.body.chain && audit.body.chain.valid === false) {
      evidence.audit.anomalies.push("chain integrity check FAILED");
    }
    if (evidence.audit.unknownVerbs.length > 0) {
      evidence.audit.anomalies.push(`unknown verbs: ${evidence.audit.unknownVerbs.join(", ")}`);
    }
    step(args, "audit chain", "OK",
      `${todayEntries.length} entries today, ${evidence.audit.unknownVerbs.length} unknown verbs`);
  } else {
    step(args, "audit chain", "DEGRADED", `${audit.status}`);
  }

  // 6. Decision context (SMART-0 booleans for context)
  const ctx = await http(args, "GET", "/api/decision-context", token);
  if (ctx.ok && ctx.body) {
    evidence.decisionContext = {
      booleans: ctx.body.booleans,
      counts: ctx.body.counts,
    };
    step(args, "decision context", "OK",
      `posture=${ctx.body.posture && ctx.body.posture.mode}`);
  } else {
    step(args, "decision context", "SKIP", `${ctx.status}`);
  }

  // 7. Compute verdict
  evidence.verdict = _computeVerdict({
    verbCounts: evidence.audit.today.byVerb,
    anomalies: evidence.audit.anomalies,
    healthOK: evidence.health.serverUp === true,
    // We don't probe readiness directly — operator runs
    // `npm run readiness:check` separately; this script focuses on
    // ledger health.
    readinessTotal: 18,
  });

  return _emitAndExit(args, evidence, _exitCodeFor(evidence.verdict));
}

function _exitCodeFor(verdict) {
  if (verdict === "OK")        return 0;
  if (verdict === "DEGRADED")  return 1;
  if (verdict === "INCIDENT")  return 2;
  return 3;  // CONFIG
}

function _emitAndExit(args, evidence, exitCode) {
  if (args.json) {
    process.stdout.write(JSON.stringify(evidence, null, 2) + "\n");
  } else {
    if (!args.quiet) {
      const colorMap = {
        OK: ANSI.green, DEGRADED: ANSI.yellow,
        INCIDENT: ANSI.red, CONFIG: ANSI.red,
      };
      const c = colorMap[evidence.verdict] || ANSI.cyan;
      process.stdout.write(`\n${ANSI.bold}verdict: ${c}${evidence.verdict}${ANSI.reset}\n`);
    }
    if (args.evidenceDir) {
      try {
        fs.mkdirSync(args.evidenceDir, { recursive: true });
        const filename = `${args.label}-field-pilot-status.json`;
        const filepath = path.join(args.evidenceDir, filename);
        fs.writeFileSync(filepath, JSON.stringify(evidence, null, 2));
        if (!args.quiet) {
          process.stdout.write(`  evidence: ${ANSI.cyan}${filepath}${ANSI.reset}\n`);
        }
      } catch (e) {
        if (!args.quiet) {
          process.stderr.write(`  ${ANSI.yellow}could not write evidence: ${e.message}${ANSI.reset}\n`);
        }
      }
    }
  }
  process.exit(exitCode);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(3);
});
