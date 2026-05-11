// Slice RR0-a (Phase 2 / RELEASE-READY-0, 2026-05-05) — timeoutPolicy unit tests.
//
// Pins frozen vocabulary + 3-preset registry + resolver precedence
// matrix per plan §S §RR0-a.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const tp = require("../../src/runtime/timeoutPolicy");

// ── Frozen vocabulary ─────────────────────────────────────────────

test("timeoutPolicy: SCHEMA constant", () => {
  assert.equal(tp.SCHEMA, "orchestrator-timeout-policy/v1");
});

test("timeoutPolicy: MIN/MAX bounds are sane", () => {
  assert.equal(tp.MIN_TIMEOUT_MS, 100);
  assert.equal(tp.MAX_TIMEOUT_MS, 4 * 60 * 60 * 1000);  // 4 hours
});

test("timeoutPolicy: PRESET_NAMES has 3 frozen ids", () => {
  assert.ok(Object.isFrozen(tp.PRESET_NAMES));
  assert.equal(tp.PRESET_NAMES.INTERACTIVE, "interactive");
  assert.equal(tp.PRESET_NAMES.LONG_RUN, "long_run");
  assert.equal(tp.PRESET_NAMES.PUBLIC_SECTOR, "public_sector");
});

test("timeoutPolicy: PRESETS frozen with 3 entries", () => {
  assert.ok(Object.isFrozen(tp.PRESETS));
  assert.equal(Object.keys(tp.PRESETS).length, 3);
  for (const id of ["interactive", "long_run", "public_sector"]) {
    assert.ok(Object.isFrozen(tp.PRESETS[id]), `${id} must be frozen`);
  }
});

test("timeoutPolicy: PRESET_IDS sorted + frozen", () => {
  assert.ok(Object.isFrozen(tp.PRESET_IDS));
  assert.deepEqual(tp.PRESET_IDS, ["interactive", "long_run", "public_sector"]);
});

test("timeoutPolicy: REQUIRED_FIELDS frozen with 4 names", () => {
  assert.ok(Object.isFrozen(tp.REQUIRED_FIELDS));
  assert.deepEqual([...tp.REQUIRED_FIELDS].sort(), [
    "childQueueTimeoutMs",
    "claudeTimeoutMs",
    "codexTimeoutMs",
    "phaseTimeoutMs",
  ]);
});

// ── Per-preset value verification (anchors backwards-compat) ──────

test("interactive preset: matches pre-RR0-a hardcoded defaults", () => {
  const p = tp.getPreset("interactive");
  // codex-runner.js:58 was 120000
  assert.equal(p.codexTimeoutMs, 120 * 1000);
  // claude-runner.js:49 was 180000
  assert.equal(p.claudeTimeoutMs, 180 * 1000);
  // pipeline-executor.js:1130 was 120000
  assert.equal(p.phaseTimeoutMs, 120 * 1000);
  // childSemaphore.js:25 was 30000
  assert.equal(p.childQueueTimeoutMs, 30 * 1000);
});

test("long_run preset: 10-30x interactive (operators expect minutes, not seconds)", () => {
  const p = tp.getPreset("long_run");
  assert.equal(p.codexTimeoutMs, 20 * 60 * 1000);
  assert.equal(p.claudeTimeoutMs, 30 * 60 * 1000);
  assert.equal(p.phaseTimeoutMs, 20 * 60 * 1000);
  assert.equal(p.childQueueTimeoutMs, 5 * 60 * 1000);
});

test("public_sector preset: longest tool timeouts + tight queue (visibility-first)", () => {
  const p = tp.getPreset("public_sector");
  assert.equal(p.codexTimeoutMs, 30 * 60 * 1000);
  assert.equal(p.claudeTimeoutMs, 45 * 60 * 1000);
  assert.equal(p.phaseTimeoutMs, 30 * 60 * 1000);
  assert.equal(p.childQueueTimeoutMs, 2 * 60 * 1000,
    "queue timeout deliberately tight so operator sees queue depth fast");
});

test("every preset has all REQUIRED_FIELDS within MIN/MAX bounds", () => {
  for (const id of tp.PRESET_IDS) {
    const p = tp.getPreset(id);
    for (const field of tp.REQUIRED_FIELDS) {
      assert.equal(typeof p[field], "number", `${id}.${field}`);
      assert.ok(p[field] >= tp.MIN_TIMEOUT_MS, `${id}.${field} below MIN`);
      assert.ok(p[field] <= tp.MAX_TIMEOUT_MS, `${id}.${field} above MAX`);
    }
  }
});

// ── getPreset / isValidPresetId / listPresetSummaries ────────────

test("getPreset: returns frozen for known id", () => {
  const p = tp.getPreset("long_run");
  assert.ok(Object.isFrozen(p));
  assert.equal(p.presetId, "long_run");
});

test("getPreset: undefined for unknown / non-string", () => {
  assert.equal(tp.getPreset("nonsense"), undefined);
  assert.equal(tp.getPreset(""), undefined);
  assert.equal(tp.getPreset(null), undefined);
  assert.equal(tp.getPreset(42), undefined);
});

test("isValidPresetId: 3 known + reject unknowns", () => {
  assert.equal(tp.isValidPresetId("interactive"), true);
  assert.equal(tp.isValidPresetId("long_run"), true);
  assert.equal(tp.isValidPresetId("public_sector"), true);
  assert.equal(tp.isValidPresetId("LONG_RUN"), false);
  assert.equal(tp.isValidPresetId("longrun"), false);
  assert.equal(tp.isValidPresetId(""), false);
  assert.equal(tp.isValidPresetId(null), false);
});

test("listPresetSummaries: strips internal numeric fields, keeps id+label+description", () => {
  const summaries = tp.listPresetSummaries();
  assert.equal(summaries.length, 3);
  for (const s of summaries) {
    assert.ok(typeof s.presetId === "string");
    assert.ok(typeof s.label === "string");
    assert.ok(typeof s.description === "string");
    assert.equal(s.codexTimeoutMs, undefined);
    assert.equal(s.phaseTimeoutMs, undefined);
  }
});

// ── resolveTimeoutPolicy: precedence matrix ──────────────────────

test("resolve: empty env + standard posture → interactive (backward compat)", () => {
  const policy = tp.resolveTimeoutPolicy({ env: {}, deploymentProfile: { publicSector: false } });
  assert.equal(policy.preset, "interactive");
  assert.equal(policy.codexTimeoutMs, 120 * 1000);
  assert.equal(policy.claudeTimeoutMs, 180 * 1000);
  assert.equal(policy.sources.resolvedFromEnv, false);
  assert.equal(policy.sources.resolvedFromPosture, false);
});

test("resolve: empty env + public-sector posture → public_sector preset auto-applied", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: {},
    deploymentProfile: { publicSector: true },
  });
  assert.equal(policy.preset, "public_sector");
  assert.equal(policy.codexTimeoutMs, 30 * 60 * 1000);
  assert.equal(policy.sources.resolvedFromEnv, false);
  assert.equal(policy.sources.resolvedFromPosture, true);
});

test("resolve: ORCHESTRATOR_TIMEOUT_PRESET=long_run beats public-sector posture", () => {
  // Operator wants long_run even under public-sector — env wins
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_TIMEOUT_PRESET: "long_run" },
    deploymentProfile: { publicSector: true },
  });
  assert.equal(policy.preset, "long_run");
  assert.equal(policy.codexTimeoutMs, 20 * 60 * 1000);
  assert.equal(policy.sources.resolvedFromEnv, true);
  assert.equal(policy.sources.resolvedFromPosture, false);
});

test("resolve: unknown ORCHESTRATOR_TIMEOUT_PRESET → falls through to deployment profile logic", () => {
  // Operator typo'd preset — fall through to public_sector posture
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_TIMEOUT_PRESET: "speedy" },
    deploymentProfile: { publicSector: true },
  });
  assert.equal(policy.preset, "public_sector",
    "unknown preset falls through to posture-derived preset");
  assert.equal(policy.sources.resolvedFromEnv, false);
});

test("resolve: unknown preset + standard posture → interactive (final fallback)", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_TIMEOUT_PRESET: "speedy" },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.preset, "interactive");
});

test("resolve: missing deploymentProfile → interactive (defensive)", () => {
  const policy = tp.resolveTimeoutPolicy({ env: {} });
  assert.equal(policy.preset, "interactive");
});

test("resolve: missing env → uses process.env (defensive)", () => {
  // Just don't pass env; resolver uses process.env internally.
  // We can't mutate process.env safely in tests, but we can prove the
  // call doesn't throw + returns a valid frozen policy.
  const policy = tp.resolveTimeoutPolicy({ deploymentProfile: { publicSector: false } });
  assert.ok(Object.isFrozen(policy));
  assert.ok(typeof policy.codexTimeoutMs === "number");
});

// ── Per-field env overrides ──────────────────────────────────────

test("override: ORCHESTRATOR_CODEX_TIMEOUT_MS wins over preset value", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: {
      ORCHESTRATOR_TIMEOUT_PRESET: "long_run",
      ORCHESTRATOR_CODEX_TIMEOUT_MS: "5000",  // 5 seconds — much shorter than long_run's 20 min
    },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, 5000);
  // Other long_run values intact
  assert.equal(policy.claudeTimeoutMs, 30 * 60 * 1000);
  assert.equal(policy.overrides.codexTimeoutMs, true);
  assert.equal(policy.overrides.claudeTimeoutMs, false);
});

test("override: each of 4 fields overridable independently", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: {
      ORCHESTRATOR_CODEX_TIMEOUT_MS: "10000",
      ORCHESTRATOR_CLAUDE_TIMEOUT_MS: "20000",
      ORCHESTRATOR_PHASE_TIMEOUT_MS: "30000",
      ORCHESTRATOR_CHILD_QUEUE_TIMEOUT_MS: "40000",
    },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, 10000);
  assert.equal(policy.claudeTimeoutMs, 20000);
  assert.equal(policy.phaseTimeoutMs, 30000);
  assert.equal(policy.childQueueTimeoutMs, 40000);
  assert.equal(policy.overrides.codexTimeoutMs, true);
  assert.equal(policy.overrides.claudeTimeoutMs, true);
  assert.equal(policy.overrides.phaseTimeoutMs, true);
  assert.equal(policy.overrides.childQueueTimeoutMs, true);
});

test("override: out-of-range value rejected (falls back to preset)", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: {
      ORCHESTRATOR_CODEX_TIMEOUT_MS: "0",      // below MIN
      ORCHESTRATOR_CLAUDE_TIMEOUT_MS: "-1000", // negative
      ORCHESTRATOR_PHASE_TIMEOUT_MS: "999999999", // above MAX
      ORCHESTRATOR_CHILD_QUEUE_TIMEOUT_MS: "abc", // not a number
    },
    deploymentProfile: { publicSector: false },
  });
  // All fall back to interactive preset
  assert.equal(policy.codexTimeoutMs, 120 * 1000);
  assert.equal(policy.claudeTimeoutMs, 180 * 1000);
  assert.equal(policy.phaseTimeoutMs, 120 * 1000);
  assert.equal(policy.childQueueTimeoutMs, 30 * 1000);
  assert.equal(policy.overrides.codexTimeoutMs, false,
    "rejected override does NOT count as applied");
  assert.equal(policy.overrides.claudeTimeoutMs, false);
  assert.equal(policy.overrides.phaseTimeoutMs, false);
  assert.equal(policy.overrides.childQueueTimeoutMs, false);
});

test("override: empty string env value treated as not set", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_CODEX_TIMEOUT_MS: "" },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, 120 * 1000);
  assert.equal(policy.overrides.codexTimeoutMs, false);
});

test("override: at MIN bound is accepted", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_CODEX_TIMEOUT_MS: String(tp.MIN_TIMEOUT_MS) },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, tp.MIN_TIMEOUT_MS);
});

test("override: at MAX bound is accepted", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_CODEX_TIMEOUT_MS: String(tp.MAX_TIMEOUT_MS) },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, tp.MAX_TIMEOUT_MS);
});

test("override: floored to integer (operators may pass float)", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_CODEX_TIMEOUT_MS: "5000.7" },
    deploymentProfile: { publicSector: false },
  });
  assert.equal(policy.codexTimeoutMs, 5000);
});

// ── Returned policy shape ────────────────────────────────────────

test("policy: returned object is frozen + carries schema + overrides + sources", () => {
  const policy = tp.resolveTimeoutPolicy({ env: {}, deploymentProfile: null });
  assert.ok(Object.isFrozen(policy));
  assert.ok(Object.isFrozen(policy.overrides));
  assert.ok(Object.isFrozen(policy.sources));
  assert.equal(policy.schema, "orchestrator-timeout-policy/v1");
  assert.throws(() => { policy.codexTimeoutMs = 999; });
});

test("policy: presetLabel populated from registry", () => {
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_TIMEOUT_PRESET: "long_run" },
  });
  assert.equal(policy.presetLabel, "Long-running");
});

// ── End-to-end: realistic public-sector + long-run hybrid ────────

test("end-to-end: public-sector posture + per-field codex override (operator dial)", () => {
  // Operator on public-sector wants the longer Claude timeouts but
  // shorter Codex (specific to their fast-Codex deployment).
  const policy = tp.resolveTimeoutPolicy({
    env: { ORCHESTRATOR_CODEX_TIMEOUT_MS: "60000" },  // 1 min
    deploymentProfile: { publicSector: true },
  });
  assert.equal(policy.preset, "public_sector");
  assert.equal(policy.codexTimeoutMs, 60000,           "codex override applied");
  assert.equal(policy.claudeTimeoutMs, 45 * 60 * 1000, "claude inherits public_sector preset");
  assert.equal(policy.phaseTimeoutMs, 30 * 60 * 1000,  "phase inherits public_sector preset");
  assert.equal(policy.overrides.codexTimeoutMs, true);
  assert.equal(policy.overrides.claudeTimeoutMs, false);
});
