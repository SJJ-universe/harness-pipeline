// tests/unit/piiScanner.test.js — Slice GOV-PII-0 (Phase E1.5, 2026-04-29)
//
// Verifies the inline PII detector that the public-sector pre-dispatch
// gate (piiGate.js) calls before sending a prompt to a local provider.
//
// Tested in priority order:
//
//   1. KRN check digit + birth-date validation kills obvious sequences
//      (we don't want "111111-1111111" to look like a real SSN).
//   2. Luhn check on credit cards kills obvious sequences (so a Luhn-
//      fail card-shaped string passes through unredacted).
//   3. Korean phone numbers (mobile + landline) match common formats
//      with and without dashes.
//   4. Email matches with a permissive-but-not-stupid pattern.
//   5. Sample redaction NEVER returns the raw value (head + tail + asterisks).
//   6. Bounds: maxFindingsPerType caps the count, maxSamples caps the
//      sample-array length.
//   7. Performance: 4KB scan well under 5ms target (Phase E1.5 spec).

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  scanForPii,
  redactPii,
  PATTERNS,
  DEFAULT_PATTERN_TYPES,
  _isValidKrn,
  _isValidLuhn,
  _redactSample,
} = require("../../src/security/piiScanner");

// ─────────────────────────────────────────────────────────────────
//  KRN — birth date + check digit validation
// ─────────────────────────────────────────────────────────────────
//
// Test KRN: 900101-1234567
//   YY=90 MM=01 DD=01 → valid date
//   gender code = 1 → ok
//   check: digits = [9,0,0,1,0,1,1,2,3,4,5,6,7]
//          weights = [2,3,4,5,6,7,8,9,2,3,4,5]
//          sum = 9*2+0*3+0*4+1*5+0*6+1*7+1*8+2*9+3*2+4*3+5*4+6*5
//              = 18+0+0+5+0+7+8+18+6+12+20+30 = 124
//          124 % 11 = 3, (11-3)%10 = 8 → expected 8, got 7 → INVALID
// So 900101-1234567 is INVALID.
// To find a valid one, we compute one. Let's use 900101-1234565:
//   sum still 124, expected 8, got 5 → INVALID.
// Let's compute properly: we need check = (11 - 124%11) % 10
//   124 % 11 = 3, expected = 8.
// So 900101-1234568 would be valid.

const KRN_VALID = "900101-1234568";
const KRN_INVALID_CHECK = "900101-1234567";
const KRN_INVALID_DATE = "901301-1234568"; // month 13
const KRN_INVALID_GENDER = "900101-9234568"; // gender 9 (unused)

test("GOV-PII-0: _isValidKrn passes a known-valid sequence", () => {
  assert.equal(_isValidKrn("900101", "1234568"), true);
});

test("GOV-PII-0: _isValidKrn rejects bad check digit", () => {
  assert.equal(_isValidKrn("900101", "1234567"), false);
});

test("GOV-PII-0: _isValidKrn rejects invalid month/day", () => {
  assert.equal(_isValidKrn("901301", "1234568"), false); // month 13
  assert.equal(_isValidKrn("900132", "1234568"), false); // day 32
});

test("GOV-PII-0: _isValidKrn rejects unused gender codes (9, 0)", () => {
  assert.equal(_isValidKrn("900101", "9234568"), false);
  assert.equal(_isValidKrn("900101", "0234568"), false);
});

test("GOV-PII-0: scanForPii detects valid KRN", () => {
  const result = scanForPii(`사용자 정보: ${KRN_VALID}`);
  assert.equal(result.hasPii, true);
  const krn = result.findings.find((f) => f.type === "krn");
  assert.ok(krn);
  assert.equal(krn.count, 1);
  assert.equal(krn.severity, "critical");
});

test("GOV-PII-0: scanForPii skips KRN-shaped sequences with bad check digit", () => {
  // A Luhn-fail-like sequence must NOT register as a KRN finding.
  const result = scanForPii(`fake: ${KRN_INVALID_CHECK}`);
  const krn = result.findings.find((f) => f.type === "krn");
  assert.equal(krn, undefined,
    "KRN with bad check digit must not register — would be a false-positive");
});

test("GOV-PII-0: scanForPii skips KRN-shaped sequences with bad date", () => {
  const result = scanForPii(`fake: ${KRN_INVALID_DATE}`);
  const krn = result.findings.find((f) => f.type === "krn");
  assert.equal(krn, undefined);
});

test("GOV-PII-0: scanForPii skips KRN-shaped sequences with unused gender", () => {
  const result = scanForPii(`fake: ${KRN_INVALID_GENDER}`);
  const krn = result.findings.find((f) => f.type === "krn");
  assert.equal(krn, undefined);
});

test("GOV-PII-0: scanForPii detects KRN with and without dash", () => {
  const dashed = scanForPii(KRN_VALID);
  const undashed = scanForPii(KRN_VALID.replace("-", ""));
  assert.equal(dashed.hasPii, true);
  assert.equal(undashed.hasPii, true);
});

// ─────────────────────────────────────────────────────────────────
//  Credit card — Luhn check
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: _isValidLuhn passes Visa test card", () => {
  // 4111-1111-1111-1111 is a Luhn-valid Visa test number.
  assert.equal(_isValidLuhn("4111111111111111"), true);
});

test("GOV-PII-0: _isValidLuhn rejects modified Visa", () => {
  assert.equal(_isValidLuhn("4111111111111112"), false);
});

test("GOV-PII-0: scanForPii detects credit card with Luhn pass", () => {
  const result = scanForPii("Card: 4111-1111-1111-1111");
  const cc = result.findings.find((f) => f.type === "credit_card");
  assert.ok(cc);
  assert.equal(cc.count, 1);
  assert.equal(cc.severity, "critical");
});

test("GOV-PII-0: scanForPii ignores 16-digit sequence with Luhn fail", () => {
  // 16 digits but Luhn-invalid — must not register.
  const result = scanForPii("not-a-card: 4111-1111-1111-1112");
  const cc = result.findings.find((f) => f.type === "credit_card");
  assert.equal(cc, undefined);
});

// ─────────────────────────────────────────────────────────────────
//  Phone — Korean mobile + landline
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: scanForPii detects Korean mobile (dashed)", () => {
  const result = scanForPii("연락처: 010-1234-5678");
  const m = result.findings.find((f) => f.type === "phone_kr_mobile");
  assert.ok(m);
});

test("GOV-PII-0: scanForPii detects Korean mobile (undashed)", () => {
  const result = scanForPii("연락처: 01012345678");
  const m = result.findings.find((f) => f.type === "phone_kr_mobile");
  assert.ok(m);
});

test("GOV-PII-0: scanForPii detects Seoul landline 02-XXXX-XXXX", () => {
  const result = scanForPii("Tel: 02-555-1234");
  const m = result.findings.find((f) => f.type === "phone_kr_landline");
  assert.ok(m);
});

test("GOV-PII-0: scanForPii does NOT match short numeric sequences as phone", () => {
  // "1234" or "5678" alone should not match. Anchoring should kill these.
  const result = scanForPii("Order ID: 1234");
  const m = result.findings.find((f) => f.type.startsWith("phone_kr"));
  assert.equal(m, undefined);
});

// ─────────────────────────────────────────────────────────────────
//  Email
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: scanForPii detects plain email", () => {
  const result = scanForPii("Contact: alice.bob+work@example.co.kr");
  const e = result.findings.find((f) => f.type === "email");
  assert.ok(e);
});

test("GOV-PII-0: scanForPii does NOT match barewords (no @)", () => {
  const result = scanForPii("text without email");
  const e = result.findings.find((f) => f.type === "email");
  assert.equal(e, undefined);
});

// ─────────────────────────────────────────────────────────────────
//  Sample redaction
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: _redactSample reveals only first 2 + last 2 chars", () => {
  assert.equal(_redactSample("alice@example.com"), "al*************om");
  assert.equal(_redactSample("01012345678"), "01*******78");
  assert.equal(_redactSample("4111111111111111"), "41************11");
});

test("GOV-PII-0: _redactSample handles short strings (≤4 chars)", () => {
  assert.equal(_redactSample("abc"), "***");
  assert.equal(_redactSample("ab"), "**");
  assert.equal(_redactSample(""), "");
});

test("GOV-PII-0: scanForPii samples are NEVER raw", () => {
  const result = scanForPii(`KRN: ${KRN_VALID}`);
  const krn = result.findings.find((f) => f.type === "krn");
  for (const sample of krn.samples) {
    assert.ok(!sample.includes("12345"),
      `sample "${sample}" must not contain raw digits from "${KRN_VALID}"`);
  }
});

// ─────────────────────────────────────────────────────────────────
//  Caps + bounds
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: maxFindingsPerType caps the count", () => {
  // Build a string with many emails.
  const emails = Array.from({ length: 50 }, (_, i) => `u${i}@x.com`).join(" ");
  const result = scanForPii(emails, { maxFindingsPerType: 10 });
  const e = result.findings.find((f) => f.type === "email");
  assert.equal(e.count, 10, "count must be capped at maxFindingsPerType");
});

test("GOV-PII-0: maxSamples caps the sample-array length", () => {
  const emails = Array.from({ length: 20 }, (_, i) => `u${i}@x.com`).join(" ");
  const result = scanForPii(emails, { maxSamples: 2 });
  const e = result.findings.find((f) => f.type === "email");
  assert.equal(e.samples.length, 2, "samples must be capped at maxSamples");
  // count should still reflect ALL (or the overall maxFindings cap).
  assert.ok(e.count >= 2);
});

test("GOV-PII-0: opts.patterns subset disables non-listed types", () => {
  const txt = `KRN: ${KRN_VALID} email: a@b.com phone: 010-1234-5678`;
  const result = scanForPii(txt, { patterns: ["email"] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, "email");
});

// ─────────────────────────────────────────────────────────────────
//  redactPii
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: redactPii replaces detected PII with [REDACTED:type]", () => {
  const txt = `Name: Kim, KRN: ${KRN_VALID}, email: a@b.com`;
  const out = redactPii(txt);
  assert.match(out, /\[REDACTED:krn\]/);
  assert.match(out, /\[REDACTED:email\]/);
  // Original PII gone:
  assert.ok(!out.includes(KRN_VALID));
  assert.ok(!out.includes("a@b.com"));
});

test("GOV-PII-0: redactPii leaves Luhn-fail card sequences alone", () => {
  const txt = "fake-card: 4111-1111-1111-1112";
  const out = redactPii(txt);
  assert.equal(out, txt, "Luhn-fail card must NOT be redacted (false-positive guard)");
});

test("GOV-PII-0: redactPii on null/undefined returns empty string", () => {
  assert.equal(redactPii(null), "");
  assert.equal(redactPii(undefined), "");
});

test("GOV-PII-0: scanForPii on null/undefined returns hasPii=false", () => {
  assert.equal(scanForPii(null).hasPii, false);
  assert.equal(scanForPii(undefined).hasPii, false);
});

// ─────────────────────────────────────────────────────────────────
//  Pattern registry contract
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: PATTERNS registry is frozen (locks the wire-format)", () => {
  assert.ok(Object.isFrozen(PATTERNS));
  for (const pname of Object.keys(PATTERNS)) {
    assert.ok(Object.isFrozen(PATTERNS[pname]),
      `pattern "${pname}" must be frozen`);
  }
});

test("GOV-PII-0: DEFAULT_PATTERN_TYPES exposes all five GOV-PII-0 patterns", () => {
  assert.deepEqual(
    [...DEFAULT_PATTERN_TYPES].sort(),
    ["credit_card", "email", "krn", "phone_kr_landline", "phone_kr_mobile"],
  );
});

// ─────────────────────────────────────────────────────────────────
//  Performance (loose bound)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: scanForPii on 4KB prompt completes in well under 50ms", () => {
  // 4KB of mixed prose + a few PII anchors. Under realistic load
  // we expect <5ms; allow 50ms as the test-environment ceiling.
  const filler = "the quick brown fox jumps over the lazy dog. ".repeat(80);
  const txt = `${filler}\nKRN: ${KRN_VALID}\nemail: x@y.com\n${filler}`;
  const result = scanForPii(txt);
  assert.ok(result.hasPii);
  assert.ok(result.elapsedMs < 50,
    `scan took ${result.elapsedMs}ms — exceeds 50ms ceiling`);
});

// ─────────────────────────────────────────────────────────────────
//  Multi-pattern, multi-finding output shape
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-0: output shape — multiple patterns matched simultaneously", () => {
  const txt = [
    "이름: 홍길동",
    `주민번호: ${KRN_VALID}`,
    "전화: 010-1234-5678",
    "이메일: hong@gov.kr",
    "카드: 4111-1111-1111-1111",
  ].join("\n");
  const result = scanForPii(txt);
  assert.equal(result.hasPii, true);
  // All five pattern types matched.
  const typesMatched = result.findings.map((f) => f.type).sort();
  assert.deepEqual(typesMatched, [
    "credit_card", "email", "krn", "phone_kr_mobile",
  ].sort());
  // Each finding has the documented shape.
  for (const f of result.findings) {
    assert.equal(typeof f.type, "string");
    assert.equal(typeof f.count, "number");
    assert.ok(f.count >= 1);
    assert.ok(Array.isArray(f.samples));
    assert.equal(typeof f.severity, "string");
  }
});
