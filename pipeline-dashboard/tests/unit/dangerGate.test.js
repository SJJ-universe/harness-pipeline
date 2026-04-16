const assert = require("node:assert/strict");
const test = require("node:test");
const dangerGate = require("../../src/policy/dangerGate");

test("dangerGate blocks destructive shell commands", () => {
  const result = dangerGate.evaluate({ tool: "Bash", command: "rm -rf node_modules" });
  assert.equal(result.decision, "block");
  assert.match(result.reason, /dangerous command/);
});

test("dangerGate allows explicit read-only discovery commands", () => {
  const result = dangerGate.evaluate({ tool: "Bash", command: "git status --short", phaseId: "A" });
  assert.equal(result.decision, "allow");
});

test("dangerGate blocks dangerous agent permission flags", () => {
  const result = dangerGate.evaluate({
    type: "agent-run",
    cmd: "claude",
    args: ["-p", "--bare", "--dangerously-skip-permissions", "hello"],
  });
  assert.equal(result.decision, "block");
});
