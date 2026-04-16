const assert = require("node:assert/strict");
const test = require("node:test");
const {
  validateContextLoad,
  validateEvent,
  validateGeneralRun,
  validateHook,
} = require("../../src/security/requestSchemas");

test("validateEvent accepts only allowlisted event types", () => {
  assert.equal(validateEvent({ type: "phase_update", data: { phase: "A" } }).type, "phase_update");
  assert.throws(() => validateEvent({ type: "script_injection", data: {} }), /not allowed/);
});

test("validateContextLoad requires filePath", () => {
  assert.equal(validateContextLoad({ filePath: "README.md" }).filePath, "README.md");
  assert.throws(() => validateContextLoad({}), /Missing filePath/);
});

test("validateGeneralRun clamps maxIterations", () => {
  const result = validateGeneralRun({ task: "build a harness", maxIterations: 99 });
  assert.equal(result.maxIterations, 5);
});

test("validateHook rejects unknown hook events", () => {
  assert.equal(validateHook({ event: "pre-tool", payload: {} }).event, "pre-tool");
  assert.throws(() => validateHook({ event: "unknown", payload: {} }), /not allowed/);
});
