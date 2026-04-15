#!/usr/bin/env node
// P2-1 — Harness onboarding: generate/merge .claude/settings.json
//
// Single-command installer for the 5 Claude Code lifecycle hooks that wire
// the harness pipeline into a user's workspace. Safe to re-run: merges into
// any existing settings.json without clobbering unrelated hooks, and is
// idempotent — three runs produce the same file.
//
// Usage:
//   node scripts/setup-harness.js                 # install into cwd
//   node scripts/setup-harness.js --target <dir>  # install into <dir>
//   node scripts/setup-harness.js --dry-run       # print plan, write nothing
//
// The absolute path to harness-hook.js is resolved at script-run time based
// on the location of this script, so the generated settings.json points at
// whatever copy of pipeline-dashboard the user is sitting in.

const fs = require("fs");
const path = require("path");

const HOOK_ABS = path
  .resolve(__dirname, "..", "hooks", "harness-hook.js")
  .replace(/\\/g, "/");

const EVENTS = [
  { event: "UserPromptSubmit", kind: "user-prompt", matcher: "" },
  { event: "PreToolUse", kind: "pre-tool", matcher: "Edit|Write|Bash" },
  { event: "PostToolUse", kind: "post-tool", matcher: "" },
  { event: "Stop", kind: "stop", matcher: "" },
  { event: "SessionEnd", kind: "session-end", matcher: "" },
];

function harnessCommand(kind) {
  return `node ${HOOK_ABS} ${kind}`;
}

function parseArgs(argv) {
  const out = { target: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--target") out.target = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node scripts/setup-harness.js [--target <dir>] [--dry-run]",
      "",
      "Installs harness pipeline hooks into <dir>/.claude/settings.json.",
      "Merges with existing hooks; never clobbers; idempotent.",
      "",
    ].join("\n")
  );
}

function readExistingSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (e) {
    throw new Error(
      "Existing settings.json is not valid JSON — refusing to overwrite: " +
        settingsPath
    );
  }
}

// Returns true if this event already has a harness-hook.js command wired.
function hasHarnessEntry(groups) {
  for (const entry of groups) {
    for (const h of entry.hooks || []) {
      if (h && typeof h.command === "string" && h.command.includes("harness-hook.js")) {
        return true;
      }
    }
  }
  return false;
}

function mergeSettings(settings) {
  const merged = { ...settings };
  merged.hooks = { ...(settings.hooks || {}) };
  let added = 0;
  for (const { event, kind, matcher } of EVENTS) {
    const groups = Array.isArray(merged.hooks[event])
      ? merged.hooks[event].slice()
      : [];
    if (hasHarnessEntry(groups)) {
      merged.hooks[event] = groups;
      continue;
    }
    groups.push({
      matcher,
      hooks: [{ type: "command", command: harnessCommand(kind) }],
    });
    merged.hooks[event] = groups;
    added++;
  }
  return { merged, added };
}

function printPlan(settingsPath, existingHasFile, added) {
  console.log("Harness setup plan");
  console.log("  target:  " + settingsPath);
  console.log("  exists:  " + (existingHasFile ? "yes (merge)" : "no (create)"));
  console.log("  hooks:");
  for (const { event, kind } of EVENTS) {
    console.log("    - " + event + "  →  " + harnessCommand(kind));
  }
  console.log("  will add " + added + " new hook entries");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.target) {
    console.error("error: --target requires a value");
    return 2;
  }

  const target = path.resolve(args.target);
  const claudeDir = path.join(target, ".claude");
  const settingsPath = path.join(claudeDir, "settings.json");

  let existing = {};
  const existingHasFile = fs.existsSync(settingsPath);
  if (existingHasFile) existing = readExistingSettings(settingsPath);

  const { merged, added } = mergeSettings(existing);

  if (args.dryRun) {
    printPlan(settingsPath, existingHasFile, added);
    console.log("(dry-run — no files written)");
    return 0;
  }

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }
  const body = JSON.stringify(merged, null, 2) + "\n";
  fs.writeFileSync(settingsPath, body);

  if (added > 0) {
    console.log("[setup-harness] wrote " + settingsPath + " (" + added + " new hooks)");
  } else {
    console.log("[setup-harness] " + settingsPath + " already up to date");
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (e) {
    console.error("[setup-harness] " + (e.stack || e.message));
    process.exit(1);
  }
}

module.exports = { mergeSettings, harnessCommand, EVENTS, HOOK_ABS };
