// Slice GOV-PII-0 (Phase E1.5, 2026-04-29) — fast inline PII scanner.
//
// Scope (per docs/public-sector-hardening-plan.md §4 GOV-PII-* + §6
// Task 4): the highest-precision Korean PII patterns that an
// orchestrator MUST refuse to forward to a provider in public-sector
// mode. Patterns chosen for low false-positive rate first; deeper
// scans (file-import deep scan, address heuristics, low-precision
// bank account numbers) are GOV-PII-1 territory.
//
// Patterns shipped in GOV-PII-0:
//
//   krn               — 주민등록번호 (Resident Registration Number).
//                       6-7 digits with optional dash. Includes
//                       birth-date + check-digit validation per
//                       https://en.wikipedia.org/wiki/Resident_registration_number_(South_Korea)
//                       so "111111-1111111" doesn't match (failing
//                       both birth date and check digit).
//
//   phone_kr_mobile   — 한국 휴대폰 (010/011/016/017/018/019). Both
//                       dashed and undashed forms.
//
//   phone_kr_landline — 한국 일반전화 (02/0XX with 7-8 digit body).
//
//   email             — RFC 5321ish email. Pre-filter excludes the
//                       obvious harness audit metadata fields (the
//                       redactor never sees those because the audit
//                       sanitizer fires first, but sample emails
//                       still need redaction in operator-visible
//                       text).
//
//   credit_card       — 13-19 digit sequences with Luhn check.
//                       Strict on Luhn so "4111-1111-1111-1112"
//                       (Luhn-fail) passes through unredacted.
//
// Public API:
//
//   scanForPii(text, opts?) -> { hasPii, findings, elapsedMs }
//     findings shape: [{type, count, samples}]
//     samples: array of REDACTED excerpts (first/last 2 chars + middle
//              asterisked). Operators can confirm the scanner saw the
//              right thing without the actual PII landing in logs.
//
//   redactPii(text, opts?) -> string
//     Returns the input with detected PII replaced by `[REDACTED:<type>]`.
//     Used by the gate's "warn" mode to render UI-safe text + by
//     deep-scan tooling.
//
//   PATTERNS — frozen registry. Tests + dashboards lock the wire-
//     format vocabulary so a future caller can't add a pattern type
//     without an explicit code change.
//
// Why a separate module from envFilter / auditSanitizer:
//   - envFilter strips secret-shaped KEY NAMES (TOKEN, SECRET, KEY,
//     PASSWORD, CREDENTIAL) from spawn env. PII detection scans VALUES.
//   - auditSanitizer redacts values whose KEY NAMES match the
//     SENSITIVE_KEY_RE; the PII scanner is for content that has no
//     key-name signal at all (a free-text prompt).
//   - All three are defense-in-depth layers: a leak is most blocked
//     when its KEY NAME, ITS VALUE, AND ITS CONTENT-SHAPE are all
//     filtered.
//
// Performance:
//   The whole scan is one regex pass per pattern, no backtracking-
//   prone constructs, capped at maxFindingsPerType to prevent
//   pathological inputs from generating huge payloads. A 2-4KB
//   prompt scans in well under 1ms on commodity hardware.

"use strict";

// ── Pattern definitions ────────────────────────────────────────

// 주민등록번호 (RRN). Format: YYMMDD-?GBBBBNC where:
//   YYMMDD = birth date (constrained below)
//   G      = gender + century code (1-8)
//   BBBB   = birth-region/sequence
//   N      = sequence
//   C      = check digit (validated below)
const KRN_REGEX = /(?<![\d-])(\d{6})-?(\d{7})(?![\d])/g;

// Korean mobile prefixes: 010, 011, 016, 017, 018, 019.
// Body is 3-4 digits + 4 digits (older 011/016 used 3-digit middle).
const PHONE_KR_MOBILE_REGEX = /(?<![\d])(01[016789])-?(\d{3,4})-?(\d{4})(?!\d)/g;

// Korean landline. Area codes: 02 (Seoul, 7-8 digits body) or
// 031/032/033/...064 (3-digit area, 7-8 digits body).
// Avoid matching mobile numbers by anchoring on 0[2-6].
const PHONE_KR_LANDLINE_REGEX = /(?<![\d])(0(?:2|[3-6][1-5]))-?(\d{3,4})-?(\d{4})(?!\d)/g;

// Email — pragmatic, not RFC-perfect. Sufficient for a fast
// inline gate; the deeper validator (GOV-PII-1) can use a stricter
// parser when reading attachments.
const EMAIL_REGEX = /(?<![\w.+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24})(?![\w.+-])/g;

// Credit card: 13-19 digits with optional space/dash separators.
// We capture, then verify with Luhn. Luhn-fail samples pass through.
const CREDIT_CARD_REGEX = /(?<![\d])(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7})(?![\d])/g;

// ── KRN check (birth date + check digit) ────────────────────────
//
// Birth date: YY (2-digit), MM (1-12), DD (1-31). We don't validate
// real-calendar correctness (Feb 30 passes) — that's not what the
// gate needs. The check digit + reasonable date range is enough to
// kill obvious sequences like "111111-1111111".
//
// Check digit: weighted sum [2,3,4,5,6,7,8,9,2,3,4,5] of the first
// 12 digits, sum mod 11, (11 - mod) mod 10 must equal the 13th digit.
function _isValidKrn(yymmdd, body) {
  if (yymmdd.length !== 6 || body.length !== 7) return false;
  const month = parseInt(yymmdd.slice(2, 4), 10);
  const day = parseInt(yymmdd.slice(4, 6), 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Gender/century code (1-8). 9/0 are not used in real RRNs.
  const g = parseInt(body[0], 10);
  if (g < 1 || g > 8) return false;
  const digits = (yymmdd + body).split("").map((c) => parseInt(c, 10));
  if (digits.some((d) => Number.isNaN(d))) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += digits[i] * weights[i];
  const expected = (11 - (sum % 11)) % 10;
  return expected === digits[12];
}

// Luhn check (card validation).
function _isValidLuhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (n < 0 || n > 9) return false;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum > 0 && sum % 10 === 0;
}

// ── Sample redaction ────────────────────────────────────────────

// Reveal first 2 + last 2 chars; everything else becomes asterisks.
// Operators can confirm the scanner saw the right shape without the
// actual PII landing in logs / audit / UI.
function _redactSample(value) {
  const s = String(value);
  if (s.length <= 4) return "*".repeat(s.length);
  const head = s.slice(0, 2);
  const tail = s.slice(-2);
  return `${head}${"*".repeat(s.length - 4)}${tail}`;
}

// ── Pattern registry ────────────────────────────────────────────

const PATTERNS = Object.freeze({
  krn: Object.freeze({
    type: "krn",
    label: "Korean Resident Registration Number",
    regex: KRN_REGEX,
    validator: (match) => {
      // match is the captured full match including any dash.
      const stripped = match.replace(/-/g, "");
      return _isValidKrn(stripped.slice(0, 6), stripped.slice(6));
    },
    severity: "critical",
  }),
  phone_kr_mobile: Object.freeze({
    type: "phone_kr_mobile",
    label: "Korean mobile phone",
    regex: PHONE_KR_MOBILE_REGEX,
    validator: () => true,
    severity: "high",
  }),
  phone_kr_landline: Object.freeze({
    type: "phone_kr_landline",
    label: "Korean landline phone",
    regex: PHONE_KR_LANDLINE_REGEX,
    validator: () => true,
    severity: "medium",
  }),
  email: Object.freeze({
    type: "email",
    label: "Email address",
    regex: EMAIL_REGEX,
    validator: () => true,
    severity: "medium",
  }),
  credit_card: Object.freeze({
    type: "credit_card",
    label: "Credit card number",
    regex: CREDIT_CARD_REGEX,
    validator: (match) => _isValidLuhn(match.replace(/[\s-]/g, "")),
    severity: "critical",
  }),
});

const DEFAULT_PATTERN_TYPES = Object.freeze(
  Object.keys(PATTERNS),
);

// ── Public API ──────────────────────────────────────────────────

/**
 * Scan free-text for PII matching the public-sector inline gate
 * patterns.
 *
 * @param {string} text - input to scan
 * @param {object} [opts]
 * @param {string[]} [opts.patterns] - subset of pattern types to
 *   run. Default: all (DEFAULT_PATTERN_TYPES).
 * @param {number} [opts.maxFindingsPerType=100] - cap to prevent
 *   pathological inputs from blowing up the payload.
 * @param {number} [opts.maxSamples=3] - how many redacted samples
 *   to retain per type (the rest are counted, not sampled).
 * @returns {{
 *   hasPii: boolean,
 *   findings: Array<{
 *     type: string,
 *     count: number,
 *     samples: string[],   // redacted, NOT raw
 *     severity: string,
 *   }>,
 *   elapsedMs: number,
 * }}
 */
function scanForPii(text, opts = {}) {
  const start = Date.now();
  if (text == null) {
    return { hasPii: false, findings: [], elapsedMs: Date.now() - start };
  }
  const input = typeof text === "string" ? text : String(text);
  const patternTypes = Array.isArray(opts.patterns) && opts.patterns.length > 0
    ? opts.patterns
    : DEFAULT_PATTERN_TYPES;
  const maxFindingsPerType = Number.isFinite(opts.maxFindingsPerType) && opts.maxFindingsPerType > 0
    ? Math.floor(opts.maxFindingsPerType)
    : 100;
  const maxSamples = Number.isFinite(opts.maxSamples) && opts.maxSamples > 0
    ? Math.floor(opts.maxSamples)
    : 3;

  const findings = [];
  for (const ptype of patternTypes) {
    const def = PATTERNS[ptype];
    if (!def) continue;
    // Use exec() in a loop so we can stop early once we hit
    // maxFindingsPerType. Reset lastIndex to avoid carry-over from
    // previous calls (regex literals are shared).
    def.regex.lastIndex = 0;
    let count = 0;
    const samples = [];
    let m;
    while ((m = def.regex.exec(input)) !== null) {
      const matched = m[0];
      if (typeof def.validator === "function" && !def.validator(matched)) {
        // Reset lastIndex if exec returned an empty-string match
        // (would otherwise loop forever).
        if (m.index === def.regex.lastIndex) def.regex.lastIndex += 1;
        continue;
      }
      count += 1;
      if (samples.length < maxSamples) samples.push(_redactSample(matched));
      if (count >= maxFindingsPerType) break;
    }
    def.regex.lastIndex = 0;
    if (count > 0) {
      findings.push({
        type: def.type,
        count,
        samples,
        severity: def.severity,
      });
    }
  }

  return {
    hasPii: findings.length > 0,
    findings,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Redact PII in free-text. Used by the gate's "warn" mode to render
 * UI-safe text and by deep-scan tooling.
 *
 * Each detected occurrence becomes `[REDACTED:<type>]` so the
 * operator can see WHERE the redaction happened + WHAT type was
 * detected (for triage) without the original value.
 *
 * @param {string} text
 * @param {object} [opts] - same shape as scanForPii(opts)
 * @returns {string}
 */
function redactPii(text, opts = {}) {
  if (text == null) return "";
  let output = typeof text === "string" ? text : String(text);
  const patternTypes = Array.isArray(opts.patterns) && opts.patterns.length > 0
    ? opts.patterns
    : DEFAULT_PATTERN_TYPES;

  for (const ptype of patternTypes) {
    const def = PATTERNS[ptype];
    if (!def) continue;
    // Build a fresh non-global regex source so .replace() can use
    // a function-callback that consults the validator. We re-derive
    // the source so the registry's regex is never mutated.
    const reSource = def.regex.source;
    const reFlags = def.regex.flags.replace("g", "") + "g"; // ensure 'g'
    const safeRegex = new RegExp(reSource, reFlags);
    output = output.replace(safeRegex, (match) => {
      if (typeof def.validator === "function" && !def.validator(match)) {
        return match;
      }
      return `[REDACTED:${def.type}]`;
    });
  }
  return output;
}

module.exports = {
  scanForPii,
  redactPii,
  PATTERNS,
  DEFAULT_PATTERN_TYPES,
  // Lower-level helpers exposed for unit tests + future GOV-PII-1
  // deep-scan reuse.
  _isValidKrn,
  _isValidLuhn,
  _redactSample,
};
