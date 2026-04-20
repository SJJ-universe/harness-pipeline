// Slice E (v4) — validateTemplateUpload strict-shape regression.
//
// The validator is hand-rolled (no ajv dep) and mirrors
// src/templates/pipelineTemplate.schema.json. Every accept/reject rule here
// tracks a real upload-level attack surface:
//   - built-in id reservation       → anti-overwrite
//   - phase id regex + duplicates   → UI/runtime determinism
//   - cross-phase linkedCycle ref   → prevent dangling cycle targets
//   - exit criterion type enum      → refuse silent-pass criteria
//   - size cap                      → DoS guard
//
// If this file regresses, the upload surface is no longer the JSON Schema.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateTemplateUpload,
  validateTemplateId,
  CUSTOM_TEMPLATE_ID_RE,
  MAX_TEMPLATE_JSON_BYTES,
} = require("../../src/security/requestSchemas");

function validTemplate(overrides = {}) {
  return {
    id: "custom-experiment",
    name: "테스트 커스텀",
    phases: [
      {
        id: "A",
        name: "분석",
        agent: "claude",
        allowedTools: ["Read", "Grep"],
        exitCriteria: [{ type: "min-tools-in-phase", count: 2 }],
      },
      {
        id: "B",
        name: "수정",
        agent: "claude",
        allowedTools: ["Edit", "Write"],
      },
    ],
    ...overrides,
  };
}

test("accepts a minimal valid template", () => {
  const out = validateTemplateUpload(validTemplate());
  assert.equal(out.id, "custom-experiment");
  assert.equal(out.phases.length, 2);
});

test("rejects built-in ids (default, code-review, testing)", () => {
  for (const id of ["default", "code-review", "testing"]) {
    assert.throws(() => validateTemplateUpload(validTemplate({ id })),
      /^Error: template\.id must match/);
  }
});

test("rejects ids without the custom- prefix", () => {
  for (const id of ["myplan", "custom_bad_underscore_prefix", "Custom-UpperCase", "custom-WITH-UPPER"]) {
    assert.throws(() => validateTemplateUpload(validTemplate({ id })),
      /^Error: template\.id must match/);
  }
});

test("rejects extra top-level properties", () => {
  assert.throws(
    () => validateTemplateUpload({ ...validTemplate(), extra: "disallowed" }),
    /has unknown property/
  );
});

test("rejects duplicate phase ids", () => {
  const bad = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "claude" },
      { id: "A", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /duplicate/);
});

test("rejects linkedCycle pointing at non-existent phase", () => {
  const bad = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "claude" },
      { id: "B", name: "b", agent: "codex", cycle: true, linkedCycle: "Z" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /does not reference/);
});

test("accepts linkedCycle pointing at an existing phase", () => {
  const ok = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "claude" },
      { id: "B", name: "b", agent: "codex", cycle: true, maxIterations: 3, linkedCycle: "A" },
    ],
  });
  const out = validateTemplateUpload(ok);
  assert.equal(out.phases[1].linkedCycle, "A");
});

test("rejects unknown exit criterion types (no silent pass)", () => {
  const bad = validTemplate({
    phases: [
      {
        id: "A", name: "a", agent: "claude",
        exitCriteria: [{ type: "nonsense-criterion" }],
      },
      { id: "B", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /must be one of/);
});

test("files-edited criterion validates min + pathMatch regex compiles", () => {
  const good = validateTemplateUpload(validTemplate({
    phases: [
      {
        id: "A", name: "a", agent: "claude",
        exitCriteria: [{
          type: "files-edited", min: 2, scope: "phase",
          pathMatch: "\\.test\\.js$",
        }],
      },
      { id: "B", name: "b", agent: "claude" },
    ],
  }));
  assert.ok(good);

  const badRegex = validTemplate({
    phases: [
      {
        id: "A", name: "a", agent: "claude",
        exitCriteria: [{ type: "files-edited", min: 1, pathMatch: "([unclosed" }],
      },
      { id: "B", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(badRegex), /not a valid regex/);
});

test("allowedTools must come from the whitelist", () => {
  const bad = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "claude", allowedTools: ["Read", "SuperDangerousTool"] },
      { id: "B", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /unsupported tool/);
});

test("agent must be claude or codex", () => {
  const bad = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "martian" },
      { id: "B", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /must be one of/);
});

test("phases is capped at 20 items", () => {
  const many = Array.from({ length: 21 }, (_, i) => ({
    id: `P${i + 10}`,   // P10..P30 — valid phase ids
    name: `phase ${i}`,
    agent: "claude",
  }));
  assert.throws(() => validateTemplateUpload(validTemplate({ phases: many })),
    /1–20 items/);
});

test("maxIterations is bounded (anti-runaway)", () => {
  const bad = validTemplate({
    phases: [
      { id: "A", name: "a", agent: "codex", cycle: true, maxIterations: 1000 },
      { id: "B", name: "b", agent: "claude" },
    ],
  });
  assert.throws(() => validateTemplateUpload(bad), /maxIterations/);
});

test("rejects templates larger than MAX_TEMPLATE_JSON_BYTES", () => {
  const bloated = validTemplate({
    name: "A".repeat(Math.min(80, MAX_TEMPLATE_JSON_BYTES)),
    phases: Array.from({ length: 20 }, (_, i) => ({
      id: `P${i + 10}`,
      name: "phase " + i,
      agent: "claude",
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent",
                     "TodoWrite", "WebSearch", "WebFetch"],
      exitCriteria: Array.from({ length: 10 }, (_, j) => ({
        type: "files-edited",
        min: 1,
        scope: "phase",
        pathMatch: "\\.something-that-is-very-long-and-padded-" + "X".repeat(150),
        message: "M".repeat(200),
      })),
    })),
  });
  // Pre-check: we've constructed something over the cap.
  assert.ok(JSON.stringify(bloated).length > MAX_TEMPLATE_JSON_BYTES);
  assert.throws(() => validateTemplateUpload(bloated), /exceeds .* bytes/);
});

test("built-in templates would pass the validator structurally (id stripped)", () => {
  // If we were given the real built-in shapes WITH a legal custom id,
  // they must still validate. This protects us from schema drift that
  // would make it impossible to round-trip templates through the editor.
  const builtins = require("../../pipeline-templates.json");
  for (const [origId, template] of Object.entries(builtins)) {
    const cloned = JSON.parse(JSON.stringify(template));
    cloned.id = "custom-" + origId.replace(/[^a-z0-9_-]/g, "-");
    // Some built-ins have agent-less phases (e.g. testing pre-Slice-B),
    // but the testing template is now fully-specified.
    const ok = validateTemplateUpload(cloned);
    assert.ok(ok.phases.length >= 1, `built-in ${origId} collapsed`);
  }
});

test("CUSTOM_TEMPLATE_ID_RE exports the actual regex", () => {
  assert.ok(CUSTOM_TEMPLATE_ID_RE instanceof RegExp);
  assert.ok(CUSTOM_TEMPLATE_ID_RE.test("custom-ok"));
  assert.ok(!CUSTOM_TEMPLATE_ID_RE.test("default"));
});

test("validateTemplateId is the thin id-only guard used by DELETE", () => {
  assert.equal(validateTemplateId("custom-ok"), "custom-ok");
  assert.throws(() => validateTemplateId("default"), /must match/);
  assert.throws(() => validateTemplateId(""), /must match/);
});
