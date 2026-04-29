// Slice UX-2-a (Phase D R3 + Phase E1.5, 2026-04-29) — pending-
// approval store slice unit tests.
//
// The slice is fed by the legacy-bridge translating WS
// approval_requested / approval_resolved events into store actions.
// These tests pin the store contract:
//   - upsertApproval({approvalId, ...}) registers a pending entry
//   - resolveApproval(id) clears the entry (regardless of resolution)
//   - clearApprovals() empties the slice
//   - snapshot.pendingApprovals is a defensive-copy array sorted by
//     requestedAt
//   - mutations on the snapshot don't leak back into state

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const HarnessMonitorStore = require("../../public/js/monitor/store.js");

function makeRequest(overrides = {}) {
  return {
    approvalId: "appr-1",
    hook: "PreToolUse",
    tool: "Bash",
    args: { command: "echo hi" },
    argsHash: "deadbeef".repeat(8),
    argsSummary: "echo hi",
    runId: "run-1",
    hostIdentity: "host-A",
    source: "remote_hook",
    piiContext: null,
    timeoutMs: 30000,
    requestedAt: 1000,
    expiresAt: 31000,
    ...overrides,
  };
}

// ── snapshot shape ─────────────────────────────────────────────────

test("UX-2-a: fresh store snapshot exposes empty pendingApprovals array", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  const snap = store.snapshot();
  assert.ok(Array.isArray(snap.pendingApprovals));
  assert.equal(snap.pendingApprovals.length, 0);
});

// ── upsertApproval ─────────────────────────────────────────────────

test("UX-2-a: upsertApproval registers a pending request", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest());
  const snap = store.snapshot();
  assert.equal(snap.pendingApprovals.length, 1);
  assert.equal(snap.pendingApprovals[0].approvalId, "appr-1");
  assert.equal(snap.pendingApprovals[0].tool, "Bash");
  assert.equal(snap.pendingApprovals[0].argsSummary, "echo hi");
});

test("UX-2-a: upsertApproval ignores invalid input", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  // Garbage inputs — no-ops
  store.upsertApproval(null);
  store.upsertApproval(undefined);
  store.upsertApproval("not an obj");
  store.upsertApproval({});                          // missing approvalId
  store.upsertApproval({ approvalId: 123 });         // wrong type
  store.upsertApproval({ approvalId: "" });          // empty string
  assert.equal(store.snapshot().pendingApprovals.length, 0);
});

test("UX-2-a: upsertApproval defensive-copies args + piiContext", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  const args = { command: "echo hi" };
  const piiContext = {
    hasPii: true,
    findingTypes: ["phone_kr_mobile"],
    samples: { phone_kr_mobile: ["01*-****-**78"] },
  };
  store.upsertApproval(makeRequest({ args, piiContext }));

  // Mutate the original objects.
  args.command = "rm -rf /";
  piiContext.findingTypes.push("krn");
  piiContext.samples.phone_kr_mobile.push("MUTATED");

  // Store snapshot should be unaffected.
  const snap = store.snapshot();
  assert.equal(snap.pendingApprovals[0].args.command, "echo hi");
  assert.deepEqual(snap.pendingApprovals[0].piiContext.findingTypes,
    ["phone_kr_mobile"]);
  assert.deepEqual(snap.pendingApprovals[0].piiContext.samples.phone_kr_mobile,
    ["01*-****-**78"]);
});

test("UX-2-a: upsertApproval with same approvalId overwrites in place", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest({ argsSummary: "echo hi" }));
  store.upsertApproval(makeRequest({ argsSummary: "echo hi (updated)" }));
  const snap = store.snapshot();
  assert.equal(snap.pendingApprovals.length, 1);
  assert.equal(snap.pendingApprovals[0].argsSummary, "echo hi (updated)");
});

test("UX-2-a: snapshot pendingApprovals sorted by requestedAt (oldest-first)", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest({ approvalId: "newer", requestedAt: 2000 }));
  store.upsertApproval(makeRequest({ approvalId: "older", requestedAt: 1000 }));
  store.upsertApproval(makeRequest({ approvalId: "middle", requestedAt: 1500 }));

  const ids = store.snapshot().pendingApprovals.map((a) => a.approvalId);
  assert.deepEqual(ids, ["older", "middle", "newer"]);
});

test("UX-2-a: piiContext absent yields piiContext:null on snapshot", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest({ piiContext: null }));
  assert.equal(store.snapshot().pendingApprovals[0].piiContext, null);
});

// ── resolveApproval ────────────────────────────────────────────────

test("UX-2-a: resolveApproval clears the pending entry", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest({ approvalId: "appr-1" }));
  store.upsertApproval(makeRequest({ approvalId: "appr-2", requestedAt: 2000 }));
  store.resolveApproval("appr-1");

  const snap = store.snapshot();
  assert.equal(snap.pendingApprovals.length, 1);
  assert.equal(snap.pendingApprovals[0].approvalId, "appr-2");
});

test("UX-2-a: resolveApproval is a no-op for unknown id", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest());
  store.resolveApproval("not-a-real-id");
  assert.equal(store.snapshot().pendingApprovals.length, 1);
});

test("UX-2-a: resolveApproval ignores garbage input", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest());
  store.resolveApproval(null);
  store.resolveApproval(undefined);
  store.resolveApproval("");
  store.resolveApproval(123);
  assert.equal(store.snapshot().pendingApprovals.length, 1);
});

// ── clearApprovals ─────────────────────────────────────────────────

test("UX-2-a: clearApprovals empties the slice", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest({ approvalId: "a" }));
  store.upsertApproval(makeRequest({ approvalId: "b" }));
  store.upsertApproval(makeRequest({ approvalId: "c" }));
  store.clearApprovals();
  assert.equal(store.snapshot().pendingApprovals.length, 0);
});

test("UX-2-a: clearApprovals on empty slice is a stable no-op", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.clearApprovals();
  assert.equal(store.snapshot().pendingApprovals.length, 0);
});

// ── reset() also clears pendingApprovals ──────────────────────────

test("UX-2-a: reset() empties the slice (via freshState)", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest());
  assert.equal(store.snapshot().pendingApprovals.length, 1);
  store.reset();
  assert.equal(store.snapshot().pendingApprovals.length, 0);
});

// ── snapshot is a defensive copy ──────────────────────────────────

test("UX-2-a: snapshot mutation does not leak into store state", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  store.upsertApproval(makeRequest());
  const snap1 = store.snapshot();
  // Mutate the snapshot's array
  snap1.pendingApprovals.push({ approvalId: "injected" });
  // Mutate one of the copies' nested args
  if (snap1.pendingApprovals.length > 0) {
    snap1.pendingApprovals[0].tool = "MUTATED";
    snap1.pendingApprovals[0].args.command = "MUTATED";
  }

  const snap2 = store.snapshot();
  assert.equal(snap2.pendingApprovals.length, 1,
    "injected entry should not appear in subsequent snapshot");
  assert.equal(snap2.pendingApprovals[0].tool, "Bash");
  assert.equal(snap2.pendingApprovals[0].args.command, "echo hi");
});

// ── publish lifecycle ─────────────────────────────────────────────

test("UX-2-a: subscribers fire on upsert / resolve / clear", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  let lastLen = -1;
  store.subscribe((s) => { lastLen = s.pendingApprovals.length; });

  store.upsertApproval(makeRequest({ approvalId: "a" }));
  assert.equal(lastLen, 1);

  store.upsertApproval(makeRequest({ approvalId: "b", requestedAt: 2000 }));
  assert.equal(lastLen, 2);

  store.resolveApproval("a");
  assert.equal(lastLen, 1);

  store.clearApprovals();
  assert.equal(lastLen, 0);
});

test("UX-2-a: invalid actions do NOT publish (avoid spurious renders)", () => {
  const store = HarnessMonitorStore.createMonitorStore();
  let publishes = 0;
  store.subscribe(() => { publishes += 1; });

  store.upsertApproval(null);             // garbage — no publish
  store.upsertApproval({});               // missing id — no publish
  store.resolveApproval("missing");       // unknown id — no publish
  store.clearApprovals();                 // empty slice — no publish
  assert.equal(publishes, 0);
});
