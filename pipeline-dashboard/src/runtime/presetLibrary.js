// Slice S3-a (Phase 2 / SMART-3, 2026-05-04) — Expert review preset
// library.
//
// Why this exists
// ───────────────
// Operators today type review focus into a free-form prompt:
//   "보안 검토해 주세요" / "효율성 분석"
// The Codex/Claude system prompt that surrounds the prompt is shaped
// only by the dispatcher's hard-coded boilerplate ("provide a structured
// critique with [critical]/[high]/[medium]/[low] tags"). Two concrete
// problems:
//
//   1. Every operator re-invents the framing. "Security review" prompts
//      from one session vs. another diverge wildly. Findings are noisy.
//   2. Public-sector / regulated deployments need a known-good privacy
//      / audit posture preset that doesn't depend on operator phrasing.
//
// SMART-3 ships six FROZEN expert presets — accuracy / security /
// privacy / performance / release / public-sector-audit — each with a
// scoped Codex system prompt, a Claude hand-back system prompt, and a
// custom severity-tag instruction. The dispatcher merges these around
// the operator's free-form instruction; the routes layer validates
// presetId before the dispatcher sees it; the UI layer offers them in
// a dropdown.
//
// Compatibility
// ─────────────
// Every preset is OPTIONAL. Dispatching without `presetId` keeps the
// existing free-form behavior. Adding a preset is additive on every
// surface (route body, dispatcher kwarg, UI dropdown).
//
// Frozen guarantees
// ─────────────────
//   - PRESETS array (and each preset object inside it) is Object.freeze'd.
//   - PRESET_IDS is the canonical sorted list of valid presetId strings.
//   - Every system prompt is bounded — codex/claude system prompts are
//     deliberately authored to fit well below MAX_SYSTEM_PROMPT_BYTES
//     so the dispatcher's MAX_PROMPT_LENGTH (64KB total) is never the
//     bottleneck. (The bound below is for defense; current presets are
//     ~600-900 bytes each.)
//   - severityTagInstruction is the ONLY part each preset is allowed
//     to use to override the dispatcher's default tagging instruction.
//
// Why this is a runtime module not a JSON file
// ────────────────────────────────────────────
// Dispatcher + route validation + UI all need this at runtime. A JSON
// file would force a build step or a separate JSON loader. UMD module
// loaded in both Node (dispatcher, routes, tests) and browser (UI) is
// the only no-build path.
//
// Audit / observability
// ─────────────────────
// The dispatcher emits the resolved presetId (or null) in
// `review_session_dispatch_started` audit chain entries. UI shows the
// preset label in the action-row indicator. Tests assert the resolved
// preset propagates to audit data.

"use strict";

const SCHEMA = "orchestrator-review-preset/v1";

// Hard caps. Current presets sit at ~600-900 bytes per system prompt;
// the cap is 4 KiB (UTF-16 char count, not strict bytes — JS string
// length is fine for our purposes since presets are authored ASCII /
// Hangul-bounded).
const MAX_SYSTEM_PROMPT_LENGTH = 4 * 1024;
const MAX_SEVERITY_TAG_LENGTH = 1024;

// Canonical presets. Each entry is frozen at module load.
//
// Authoring rules:
//   - presetId: kebab-case, ASCII, stable across releases (it ends up
//     in audit-chain entries, route body validation, and the UI URL).
//   - defaultLabel: English fallback. UI prefers i18n keys
//     `smart.preset.${presetId}.label` and falls back to defaultLabel.
//   - codexSystemPrompt: framed as "you are reviewing for X. Focus on:
//     A, B, C. Do NOT focus on Y." Negative space matters as much as
//     positive — the operator's own instruction is appended after.
//   - claudeSystemPrompt: framed as "apply the operator's X fix.
//     Verify: …" — the hand-back path. Used when the operator clicks
//     "Hand back to Claude" with this preset selected.
//   - severityTagInstruction: REPLACES the dispatcher's default. The
//     four tags [critical]/[high]/[medium]/[low] always exist; the
//     preset specifies what each one MEANS in this domain.
const RAW_PRESETS = [
  {
    presetId: "accuracy",
    defaultLabel: "Accuracy",
    defaultDescription:
      "Logical correctness, edge cases, off-by-one, type confusion.",
    codexSystemPrompt:
      "You are reviewing code or plans for logical correctness. " +
      "Focus on: edge cases (off-by-one, null/undefined, empty arrays); " +
      "boundary conditions (overflow, integer wraparound, race conditions in " +
      "concurrent code); type-handling errors (wrong cast, wrong API " +
      "contract); and logic gaps (missing else branches, unhandled error " +
      "paths, silent failures).\n\n" +
      "Do NOT focus on style, performance, or security unless they directly " +
      "produce incorrect output. If the change is too small to have a " +
      "correctness impact, say so explicitly.",
    claudeSystemPrompt:
      "Apply the operator's correctness fix. Verify: each fix addresses a " +
      "specific finding from the critique; no regression to other behavior; " +
      "the fix is the minimum scope (don't expand the change set). If a " +
      "finding cannot be addressed safely in this round, say so and leave " +
      "it pending rather than guessing.",
    severityTagInstruction:
      "Use [critical] for incorrect output causing data loss or corruption, " +
      "[high] for incorrect output without data loss, [medium] for " +
      "likely-incorrect-but-uncertain (operator must investigate), [low] for " +
      "minor logic improvements that don't change current behavior.",
  },

  {
    presetId: "security",
    defaultLabel: "Security",
    defaultDescription:
      "Auth, injection, secrets, supply-chain, privilege escalation.",
    codexSystemPrompt:
      "You are reviewing code or plans for security vulnerabilities. " +
      "Focus on: injection vectors (SQL, command, path traversal, prototype " +
      "pollution); authentication/authorization (missing checks, privilege " +
      "escalation, broken session handling); secret/credential leakage " +
      "(logs, error messages, env vars in URLs, telemetry); supply-chain " +
      "risks (untrusted dependencies, missing integrity checks); and data " +
      "exposure (PII in responses, info disclosure, verbose errors in prod).\n\n" +
      "Do NOT focus on correctness or performance unless they directly " +
      "enable an attack. Always state the attacker model (external user / " +
      "authenticated user / co-tenant) for each finding.",
    claudeSystemPrompt:
      "Apply the operator's security fix. Verify: no new attack surface " +
      "introduced; defenses use established patterns (parameterized " +
      "queries, allowlists, framework auth helpers); the fix doesn't break " +
      "legitimate functionality. If the fix introduces a new dependency, " +
      "call it out so the supply-chain review can run again.",
    severityTagInstruction:
      "Use [critical] for RCE, auth bypass, or unauthenticated data access. " +
      "[high] for authenticated data exfiltration or privilege escalation. " +
      "[medium] for info disclosure or weak/inconsistent defenses. [low] " +
      "for hardening opportunities with no current exploit path.",
  },

  {
    presetId: "privacy",
    defaultLabel: "Privacy",
    defaultDescription:
      "PII handling, KRN/SSN/email leaks, retention, data-minimization.",
    codexSystemPrompt:
      "You are reviewing for personal-data (privacy) risks. Focus on: PII " +
      "exposure in logs / audit-chain / responses (Korean Resident Numbers " +
      "(KRN), SSN, email, phone, addresses); retention violations (data " +
      "persisted longer than its declared TTL); data minimization (more " +
      "data collected/stored than needed for the function); cross-border " +
      "or cross-tenant transfer risks; and consent gaps (data collected " +
      "before consent or after withdrawal).\n\n" +
      "Public-sector posture: assume strict redaction is mandatory and " +
      "that any plaintext-PII path is a finding even if 'access controlled'. " +
      "Do NOT focus on security primitives unless they directly cause PII " +
      "leakage. Treat 'not yet implemented' redaction as [critical].",
    claudeSystemPrompt:
      "Apply the operator's privacy fix. Verify: redaction is consistent " +
      "across every code path that touches the field, not just one; TTL / " +
      "retention windows are enforced (not advisory); consent records (if " +
      "any) are intact through the change; and audit-chain entries don't " +
      "leak the redacted value.",
    severityTagInstruction:
      "Use [critical] for KRN/SSN raw exposure or missing-redaction in " +
      "audit-chain. [high] for email/phone exposure, retention violation, " +
      "or cross-tenant leakage. [medium] for data-minimization gaps. [low] " +
      "for hardening (additional redaction layers, defense-in-depth).",
  },

  {
    presetId: "performance",
    defaultLabel: "Performance",
    defaultDescription:
      "Hot paths, memory leaks, N+1, sync work in event loops.",
    codexSystemPrompt:
      "You are reviewing for performance issues. Focus on: hot paths with " +
      "N+1 queries or O(n²) loops; memory leaks (unbounded arrays, retained " +
      "closures, listener leaks, never-cleared caches); expensive " +
      "synchronous work in event loops or render paths; missing indexes / " +
      "caches where the access pattern is read-heavy; and lock contention.\n\n" +
      "Do NOT focus on correctness unless a perf optimization breaks " +
      "behavior. Always estimate complexity (Big-O or 'a few ms vs. seconds') " +
      "for each finding so the operator can prioritize.",
    claudeSystemPrompt:
      "Apply the operator's performance fix. Verify: complexity reduction " +
      "is real (back-of-envelope check); no measurable regression to other " +
      "paths; benchmarks (if mentioned) actually exercise the changed code. " +
      "If the change adds caching, verify the cache-invalidation story.",
    severityTagInstruction:
      "Use [critical] for outage-grade issues (unbounded memory, infinite " +
      "loop, lock-up). [high] for measurable user-visible latency (>500ms " +
      "regression on hot paths). [medium] for resource waste without user " +
      "impact (extra DB calls, retained memory under typical load). [low] " +
      "for polish (micro-optimizations, allocator hints).",
  },

  {
    presetId: "release",
    defaultLabel: "Release Readiness",
    defaultDescription:
      "Rollout safety, manifest signing, backward compat, audit coverage.",
    codexSystemPrompt:
      "You are reviewing release-readiness. Focus on: rollout safety " +
      "(gradual deploy or feature-flag, rollback path, blast radius); " +
      "manifest integrity (signed bundle, SBOM up-to-date, SHA256 / " +
      "Ed25519 / cosign claims match the artifact); backward compat " +
      "(API-shape changes, schema migrations, env-var defaults); " +
      "audit-chain coverage (every state-changing operation emits exactly " +
      "one audit verb from a frozen prefix); and operator runbook freshness " +
      "(docs match the new code).\n\n" +
      "Do NOT focus on raw correctness or performance unless they affect " +
      "rollout safety. Call out 'cannot rollback' findings explicitly.",
    claudeSystemPrompt:
      "Apply the operator's release-prep fix. Verify: SBOM is still valid " +
      "after the change; version bumps are SemVer-correct (no breaking " +
      "change in a minor); all flags / env vars added are documented in the " +
      "runbook AND have a sensible default; audit-chain emits exactly one " +
      "new verb per new state transition.",
    severityTagInstruction:
      "Use [critical] for missing-rollback, unsigned-release-shipped, or " +
      "irrecoverable schema-migration. [high] for breaking-change-without-" +
      "flag or audit-chain-coverage-gap. [medium] for missing-docs / " +
      "outdated runbooks. [low] for cleanup or naming polish.",
  },

  {
    presetId: "public-sector-audit",
    defaultLabel: "Public-Sector Audit",
    defaultDescription:
      "Korean public-sector posture; audit-chain depth, evidence-export, signing.",
    codexSystemPrompt:
      "You are reviewing under public-sector / regulated-deployment posture. " +
      "Focus on: every state-changing action emits exactly one audit verb " +
      "(frozen prefix family, e.g. `review_session_dispatch_*`); " +
      "evidence-export bundles are HMAC-signed and verifiable offline " +
      "(operator can hand a bundle to an auditor without a network); " +
      "manifest-signing keys live in the trust-store with a documented " +
      "rotation path (`trust_store_key_added` audit row exists); PII " +
      "redaction is enforced at write time, not advisory; and every gate " +
      "is fail-closed (e.g., unsigned manifest blocks install rather than " +
      "warning).\n\n" +
      "If you see a fail-open path or a 'plaintext-allowed-with-warn' env " +
      "escape that's reachable in production, that is automatically " +
      "[critical]. Public-sector posture has zero tolerance for fail-open.",
    claudeSystemPrompt:
      "Apply the operator's public-sector compliance fix. Verify: audit-" +
      "chain coverage of the change (one verb per transition); no fail-" +
      "open paths introduced; trust-store / signing-key changes go through " +
      "the documented rotation; sample evidence bundle from this change " +
      "verifies offline. If the operator's instruction conflicts with " +
      "fail-closed posture, refuse and explain why.",
    severityTagInstruction:
      "Use [critical] for missing-audit-row, fail-open path, private-key " +
      "leakage, or PII written without redaction. [high] for incomplete " +
      "audit-chain coverage, weak/legacy signing-key, or evidence-bundle " +
      "that doesn't verify offline. [medium] for advisory-only redaction. " +
      "[low] for hardening (additional audit-row depth, additional rotation " +
      "metadata).",
  },
];

// Validate + freeze each preset at module load. This is intentionally
// strict so an authoring mistake is caught at require()-time rather
// than at first dispatch.
const PRESETS = Object.freeze(RAW_PRESETS.map((raw) => {
  if (typeof raw.presetId !== "string" || !/^[a-z][a-z0-9-]*$/.test(raw.presetId)) {
    throw new Error(`presetLibrary: invalid presetId "${raw.presetId}"`);
  }
  if (typeof raw.defaultLabel !== "string" || raw.defaultLabel.length === 0) {
    throw new Error(`presetLibrary: ${raw.presetId} missing defaultLabel`);
  }
  if (typeof raw.codexSystemPrompt !== "string"
    || raw.codexSystemPrompt.length === 0
    || raw.codexSystemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new Error(
      `presetLibrary: ${raw.presetId} codexSystemPrompt must be 1..${MAX_SYSTEM_PROMPT_LENGTH} chars`,
    );
  }
  if (typeof raw.claudeSystemPrompt !== "string"
    || raw.claudeSystemPrompt.length === 0
    || raw.claudeSystemPrompt.length > MAX_SYSTEM_PROMPT_LENGTH) {
    throw new Error(
      `presetLibrary: ${raw.presetId} claudeSystemPrompt must be 1..${MAX_SYSTEM_PROMPT_LENGTH} chars`,
    );
  }
  if (typeof raw.severityTagInstruction !== "string"
    || raw.severityTagInstruction.length === 0
    || raw.severityTagInstruction.length > MAX_SEVERITY_TAG_LENGTH) {
    throw new Error(
      `presetLibrary: ${raw.presetId} severityTagInstruction must be 1..${MAX_SEVERITY_TAG_LENGTH} chars`,
    );
  }
  return Object.freeze({
    presetId: raw.presetId,
    defaultLabel: raw.defaultLabel,
    defaultDescription: raw.defaultDescription || "",
    codexSystemPrompt: raw.codexSystemPrompt,
    claudeSystemPrompt: raw.claudeSystemPrompt,
    severityTagInstruction: raw.severityTagInstruction,
  });
}));

const PRESET_IDS = Object.freeze(PRESETS.map((p) => p.presetId).sort());
const PRESET_BY_ID = Object.freeze(PRESETS.reduce((acc, p) => {
  acc[p.presetId] = p;
  return acc;
}, Object.create(null)));

/**
 * Resolve a presetId to its frozen preset object.
 *
 * @param {string} presetId
 * @returns {object|undefined} frozen preset or undefined for unknown id
 */
function getPreset(presetId) {
  if (typeof presetId !== "string" || presetId.length === 0) return undefined;
  return PRESET_BY_ID[presetId];
}

/**
 * @param {string} presetId
 * @returns {boolean}
 */
function isValidPresetId(presetId) {
  return typeof presetId === "string"
    && Object.prototype.hasOwnProperty.call(PRESET_BY_ID, presetId);
}

/**
 * Public list — UI dropdown source. Returns the frozen preset array
 * (callers MUST NOT mutate; the array + each entry is frozen).
 *
 * @returns {ReadonlyArray<object>}
 */
function listPresets() {
  return PRESETS;
}

/**
 * Slim summary suitable for shipping to the browser without leaking
 * the full prompt text. UI dropdown only needs id + label + description.
 *
 * @returns {ReadonlyArray<{presetId, defaultLabel, defaultDescription}>}
 */
function listPresetSummaries() {
  return PRESETS.map((p) => ({
    presetId: p.presetId,
    defaultLabel: p.defaultLabel,
    defaultDescription: p.defaultDescription,
  }));
}

module.exports = {
  SCHEMA,
  MAX_SYSTEM_PROMPT_LENGTH,
  MAX_SEVERITY_TAG_LENGTH,
  PRESETS,
  PRESET_IDS,
  getPreset,
  isValidPresetId,
  listPresets,
  listPresetSummaries,
};
