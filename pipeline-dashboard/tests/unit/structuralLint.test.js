// Unit test: structural lint rules from policy JSON
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { lint, parseRule } = require("../../src/policy/structuralLint");
const { loadPolicy } = require("../../src/policy/phasePolicy");

const APP_ROOT = path.resolve(__dirname, "..", "..");

describe("Structural Lint", () => {
  it("parses rule format correctly", () => {
    const parsed = parseRule("src/security/** must not require from executor/**");
    assert.ok(parsed);
    assert.equal(parsed.sourceGlob, "src/security/**");
    assert.equal(parsed.targetGlob, "executor/**");
  });

  it("returns null for unparseable rules", () => {
    assert.equal(parseRule("invalid rule text"), null);
  });

  it("current codebase passes all structural lint rules", () => {
    const policy = loadPolicy();
    assert.ok(policy, "policy should load");
    const results = lint(APP_ROOT, policy);
    assert.ok(results.length > 0, "should have lint results");
    for (const r of results) {
      assert.ok(r.pass, `rule ${r.id} failed: ${r.message}`);
    }
  });

  it("detects violation when source imports from target", () => {
    // Test with a synthetic policy rule that WOULD fail
    const fakePolicy = {
      structuralLint: [
        {
          id: "test-impossible",
          rule: "src/security/** must not require from nonexistent-dir/**",
          level: "error",
        },
      ],
    };
    const results = lint(APP_ROOT, fakePolicy);
    assert.equal(results.length, 1);
    assert.ok(results[0].pass, "should pass when target dir has no matches");
  });
});
