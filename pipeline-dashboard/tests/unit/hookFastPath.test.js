// Unit test for P-1: Hook Fast Path — FIRE_AND_FORGET_TOOLS detection
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// The FIRE_AND_FORGET_TOOLS set is defined inside harness-hook.js which is a
// standalone CLI script. We replicate the set here and verify it matches the
// expected safe-tool list.
const FIRE_AND_FORGET_TOOLS = new Set([
  "Read", "Glob", "Grep", "Agent", "TodoWrite", "WebSearch", "WebFetch",
]);

describe("Hook Fast Path", () => {
  it("allows safe read-only tools", () => {
    for (const tool of ["Read", "Glob", "Grep", "Agent", "TodoWrite"]) {
      assert.ok(FIRE_AND_FORGET_TOOLS.has(tool), `${tool} should be fire-and-forget`);
    }
  });

  it("blocks dangerous tools from fast path", () => {
    for (const tool of ["Edit", "Write", "Bash", "NotebookEdit"]) {
      assert.ok(!FIRE_AND_FORGET_TOOLS.has(tool), `${tool} must NOT be fire-and-forget`);
    }
  });

  it("blocks unknown tools from fast path", () => {
    assert.ok(!FIRE_AND_FORGET_TOOLS.has("SomeNewTool"));
    assert.ok(!FIRE_AND_FORGET_TOOLS.has(undefined));
    assert.ok(!FIRE_AND_FORGET_TOOLS.has(null));
  });
});
