// Slice UI-FirstRun-b (Phase D Round UI-P, 2026-05-04) — store
// providerStatus slice tests. Lives in its own file so the existing
// monitor.store.test.js doesn't grow.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");
const HarnessMonitorStore = { create: createMonitorStore };

// ── setProviderStatus action ────────────────────────────────────

test("UI-FirstRun store: setProviderStatus exists in returned API", () => {
  const store = HarnessMonitorStore.create();
  assert.equal(typeof store.setProviderStatus, "function",
    "store API must expose setProviderStatus");
});

test("UI-FirstRun store: setProviderStatus on empty state creates accountStatus shell", () => {
  const store = HarnessMonitorStore.create();
  // Initial: accountStatus is null
  assert.equal(store.snapshot().accountStatus, null);
  store.setProviderStatus({
    claude: { installed: true, authenticated: true },
  });
  const ac = store.snapshot().accountStatus;
  assert.ok(ac, "setProviderStatus must materialize accountStatus");
  assert.deepEqual(ac.providerStatus.claude, { installed: true, authenticated: true });
  assert.equal(ac.providerStatus.codex, null,
    "codex remains null when only claude is set");
  // Other accountStatus blocks remain null
  assert.equal(ac.profile, null);
  assert.equal(ac.deployment, null);
});

test("UI-FirstRun store: setProviderStatus preserves other accountStatus blocks", () => {
  const store = HarnessMonitorStore.create();
  store.setAccountStatus({
    profile: { count: 1, activeId: "personal" },
    deployment: { publicSector: false },
  });
  store.setProviderStatus({
    claude: { installed: true, authenticated: true },
  });
  const ac = store.snapshot().accountStatus;
  assert.deepEqual(ac.profile, { count: 1, activeId: "personal" });
  assert.deepEqual(ac.deployment, { publicSector: false });
  assert.deepEqual(ac.providerStatus.claude, { installed: true, authenticated: true });
});

test("UI-FirstRun store: setProviderStatus partial input merges (preserves untouched runner)", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({
    claude: { installed: true, authenticated: true },
    codex: { installed: true, authenticated: false },
  });
  // Operator re-tests Claude only — codex's last-known state must
  // survive
  store.setProviderStatus({
    claude: { installed: true, authenticated: false },
  });
  const ps = store.snapshot().accountStatus.providerStatus;
  assert.deepEqual(ps.claude, { installed: true, authenticated: false });
  assert.deepEqual(ps.codex, { installed: true, authenticated: false },
    "codex slice must be preserved when only claude is updated");
});

test("UI-FirstRun store: setProviderStatus(null) clears the slice", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  assert.ok(store.snapshot().accountStatus.providerStatus);
  store.setProviderStatus(null);
  assert.equal(store.snapshot().accountStatus.providerStatus, null);
});

test("UI-FirstRun store: setProviderStatus(non-object) is a no-op", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  const before = store.snapshot().accountStatus;
  store.setProviderStatus(42);
  store.setProviderStatus("hello");
  const after = store.snapshot().accountStatus;
  assert.deepEqual(after.providerStatus, before.providerStatus,
    "non-object input must be ignored");
});

test("UI-FirstRun store: setProviderStatus publishes (subscribers notified)", () => {
  const store = HarnessMonitorStore.create();
  let publishCount = 0;
  store.subscribe(() => { publishCount += 1; });
  const before = publishCount;
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  assert.equal(publishCount, before + 1,
    "setProviderStatus must trigger one publish");
});

test("UI-FirstRun store: setAccountStatus preserves providerStatus when not in input", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  // /api/server/info polling refreshes profile/deployment but doesn't
  // include providerStatus — must not wipe the slice.
  store.setAccountStatus({
    profile: { count: 2, activeId: "work" },
  });
  const ac = store.snapshot().accountStatus;
  assert.deepEqual(ac.providerStatus.claude, { installed: true, authenticated: true },
    "setAccountStatus partial input must NOT wipe providerStatus slice");
  assert.equal(ac.profile.activeId, "work");
});

test("UI-FirstRun store: snapshot defensively copies providerStatus", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({
    claude: { installed: true, authenticated: true, version: "1.0.0" },
  });
  const snap1 = store.snapshot();
  const snap2 = store.snapshot();
  // Different object identity (defensive copy)
  assert.notEqual(snap1.accountStatus.providerStatus,
                  snap2.accountStatus.providerStatus);
  assert.notEqual(snap1.accountStatus.providerStatus.claude,
                  snap2.accountStatus.providerStatus.claude);
  // But same values
  assert.deepEqual(snap1.accountStatus.providerStatus,
                   snap2.accountStatus.providerStatus);
});

test("UI-FirstRun store: mutating snapshot.providerStatus does not affect store", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  const snap = store.snapshot();
  // Caller mutates the snapshot
  snap.accountStatus.providerStatus.claude.installed = false;
  snap.accountStatus.providerStatus.claude.tampered = true;
  // Store internal state is unaffected
  const fresh = store.snapshot();
  assert.equal(fresh.accountStatus.providerStatus.claude.installed, true,
    "caller mutation must not bleed into store state");
  assert.equal(fresh.accountStatus.providerStatus.claude.tampered, undefined);
});

test("UI-FirstRun store: setAccountStatus({providerStatus: null}) clears it explicitly", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({ claude: { installed: true, authenticated: true } });
  store.setAccountStatus({ providerStatus: null });
  const ac = store.snapshot().accountStatus;
  assert.equal(ac.providerStatus, null,
    "setAccountStatus with explicit providerStatus:null clears the slice");
});

test("UI-FirstRun store: setAccountStatus({providerStatus: {...}}) replaces (not merges)", () => {
  const store = HarnessMonitorStore.create();
  store.setProviderStatus({
    claude: { installed: true, authenticated: true },
    codex: { installed: true, authenticated: true },
  });
  // setAccountStatus is a replace operation per-key. Pass only
  // claude → codex gets nulled (consistent with profile/deployment
  // semantics).
  store.setAccountStatus({
    providerStatus: { claude: { installed: false } },
  });
  const ps = store.snapshot().accountStatus.providerStatus;
  assert.deepEqual(ps.claude, { installed: false });
  assert.equal(ps.codex, null,
    "setAccountStatus replaces providerStatus shallow — keys not in input become null in snapshot");
});
