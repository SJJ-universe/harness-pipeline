// Slice S2 (Phase 3-S, 2026-04-27) — validateCodexTrigger triggerId guard.
//
// Background: src/routes/codexRoutes.js:54 interpolates triggerId into a
// filename inside CODEX_TRIGGER_DIR:
//
//   path.join(CODEX_TRIGGER_DIR, `codex-trigger-${triggerId}-${ts}.md`)
//
// Before this slice the only validation was `optionalString(..., 128)` —
// which let strings like "../../../etc/passwd" or "..\\..\\Windows\\Temp"
// flow into the filename and escape the sandbox via path.join semantics.
// This test locks down the slug-only regex contract so a future refactor
// cannot quietly relax it.

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCodexTrigger } = require("../../src/security/requestSchemas");

// ── happy path ──────────────────────────────────────────────────────────

test("validateCodexTrigger accepts plain alphanumeric ids", () => {
  const r = validateCodexTrigger({ triggerId: "phaseC", userInput: "ok" });
  assert.equal(r.triggerId, "phaseC");
  assert.equal(r.userInput, "ok");
});

test("validateCodexTrigger accepts hyphen / dot / underscore", () => {
  for (const id of ["phase-c", "phase.c", "phase_c", "abc-1.2_3"]) {
    const r = validateCodexTrigger({ triggerId: id });
    assert.equal(r.triggerId, id);
  }
});

test("validateCodexTrigger defaults userInput to empty string", () => {
  const r = validateCodexTrigger({ triggerId: "x" });
  assert.equal(r.userInput, "");
});

// ── traversal / path-significant chars ─────────────────────────────────

const TRAVERSAL_CASES = [
  "../escape",
  "..\\escape",
  "../../etc/passwd",
  "..\\..\\Windows\\Temp",
  "phase/c",
  "phase\\c",
  "phase\x00null",
  "phase\nnewline",
  "phase'quote",
  "phase\"dquote",
  "phase`backtick",
  "phase|pipe",
  "phase&amp",
  "phase;semi",
  "phase$var",
];

for (const id of TRAVERSAL_CASES) {
  test(`validateCodexTrigger rejects path-significant id: ${JSON.stringify(id)}`, () => {
    assert.throws(
      () => validateCodexTrigger({ triggerId: id }),
      /triggerId must match.*no path separators/
    );
  });
}

// ── empty / missing ─────────────────────────────────────────────────────

test("validateCodexTrigger rejects missing triggerId", () => {
  assert.throws(
    () => validateCodexTrigger({}),
    /triggerId is required/
  );
});

test("validateCodexTrigger rejects empty triggerId", () => {
  assert.throws(
    () => validateCodexTrigger({ triggerId: "" }),
    /triggerId is required/
  );
});

// ── 128-char ceiling preserved ──────────────────────────────────────────

test("validateCodexTrigger keeps the existing 128-char length cap", () => {
  const long = "a".repeat(129);
  assert.throws(() => validateCodexTrigger({ triggerId: long }), /triggerId/);
});

test("validateCodexTrigger accepts a 128-char alphanumeric id at the ceiling", () => {
  const id = "a".repeat(128);
  const r = validateCodexTrigger({ triggerId: id });
  assert.equal(r.triggerId, id);
});

// ── non-string / non-object body ────────────────────────────────────────

test("validateCodexTrigger rejects non-object body", () => {
  assert.throws(() => validateCodexTrigger(null));
  assert.throws(() => validateCodexTrigger("not-an-object"));
  assert.throws(() => validateCodexTrigger(42));
});

test("validateCodexTrigger rejects non-string triggerId (number, bool)", () => {
  assert.throws(() => validateCodexTrigger({ triggerId: 42 }));
  assert.throws(() => validateCodexTrigger({ triggerId: true }));
});
