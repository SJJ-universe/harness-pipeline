const assert = require("node:assert/strict");
const test = require("node:test");
const { enforceTemplateDefaults, evaluateTool, isReadOnlyBash } = require("../../src/policy/phasePolicy");

test("enforceTemplateDefaults removes Bash from Phase A and requires three discovery actions", () => {
  const template = {
    phases: [{ id: "A", allowedTools: ["Read", "Bash"], exitCriteria: [{ type: "min-tools-in-phase", count: 1 }] }],
  };
  const normalized = enforceTemplateDefaults(template);
  assert.deepEqual(normalized.phases[0].allowedTools, ["Read"]);
  assert.equal(normalized.phases[0].exitCriteria[0].count, 3);
});

test("evaluateTool blocks tools outside the phase allowlist", () => {
  const result = evaluateTool({ phase: { id: "A", allowedTools: ["Read"] }, tool: "Bash" });
  assert.equal(result.decision, "block");
});

test("isReadOnlyBash recognizes allowlisted discovery commands", () => {
  assert.equal(isReadOnlyBash("git diff HEAD"), true);
  assert.equal(isReadOnlyBash("npm test"), false);
});
