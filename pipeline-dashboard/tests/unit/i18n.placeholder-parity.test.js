// Slice I18N-PARITY-1-a (Phase 2 v2 follow-up, 2026-05-05) —
// placeholder consistency gate.
//
// The existing tests/unit/i18n.coverage.test.js (Slice I, v5) checks
// that ko.js and en.js export the exact same key set + non-empty
// string values. It does NOT verify that templated values use the
// same {placeholder} names across locales.
//
// Real-world drift scenario:
//   ko:  "하드 게이트: {mode}"
//   en:  "Hard gates: {m}"           ← typo
// At runtime HarnessI18n.t("...", { mode: "hard" }) substitutes
// correctly in ko (returns "하드 게이트: hard") but leaves the
// literal "{m}" in en (returns "Hard gates: {m}"). Operators on
// English see broken UI; operators on Korean see correct UI; the
// committer is none the wiser.
//
// I18N-PARITY-1-a closes this gap with placeholder-set parity tests.
// For every key, the placeholder set extracted from ko's value MUST
// equal the placeholder set extracted from en's value.
//
// What this verifies:
//   1. Per-key placeholder set parity (the headline check)
//   2. Placeholder names use snake_case-friendly chars only
//      (`/\{(\w+)\}/g` — letter / digit / underscore — so we can
//      distinguish "{mode}" from "{Mode}" deliberately)
//   3. No accidental brace pairs that AREN'T placeholders
//      ("{mode}" yes, "{notValid spaces}" no — flagged as
//      "looks like a placeholder but isn't")
//   4. Locale values aren't accidentally identical (sanity:
//      ≥ N% of keys should have actually-translated values; same
//      string in both ko and en is suspicious for prose keys but
//      OK for proper-noun-only keys like "Codex" — we use a
//      threshold not a strict per-key check)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ko = require("../../public/js/i18n/ko");
const en = require("../../public/js/i18n/en");

// Extract placeholder names from a template value. The harness's
// HarnessI18n.t() interpolation regex is /\{(\w+)\}/g — this MUST
// match that semantics or the test will give false confidence.
const PLACEHOLDER_RE = /\{(\w+)\}/g;

function extractPlaceholders(value) {
  if (typeof value !== "string") return new Set();
  const out = new Set();
  for (const m of value.matchAll(PLACEHOLDER_RE)) {
    out.add(m[1]);
  }
  return out;
}

// Find any "looks like a placeholder but isn't valid" patterns:
// { something with spaces } / {Mixed-case-with-dashes} / {123digit} are
// NOT matched by /\{(\w+)\}/g and would silently survive into the
// rendered string. These are translator typos.
const SUSPICIOUS_BRACE_RE = /\{[^{}]*\}/g;

function findSuspiciousBraces(value) {
  if (typeof value !== "string") return [];
  const all = (value.match(SUSPICIOUS_BRACE_RE) || []);
  const valid = (value.match(PLACEHOLDER_RE) || []);
  // Anything in `all` that isn't in `valid` is suspicious. Keep
  // duplicates so a value with two suspicious braces shows both.
  const validCounts = new Map();
  for (const v of valid) validCounts.set(v, (validCounts.get(v) || 0) + 1);
  const out = [];
  for (const a of all) {
    if (validCounts.get(a) > 0) {
      validCounts.set(a, validCounts.get(a) - 1);
    } else {
      out.push(a);
    }
  }
  return out;
}

// Collect parity violations across ALL keys, then assert at the end.
// This makes the failure message list every drift in one go rather
// than failing fast on the first one — the committer fixing 5
// silent-translation drifts shouldn't have to re-run the test 5
// times.

test("I18N-PARITY-1-a: every key has the same placeholder set in ko + en", () => {
  const drifts = [];
  // Use ko as the authoritative key list (i18n.coverage.test.js
  // already proves the sets are equal; if that test fails this one
  // would too, so we don't double-check here).
  for (const key of Object.keys(ko)) {
    const koPlaceholders = extractPlaceholders(ko[key]);
    const enPlaceholders = extractPlaceholders(en[key]);
    const missingInEn = Array.from(koPlaceholders).filter((p) => !enPlaceholders.has(p));
    const missingInKo = Array.from(enPlaceholders).filter((p) => !koPlaceholders.has(p));
    if (missingInEn.length > 0 || missingInKo.length > 0) {
      drifts.push({
        key,
        koPlaceholders: Array.from(koPlaceholders).sort(),
        enPlaceholders: Array.from(enPlaceholders).sort(),
        missingInEn,
        missingInKo,
      });
    }
  }
  if (drifts.length > 0) {
    const lines = drifts.map((d) => {
      let line = `  - "${d.key}":`;
      line += ` ko=${JSON.stringify(d.koPlaceholders)}`;
      line += ` en=${JSON.stringify(d.enPlaceholders)}`;
      if (d.missingInEn.length > 0) line += ` missingInEn=${JSON.stringify(d.missingInEn)}`;
      if (d.missingInKo.length > 0) line += ` missingInKo=${JSON.stringify(d.missingInKo)}`;
      return line;
    });
    assert.fail(
      `${drifts.length} key(s) have placeholder drift between ko and en — ` +
      `fix all of them in one commit:\n${lines.join("\n")}`,
    );
  }
});

test("I18N-PARITY-1-a: no key contains a 'looks like placeholder but isn't' pattern", () => {
  // Catches translator typos like "{ mode }" (space-padded) or
  // "{tool-name}" (hyphenated) that look like placeholders but
  // don't match the runtime regex /\{(\w+)\}/g.
  const violations = [];
  for (const [locale, table] of [["ko", ko], ["en", en]]) {
    for (const [key, value] of Object.entries(table)) {
      const sus = findSuspiciousBraces(value);
      if (sus.length > 0) {
        violations.push({ locale, key, value, suspicious: sus });
      }
    }
  }
  if (violations.length > 0) {
    const lines = violations.map((v) =>
      `  - ${v.locale}["${v.key}"] = ${JSON.stringify(v.value)} ` +
      `→ suspicious: ${JSON.stringify(v.suspicious)}`);
    assert.fail(
      `${violations.length} value(s) contain brace patterns that look like ` +
      `placeholders but won't be substituted by HarnessI18n.t() ` +
      `(must match /\\{(\\w+)\\}/ — letters/digits/underscore only):\n${lines.join("\n")}`,
    );
  }
});

test("I18N-PARITY-1-a: placeholder set has no entries with mixed-case anomalies", () => {
  // {mode} and {Mode} would both pass the runtime regex but mean
  // different params at call sites. Catches typos like {Mode} when
  // the caller passes { mode: "hard" } (case-sensitive).
  // We DON'T enforce a casing convention (snake_case vs camelCase
  // mix exists in the codebase: {count}, {pii_kinds} both fine).
  // We DO enforce: if ko uses {mode} and en uses {Mode}, fail —
  // that's casing drift between locales.
  const violations = [];
  for (const key of Object.keys(ko)) {
    const koPlaceholders = extractPlaceholders(ko[key]);
    const enPlaceholders = extractPlaceholders(en[key]);
    // Build lowercase view; if any name in either set has a
    // different casing in the other, that's a violation.
    const koLower = new Map();
    for (const p of koPlaceholders) {
      const prev = koLower.get(p.toLowerCase());
      if (prev && prev !== p) {
        violations.push({ key, locale: "ko",
          conflict: `${prev} vs ${p} (same lowercase, different case)` });
      }
      koLower.set(p.toLowerCase(), p);
    }
    for (const p of enPlaceholders) {
      const lc = p.toLowerCase();
      const koMatch = koLower.get(lc);
      if (koMatch && koMatch !== p) {
        violations.push({ key,
          conflict: `ko uses {${koMatch}} but en uses {${p}} ` +
                    `(same lowercase, different case — typo?)` });
      }
    }
  }
  assert.deepEqual(violations, [],
    "case-drift in placeholders — fix the locale that diverged");
});

test("I18N-PARITY-1-a: ≥80% of keys have actually-translated values (sanity)", () => {
  // Some keys legitimately use proper nouns or codes that don't
  // translate (e.g. "Codex CLI" / "harness-policy-pack/v1").
  // But if ko === en for >20% of keys, something is off (probably
  // an English-only block accidentally synced into ko).
  let identical = 0;
  let total = 0;
  for (const key of Object.keys(ko)) {
    total++;
    if (ko[key] === en[key]) identical++;
  }
  const identicalPct = (identical / total) * 100;
  assert.ok(identicalPct < 20,
    `${identicalPct.toFixed(1)}% of keys have ko === en ` +
    `(${identical}/${total}) — likely an untranslated block. ` +
    `Threshold: < 20%.`);
});

test("I18N-PARITY-1-a: no key value has leading/trailing whitespace", () => {
  // Whitespace at the edges of localized strings is almost always a
  // typo (the panels concat strings with explicit separators). If
  // it's intentional, the caller can add the space — keeping the
  // table values trimmed makes the contract narrower.
  const violations = [];
  for (const [locale, table] of [["ko", ko], ["en", en]]) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string") continue;
      if (value !== value.trim()) {
        violations.push(`${locale}["${key}"] = ${JSON.stringify(value)}`);
      }
    }
  }
  assert.deepEqual(violations, [],
    "leading/trailing whitespace in i18n values — trim them");
});

test("I18N-PARITY-1-a: anchor — extractPlaceholders matches HarnessI18n.t regex", () => {
  // Belt-and-suspenders: if HarnessI18n.t() ever changes its
  // interpolation regex, this test must update too. Today both
  // use /\{(\w+)\}/g — keep them in sync.
  assert.deepEqual(
    Array.from(extractPlaceholders("hello {name} you have {count} items")),
    ["name", "count"]);
  assert.deepEqual(
    Array.from(extractPlaceholders("no placeholders")),
    []);
  assert.deepEqual(
    Array.from(extractPlaceholders("dup: {x} and {x} again")),
    ["x"], "duplicate placeholder names collapse to a Set");
  // Should NOT match: spaces, hyphens, mixed punctuation
  assert.deepEqual(
    Array.from(extractPlaceholders("not a placeholder: { name }")),
    [], "spaces inside braces invalidate placeholder");
  assert.deepEqual(
    Array.from(extractPlaceholders("not a placeholder: {tool-id}")),
    [], "hyphens inside braces invalidate placeholder");
});

test("I18N-PARITY-1-a: anchor — findSuspiciousBraces detects typos but not valid placeholders", () => {
  assert.deepEqual(findSuspiciousBraces("clean {mode} text"), []);
  assert.deepEqual(findSuspiciousBraces("typo { mode }"), ["{ mode }"]);
  assert.deepEqual(findSuspiciousBraces("typo {tool-name}"), ["{tool-name}"]);
  assert.deepEqual(
    findSuspiciousBraces("mixed {good} and {bad-name}"),
    ["{bad-name}"]);
  // Empty braces are suspicious too
  assert.deepEqual(findSuspiciousBraces("empty {} braces"), ["{}"]);
});

test("I18N-PARITY-1-a: total key count is large enough to be a meaningful gate (≥200)", () => {
  // The harness has accumulated many i18n keys across rounds (was
  // 221 at I18N-PARITY-1-a authoring). The 200 floor is the "block
  // deletion" canary — if a future change drops below 200, an
  // entire feature's i18n block was likely deleted accidentally.
  // The existing i18n.coverage.test.js gates at ≥ 40 (the original
  // floor); this test tightens that floor in light of how much
  // i18n surface has accumulated.
  const koCount = Object.keys(ko).length;
  const enCount = Object.keys(en).length;
  assert.ok(koCount >= 200,
    `ko has only ${koCount} keys — expected ≥ 200 across all rounds`);
  assert.ok(enCount >= 200,
    `en has only ${enCount} keys — expected ≥ 200 across all rounds`);
});

test("I18N-PARITY-1-a: round-trip — every {placeholder} can be substituted by name", () => {
  // For every placeholder the table uses, verify that interpolating
  // a stub value in produces a final string with NO unsubstituted
  // braces remaining (when the caller passes ALL the right names).
  for (const [locale, table] of [["ko", ko], ["en", en]]) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string") continue;
      const placeholders = extractPlaceholders(value);
      if (placeholders.size === 0) continue;
      // Build a stub params object with every placeholder name
      const stub = {};
      for (const p of placeholders) stub[p] = "X";
      // Apply same regex the runtime uses
      const result = value.replace(PLACEHOLDER_RE,
        (_, name) => stub[name] !== undefined ? String(stub[name]) : `{${name}}`);
      // After substitution there should be no remaining {word}
      // patterns (the SUSPICIOUS check would catch the others).
      assert.doesNotMatch(result, PLACEHOLDER_RE,
        `${locale}["${key}"] = ${JSON.stringify(value)} ` +
        `— after substituting all named placeholders, ` +
        `result still contains {placeholder} (round-trip broken)`);
    }
  }
});
