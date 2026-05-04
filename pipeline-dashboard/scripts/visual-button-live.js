#!/usr/bin/env node
// Slice UI-P13-c (Phase D Round UI-P, 2026-05-04) — CLI entry that
// orchestrates the button integrity verification:
//
//   1. Boots dashboard server (UI-P10 server-boot helper).
//   2. Runs the UI-P13-a button catalog at every route × 1
//      desktop viewport via button-runner.
//   3. Writes manifest.json.
//   4. Closes server.
//   5. Prints per-cell + per-button summary + exit code.
//
// Exit codes (matches capture/assert/a11y entries):
//   0  every applicable button passed (static + click-activity)
//   1  at least one cell has button failures or per-cell errors
//   2  CONFIG (chromium missing, server boot failed, etc.)
//
// Operator runbook: docs/runbooks/visual-button-live.md

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { boot } = require("./visual-live/server-boot");
const runner = require("./visual-live/button-runner");

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
  process.stdout.write(`Usage: node scripts/visual-button-live.js [options]

Verifies the 13 documented product-shell buttons across the 4 routes
on a desktop viewport (1366×768). For each visible+enabled button:
  - STATIC: has accessible name; if disabled, has explanatory text
  - CLICK + ACTIVITY (clickSafe only): triggers DOM mutation OR
    network request; no console.error during click

Catches "looks clickable but does nothing" UX failures.

Options:
  --port <n>                Server port (default 4799 or HARNESS_VISUAL_LIVE_PORT)
  --out-dir <path>          Output directory for manifest.json
                            (default docs/reports/<YYYY-MM-DD>-ui-p13-buttons/)
  --label <text>            Optional label suffix for the directory name
  --quiet                   Suppress per-button progress output
  --json                    Emit final manifest as JSON to stdout
  --help, -h                Show this help

Exit codes:
  0  Every applicable button passed (static + click-activity checks)
  1  At least one button failed (manifest still written)
  2  Configuration error (chromium missing, server boot failed, etc.)

First-time setup (shared with visual:capture-live + visual:assert-live):
  npm run visual:install-browsers

Then:
  npm run visual:button-live

See docs/runbooks/visual-button-live.md for full operator guide.
`);
}

function defaultOutDir(label) {
  const today = new Date().toISOString().slice(0, 10);
  const base = `${today}-ui-p13-buttons`;
  const suffix = label ? `-${String(label).replace(/[^a-zA-Z0-9._-]/g, "-")}` : "";
  return path.join("docs", "reports", `${base}${suffix}`);
}

function _log(quiet, ...args) {
  if (quiet) return;
  process.stdout.write(args.join(" ") + "\n");
}

function _err(...args) {
  process.stderr.write(args.join(" ") + "\n");
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }

  const outDir = path.resolve(args.outDir || defaultOutDir(args.label));

  _log(args.quiet, `[visual-button-live] booting server on port ${args.port || "default"}…`);
  let serverHandle = null;
  try {
    serverHandle = await boot({ port: args.port });
    _log(args.quiet, `[visual-button-live]   ready: ${serverHandle.base} (${serverHandle.elapsedMs}ms)`);
  } catch (err) {
    _err(`[visual-button-live] CONFIG ERROR: ${err.message}`);
    _err(`[visual-button-live]   Hint: check port availability or pass --port <other>.`);
    return 2;
  }

  _log(args.quiet, `[visual-button-live] evaluating 13 buttons × 4 routes…`);
  let result;
  try {
    result = await runner.runButtonMatrix({ base: serverHandle.base });
  } catch (err) {
    if (err && err.code === "BROWSER_NOT_INSTALLED") {
      _err(`[visual-button-live] CONFIG ERROR: chromium binary not found.`);
      _err(`[visual-button-live]   Run: npm run visual:install-browsers`);
    } else {
      _err(`[visual-button-live] CONFIG ERROR: button-runner failed`);
      _err(`[visual-button-live]   ${err && err.stack || err}`);
    }
    try { await serverHandle.close(); } catch (_) {}
    return 2;
  }

  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  _log(args.quiet, `[visual-button-live] manifest written: ${manifestPath}`);

  if (!args.quiet) {
    for (const cell of result.manifest.cells) {
      const tag = cell.failed ? "ERR" : (cell.ok ? "PASS" : "FAIL");
      const ms = String(cell.totalMs).padStart(5);
      const id = `${cell.routeId}__${cell.viewportId}`.padEnd(38);
      let detail = "";
      if (cell.failed) {
        detail = `  ← ${cell.failureReason}`;
      } else if (cell.summary) {
        const s = cell.summary;
        detail = `  (${s.passed}/${s.applicable} passed, ${s.skipped} skipped)`;
      }
      _log(args.quiet, `[visual-button-live]   [${tag.padEnd(4)}] ${id} ${ms}ms${detail}`);
    }
    const s = result.manifest.summary;
    _log(args.quiet,
      `[visual-button-live] cells: ${s.cellsAllPassed}/${s.totalCells} passed, ` +
      `${s.cellsWithFailures} with failures, ${s.cellsWithErrors} with errors`,
    );
    _log(args.quiet,
      `[visual-button-live] buttons: ${s.totalButtonsPassed}/${s.totalButtonsApplicable} passed, ` +
      `${s.totalButtonsFailed} failed, ${s.totalButtonsSkipped} skipped`,
    );

    // Per-button failure detail inline (operator triages without
    // opening manifest.json)
    let printedHeader = false;
    for (const cell of result.manifest.cells) {
      if (!cell.buttons || cell.failed) continue;
      const failingButtons = cell.buttons.filter((b) => !b.ok && !b.skipped);
      if (failingButtons.length === 0) continue;
      if (!printedHeader) {
        _log(args.quiet, `[visual-button-live] --- failed buttons ---`);
        printedHeader = true;
      }
      _log(args.quiet, `[visual-button-live]   ${cell.routeId}__${cell.viewportId}:`);
      for (const b of failingButtons) {
        _log(args.quiet, `[visual-button-live]     · ${b.id} :: ${b.status}`);
        if (b.reason) _log(args.quiet, `[visual-button-live]         ${b.reason}`);
        if (b.errors && b.errors.length > 0) {
          for (const e of b.errors.slice(0, 2)) {
            _log(args.quiet, `[visual-button-live]         err: ${e}`);
          }
        }
      }
    }
  }

  try { await serverHandle.close(); } catch (_) {}

  if (args.json) {
    process.stdout.write(JSON.stringify(result.manifest, null, 2) + "\n");
  }

  return result.exitCode;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      _err(`[visual-button-live] FATAL: ${err && err.stack || err}`);
      process.exit(2);
    },
  );
}

module.exports = {
  parseArgs,
  defaultOutDir,
  main,
};
