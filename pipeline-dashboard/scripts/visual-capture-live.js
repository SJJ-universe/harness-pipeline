#!/usr/bin/env node
// Slice UI-P10-c (Phase D Round UI-P, 2026-05-04) — CLI entry that
// orchestrates the live browser visual verification:
//
//   1. Boots the dashboard server in-process via
//      `scripts/visual-live/server-boot` (default port 4799,
//      override via env ORCHESTRATOR_VISUAL_LIVE_PORT or --port).
//   2. Runs the 16-cell capture matrix via
//      `scripts/visual-live/capture.runCapture` (4 routes × 4
//      viewports).
//   3. Writes manifest.json next to the PNG files in the output
//      directory (default `docs/reports/<date>-ui-p10-live/`,
//      override via --out-dir).
//   4. Closes the server.
//
// Exit codes (matches scripts/live-verify-review-relay.js):
//   0  PASS — all 16 cells captured successfully
//   1  FAIL — at least one cell failed (manifest still written so
//             the operator can inspect which cells broke)
//   2  CONFIG — browsers not installed, server boot failed,
//             invalid CLI args, etc.
//
// Operator runbook lives at
// `docs/runbooks/visual-capture-live.md` — first-time setup +
// troubleshooting.

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { boot } = require("./visual-live/server-boot");
const capture = require("./visual-live/capture");

// ── CLI parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a === "--port") { out.port = Number(argv[++i]); continue; }
    if (a === "--out-dir") { out.outDir = argv[++i]; continue; }
    if (a === "--label") { out.label = argv[++i]; continue; }
    if (a === "--quiet") { out.quiet = true; continue; }
    if (a === "--json") { out.json = true; continue; }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/visual-capture-live.js [options]

Options:
  --port <n>           Server port (default 4799 or ORCHESTRATOR_VISUAL_LIVE_PORT)
  --out-dir <path>     Output directory for PNGs + manifest.json
                       (default docs/reports/<YYYY-MM-DD>-ui-p10-live/)
  --label <text>       Optional label echoed into manifest filename
  --quiet              Suppress per-cell progress output
  --json               Emit final manifest as JSON to stdout
  --help, -h           Show this help

Exit codes:
  0  All 16 cells captured successfully
  1  At least one cell failed (manifest still written)
  2  Configuration error (browsers missing, server boot failed, etc.)

First-time setup:
  npm run visual:install-browsers   # one-time chromium download

Then:
  npm run visual:capture-live

See docs/runbooks/visual-capture-live.md for full operator guide.
`);
}

// ── Default output dir ───────────────────────────────────────────

function defaultOutDir(label) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const base = `${today}-ui-p10-live`;
  const suffix = label ? `-${String(label).replace(/[^a-zA-Z0-9._-]/g, "-")}` : "";
  return path.join("docs", "reports", `${base}${suffix}`);
}

// ── Console helpers ──────────────────────────────────────────────

function _log(quiet, ...args) {
  if (quiet) return;
  process.stdout.write(args.join(" ") + "\n");
}

function _err(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

// ── Main ─────────────────────────────────────────────────────────

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }

  const outDir = path.resolve(args.outDir || defaultOutDir(args.label));
  let serverHandle = null;

  // 1. Server boot
  _log(args.quiet, `[visual-capture-live] booting server on port ${args.port || "default"}…`);
  try {
    serverHandle = await boot({ port: args.port });
    _log(args.quiet, `[visual-capture-live]   ready: ${serverHandle.base} (${serverHandle.elapsedMs}ms)`);
  } catch (err) {
    _err(`[visual-capture-live] CONFIG ERROR: ${err.message}`);
    _err(`[visual-capture-live]   Hint: check that port ${args.port || "4799"} is free, or pass --port <other>.`);
    return 2;
  }

  // 2. Capture
  _log(args.quiet, `[visual-capture-live] capturing 16 cells (4 routes × 4 viewports)…`);
  let result;
  try {
    result = await capture.runCapture({
      base: serverHandle.base,
      outDir,
    });
  } catch (err) {
    if (err && err.code === "BROWSER_NOT_INSTALLED") {
      _err(`[visual-capture-live] CONFIG ERROR: chromium binary not found.`);
      _err(`[visual-capture-live]   Run: npm run visual:install-browsers`);
      _err(`[visual-capture-live]   This downloads chromium one time (~150MB).`);
    } else {
      _err(`[visual-capture-live] CONFIG ERROR: capture failed`);
      _err(`[visual-capture-live]   ${err && err.stack || err}`);
    }
    try { await serverHandle.close(); } catch (_) {}
    return 2;
  } finally {
    // serverHandle.close() runs in the success path below; the
    // catch above already closes on the error path.
  }

  // 3. Write manifest + close server
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  _log(args.quiet, `[visual-capture-live] manifest written: ${manifestPath}`);

  // Per-cell summary
  if (!args.quiet) {
    for (const cell of result.manifest.cells) {
      const mark = cell.ok ? "✓" : "✗";
      const ms = String(cell.totalMs).padStart(5);
      const fname = cell.filename.padEnd(38);
      const reason = cell.failed ? `  ← ${cell.failureReason}` : "";
      _log(args.quiet, `[visual-capture-live]   ${mark} ${fname} ${ms}ms${reason}`);
    }
    const s = result.manifest.summary;
    _log(args.quiet, `[visual-capture-live] summary: ${s.ok}/${s.total} ok` +
      (s.failed > 0 ? ` (${s.failed} FAILED)` : ""));
  }

  try { await serverHandle.close(); } catch (_) {}

  // 4. Optional JSON dump
  if (args.json) {
    process.stdout.write(JSON.stringify(result.manifest, null, 2) + "\n");
  }

  return result.exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      _err(`[visual-capture-live] FATAL: ${err && err.stack || err}`);
      process.exit(2);
    },
  );
}

module.exports = {
  parseArgs,
  defaultOutDir,
  main,
};
