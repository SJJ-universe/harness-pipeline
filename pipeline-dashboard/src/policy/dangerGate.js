const path = require("path");
const { isInsideRoot } = require("../security/pathSandbox");
const { isReadOnlyBash, getPolicy } = require("./phasePolicy");

// Hardcoded fallback — used when policy JSON fails to load.
// Must stay in sync with policies/default-policy.json blockedCommandPatterns.
const BLOCKED_COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bRemove-Item\b[\s\S]*\b-Recurse\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+checkout\s+--\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/s\b/i,
  /--dangerously-skip-permissions/i,
  /\bgit\s+push\s+--force\b/i,
  /\bnpm\s+uninstall\b/i,
  /\bpip\s+uninstall\b/i,
];

let _compiledPatterns = null;

function getBlockedPatterns(policy) {
  const pol = policy || getPolicy();
  if (pol && Array.isArray(pol.blockedCommandPatterns)) {
    // Compile regex from policy strings (cached)
    if (!_compiledPatterns) {
      _compiledPatterns = pol.blockedCommandPatterns.map((p) => {
        try { return new RegExp(p, "i"); } catch (_) { return null; }
      }).filter(Boolean);
    }
    return _compiledPatterns;
  }
  return BLOCKED_COMMAND_PATTERNS;
}

// Reset compiled cache (for policy reload)
function resetPatternCache() {
  _compiledPatterns = null;
}

function decision(decisionValue, reason, extra = {}) {
  return {
    decision: decisionValue,
    reason,
    matchedRule: extra.matchedRule || null,
    requiredPhase: extra.requiredPhase || null,
  };
}

function commandFromAction(action) {
  if (action.command) return String(action.command);
  const input = action.input || {};
  if (input.command) return String(input.command);
  if (Array.isArray(action.args)) return [action.cmd, ...action.args].filter(Boolean).join(" ");
  return "";
}

function evaluate(action = {}, policy) {
  const command = commandFromAction(action);
  const repoRoot = action.repoRoot || process.cwd();
  const patterns = getBlockedPatterns(policy);

  if (action.path) {
    if (!isInsideRoot(action.path, repoRoot)) {
      return decision("block", `path is outside harness root: ${action.path}`, {
        matchedRule: "path-outside-root",
      });
    }
  }

  if (action.paths) {
    for (const p of action.paths) {
      if (!isInsideRoot(p, repoRoot)) {
        return decision("block", `path is outside harness root: ${p}`, {
          matchedRule: "path-outside-root",
        });
      }
    }
  }

  if (action.tool === "Bash" || action.type === "command" || command) {
    for (const pattern of patterns) {
      if (pattern.test(command)) {
        return decision("block", `blocked dangerous command: ${command}`, {
          matchedRule: pattern.source,
        });
      }
    }

    if (action.shellStringWithUserInput || action.userInputInterpolated) {
      return decision("block", "shell command contains interpolated user input", {
        matchedRule: "user-input-shell",
      });
    }

    if (action.phaseId === "A" && command && !isReadOnlyBash(command, policy)) {
      return decision("block", "Phase A blocks Bash except read-only discovery commands", {
        matchedRule: "phase-a-non-readonly-bash",
        requiredPhase: "E/F",
      });
    }
  }

  if (action.type === "agent-run" && action.args && action.args.includes("--dangerously-skip-permissions")) {
    if (process.env.HARNESS_ALLOW_DANGEROUS_AGENT !== "1" || !action.explicitConfirmation) {
      return decision("block", "dangerous agent permissions require explicit override", {
        matchedRule: "dangerous-agent",
      });
    }
  }

  if (action.cwd && !isInsideRoot(path.resolve(action.cwd), repoRoot)) {
    return decision("block", `cwd is outside harness root: ${action.cwd}`, {
      matchedRule: "cwd-outside-root",
    });
  }

  return decision("allow", "no danger gate rule matched");
}

module.exports = {
  BLOCKED_COMMAND_PATTERNS,
  evaluate,
  getBlockedPatterns,
  resetPatternCache,
};
