// Slice G (v5) — TDD Guard Stage 1 (require-test-edit-first).
//
// Pure evaluator tests: no executor, no DOM, no broadcasts. The guard reads
// tool history via state.phaseTools(phaseId) — we construct a minimal
// in-memory state stub to drive each scenario.

const test = require("node:test");
const assert = require("node:assert/strict");
const { TddGuard } = require("../../executor/tdd-guard");

function stateWith(phaseId, tools) {
  return {
    phaseTools(id) {
      return id === phaseId ? tools.slice() : [];
    },
  };
}

function phaseD(overrides = {}) {
  return {
    id: "D",
    tddGuard: {
      stage: "edit-first",
      srcPattern: "^src/.*\\.js$",
      testPattern: "^tests/.*\\.test\\.js$",
      message: "test-first required",
      ...overrides,
    },
  };
}

test("phase without tddGuard → always allow", () => {
  const g = new TddGuard(stateWith("D", []));
  assert.equal(g.evaluate({ id: "D" }, "Edit", { file_path: "src/anything.js" }).allow, true);
});

test("stage !== 'edit-first' → bypass (Stage 2+ not implemented)", () => {
  const g = new TddGuard(stateWith("D", []));
  const phase = phaseD({ stage: "failing-proof" });
  assert.equal(g.evaluate(phase, "Edit", { file_path: "src/a.js" }).allow, true);
});

test("Read / Glob / Grep / Bash → always allow (guard is Edit/Write only)", () => {
  const g = new TddGuard(stateWith("D", []));
  const p = phaseD();
  for (const t of ["Read", "Glob", "Grep", "Bash", "WebFetch", "TodoWrite"]) {
    assert.equal(g.evaluate(p, t, { file_path: "src/a.js" }).allow, true,
      `tool ${t} should bypass the guard`);
  }
});

test("Edit on a test file → allow (tests are always editable)", () => {
  const g = new TddGuard(stateWith("D", []));
  const v = g.evaluate(phaseD(), "Edit", { file_path: "tests/a.test.js" });
  assert.equal(v.allow, true);
});

test("Edit on a non-src non-test file (docs/config) → allow (out of scope)", () => {
  const g = new TddGuard(stateWith("D", []));
  const v = g.evaluate(phaseD(), "Edit", { file_path: "README.md" });
  assert.equal(v.allow, true);
});

test("Edit src with NO prior test edit in phase → block with custom message", () => {
  const g = new TddGuard(stateWith("D", []));
  const v = g.evaluate(phaseD(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /test-first required/);
});

test("Edit src AFTER a test Edit in the same phase → allow", () => {
  const g = new TddGuard(
    stateWith("D", [
      { tool: "Edit", filePath: "tests/a.test.js" },
    ])
  );
  const v = g.evaluate(phaseD(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, true);
});

test("Edit src with only a test Read (not edit) in phase → still block", () => {
  const g = new TddGuard(
    stateWith("D", [
      { tool: "Read", filePath: "tests/a.test.js" },   // Read, not Edit
    ])
  );
  const v = g.evaluate(phaseD(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("Edit src after an unrelated phase's test edit → still block (scope is per-phase)", () => {
  const g = new TddGuard(
    stateWith("B", [
      { tool: "Edit", filePath: "tests/a.test.js" },   // phase B, not D
    ])
  );
  const v = g.evaluate(phaseD(), "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("Write src with prior Write on test → allow (Write counts same as Edit)", () => {
  const g = new TddGuard(
    stateWith("D", [
      { tool: "Write", filePath: "tests/a.test.js" },
    ])
  );
  const v = g.evaluate(phaseD(), "Write", { file_path: "src/a.js" });
  assert.equal(v.allow, true);
});

test("Invalid srcPattern regex → fail CLOSED with descriptive reason", () => {
  const g = new TddGuard(stateWith("D", []));
  const p = phaseD({ srcPattern: "[unclosed-class", testPattern: "^tests/" });
  const v = g.evaluate(p, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /정규식 오류/);
});

test("Invalid testPattern regex → fail CLOSED", () => {
  const g = new TddGuard(stateWith("D", []));
  const p = phaseD({ srcPattern: "^src/", testPattern: "[bogus" });
  const v = g.evaluate(p, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
});

test("No file_path in input → allow (can't evaluate, fail open for unknown tools)", () => {
  const g = new TddGuard(stateWith("D", []));
  const v = g.evaluate(phaseD(), "Edit", {});
  assert.equal(v.allow, true);
});

test("Default message kicks in when rule.message is omitted", () => {
  const g = new TddGuard(stateWith("D", []));
  const p = phaseD();
  delete p.tddGuard.message;
  const v = g.evaluate(p, "Edit", { file_path: "src/a.js" });
  assert.equal(v.allow, false);
  assert.match(v.reason, /\[TDD Guard\]/);
});

test("Accepts both file_path and filePath and path in input", () => {
  const g = new TddGuard(stateWith("D", []));
  const p = phaseD();
  assert.equal(g.evaluate(p, "Edit", { filePath: "src/a.js" }).allow, false);
  assert.equal(g.evaluate(p, "Edit", { path: "src/a.js" }).allow, false);
});
