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
//   node scripts/sync-scorecard.js              # update files in place (live readiness)
//   node scripts/sync-scorecard.js --check      # exit 1 if files would change
//   node scripts/sync-scorecard.js --quiet      # suppress per-doc info logs
//   node scripts/sync-scorecard.js --no-spawn   # static mode (skip server boot)
//
// CI usage:
//   - Local dev: run after every meaningful slice to refresh docs.
//   - PR gate: `npm run scorecard:check` exits 1 when docs are stale.
//
// Slice MD1 (Phase D Round MD, 2026-04-27) — readiness defaults to live
// mode so the auto-derived markers reflect a single canonical signal.
// Use `--no-spawn` only when the runner can't bind a port (sandboxed
// environments). The static score is honest but lower (currently 6/15
// vs. 15/15 live) because http checks fail without a server.

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
const isNoSpawn = flag("--no-spawn");   // MD1: pass-through to readiness-report.

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

// R2-0b stability: a flaky test (the original `evidenceLedger` TTL test —
// fixed in R2-0a) used to occasionally drop the unit count by one,
// which sync-scorecard then wrote into the doc markers, tripping the
// freshness gate on the next CI run. The pattern recurred 4× through
// the R1 round (deb417c, b8e3434, c97fb5b, R1-k3 sync). Defense in
// depth: re-run the suite up to `maxAttempts` times until two
// consecutive readings agree. If no two consecutive reads agree within
// the budget, fall back to the mode of all readings + warn loudly.
//
// Cost: each run is ~1.5s for unit, ~3s for integration. Happy path
// is two reads (3s + 6s = 9s overhead per sync) when readings agree on
// first repeat. Worst case 5 reads (~7s + 15s = 22s).
function runTestSuiteStable(suiteName, maxAttempts = 5) {
  const readings = [];
  for (let i = 0; i < maxAttempts; i++) {
    const r = runTestSuite(suiteName);
    readings.push(r);
    if (i >= 1 && readings[i].pass === readings[i - 1].pass) {
      const counts = readings.map((x) => x.pass);
      const drifted = counts.some((c) => c !== counts[i]);
      if (drifted) {
        warn(suiteName + " drift recovered: readings=" + JSON.stringify(counts)
          + " stabilized at " + readings[i].pass);
      }
      return readings[i];
    }
  }
  // No consecutive agreement — use the mode (most-common reading) and
  // surface the instability. This is the "we tried, we couldn't stabilise,
  // pick the best guess" path.
  const counts = readings.map((r) => r.pass);
  const countMap = new Map();
  for (const c of counts) countMap.set(c, (countMap.get(c) || 0) + 1);
  const sorted = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1]);
  const winner = sorted[0][0];
  warn(suiteName + " UNSTABLE across " + maxAttempts + " reads: "
    + JSON.stringify(counts) + " — using mode " + winner
    + ". A flaky test is leaking; investigate before next sync.");
  return readings.find((r) => r.pass === winner);
}

// ── 2. Collect readiness score via JSON output. ─────────────────────
//
// Slice MD1 (Phase D Round MD, 2026-04-27) — switched the default to
// LIVE mode so the auto-derived doc numbers reflect the canonical signal
// (server-spawned, all category checks executable). Previously the call
// hard-coded `--no-spawn`, which only scored 6/15 because the http GET
// checks (run-visibility / child-visibility / contract-stability stars
// 1-2) silently failed without a server. The 6/15 value then ended up
// in scorecard.md auto-markers next to a hand-written snapshot showing
// 13/15 next to an example block showing 15/15 — three different signals
// in one doc.
//
// Live mode is now the only signal that drives the markers. The
// `--no-spawn` flag is preserved as a pass-through escape hatch for
// environments where spawning the server isn't possible (sandboxed CI,
// firewalled hosts), but the resulting low score is honest about what
// was actually verified.

function runReadiness() {
  const readinessArgs = ["scripts/readiness-report.js", "--json"];
  if (isNoSpawn) readinessArgs.push("--no-spawn");
  const out = spawnSync("node", readinessArgs, {
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
  const readinessMode = isNoSpawn ? "static (--no-spawn)" : "live (server-spawned)";
  log("[sync-scorecard] running test:unit + test:integration + readiness [" + readinessMode + "]…");
  // R2-0b: stabilised reads. Each suite runs at least twice; if those
  // two readings agree we use them, otherwise we keep going until a
  // pair agrees or the budget is exhausted. The flaky-test signal stays
  // visible in the warn log without polluting the marker output.
  const unit = runTestSuiteStable("unit");
  const integ = runTestSuiteStable("integration");
  const readiness = runReadiness();

  if (unit.tests == null || integ.tests == null) {
    warn("Could not extract test counts. Aborting.");
    process.exit(2);
  }
  if (!readiness) {
    warn("Could not parse readiness JSON. Aborting.");
    process.exit(2);
  }

  // Slice READINESS-BOOT-FAILURE-CONFIG (Phase 2 v2 follow-up,
  // 2026-05-05): when readiness-report exits CONFIG (exit 4), refuse
  // to update the markers — otherwise the scorecard silently records
  // an environment-restricted score (e.g. 9/18) as if it were the real
  // signal. Exit 4 propagates so `npm run scorecard:sync` and
  // `npm run scorecard:check` both fail clearly.
  if (readiness.configError === true || readiness.exit === 4) {
    warn("CONFIG: readiness-report could not boot the harness server.");
    warn("  cause:      " + (readiness.boot && readiness.boot.cause));
    warn("  error code: " + (readiness.boot && readiness.boot.code));
    warn("  kind:       " + (readiness.boot && readiness.boot.kind));
    warn("");
    warn("Refusing to update scorecard markers from a half-signal.");
    warn("Run from a normal terminal (PowerShell, bash, CI runner), or use");
    warn("  --no-spawn (intentional static-only) /");
    warn("  --allow-static-fallback (silent legacy fallback)");
    warn("if you accept the static score.");
    process.exit(4);
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
