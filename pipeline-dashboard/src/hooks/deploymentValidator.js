// Hook Deployment Validator — Slice F0, v5.
//
// Verifies that a `.claude/settings.json` actually registers all 10 hooks
// that this harness knows how to handle. The harness itself wires the code
// paths (see executor/hook-router.js, hooks/harness-hook.js) but none of
// that matters if Claude Code isn't configured to *call* the bridge.
//
// Returns a report object. It's the CLI wrapper's job
// (scripts/validate-hook-deployment.js) to turn that into an exit code.

const fs = require("fs");

// Every Claude Code hook the harness knows how to consume.
const REQUIRED_HOOKS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "Notification",
  "PreCompact",
];

// Canonical hook name → the CLI alias harness-hook.js expects as argv[2].
// Mirrors the switch in executor/hook-router.js::route().
const ALIAS_MAP = {
  UserPromptSubmit: "user-prompt",
  PreToolUse: "pre-tool",
  PostToolUse: "post-tool",
  Stop: "stop",
  SessionStart: "session-start",
  SessionEnd: "session-end",
  SubagentStart: "subagent-start",
  SubagentStop: "subagent-stop",
  Notification: "notification",
  PreCompact: "pre-compact",
};

// Tools the harness MUST see in PreToolUse for phase-scoped metrics,
// TDD Guard (Slice G), and allowedTools enforcement to work correctly.
// Empty matcher ("" or "*") is treated as match-all and satisfies all tools.
const REQUIRED_PRETOOL_MATCHERS = ["Edit", "Write", "Bash", "Read", "Glob", "Grep"];

/**
 * Validate a .claude/settings.json hook deployment.
 *
 * @param {string} settingsPath  Absolute path to the JSON file.
 * @returns {object} report
 */
function validateDeployment(settingsPath) {
  const report = {
    settingsPath,
    exists: false,
    hooks: {},
    preToolMissingTools: [],
    errors: [],
    overallOk: false,
  };

  if (!fs.existsSync(settingsPath)) {
    report.errors.push(`settings file not found: ${settingsPath}`);
    return report;
  }
  report.exists = true;

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch (err) {
    report.errors.push(`failed to parse settings: ${err.message}`);
    return report;
  }

  const hooks = settings?.hooks || {};

  for (const hookName of REQUIRED_HOOKS) {
    const entry = hooks[hookName];
    const expectedAlias = ALIAS_MAP[hookName];

    if (!Array.isArray(entry) || entry.length === 0) {
      report.hooks[hookName] = {
        present: false,
        ok: false,
        aliasExpected: expectedAlias,
      };
      continue;
    }

    const block = entry[0];
    const matcher = block?.matcher ?? "";
    const cmd = block?.hooks?.[0]?.command || "";
    const aliasFound = _extractAlias(cmd);
    const aliasOk = aliasFound === expectedAlias;
    // Soft check: command should mention harness-hook.js so we know it's
    // pointed at the right bridge, not some arbitrary script.
    const commandOk = /harness-hook\.js/.test(cmd);

    report.hooks[hookName] = {
      present: true,
      matcher,
      command: cmd,
      aliasExpected: expectedAlias,
      aliasFound,
      ok: aliasOk && commandOk,
    };
  }

  // PreToolUse needs to see every required tool. "" or "*" = match all.
  const preToolEntry = hooks.PreToolUse?.[0];
  if (preToolEntry) {
    const matcher = preToolEntry.matcher ?? "";
    const matchAll = matcher === "" || matcher === "*";
    if (!matchAll) {
      const matched = matcher.split("|").map((s) => s.trim()).filter(Boolean);
      for (const tool of REQUIRED_PRETOOL_MATCHERS) {
        if (!matched.includes(tool)) report.preToolMissingTools.push(tool);
      }
    }
  }

  const allHooksOk = Object.values(report.hooks).every((h) => h.ok);
  report.overallOk =
    allHooksOk &&
    report.preToolMissingTools.length === 0 &&
    report.errors.length === 0;
  return report;
}

function _extractAlias(command) {
  // e.g. `node "C:/.../harness-hook.js" user-prompt` → "user-prompt"
  const m = /harness-hook\.js["']?\s+([A-Za-z][A-Za-z0-9-]*)\s*$/.exec(command);
  return m ? m[1] : null;
}

/**
 * Turn a report into a human-readable block. Does NOT write to stdout itself
 * so tests can assert the string directly.
 */
function formatReport(report) {
  const lines = [];
  lines.push(`Hook deployment: ${report.settingsPath}`);
  lines.push(`  Exists: ${report.exists ? "YES" : "NO"}`);
  for (const err of report.errors) lines.push(`  ERROR: ${err}`);
  for (const [name, h] of Object.entries(report.hooks)) {
    const status = h.ok ? "OK" : h.present ? "ALIAS-MISMATCH" : "MISSING";
    const detail = h.present
      ? `matcher="${h.matcher}" alias=${h.aliasFound || "?"}/${h.aliasExpected}`
      : `(not registered; expected alias=${h.aliasExpected})`;
    lines.push(`  [${status}] ${name}: ${detail}`);
  }
  if (report.preToolMissingTools.length) {
    lines.push(
      `  WARN: PreToolUse matcher missing required tools: ` +
        report.preToolMissingTools.join(", ")
    );
  }
  lines.push(`  Overall: ${report.overallOk ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

module.exports = {
  REQUIRED_HOOKS,
  ALIAS_MAP,
  REQUIRED_PRETOOL_MATCHERS,
  validateDeployment,
  formatReport,
};
