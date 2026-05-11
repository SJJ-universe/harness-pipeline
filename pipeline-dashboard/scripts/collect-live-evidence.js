#!/usr/bin/env node
//
// Slice LIVE-EVIDENCE-COLLECTOR (Phase 2 v2 follow-up, 2026-05-05) —
// aggregator that reads the two committed probe-output files
// from docs/reports/ and emits a single sealed bundle with the
// schema orchestrator-live-evidence-bundle/v1 (locked in
// docs/live-evidence-schema.md §4).
//
// This mechanizes the manual §5 aggregation step from
// docs/runbooks/v1-blockers.md and is the third artifact of the
// real-binary live-verification arc:
//
//   1. live-verify-smart-arc.js        (probe → schema 1)
//   2. live-verify-review-relay.js     (probe → schema 2)
//   3. collect-live-evidence.js        (this — aggregator → schema 3)
//
// What it does:
//   1. Resolve the two component evidence files (auto-discover the
//      newest matching pattern in docs/reports/, or use explicit
//      --smart-arc / --review-relay flags).
//   2. Parse each, validate the embedded schema string against the
//      expected v1 identifier.
//   3. Build the bundle: per-component summary + full component
//      evidence inlined + missing-component tracking + derived
//      bundle verdict.
//   4. Write bundle to --out (default
//      docs/reports/<YYYY-MM-DD>-live-evidence-bundle.json) or
//      print to stdout in --json mode.
//
// CLI flags:
//   --smart-arc <path>      explicit path to schema-1 evidence file
//   --review-relay <path>   explicit path to schema-2 evidence file
//   --reports-dir <path>    directory to scan (default docs/reports)
//   --out <path>            output bundle path (default
//                           docs/reports/<today>-live-evidence-bundle.json)
//   --json                  print bundle to stdout, do not write file
//   --quiet                 suppress per-step output
//   --help                  print usage and exit 0
//
// Exit codes:
//   0  bundle.verdict === "PASS" — both components present and PASS
//   1  bundle.verdict === "FAIL" or "INCOMPLETE" — partial bundle
//      was still written so the gap is visible to a reviewer
//   2  CONFIG — could not find any evidence files, or could not
//      write the bundle (filesystem / arg error)
//
// Bundle schema (orchestrator-live-evidence-bundle/v1):
//   {
//     schema: "orchestrator-live-evidence-bundle/v1",
//     createdAt: ISO,
//     verdict: "PASS" | "FAIL" | "INCOMPLETE",
//     summary: {
//       smartArc:    { sourceFile, schema, verdict, timestamp } | null,
//       reviewRelay: { sourceFile, schema, verdict, timestamp } | null,
//     },
//     components: {
//       smartArc:    <full schema-1 evidence> | null,
//       reviewRelay: <full schema-2 evidence> | null,
//     },
//     missing: string[]   // names of components not found
//   }

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_BUNDLE = "orchestrator-live-evidence-bundle/v1";
const SCHEMA_SMART_ARC = "orchestrator-smart-lv-evidence/v1";
const SCHEMA_REVIEW_RELAY = "live-verify-review-relay/v1";

const REPORTS_DEFAULT = path.resolve(__dirname, "..", "docs", "reports");

// ── ANSI colors (NO_COLOR honored) ────────────────────────────────

const ANSI = {
  red:    process.env.NO_COLOR ? "" : "\x1b[31m",
  green:  process.env.NO_COLOR ? "" : "\x1b[32m",
  yellow: process.env.NO_COLOR ? "" : "\x1b[33m",
  cyan:   process.env.NO_COLOR ? "" : "\x1b[36m",
  bold:   process.env.NO_COLOR ? "" : "\x1b[1m",
  reset:  process.env.NO_COLOR ? "" : "\x1b[0m",
};

// ── CLI parser ────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {
    smartArc:    null,
    reviewRelay: null,
    reportsDir:  REPORTS_DEFAULT,
    outPath:     null,
    json:        false,
    quiet:       false,
    help:        false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--smart-arc":     out.smartArc    = next; i++; break;
      case "--review-relay":  out.reviewRelay = next; i++; break;
      case "--reports-dir":   out.reportsDir  = next; i++; break;
      case "--out":           out.outPath     = next; i++; break;
      case "--json":          out.json        = true; break;
      case "--quiet":         out.quiet       = true; break;
      case "--help":
      case "-h":              out.help        = true; break;
      default:
        if (a.startsWith("--")) {
          process.stderr.write(`unknown flag: ${a}\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

const HELP = `\
Usage: collect-live-evidence.js [options]

Aggregate the two operator-runnable probe outputs into a single
sealed bundle with schema "${SCHEMA_BUNDLE}".

Options:
  --smart-arc <path>      explicit path to schema-1 evidence file
                          ("${SCHEMA_SMART_ARC}")
  --review-relay <path>   explicit path to schema-2 evidence file
                          ("${SCHEMA_REVIEW_RELAY}")
  --reports-dir <path>    directory to auto-discover from
                          (default: docs/reports)
  --out <path>            bundle output path (default:
                          docs/reports/<today>-live-evidence-bundle.json)
  --json                  print bundle to stdout, skip file write
  --quiet                 suppress per-step output
  --help                  print this help and exit 0

Exit codes:
  0  bundle.verdict = PASS
  1  bundle.verdict = FAIL or INCOMPLETE (partial bundle still written)
  2  CONFIG: cannot read inputs or write output

Schema reference: docs/live-evidence-schema.md §4
`;

// ── Discovery ─────────────────────────────────────────────────────

// Find the newest file in a directory whose name matches a regex.
// Returns the resolved path or null.
function findNewest(dir, regex) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  const matches = entries
    .filter((f) => regex.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch (_) {}
      return { full, mtime };
    });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].full;
}

function discoverComponent(args, log) {
  const out = { smartArcPath: args.smartArc, reviewRelayPath: args.reviewRelay };
  if (!out.smartArcPath) {
    out.smartArcPath = findNewest(args.reportsDir,
      /\d{4}-\d{2}-\d{2}-smart-arc-live-verify\.json$/);
    if (out.smartArcPath) {
      log("smart-arc:    auto-discovered " + path.basename(out.smartArcPath));
    } else {
      log("smart-arc:    " + ANSI.yellow + "not found" + ANSI.reset +
          " in " + args.reportsDir);
    }
  } else {
    log("smart-arc:    explicit " + path.basename(out.smartArcPath));
  }
  if (!out.reviewRelayPath) {
    out.reviewRelayPath = findNewest(args.reportsDir,
      /\d{4}-\d{2}-\d{2}-review-relay-live-verify\.json$/);
    if (out.reviewRelayPath) {
      log("review-relay: auto-discovered " + path.basename(out.reviewRelayPath));
    } else {
      log("review-relay: " + ANSI.yellow + "not found" + ANSI.reset +
          " in " + args.reportsDir);
    }
  } else {
    log("review-relay: explicit " + path.basename(out.reviewRelayPath));
  }
  return out;
}

// ── Component loader + summary ────────────────────────────────────

function loadComponent(filePath, expectedSchema) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, reason: "missing" };
  let raw;
  try { raw = fs.readFileSync(filePath, "utf-8"); }
  catch (e) { return { ok: false, reason: "read_error: " + e.message }; }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { ok: false, reason: "parse_error: " + e.message }; }
  if (data && typeof data === "object" && data.schema !== expectedSchema) {
    return {
      ok: false,
      reason: "schema_mismatch: expected " + expectedSchema +
              ", got " + (data.schema || "<missing>"),
      data,
    };
  }
  return { ok: true, data };
}

function summarizeSmartArc(data, sourceFile) {
  return {
    sourceFile,
    schema: data.schema,
    verdict: data.verdict || null,
    timestamp: data.runAt || null,
  };
}

function summarizeReviewRelay(data, sourceFile) {
  return {
    sourceFile,
    schema: data.schema,
    verdict: data.verdict || null,
    timestamp: data.startedAt || null,
  };
}

// ── Bundle build ──────────────────────────────────────────────────

function deriveBundleVerdict(smartArcVerdict, reviewRelayVerdict) {
  // Both must be present + both verdicts indicate full success.
  if (!smartArcVerdict || !reviewRelayVerdict) return "INCOMPLETE";
  if (smartArcVerdict === "PASS" && reviewRelayVerdict === "PASS") return "PASS";
  // Either is CONFIG → INCOMPLETE (probe didn't run substantively).
  if (smartArcVerdict === "CONFIG" || reviewRelayVerdict === "PENDING") return "INCOMPLETE";
  // Otherwise at least one explicit FAIL.
  return "FAIL";
}

function buildBundle(smartArc, reviewRelay) {
  const summary = {
    smartArc:    smartArc.summary,
    reviewRelay: reviewRelay.summary,
  };
  const components = {
    smartArc:    smartArc.data,
    reviewRelay: reviewRelay.data,
  };
  const missing = [];
  if (!smartArc.summary)    missing.push("smartArc");
  if (!reviewRelay.summary) missing.push("reviewRelay");

  const verdict = deriveBundleVerdict(
    smartArc.summary    && smartArc.summary.verdict,
    reviewRelay.summary && reviewRelay.summary.verdict
  );

  return {
    schema: SCHEMA_BUNDLE,
    createdAt: new Date().toISOString(),
    verdict,
    summary,
    components,
    missing,
  };
}

// ── Main flow ─────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const log = (msg) => {
    if (!args.json && !args.quiet) {
      process.stdout.write("  " + msg + "\n");
    }
  };

  if (!args.json && !args.quiet) {
    process.stdout.write("\n" + ANSI.bold + "=== Live Evidence Collector ===" + ANSI.reset + "\n");
    process.stdout.write("배포 증거 수집 — aggregating probe outputs\n\n");
  }

  // 1. Discover
  const { smartArcPath, reviewRelayPath } = discoverComponent(args, log);

  // 2. Load + validate
  const smartArc = { summary: null, data: null };
  if (smartArcPath) {
    const r = loadComponent(smartArcPath, SCHEMA_SMART_ARC);
    if (r.ok) {
      smartArc.data = r.data;
      smartArc.summary = summarizeSmartArc(r.data, path.relative(process.cwd(), smartArcPath));
    } else {
      log(ANSI.red + "smart-arc load failed: " + r.reason + ANSI.reset);
    }
  }

  const reviewRelay = { summary: null, data: null };
  if (reviewRelayPath) {
    const r = loadComponent(reviewRelayPath, SCHEMA_REVIEW_RELAY);
    if (r.ok) {
      reviewRelay.data = r.data;
      reviewRelay.summary = summarizeReviewRelay(r.data, path.relative(process.cwd(), reviewRelayPath));
    } else {
      log(ANSI.red + "review-relay load failed: " + r.reason + ANSI.reset);
    }
  }

  // 3. Build bundle
  const bundle = buildBundle(smartArc, reviewRelay);

  // 4. Emit
  if (args.json) {
    process.stdout.write(JSON.stringify(bundle, null, 2) + "\n");
  } else {
    if (!args.quiet) {
      process.stdout.write("\n");
      process.stdout.write("  bundle verdict: " +
        (bundle.verdict === "PASS"        ? ANSI.green
         : bundle.verdict === "FAIL"      ? ANSI.red
         : ANSI.yellow) +
        bundle.verdict + ANSI.reset + "\n");
      if (bundle.missing.length > 0) {
        process.stdout.write("  missing:        " + bundle.missing.join(", ") + "\n");
      }
    }
    let outPath = args.outPath;
    if (!outPath) {
      const dateStr = new Date().toISOString().slice(0, 10);
      outPath = path.join(args.reportsDir, dateStr + "-live-evidence-bundle.json");
    }
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2));
      if (!args.quiet) {
        process.stdout.write("  written:        " + ANSI.cyan +
          path.relative(process.cwd(), outPath) + ANSI.reset + "\n");
      }
    } catch (e) {
      process.stderr.write("could not write bundle: " + e.message + "\n");
      return 2;
    }
  }

  // Exit code from verdict
  if (bundle.verdict === "PASS") return 0;
  return 1;
}

try {
  process.exit(main());
} catch (e) {
  process.stderr.write("collector runtime error: " + (e && e.stack || e) + "\n");
  process.exit(2);
}
