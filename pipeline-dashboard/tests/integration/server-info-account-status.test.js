// tests/integration/server-info-account-status.test.js — Slice D3-a (Phase E1.5, 2026-04-29)
//
// Locks the additive fields the monitor shell's global-bar 5-cell
// extension (D3-c) + settings-accounts modal (D3-d) consume:
//
//   profile     — { activeId, activeLabel, count, credentialBackend }
//   deployment  — { mode, publicSector, allowLocalExecutor,
//                  allowPlaintextSecrets, requireSandboxWorkspace,
//                  requirePiiScan }
//   bridge      — { mode }                       // off | report | dispatch
//   remote      — { mode, activeRunnerCount }    // off | preview | on
//
// Each block individually try/catches in the route, so a misbehaving
// dep can't break the entire info endpoint. The tests:
//
//   - All four fields ALWAYS present (even when deps are null) — UI
//     contract relies on shape, not optional null-check.
//   - Profile activeId / activeLabel reflect profileStore.getActive().
//   - Profile count reflects profileStore.list().
//   - credentialBackend reflects credentialStore.backend.
//   - Deployment posture maps every D1-gov-1 flag onto the response.
//   - Bridge.mode normalizes off/report/dispatch + safe-default for
//     unrecognized values.
//   - Remote.mode normalizes off/preview/on + activeRunnerCount from
//     runnerRegistry.list().
//   - Throwing deps don't break the endpoint (defensive try/catch).
//   - Existing MA0 / R2.5-e fields still present (no regression).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const {
  createServerControlRoutes,
  _summarizeProfile,
  _summarizeDeployment,
  _summarizeBridge,
  _summarizeRemote,
} = require("../../src/routes/serverControlRoutes");

// ── helpers ───────────────────────────────────────────────────

function startApp(deps = {}) {
  const app = express();
  app.use("/api", createServerControlRoutes({
    broadcast: () => {},
    clients: new Set(),
    gracefulShutdown: () => {},
    server: { close() {} },
    CLIENT_GRACE_MS: 1000,
    shutdownTimerRef: { timer: null },
    ...deps,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { reject(new Error("non-json: " + text)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function makeProfileStore(profiles = [], activeId = null) {
  const map = new Map();
  for (const p of profiles) map.set(p.id, p);
  return {
    list() { return Array.from(map.values()); },
    getActive() { return map.get(activeId) || null; },
    getActiveId() { return activeId; },
  };
}

// ─────────────────────────────────────────────────────────────────
//  STABLE SHAPE (no deps wired)
// ─────────────────────────────────────────────────────────────────

test("D3-a: /api/server/info ALWAYS exposes profile/deployment/bridge/remote (back-compat default)", async () => {
  // No D3-a deps wired — every block must still come back as a
  // safe-default object so the UI doesn't have to handle "missing".
  const { server, port } = await startApp({});
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    // Shape must be present.
    assert.ok(body.profile, "profile field is always present");
    assert.equal(body.profile.activeId, null);
    assert.equal(body.profile.activeLabel, null);
    assert.equal(body.profile.count, 0);
    assert.equal(body.profile.credentialBackend, null);

    assert.ok(body.deployment);
    assert.equal(body.deployment.mode, "standard");
    assert.equal(body.deployment.publicSector, false);
    assert.equal(body.deployment.allowLocalExecutor, true);
    assert.equal(body.deployment.allowPlaintextSecrets, false);
    assert.equal(body.deployment.requireSandboxWorkspace, false);
    assert.equal(body.deployment.requirePiiScan, false);

    assert.ok(body.bridge);
    assert.equal(body.bridge.mode, "off");

    assert.ok(body.remote);
    assert.equal(body.remote.mode, "off");
    assert.equal(body.remote.activeRunnerCount, 0);

    // Slice UI-H1: monitor.envDefault is always present.
    assert.ok(body.monitor, "monitor field is always present");
    assert.equal(typeof body.monitor.envDefault, "string");

    // No regression on MA0 / R2.5-e fields.
    assert.deepEqual(body.activeChildren, []);
    assert.deepEqual(body.hookStats, {});
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  Slice UI-H1 — MONITOR BLOCK
// ─────────────────────────────────────────────────────────────────

test("UI-H1: monitor.envDefault defaults to 'simple' when ORCHESTRATOR_MONITOR_MODE unset", async () => {
  const saved = process.env.ORCHESTRATOR_MONITOR_MODE;
  delete process.env.ORCHESTRATOR_MONITOR_MODE;
  try {
    const { server, port } = await startApp({});
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.monitor.envDefault, "simple");
    } finally { server.close(); }
  } finally {
    if (saved !== undefined) process.env.ORCHESTRATOR_MONITOR_MODE = saved;
  }
});

test("UI-H1: monitor.envDefault echoes ORCHESTRATOR_MONITOR_MODE=advanced", async () => {
  const saved = process.env.ORCHESTRATOR_MONITOR_MODE;
  process.env.ORCHESTRATOR_MONITOR_MODE = "advanced";
  try {
    const { server, port } = await startApp({});
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.monitor.envDefault, "advanced");
    } finally { server.close(); }
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_MONITOR_MODE;
    else process.env.ORCHESTRATOR_MONITOR_MODE = saved;
  }
});

test("UI-H1: monitor.envDefault accepts 'legacy' as a valid mode", async () => {
  const saved = process.env.ORCHESTRATOR_MONITOR_MODE;
  process.env.ORCHESTRATOR_MONITOR_MODE = "legacy";
  try {
    const { server, port } = await startApp({});
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.monitor.envDefault, "legacy");
    } finally { server.close(); }
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_MONITOR_MODE;
    else process.env.ORCHESTRATOR_MONITOR_MODE = saved;
  }
});

test("UI-H1: monitor.envDefault falls back to 'simple' for garbage env values", async () => {
  const saved = process.env.ORCHESTRATOR_MONITOR_MODE;
  process.env.ORCHESTRATOR_MONITOR_MODE = "pro";  // not in valid set
  try {
    const { server, port } = await startApp({});
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.monitor.envDefault, "simple");
    } finally { server.close(); }
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_MONITOR_MODE;
    else process.env.ORCHESTRATOR_MONITOR_MODE = saved;
  }
});

test("UI-H1: monitor.envDefault is case-insensitive (trims + lowercases)", async () => {
  const saved = process.env.ORCHESTRATOR_MONITOR_MODE;
  process.env.ORCHESTRATOR_MONITOR_MODE = "  ADVANCED  ";
  try {
    const { server, port } = await startApp({});
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.monitor.envDefault, "advanced");
    } finally { server.close(); }
  } finally {
    if (saved === undefined) delete process.env.ORCHESTRATOR_MONITOR_MODE;
    else process.env.ORCHESTRATOR_MONITOR_MODE = saved;
  }
});

// ─────────────────────────────────────────────────────────────────
//  PROFILE BLOCK
// ─────────────────────────────────────────────────────────────────

test("D3-a: profile block reflects profileStore.list() + getActive() + credentialStore.backend", async () => {
  const profileStore = makeProfileStore(
    [
      { id: "personal", label: "Personal" },
      { id: "agency", label: "Agency" },
    ],
    "personal",
  );
  const credentialStore = { backend: "keychain" };

  const { server, port } = await startApp({ profileStore, credentialStore });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.profile.activeId, "personal");
    assert.equal(body.profile.activeLabel, "Personal");
    assert.equal(body.profile.count, 2);
    assert.equal(body.profile.credentialBackend, "keychain");
  } finally { server.close(); }
});

test("D3-a: profile block tolerates getActive() returning null", async () => {
  const profileStore = makeProfileStore(
    [{ id: "p1", label: "P1" }],
    null, // no active
  );
  const { server, port } = await startApp({
    profileStore,
    credentialStore: { backend: "plaintext" },
  });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.profile.activeId, null);
    assert.equal(body.profile.activeLabel, null);
    assert.equal(body.profile.count, 1);
    assert.equal(body.profile.credentialBackend, "plaintext");
  } finally { server.close(); }
});

test("D3-a: profile block — throwing list() / getActive() does NOT break /api/server/info", async () => {
  const profileStore = {
    list() { throw new Error("list exploded"); },
    getActive() { throw new Error("getActive exploded"); },
  };
  const { server, port } = await startApp({ profileStore });
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    // Defaults preserved.
    assert.equal(body.profile.activeId, null);
    assert.equal(body.profile.count, 0);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  DEPLOYMENT BLOCK
// ─────────────────────────────────────────────────────────────────

test("D3-a: deployment block echoes a public-sector posture", async () => {
  // Simulate the resolveDeploymentProfile() output for ORCHESTRATOR_DEPLOYMENT_PROFILE=public-sector.
  const deploymentProfile = Object.freeze({
    mode: "public-sector",
    publicSector: true,
    allowLocalExecutor: false,
    allowPersonalAccounts: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requireAgencyManagedAccount: true,
    requireSignedManifest: true,
    requirePiiScanBeforeProviderDispatch: true,
    scannerFailurePolicy: "block",
  });
  const { server, port } = await startApp({ deploymentProfile });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.deployment.mode, "public-sector");
    assert.equal(body.deployment.publicSector, true);
    assert.equal(body.deployment.allowLocalExecutor, false);
    assert.equal(body.deployment.allowPlaintextSecrets, false);
    assert.equal(body.deployment.requireSandboxWorkspace, true);
    assert.equal(body.deployment.requirePiiScan, true);
  } finally { server.close(); }
});

test("D3-a: deployment block defaults to standard when dep is null", async () => {
  const { server, port } = await startApp({ deploymentProfile: null });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.deployment.mode, "standard");
    assert.equal(body.deployment.publicSector, false);
    assert.equal(body.deployment.allowLocalExecutor, true);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  BRIDGE BLOCK
// ─────────────────────────────────────────────────────────────────

test("D3-a: bridge.mode reflects ORCHESTRATOR_REMOTE_BRIDGE_MODE values", async () => {
  for (const mode of ["off", "report", "dispatch"]) {
    const { server, port } = await startApp({ bridgeMode: mode });
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.bridge.mode, mode);
    } finally { server.close(); }
  }
});

test("D3-a: bridge.mode defaults to 'off' for unrecognized values (UI safety)", async () => {
  for (const bad of [null, undefined, "ghost", "DISPATCH", 42, true]) {
    const { server, port } = await startApp({ bridgeMode: bad });
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.bridge.mode, "off",
        `unrecognized bridgeMode "${bad}" must degrade to "off"`);
    } finally { server.close(); }
  }
});

// ─────────────────────────────────────────────────────────────────
//  REMOTE BLOCK
// ─────────────────────────────────────────────────────────────────

test("D3-a: remote.mode reflects ORCHESTRATOR_REMOTE_MODE values", async () => {
  for (const mode of ["off", "preview", "on"]) {
    const { server, port } = await startApp({ remoteMode: mode });
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.remote.mode, mode);
    } finally { server.close(); }
  }
});

test("D3-a: remote.mode defaults to 'off' for unrecognized values", async () => {
  for (const bad of [null, undefined, "ghost", "ON", 42, false]) {
    const { server, port } = await startApp({ remoteMode: bad });
    try {
      const { body } = await get(port, "/api/server/info");
      assert.equal(body.remote.mode, "off");
    } finally { server.close(); }
  }
});

test("D3-a: remote.activeRunnerCount reflects runnerRegistry.list().length", async () => {
  const runnerRegistry = {
    list() {
      return [
        { hostIdentity: "runner-A" },
        { hostIdentity: "runner-B" },
      ];
    },
  };
  const { server, port } = await startApp({ runnerRegistry, remoteMode: "on" });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.remote.activeRunnerCount, 2);
    assert.equal(body.remote.mode, "on");
  } finally { server.close(); }
});

test("D3-a: remote.activeRunnerCount=0 when registry is null (single-orchestrator deployment)", async () => {
  const { server, port } = await startApp({ runnerRegistry: null });
  try {
    const { body } = await get(port, "/api/server/info");
    assert.equal(body.remote.activeRunnerCount, 0);
  } finally { server.close(); }
});

test("D3-a: remote block tolerates throwing registry.list()", async () => {
  const runnerRegistry = {
    list() { throw new Error("registry stale"); },
  };
  const { server, port } = await startApp({ runnerRegistry });
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    assert.equal(body.remote.activeRunnerCount, 0);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  CO-EXISTS WITH MA0 / R2.5-e (no regression)
// ─────────────────────────────────────────────────────────────────

test("D3-a: D3 fields co-exist with MA0 activeChildren + R2.5-e hookStats (no key collision)", async () => {
  const { createChildRegistry } = require("../../src/runtime/childRegistry");
  const childRegistry = createChildRegistry();
  childRegistry.register({ pid: 401, kill() {} }, { label: "claude", runId: "X" });
  const hookRouter = {
    getStats: () => ({ total: 5, remoteHookDispatched: 1 }),
  };
  const profileStore = makeProfileStore([{ id: "p", label: "P" }], "p");

  const { server, port } = await startApp({
    childRegistry,
    hookRouter,
    profileStore,
    credentialStore: { backend: "keychain" },
    deploymentProfile: Object.freeze({ mode: "standard", publicSector: false, allowLocalExecutor: true }),
    bridgeMode: "report",
    remoteMode: "preview",
  });
  try {
    const { body } = await get(port, "/api/server/info");
    // D3 fields:
    assert.equal(body.profile.activeId, "p");
    assert.equal(body.profile.credentialBackend, "keychain");
    assert.equal(body.deployment.mode, "standard");
    assert.equal(body.bridge.mode, "report");
    assert.equal(body.remote.mode, "preview");
    // MA0 + R2.5-e fields still there:
    assert.equal(body.activeChildren.length, 1);
    assert.equal(body.activeChildren[0].pid, 401);
    assert.equal(body.hookStats.remoteHookDispatched, 1);
  } finally { server.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  HELPER FUNCTIONS — direct unit checks
//
//  Faster than full HTTP roundtrip; verifies the contract a unit
//  consumer (D3-b store mapper) can rely on.
// ─────────────────────────────────────────────────────────────────

test("D3-a: _summarizeProfile returns the documented stable shape", () => {
  const result = _summarizeProfile({});
  assert.deepEqual(
    Object.keys(result).sort(),
    ["activeId", "activeLabel", "count", "credentialBackend"].sort(),
  );
});

test("D3-a: _summarizeDeployment returns 7 documented fields (post SMART-ARC-PROBE-SCHEMA-FIX)", () => {
  // SMART-ARC-PROBE-SCHEMA-FIX (2026-05-05) added `hardGatesDefault`
  // so the smart-arc live probe can verify the SMART-2 default of the
  // resolved pack. Both branches of _summarizeDeployment (null +
  // populated) must include the field.
  const result = _summarizeDeployment(null);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "allowLocalExecutor",
      "allowPlaintextSecrets",
      "hardGatesDefault",
      "mode",
      "publicSector",
      "requirePiiScan",
      "requireSandboxWorkspace",
    ].sort(),
  );
  assert.equal(result.hardGatesDefault, false,
    "null deploymentProfile must default hardGatesDefault to false");
});

test("D3-a: _summarizeDeployment surfaces hardGatesDefault from a populated pack", () => {
  // Mirror branch: populated profile must propagate hardGatesDefault.
  const result = _summarizeDeployment({
    mode: "finance-high-privacy",
    publicSector: true,
    allowLocalExecutor: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requirePiiScanBeforeProviderDispatch: true,
    hardGatesDefault: true,
  });
  assert.equal(result.hardGatesDefault, true,
    "populated deploymentProfile.hardGatesDefault must propagate to summary");
});

test("D3-a: _summarizeBridge returns { mode } only", () => {
  const result = _summarizeBridge("dispatch");
  assert.deepEqual(Object.keys(result), ["mode"]);
  assert.equal(result.mode, "dispatch");
});

test("D3-a: _summarizeRemote returns { mode, activeRunnerCount }", () => {
  const result = _summarizeRemote({});
  assert.deepEqual(Object.keys(result).sort(), ["activeRunnerCount", "mode"].sort());
});
