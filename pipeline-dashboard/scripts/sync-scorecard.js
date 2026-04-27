#!/usr/bin/env node
//
// Slice MC5 (Phase D Round 2.5, 2026-04-27) — sync-scorecard.
//
// Auto-derives the test counts + readiness totals into the canonical
// docs (docs/scorecard.md + docs/readiness-rubric.md) so the numbers
// never drift from reality. Replaces the manually-edited "**878 unit /
// 189 integration**" lines with live values produced by the runners.
//
// Marker format:
//   <!-- AUTO:test-counts -->...<!-- /AUTO -->
//   <!-- AUTO:readiness-total -->...<!-- /AUTO -->
//   <!-- AUTO:readiness-stars -->...<!-- /AUTO -->
//
// Anything between matching marker pairs gets replaced. Anything else
// in the doc is preserved untouched. If a marker pair is missing the
// script logs a warning + skips that field.
//
// Usage:
//   node scripts/sync-scorecard.js              # update files in place
//   node scripts/sync-scorecard.js --check      # exit 1 if files would change
//   node scripts/sync-scorecard.js --quiet      # suppress per-doc info logs
//
// CI usage:
//   - Local dev: run after every meaningful slice to refresh docs.
//   - PR gate: `npm run scorecard:check` exits 1 when docs are stale.

const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SCORECARD = path.join(ROOT, "docs", "scorecard.md");
const RUBRIC    = path.join(ROOT, "docs", "readiness-rubric.md");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const isCheck = flag("--check");
const isQuiet = flag("--quiet");

function log(...args) { if (!isQuiet) process.stdout.write(args.join(" ") + "\n"); }
function warn(...args) { process.stderr.write("[sync-scorecard] " + args.join(" ") + "\n"); }

// ── 1. Collect test counts via the runners. ─────────────────────────

function runTestSuite(suiteName) {
  // suiteName ∈ {"unit","integration"}. Returns { tests, pass, fail }.
  const out = spawnSync("npm", ["run", "test:" + suiteName], {
    cwd: ROOT, encoding: "utf-8", shell: true, env: process.env,
  });
  const text = (out.stdout || "") + (out.stderr || "");
  // Node's test runner emits "ℹ tests N" / "ℹ pass N" / "ℹ fail N" lines.
  const pick = (label) => {
    const m = text.match(new RegExp("ℹ " + label + " (\\d+)"));
    return m ? Number(m[1]) : null;
  };
  return { tests: pick("tests"), pass: pick("pass"), fail: pick("fail") };
}

// ── 2. Collect readiness score via JSON output. ─────────────────────

function runReadiness() {
  const out = spawnSync("node", ["scripts/readiness-report.js", "--json", "--no-spawn"], {
    cwd: ROOT, encoding: "utf-8", env: process.env,
  });
  const text = (out.stdout || "").trim();
  try { return JSON.parse(text); }
  catch (e) {
    warn("readiness-report --json output not parseable:", text.slice(0, 200));
    return null;
  }
}

// ── 3. Marker rewrite helper. ───────────────────────────────────────

function rewriteMarkers(text, replacements) {
  let next = text;
  let touched = 0;
  const found = {};
  for (const [key, value] of Object.entries(replacements)) {
    const re = new RegExp(
      "(<!-- AUTO:" + key + " -->)([\\s\\S]*?)(<!-- /AUTO -->)",
      "g"
    );
    found[key] = false;
    next = next.replace(re, (_m, open, _inner, close) => {
      found[key] = true;
      touched++;
      return open + value + close;
    });
  }
  return { text: next, touched, found };
}

// ── 4. Main flow. ───────────────────────────────────────────────────

function main() {
  log("[sync-scorecard] running test:unit + test:integration + readiness…");
  const unit = runTestSuite("unit");
  const integ = runTestSuite("integration");
  const readiness = runReadiness();

  if (unit.tests == null || integ.tests == null) {
    warn("Could not extract test counts. Aborting.");
    process.exit(2);
  }
  if (!readiness) {
    warn("Could not parse readiness JSON. Aborting.");
    process.exit(2);
  }

  const replacements = {
    "test-counts": "**" + unit.pass + " unit / " + integ.pass + " integration**",
    "readiness-total": "**" + readiness.total + " / " + readiness.max + "**",
    "readiness-stars": readiness.categories
      .map((c) => "  - " + c.name + ": " + c.stars.length + "/3")
      .join("\n"),
  };
  log("[sync-scorecard] derived values:");
  for (const [k, v] of Object.entries(replacements)) {
    log("    " + k + " = " + v.replace(/\n/g, "\n              "));
  }

  let totalTouched = 0;
  let needsWrite = false;
  const seenInAnyDoc = {};
  for (const key of Object.keys(replacements)) seenInAnyDoc[key] = false;

  for (const file of [SCORECARD, RUBRIC]) {
    if (!fs.existsSync(file)) {
      warn("doc not found, skipping: " + file);
      continue;
    }
    const before = fs.readFileSync(file, "utf-8");
    const { text: after, touched, found } = rewriteMarkers(before, replacements);
    totalTouched += touched;
    for (const [key, hit] of Object.entries(found)) {
      if (hit) seenInAnyDoc[key] = true;
    }
    if (after !== before) {
      needsWrite = true;
      if (isCheck) {
        warn("STALE: " + path.relative(ROOT, file));
      } else {
        fs.writeFileSync(file, after, "utf-8");
        log("[sync-scorecard] updated " + path.relative(ROOT, file) + " (markers: " + touched + ")");
      }
    } else {
      log("[sync-scorecard] " + path.relative(ROOT, file) + " already in sync");
    }
  }

  // Only warn for markers that NO doc had — purposeful per-doc gaps
  // (e.g. readiness-* lives only in the rubric) shouldn't spam.
  for (const [key, seen] of Object.entries(seenInAnyDoc)) {
    if (!seen) warn("marker missing across all docs: AUTO:" + key);
  }

  if (isCheck && needsWrite) {
    warn("Run `node scripts/sync-scorecard.js` (without --check) to update.");
    process.exit(1);
  }

  log("[sync-scorecard] done — " + totalTouched + " marker(s) processed");
  process.exit(0);
}

main();
