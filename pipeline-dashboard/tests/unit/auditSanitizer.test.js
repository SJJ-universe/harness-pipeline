// tests/unit/auditSanitizer.test.js — Slice D1-f (Phase E1, 2026-04-29)
//
// Tests the recursive secret-value sanitizer that EvidenceLedger.append
// runs before hashing. Verifies:
//
//   1. Sensitive-key-name detection (TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL,
//      case-insensitive — same regex as src/security/envFilter.js).
//   2. SAFE_KEY_NAMES allowlist preserves audit metadata fields
//      (secretCount, secretsInjected, secretsKeys, secretIds, key,
//      keyName, keyId, credentialBackend, publicKey).
//   3. Prototype-pollution resistance: __proto__ / constructor /
//      prototype keys never recurse, never leak.
//   4. Cycle protection: circular references replaced with [circular]
//      string (no stack overflow).
//   5. Depth limit: deep-nested input replaced with [truncated:depth_limit].
//   6. Redaction marker preserves operator-useful metadata
//      (originalType + approxLength) without the value.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  sanitizeAuditData,
  SENSITIVE_KEY_RE,
  SAFE_KEY_NAMES,
  PROTO_KEYS,
  MAX_DEPTH,
} = require("../../src/security/auditSanitizer");

// ─────────────────────────────────────────────────────────────────
//  PRIMITIVES + NULL/UNDEFINED
// ─────────────────────────────────────────────────────────────────

test("D1-f: primitives pass through unchanged", () => {
  assert.equal(sanitizeAuditData(42), 42);
  assert.equal(sanitizeAuditData("hello"), "hello");
  assert.equal(sanitizeAuditData(true), true);
  assert.equal(sanitizeAuditData(null), null);
  assert.equal(sanitizeAuditData(undefined), undefined);
});

test("D1-f: returns a NEW object (never mutates input)", () => {
  const input = { a: 1, b: { c: 2 } };
  const out = sanitizeAuditData(input);
  assert.notEqual(out, input);
  assert.notEqual(out.b, input.b, "nested objects also defensively copied");
  // Mutate the input — output must not change.
  input.a = 999;
  assert.equal(out.a, 1);
});

// ─────────────────────────────────────────────────────────────────
//  SENSITIVE-KEY DETECTION
// ─────────────────────────────────────────────────────────────────

test("D1-f: redacts values whose key name contains TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL", () => {
  const input = {
    HARNESS_TOKEN: "leak-token",
    ANTHROPIC_API_KEY: "leak-key",
    OPENAI_SECRET: "leak-secret",
    USER_PASSWORD: "leak-pwd",
    AWS_CREDENTIAL: "leak-cred",
    // Mixed case — must still match (case-insensitive).
    My_Token_Was_Here: "leak-mixed",
  };
  const out = sanitizeAuditData(input);

  for (const k of Object.keys(input)) {
    assert.equal(typeof out[k], "object", `${k} must be redacted to a marker object`);
    assert.equal(out[k].redacted, true);
    assert.equal(out[k].keyName, k);
    assert.equal(out[k].originalType, "string");
    // CRITICAL: the original VALUE must NEVER appear in the output.
    const text = JSON.stringify(out);
    assert.ok(!text.includes(input[k]),
      `original value "${input[k]}" must NEVER appear in sanitized output`);
  }
});

test("D1-f: non-sensitive keys pass through unchanged", () => {
  const input = {
    profileId: "personal",
    workspacePath: "/tmp/ws",
    activeProvider: "claude",
    label: "My Profile",
    runId: "r-12345",
    nestedObject: { ok: true },
  };
  const out = sanitizeAuditData(input);
  assert.deepEqual(out, input);
});

// ─────────────────────────────────────────────────────────────────
//  SAFE_KEY_NAMES allowlist
// ─────────────────────────────────────────────────────────────────

test("D1-f: SAFE_KEY_NAMES preserves audit metadata that has 'key' or 'secret' substring", () => {
  // These keys all match SENSITIVE_KEY_RE but are AUDIT METADATA
  // (counts, key NAMES, backend names) — never values. Allowlisting
  // them keeps the audit trail useful.
  const input = {
    secretCount: 3,                            // count, not a value
    secretsInjected: 2,                        // count, not a value
    secretsKeys: ["ANTHROPIC_API_KEY"],         // key names, not values
    secretIds: ["A", "B"],                     // key names, not values
    key: "ANTHROPIC_API_KEY",                  // a NAME, not a value
    keyName: "OPENAI_API_KEY",                 // sanitizer's own marker
    keyId: "kid-2026",                          // R2 future field
    credentialBackend: "wincred",               // backend name
    publicKey: "MIIBIjANBgkqh…",                // public — by definition not secret
  };
  const out = sanitizeAuditData(input);
  assert.deepEqual(out, input,
    "every SAFE_KEY_NAMES entry must pass through verbatim");
});

test("D1-f: extraSafeKeys option lets a callsite opt-in additional safe names", () => {
  const input = { CUSTOM_TOKEN_LIKE_BUT_NOT_SECRET: "metadata-not-a-value" };
  // Default: redacted.
  const noOpt = sanitizeAuditData(input);
  assert.equal(noOpt.CUSTOM_TOKEN_LIKE_BUT_NOT_SECRET.redacted, true);
  // With opt-in: passes through.
  const withOpt = sanitizeAuditData(input, {
    extraSafeKeys: ["CUSTOM_TOKEN_LIKE_BUT_NOT_SECRET"],
  });
  assert.equal(withOpt.CUSTOM_TOKEN_LIKE_BUT_NOT_SECRET, "metadata-not-a-value");
});

// ─────────────────────────────────────────────────────────────────
//  RECURSION (NESTED OBJECTS + ARRAYS)
// ─────────────────────────────────────────────────────────────────

test("D1-f: redacts inside nested objects", () => {
  const input = {
    outer: {
      inner: {
        ANTHROPIC_API_KEY: "sk-deep-leak",
      },
    },
  };
  const out = sanitizeAuditData(input);
  assert.equal(out.outer.inner.ANTHROPIC_API_KEY.redacted, true);
  assert.ok(!JSON.stringify(out).includes("sk-deep-leak"));
});

test("D1-f: redacts inside arrays of objects", () => {
  const input = {
    items: [
      { OPENAI_API_KEY: "sk-list-1" },
      { OPENAI_API_KEY: "sk-list-2" },
    ],
  };
  const out = sanitizeAuditData(input);
  assert.equal(out.items[0].OPENAI_API_KEY.redacted, true);
  assert.equal(out.items[1].OPENAI_API_KEY.redacted, true);
  assert.ok(!JSON.stringify(out).includes("sk-list-"));
});

// ─────────────────────────────────────────────────────────────────
//  PROTOTYPE-POLLUTION RESISTANCE
// ─────────────────────────────────────────────────────────────────

test("D1-f: skips __proto__ / constructor / prototype keys (no recurse, no leak)", () => {
  // Build an object with a __proto__ payload via Object.defineProperty
  // (just `obj.__proto__ = {...}` would assign to the prototype chain
  // instead of creating an own property — Object.defineProperty
  // creates the own property explicitly).
  const input = {};
  Object.defineProperty(input, "__proto__", {
    value: { polluted: "leaked" },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(input, "constructor", {
    value: { polluted: "constructor-leak" },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(input, "prototype", {
    value: { polluted: "prototype-leak" },
    enumerable: true,
    writable: true,
    configurable: true,
  });
  // Avoid using a name that matches SENSITIVE_KEY_RE (e.g. "safeKey"
  // would match because of "Key" — we'd be testing redaction, not
  // proto-pollution). Use a clearly-safe field name instead.
  input.normalField = "kept";
  const out = sanitizeAuditData(input);
  // The __proto__ etc. keys must not appear as own enumerable
  // properties of the output.
  assert.ok(!Object.prototype.hasOwnProperty.call(out, "__proto__"));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, "constructor"));
  assert.ok(!Object.prototype.hasOwnProperty.call(out, "prototype"));
  // The legitimate field survives.
  assert.equal(out.normalField, "kept");
});

// ─────────────────────────────────────────────────────────────────
//  CYCLE PROTECTION + DEPTH LIMIT
// ─────────────────────────────────────────────────────────────────

test("D1-f: circular references replaced with [circular] (no stack overflow)", () => {
  const a = { name: "a" };
  const b = { name: "b", ref: a };
  a.ref = b; // cycle: a -> b -> a
  const out = sanitizeAuditData(a);
  // First level: a copied. Second level: b copied. Third level: a
  // already seen → [circular]. Or vice-versa depending on order, but
  // somewhere in the chain a [circular] marker must appear.
  const text = JSON.stringify(out);
  assert.ok(text.includes("[circular]"),
    `expected [circular] marker somewhere in output: ${text}`);
});

test("D1-f: depth-limited objects produce [truncated:depth_limit]", () => {
  // Build a chain deeper than MAX_DEPTH.
  let current = { leaf: true };
  for (let i = 0; i < MAX_DEPTH + 5; i += 1) {
    current = { nested: current };
  }
  const out = sanitizeAuditData(current);
  const text = JSON.stringify(out);
  assert.ok(text.includes("[truncated:depth_limit]"));
});

// ─────────────────────────────────────────────────────────────────
//  REDACTION MARKER SHAPE
// ─────────────────────────────────────────────────────────────────

test("D1-f: redaction marker preserves originalType + approxLength", () => {
  const cases = [
    { value: "sk-50-chars-total-................................-end", type: "string", lengthIs: 54 },
    { value: 42, type: "number", lengthIs: null },
    { value: true, type: "boolean", lengthIs: null },
    { value: null, type: "null", lengthIs: null },
    { value: ["a", "b"], type: "array", lengthIs: 2 },
    { value: { nested: 1 }, type: "object", lengthIs: null },
  ];
  for (const c of cases) {
    const out = sanitizeAuditData({ ANTHROPIC_API_KEY: c.value });
    const m = out.ANTHROPIC_API_KEY;
    assert.equal(m.redacted, true);
    assert.equal(m.reason, "key_name_matches_sensitive");
    assert.equal(m.keyName, "ANTHROPIC_API_KEY");
    assert.equal(m.originalType, c.type, `originalType for ${c.type}`);
    assert.equal(m.approxLength, c.lengthIs, `approxLength for ${c.type}`);
  }
});

// ─────────────────────────────────────────────────────────────────
//  EXPORTED CONSTANTS (regression guard)
// ─────────────────────────────────────────────────────────────────

test("D1-f: exported constants are stable", () => {
  assert.ok(SENSITIVE_KEY_RE.test("ANTHROPIC_API_KEY"));
  assert.ok(SENSITIVE_KEY_RE.test("Some_Token_Var"));
  assert.ok(SENSITIVE_KEY_RE.test("xCREDENTIALy"));
  assert.ok(!SENSITIVE_KEY_RE.test("PATH"));
  assert.ok(!SENSITIVE_KEY_RE.test("HOME"));

  assert.ok(SAFE_KEY_NAMES.has("secretCount"));
  assert.ok(SAFE_KEY_NAMES.has("secretsInjected"));
  assert.ok(Object.isFrozen(SAFE_KEY_NAMES));

  assert.ok(PROTO_KEYS.has("__proto__"));
  assert.ok(PROTO_KEYS.has("constructor"));
  assert.ok(PROTO_KEYS.has("prototype"));
  assert.ok(Object.isFrozen(PROTO_KEYS));

  assert.equal(typeof MAX_DEPTH, "number");
  assert.ok(MAX_DEPTH >= 8 && MAX_DEPTH <= 64,
    "MAX_DEPTH should be a sane non-trivial limit");
});
