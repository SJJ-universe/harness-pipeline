#!/usr/bin/env node
// Slice UI-P11-c (Phase D Round UI-P, 2026-05-04) — CLI entry that
// orchestrates the responsive / text-fit assertion run:
//
//   1. Boots the dashboard server (UI-P10 server-boot helper).
//   2. Runs the 6-rule assertion catalog at every cell of the
//      4×4 = 16 (route × viewport) matrix via assert-runner.
//   3. Writes manifest.json (+ per-failed-cell debug PNGs when
//      --screenshot-failures is passed).
//   4. Closes the server.
//   5. Prints per-cell summary + exit code.
//
// Exit codes (matches scripts/visual-capture-live.js + live-verify):
//   0  every applicable assertion passed across every cell
//   1  at least one assertion failed (manifest still written)
//   2  CONFIG (browsers missing, server boot failed, args invalid)
//
// Operator runbook: docs/runbooks/visual-assert-live.md

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { boot } = require("./visual-live/server-boot");
const runner = require("./visual-live/assert-runner");

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
    if (a === "--screenshot-failures") { out.screenshotFailures = true; continue; }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/visual-assert-live.js [options]

Runs the responsive / text-fit assertion catalog (6 rules) against
the live product shell at every cell of the 4×4 (route × viewport)
matrix. Reports pass/fail manifest + exit code 0/1/2.

Options:
  --port <n>                Server port (default 4799 or HARNESS_VISUAL_LIVE_PORT)
  --out-dir <path>          Output directory for manifest.json
                            (default docs/reports/<YYYY-MM-DD>-ui-p11-assert/)
  --label <text>            Optional label suffix for the directory name
  --screenshot-failures     Save full-page PNG of each cell with assertion
                            failures (filename: <route>__<viewport>__failed.png)
  --quiet                   Suppress per-cell progress output
  --json                    Emit final manifest as JSON to stdout
  --help, -h                Show this help

Exit codes:
  0  Every applicable assertion passed across every cell
  1  At least one assertion failed (manifest still written)
  2  Configuration error (chromium missing, server boot failed, etc.)

First-time setup (same one-time install as visual:capture-live):
  npm run visual:install-browsers

Then:
  npm run visual:assert-live

See docs/runbooks/visual-assert-live.md for full operator guide.
`);
}

// ── Default output dir ───────────────────────────────────────────

function defaultOutDir(label) {
  const today = new Date().toISOString().slice(0, 10);
  const base = `${today}-ui-p11-assert`;
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

  // 1. Server boot
  _log(args.quiet, `[visual-assert-live] booting server on port ${args.port || "default"}…`);
  let serverHandle = null;
  try {
    serverHandle = await boot({ port: args.port });
    _log(args.quiet, `[visual-assert-live]   ready: ${serverHandle.base} (${serverHandle.elapsedMs}ms)`);
  } catch (err) {
    _err(`[visual-assert-live] CONFIG ERROR: ${err.message}`);
    _err(`[visual-assert-live]   Hint: check port availability or pass --port <other>.`);
    return 2;
  }

  // 2. Run assertions
  _log(args.quiet, `[visual-assert-live] evaluating 6 rules × 16 cells…`);
  let result;
  try {
    result = await runner.runAssertMatrix({
      base: serverHandle.base,
      screenshotFailedCells: !!args.screenshotFailures,
      outDir: args.screenshotFailures ? outDir : undefined,
    });
  } catch (err) {
    if (err && err.code === "BROWSER_NOT_INSTALLED") {
      _err(`[visual-assert-live] CONFIG ERROR: chromium binary not found.`);
      _err(`[visual-assert-live]   Run: npm run visual:install-browsers`);
    } else {
      _err(`[visual-assert-live] CONFIG ERROR: assert-runner failed`);
      _err(`[visual-assert-live]   ${err && err.stack || err}`);
    }
    try { await serverHandle.close(); } catch (_) {}
    return 2;
  }

  // 3. Write manifest
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  _log(args.quiet, `[visual-assert-live] manifest written: ${manifestPath}`);

  // 4. Per-cell summary
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
      _log(args.quiet, `[visual-assert-live]   [${tag.padEnd(4)}] ${id} ${ms}ms${detail}`);
    }
    const s = result.manifest.summary;
    _log(args.quiet,
      `[visual-assert-live] cells: ${s.cellsAllPassed}/${s.totalCells} passed, ` +
      `${s.cellsWithFailures} with failures, ${s.cellsWithErrors} with errors`,
    );
    _log(args.quiet,
      `[visual-assert-live] assertions: ${s.totalAssertionsPassed}/${s.totalAssertionsApplicable} passed, ` +
      `${s.totalAssertionsFailed} failed, ${s.totalAssertionsSkipped} skipped`,
    );

    // Surface the actual failed-rule details so the operator doesn't
    // have to open manifest.json for the first triage pass.
    let printedFailHeader = false;
    for (const cell of result.manifest.cells) {
      if (!cell.results) continue;
      for (const r of cell.results) {
        if (r.skipped || r.ok) continue;
        if (!printedFailHeader) {
          _log(args.quiet, `[visual-assert-live] --- failed rules ---`);
          printedFailHeader = true;
        }
        _log(args.quiet,
          `[visual-assert-live]   ${cell.routeId}__${cell.viewportId} :: ${r.id}`,
        );
        if (r.failures && r.failures.length > 0) {
          for (const f of r.failures.slice(0, 3)) {
            _log(args.quiet, `[visual-assert-live]     · ${JSON.stringify(f)}`);
          }
          if (r.failures.length > 3) {
            _log(args.quiet, `[visual-assert-live]     · ...and ${r.failures.length - 3} more (see manifest.json)`);
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
      _err(`[visual-assert-live] FATAL: ${err && err.stack || err}`);
      process.exit(2);
    },
  );
}

module.exports = {
  parseArgs,
  defaultOutDir,
  main,
};
