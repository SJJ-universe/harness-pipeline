// Slice SMART-0-c (Phase D Round UI-P / Phase 2 SMART arc, 2026-05-04)
// — store decisionContext slice tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");

function _validSnapshot() {
  return {
    schema: "orchestrator-decision-context/v1",
    timestamp: "2026-05-04T00:00:00.000Z",
    booleans: {
      hasPii: false, approvalPending: true, codexReviewMissing: false,
      auditExportReady: true, publicSector: true, hasActiveProfile: true,
      needsHumanDecision: true, remoteRunnerActive: false,
    },
    counts: {
      activeRuns: 1, pendingApprovals: 2, openReviewSessions: 0,
      remoteRunnerCount: 0, evidenceLedgerEntries: 50,
    },
    posture: {
      mode: "public-sector", publicSector: true, allowLocalExecutor: false,
      requirePiiScan: true, requireSandboxWorkspace: true, requireSignedManifest: true,
    },
    sources: {
      approvalManager: "ok", reviewSessionManager: "ok", runRegistry: "ok",
      deploymentProfile: "ok", evidenceLedger: "ok", profileStore: "ok",
      remoteRunner: "absent",
    },
  };
}

test("SMART-0-c store: setDecisionContext exists in returned API", () => {
  const store = createMonitorStore();
  assert.equal(typeof store.setDecisionContext, "function");
});

test("SMART-0-c store: initial snapshot.decisionContext is null", () => {
  const store = createMonitorStore();
  assert.equal(store.snapshot().decisionContext, null);
});

test("SMART-0-c store: setDecisionContext with valid snapshot populates slice", () => {
  const store = createMonitorStore();
  const snap = _validSnapshot();
  store.setDecisionContext(snap);
  const out = store.snapshot().decisionContext;
  assert.equal(out.schema, "orchestrator-decision-context/v1");
  assert.equal(out.timestamp, "2026-05-04T00:00:00.000Z");
  assert.equal(out.booleans.approvalPending, true);
  assert.equal(out.counts.pendingApprovals, 2);
  assert.equal(out.posture.publicSector, true);
  assert.equal(out.sources.approvalManager, "ok");
});

test("SMART-0-c store: setDecisionContext(null) clears the slice", () => {
  const store = createMonitorStore();
  store.setDecisionContext(_validSnapshot());
  assert.ok(store.snapshot().decisionContext);
  store.setDecisionContext(null);
  assert.equal(store.snapshot().decisionContext, null);
});

test("SMART-0-c store: setDecisionContext with wrong schema is no-op (defensive)", () => {
  const store = createMonitorStore();
  store.setDecisionContext({
    schema: "some-other-schema/v1",
    booleans: { approvalPending: true },
  });
  assert.equal(store.snapshot().decisionContext, null,
    "wrong schema must NOT pollute the slice");
});

test("SMART-0-c store: setDecisionContext with non-object input is no-op", () => {
  const store = createMonitorStore();
  store.setDecisionContext(42);
  store.setDecisionContext("hello");
  store.setDecisionContext(true);
  assert.equal(store.snapshot().decisionContext, null);
});

test("SMART-0-c store: setDecisionContext publishes to subscribers", () => {
  const store = createMonitorStore();
  let publishCount = 0;
  store.subscribe(() => { publishCount += 1; });
  const before = publishCount;
  store.setDecisionContext(_validSnapshot());
  assert.equal(publishCount, before + 1);
});

test("SMART-0-c store: setDecisionContext(null) when already null does NOT publish", () => {
  const store = createMonitorStore();
  let publishCount = 0;
  store.subscribe(() => { publishCount += 1; });
  const before = publishCount;
  store.setDecisionContext(null);
  assert.equal(publishCount, before,
    "redundant null set must skip publish (avoids notify churn)");
});

test("SMART-0-c store: snapshot defensively shallow-copies decisionContext sub-objects", () => {
  const store = createMonitorStore();
  store.setDecisionContext(_validSnapshot());
  const s1 = store.snapshot();
  const s2 = store.snapshot();
  // Different identity per snapshot (envelope + each sub-block)
  assert.notEqual(s1.decisionContext, s2.decisionContext);
  assert.notEqual(s1.decisionContext.booleans, s2.decisionContext.booleans);
  // Same values
  assert.deepEqual(s1.decisionContext.booleans, s2.decisionContext.booleans);
});

test("SMART-0-c store: caller mutating snapshot.decisionContext does not affect store", () => {
  const store = createMonitorStore();
  store.setDecisionContext(_validSnapshot());
  const snap = store.snapshot();
  // Caller mutates retrieved snapshot
  snap.decisionContext.booleans.approvalPending = false;
  snap.decisionContext.counts.pendingApprovals = 999;
  snap.decisionContext.booleans.tampered = true;
  // Store internal state is unaffected
  const fresh = store.snapshot();
  assert.equal(fresh.decisionContext.booleans.approvalPending, true);
  assert.equal(fresh.decisionContext.counts.pendingApprovals, 2);
  assert.equal(fresh.decisionContext.booleans.tampered, undefined);
});

test("SMART-0-c store: setDecisionContext can be called repeatedly (overwrite semantics)", () => {
  const store = createMonitorStore();
  const snap1 = _validSnapshot();
  snap1.timestamp = "2026-05-04T00:00:00.000Z";
  store.setDecisionContext(snap1);
  const snap2 = _validSnapshot();
  snap2.timestamp = "2026-05-04T00:00:05.000Z";
  snap2.booleans.approvalPending = false;
  snap2.counts.pendingApprovals = 0;
  store.setDecisionContext(snap2);
  const out = store.snapshot().decisionContext;
  assert.equal(out.timestamp, "2026-05-04T00:00:05.000Z");
  assert.equal(out.booleans.approvalPending, false);
  assert.equal(out.counts.pendingApprovals, 0);
});

test("SMART-0-c store: missing booleans/counts/posture/sources sub-block becomes null", () => {
  const store = createMonitorStore();
  store.setDecisionContext({
    schema: "orchestrator-decision-context/v1",
    timestamp: "2026-05-04T00:00:00.000Z",
    // booleans intentionally missing
  });
  const out = store.snapshot().decisionContext;
  assert.ok(out, "with valid schema, slice still populates");
  assert.equal(out.booleans, null);
  assert.equal(out.counts, null);
  assert.equal(out.posture, null);
  assert.equal(out.sources, null);
});
