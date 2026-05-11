// Slice S3-a (Phase 2 / SMART-3, 2026-05-04) — preset library unit tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const lib = require("../../src/runtime/presetLibrary");

test("presetLibrary: SCHEMA constant is orchestrator-review-preset/v1", () => {
  assert.equal(lib.SCHEMA, "orchestrator-review-preset/v1");
});

test("presetLibrary: ships exactly 6 frozen presets", () => {
  const list = lib.listPresets();
  assert.equal(list.length, 6, "expected 6 presets");
  assert.ok(Object.isFrozen(list), "list itself must be frozen");
  for (const p of list) {
    assert.ok(Object.isFrozen(p), `${p.presetId} must be frozen`);
  }
});

test("presetLibrary: PRESET_IDS is sorted + frozen", () => {
  const ids = lib.PRESET_IDS;
  assert.ok(Object.isFrozen(ids), "PRESET_IDS must be frozen");
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "PRESET_IDS must be sorted");
  // exact set
  assert.deepEqual(ids, [
    "accuracy",
    "performance",
    "privacy",
    "public-sector-audit",
    "release",
    "security",
  ]);
});

test("presetLibrary: getPreset returns frozen preset for known id", () => {
  const p = lib.getPreset("security");
  assert.ok(p, "security preset must exist");
  assert.equal(p.presetId, "security");
  assert.ok(Object.isFrozen(p), "preset must be frozen");
  assert.ok(p.codexSystemPrompt.length > 100, "codex prompt non-trivial");
  assert.ok(p.claudeSystemPrompt.length > 100, "claude prompt non-trivial");
  assert.ok(p.severityTagInstruction.length > 50, "severity instr non-trivial");
});

test("presetLibrary: getPreset returns undefined for unknown id", () => {
  assert.equal(lib.getPreset("does-not-exist"), undefined);
  assert.equal(lib.getPreset(""), undefined);
  assert.equal(lib.getPreset(null), undefined);
  assert.equal(lib.getPreset(undefined), undefined);
  assert.equal(lib.getPreset(123), undefined);
});

test("presetLibrary: isValidPresetId reports correct boolean", () => {
  assert.equal(lib.isValidPresetId("accuracy"), true);
  assert.equal(lib.isValidPresetId("public-sector-audit"), true);
  assert.equal(lib.isValidPresetId("does-not-exist"), false);
  assert.equal(lib.isValidPresetId(""), false);
  assert.equal(lib.isValidPresetId(null), false);
  assert.equal(lib.isValidPresetId(undefined), false);
  assert.equal(lib.isValidPresetId(0), false);
  // Valid id shape but unknown
  assert.equal(lib.isValidPresetId("style"), false);
});

test("presetLibrary: every preset has required + non-empty fields", () => {
  for (const p of lib.listPresets()) {
    assert.equal(typeof p.presetId, "string");
    assert.match(p.presetId, /^[a-z][a-z0-9-]*$/, `${p.presetId} kebab-case`);
    assert.ok(p.defaultLabel.length > 0, `${p.presetId} defaultLabel`);
    assert.ok(p.codexSystemPrompt.length > 0, `${p.presetId} codex prompt`);
    assert.ok(p.claudeSystemPrompt.length > 0, `${p.presetId} claude prompt`);
    assert.ok(p.severityTagInstruction.length > 0, `${p.presetId} severity`);
  }
});

test("presetLibrary: prompts respect length caps", () => {
  for (const p of lib.listPresets()) {
    assert.ok(
      p.codexSystemPrompt.length <= lib.MAX_SYSTEM_PROMPT_LENGTH,
      `${p.presetId} codex prompt too long (${p.codexSystemPrompt.length})`,
    );
    assert.ok(
      p.claudeSystemPrompt.length <= lib.MAX_SYSTEM_PROMPT_LENGTH,
      `${p.presetId} claude prompt too long`,
    );
    assert.ok(
      p.severityTagInstruction.length <= lib.MAX_SEVERITY_TAG_LENGTH,
      `${p.presetId} severity instruction too long`,
    );
  }
});

test("presetLibrary: severity instruction mentions all four tags", () => {
  for (const p of lib.listPresets()) {
    assert.ok(p.severityTagInstruction.includes("[critical]"), `${p.presetId} [critical]`);
    assert.ok(p.severityTagInstruction.includes("[high]"), `${p.presetId} [high]`);
    assert.ok(p.severityTagInstruction.includes("[medium]"), `${p.presetId} [medium]`);
    assert.ok(p.severityTagInstruction.includes("[low]"), `${p.presetId} [low]`);
  }
});

test("presetLibrary: each preset has unique presetId", () => {
  const seen = new Set();
  for (const p of lib.listPresets()) {
    assert.equal(seen.has(p.presetId), false, `${p.presetId} duplicate`);
    seen.add(p.presetId);
  }
  assert.equal(seen.size, 6);
});

test("presetLibrary: listPresetSummaries strips internal prompts", () => {
  const summaries = lib.listPresetSummaries();
  assert.equal(summaries.length, 6);
  for (const s of summaries) {
    assert.ok(typeof s.presetId === "string");
    assert.ok(typeof s.defaultLabel === "string");
    assert.ok(typeof s.defaultDescription === "string");
    // No system prompts in summary
    assert.equal(s.codexSystemPrompt, undefined);
    assert.equal(s.claudeSystemPrompt, undefined);
    assert.equal(s.severityTagInstruction, undefined);
  }
});

test("presetLibrary: PRESETS array is the same reference returned by listPresets", () => {
  // Sanity: the API exposes the frozen array; not a per-call copy.
  // (Callers asking for "summaries" get a freshly-mapped array.)
  assert.equal(lib.PRESETS, lib.listPresets());
});

test("presetLibrary: cannot mutate a returned preset (frozen guarantee)", () => {
  const p = lib.getPreset("accuracy");
  assert.ok(p);
  assert.throws(() => { p.defaultLabel = "tampered"; });
  assert.throws(() => { p.codexSystemPrompt = "evil"; });
});

test("presetLibrary: cannot push new preset onto PRESETS array", () => {
  assert.throws(() => { lib.PRESETS.push({ presetId: "evil" }); });
});

test("presetLibrary: each preset's codex prompt scopes 'Focus on:' framing", () => {
  for (const p of lib.listPresets()) {
    assert.ok(
      /focus on/i.test(p.codexSystemPrompt),
      `${p.presetId} codex prompt should frame "Focus on:"`,
    );
  }
});

test("presetLibrary: each preset's claude prompt scopes 'Apply ... fix' framing", () => {
  for (const p of lib.listPresets()) {
    assert.ok(
      /apply/i.test(p.claudeSystemPrompt) && /verify/i.test(p.claudeSystemPrompt),
      `${p.presetId} claude prompt should follow Apply...Verify pattern`,
    );
  }
});

test("presetLibrary: privacy preset references KRN (Korean public-sector signal)", () => {
  const p = lib.getPreset("privacy");
  assert.ok(p);
  assert.ok(
    p.codexSystemPrompt.includes("KRN") || p.codexSystemPrompt.includes("Korean"),
    "privacy preset should mention KRN/Korean PII context",
  );
});

test("presetLibrary: public-sector-audit preset frames fail-closed posture", () => {
  const p = lib.getPreset("public-sector-audit");
  assert.ok(p);
  assert.ok(
    /fail-?closed/i.test(p.codexSystemPrompt) || /zero tolerance/i.test(p.codexSystemPrompt),
    "public-sector-audit should declare fail-closed posture",
  );
});

test("presetLibrary: release preset references signed manifest + audit verbs", () => {
  const p = lib.getPreset("release");
  assert.ok(p);
  assert.ok(
    /signed/i.test(p.codexSystemPrompt) && /audit/i.test(p.codexSystemPrompt),
    "release preset should cover signing + audit",
  );
});

test("presetLibrary: security preset enumerates injection vectors", () => {
  const p = lib.getPreset("security");
  assert.ok(p);
  assert.ok(
    /injection/i.test(p.codexSystemPrompt),
    "security preset should call out injection vectors",
  );
});

test("presetLibrary: performance preset references N+1 / memory leaks", () => {
  const p = lib.getPreset("performance");
  assert.ok(p);
  assert.ok(
    /N\+1|memory leak/i.test(p.codexSystemPrompt),
    "performance preset should cover N+1 / memory leaks",
  );
});

test("presetLibrary: accuracy preset references off-by-one / edge cases", () => {
  const p = lib.getPreset("accuracy");
  assert.ok(p);
  assert.ok(
    /off-by-one|edge case/i.test(p.codexSystemPrompt),
    "accuracy preset should cover edge cases",
  );
});
