// Slice I (v5) — locale coverage gate.
//
// Enforces that ko.js and en.js export the EXACT same key set. Drift between
// locales silently falls back to ko at runtime; this test fails loud so
// untranslated strings can't ship unnoticed.

const test = require("node:test");
const assert = require("node:assert/strict");
const ko = require("../../public/js/i18n/ko");
const en = require("../../public/js/i18n/en");

function keySet(table) {
  return new Set(Object.keys(table));
}

test("ko and en export plain objects", () => {
  assert.equal(typeof ko, "object");
  assert.equal(typeof en, "object");
  assert.ok(!Array.isArray(ko));
  assert.ok(!Array.isArray(en));
});

test("ko and en have the exact same set of keys (no silent drift)", () => {
  const koKeys = keySet(ko);
  const enKeys = keySet(en);

  const missingInEn = Array.from(koKeys).filter((k) => !enKeys.has(k));
  const missingInKo = Array.from(enKeys).filter((k) => !koKeys.has(k));

  assert.deepEqual(
    missingInEn,
    [],
    `keys present in ko but missing in en (translate & add):\n  ${missingInEn.join("\n  ")}`
  );
  assert.deepEqual(
    missingInKo,
    [],
    `keys present in en but missing in ko (add source values):\n  ${missingInKo.join("\n  ")}`
  );
});

test("every key has a non-empty string value in both locales", () => {
  for (const [key, value] of Object.entries(ko)) {
    assert.equal(typeof value, "string", `ko.${key} must be a string`);
    assert.ok(value.length > 0, `ko.${key} must be non-empty`);
  }
  for (const [key, value] of Object.entries(en)) {
    assert.equal(typeof value, "string", `en.${key} must be a string`);
    assert.ok(value.length > 0, `en.${key} must be non-empty`);
  }
});

test("coverage is large enough to be meaningful (≥40 keys)", () => {
  const n = Object.keys(ko).length;
  assert.ok(n >= 40, `expected ≥40 keys, got ${n} — did the table get truncated?`);
});
