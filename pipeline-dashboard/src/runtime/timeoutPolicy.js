// Slice RR0-a (Phase 2 / RELEASE-READY-0, 2026-05-05) — central timeout policy.
//
// What this module is
// ───────────────────
// A frozen registry of 3 named timeout presets + a resolver that maps
// (env, deploymentProfile) → frozen policy object. Existing callers
// (codex-runner / claude-runner / pipeline-executor / childSemaphore)
// can consult this instead of hardcoding `defaultTimeoutMs = 120000`
// scattered across the tree.
//
// Why this exists
// ───────────────
// Pre-RR0-a defaults reflect "interactive / development" tuning:
//   codex-runner:    120 s (2 min)
//   claude-runner:   180 s (3 min)
//   pipeline phase:  120 s (2 min)
//   child queue:      30 s
//
// In production deployments — especially when HARNESS_DEPLOYMENT_PROFILE
// is public-sector or finance-high-privacy — operators legitimately run
// 10-minute+ pipelines (long Codex critiques, large Claude patches,
// review sessions with multiple back-and-forths). The 120 s default
// kills these prematurely with a misleading "timeout" reason.
//
// Three presets land:
//
//   interactive (default; backward-compat)
//     codex 120 s / claude 180 s / phase 120 s / queue 30 s
//     The pre-RR0-a behavior — preserved verbatim so existing tests +
//     existing deployments see no change without explicit opt-in.
//
//   long_run
//     codex 20 min / claude 30 min / phase 20 min / queue 5 min
//     For batch / overnight / large-codebase scenarios. Operators
//     opt in via HARNESS_TIMEOUT_PRESET=long_run.
//
//   public_sector
//     codex 30 min / claude 45 min / phase 30 min / queue 2 min
//     Public-sector deployments need extra guard window for human-
//     review approval timeouts; the lower queue timeout reflects
//     "we want the operator to see queue depth fast even if the
//     working call is allowed to run long". Auto-applied when
//     deploymentProfile.publicSector === true (unless operator
//     explicitly picked another preset via env).
//
// Per-field env overrides ALWAYS win over preset:
//   HARNESS_CODEX_TIMEOUT_MS
//   HARNESS_CLAUDE_TIMEOUT_MS
//   HARNESS_PHASE_TIMEOUT_MS
//   HARNESS_CHILD_QUEUE_TIMEOUT_MS
//
// Override env values are clamped to [MIN_TIMEOUT_MS, MAX_TIMEOUT_MS]
// to refuse pathological values (0 / negative / 10-billion-ms).
//
// Why a separate module from deploymentProfile
// ────────────────────────────────────────────
// deploymentProfile resolves POSTURE (publicSector, plaintext,
// signing) — security + policy concerns. timeoutPolicy resolves
// EXECUTION DURATION concerns — operational fit. Different
// stakeholders edit them (security vs ops), different release
// cadence, different failure modes. Splitting modules keeps the
// frozen vocabulary uncluttered.
//
// Plan reference: RELEASE-READY-0 RR0-a (2026-05-05 user-supplied
// recommendation; SMART arc closeout queued the cap-movement landing
// to a separate field-evidence round).

"use strict";

const SCHEMA = "harness-timeout-policy/v1";

// Bounds for env override sanity. 100 ms is below any real-world
// dispatch; 4 hours covers the longest legitimately expected pipeline.
// Values outside the range fall back to the preset default with a
// noisy log (handled by the resolver).
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 4 * 60 * 60 * 1000;  // 4 hours

const PRESET_NAMES = Object.freeze({
  INTERACTIVE: "interactive",
  LONG_RUN: "long_run",
  PUBLIC_SECTOR: "public_sector",
});

// Frozen field shape — all 4 timeouts MUST be present in every preset.
// Authoring mistakes (missing field) throw at module load.
const REQUIRED_FIELDS = Object.freeze([
  "codexTimeoutMs",
  "claudeTimeoutMs",
  "phaseTimeoutMs",
  "childQueueTimeoutMs",
]);

const RAW_PRESETS = {
  interactive: {
    presetId: "interactive",
    label: "Interactive",
    description: "Pre-RR0-a defaults — short timeouts for interactive / development.",
    codexTimeoutMs:        120 * 1000,   //  2 min
    claudeTimeoutMs:       180 * 1000,   //  3 min
    phaseTimeoutMs:        120 * 1000,   //  2 min
    childQueueTimeoutMs:    30 * 1000,   // 30 sec
  },
  long_run: {
    presetId: "long_run",
    label: "Long-running",
    description: "Batch / overnight / large-codebase pipelines. Codex 20 min, Claude 30 min, phase 20 min, queue 5 min.",
    codexTimeoutMs:         20 * 60 * 1000,  // 20 min
    claudeTimeoutMs:        30 * 60 * 1000,  // 30 min
    phaseTimeoutMs:         20 * 60 * 1000,  // 20 min
    childQueueTimeoutMs:     5 * 60 * 1000,  //  5 min
  },
  public_sector: {
    presetId: "public_sector",
    label: "Public Sector",
    description: "Regulated deployments — extra guard window for human review. Codex 30 min, Claude 45 min, phase 30 min, queue 2 min.",
    codexTimeoutMs:         30 * 60 * 1000,  // 30 min
    claudeTimeoutMs:        45 * 60 * 1000,  // 45 min
    phaseTimeoutMs:         30 * 60 * 1000,  // 30 min
    childQueueTimeoutMs:     2 * 60 * 1000,  //  2 min
  },
};

// Validate + freeze each preset at module load. Catches typos /
// missing fields / out-of-range values at require() time, never at
// first resolve.
const PRESETS = Object.freeze(Object.entries(RAW_PRESETS).reduce((acc, [key, raw]) => {
  if (raw.presetId !== key) {
    throw new Error(`timeoutPolicy: presetId "${raw.presetId}" does not match key "${key}"`);
  }
  for (const field of REQUIRED_FIELDS) {
    const v = raw[field];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`timeoutPolicy: ${key}.${field} must be a finite number`);
    }
    if (v < MIN_TIMEOUT_MS || v > MAX_TIMEOUT_MS) {
      throw new Error(
        `timeoutPolicy: ${key}.${field}=${v} out of range [${MIN_TIMEOUT_MS}, ${MAX_TIMEOUT_MS}]`,
      );
    }
  }
  acc[key] = Object.freeze({
    presetId: raw.presetId,
    label: raw.label,
    description: raw.description,
    codexTimeoutMs: raw.codexTimeoutMs,
    claudeTimeoutMs: raw.claudeTimeoutMs,
    phaseTimeoutMs: raw.phaseTimeoutMs,
    childQueueTimeoutMs: raw.childQueueTimeoutMs,
  });
  return acc;
}, Object.create(null)));

const PRESET_IDS = Object.freeze(Object.keys(PRESETS).sort());

// ── Helpers ────────────────────────────────────────────────────────

function _resolvePresetId(env, deploymentProfile) {
  // env override beats everything
  const requested = env.HARNESS_TIMEOUT_PRESET;
  if (typeof requested === "string" && requested.length > 0) {
    if (PRESETS[requested]) return requested;
    // Unknown explicit preset — fall through to deployment profile
    // logic. Caller can grep the resolved preset to see if their env
    // value was honored. We deliberately don't throw because the
    // operator might be migrating presets and we want best-effort
    // resolution for boot stability.
  }
  // Public-sector posture → public_sector preset by default
  if (deploymentProfile && deploymentProfile.publicSector === true) {
    return PRESET_NAMES.PUBLIC_SECTOR;
  }
  return PRESET_NAMES.INTERACTIVE;
}

function _coerceOverride(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // Clamp to bounds — refuse 0 / negative / pathologically large.
  if (n < MIN_TIMEOUT_MS) return fallback;
  if (n > MAX_TIMEOUT_MS) return fallback;
  return Math.floor(n);
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Resolve the runtime timeout policy from env + deploymentProfile.
 *
 * Precedence (high → low):
 *   1. HARNESS_<field>_TIMEOUT_MS (per-field override, clamped)
 *   2. HARNESS_TIMEOUT_PRESET (named preset)
 *   3. deploymentProfile.publicSector → public_sector
 *   4. interactive (backward-compat default)
 *
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {object} [opts.deploymentProfile] - resolveDeploymentProfile() result
 * @returns {Readonly<{
 *   schema: string,
 *   preset: string,                   // resolved preset id
 *   presetLabel: string,
 *   codexTimeoutMs: number,
 *   claudeTimeoutMs: number,
 *   phaseTimeoutMs: number,
 *   childQueueTimeoutMs: number,
 *   overrides: Readonly<{
 *     codexTimeoutMs: boolean,        // true when env override applied
 *     claudeTimeoutMs: boolean,
 *     phaseTimeoutMs: boolean,
 *     childQueueTimeoutMs: boolean,
 *   }>,
 *   sources: {
 *     resolvedFromEnv: boolean,        // explicit HARNESS_TIMEOUT_PRESET picked
 *     resolvedFromPosture: boolean,    // deploymentProfile.publicSector picked
 *   },
 * }>}
 */
function resolveTimeoutPolicy(opts = {}) {
  const env = opts.env || (typeof process !== "undefined" ? process.env : {});
  const dp = opts.deploymentProfile || null;

  const presetId = _resolvePresetId(env, dp);
  const preset = PRESETS[presetId];

  // Per-field overrides
  const codexOverride = _coerceOverride(env.HARNESS_CODEX_TIMEOUT_MS, null);
  const claudeOverride = _coerceOverride(env.HARNESS_CLAUDE_TIMEOUT_MS, null);
  const phaseOverride = _coerceOverride(env.HARNESS_PHASE_TIMEOUT_MS, null);
  const queueOverride = _coerceOverride(env.HARNESS_CHILD_QUEUE_TIMEOUT_MS, null);

  const explicitPreset = typeof env.HARNESS_TIMEOUT_PRESET === "string"
    && env.HARNESS_TIMEOUT_PRESET.length > 0
    && PRESETS[env.HARNESS_TIMEOUT_PRESET];

  return Object.freeze({
    schema: SCHEMA,
    preset: presetId,
    presetLabel: preset.label,
    codexTimeoutMs:        codexOverride !== null ? codexOverride : preset.codexTimeoutMs,
    claudeTimeoutMs:       claudeOverride !== null ? claudeOverride : preset.claudeTimeoutMs,
    phaseTimeoutMs:        phaseOverride !== null ? phaseOverride : preset.phaseTimeoutMs,
    childQueueTimeoutMs:   queueOverride !== null ? queueOverride : preset.childQueueTimeoutMs,
    overrides: Object.freeze({
      codexTimeoutMs:      codexOverride !== null,
      claudeTimeoutMs:     claudeOverride !== null,
      phaseTimeoutMs:      phaseOverride !== null,
      childQueueTimeoutMs: queueOverride !== null,
    }),
    sources: Object.freeze({
      resolvedFromEnv: !!explicitPreset,
      resolvedFromPosture: !explicitPreset && !!(dp && dp.publicSector === true),
    }),
  });
}

/**
 * @param {string} presetId
 * @returns {object|undefined}
 */
function getPreset(presetId) {
  if (typeof presetId !== "string" || !presetId) return undefined;
  return PRESETS[presetId];
}

/**
 * @param {string} presetId
 * @returns {boolean}
 */
function isValidPresetId(presetId) {
  return typeof presetId === "string"
    && Object.prototype.hasOwnProperty.call(PRESETS, presetId);
}

/**
 * @returns {ReadonlyArray<{presetId, label, description}>}
 */
function listPresetSummaries() {
  return PRESET_IDS.map((id) => {
    const p = PRESETS[id];
    return {
      presetId: p.presetId,
      label: p.label,
      description: p.description,
    };
  });
}

module.exports = {
  SCHEMA,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  PRESET_NAMES,
  PRESET_IDS,
  PRESETS,
  REQUIRED_FIELDS,
  resolveTimeoutPolicy,
  getPreset,
  isValidPresetId,
  listPresetSummaries,
};
