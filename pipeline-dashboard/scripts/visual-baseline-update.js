#!/usr/bin/env node
// scripts/visual-baseline-update.js — Slice UI-P9 (Phase 2 Round 3,
// 2026-04-30).
//
// Operator CLI to refresh the visual contract baseline. Run when an
// intentional UI change (new region, new card, design token rename,
// etc.) requires the snapshot to be re-pinned.
//
// Usage:
//   node scripts/visual-baseline-update.js          # writes baseline
//   node scripts/visual-baseline-update.js --check  # exit 1 if stale
//   node scripts/visual-baseline-update.js --print  # stdout only
//
// The baseline file lives at:
//   tests/visual/baseline-product-shell.json
//
// All visual contract changes MUST land in a single commit alongside
// the code change so the diff is reviewable. The CI gate
// (`tests/unit/visual.contract.test.js`) consumes the same baseline
// and fails when production drifts away from it.

"use strict";

const fs = require("fs");
const path = require("path");
const { captureSnapshot } = require("../tests/visual/capture");

const BASELINE_PATH = path.resolve(__dirname, "..", "tests", "visual", "baseline-product-shell.json");

const args = process.argv.slice(2);
const flagCheck = args.includes("--check");
const flagPrint = args.includes("--print");

function _format(snap) {
  // Stable two-space indent + trailing newline so the file diff is
  // line-friendly for code review.
  return JSON.stringify(snap, null, 2) + "\n";
}

function _readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return fs.readFileSync(BASELINE_PATH, "utf-8");
}

function main() {
  const snapshot = captureSnapshot();
  const next = _format(snapshot);

  if (flagPrint) {
    process.stdout.write(next);
    process.exit(0);
  }

  if (flagCheck) {
    const current = _readBaseline();
    if (current === null) {
      console.error("[visual-baseline] baseline file missing: " + BASELINE_PATH);
      console.error("[visual-baseline] run `npm run visual:update` to write it.");
      process.exit(1);
    }
    if (current !== next) {
      console.error("[visual-baseline] STALE: " + path.relative(process.cwd(), BASELINE_PATH));
      console.error("[visual-baseline] Run `npm run visual:update` to refresh.");
      console.error("[visual-baseline] (review the diff in the resulting commit)");
      process.exit(1);
    }
    console.log("[visual-baseline] in sync — " + path.relative(process.cwd(), BASELINE_PATH));
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, next, "utf-8");
  console.log("[visual-baseline] wrote " + path.relative(process.cwd(), BASELINE_PATH));
  console.log("[visual-baseline] panels captured: " + Object.keys(snapshot.panels).join(", "));
  console.log("[visual-baseline] product CSS tokens: " + snapshot.productCssTokens.length);
}

main();
