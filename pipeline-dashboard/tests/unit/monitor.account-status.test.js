// tests/unit/monitor.account-status.test.js — Slice D3-b (Phase E1.5, 2026-04-29)
//
// Locks the store + legacy-bridge contract that the global-bar (D3-c)
// + settings-accounts modal (D3-d) consume:
//
//   store.setAccountStatus({profile, deployment, bridge, remote})
//     - Single-action update for the /api/server/info account-status
//       block. Each sub-block is independently shallow-copied. Partial
//       inputs preserve last-known-good (the polling refresh might
//       drop a sub-block on a future server change; we don't blindly
//       wipe it).
//     - null clears the slice entirely.
//
//   snapshot().accountStatus
//     - Defensive shallow copies of each sub-block. Mutating the
//       snapshot must NEVER reach back into store state.
//
//   legacy-bridge refresh()
//     - Maps payload.{profile,deployment,bridge,remote} →
//       store.setAccountStatus once per poll. ONE setAccountStatus call,
//       not four (single re-render).
//     - Only fires when at least one block is present (so a legacy
//       /api/server/info without D3-a fields doesn't clobber the
//       last known good).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createMonitorStore } = require("../../public/js/monitor/store");
const { install: installLegacyBridge } = require("../../public/js/monitor/legacy-bridge");

// ── helpers ───────────────────────────────────────────────────

function exampleAccountStatus(overrides = {}) {
  return {
    profile: {
      activeId: "personal",
      activeLabel: "Personal",
      count: 1,
      credentialBackend: "keychain",
    },
    deployment: {
      mode: "standard",
      publicSector: false,
      allowLocalExecutor: true,
      allowPlaintextSecrets: false,
      requireSandboxWorkspace: false,
      requirePiiScan: false,
    },
    bridge: { mode: "off" },
    remote: { mode: "off", activeRunnerCount: 0 },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
//  store.setAccountStatus — basic shape + publish
// ─────────────────────────────────────────────────────────────────

test("D3-b store: setAccountStatus stores all 4 sub-blocks + publishes", () => {
  const store = createMonitorStore();
  let snap = store.snapshot();
  assert.equal(snap.accountStatus, null,
    "fresh store has null accountStatus until first refresh");

  let received = null;
  const off = store.subscribe((s) => { received = s; });

  const input = exampleAccountStatus();
  store.setAccountStatus(input);

  assert.ok(received, "subscriber must fire on setAccountStatus");
  assert.ok(received.accountStatus);
  assert.deepEqual(received.accountStatus.profile, input.profile);
  assert.deepEqual(received.accountStatus.deployment, input.deployment);
  assert.deepEqual(received.accountStatus.bridge, input.bridge);
  assert.deepEqual(received.accountStatus.remote, input.remote);

  off();
});

test("D3-b store: snapshot returns DEFENSIVE shallow copies of each sub-block", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  const snap = store.snapshot();
  // Mutate the snapshot.
  snap.accountStatus.profile.activeId = "tampered";
  snap.accountStatus.deployment.publicSector = true;
  snap.accountStatus.bridge.mode = "ghost";
  snap.accountStatus.remote.mode = "ghost";
  // Re-snapshot — internal state must be untouched.
  const snap2 = store.snapshot();
  assert.equal(snap2.accountStatus.profile.activeId, "personal",
    "snapshot mutation must NOT reach into store state (profile)");
  assert.equal(snap2.accountStatus.deployment.publicSector, false);
  assert.equal(snap2.accountStatus.bridge.mode, "off");
  assert.equal(snap2.accountStatus.remote.mode, "off");
});

test("D3-b store: setAccountStatus(null) clears the slice", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  assert.ok(store.snapshot().accountStatus);
  store.setAccountStatus(null);
  assert.equal(store.snapshot().accountStatus, null,
    "explicit null must clear the slice (used on monitor close + tests)");
});

test("D3-b store: setAccountStatus(non-object) is no-op (no throw)", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  const beforeRef = store.snapshot().accountStatus;
  for (const bad of [42, "string", true]) {
    store.setAccountStatus(bad);
    const after = store.snapshot().accountStatus;
    // Same content (defensive copy makes the reference different)
    assert.deepEqual(after, beforeRef);
  }
});

// ─────────────────────────────────────────────────────────────────
//  setAccountStatus — partial-input preserves last-known-good
// ─────────────────────────────────────────────────────────────────

test("D3-b store: partial input preserves last-known-good for missing sub-blocks", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());

  // Partial: only update profile (e.g. user just switched profile).
  store.setAccountStatus({
    profile: {
      activeId: "agency",
      activeLabel: "Agency",
      count: 2,
      credentialBackend: "keychain",
    },
  });
  const snap = store.snapshot();
  assert.equal(snap.accountStatus.profile.activeId, "agency",
    "profile updated");
  assert.deepEqual(snap.accountStatus.deployment, exampleAccountStatus().deployment,
    "deployment preserved when not in partial input");
  assert.deepEqual(snap.accountStatus.bridge, exampleAccountStatus().bridge);
  assert.deepEqual(snap.accountStatus.remote, exampleAccountStatus().remote);
});

test("D3-b store: explicit { profile: null } in partial → null that sub-block (operator deleted profile)", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  store.setAccountStatus({ profile: null });
  const snap = store.snapshot();
  assert.equal(snap.accountStatus.profile, null,
    "explicit null in partial clears that sub-block");
  // Other sub-blocks preserved.
  assert.ok(snap.accountStatus.deployment);
});

// ─────────────────────────────────────────────────────────────────
//  reset() clears accountStatus too
// ─────────────────────────────────────────────────────────────────

test("D3-b store: reset() returns accountStatus to null", () => {
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  assert.ok(store.snapshot().accountStatus);
  store.reset();
  assert.equal(store.snapshot().accountStatus, null);
});

// ─────────────────────────────────────────────────────────────────
//  legacy-bridge refresh() → store.setAccountStatus mapping
// ─────────────────────────────────────────────────────────────────

function makeFetch(payload, opts = {}) {
  let calls = 0;
  return async function (_url, _init) {
    calls += 1;
    return {
      ok: opts.ok != null ? opts.ok : true,
      json: async () => payload,
    };
  };
}

function makeNormalize() {
  return function (event) {
    return event && typeof event === "object" ? { ...event } : null;
  };
}

test("D3-b bridge: refresh maps payload.{profile,deployment,bridge,remote} → setAccountStatus (single call)", async () => {
  const store = createMonitorStore();
  let setAccountCalls = 0;
  const origSet = store.setAccountStatus;
  store.setAccountStatus = function (input) {
    setAccountCalls += 1;
    return origSet.call(store, input);
  };

  const acct = exampleAccountStatus();
  const fetchImpl = makeFetch({
    pid: 1, uptime: 3, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false,
    activeChildren: [], activeChildCount: 0,
    profile: acct.profile,
    deployment: acct.deployment,
    bridge: acct.bridge,
    remote: acct.remote,
  });

  const bridge = installLegacyBridge({
    store,
    normalize: makeNormalize(),
    dispatcher: null,
    fetchImpl,
    setIntervalFn: null, // disable auto-poll; we call refresh() manually
  });

  await bridge.refresh();
  assert.equal(setAccountCalls, 1,
    "ONE setAccountStatus call per refresh — not 4 — to coalesce render");

  const snap = store.snapshot();
  assert.deepEqual(snap.accountStatus.profile, acct.profile);
  assert.deepEqual(snap.accountStatus.deployment, acct.deployment);
  assert.deepEqual(snap.accountStatus.bridge, acct.bridge);
  assert.deepEqual(snap.accountStatus.remote, acct.remote);

  bridge.destroy();
});

test("D3-b bridge: refresh on legacy /api/server/info (no D3 fields) does NOT call setAccountStatus", async () => {
  const store = createMonitorStore();
  let setAccountCalls = 0;
  store.setAccountStatus = function () { setAccountCalls += 1; };

  const fetchImpl = makeFetch({
    pid: 1, uptime: 3, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false,
    activeChildren: [], activeChildCount: 0,
    // No profile / deployment / bridge / remote — pre-D3-a server.
  });

  const bridge = installLegacyBridge({
    store,
    normalize: makeNormalize(),
    dispatcher: null,
    fetchImpl,
    setIntervalFn: null,
  });

  await bridge.refresh();
  assert.equal(setAccountCalls, 0,
    "legacy server response must NOT clobber last-known-good with empty");

  bridge.destroy();
});

test("D3-b bridge: refresh fires setAccountStatus when at least ONE D3 block is present", async () => {
  const store = createMonitorStore();
  let setAccountCalls = 0;
  const origSet = store.setAccountStatus;
  store.setAccountStatus = function (input) {
    setAccountCalls += 1;
    return origSet.call(store, input);
  };

  // Only profile present — partial server response (e.g. middleware
  // strip). Should still fire because it's partial-input that
  // preserves the other slots.
  const fetchImpl = makeFetch({
    pid: 1, uptime: 3, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false,
    activeChildren: [], activeChildCount: 0,
    profile: exampleAccountStatus().profile,
  });

  const bridge = installLegacyBridge({
    store,
    normalize: makeNormalize(),
    dispatcher: null,
    fetchImpl,
    setIntervalFn: null,
  });

  await bridge.refresh();
  assert.equal(setAccountCalls, 1);
  assert.deepEqual(store.snapshot().accountStatus.profile, exampleAccountStatus().profile);

  bridge.destroy();
});

test("D3-b bridge: refresh tolerates store.setAccountStatus missing (legacy in-tree consumer)", async () => {
  const store = createMonitorStore();
  // Strip the action — simulates a consumer using an older store
  // build that doesn't have setAccountStatus yet.
  delete store.setAccountStatus;

  const fetchImpl = makeFetch({
    pid: 1, uptime: 3, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false,
    activeChildren: [], activeChildCount: 0,
    profile: exampleAccountStatus().profile,
  });

  const bridge = installLegacyBridge({
    store,
    normalize: makeNormalize(),
    dispatcher: null,
    fetchImpl,
    setIntervalFn: null,
  });

  // Must NOT throw.
  const payload = await bridge.refresh();
  assert.ok(payload, "refresh still completes when setAccountStatus is absent");

  bridge.destroy();
});

test("D3-b bridge: refresh handles non-object D3 fields gracefully", async () => {
  const store = createMonitorStore();
  let setAccountCalls = 0;
  store.setAccountStatus = function () { setAccountCalls += 1; };

  // profile is a string (server bug or middleware corruption).
  const fetchImpl = makeFetch({
    pid: 1, uptime: 3, supervised: true, clients: 0, graceMs: 0, shutdownArmed: false,
    activeChildren: [], activeChildCount: 0,
    profile: "not-an-object",
    deployment: 42,
    bridge: null,
    remote: undefined,
  });

  const bridge = installLegacyBridge({
    store,
    normalize: makeNormalize(),
    dispatcher: null,
    fetchImpl,
    setIntervalFn: null,
  });

  await bridge.refresh();
  // None of those are valid objects → hasAccountFields=false → no call.
  assert.equal(setAccountCalls, 0,
    "non-object D3 fields must not propagate to setAccountStatus");

  bridge.destroy();
});
