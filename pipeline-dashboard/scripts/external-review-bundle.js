#!/usr/bin/env node
// Slice EXR-a (Phase 2 / EXTERNAL-REVIEW-0, 2026-05-05) — external
// reviewer evidence bundle exporter.
//
// Purpose
// ───────
// EXTERNAL-REVIEW-0 is the cap-movement gate that consumes everything
// the prior 4 priority rounds (RELEASE-READY-0 / SMART-LV-0 /
// POLICY-UX-0 / FIELD-PILOT-0) shipped, plus all earlier round
// closeouts, and gives a third party enough material to verify
// "regression-free + cap movement deserved" without trusting the
// committer.
//
// This script compiles a single JSON manifest pointing at every
// artifact a reviewer needs, with sha256 fingerprints + the live
// audit chain integrity verdict + the live readiness verdict if a
// server is reachable. The reviewer can then walk the bundle offline.
//
// What this captures (priority order):
//   1. Repo state — HEAD sha, branch, untracked + modified files
//   2. Scorecard markdown — path + bytes + sha256 + parsed current
//      score (e.g. "120/126")
//   3. Readiness rubric markdown — path + bytes + sha256
//   4. Closeout reports — every docs/reports/*-eval.md sorted by date
//      with sha256
//   5. Field-pilot daily snapshots — every docs/reports/*-field-pilot
//      -status.json with parsed verdict
//   6. Round trajectory — each closed-round line in scorecard parsed
//      into id + score + date + line number
//   7. (--live, default on) — current /api/server/info + readiness
//      + audit chain validity + scorecard freshness
//   8. (--strict) — fails if any expected artifact missing
//
// Verdict semantics:
//   OK         — repo clean, ≥4 closeout reports present, scorecard
//                parseable, live (when run) shows serverUp + chain
//                valid + readiness ≥ 17/18
//   DEGRADED   — repo dirty (uncommitted work) OR live readiness <
//                18/18 OR fewer than 4 closeout reports OR live
//                server unreachable when --strict is OFF
//   INCIDENT   — audit chain.valid === false OR scorecard parse
//                failed (no current score line) OR --strict and live
//                server unreachable
//   CONFIG     — scorecard.md missing OR readiness-rubric.md missing
//                OR not in a git repo
//
// CLI flags:
//   --base http://127.0.0.1:4201   server base URL for live probe
//   --output-dir docs/external-review  where to write bundle JSON
//   --label "review-2026-05-05"    short label for the file name
//   --notes "for external auditor"  reviewer-supplied note
//   --skip-live                    don't probe the server
//   --strict                       fail loudly on any missing artifact
//   --quiet                        no stdout chatter
//   --json                         emit JSON to stdout (no file)
//   --timeout-ms 15000             per-HTTP-call timeout
//
// Exit codes:
//   0  OK
//   1  DEGRADED
//   2  INCIDENT
//   3  CONFIG (file missing / not a git repo)
//
// Output schema: harness-external-review-bundle/v1
// Output file:   <output-dir>/<label>-external-review-bundle.json
//
// External reviewer pattern:
//   1. Operator runs node scripts/external-review-bundle.js
//   2. Script writes <date>-external-review-bundle.json
//   3. Operator commits + hands the bundle to the reviewer
//   4. Reviewer opens bundle.json, walks the artifact list, runs
//      verify-auditor-bundle.js on per-run audit exports as needed,
//      and produces a regression-free / cap-movement verdict

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const ANSI = {
  red:    process.env.NO_COLOR ? "" : "\x1b[31m",
  green:  process.env.NO_COLOR ? "" : "\x1b[32m",
  yellow: process.env.NO_COLOR ? "" : "\x1b[33m",
  cyan:   process.env.NO_COLOR ? "" : "\x1b[36m",
  bold:   process.env.NO_COLOR ? "" : "\x1b[1m",
  reset:  process.env.NO_COLOR ? "" : "\x1b[0m",
};

const SCHEMA = "harness-external-review-bundle/v1";

// Project root resolution — anchor at the pipeline-dashboard
// directory (the script's parent), where docs/ + scripts/ live. Git
// commands are then run from this directory; git will walk up itself
// to find the .git folder if it lives at a higher level.
const REPO_ROOT = path.resolve(__dirname, "..");

// ── CLI parser ────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    base: "http://127.0.0.1:4201",
    outputDir: path.join(REPO_ROOT, "docs", "external-review"),
    label: new Date().toISOString().slice(0, 10),
    quiet: false,
    json: false,
    skipLive: false,
    strict: false,
    notes: "",
    timeoutMs: 15000,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--quiet")     { out.quiet = true; continue; }
    if (a === "--json")      { out.json = true; continue; }
    if (a === "--skip-live") { out.skipLive = true; continue; }
    if (a === "--strict")    { out.strict = true; continue; }
    if (a === "--help" || a === "-h") { _printHelp(); process.exit(0); }
    const next = argv[i + 1];
    if (a === "--base")        { out.base = next; i++; continue; }
    if (a === "--output-dir")  { out.outputDir = next; i++; continue; }
    if (a === "--label")       { out.label = next; i++; continue; }
    if (a === "--notes")       { out.notes = next; i++; continue; }
    if (a === "--timeout-ms")  { out.timeoutMs = Number(next) || 15000; i++; continue; }
  }
  return out;
}

function _printHelp() {
  process.stdout.write(`Usage: external-review-bundle.js [options]

Compile every artifact an external reviewer needs into one JSON manifest.

Options:
  --base <url>             server base URL for live probe (default: http://127.0.0.1:4201)
  --output-dir <dir>       where to write bundle JSON
                           (default: docs/external-review)
  --label <name>           short label for output filename
                           (default: <YYYY-MM-DD>)
  --notes "free-form text" reviewer-supplied note appended to the JSON
  --skip-live              don't probe the live server (offline mode)
  --strict                 fail loudly on any missing artifact
                           (live server unreachable becomes INCIDENT)
  --timeout-ms <ms>        per-HTTP-call timeout (default: 15000)
  --quiet                  suppress colored progress output
  --json                   emit JSON to stdout instead of writing file

Exit codes:
  0  OK         — repo clean, scorecard parseable, ≥4 closeouts, live (if probed) green
  1  DEGRADED   — uncommitted work, live readiness < 18/18, or fewer closeouts
  2  INCIDENT   — audit chain integrity FAILED, scorecard parse FAILED, or --strict + offline
  3  CONFIG     — scorecard.md missing, readiness-rubric.md missing, not a git repo

Schema: harness-external-review-bundle/v1
Output: <output-dir>/<label>-external-review-bundle.json
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
    path.resolve(REPO_ROOT, ".harness", "local-token"),
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

// ── Status logger ────────────────────────────────────────────────

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

// ── File helpers ─────────────────────────────────────────────────

function _sha256OfFile(p) {
  const buf = fs.readFileSync(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function _statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// ── Repo metadata via git ────────────────────────────────────────

function _git(...gitArgs) {
  try {
    return execFileSync("git", gitArgs, {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    return null;
  }
}

function _captureRepo() {
  const head = _git("rev-parse", "HEAD");
  if (!head) return null;
  const branch = _git("rev-parse", "--abbrev-ref", "HEAD") || "(detached)";
  const statusOut = _git("status", "--porcelain") || "";
  const statusLines = statusOut.split("\n").filter(Boolean);
  const untracked = [];
  const modified = [];
  for (const line of statusLines) {
    const code = line.slice(0, 2);
    const file = line.slice(3);
    if (code === "??") untracked.push(file);
    else modified.push({ code: code.trim(), file });
  }
  return {
    head,
    branch,
    cleanWorkingTree: statusLines.length === 0,
    untrackedFiles: untracked,
    modifiedFiles: modified,
  };
}

// ── Scorecard parsing ────────────────────────────────────────────

function _parseScorecard(scorecardPath) {
  if (!fs.existsSync(scorecardPath)) return null;
  const md = fs.readFileSync(scorecardPath, "utf-8");
  const out = {
    path: path.relative(REPO_ROOT, scorecardPath).replace(/\\/g, "/"),
    bytes: Buffer.byteLength(md, "utf-8"),
    sha256: _sha256OfFile(scorecardPath),
    currentScore: null,
    scoreNumerator: null,
    scoreCap: null,
  };
  // Look for the **N / M** header — first markdown bold pattern after
  // "## Current Score".
  const idx = md.indexOf("## Current Score");
  if (idx >= 0) {
    const tail = md.slice(idx);
    const m = tail.match(/\*\*(\d+)\s*\/\s*(\d+)\*\*/);
    if (m) {
      out.scoreNumerator = Number(m[1]);
      out.scoreCap = Number(m[2]);
      out.currentScore = `${m[1]}/${m[2]}`;
    }
  }
  return out;
}

// ── Closeout report enumeration ──────────────────────────────────

function _enumerateCloseouts(reportsDir) {
  const out = [];
  if (!fs.existsSync(reportsDir)) return out;
  const entries = fs.readdirSync(reportsDir);
  for (const name of entries) {
    if (!name.endsWith("-eval.md")) continue;
    const full = path.join(reportsDir, name);
    const stat = _statSafe(full);
    if (!stat || !stat.isFile()) continue;
    // Date prefix: "YYYY-MM-DD-..."
    const dateMatch = name.match(/^(\d{4}-\d{2}-\d{2})-/);
    out.push({
      path: path.relative(REPO_ROOT, full).replace(/\\/g, "/"),
      bytes: stat.size,
      sha256: _sha256OfFile(full),
      date: dateMatch ? dateMatch[1] : null,
      slice: name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-eval\.md$/, ""),
    });
  }
  // Sort newest-first, then by name.
  out.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    return a.path.localeCompare(b.path);
  });
  return out;
}

// ── Field-pilot snapshot enumeration ─────────────────────────────

function _enumerateFieldPilotSnapshots(reportsDir) {
  const out = [];
  if (!fs.existsSync(reportsDir)) return out;
  const entries = fs.readdirSync(reportsDir);
  for (const name of entries) {
    if (!name.endsWith("-field-pilot-status.json")) continue;
    const full = path.join(reportsDir, name);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
    } catch (_) {
      // Malformed snapshot — record path but no verdict
    }
    out.push({
      path: path.relative(REPO_ROOT, full).replace(/\\/g, "/"),
      label: name.replace(/-field-pilot-status\.json$/, ""),
      verdict: parsed && parsed.verdict ? parsed.verdict : null,
      capturedAt: parsed && parsed.capturedAt ? parsed.capturedAt : null,
      schema: parsed && parsed.schema ? parsed.schema : null,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

// ── Round trajectory parsing ─────────────────────────────────────

// Find every "━━━ ROUND-NAME closed at N/M (YYYY-MM-DD) — ..." line.
function _parseRoundTrajectory(scorecardPath) {
  const out = [];
  if (!fs.existsSync(scorecardPath)) return out;
  const md = fs.readFileSync(scorecardPath, "utf-8");
  const lines = md.split(/\r?\n/);
  // Pattern matches both bold-wrapped form and bare form.
  const re = /[━─-]+\s*([A-Z][A-Z0-9-]+)\s*closed at\s*(\d+)\s*\/\s*(\d+)\s*\((\d{4}-\d{2}-\d{2})\)\s*[—-]\s*(.+?)(?:\s*[━─-]+)?$/;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\*\*/g, "");
    const m = stripped.match(re);
    if (m) {
      out.push({
        id: m[1],
        score: `${m[2]}/${m[3]}`,
        scoreNumerator: Number(m[2]),
        scoreCap: Number(m[3]),
        date: m[4],
        title: m[5].trim(),
        lineNumber: i + 1,
      });
    }
  }
  return out;
}

// ── Live probe ───────────────────────────────────────────────────

async function _captureLive(args) {
  const live = {
    captured: false,
    skipped: false,
    skipReason: null,
    serverUp: false,
    serverInfo: null,
    readiness: null,
    auditChain: null,
  };
  if (args.skipLive) {
    live.skipped = true;
    live.skipReason = "--skip-live";
    step(args, "live probe", "SKIP", "--skip-live");
    return live;
  }
  // 1. Health
  const health = await http(args, "GET", "/api/health");
  if (!health.ok) {
    live.serverUp = false;
    live.skipReason = `health probe failed (${health.status || "no-response"})`;
    step(args, "live probe", "DEGRADED", live.skipReason);
    return live;
  }
  live.serverUp = true;
  live.captured = true;

  const token = await fetchToken();
  if (!token) {
    live.skipReason = "no auth token (.harness/local-token absent + HARNESS_TOKEN unset)";
    step(args, "live probe", "DEGRADED", live.skipReason);
    return live;
  }

  // 2. Server info — environment posture only (no secrets).
  const info = await http(args, "GET", "/api/server/info", token);
  if (info.ok && info.body) {
    const profile = info.body.deploymentProfile || {};
    live.serverInfo = {
      version: info.body.version || null,
      pack: profile.pack || profile.mode || "standard",
      publicSector: profile.publicSector === true,
      hardGatesDefault: profile.hardGatesDefault === true,
    };
  }

  // 3. Audit chain integrity — system run.
  const audit = await http(args, "GET", "/api/audit/runs/system?limit=64", token);
  if (audit.ok && audit.body) {
    const entries = Array.isArray(audit.body.entries) ? audit.body.entries : [];
    const chainBlock = audit.body.chain || {};
    live.auditChain = {
      entries: entries.length,
      chainValid: chainBlock.valid !== false,
      chainBlockPresent: Boolean(audit.body.chain),
    };
  } else {
    live.auditChain = { entries: 0, chainValid: false, chainBlockPresent: false };
  }

  // 4. Readiness — call into local readiness-report.js by spawning it
  //    rather than reaching into internals. We only need totals; the
  //    detailed star ledger is in the rubric markdown which we already
  //    sha256 at the file layer.
  try {
    const readinessJson = execFileSync(
      "node",
      [path.join(REPO_ROOT, "scripts", "readiness-report.js"), "--json", "--no-spawn"],
      { encoding: "utf-8", timeout: args.timeoutMs, stdio: ["ignore", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(readinessJson);
    live.readiness = {
      total: typeof parsed.total === "number" ? parsed.total : null,
      max: typeof parsed.max === "number" ? parsed.max : null,
      categoryCount: Array.isArray(parsed.categories) ? parsed.categories.length : null,
    };
  } catch (e) {
    live.readiness = { error: e.message || String(e) };
  }

  step(args, "live probe", live.auditChain.chainValid ? "OK" : "INCIDENT",
    `entries=${live.auditChain.entries}, chainValid=${live.auditChain.chainValid}, ` +
    `readiness=${live.readiness && live.readiness.total != null ? `${live.readiness.total}/${live.readiness.max}` : "(skipped)"}`);
  return live;
}

// ── Verdict computation ─────────────────────────────────────────

function _computeVerdict(bundle, args) {
  // CONFIG: missing critical files
  if (!bundle.scorecard) return "CONFIG";
  if (!bundle.readinessRubric) return "CONFIG";
  if (!bundle.repo) return "CONFIG";

  // INCIDENT: scorecard unparseable, audit chain bad, --strict + offline
  if (bundle.scorecard.scoreNumerator == null) return "INCIDENT";
  if (bundle.live && bundle.live.captured && bundle.live.auditChain
      && bundle.live.auditChain.chainValid === false) return "INCIDENT";
  if (args.strict && bundle.live && !bundle.live.captured && !bundle.live.skipped) {
    return "INCIDENT";
  }

  // DEGRADED: uncommitted work, missing closeouts, readiness < cap
  let degraded = false;
  if (!bundle.repo.cleanWorkingTree) degraded = true;
  if (bundle.closeoutReports.length < 4) degraded = true;
  if (bundle.live && bundle.live.captured && bundle.live.readiness
      && typeof bundle.live.readiness.total === "number"
      && typeof bundle.live.readiness.max === "number"
      && bundle.live.readiness.total < bundle.live.readiness.max) {
    degraded = true;
  }
  if (bundle.live && !bundle.live.captured && !bundle.live.skipped) degraded = true;

  return degraded ? "DEGRADED" : "OK";
}

// ── Output ──────────────────────────────────────────────────────

function _emitAndExit(args, bundle, exitCode) {
  if (args.json) {
    process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
    process.exit(exitCode);
    return;
  }
  // Write to file
  try {
    fs.mkdirSync(args.outputDir, { recursive: true });
  } catch (_) {}
  const fileName = `${args.label}-external-review-bundle.json`;
  const fullPath = path.join(args.outputDir, fileName);
  fs.writeFileSync(fullPath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");
  if (!args.quiet) {
    process.stdout.write(`\n${ANSI.bold}Bundle written:${ANSI.reset} ${fullPath}\n`);
    process.stdout.write(`${ANSI.bold}Verdict:${ANSI.reset} ${bundle.verdict}\n`);
    if (bundle.anomalies.length > 0) {
      process.stdout.write(`${ANSI.yellow}Anomalies:${ANSI.reset}\n`);
      for (const a of bundle.anomalies) process.stdout.write(`  - ${a}\n`);
    }
  }
  process.exit(exitCode);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);
  if (!args.quiet && !args.json) {
    process.stdout.write(`${ANSI.bold}External review evidence bundle${ANSI.reset}\n`);
    process.stdout.write(`  repo: ${REPO_ROOT}\n`);
    process.stdout.write(`  label: ${args.label}\n\n`);
  }

  const bundle = {
    schema: SCHEMA,
    capturedAt: new Date().toISOString(),
    verdict: "OK",
    label: args.label,
    repo: null,
    scorecard: null,
    readinessRubric: null,
    closeoutReports: [],
    fieldPilotSnapshots: [],
    rounds: [],
    live: null,
    anomalies: [],
    notes: args.notes || "",
  };

  // 1. Repo metadata
  bundle.repo = _captureRepo();
  if (!bundle.repo) {
    step(args, "repo metadata", "INCIDENT", "not a git repo");
    bundle.anomalies.push("not a git repo (cannot capture HEAD)");
    bundle.verdict = "CONFIG";
    return _emitAndExit(args, bundle, 3);
  }
  step(args, "repo metadata", bundle.repo.cleanWorkingTree ? "OK" : "DEGRADED",
    `HEAD=${bundle.repo.head.slice(0, 7)} branch=${bundle.repo.branch} ` +
    `clean=${bundle.repo.cleanWorkingTree} untracked=${bundle.repo.untrackedFiles.length}`);

  // 2. Scorecard
  const scorecardPath = path.join(REPO_ROOT, "docs", "scorecard.md");
  bundle.scorecard = _parseScorecard(scorecardPath);
  if (!bundle.scorecard) {
    step(args, "scorecard.md", "INCIDENT", "missing");
    bundle.anomalies.push("docs/scorecard.md missing");
    bundle.verdict = "CONFIG";
    return _emitAndExit(args, bundle, 3);
  }
  if (bundle.scorecard.scoreNumerator == null) {
    bundle.anomalies.push("scorecard.md current score not parseable");
  }
  step(args, "scorecard.md",
    bundle.scorecard.scoreNumerator != null ? "OK" : "DEGRADED",
    `score=${bundle.scorecard.currentScore || "(unparsed)"} bytes=${bundle.scorecard.bytes}`);

  // 3. Readiness rubric
  const rubricPath = path.join(REPO_ROOT, "docs", "readiness-rubric.md");
  if (!fs.existsSync(rubricPath)) {
    step(args, "readiness-rubric.md", "INCIDENT", "missing");
    bundle.anomalies.push("docs/readiness-rubric.md missing");
    bundle.verdict = "CONFIG";
    return _emitAndExit(args, bundle, 3);
  }
  const rubricStat = _statSafe(rubricPath);
  bundle.readinessRubric = {
    path: path.relative(REPO_ROOT, rubricPath).replace(/\\/g, "/"),
    bytes: rubricStat ? rubricStat.size : 0,
    sha256: _sha256OfFile(rubricPath),
  };
  step(args, "readiness-rubric.md", "OK", `bytes=${bundle.readinessRubric.bytes}`);

  // 4. Closeout reports
  const reportsDir = path.join(REPO_ROOT, "docs", "reports");
  bundle.closeoutReports = _enumerateCloseouts(reportsDir);
  step(args, "closeout reports",
    bundle.closeoutReports.length >= 4 ? "OK" : "DEGRADED",
    `${bundle.closeoutReports.length} reports`);
  if (bundle.closeoutReports.length < 4) {
    bundle.anomalies.push(`only ${bundle.closeoutReports.length} closeout reports found (expected ≥4 for the 5-priority roadmap closure)`);
  }

  // 5. Field-pilot snapshots (operator-time; OK to be empty)
  bundle.fieldPilotSnapshots = _enumerateFieldPilotSnapshots(reportsDir);
  step(args, "field-pilot snapshots",
    bundle.fieldPilotSnapshots.length > 0 ? "OK" : "SKIP",
    `${bundle.fieldPilotSnapshots.length} snapshots`);

  // 6. Round trajectory
  bundle.rounds = _parseRoundTrajectory(scorecardPath);
  step(args, "round trajectory",
    bundle.rounds.length >= 4 ? "OK" : "DEGRADED",
    `${bundle.rounds.length} closed-round entries parsed`);
  if (args.strict && bundle.rounds.length < 4) {
    bundle.anomalies.push(`--strict: only ${bundle.rounds.length} closed-round entries parsed`);
  }

  // 7. Live probe
  bundle.live = await _captureLive(args);

  // 8. Final verdict
  bundle.verdict = _computeVerdict(bundle, args);

  const exitCode = bundle.verdict === "OK"       ? 0
                 : bundle.verdict === "DEGRADED" ? 1
                 : bundle.verdict === "INCIDENT" ? 2
                 : 3;
  return _emitAndExit(args, bundle, exitCode);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`fatal: ${e && e.stack ? e.stack : e}\n`);
    process.exit(2);
  });
}

module.exports = {
  SCHEMA,
  parseArgs,
  _parseScorecard,
  _enumerateCloseouts,
  _enumerateFieldPilotSnapshots,
  _parseRoundTrajectory,
  _computeVerdict,
};
