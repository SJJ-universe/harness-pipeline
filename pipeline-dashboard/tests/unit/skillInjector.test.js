// Unit test for P-3: Artifact Total Size Cap
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { SkillInjector } = require("../../executor/skill-injector");

describe("SkillInjector prompt cap", () => {
  function makeState(numPhases, artifactSize) {
    const state = {
      meta: { userPrompt: "test task" },
      phases: {},
      findings: [],
    };
    for (let i = 0; i < numPhases; i++) {
      const id = String.fromCharCode(65 + i); // A, B, C, ...
      state.phases[id] = {
        artifacts: { plan: "x".repeat(artifactSize) },
      };
    }
    return state;
  }

  it("caps total prompt to 12000 chars when artifacts are large", () => {
    const injector = new SkillInjector({});
    const state = makeState(6, 5000); // 6 phases × 5000 chars = 30K raw
    const phase = { id: "G", name: "Critic" }; // phase not in state → all are "prior"
    const prompt = injector.buildCodexPrompt(phase, state);
    assert.ok(prompt.length <= 12_100, `prompt too long: ${prompt.length}`); // small margin for truncation marker
  });

  it("preserves newest artifacts when dropping for budget", () => {
    const injector = new SkillInjector({});
    const state = {
      meta: { userPrompt: "test" },
      phases: {
        A: { artifacts: { old: "OLD_DATA_" + "a".repeat(4000) } },
        B: { artifacts: { mid: "MID_DATA_" + "b".repeat(4000) } },
        C: { artifacts: { new: "NEW_DATA_" + "c".repeat(4000) } },
      },
      findings: [],
    };
    const prompt = injector.buildCodexPrompt({ id: "D", name: "Critic" }, state);
    // Newest artifact (C) should be kept, oldest (A) dropped first
    assert.ok(prompt.includes("NEW_DATA"), "newest artifact should be preserved");
  });

  it("works fine when artifacts fit within budget", () => {
    const injector = new SkillInjector({});
    const state = makeState(2, 500); // 2 × 500 = 1K — well within budget
    const prompt = injector.buildCodexPrompt({ id: "C", name: "Critic" }, state);
    assert.ok(prompt.length < 12_000);
    assert.ok(prompt.includes("x".repeat(100)), "artifacts should be present");
  });
});
