// Slice S4-c (Phase 2 / SMART-4, 2026-05-05) — runMemory.deriveFromPipelineSnapshot
// unit tests. Covers the snapshot-projection layer that S4-c uses to
// turn a pipeline_complete event into runMemory inputs.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runMemory = require("../../src/runtime/runMemory");

// ── empty / null inputs ────────────────────────────────────────

test("deriveFromPipelineSnapshot: null/undefined → empty inputs", () => {
  assert.deepEqual(runMemory.deriveFromPipelineSnapshot(null), {});
  assert.deepEqual(runMemory.deriveFromPipelineSnapshot(undefined), {});
});

test("deriveFromPipelineSnapshot: non-object → empty inputs", () => {
  assert.deepEqual(runMemory.deriveFromPipelineSnapshot("not-a-snapshot"), {});
  assert.deepEqual(runMemory.deriveFromPipelineSnapshot(42), {});
});

// ── goal projection ────────────────────────────────────────────

test("deriveFromPipelineSnapshot: goal = templateId + iteration", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    templateId: "tier-3", iteration: 2, state: {}, reason: "complete",
  });
  assert.equal(out.goal, "tier-3 (iteration 2)");
});

test("deriveFromPipelineSnapshot: missing templateId → 'unknown'", () => {
  const out = runMemory.deriveFromPipelineSnapshot({ state: {}, reason: "ok" });
  assert.equal(out.goal, "unknown (iteration 0)");
});

test("deriveFromPipelineSnapshot: state.templateId fallback when snapshot.templateId missing", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    iteration: 1,
    state: { templateId: "stateful" },
    reason: "ok",
  });
  assert.equal(out.goal, "stateful (iteration 1)");
});

// ── changeSummary projection ───────────────────────────────────

test("deriveFromPipelineSnapshot: changeSummary lists phases + total", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    templateId: "T", iteration: 0,
    state: {
      phases: [
        { id: "plan", status: "completed", durationMs: 1000 },
        { id: "implement", status: "completed", durationMs: 5000 },
        { id: "verify", status: "skipped" },
      ],
    },
    durationMs: 6500,
    reason: "complete",
  });
  assert.match(out.changeSummary, /plan: completed.*1000ms/);
  assert.match(out.changeSummary, /implement: completed.*5000ms/);
  assert.match(out.changeSummary, /verify: skipped/);
  assert.match(out.changeSummary, /total 6500ms.*complete/);
});

test("deriveFromPipelineSnapshot: empty phases → only total line", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { phases: [] }, durationMs: 100, reason: "disabled",
  });
  assert.equal(out.changeSummary, "total 100ms (disabled)");
});

// ── codexFindings projection ───────────────────────────────────

test("deriveFromPipelineSnapshot: codexFindings has severity counts", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: {
      findings: [
        { severity: "critical", message: "auth bypass" },
        { severity: "high", message: "log leak" },
        { severity: "medium", message: "n+1 query" },
        { severity: "low", message: "naming nit" },
        { severity: "note", message: "fyi" },
      ],
    },
  });
  assert.match(out.codexFindings, /critical=1/);
  assert.match(out.codexFindings, /high=1/);
  assert.match(out.codexFindings, /medium=1/);
  assert.match(out.codexFindings, /low=1/);
  assert.match(out.codexFindings, /note=1/);
  assert.match(out.codexFindings, /\[critical\][\s\S]*auth bypass/);
});

test("deriveFromPipelineSnapshot: caps to 3 samples per severity", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: {
      findings: Array.from({ length: 10 }, (_, i) => ({
        severity: "high",
        message: `finding ${i}`,
      })),
    },
  });
  // Exactly 3 sample lines under [high]
  const highSection = out.codexFindings.split("[high]")[1] || "";
  const sampleLines = highSection.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(sampleLines.length, 3);
});

test("deriveFromPipelineSnapshot: long finding message truncated to 200 chars", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { findings: [{ severity: "high", message: "x".repeat(500) }] },
  });
  // The longest sample line in codexFindings should be ≤ 200 chars + "- "
  const highSection = out.codexFindings.split("[high]")[1] || "";
  const sampleLine = highSection.split("\n").find((l) => l.startsWith("- "));
  assert.ok(sampleLine.length <= 202);
});

test("deriveFromPipelineSnapshot: unknown severity → counted as 'note'? actually skipped", () => {
  // Implementation skips unknown severities. Counts stay 0 for known.
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { findings: [{ severity: "weird", message: "x" }] },
  });
  assert.match(out.codexFindings, /critical=0 high=0 medium=0 low=0 note=0/);
});

test("deriveFromPipelineSnapshot: severity case-insensitive", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { findings: [{ severity: "CRITICAL", message: "x" }] },
  });
  assert.match(out.codexFindings, /critical=1/);
});

// ── approvals projection ───────────────────────────────────────

test("deriveFromPipelineSnapshot: state.approvalCounts → approvals", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { approvalCounts: { granted: 3, denied: 1, timeout: 0 } },
  });
  assert.deepEqual(out.approvals, { granted: 3, denied: 1, timeout: 0 });
});

test("deriveFromPipelineSnapshot: missing approvalCounts → null", () => {
  const out = runMemory.deriveFromPipelineSnapshot({ state: {} });
  assert.equal(out.approvals, null);
});

test("deriveFromPipelineSnapshot: malformed approvalCounts → 0/0/0 (Number coerce)", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { approvalCounts: { granted: "x", denied: undefined, timeout: null } },
  });
  assert.deepEqual(out.approvals, { granted: 0, denied: 0, timeout: 0 });
});

// ── piiDetected projection ─────────────────────────────────────

test("deriveFromPipelineSnapshot: state.piiDetected → piiDetected types-only", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { piiDetected: { hasPii: true, types: ["krn", "email"] } },
  });
  assert.deepEqual(out.piiDetected, { hasPii: true, types: ["krn", "email"] });
});

test("deriveFromPipelineSnapshot: missing piiDetected → null", () => {
  const out = runMemory.deriveFromPipelineSnapshot({ state: {} });
  assert.equal(out.piiDetected, null);
});

// ── failureCause projection ────────────────────────────────────

test("deriveFromPipelineSnapshot: reason='complete' + verification.pass → empty failureCause", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    reason: "complete", verification: { pass: true, missing: [] },
  });
  assert.equal(out.failureCause, "");
});

test("deriveFromPipelineSnapshot: reason='disabled' → failureCause:reason", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    reason: "disabled", verification: { pass: true },
  });
  assert.equal(out.failureCause, "reason=disabled");
});

test("deriveFromPipelineSnapshot: verification.pass=false → failureCause carries first 3 missing", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    reason: "complete",
    verification: {
      pass: false,
      missing: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
    },
  });
  // First 3 only
  assert.match(out.failureCause, /missing: a, b, c/);
  assert.ok(!out.failureCause.includes(", d"));
});

test("deriveFromPipelineSnapshot: combined reason + missing", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    reason: "session-end",
    verification: { pass: false, missing: [{ id: "x" }] },
  });
  assert.match(out.failureCause, /reason=session-end; missing: x/);
});

// ── nextTimeWatchOuts projection ───────────────────────────────

test("deriveFromPipelineSnapshot: verification.results failed → nextTimeWatchOuts has bullets", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    verification: {
      pass: false,
      results: [
        { id: "lint", pass: true },
        { id: "unit", pass: false, message: "5 failures" },
        { id: "integration", pass: false, reason: "timeout" },
      ],
    },
  });
  assert.match(out.nextTimeWatchOuts, /- unit: 5 failures/);
  assert.match(out.nextTimeWatchOuts, /- integration: timeout/);
});

test("deriveFromPipelineSnapshot: verification.results all passed → empty nextTimeWatchOuts", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    verification: {
      pass: true,
      results: [{ id: "x", pass: true }],
    },
  });
  assert.equal(out.nextTimeWatchOuts, "");
});

test("deriveFromPipelineSnapshot: caps nextTimeWatchOuts to 5 failed bullets", () => {
  const out = runMemory.deriveFromPipelineSnapshot({
    verification: {
      pass: false,
      results: Array.from({ length: 10 }, (_, i) => ({
        id: `t${i}`, pass: false, message: `fail ${i}`,
      })),
    },
  });
  const lines = out.nextTimeWatchOuts.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(lines.length, 5);
});

// ── sourceContent ─────────────────────────────────────────────

test("deriveFromPipelineSnapshot: sourceContent always null (out-of-band)", () => {
  // Pipeline-executor doesn't carry diff blobs through state by default.
  const out = runMemory.deriveFromPipelineSnapshot({
    state: { phases: [], findings: [] }, reason: "complete",
  });
  assert.equal(out.sourceContent, null);
});

// ── End-to-end: derive → recordRunMemory ──────────────────────

test("deriveFromPipelineSnapshot + recordRunMemory: round-trip on realistic snapshot", () => {
  const calls = [];
  const ledger = {
    calls,  // expose for assertions
    append(runId, entry) { calls.push({ runId, entry }); },
    read() { return []; },
  };
  const snapshot = {
    templateId: "tier-3",
    durationMs: 12345,
    iteration: 4,
    state: {
      phases: [
        { id: "plan", status: "completed", durationMs: 1000 },
        { id: "implement", status: "completed", durationMs: 8000 },
        { id: "verify", status: "completed", durationMs: 3000 },
      ],
      findings: [
        { severity: "medium", message: "missing test for null path" },
      ],
      approvalCounts: { granted: 2, denied: 0, timeout: 0 },
      piiDetected: { hasPii: false, types: [] },
    },
    reason: "complete",
    verification: { pass: true, missing: [], results: [] },
  };
  const inputs = runMemory.deriveFromPipelineSnapshot(snapshot);
  const r = runMemory.recordRunMemory({
    runId: "real-run-1", inputs, ledger, env: {},
    deploymentProfile: { publicSector: false },
  });
  assert.equal(r.recorded, true);
  const persisted = ledger.calls[0].entry.data;
  assert.equal(persisted.fields.goal, "tier-3 (iteration 4)");
  assert.match(persisted.fields.changeSummary, /plan: completed.*1000ms/);
  assert.match(persisted.fields.codexFindings, /medium=1[\s\S]*missing test/);
  assert.deepEqual(persisted.fields.approvals, { granted: 2, denied: 0, timeout: 0 });
  assert.equal(persisted.fields.failureCause, "");
});

test("deriveFromPipelineSnapshot + recordRunMemory: public-sector + finding with PII redacts", () => {
  const calls = [];
  const ledger = {
    calls,
    append(runId, entry) { calls.push({ runId, entry }); },
    read() { return []; },
  };
  const snapshot = {
    templateId: "T", iteration: 0,
    state: {
      phases: [],
      findings: [
        { severity: "high", message: "user jane.doe@example.com leaked credentials" },
      ],
    },
    reason: "complete",
    verification: { pass: true },
  };
  const inputs = runMemory.deriveFromPipelineSnapshot(snapshot);
  runMemory.recordRunMemory({
    runId: "ps-run", inputs, ledger, env: {},
    deploymentProfile: { publicSector: true },
  });
  const persisted = ledger.calls[0].entry.data;
  // Email NEVER lands in any field
  for (const key of Object.keys(persisted.fields)) {
    const v = persisted.fields[key];
    if (typeof v === "string") {
      assert.ok(!v.includes("jane.doe@example.com"), `${key} must be redacted`);
    }
  }
  assert.ok(persisted.redacted, "redacted flag set");
  assert.ok(persisted.redactedTypes.includes("email"));
});
