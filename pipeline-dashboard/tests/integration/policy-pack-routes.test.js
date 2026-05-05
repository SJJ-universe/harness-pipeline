// Slice POL-b (Phase 2 / POLICY-UX-0, 2026-05-05) — policy pack
// catalog route integration tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const { createPolicyPackRoutes } = require("../../src/routes/policyPackRoutes");

async function withServer({
  deploymentProfile = null,
  env = {},
} = {}, fn) {
  const app = express();
  app.use("/api", createPolicyPackRoutes({ deploymentProfile, env }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  try {
    await fn({ port });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function httpGet(port, path) {
  return await new Promise((resolve, reject) => {
    const req = http.request({
      method: "GET", host: "127.0.0.1", port, path,
      headers: { Accept: "application/json" },
    }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch (_) {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Schema + structure ────────────────────────────────────────────

test("POL-b: GET /api/policy-packs returns frozen schema + 5 packs", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.status, 200);
    assert.equal(res.body.schema, "harness-policy-pack/v1");
    assert.ok(Array.isArray(res.body.packs));
    assert.equal(res.body.packs.length, 5);
  });
});

test("POL-b: each pack carries the expected rule fields", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    const required = [
      "modeId", "label", "description",
      "publicSector", "allowLocalExecutor", "allowPersonalAccounts",
      "allowPlaintextSecrets", "requireSandboxWorkspace",
      "requireAgencyManagedAccount", "requireSignedManifest",
      "requirePiiScanBeforeProviderDispatch", "scannerFailurePolicy",
      "hardGatesDefault", "runMemoryEnabled", "isCurrent",
    ];
    for (const pack of res.body.packs) {
      for (const field of required) {
        assert.ok(field in pack, `${pack.modeId}.${field} present`);
      }
    }
  });
});

test("POL-b: 5 pack modeIds match registry (sorted)", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    const ids = res.body.packs.map((p) => p.modeId);
    // Order doesn't have to be sorted in the route — registry is, but
    // route can rearrange. Verify by set equality.
    assert.deepEqual(
      [...ids].sort(),
      ["developer-lab", "finance-high-privacy", "offline-internal-network",
       "public-sector", "standard"],
    );
  });
});

// ── currentPack reflects deploymentProfile ────────────────────────

test("POL-b: currentPack=null when no deploymentProfile", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.currentPack, null);
    // No pack has isCurrent=true
    for (const p of res.body.packs) {
      assert.equal(p.isCurrent, false, `${p.modeId} not current`);
    }
  });
});

test("POL-b: currentPack reflects deploymentProfile.pack", async () => {
  await withServer({
    deploymentProfile: { pack: "finance-high-privacy" },
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.currentPack, "finance-high-privacy");
    const fhp = res.body.packs.find((p) => p.modeId === "finance-high-privacy");
    assert.ok(fhp);
    assert.equal(fhp.isCurrent, true);
    // Other packs have isCurrent=false
    for (const p of res.body.packs) {
      if (p.modeId !== "finance-high-privacy") {
        assert.equal(p.isCurrent, false, `${p.modeId} not current`);
      }
    }
  });
});

// ── Metadata ──────────────────────────────────────────────────────

test("POL-b: metadata.hardGatesEffectiveMode reflects POL-a precedence", async () => {
  // env=1 + no pack default → hard
  await withServer({
    env: { HARNESS_HARD_GATES: "1" },
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.hardGatesEffectiveMode, "hard");
    assert.equal(res.body.metadata.hardGatesEnvOverride, true);
  });
});

test("POL-b: metadata.hardGatesEffectiveMode picks pack default when env unset", async () => {
  await withServer({
    deploymentProfile: { pack: "finance-high-privacy", hardGatesDefault: true },
    env: {},
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.hardGatesEffectiveMode, "hard",
      "pack hardGatesDefault=true engages when env unset");
    assert.equal(res.body.metadata.hardGatesEnvOverride, false);
  });
});

test("POL-b: metadata.hardGatesEffectiveMode 'warn' when env=0 + pack hardGatesDefault=true", async () => {
  // Operator override in incident triage scenario
  await withServer({
    deploymentProfile: { pack: "finance-high-privacy", hardGatesDefault: true },
    env: { HARNESS_HARD_GATES: "0" },
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.hardGatesEffectiveMode, "warn");
    assert.equal(res.body.metadata.hardGatesEnvOverride, true);
  });
});

test("POL-b: metadata.runMemoryEffective reflects pack + env", async () => {
  // Default pack (runMemoryEnabled=true) + env unset → effective true
  await withServer({
    deploymentProfile: { runMemoryEnabled: true },
    env: {},
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.runMemoryEffective, true);
    assert.equal(res.body.metadata.runMemoryEnvOverride, false);
  });
});

test("POL-b: env HARNESS_RUN_MEMORY_DISABLE=1 → runMemoryEffective:false", async () => {
  await withServer({
    deploymentProfile: { runMemoryEnabled: true },
    env: { HARNESS_RUN_MEMORY_DISABLE: "1" },
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.runMemoryEffective, false);
    assert.equal(res.body.metadata.runMemoryEnvOverride, true);
  });
});

test("POL-b: pack runMemoryEnabled=false → runMemoryEffective:false (without env override)", async () => {
  await withServer({
    deploymentProfile: { runMemoryEnabled: false },
    env: {},
  }, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.equal(res.body.metadata.runMemoryEffective, false);
    assert.equal(res.body.metadata.runMemoryEnvOverride, false);
  });
});

// ── Public-sector requirements text ──────────────────────────────

test("POL-b: metadata.publicSectorRequirements is 5-bullet operator checklist", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    assert.ok(Array.isArray(res.body.metadata.publicSectorRequirements));
    assert.equal(res.body.metadata.publicSectorRequirements.length, 5);
    // Verify key bullet content
    const joined = res.body.metadata.publicSectorRequirements.join(" ");
    assert.match(joined, /agency-managed/);
    assert.match(joined, /sandbox/);
    assert.match(joined, /signed manifest/);
    assert.match(joined, /PII scan/);
    assert.match(joined, /plaintext secrets/);
  });
});

// ── Cross-field invariants visible in catalog ────────────────────

test("POL-b: every public-sector pack has allowLocalExecutor=false in catalog", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    for (const p of res.body.packs) {
      if (p.publicSector) {
        assert.equal(p.allowLocalExecutor, false, `${p.modeId}`);
        assert.equal(p.allowPlaintextSecrets, false, `${p.modeId}`);
        assert.equal(p.requireSandboxWorkspace, true, `${p.modeId}`);
      }
    }
  });
});

test("POL-b: only finance-high-privacy has hardGatesDefault=true in catalog", async () => {
  await withServer({}, async ({ port }) => {
    const res = await httpGet(port, "/api/policy-packs");
    const hardPacks = res.body.packs.filter((p) => p.hardGatesDefault === true);
    assert.equal(hardPacks.length, 1);
    assert.equal(hardPacks[0].modeId, "finance-high-privacy");
  });
});

// ── serverTime ────────────────────────────────────────────────────

test("POL-b: response carries serverTime (epoch ms)", async () => {
  await withServer({}, async ({ port }) => {
    const before = Date.now();
    const res = await httpGet(port, "/api/policy-packs");
    const after = Date.now();
    assert.ok(typeof res.body.serverTime === "number");
    assert.ok(res.body.serverTime >= before);
    assert.ok(res.body.serverTime <= after);
  });
});
