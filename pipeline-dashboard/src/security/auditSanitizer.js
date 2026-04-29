// Slice D1-f (Phase E1 productization, 2026-04-29) — audit data sanitizer.
//
// Last line of defense for the EvidenceLedger: every append() call
// runs its `data` payload through this sanitizer before computing
// the dataHash and writing the JSONL entry. Even if upstream callers
// (audit verbs in credentialStore, profileStore, profileSpawn,
// profileRoutes, runners) accidentally include a secret value, the
// sanitizer redacts it before it lands on disk.
//
// Threat model:
//
//   The audit verbs we added in D1-a..e are CAREFULLY constructed to
//   never include secret values:
//     credential_set        → {profileId, key, backend}      (key NAME only)
//     credential_deleted    → {profileId, key, backend}
//     profile_spawn_env_built → {profileId, runner,
//                                secretsInjected: NUMBER,
//                                workspacePath, runId}
//     profile_*             → {profileId, label, accountType,
//                                workspaceMode, secretCount: NUMBER}
//
//   But:
//     1. A future audit verb might forget the redaction discipline
//        (wrong field name like `secret` instead of `secretCount`).
//     2. Hooks routed via `runner_hook_routed` (R1-k2) carry tool
//        + hook + runId — but a pathological tool name with
//        "TOKEN" in it could be added in the future.
//     3. The PII scanner (Task 4 of public-sector-hardening-plan.md)
//        will produce `pii_scan_*` audit rows where a regex
//        false-negative could leak a real secret into the data.
//
//   The sanitizer is the single chokepoint for catching all three.
//
// Strategy:
//
//   Walk the data tree. For every key whose name matches
//   SENSITIVE_KEY_RE (TOKEN | SECRET | KEY | PASSWORD | CREDENTIAL,
//   case-insensitive — matches P0's envFilter regex), replace the
//   VALUE with a structured redaction marker:
//
//       { "redacted": true, "reason": "key_name_matches_sensitive",
//         "keyName": "ANTHROPIC_API_KEY", "originalType": "string",
//         "approxLength": 51 }
//
//   The marker preserves audit usefulness — operators can see
//   "yes a value WAS here, it was a 51-char string" without seeing
//   the value itself.
//
// Defenses against pathological inputs:
//
//   1. Depth limit: walks max 16 levels deep (prevents stack overflow
//      on circular refs / accidentally deep nesting).
//   2. Prototype pollution: skips keys "__proto__", "constructor",
//      "prototype" entirely (never copies, never recurses into them).
//   3. Non-object non-array primitives are returned as-is.
//   4. Circular references: a Set tracks visited objects; revisit
//      replaces with a "[circular]" marker string.
//
// What this sanitizer does NOT do:
//
//   - PII scanning (that's Task 4: piiScanner.js with regex/Luhn/
//     RRN-checksum validators on string CONTENT, not key names).
//     Audit data should ALREADY be free of PII before it reaches the
//     ledger; PII scanning happens on inbound provider prompts and
//     outbound tool results, not on audit payloads.
//   - Field allowlisting (the sanitizer is permissive — it only
//     redacts what looks like a secret by key name). A stricter
//     allowlist would belong to a per-verb schema, not a global
//     sanitizer.

"use strict";

// SAME regex as src/security/envFilter.js so audit + spawn-env share
// one definition of "secret-shaped key name". Importing the constant
// directly would create a cycle (envFilter doesn't depend on audit
// stuff today, but defensive).
const SENSITIVE_KEY_RE = /TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL/i;

// Keys we always skip. Prototype-pollution guard: even if a malicious
// caller manages to inject one of these into a data payload, the
// sanitizer never recurses into them so the polluted payload can't
// shape-shift a downstream consumer's interpretation.
const PROTO_KEYS = Object.freeze(new Set(["__proto__", "constructor", "prototype"]));

// Field names that contain key-shaped substrings but are themselves
// metadata, not secret values. Without this allowlist the sanitizer
// would over-redact: e.g. `profileSpawn` writes `secretsInjected: 1`
// (a count) and `secretsKeys: ["ANTHROPIC_API_KEY"]` (key NAMES, not
// values). The sanitizer must keep these visible — they're the
// audit metadata operators rely on.
const SAFE_KEY_NAMES = Object.freeze(new Set([
  "secretCount",      // profileStore audit (number)
  "secretsInjected",  // profileSpawn audit (number)
  "secretsKeys",      // profileSpawn audit (array of key names — D1-f keeps as-is)
  "secretIds",        // profileStore profile shape (array of key names)
  "key",              // credential_set/deleted audit (the key NAME, not value)
  "keyName",          // sanitizer's own redaction marker (defensive)
  "keyId",            // R2 future kid field (key id, not value)
  "credentialBackend",// profileStore profile shape (e.g. "wincred", "keychain")
  "publicKey",        // future signature verifications
]));

// Maximum recursion depth. 16 is generous — the deepest legitimate
// audit data we emit today nests ~3 levels (system/policyDecision/
// dangerGate result). 16 catches accidental nesting without limiting
// real use.
const MAX_DEPTH = 16;

/**
 * Recursively sanitize an audit data payload.
 *
 * @param {*} data
 * @param {object} [opts]
 * @param {Set<string>} [opts.extraSafeKeys] - additional key names to
 *   keep verbatim even if they match SENSITIVE_KEY_RE. Lets a callsite
 *   opt-in audit fields without globally widening the allowlist.
 * @returns {*} sanitized copy (never the original reference)
 */
function sanitizeAuditData(data, opts = {}) {
  const extraSafeKeys = opts.extraSafeKeys instanceof Set
    ? opts.extraSafeKeys
    : new Set(opts.extraSafeKeys || []);
  return _walk(data, 0, new WeakSet(), extraSafeKeys);
}

function _walk(value, depth, seen, extraSafeKeys) {
  if (depth > MAX_DEPTH) return "[truncated:depth_limit]";

  // Primitives + null/undefined: return as-is. typeof null === "object"
  // — guard explicitly.
  if (value === null || typeof value !== "object") return value;

  // Cycle guard. WeakSet so GC isn't blocked.
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i += 1) {
      out.push(_walk(value[i], depth + 1, seen, extraSafeKeys));
    }
    return out;
  }

  // Plain object. Use Object.keys (own enumerable) so we don't accidentally
  // walk inherited properties (which would be a prototype-pollution risk).
  const out = {};
  for (const k of Object.keys(value)) {
    if (PROTO_KEYS.has(k)) continue;
    const v = value[k];
    if (SENSITIVE_KEY_RE.test(k) && !SAFE_KEY_NAMES.has(k) && !extraSafeKeys.has(k)) {
      out[k] = _redactionMarker(k, v);
    } else {
      out[k] = _walk(v, depth + 1, seen, extraSafeKeys);
    }
  }
  return out;
}

/**
 * Build a structured redaction marker. Preserves enough metadata that
 * a forensic review can confirm "yes, a value was here" without seeing
 * the value itself.
 */
function _redactionMarker(keyName, originalValue) {
  const originalType = originalValue === null ? "null" : Array.isArray(originalValue) ? "array" : typeof originalValue;
  let approxLength = null;
  if (typeof originalValue === "string") approxLength = originalValue.length;
  else if (Array.isArray(originalValue)) approxLength = originalValue.length;
  return {
    redacted: true,
    reason: "key_name_matches_sensitive",
    keyName,
    originalType,
    approxLength,
  };
}

module.exports = {
  sanitizeAuditData,
  SENSITIVE_KEY_RE,
  PROTO_KEYS,
  SAFE_KEY_NAMES,
  MAX_DEPTH,
};
