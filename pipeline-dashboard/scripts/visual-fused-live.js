#!/usr/bin/env node
// Slice UI-Fuse-b (Phase D Round UI-P, 2026-05-04) — local CLI that
// runs ALL FOUR live visual contracts (capture / assert / a11y /
// button) sequentially against ONE server boot + ONE chromium
// browser session, writing a single combined `docs/reports/<date>-
// ui-fuse[-<label>]/` directory.
//
// Why a separate script vs running the 4 tools in sequence by hand:
//   1. ONE server boot — each tool's CLI boots its own server.
//      Reusing the boot saves ~3 seconds per tool × 4 tools.
//   2. ONE artifact directory — operator gets a coherent output with
//      4 subdirs + summary.json at the root.
//   3. Subset selection via --tools — same UX as the CI fused
//      workflow (capture,assert,a11y,button or any subset).
//   4. Failures don't abort — operator sees which tool(s) broke,
//      not just the first one.
//
// Internally invokes each tool's main() via require + handles the
// shared server boot. CLI exit code = max of per-tool exit codes.
//
// Operator runbook: docs/runbooks/visual-fused-live.md

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { boot } = require("./visual-live/server-boot");
const captureRunner = require("./visual-live/capture");
const assertRunner = require("./visual-live/assert-runner");
const a11yRunner = require("./visual-live/a11y-runner");
const buttonRunner = require("./visual-live/button-runner");

// ── Frozen tool registry ────────────────────────────────────────

const TOOLS = Object.freeze([
  Object.freeze({
    id: "capture",
    label: "Live capture (PNG evidence)",
    runFn: function ({ base, outDir }) {
      return captureRunner.runCapture({ base, outDir });
    },
    writeManifest: true,  // capture.runCapture returns manifest, we write
  }),
  Object.freeze({
    id: "assert",
    label: "Responsive + text-fit assertions",
    runFn: function ({ base, outDir }) {
      // assert-runner takes screenshotFailedCells + outDir for debug PNGs
      return assertRunner.runAssertMatrix({
        base, screenshotFailedCells: true, outDir,
      });
    },
    writeManifest: true,
  }),
  Object.freeze({
    id: "a11y",
    label: "Accessibility (axe + custom)",
    runFn: function ({ base }) {
      // a11y-runner doesn't write screenshots; manifest only
      return a11yRunner.runA11yMatrix({ base });
    },
    writeManifest: true,
  }),
  Object.freeze({
    id: "button",
    label: "Button integrity",
    runFn: function ({ base }) {
      return buttonRunner.runButtonMatrix({ base });
    },
    writeManifest: true,
  }),
]);

const KNOWN_TOOL_IDS = TOOLS.map(function (t) { return t.id; });

// ── CLI parsing ──────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { help: false, tools: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    if (a === "--port") { out.port = Number(argv[++i]); continue; }
    if (a === "--out-dir") { out.outDir = argv[++i]; continue; }
    if (a === "--label") { out.label = argv[++i]; continue; }
    if (a === "--tools") {
      out.tools = String(argv[++i] || "")
        .split(",")
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      continue;
    }
    if (a === "--quiet") { out.quiet = true; continue; }
    if (a === "--json") { out.json = true; continue; }
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/visual-fused-live.js [options]

Runs ALL 4 visual contracts (capture / assert / a11y / button) against
the live product shell under ONE server boot + ONE chromium install.
Writes a single combined output directory with 4 subdirs + summary.json.

Options:
  --port <n>            Server port (default 4799 or ORCHESTRATOR_VISUAL_LIVE_PORT)
  --out-dir <path>      Output directory (default docs/reports/<YYYY-MM-DD>-ui-fuse[-<label>]/)
  --label <text>        Optional label suffix for the directory name
  --tools <list>        Comma-separated subset (default: all 4)
                        Valid IDs: ${KNOWN_TOOL_IDS.join(", ")}
  --quiet               Suppress per-tool progress output
  --json                Emit final summary as JSON to stdout
  --help, -h            Show this help

Exit codes:
  0  Every selected tool returned exit 0
  1  At least one tool returned non-zero (per-tool failures captured;
     loop never aborts on a single-tool failure)
  2  Configuration error (chromium missing, server boot failed,
     unknown tool ID, etc.)

First-time setup (shared with all per-tool CLIs):
  npm run visual:install-browsers

Then:
  npm run visual:fused-live

Or a subset:
  node scripts/visual-fused-live.js --tools capture,a11y

See docs/runbooks/visual-fused-live.md for the full operator guide.
`);
}

function defaultOutDir(label) {
  const today = new Date().toISOString().slice(0, 10);
  const base = `${today}-ui-fuse`;
  const suffix = label
    ? `-${String(label).replace(/[^a-zA-Z0-9._-]/g, "-")}`
    : "";
  return path.join("docs", "reports", `${base}${suffix}`);
}

function _log(quiet) {
  return function () {
    if (quiet) return;
    process.stdout.write(Array.prototype.join.call(arguments, " ") + "\n");
  };
}

function _err() {
  process.stderr.write(Array.prototype.join.call(arguments, " ") + "\n");
}

// ── Tool selection ──────────────────────────────────────────────

function selectTools(toolIds) {
  if (!toolIds || toolIds.length === 0) {
    return { selected: TOOLS.slice(), unknown: [] };
  }
  const selected = [];
  const unknown = [];
  for (const id of toolIds) {
    const t = TOOLS.find(function (x) { return x.id === id; });
    if (t) selected.push(t);
    else unknown.push(id);
  }
  return { selected, unknown };
}

// ── Summary builder ─────────────────────────────────────────────

function buildFusedSummary({ outDir, results, fusedAt }) {
  const tools = {};
  const perTool = {};
  for (const r of results) {
    tools[r.toolId] = r.skipped
      ? "skipped"
      : (r.failed ? "errored" : "ran");
    if (r.manifest) {
      perTool[r.toolId] = {
        schema: r.manifest.schema,
        capturedAt: r.manifest.capturedAt,
        totalElapsedMs: r.manifest.totalElapsedMs,
        summary: r.manifest.summary,
      };
    } else if (r.errorMessage) {
      perTool[r.toolId] = { error: r.errorMessage };
    }
  }
  return {
    schema: "orchestrator-visual-fused/v1",
    fusedAt,
    outDir,
    tools,
    perTool,
  };
}

// ── Main ─────────────────────────────────────────────────────────

async function _runOneTool({ tool, base, outBaseDir, quiet }) {
  const toolOutDir = path.join(outBaseDir, tool.id);
  fs.mkdirSync(toolOutDir, { recursive: true });
  const log = _log(quiet);
  log(`[visual-fused-live] === running visual:${tool.id}-live ===`);
  try {
    const result = await tool.runFn({ base, outDir: toolOutDir });
    if (tool.writeManifest && result && result.manifest) {
      const manifestPath = path.join(toolOutDir, "manifest.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(result.manifest, null, 2) + "\n",
      );
      log(`[visual-fused-live]   manifest: ${manifestPath}`);
    }
    log(`[visual-fused-live]   exit: ${result.exitCode}`);
    return {
      toolId: tool.id,
      manifest: result.manifest || null,
      exitCode: result.exitCode,
      failed: result.exitCode !== 0,
      skipped: false,
    };
  } catch (err) {
    if (err && err.code === "BROWSER_NOT_INSTALLED") {
      // This is fatal for the whole fused run — every tool will
      // hit it. Re-throw so main() can return exit 2.
      throw err;
    }
    log(`[visual-fused-live]   ERROR: ${err && err.message || err}`);
    return {
      toolId: tool.id,
      manifest: null,
      exitCode: 1,
      failed: true,
      skipped: false,
      errorMessage: String(err && err.message || err),
    };
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  const log = _log(args.quiet);

  // Resolve tool selection
  const { selected, unknown } = selectTools(args.tools);
  if (unknown.length > 0) {
    _err(`[visual-fused-live] CONFIG ERROR: unknown tool ID(s): ${unknown.join(", ")}`);
    _err(`[visual-fused-live]   Valid IDs: ${KNOWN_TOOL_IDS.join(", ")}`);
    return 2;
  }
  if (selected.length === 0) {
    _err(`[visual-fused-live] CONFIG ERROR: no tools selected`);
    return 2;
  }

  const outBaseDir = path.resolve(args.outDir || defaultOutDir(args.label));
  fs.mkdirSync(outBaseDir, { recursive: true });
  log(`[visual-fused-live] output: ${outBaseDir}`);

  // 1. Boot server (shared across all tools)
  log(`[visual-fused-live] booting server on port ${args.port || "default"}…`);
  let serverHandle = null;
  try {
    serverHandle = await boot({ port: args.port });
    log(`[visual-fused-live]   ready: ${serverHandle.base} (${serverHandle.elapsedMs}ms)`);
  } catch (err) {
    _err(`[visual-fused-live] CONFIG ERROR: ${err.message}`);
    _err(`[visual-fused-live]   Hint: pass --port <other> if 4799 is occupied.`);
    return 2;
  }

  // 2. Run each selected tool sequentially
  const results = [];
  let overallExit = 0;
  try {
    for (const tool of selected) {
      try {
        const r = await _runOneTool({
          tool, base: serverHandle.base, outBaseDir, quiet: args.quiet,
        });
        results.push(r);
        if (r.exitCode !== 0) overallExit = Math.max(overallExit, r.exitCode);
      } catch (err) {
        if (err && err.code === "BROWSER_NOT_INSTALLED") {
          _err(`[visual-fused-live] CONFIG ERROR: chromium binary not found.`);
          _err(`[visual-fused-live]   Run: npm run visual:install-browsers`);
          try { await serverHandle.close(); } catch (_) {}
          return 2;
        }
        // Should not happen — _runOneTool wraps non-BROWSER_NOT_INSTALLED
        // errors as a result row.
        _err(`[visual-fused-live] FATAL inside ${tool.id}: ${err && err.stack || err}`);
        results.push({
          toolId: tool.id,
          manifest: null,
          exitCode: 1,
          failed: true,
          skipped: false,
          errorMessage: String(err && err.message || err),
        });
        overallExit = Math.max(overallExit, 1);
      }
    }
  } finally {
    try { await serverHandle.close(); } catch (_) {}
  }

  // 3. Write top-level summary.json
  const summary = buildFusedSummary({
    outDir: outBaseDir,
    results,
    fusedAt: new Date().toISOString(),
  });
  const summaryPath = path.join(outBaseDir, "summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");
  log(`[visual-fused-live] summary: ${summaryPath}`);

  // 4. Per-tool console summary
  if (!args.quiet) {
    log(`[visual-fused-live] === fused summary ===`);
    for (const r of results) {
      const tag = r.failed ? "FAIL" : "PASS";
      log(`[visual-fused-live]   [${tag}] ${r.toolId.padEnd(8)} exit=${r.exitCode}`);
    }
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  }
  return overallExit;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    function (code) { process.exit(code); },
    function (err) {
      _err(`[visual-fused-live] FATAL: ${err && err.stack || err}`);
      process.exit(2);
    },
  );
}

module.exports = {
  parseArgs,
  defaultOutDir,
  selectTools,
  buildFusedSummary,
  main,
  TOOLS,
  KNOWN_TOOL_IDS,
};
