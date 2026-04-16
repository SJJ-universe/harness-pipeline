const fs = require("fs");
const path = require("path");

const POLICY_PATH = path.resolve(__dirname, "..", "..", "policies", "default-policy.json");

let _cachedPolicy = null;

function loadPolicy(policyPath) {
  const p = policyPath || POLICY_PATH;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    _cachedPolicy = JSON.parse(raw);
    return _cachedPolicy;
  } catch (_) {
    return null;
  }
}

function getPolicy() {
  if (!_cachedPolicy) loadPolicy();
  return _cachedPolicy;
}

function reloadPolicy(policyPath) {
  _cachedPolicy = null;
  // Also reset dangerGate compiled pattern cache so it picks up new patterns
  try {
    const { resetPatternCache } = require("./dangerGate");
    resetPatternCache();
  } catch (_) {}
  return loadPolicy(policyPath);
}

// Fallback read-only prefixes used when policy is unavailable
const READ_ONLY_BASH_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "rg",
  "Get-Content",
  "Get-ChildItem",
];

function normalizeCommand(command) {
  return String(command || "").trim().replace(/\s+/g, " ");
}

function isReadOnlyBash(command, policy) {
  const normalized = normalizeCommand(command);
  const prefixes = (policy && policy.phases && policy.phases.A && policy.phases.A.bash && policy.phases.A.bash.readOnlyPrefixes)
    || READ_ONLY_BASH_PREFIXES;
  return prefixes.some((prefix) => normalized === prefix || normalized.startsWith(prefix + " "));
}

function getAllowedTools(phase) {
  if (!phase || !Array.isArray(phase.allowedTools)) return [];
  return phase.allowedTools;
}

function evaluateTool({ phase, tool, input = {}, policy }) {
  const phaseId = phase?.id || null;
  const allowed = getAllowedTools(phase);
  if (!allowed.length) return { decision: "allow", reason: "phase has no tool allowlist" };

  if (!allowed.includes(tool)) {
    return {
      decision: "block",
      reason: `Tool ${tool} is not allowed in phase ${phaseId}. Allowed tools: ${allowed.join(", ")}`,
      requiredPhase: phaseId,
    };
  }

  // Use policy-defined bash mode if available, fall back to hardcoded Phase A check
  // Note: phase allowedTools come from pipeline-templates.json (the phase object).
  // Policy JSON governs bash mode (blocked/allowlisted/open) and command blocklists.
  const pol = policy || getPolicy();
  const phasePolicy = pol && pol.phases && pol.phases[phaseId];

  if (phasePolicy && phasePolicy.bash && tool === "Bash") {
    const bashMode = phasePolicy.bash.mode;
    if (bashMode === "blocked" && !isReadOnlyBash(input.command, pol)) {
      return {
        decision: "block",
        reason: `Phase ${phaseId} blocks Bash except explicit read-only discovery commands`,
        requiredPhase: "E/F",
      };
    }
    if (bashMode === "allowlisted") {
      const prefixes = phasePolicy.bash.allowPrefixes || [];
      const normalized = normalizeCommand(input.command);
      const isAllowed = prefixes.some((p) => normalized === p || normalized.startsWith(p + " "));
      if (!isAllowed) {
        return {
          decision: "block",
          reason: `Phase ${phaseId} only allows Bash with prefixes: ${prefixes.join(", ")}`,
          requiredPhase: phaseId,
        };
      }
    }
    // bashMode === "open" → allow all bash
  } else if (phaseId === "A" && tool === "Bash" && !isReadOnlyBash(input.command)) {
    return {
      decision: "block",
      reason: "Phase A blocks Bash except explicit read-only discovery commands",
      requiredPhase: "E/F",
    };
  }

  return { decision: "allow", reason: "tool allowed by phase policy" };
}

function enforceTemplateDefaults(template) {
  const clone = structuredClone(template);
  for (const phase of clone.phases || []) {
    if (phase.id === "A" && Array.isArray(phase.allowedTools)) {
      phase.allowedTools = phase.allowedTools.filter((tool) => tool !== "Bash");
      for (const criterion of phase.exitCriteria || []) {
        if (criterion.type === "min-tools-in-phase" && criterion.count < 3) {
          criterion.count = 3;
        }
      }
    }
  }
  return clone;
}

module.exports = {
  READ_ONLY_BASH_PREFIXES,
  enforceTemplateDefaults,
  evaluateTool,
  isReadOnlyBash,
  loadPolicy,
  getPolicy,
  reloadPolicy,
};
