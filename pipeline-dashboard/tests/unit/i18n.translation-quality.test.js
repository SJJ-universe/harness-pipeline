// Slice I18N-PARITY-2-a (Phase 2 v2 follow-up, 2026-05-05) —
// translation-quality gate.
//
// I18N-PARITY-1-a closed the silent-translation-loss class for
// `{placeholder}` drift. This round closes the SECOND class:
// **forgotten translations** — keys where the ko table has been
// accidentally overwritten with the en value (or vice versa).
//
// Real-world drift scenario:
//   ko["x"] = "안녕"
//   en["x"] = "Hello"
// Bug: someone copies en into ko, leaves en alone.
//   ko["x"] = "Hello"     ← lost the Korean translation
//   en["x"] = "Hello"
// Existing tests pass: key sets match, both non-empty,
// placeholders match (no placeholders here), 80% threshold
// (only ONE key got corrupted, ratio still well above 80%).
// Operators on Korean see "Hello" everywhere instead of "안녕".
//
// I18N-PARITY-2-a closes this with two complementary rules:
//   1. If ko[K] !== en[K], ko[K] must contain at least one
//      Hangul character (proves Korean was applied).
//   2. If ko[K] !== en[K], en[K] must contain at least one
//      Latin letter (proves English was applied).
//
// The "if ko === en" carve-out tolerates proper nouns ("Codex"),
// product terms ("일반사용자"), URLs, and schema strings — these
// legitimately have the same text in both locales.
//
// At authoring time both rules pass with zero violations
// (verified across 221 keys), confirming the existing translation
// table is healthy AND establishing a baseline for future adds.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ko = require("../../public/js/i18n/ko");
const en = require("../../public/js/i18n/en");

// Hangul detection: the precomposed-syllable block (가–힣). This is
// the dominant range for everyday Korean text. We don't need to
// catch Jamo (ㄱ–ㅎ, ㅏ–ㅣ) because translation values use
// composed syllables; isolated Jamo would be a separate signal.
const HANGUL_RE = /[가-힣]/;

// Latin letter detection: a-z + A-Z. We do NOT match Latin-1
// punctuation or extended Latin (é, ü) — the orchestrator's English
// values are vanilla ASCII letters. If en[K] has zero ASCII
// letters, it's either symbols-only (suspicious) or Korean (bug).
const LATIN_RE = /[A-Za-z]/;

// Hangul-character density (Hangul chars / total chars). Used by
// the differential test.
function hangulRatio(s) {
  if (typeof s !== "string" || s.length === 0) return 0;
  let count = 0;
  for (const ch of s) {
    if (ch >= "가" && ch <= "힣") count++;
  }
  return count / s.length;
}

// Latin-letter density (Latin chars / total chars).
function latinRatio(s) {
  if (typeof s !== "string" || s.length === 0) return 0;
  const matches = s.match(/[A-Za-z]/g);
  return (matches ? matches.length : 0) / s.length;
}

// ── Headline rules ────────────────────────────────────────────

test("I18N-PARITY-2-a: every translated ko value contains at least one Hangul char", () => {
  // Rule: if ko !== en, ko has Hangul.
  // The ko === en carve-out tolerates legitimate cases
  // (proper nouns / product terms / URLs / schema strings).
  const violations = [];
  for (const key of Object.keys(ko)) {
    const koValue = ko[key];
    const enValue = en[key];
    if (koValue === enValue) continue;       // proper-noun carve-out
    if (HANGUL_RE.test(koValue)) continue;    // has Hangul ✓
    violations.push({
      key,
      ko: koValue,
      en: enValue,
      hint: "ko differs from en but has no Hangul — likely an untranslated entry",
    });
  }
  if (violations.length > 0) {
    const lines = violations.map((v) =>
      `  - "${v.key}": ko=${JSON.stringify(v.ko)} en=${JSON.stringify(v.en)}\n` +
      `    ${v.hint}`);
    assert.fail(
      `${violations.length} ko entry(ies) appear to be untranslated ` +
      `(differ from en but contain no Hangul):\n${lines.join("\n")}`,
    );
  }
});

test("I18N-PARITY-2-a: every translated en value contains at least one Latin letter", () => {
  // Inverse rule: if ko !== en, en has at least one Latin letter.
  // Catches the bug where en got overwritten with ko's value.
  const violations = [];
  for (const key of Object.keys(ko)) {
    const koValue = ko[key];
    const enValue = en[key];
    if (koValue === enValue) continue;
    if (LATIN_RE.test(enValue)) continue;     // has Latin letter ✓
    violations.push({
      key,
      ko: koValue,
      en: enValue,
      hint: "en differs from ko but has no Latin letter — likely overwritten with ko",
    });
  }
  if (violations.length > 0) {
    const lines = violations.map((v) =>
      `  - "${v.key}": ko=${JSON.stringify(v.ko)} en=${JSON.stringify(v.en)}\n` +
      `    ${v.hint}`);
    assert.fail(
      `${violations.length} en entry(ies) appear to be untranslated ` +
      `(differ from ko but contain no Latin letters):\n${lines.join("\n")}`,
    );
  }
});

// ── Differential test: when both differ, ko should be "more Korean" ──

test("I18N-PARITY-2-a: when ko !== en, hangulRatio(ko) > hangulRatio(en)", () => {
  // This catches a more subtle bug: ko["x"] and en["x"] both got
  // accidentally set to similar-looking pseudo-Korean text. The
  // strict per-locale tests above might pass (technically Hangul
  // present), but the differential should fail because ko is
  // supposed to be "more Korean" than en.
  //
  // Carve-out: if ko === en, skip. Same for both having identical
  // hangul ratios (e.g., both have a Korean product name embedded
  // in otherwise English prose).
  //
  // We use strict > (not >=) — equal ratios on different values
  // is suspicious (text differs but Korean-density is identical?).
  // For a real translation, ko should be Korean-dominant and en
  // should be Latin-dominant; these ratios diverge naturally.
  const violations = [];
  for (const key of Object.keys(ko)) {
    const koValue = ko[key];
    const enValue = en[key];
    if (koValue === enValue) continue;
    const koHangul = hangulRatio(koValue);
    const enHangul = hangulRatio(enValue);
    if (koHangul > enHangul) continue;        // ko is more Korean ✓
    violations.push({
      key, ko: koValue, en: enValue,
      koHangulRatio: koHangul.toFixed(2),
      enHangulRatio: enHangul.toFixed(2),
    });
  }
  if (violations.length > 0) {
    const lines = violations.map((v) =>
      `  - "${v.key}": koHangulRatio=${v.koHangulRatio} ` +
      `enHangulRatio=${v.enHangulRatio} ` +
      `ko=${JSON.stringify(v.ko)} en=${JSON.stringify(v.en)}`);
    assert.fail(
      `${violations.length} key(s) where ko is NOT more Korean than en ` +
      `(suspicious — when values differ, ko should be Korean-dominant):\n` +
      lines.join("\n"),
    );
  }
});

// ── Defensive checks ─────────────────────────────────────────

test("I18N-PARITY-2-a: no value contains TODO/FIXME/XXX placeholder markers", () => {
  // Catches translator placeholders that escaped into the table.
  // "(TODO: translate)" or "TBD" survives to production otherwise.
  const TODO_RE = /\b(TODO|FIXME|XXX|TBD|TKTK)\b/i;
  const violations = [];
  for (const [locale, table] of [["ko", ko], ["en", en]]) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string") continue;
      if (TODO_RE.test(value)) {
        violations.push(`${locale}["${key}"] = ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(violations, [],
    "found TODO/FIXME/XXX/TBD/TKTK markers in i18n values — finish translating");
});

test("I18N-PARITY-2-a: no value contains HTML tags (UI handles escaping)", () => {
  // The orchestrator UI escapes text content; raw HTML in values would
  // either render as literal "<script>" (harmless but ugly) or
  // be a security risk if any panel inadvertently uses innerHTML.
  // This test enforces "i18n values are plain text".
  const HTML_RE = /<[a-zA-Z][a-zA-Z0-9]*[^>]*>/;
  const violations = [];
  for (const [locale, table] of [["ko", ko], ["en", en]]) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string") continue;
      if (HTML_RE.test(value)) {
        violations.push(`${locale}["${key}"] = ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(violations, [],
    "found HTML-like tags in i18n values — use plain text + let panels build DOM");
});

test("I18N-PARITY-2-a: ko values without any letter at all are suspicious", () => {
  // A value with neither Hangul nor Latin letters is symbols-only
  // (e.g. just "→" or "▶"). These exist as shorthand in the
  // orchestrator but are rare. We don't outright fail — we count and
  // report, with a sensible cap.
  let symbolOnly = 0;
  const examples = [];
  for (const [key, value] of Object.entries(ko)) {
    if (typeof value !== "string") continue;
    if (HANGUL_RE.test(value)) continue;
    if (LATIN_RE.test(value)) continue;
    symbolOnly++;
    if (examples.length < 5) examples.push(`${key}: ${JSON.stringify(value)}`);
  }
  // Expect symbol-only entries to be a small minority (≤ 10 keys).
  // If a future change pushes this above 10, something is using
  // i18n keys as symbol storage — likely a misuse.
  assert.ok(symbolOnly <= 10,
    `${symbolOnly} ko entry(ies) are symbols-only (no Hangul + no Latin) — ` +
    `expected ≤ 10. Examples:\n  ${examples.join("\n  ")}`);
});

// ── Helper anchor tests ──────────────────────────────────────

test("I18N-PARITY-2-a: anchor — hangulRatio computes correctly", () => {
  assert.equal(hangulRatio(""), 0);
  assert.equal(hangulRatio("Hello"), 0, "all Latin → 0");
  assert.equal(hangulRatio("안녕"), 1, "all Hangul → 1");
  // Mixed: "안녕 hello" = 7 chars total, 2 Hangul → 2/7
  assert.ok(Math.abs(hangulRatio("안녕 hello") - 2/8) < 0.01,
    "mixed Korean+English correctly weighted");
  // Symbols don't count as Hangul
  assert.equal(hangulRatio("▶ ✓ ★"), 0);
  // Numbers don't count as Hangul
  assert.equal(hangulRatio("1234"), 0);
});

test("I18N-PARITY-2-a: anchor — latinRatio computes correctly", () => {
  assert.equal(latinRatio(""), 0);
  assert.equal(latinRatio("안녕"), 0, "all Hangul → 0");
  assert.equal(latinRatio("Hello"), 1, "all Latin → 1");
  // Mixed: "Hello 안녕" = 8 chars total, 5 Latin → 5/8
  assert.ok(Math.abs(latinRatio("Hello 안녕") - 5/8) < 0.01,
    "mixed Latin+Korean correctly weighted");
  // Symbols don't count as Latin
  assert.equal(latinRatio("▶ ✓ ★"), 0);
  // Numbers don't count as Latin
  assert.equal(latinRatio("1234"), 0);
});

test("I18N-PARITY-2-a: anchor — HANGUL_RE matches everyday Korean text", () => {
  assert.match("안녕하세요", HANGUL_RE);
  assert.match("오케스트레이터", HANGUL_RE);
  assert.match("일반사용자", HANGUL_RE);
  // Mixed: should still match if ANY Hangul present
  assert.match("Codex 검증", HANGUL_RE);
  // Pure Latin should NOT match
  assert.doesNotMatch("Hello world", HANGUL_RE);
  // Symbols should NOT match
  assert.doesNotMatch("▶ ✓", HANGUL_RE);
});

test("I18N-PARITY-2-a: anchor — LATIN_RE matches A-Za-z but not Hangul", () => {
  assert.match("Hello", LATIN_RE);
  assert.match("a", LATIN_RE);
  assert.match("Z", LATIN_RE);
  // Mixed: matches if ANY Latin present
  assert.match("안녕 H", LATIN_RE);
  // Pure Hangul should NOT match
  assert.doesNotMatch("안녕하세요", LATIN_RE);
  // Numbers + symbols should NOT match
  assert.doesNotMatch("1234", LATIN_RE);
  assert.doesNotMatch("▶ ✓", LATIN_RE);
});

// ── Sanity: differential test makes sense ────────────────────

test("I18N-PARITY-2-a: differential test rejects synthetic 'ko less Korean than en' bug", () => {
  // Synthetic test of the differential rule itself.
  const fakeKo = { "x": "Hello world", "y": "안녕" };
  const fakeEn = { "x": "안녕 hello", "y": "Hello" };
  // Key "x": fakeKo has 0 Hangul / 11 chars = 0.0; fakeEn has 2/8 = 0.25
  // → differential test FAILS because ko isn't more Korean.
  // Key "y": fakeKo has 2/2 = 1.0; fakeEn has 0/5 = 0.0 → ko more Korean ✓
  const violations = [];
  for (const key of Object.keys(fakeKo)) {
    if (fakeKo[key] === fakeEn[key]) continue;
    if (hangulRatio(fakeKo[key]) > hangulRatio(fakeEn[key])) continue;
    violations.push(key);
  }
  assert.deepEqual(violations, ["x"],
    "differential rule correctly identifies the inverted entry");
});
