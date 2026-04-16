// Unit test: Agent Contract System
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadContracts, getAgentContract, checkToolAgainstContract, toolToAction } = require("../../src/contracts/agentContracts");

describe("Agent Contracts", () => {
  it("loads contracts from JSON", () => {
    const contracts = loadContracts();
    assert.ok(contracts);
    assert.equal(contracts.version, 1);
    assert.ok(contracts.agents.planner);
    assert.ok(contracts.agents.default);
  });

  it("returns default contract for unknown agents", () => {
    const contract = getAgentContract("nonexistent-agent");
    assert.ok(contract);
    assert.deepEqual(contract.forbiddenActions, []);
  });

  it("planner cannot execute shell", () => {
    const result = checkToolAgainstContract("planner", "Bash", {});
    assert.ok(!result.allowed);
    assert.ok(result.reason.includes("forbids"));
  });

  it("planner cannot modify source", () => {
    const result = checkToolAgainstContract("planner", "Edit", {});
    assert.ok(!result.allowed);
  });

  it("planner can write plan files", () => {
    const result = checkToolAgainstContract("planner", "Write", { file_path: "plan.md" });
    assert.ok(result.allowed);
  });

  it("executor can do everything", () => {
    assert.ok(checkToolAgainstContract("executor", "Bash", {}).allowed);
    assert.ok(checkToolAgainstContract("executor", "Edit", {}).allowed);
    assert.ok(checkToolAgainstContract("executor", "Read", {}).allowed);
  });

  it("critic cannot modify source or execute shell", () => {
    assert.ok(!checkToolAgainstContract("critic", "Bash", {}).allowed);
    assert.ok(!checkToolAgainstContract("critic", "Edit", {}).allowed);
    assert.ok(checkToolAgainstContract("critic", "Read", {}).allowed);
  });

  it("validator cannot modify source", () => {
    assert.ok(!checkToolAgainstContract("validator", "Edit", {}).allowed);
    assert.ok(checkToolAgainstContract("validator", "Bash", {}).allowed);
  });

  it("toolToAction maps correctly", () => {
    assert.equal(toolToAction("Bash"), "execute-shell");
    assert.equal(toolToAction("Edit"), "modify-source");
    assert.equal(toolToAction("Read"), "read");
    assert.equal(toolToAction("Glob"), "search");
    assert.equal(toolToAction("Write", { file_path: "plan.md" }), "write-plan");
    assert.equal(toolToAction("Write", { file_path: "server.js" }), "modify-source");
  });
});
