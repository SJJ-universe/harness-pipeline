// Slice SMART-0-a (Phase D Round UI-P / Phase 2 SMART arc, 2026-05-04)
// — decisionContext shape contract + per-adapter branch tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const dc = require("../../src/runtime/decisionContext");
const {
  SCHEMA, BOOLEAN_KEYS, COUNT_KEYS, SOURCE_IDS,
  buildContext, _emptyOutput, _safeNumber,
} = dc;

// ── Frozen registry shape ───────────────────────────────────────

test("SMART-0: SCHEMA is documented constant", () => {
  assert.equal(SCHEMA, "harness-decision-context/v1");
});

test("SMART-0: BOOLEAN_KEYS frozen + 8 entries", () => {
  assert.ok(Object.isFrozen(BOOLEAN_KEYS));
  assert.equal(BOOLEAN_KEYS.length, 8);
  for (const key of [
    "hasPii", "approvalPending", "codexReviewMissing", "auditExportReady",
    "publicSector", "hasActiveProfile", "needsHumanDecision", "remoteRunnerActive",
  ]) {
    assert.ok(BOOLEAN_KEYS.includes(key), `missing boolean key "${key}"`);
  }
});

test("SMART-0: COUNT_KEYS frozen + 5 documented entries", () => {
  assert.ok(Object.isFrozen(COUNT_KEYS));
  assert.equal(COUNT_KEYS.length, 5);
  for (const key of [
    "activeRuns", "pendingApprovals", "openReviewSessions",
    "remoteRunnerCount", "evidenceLedgerEntries",
  ]) {
    assert.ok(COUNT_KEYS.includes(key), `missing count key "${key}"`);
  }
});

test("SMART-0: SOURCE_IDS frozen + 7 entries", () => {
  assert.ok(Object.isFrozen(SOURCE_IDS));
  assert.equal(SOURCE_IDS.length, 7);
  for (const id of [
    "approvalManager", "reviewSessionManager", "runRegistry",
    "deploymentProfile", "evidenceLedger", "profileStore", "remoteRunner",
  ]) {
    assert.ok(SOURCE_IDS.includes(id), `missing source ID "${id}"`);
  }
});

// ── Internal helpers ────────────────────────────────────────────

test("SMART-0 _safeNumber: accepts non-negative finite ints", () => {
  assert.equal(_safeNumber(0), 0);
  assert.equal(_safeNumber(5), 5);
  assert.equal(_safeNumber(3.7), 3, "non-int values floor");
});

test("SMART-0 _safeNumber: rejects NaN / Infinity / negative → 0", () => {
  assert.equal(_safeNumber(NaN), 0);
  assert.equal(_safeNumber(Infinity), 0);
  assert.equal(_safeNumber(-1), 0);
  assert.equal(_safeNumber(undefined), 0);
  assert.equal(_safeNumber("hello"), 0);
});

test("SMART-0 _emptyOutput: defaults all booleans false + counts 0 + sources absent", () => {
  const out = _emptyOutput("2026-05-04T00:00:00.000Z");
  assert.equal(out.schema, SCHEMA);
  assert.equal(out.timestamp, "2026-05-04T00:00:00.000Z");
  for (const k of BOOLEAN_KEYS) {
    assert.equal(out.booleans[k], false, `boolean "${k}" must default false`);
  }
  for (const k of COUNT_KEYS) {
    assert.equal(out.counts[k], 0, `count "${k}" must default 0`);
  }
  for (const id of SOURCE_IDS) {
    assert.equal(out.sources[id], "absent", `source "${id}" must default absent`);
  }
  assert.equal(out.posture.mode, "standard");
  assert.equal(out.posture.publicSector, false);
});

// ── buildContext defaults ───────────────────────────────────────

test("SMART-0 buildContext: empty adapters → counts 0 + most booleans false (needsHumanDecision is true)", () => {
  const out = buildContext({});
  assert.equal(out.schema, SCHEMA);
  // Counts always default 0
  for (const k of COUNT_KEYS) {
    assert.equal(out.counts[k], 0);
  }
  // Most booleans default false
  for (const k of [
    "hasPii", "approvalPending", "codexReviewMissing",
    "auditExportReady", "publicSector", "hasActiveProfile",
    "remoteRunnerActive",
  ]) {
    assert.equal(out.booleans[k], false, `boolean "${k}" must default false`);
  }
  // EXCEPT: needsHumanDecision is TRUE when no profileStore adapter
  // (the fail-safe — a server with no profile state should flag for
  // operator attention, not pretend it's ready). This is the
  // documented semantic: !hasActiveProfile → needsHumanDecision.
  assert.equal(out.booleans.needsHumanDecision, true,
    "absent profileStore + !hasActiveProfile → needsHumanDecision true (fail-safe)");
});

test("SMART-0 buildContext: result is frozen + nested objects frozen", () => {
  const out = buildContext({});
  assert.ok(Object.isFrozen(out));
  assert.ok(Object.isFrozen(out.booleans));
  assert.ok(Object.isFrozen(out.counts));
  assert.ok(Object.isFrozen(out.posture));
  assert.ok(Object.isFrozen(out.sources));
});

test("SMART-0 buildContext: no adapter → sources all 'absent'", () => {
  const out = buildContext({});
  for (const id of SOURCE_IDS) {
    assert.equal(out.sources[id], "absent");
  }
});

test("SMART-0 buildContext: nowFn override produces deterministic timestamp", () => {
  const FIXED = 1735689600000; // 2025-01-01T00:00:00Z
  const out = buildContext({}, { nowFn: () => FIXED });
  assert.equal(out.timestamp, "2025-01-01T00:00:00.000Z");
});

// ── ApprovalManager adapter ─────────────────────────────────────

test("SMART-0 buildContext: approvalManager.list() length → pendingApprovals + approvalPending", () => {
  const out = buildContext({
    approvalManager: { list: () => [{}, {}, {}] },
  });
  assert.equal(out.counts.pendingApprovals, 3);
  assert.equal(out.booleans.approvalPending, true);
  assert.equal(out.sources.approvalManager, "ok");
});

test("SMART-0 buildContext: approvalManager empty list → pendingApprovals=0 + approvalPending=false", () => {
  const out = buildContext({ approvalManager: { list: () => [] } });
  assert.equal(out.counts.pendingApprovals, 0);
  assert.equal(out.booleans.approvalPending, false);
  assert.equal(out.sources.approvalManager, "ok");
});

test("SMART-0 buildContext: approvalManager.list throws → sources.errored + booleans untouched", () => {
  const out = buildContext({
    approvalManager: {
      list: () => { throw new Error("manager unavailable"); },
    },
  });
  assert.equal(out.booleans.approvalPending, false);
  assert.equal(out.counts.pendingApprovals, 0);
  assert.deepEqual(out.sources.approvalManager,
    { errored: true, message: "manager unavailable" });
});

test("SMART-0 buildContext: approvalManager without list method → adapter is no-op (still ok)", () => {
  // Adapter present but missing the contract's list() — internal
  // reader returns early. sources still says "ok" (adapter ran;
  // it just didn't have anything to read).
  const out = buildContext({
    approvalManager: { /* no list method */ },
  });
  assert.equal(out.counts.pendingApprovals, 0);
  assert.equal(out.sources.approvalManager, "ok");
});

// ── ReviewSessionManager adapter ────────────────────────────────

test("SMART-0 buildContext: reviewSessionManager → openReviewSessions + codexReviewMissing", () => {
  const out = buildContext({
    reviewSessionManager: {
      list: () => [
        { state: "draft" },
        { state: "awaiting_critique" },
        { state: "archived" },
      ],
    },
  });
  assert.equal(out.counts.openReviewSessions, 2,
    "non-archived sessions count toward open");
  assert.equal(out.booleans.codexReviewMissing, true,
    "any awaiting_critique session sets the flag");
});

test("SMART-0 buildContext: reviewSessionManager all archived → codexReviewMissing=false", () => {
  const out = buildContext({
    reviewSessionManager: {
      list: () => [{ state: "archived" }, { state: "archived" }],
    },
  });
  assert.equal(out.counts.openReviewSessions, 0);
  assert.equal(out.booleans.codexReviewMissing, false);
});

test("SMART-0 buildContext: reviewSessionManager empty → all-zero counts + flags", () => {
  const out = buildContext({ reviewSessionManager: { list: () => [] } });
  assert.equal(out.counts.openReviewSessions, 0);
  assert.equal(out.booleans.codexReviewMissing, false);
});

// ── RunRegistry adapter ────────────────────────────────────────

test("SMART-0 buildContext: runRegistry counts only running/active runs", () => {
  const out = buildContext({
    runRegistry: {
      list: () => [
        { runId: "r1", state: "running" },
        { runId: "r2", state: "active" },
        { runId: "r3", state: "completed" },
        { runId: "r4", state: "failed" },
      ],
    },
  });
  assert.equal(out.counts.activeRuns, 2);
});

test("SMART-0 buildContext: runRegistry empty list → activeRuns=0", () => {
  const out = buildContext({ runRegistry: { list: () => [] } });
  assert.equal(out.counts.activeRuns, 0);
});

// ── DeploymentProfile adapter ──────────────────────────────────

test("SMART-0 buildContext: deploymentProfile populates posture + publicSector boolean", () => {
  const out = buildContext({
    deploymentProfile: {
      mode: "public-sector",
      publicSector: true,
      allowLocalExecutor: false,
      requirePiiScan: true,
      requireSandboxWorkspace: true,
      requireSignedManifest: true,
    },
  });
  assert.equal(out.posture.mode, "public-sector");
  assert.equal(out.posture.publicSector, true);
  assert.equal(out.posture.requirePiiScan, true);
  assert.equal(out.posture.requireSandboxWorkspace, true);
  assert.equal(out.posture.requireSignedManifest, true);
  assert.equal(out.posture.allowLocalExecutor, false);
  assert.equal(out.booleans.publicSector, true);
});

test("SMART-0 buildContext: deploymentProfile standard posture → publicSector false", () => {
  const out = buildContext({
    deploymentProfile: { mode: "standard", publicSector: false },
  });
  assert.equal(out.posture.publicSector, false);
  assert.equal(out.booleans.publicSector, false);
});

// ── EvidenceLedger adapter ─────────────────────────────────────

test("SMART-0 buildContext: evidenceLedger.count() → entries + auditExportReady", () => {
  const out = buildContext({
    evidenceLedger: { count: () => 42 },
  });
  assert.equal(out.counts.evidenceLedgerEntries, 42);
  assert.equal(out.booleans.auditExportReady, true);
});

test("SMART-0 buildContext: evidenceLedger.size() fallback when count() absent", () => {
  const out = buildContext({
    evidenceLedger: { size: () => 7 },
  });
  assert.equal(out.counts.evidenceLedgerEntries, 7);
  assert.equal(out.booleans.auditExportReady, true);
});

test("SMART-0 buildContext: evidenceLedger empty → auditExportReady=false", () => {
  const out = buildContext({ evidenceLedger: { count: () => 0 } });
  assert.equal(out.counts.evidenceLedgerEntries, 0);
  assert.equal(out.booleans.auditExportReady, false);
});

// ── ProfileStore adapter ──────────────────────────────────────

test("SMART-0 buildContext: profileStore.active() returning a profile → hasActiveProfile=true", () => {
  const out = buildContext({
    profileStore: { active: () => ({ id: "personal", label: "Personal" }) },
  });
  assert.equal(out.booleans.hasActiveProfile, true);
});

test("SMART-0 buildContext: profileStore.active() returning null → hasActiveProfile=false", () => {
  const out = buildContext({
    profileStore: { active: () => null },
  });
  assert.equal(out.booleans.hasActiveProfile, false);
});

test("SMART-0 buildContext: profileStore.activeProfileId() fallback when active() absent", () => {
  const out = buildContext({
    profileStore: { activeProfileId: () => "work-account" },
  });
  assert.equal(out.booleans.hasActiveProfile, true);
});

// ── RemoteRunner adapter ──────────────────────────────────────

test("SMART-0 buildContext: remoteRunner.snapshot() with healthy runners → counts + flag", () => {
  const out = buildContext({
    remoteRunner: {
      snapshot: () => [
        { hostIdentity: "h1", healthy: true },
        { hostIdentity: "h2", online: true },
        { hostIdentity: "h3" /* not healthy */ },
      ],
    },
  });
  assert.equal(out.counts.remoteRunnerCount, 3, "all snapshot entries counted");
  assert.equal(out.booleans.remoteRunnerActive, true,
    "any healthy/online runner flips the flag");
});

test("SMART-0 buildContext: remoteRunner.snapshot empty → flag false", () => {
  const out = buildContext({ remoteRunner: { snapshot: () => [] } });
  assert.equal(out.counts.remoteRunnerCount, 0);
  assert.equal(out.booleans.remoteRunnerActive, false);
});

test("SMART-0 buildContext: remoteRunner all-unhealthy → count > 0 but flag false", () => {
  const out = buildContext({
    remoteRunner: {
      snapshot: () => [
        { hostIdentity: "h1", healthy: false },
        { hostIdentity: "h2", online: false },
      ],
    },
  });
  assert.equal(out.counts.remoteRunnerCount, 2);
  assert.equal(out.booleans.remoteRunnerActive, false,
    "presence ≠ readiness — neither online nor healthy");
});

// ── hasPii flag (caller override) ──────────────────────────────

test("SMART-0 buildContext: hasPii=true via opts overrides scanner-stateless default", () => {
  const out = buildContext({}, { hasPii: true });
  assert.equal(out.booleans.hasPii, true);
});

test("SMART-0 buildContext: hasPii defaults false when not provided", () => {
  const out = buildContext({});
  assert.equal(out.booleans.hasPii, false);
});

// ── needsHumanDecision aggregation ─────────────────────────────

test("SMART-0 needsHumanDecision: true when approvalPending", () => {
  const out = buildContext({
    approvalManager: { list: () => [{}] },
  });
  assert.equal(out.booleans.needsHumanDecision, true);
});

test("SMART-0 needsHumanDecision: true when codexReviewMissing", () => {
  const out = buildContext({
    reviewSessionManager: { list: () => [{ state: "awaiting_critique" }] },
  });
  assert.equal(out.booleans.needsHumanDecision, true);
});

test("SMART-0 needsHumanDecision: true when public-sector + hasPii", () => {
  const out = buildContext({
    deploymentProfile: { mode: "public-sector", publicSector: true },
  }, { hasPii: true });
  assert.equal(out.booleans.needsHumanDecision, true);
});

test("SMART-0 needsHumanDecision: NOT true when standard + hasPii (PII alone is warning, not block)", () => {
  // Standard mode treats PII as a warning per GOV-PII-0; only
  // public-sector mode escalates.
  const out = buildContext({
    profileStore: { active: () => ({ id: "p" }) },
    deploymentProfile: { publicSector: false },
  }, { hasPii: true });
  assert.equal(out.booleans.needsHumanDecision, false,
    "standard posture + PII → recommendation card warns; not blocker");
});

test("SMART-0 needsHumanDecision: true when no active profile", () => {
  const out = buildContext({
    profileStore: { active: () => null },
  });
  assert.equal(out.booleans.needsHumanDecision, true,
    "no active profile is always a blocker");
});

test("SMART-0 needsHumanDecision: false when active profile + clean state", () => {
  const out = buildContext({
    profileStore: { active: () => ({ id: "p" }) },
    deploymentProfile: { publicSector: false },
    approvalManager: { list: () => [] },
    reviewSessionManager: { list: () => [] },
  });
  assert.equal(out.booleans.needsHumanDecision, false);
});

// ── Multi-adapter integration ─────────────────────────────────

test("SMART-0 buildContext: combined adapters → multiple booleans + counts simultaneously", () => {
  const out = buildContext({
    approvalManager: { list: () => [{ id: "a1" }] },
    reviewSessionManager: {
      list: () => [
        { state: "awaiting_critique" },
        { state: "active" },
      ],
    },
    runRegistry: { list: () => [{ runId: "r1", state: "running" }] },
    deploymentProfile: {
      mode: "public-sector", publicSector: true,
      allowLocalExecutor: false,
    },
    evidenceLedger: { count: () => 100 },
    profileStore: { active: () => ({ id: "agency" }) },
  });
  assert.equal(out.counts.pendingApprovals, 1);
  assert.equal(out.counts.openReviewSessions, 2);
  assert.equal(out.counts.activeRuns, 1);
  assert.equal(out.counts.evidenceLedgerEntries, 100);
  assert.equal(out.booleans.approvalPending, true);
  assert.equal(out.booleans.codexReviewMissing, true);
  assert.equal(out.booleans.publicSector, true);
  assert.equal(out.booleans.hasActiveProfile, true);
  assert.equal(out.booleans.auditExportReady, true);
  assert.equal(out.booleans.needsHumanDecision, true);
  // All 6 supplied adapters → ok
  for (const id of ["approvalManager", "reviewSessionManager", "runRegistry",
                    "deploymentProfile", "evidenceLedger", "profileStore"]) {
    assert.equal(out.sources[id], "ok", `${id} should be ok`);
  }
  // remoteRunner not provided → absent
  assert.equal(out.sources.remoteRunner, "absent");
});

// ── Resilience: one bad adapter doesn't poison the snapshot ───

test("SMART-0 buildContext: single throwing adapter → others still produce values", () => {
  const out = buildContext({
    approvalManager: {
      list: () => { throw new Error("approval down"); },
    },
    runRegistry: { list: () => [{ runId: "r", state: "running" }] },
    deploymentProfile: { publicSector: false },
  });
  // approval source errored, but runRegistry and deploymentProfile
  // still populate.
  assert.deepEqual(out.sources.approvalManager,
    { errored: true, message: "approval down" });
  assert.equal(out.counts.activeRuns, 1);
  assert.equal(out.booleans.publicSector, false);
});

test("SMART-0 buildContext: throwing adapter does NOT corrupt other adapters' booleans", () => {
  const out = buildContext({
    approvalManager: {
      list: () => { throw new Error("boom"); },
    },
    profileStore: { active: () => ({ id: "p" }) },
  });
  assert.equal(out.booleans.hasActiveProfile, true,
    "profileStore must still populate hasActiveProfile despite approval throw");
});

test("SMART-0 buildContext: error message truncated to 200 chars", () => {
  const longMsg = "x".repeat(500);
  const out = buildContext({
    approvalManager: {
      list: () => { throw new Error(longMsg); },
    },
  });
  assert.equal(out.sources.approvalManager.message.length, 200);
});
