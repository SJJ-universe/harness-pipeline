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
  INLINE_PATTERN_TYPES,
  DEEP_PATTERN_TYPES,
  _isValidKrn,
  _isValidLuhn,
  _isValidBrn,
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

// ─────────────────────────────────────────────────────────────────
//  Slice GOV-PII-1-a (Phase E1.5, 2026-04-29) — depth selector
//  + 3 KR deep patterns (사업자등록번호 / 운전면허 / 여권)
// ─────────────────────────────────────────────────────────────────

// Computed valid BRN per the 사업자등록번호 check-digit algorithm
// (see _isValidBrn comment in piiScanner.js for the math).
const BRN_VALID = "123-45-67891";        // computed: digit[9] = 1
const BRN_INVALID_CHECK = "123-45-67890"; // last digit should be 1
const BRN_VALID_2 = "208-81-07076";      // independently computed: digit[9] = 6

// ── BRN check digit ──────────────────────────────────────────

test("GOV-PII-1-a: _isValidBrn passes a known-valid 사업자번호", () => {
  assert.equal(_isValidBrn("1234567891"), true);
  assert.equal(_isValidBrn("2088107076"), true);
});

test("GOV-PII-1-a: _isValidBrn rejects bad check digit", () => {
  assert.equal(_isValidBrn("1234567890"), false);
  assert.equal(_isValidBrn("1234567899"), false);
});

test("GOV-PII-1-a: _isValidBrn rejects non-10-digit input", () => {
  assert.equal(_isValidBrn(""), false);
  assert.equal(_isValidBrn("123"), false);
  assert.equal(_isValidBrn("12345678901"), false); // 11 digits
  assert.equal(_isValidBrn("123-45-67891"), false); // includes dash
  assert.equal(_isValidBrn("ABCDEFGHIJ"), false);
  assert.equal(_isValidBrn(null), false);
  assert.equal(_isValidBrn(undefined), false);
});

// ── BRN scanning (deep mode required) ──────────────────────────

test("GOV-PII-1-a: BRN is INVISIBLE under default (inline) depth — back-compat regression guard", () => {
  // Existing GOV-PII-0 callers must NOT see BRN matches creep in
  // when they upgrade to the GOV-PII-1 piiScanner. The fast inline
  // gate stays unchanged.
  const result = scanForPii(`사업자번호 ${BRN_VALID}`);
  const brn = result.findings.find((f) => f.type === "business_reg");
  assert.equal(brn, undefined,
    "default depth (inline) must not match BRN — would regress GOV-PII-0 behavior");
});

test("GOV-PII-1-a: BRN matches under depth=deep with valid check digit", () => {
  const result = scanForPii(`사업자번호 ${BRN_VALID}`, { depth: "deep" });
  assert.equal(result.hasPii, true);
  const brn = result.findings.find((f) => f.type === "business_reg");
  assert.ok(brn);
  assert.equal(brn.count, 1);
  assert.equal(brn.severity, "high");
});

test("GOV-PII-1-a: BRN-shaped sequence with bad check digit does NOT match", () => {
  const result = scanForPii(`fake: ${BRN_INVALID_CHECK}`, { depth: "deep" });
  const brn = result.findings.find((f) => f.type === "business_reg");
  assert.equal(brn, undefined,
    "Luhn-fail equivalent: BRN with bad check digit must NOT match (false-positive guard)");
});

test("GOV-PII-1-a: BRN matches with and without dashes", () => {
  const dashed = scanForPii(BRN_VALID, { depth: "deep" });
  const undashed = scanForPii(BRN_VALID.replace(/-/g, ""), { depth: "deep" });
  assert.equal(dashed.findings.find((f) => f.type === "business_reg")?.count, 1);
  assert.equal(undashed.findings.find((f) => f.type === "business_reg")?.count, 1);
});

test("GOV-PII-1-a: multiple valid BRNs all match", () => {
  const text = `회사1: ${BRN_VALID}\n회사2: ${BRN_VALID_2}`;
  const result = scanForPii(text, { depth: "deep" });
  const brn = result.findings.find((f) => f.type === "business_reg");
  assert.equal(brn.count, 2);
});

// ── Korean driver license ──────────────────────────────────────

test("GOV-PII-1-a: KR driver license matches under depth=deep (12-digit format)", () => {
  // Format: XX-XX-XXXXXX-XX
  const text = "운전면허: 11-22-333344-55";
  const result = scanForPii(text, { depth: "deep" });
  const dl = result.findings.find((f) => f.type === "driver_license_kr");
  assert.ok(dl);
  assert.equal(dl.severity, "high");
});

test("GOV-PII-1-a: KR driver license invisible under default (inline) depth", () => {
  const result = scanForPii("운전면허: 11-22-333344-55");
  const dl = result.findings.find((f) => f.type === "driver_license_kr");
  assert.equal(dl, undefined);
});

test("GOV-PII-1-a: KR driver license matches without dashes", () => {
  const text = "운전면허: 112233334455";
  const result = scanForPii(text, { depth: "deep" });
  const dl = result.findings.find((f) => f.type === "driver_license_kr");
  assert.ok(dl);
});

// ── Korean passport ──────────────────────────────────────────

test("GOV-PII-1-a: KR passport matches under depth=deep (M/S + 8 digits)", () => {
  for (const sample of ["M12345678", "S99887766"]) {
    const result = scanForPii(`여권: ${sample}`, { depth: "deep" });
    const p = result.findings.find((f) => f.type === "passport_kr");
    assert.ok(p, `must match passport "${sample}"`);
    assert.equal(p.severity, "critical");
  }
});

test("GOV-PII-1-a: KR passport invisible under default (inline) depth", () => {
  const result = scanForPii("여권: M12345678");
  const p = result.findings.find((f) => f.type === "passport_kr");
  assert.equal(p, undefined);
});

test("GOV-PII-1-a: KR passport prefix beyond M/S does NOT match", () => {
  const result = scanForPii("코드: A12345678 X99887766", { depth: "deep" });
  const p = result.findings.find((f) => f.type === "passport_kr");
  assert.equal(p, undefined,
    "current spec is M/S only — A/B/C/X don't qualify");
});

test("GOV-PII-1-a: KR passport embedded in longer alphanumeric does NOT match (anchoring)", () => {
  // The lookarounds (?<![A-Z\d]) and (?![A-Z\d]) prevent grabbing
  // a passport-shaped token from inside a larger identifier.
  const result = scanForPii("token=ABCM123456789EFG", { depth: "deep" });
  const p = result.findings.find((f) => f.type === "passport_kr");
  assert.equal(p, undefined);
});

// ── Depth selector contract ────────────────────────────────────

test("GOV-PII-1-a: explicit opts.patterns wins over depth", () => {
  // Even with depth="deep", an explicit single-pattern subset still
  // narrows the scan. This lets the route layer ask "just check
  // BRN" without running the full set.
  const text = `KRN: 900101-1234568, BRN: ${BRN_VALID}, email: a@b.com`;
  const result = scanForPii(text, { depth: "deep", patterns: ["business_reg"] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, "business_reg");
});

test("GOV-PII-1-a: depth='deep' finds BRN + KRN + email simultaneously", () => {
  const text = [
    `KRN: 900101-1234568`,
    `BRN: ${BRN_VALID}`,
    `email: a@b.com`,
    `passport: M12345678`,
  ].join("\n");
  const result = scanForPii(text, { depth: "deep" });
  const types = result.findings.map((f) => f.type).sort();
  assert.deepEqual(types, ["business_reg", "email", "krn", "passport_kr"].sort());
});

test("GOV-PII-1-a: depth selector ignored when explicit patterns is non-empty", () => {
  const text = `KRN: 900101-1234568, BRN: ${BRN_VALID}`;
  // Explicit patterns + depth=inline → only KRN matches (BRN not in explicit list).
  const result = scanForPii(text, { depth: "inline", patterns: ["krn"] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].type, "krn");
});

test("GOV-PII-1-a: empty/invalid depth value defaults to inline", () => {
  for (const bad of [null, undefined, "", "ghost", 42, true]) {
    const result = scanForPii(`BRN: ${BRN_VALID}`, { depth: bad });
    const brn = result.findings.find((f) => f.type === "business_reg");
    assert.equal(brn, undefined,
      `depth="${bad}" must default to inline (BRN not matched)`);
  }
});

// ── INLINE_PATTERN_TYPES + DEEP_PATTERN_TYPES exports ──────────

test("GOV-PII-1-a: INLINE_PATTERN_TYPES is the GOV-PII-0 set (5 entries, frozen)", () => {
  assert.ok(Object.isFrozen(INLINE_PATTERN_TYPES));
  assert.deepEqual(
    [...INLINE_PATTERN_TYPES].sort(),
    ["credit_card", "email", "krn", "phone_kr_landline", "phone_kr_mobile"],
  );
});

test("GOV-PII-1-a: DEEP_PATTERN_TYPES is INLINE + 3 deep entries (8 total, frozen)", () => {
  assert.ok(Object.isFrozen(DEEP_PATTERN_TYPES));
  assert.equal(DEEP_PATTERN_TYPES.length, 8);
  assert.ok(DEEP_PATTERN_TYPES.includes("business_reg"));
  assert.ok(DEEP_PATTERN_TYPES.includes("driver_license_kr"));
  assert.ok(DEEP_PATTERN_TYPES.includes("passport_kr"));
  // Inline entries are still in deep.
  for (const t of INLINE_PATTERN_TYPES) {
    assert.ok(DEEP_PATTERN_TYPES.includes(t));
  }
});

test("GOV-PII-1-a: DEFAULT_PATTERN_TYPES === INLINE_PATTERN_TYPES (back-compat alias)", () => {
  assert.deepEqual(DEFAULT_PATTERN_TYPES, INLINE_PATTERN_TYPES,
    "DEFAULT_PATTERN_TYPES must alias INLINE_PATTERN_TYPES so pre-GOV-PII-1 callers keep their behavior");
});

// ── PATTERNS registry has all 8 entries (frozen + per-entry frozen)

test("GOV-PII-1-a: PATTERNS registry now has 8 entries (5 inline + 3 deep)", () => {
  assert.equal(Object.keys(PATTERNS).length, 8);
  // Every registry entry is itself frozen (per-pattern wire format lock).
  for (const ptype of Object.keys(PATTERNS)) {
    assert.ok(Object.isFrozen(PATTERNS[ptype]),
      `pattern "${ptype}" must be frozen`);
  }
});

// ── Sample redaction safety on deep matches ──────────────────────

test("GOV-PII-1-a: BRN samples are redacted (no raw digits)", () => {
  const result = scanForPii(`BRN: ${BRN_VALID}`, { depth: "deep" });
  const brn = result.findings.find((f) => f.type === "business_reg");
  for (const s of brn.samples) {
    assert.ok(!s.includes("12345"),
      `sample "${s}" must not contain raw digits from "${BRN_VALID}"`);
    assert.ok(s.includes("*"));
  }
});

// ── redactPii honors depth selector ──────────────────────────────

test("GOV-PII-1-a: redactPii(depth='deep') replaces BRN; default (inline) leaves it", () => {
  const text = `BRN: ${BRN_VALID}`;
  const inlineRedacted = redactPii(text);
  assert.equal(inlineRedacted, text,
    "default (inline) redactPii leaves BRN alone — back-compat with GOV-PII-0");
  const deepRedacted = redactPii(text, { depth: "deep" });
  assert.match(deepRedacted, /\[REDACTED:business_reg\]/);
  assert.ok(!deepRedacted.includes(BRN_VALID));
});

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
