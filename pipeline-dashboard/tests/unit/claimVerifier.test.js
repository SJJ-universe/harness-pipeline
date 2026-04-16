// Unit test: Self-Verification — ClaimVerifier
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { ClaimVerifier } = require("../../src/verification/claimVerifier");

const verifier = new ClaimVerifier();

describe("ClaimVerifier", () => {
  it("fails when files edited but no Bash in Phase F", () => {
    const state = {
      phases: {
        E: { tools: [{ tool: "Edit" }] },
        F: { tools: [{ tool: "Read" }] },
      },
      findings: [],
      metrics: { filesEdited: new Set(["file.js"]) },
    };
    const result = verifier.verify(state);
    assert.ok(!result.pass);
    assert.ok(result.missing.includes("test-evidence-required"));
  });

  it("passes when files edited and Bash ran in Phase F", () => {
    const state = {
      phases: {
        E: { tools: [{ tool: "Edit" }] },
        F: { tools: [{ tool: "Bash" }, { tool: "Read" }] },
      },
      findings: [],
      metrics: { filesEdited: new Set(["file.js"]) },
    };
    const result = verifier.verify(state);
    assert.ok(result.pass);
  });

  it("passes when no files were edited", () => {
    const state = {
      phases: {
        A: { tools: [{ tool: "Read" }] },
      },
      findings: [],
      metrics: { filesEdited: new Set() },
    };
    const result = verifier.verify(state);
    // Only verification-phase-executed should fail (no Phase F)
    assert.ok(result.missing.includes("verification-phase-executed"));
    assert.ok(!result.missing.includes("test-evidence-required"));
  });

  it("fails when critical findings unresolved", () => {
    const state = {
      phases: {
        F: { tools: [{ tool: "Bash" }] },
      },
      findings: [{ severity: "critical", message: "XSS found" }],
      metrics: { filesEdited: new Set() },
    };
    const result = verifier.verify(state);
    assert.ok(!result.pass);
    assert.ok(result.missing.includes("critical-findings-resolved"));
  });

  it("fails when Phase F not executed", () => {
    const state = {
      phases: {},
      findings: [],
      metrics: { filesEdited: new Set() },
    };
    const result = verifier.verify(state);
    assert.ok(result.missing.includes("verification-phase-executed"));
  });

  it("passes all rules in happy path", () => {
    const state = {
      phases: {
        F: { tools: [{ tool: "Bash" }, { tool: "Read" }] },
      },
      findings: [{ severity: "medium", message: "minor issue" }],
      metrics: { filesEdited: new Set() },
    };
    const result = verifier.verify(state);
    assert.ok(result.pass);
    assert.equal(result.missing.length, 0);
  });
});
