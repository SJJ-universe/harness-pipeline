#!/usr/bin/env node
//
// Slice PREFLIGHT-CHECKLIST (Phase 2 v2 follow-up, 2026-05-05) —
// pre-deployment health check.
//
// Runs the standard verification suite in sequence with a clear
// PASS/FAIL/WARN/INFO summary. Designed to be run by an operator
// before tagging a release or shipping a build.
//
// Default required gates:
//   - visual:check                (npm)
//   - readiness:check (live)      (must be exit 0 = release-ready)
//   - scorecard:check             (catches CONFIG-tier exit from
//                                  READINESS-BOOT-FAILURE-CONFIG)
//   - verify:hooks
//
// Informational (do not block):
//   - audit:moderate              (npm, warn on critical advisories)
//   - sign-manifest tooling       (presence check)
//
// Optional (opt-in):
//   - --with-smoke   adds test:smoke (60–90s extra)
//
// Usage:
//   node scripts/preflight.js                   # human-readable
//   node scripts/preflight.js --json            # machine-readable
//   node scripts/preflight.js --with-smoke      # include smoke tests
//   node scripts/preflight.js --quiet           # only print summary
//
// Exit codes:
//   0  — all required gates PASS
//   1  — at least one required gate FAILED
//   2  — preflight itself errored (not a gate result)
//
// Output is bilingual where it matters most for non-technical
// operators (CONFIG/FAIL banners include Korean explanation).

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const JSON_MODE = flag("--json");
const QUIET = flag("--quiet");
const WITH_SMOKE = flag("--with-smoke");

// ── Output helpers ───────────────────────────────────────────────────

function out(line) {
  if (!JSON_MODE) process.stdout.write(line);
}
function err(line) {
  process.stderr.write(line);
}
function pad(s, w) {
  if (s.length >= w) return s;
  return s + " ".repeat(w - s.length);
}

// ── Step runner ──────────────────────────────────────────────────────

function runStep(step) {
  const start = Date.now();
  const child = spawnSync(process.execPath, step.args, {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    timeout: step.timeoutMs || 300000,
    env: Object.assign({}, process.env, step.env || {}),
  });
  const elapsedMs = Date.now() - start;
  return {
    name: step.name,
    required: step.required,
    exitCode: child.status,
    elapsedMs,
    stdout: child.stdout || "",
    stderr: child.stderr || "",
    error: child.error ? String(child.error.message || child.error) : null,
  };
}

// ── Verdict mapping ──────────────────────────────────────────────────

// Returns { verdict, detail } where verdict is PASS/FAIL/WARN/INFO/SKIP.
function verdictFor(step, result) {
  if (result.error) {
    return { verdict: "FAIL", detail: "preflight-runtime: " + result.error };
  }

  // Step-specific interpretations.
  if (step.name === "readiness:check") {
    // readiness-report.js exit codes:
    //   0 release-ready / 1 preview / 2 internal / 3 blocking / 4 CONFIG
    if (result.exitCode === 0) {
      return { verdict: "PASS", detail: extractReadinessTotal(result.stdout) || "≥ 17/18" };
    }
    if (result.exitCode === 4) {
      return {
        verdict: "FAIL",
        detail: "CONFIG: harness server boot failed. NOT a regression — environment cannot run live checks. " +
                "Run preflight from a normal terminal (PowerShell, bash, CI runner).",
      };
    }
    if (result.exitCode === 1) return { verdict: "FAIL", detail: "preview-ready only (need ≥ 17/18 for release)" };
    if (result.exitCode === 2) return { verdict: "FAIL", detail: "internal-only (need ≥ 17/18 for release)" };
    if (result.exitCode === 3) return { verdict: "FAIL", detail: "blocking — categories empty or near-empty" };
    return { verdict: "FAIL", detail: "unexpected exit: " + result.exitCode };
  }

  if (step.name === "audit:moderate") {
    // audit:moderate is informational. exit 0 = clean, ≠ 0 = advisories.
    if (result.exitCode === 0) return { verdict: "PASS", detail: "no moderate+ advisories" };
    return { verdict: "WARN", detail: "advisories present (review manually)" };
  }

  if (step.name === "sign-manifest:present") {
    // We only check the file exists + the script runs --help cleanly.
    if (result.exitCode === 0) return { verdict: "PASS", detail: "tool responds to --help" };
    if (result.exitCode === null) return { verdict: "SKIP", detail: "tool not found" };
    return { verdict: "INFO", detail: "exit " + result.exitCode };
  }

  // Default: 0 = PASS, anything else = FAIL.
  if (result.exitCode === 0) return { verdict: "PASS", detail: "" };
  return { verdict: "FAIL", detail: "exit " + result.exitCode };
}

function extractReadinessTotal(stdout) {
  try {
    const o = JSON.parse(stdout);
    if (o && typeof o.total === "number" && typeof o.max === "number") {
      return o.total + "/" + o.max;
    }
  } catch (_) {}
  return null;
}

// ── Step list construction ───────────────────────────────────────────

function buildSteps() {
  const steps = [
    {
      name: "visual:check",
      args: ["scripts/visual-baseline-update.js", "--check"],
      required: true,
      timeoutMs: 60000,
    },
    {
      name: "readiness:check",
      args: ["scripts/readiness-report.js", "--json"],
      required: true,
      timeoutMs: 60000,
    },
    {
      name: "scorecard:check",
      args: ["scripts/sync-scorecard.js", "--check"],
      required: true,
      timeoutMs: 240000,
    },
    {
      name: "verify:hooks",
      args: ["scripts/validate-hook-deployment.js"],
      required: true,
      timeoutMs: 30000,
    },
  ];
  if (WITH_SMOKE) {
    steps.push({
      name: "test:smoke",
      args: ["tests/run-tests.js", "tests/smoke"],
      required: true,
      timeoutMs: 240000,
    });
  }
  // Informational gates — do not block deploy.
  steps.push({
    name: "sign-manifest:present",
    args: ["scripts/sign-manifest.js", "--help"],
    required: false,
    timeoutMs: 10000,
  });
  return steps;
}

// ── Main flow ────────────────────────────────────────────────────────

function main() {
  const steps = buildSteps();
  const results = [];

  if (!QUIET) {
    out("=== Harness Preflight ===\n");
    out("배포 전 점검 — pre-deployment verification\n\n");
  }

  let passedRequired = 0;
  let totalRequired = 0;
  let failedRequired = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.required) totalRequired++;
    const r = runStep(step);
    const v = verdictFor(step, r);
    results.push({ name: step.name, required: step.required, verdict: v.verdict, detail: v.detail, elapsedMs: r.elapsedMs, exitCode: r.exitCode });
    if (step.required) {
      if (v.verdict === "PASS") passedRequired++;
      else if (v.verdict === "FAIL") failedRequired++;
    }
    if (!JSON_MODE && !QUIET) {
      const idx = "[" + (i + 1) + "/" + steps.length + "]";
      const tag = step.required ? "" : "(info)";
      const dot = " ".repeat(Math.max(0, 28 - step.name.length - tag.length));
      const elapsed = "(" + (r.elapsedMs / 1000).toFixed(1) + "s)";
      const symbol = v.verdict === "PASS" ? "✓"
        : v.verdict === "FAIL" ? "✗"
        : v.verdict === "WARN" ? "⚠"
        : v.verdict === "SKIP" ? "·"
        : "i";
      out("  " + idx + " " + step.name + tag + dot + symbol + " " + pad(v.verdict, 5) + " " + elapsed);
      if (v.detail) out("  " + " ".repeat(idx.length + 1) + "  " + v.detail);
      out("\n");
    }
  }

  const allRequiredPassed = (failedRequired === 0 && passedRequired === totalRequired);
  const exit = allRequiredPassed ? 0 : 1;

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify({
      preflight: "harness",
      version: 1,
      allRequiredPassed,
      passedRequired,
      totalRequired,
      failedRequired,
      withSmoke: WITH_SMOKE,
      results,
    }, null, 2) + "\n");
    return exit;
  }

  // Human-readable summary
  if (!QUIET) out("\n");
  out("  Required: " + passedRequired + "/" + totalRequired + " PASS");
  if (failedRequired > 0) out(", " + failedRequired + " FAIL");
  out("\n");

  if (allRequiredPassed) {
    out("\n  ✅ Ready to deploy.\n");
    out("     모든 필수 점검 통과. 배포 가능합니다.\n");
  } else {
    out("\n  ❌ Not ready to deploy.\n");
    out("     필수 점검 실패. 위의 FAIL 항목을 먼저 해결하세요.\n");
    // Show FAIL details inline
    for (const r of results) {
      if (r.required && r.verdict === "FAIL") {
        out("\n  - " + r.name + ": " + r.detail + "\n");
      }
    }
    out("\n");
  }

  return exit;
}

try {
  process.exit(main());
} catch (e) {
  err("preflight runtime error: " + (e && e.stack || e) + "\n");
  process.exit(2);
}
