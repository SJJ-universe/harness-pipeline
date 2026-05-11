#!/usr/bin/env node
// Slice UI-P12-c (Phase D Round UI-P, 2026-05-04) — CLI entry that
// orchestrates the accessibility verification run:
//
//   1. Boots dashboard server (UI-P10 server-boot helper).
//   2. Runs axe-core (WCAG 2.0/2.1 A+AA tags) + 2 custom rules at
//      every cell of the 4×4 = 16 (route × viewport) matrix via
//      a11y-runner.
//   3. Writes manifest.json.
//   4. Closes the server.
//   5. Prints per-cell + per-violation summary + exit code.
//
// Exit codes (matches capture-live + assert-live):
//   0  every cell ok (no critical/serious axe violations + 0 custom
//      failures)
//   1  at least one cell has failures or errors
//   2  CONFIG (chromium missing, server boot failed, args invalid)
//
// Operator runbook: docs/runbooks/visual-a11y-live.md

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { boot } = require("./visual-live/server-boot");
const runner = require("./visual-live/a11y-runner");

// ── CLI parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { help: false, extraDisabledRules: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a === "--port") { out.port = Number(argv[++i]); continue; }
    if (a === "--out-dir") { out.outDir = argv[++i]; continue; }
    if (a === "--label") { out.label = argv[++i]; continue; }
    if (a === "--quiet") { out.quiet = true; continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--disable-rule") {
      // Repeatable: --disable-rule color-contrast --disable-rule region
      out.extraDisabledRules.push(argv[++i]);
      continue;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/visual-a11y-live.js [options]

Runs axe-core (WCAG 2.0/2.1 A+AA) + 2 custom orchestrator rules against
the live product shell at every cell of the 4×4 (route × viewport)
matrix. Reports pass/fail manifest + exit code 0/1/2.

Options:
  --port <n>                Server port (default 4799 or ORCHESTRATOR_VISUAL_LIVE_PORT)
  --out-dir <path>          Output directory for manifest.json
                            (default docs/reports/<YYYY-MM-DD>-ui-p12-a11y/)
  --label <text>            Optional label suffix for the directory name
  --disable-rule <id>       Disable an additional axe rule (repeatable)
  --quiet                   Suppress per-cell progress output
  --json                    Emit final manifest as JSON to stdout
  --help, -h                Show this help

Exit codes:
  0  Every cell ok (no critical/serious axe violations + 0 custom failures)
  1  At least one cell has failures or errors (manifest still written)
  2  Configuration error (chromium missing, server boot failed, etc.)

First-time setup (shared with visual:capture-live + visual:assert-live):
  npm run visual:install-browsers

Then:
  npm run visual:a11y-live

See docs/runbooks/visual-a11y-live.md for full operator guide.
`);
}

// ── Default output dir ───────────────────────────────────────────

function defaultOutDir(label) {
  const today = new Date().toISOString().slice(0, 10);
  const base = `${today}-ui-p12-a11y`;
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
  _log(args.quiet, `[visual-a11y-live] booting server on port ${args.port || "default"}…`);
  let serverHandle = null;
  try {
    serverHandle = await boot({ port: args.port });
    _log(args.quiet, `[visual-a11y-live]   ready: ${serverHandle.base} (${serverHandle.elapsedMs}ms)`);
  } catch (err) {
    _err(`[visual-a11y-live] CONFIG ERROR: ${err.message}`);
    _err(`[visual-a11y-live]   Hint: check port availability or pass --port <other>.`);
    return 2;
  }

  // 2. Run a11y matrix
  _log(args.quiet, `[visual-a11y-live] evaluating axe + custom rules × 16 cells…`);
  let result;
  try {
    result = await runner.runA11yMatrix({
      base: serverHandle.base,
      extraDisabledRules: args.extraDisabledRules,
    });
  } catch (err) {
    if (err && err.code === "BROWSER_NOT_INSTALLED") {
      _err(`[visual-a11y-live] CONFIG ERROR: chromium binary not found.`);
      _err(`[visual-a11y-live]   Run: npm run visual:install-browsers`);
    } else {
      _err(`[visual-a11y-live] CONFIG ERROR: a11y-runner failed`);
      _err(`[visual-a11y-live]   ${err && err.stack || err}`);
    }
    try { await serverHandle.close(); } catch (_) {}
    return 2;
  }

  // 3. Write manifest
  fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  _log(args.quiet, `[visual-a11y-live] manifest written: ${manifestPath}`);

  // 4. Per-cell + per-violation summary
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
        const axeBucket = s.axe.bucket;
        const tally = `axe: ${s.axe.failingImpactsHit} failing (` +
          `${axeBucket.critical}c/${axeBucket.serious}s/` +
          `${axeBucket.moderate}m/${axeBucket.minor}n)` +
          ` | custom: ${s.custom.passed}/${s.custom.total} ok`;
        detail = `  ${tally}`;
      }
      _log(args.quiet, `[visual-a11y-live]   [${tag.padEnd(4)}] ${id} ${ms}ms${detail}`);
    }
    const s = result.manifest.summary;
    _log(args.quiet,
      `[visual-a11y-live] cells: ${s.cellsAllPassed}/${s.totalCells} passed, ` +
      `${s.cellsWithFailures} with failures, ${s.cellsWithErrors} with errors`,
    );
    _log(args.quiet,
      `[visual-a11y-live] violations: ${s.totalAxeViolations} axe ` +
      `(${s.totalAxeFailingImpacts} critical/serious), ` +
      `${s.totalCustomFailed} custom failed`,
    );

    // Surface failed-rule details inline so the operator doesn't need
    // to open manifest.json for first-pass triage.
    let printedHeader = false;
    for (const cell of result.manifest.cells) {
      if (!cell.summary || cell.failed) continue;
      const failingAxe = (cell.axeViolations || [])
        .filter((v) => ["critical", "serious"].includes(v.impact));
      const failingCustom = (cell.customResults || [])
        .filter((r) => r.ok === false && !r.skipped);
      if (failingAxe.length === 0 && failingCustom.length === 0) continue;
      if (!printedHeader) {
        _log(args.quiet, `[visual-a11y-live] --- failures (critical/serious axe + custom) ---`);
        printedHeader = true;
      }
      _log(args.quiet, `[visual-a11y-live]   ${cell.routeId}__${cell.viewportId}:`);
      for (const v of failingAxe.slice(0, 3)) {
        _log(args.quiet, `[visual-a11y-live]     · axe :: ${v.id} [${v.impact}]`);
        if (v.help) _log(args.quiet, `[visual-a11y-live]         ${v.help}`);
      }
      if (failingAxe.length > 3) {
        _log(args.quiet, `[visual-a11y-live]     · ... and ${failingAxe.length - 3} more axe (see manifest.json)`);
      }
      for (const r of failingCustom) {
        _log(args.quiet, `[visual-a11y-live]     · custom :: ${r.id}`);
        const top = (r.failures || [])[0];
        if (top && top.reason) {
          _log(args.quiet, `[visual-a11y-live]         ${top.reason}`);
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
      _err(`[visual-a11y-live] FATAL: ${err && err.stack || err}`);
      process.exit(2);
    },
  );
}

module.exports = {
  parseArgs,
  defaultOutDir,
  main,
};
