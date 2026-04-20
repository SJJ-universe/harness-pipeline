#!/usr/bin/env node
// CLI wrapper around src/hooks/deploymentValidator.js
//
//   npm run verify:hooks
//
// Scans likely locations of .claude/settings.json (project root going up,
// plus the user-global ~/.claude/settings.json) and prints a report for
// each one found. Exits 0 if at least one deployment passes validation.
// Otherwise prints a concrete remediation hint and exits non-zero.

const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  validateDeployment,
  formatReport,
} = require("../src/hooks/deploymentValidator");

function candidateSettingsPaths() {
  const out = [];
  // Walk upward from cwd up to three levels to cover:
  //   pipeline-dashboard/     (cwd when running npm script)
  //   harness-pipeline-analysis/  (repo root, where settings actually lives)
  //   workspace/              (user monorepo root)
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    out.push(path.join(dir, ".claude", "settings.json"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // User-global fallback.
  out.push(path.join(os.homedir(), ".claude", "settings.json"));
  return Array.from(new Set(out));
}

function main() {
  const paths = candidateSettingsPaths();
  const reports = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const report = validateDeployment(p);
    reports.push(report);
    console.log(formatReport(report));
    console.log("");
  }

  if (reports.length === 0) {
    console.error("No .claude/settings.json found in any of:");
    for (const p of paths) console.error(`  ${p}`);
    console.error("\nCreate one with the 10 hooks this harness expects:");
    console.error("  UserPromptSubmit, PreToolUse, PostToolUse, Stop,");
    console.error("  SessionStart, SessionEnd, SubagentStart, SubagentStop,");
    console.error("  Notification, PreCompact");
    process.exit(2);
  }

  const anyOk = reports.some((r) => r.overallOk);
  if (!anyOk) {
    console.error("No valid hook deployment found. See FAIL details above.");
    process.exit(1);
  }
  console.log("Hook deployment validated.");
  process.exit(0);
}

main();
