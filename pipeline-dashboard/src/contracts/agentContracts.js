// Agent Contracts — declares capabilities and forbidden actions per agent role.
// Enforced in PipelineExecutor.onPreTool() and QualityGate.

const fs = require("fs");
const path = require("path");

const CONTRACTS_PATH = path.resolve(__dirname, "..", "..", "contracts", "default-agent-contracts.json");

let _cachedContracts = null;

// Tool → action mapping
const TOOL_ACTION_MAP = {
  Bash: "execute-shell",
  Edit: "modify-source",
  Write: "modify-source",
  Read: "read",
  Glob: "search",
  Grep: "search",
  Agent: "search",
  TodoWrite: "search",
  NotebookEdit: "modify-source",
};

function loadContracts(contractsPath) {
  const p = contractsPath || CONTRACTS_PATH;
  try {
    const raw = fs.readFileSync(p, "utf-8");
    _cachedContracts = JSON.parse(raw);
    return _cachedContracts;
  } catch (_) {
    return null;
  }
}

function getContracts() {
  if (!_cachedContracts) loadContracts();
  return _cachedContracts;
}

function getAgentContract(agentName) {
  const contracts = getContracts();
  if (!contracts || !contracts.agents) return null;
  return contracts.agents[agentName] || contracts.agents["default"] || null;
}

function toolToAction(tool, input) {
  // Special case: Write to plan*.md → write-plan, not modify-source
  if (tool === "Write" && input && input.file_path) {
    const basename = path.basename(String(input.file_path)).toLowerCase();
    if (basename.startsWith("plan") && basename.endsWith(".md")) {
      return "write-plan";
    }
  }
  return TOOL_ACTION_MAP[tool] || null;
}

function checkToolAgainstContract(agentName, tool, input) {
  const contract = getAgentContract(agentName);
  if (!contract) return { allowed: true, reason: "no contract found" };

  const action = toolToAction(tool, input);
  if (!action) return { allowed: true, reason: "tool has no mapped action" };

  if (Array.isArray(contract.forbiddenActions) && contract.forbiddenActions.includes(action)) {
    return {
      allowed: false,
      reason: `Agent "${agentName}" contract forbids action "${action}" (tool: ${tool})`,
    };
  }

  return { allowed: true, reason: "allowed by contract" };
}

module.exports = {
  loadContracts,
  getContracts,
  getAgentContract,
  checkToolAgainstContract,
  toolToAction,
  TOOL_ACTION_MAP,
};
