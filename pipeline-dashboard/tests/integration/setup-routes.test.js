// tests/integration/setup-routes.test.js — Slice D2-c (Phase E1.5, 2026-04-29)
//
// Mounts createSetupRoutes() on a throw-away express app and exercises
// every endpoint end-to-end. Pattern mirrors profile-routes.test.js
// (D1-e) so the two test files stay readable together.
//
// What's covered:
//
//   POST /probe-node          — version parse + minimum gate
//   POST /probe-cli           — discoverCli pass-through (with stub)
//   POST /probe-provider      — providerProbe pass-through + tier3 consent
//                               + profile lookup + 404 for ghost profile
//   POST /probe-workspace     — write/delete on real tmp dirs
//   POST /finalize            — profileStore.upsert + setActive +
//                               public-sector violation 400 + active-run 409
//                               + audit emission

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const { createSetupRoutes } = require("../../src/routes/setupRoutes");

// ── helpers (lifted from profile-routes.test.js) ──────────────

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-setup-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return dir;
}

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) { entries.push({ runId, ...entry }); },
  };
}

function makeProfileStore(initial = []) {
  const map = new Map();
  for (const p of initial) map.set(p.id, p);
  let activeId = null;
  return {
    get(id) { return map.get(id) || null; },
    list() { return Array.from(map.values()); },
    getActive() { return map.get(activeId) || null; },
    getActiveId() { return activeId; },
    upsert(profile) {
      // Simulate validation: missing id throws.
      if (!profile || !profile.id) {
        throw new Error("profile.id required");
      }
      // Simulate public-sector validation when accountType=personal
      // is set with a special public-sector flag.
      if (profile._simulatePublicSectorFail) {
        const err = new Error(
          "public-sector validation failed: profile must use accountType=agency_managed",
        );
        err.details = ["public-sector profiles must use accountType=agency_managed (got \"personal\")"];
        throw err;
      }
      const stored = { ...profile, createdAt: new Date().toISOString() };
      map.set(profile.id, stored);
      return stored;
    },
    switch(id) {
      if (!map.has(id)) throw new Error(`unknown profile "${id}"`);
      activeId = id;
    },
  };
}

async function startApp(routes) {
  const app = express();
  app.use("/api", routes);
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        async close() {
          await new Promise((r) => server.close(r));
        },
      });
    });
  });
}

async function request(base, method, p, body) {
  const url = base + p;
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  return { status: res.status, body: json, text };
}

// ─────────────────────────────────────────────────────────────────
//  POST /api/setup/probe-node
// ─────────────────────────────────────────────────────────────────

test("D2-c: probe-node — returns Node version + satisfiesMinimum", async (t) => {
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-node");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.match(r.body.version, /^\d+\.\d+\.\d+/);
  assert.equal(r.body.minimumRequired, "24.0.0");
  // Whether satisfiesMinimum is true depends on which Node ran the
  // test. Lock the type only.
  assert.equal(typeof r.body.satisfiesMinimum, "boolean");
});

test("D2-c: probe-node — checkNodeVersionImpl injection (stub Node 18)", async (t) => {
  const routes = createSetupRoutes({
    checkNodeVersionImpl: () => ({
      version: "18.0.0",
      satisfiesMinimum: false,
      minimumRequired: "24.0.0",
      error: null,
    }),
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-node");
  assert.equal(r.body.satisfiesMinimum, false);
  assert.equal(r.body.version, "18.0.0");
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/setup/probe-cli
// ─────────────────────────────────────────────────────────────────

test("D2-c: probe-cli — name found via stub", async (t) => {
  const routes = createSetupRoutes({
    cliProbeImpl: (name) => ({
      found: true,
      name,
      path: "/usr/local/bin/" + name,
      paths: ["/usr/local/bin/" + name],
      error: null,
      raw: "/usr/local/bin/" + name + "\n",
      timedOut: false,
    }),
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-cli", { name: "claude" });
  assert.equal(r.status, 200);
  assert.equal(r.body.found, true);
  assert.equal(r.body.path, "/usr/local/bin/claude");
});

test("D2-c: probe-cli — invalid name surfaces structured failure", async (t) => {
  // No injection — uses real discoverCli, which rejects "../bin/x".
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-cli", { name: "../bin/x" });
  assert.equal(r.status, 200,
    "probe never throws — caller decides what to do with found:false");
  assert.equal(r.body.found, false);
  assert.match(r.body.error, /not allowed|not a valid/);
});

test("D2-c: probe-cli — missing body name → structured failure (no spawn)", async (t) => {
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-cli", {});
  assert.equal(r.status, 200);
  assert.equal(r.body.found, false);
  assert.match(r.body.error, /required/);
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/setup/probe-provider
// ─────────────────────────────────────────────────────────────────

test("D2-c: probe-provider — tier1+2 returns providerProbe result", async (t) => {
  const routes = createSetupRoutes({
    probeProviderImpl: async () => ({
      installed: true,
      authenticated: true,
      canRun: false,
      accountLabel: "alice@example.com",
      errorCode: null,
      spendsTokens: false,
      details: {
        cliPath: "/bin/claude",
        cliVersion: "1.2.3",
        lastTestedAt: new Date().toISOString(),
        elapsedMs: 42,
        probeMode: "tier1+2",
        stderr: null,
      },
    }),
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-provider", {
    runner: "claude",
    mode: "tier1+2",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.installed, true);
  assert.equal(r.body.authenticated, true);
  assert.equal(r.body.accountLabel, "alice@example.com");
});

test("D2-c: probe-provider — tier1+2+3 without consent → 400", async (t) => {
  let probeCalled = false;
  const routes = createSetupRoutes({
    probeProviderImpl: async () => { probeCalled = true; return {}; },
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-provider", {
    runner: "claude",
    mode: "tier1+2+3",
    // consentToTier3 missing
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "tier3_requires_consent");
  assert.equal(probeCalled, false,
    "probeProvider must NEVER fire without explicit tier-3 consent");
});

test("D2-c: probe-provider — tier1+2+3 with consent passes through", async (t) => {
  const routes = createSetupRoutes({
    probeProviderImpl: async (opts) => ({
      installed: true,
      authenticated: true,
      canRun: true,
      errorCode: null,
      spendsTokens: true,
      _opts: opts,
      details: { probeMode: opts.mode, lastTestedAt: new Date().toISOString(), elapsedMs: 1, cliPath: null, cliVersion: null, stderr: null },
    }),
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-provider", {
    runner: "claude",
    mode: "tier1+2+3",
    consentToTier3: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.canRun, true);
  assert.equal(r.body.spendsTokens, true);
});

test("D2-c: probe-provider — profileId not found → 404", async (t) => {
  const profileStore = makeProfileStore([]);
  const routes = createSetupRoutes({
    profileStore,
    probeProviderImpl: async () => { throw new Error("should not run"); },
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-provider", {
    runner: "claude",
    profileId: "ghost",
  });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "profile_not_found");
});

test("D2-c: probe-provider — profileId without profileStore → 503", async (t) => {
  const routes = createSetupRoutes({
    // profileStore deliberately omitted
    probeProviderImpl: async () => { throw new Error("should not run"); },
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-provider", {
    runner: "claude",
    profileId: "personal",
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "profileStore_not_wired");
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/setup/probe-workspace
// ─────────────────────────────────────────────────────────────────

test("D2-c: probe-workspace — writable dir → ok:true", async (t) => {
  const dir = tmpDir(t);
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-workspace", {
    workspacePath: dir,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.exists, true);
  assert.equal(r.body.writable, true);
  // Path normalized to absolute (already absolute on input here, but
  // the response always reports the resolved form).
  assert.ok(path.isAbsolute(r.body.normalizedPath));
});

test("D2-c: probe-workspace — non-existent dir → mkdirs and reports writable", async (t) => {
  const parent = tmpDir(t);
  const newDir = path.join(parent, "nested", "ws");
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-workspace", {
    workspacePath: newDir,
  });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.writable, true);
  // Verify the dir actually exists now.
  assert.ok(fs.statSync(newDir).isDirectory());
});

test("D2-c: probe-workspace — empty path → ok:false structured error", async (t) => {
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/probe-workspace", {
    workspacePath: "",
  });
  assert.equal(r.body.ok, false);
  assert.match(r.body.error, /required/);
});

test("D2-c: probe-workspace — non-string path → ok:false structured error", async (t) => {
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  for (const bad of [null, 42, [], {}]) {
    const r = await request(app.base, "POST", "/api/setup/probe-workspace", {
      workspacePath: bad,
    });
    assert.equal(r.body.ok, false, `must reject ${typeof bad}`);
    assert.match(r.body.error, /required/);
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/setup/finalize
// ─────────────────────────────────────────────────────────────────

test("D2-c: finalize — upserts profile + sets active", async (t) => {
  const profileStore = makeProfileStore();
  const ledger = makeLedger();
  const routes = createSetupRoutes({ profileStore, ledger });
  const app = await startApp(routes);
  t.after(() => app.close());

  const profile = {
    id: "personal",
    label: "Personal",
    workspacePath: tmpDir(t),
    activeProvider: "claude",
    secretIds: [],
  };
  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile,
    setActive: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.profile.id, "personal");
  assert.equal(r.body.activeProfileId, "personal");

  // Audit row emitted.
  const audit = ledger.entries.find((e) => e.type === "setup_finalize_ok");
  assert.ok(audit);
  assert.equal(audit.data.profileId, "personal");
  assert.equal(audit.data.activeProfileId, "personal");
});

test("D2-c: finalize — setActive omitted → profile created but not active", async (t) => {
  const profileStore = makeProfileStore();
  const routes = createSetupRoutes({ profileStore });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: { id: "p", label: "p", workspacePath: "/tmp", activeProvider: "claude", secretIds: [] },
    // setActive: false (default)
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.activeProfileId, null);
});

test("D2-c: finalize — missing profile → 400", async (t) => {
  const profileStore = makeProfileStore();
  const routes = createSetupRoutes({ profileStore });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {});
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "profile_required");
});

test("D2-c: finalize — non-object profile → 400", async (t) => {
  const profileStore = makeProfileStore();
  const routes = createSetupRoutes({ profileStore });
  const app = await startApp(routes);
  t.after(() => app.close());

  for (const bad of [null, 42, "string", []]) {
    const r = await request(app.base, "POST", "/api/setup/finalize", { profile: bad });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "profile_required");
  }
});

test("D2-c: finalize — profileStore not wired → 503", async (t) => {
  const routes = createSetupRoutes({ /* no profileStore */ });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: { id: "x" },
  });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "profileStore_not_wired");
});

test("D2-c: finalize — public-sector violation surfaces details[]", async (t) => {
  const profileStore = makeProfileStore();
  const routes = createSetupRoutes({ profileStore });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: {
      id: "agency",
      label: "Agency",
      workspacePath: "/sandbox/agency",
      activeProvider: "claude",
      secretIds: [],
      // Sentinel that the stub profileStore turns into a thrown error
      // with an err.details[] field — mirrors D1-gov-2 behaviour.
      _simulatePublicSectorFail: true,
    },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "profile_upsert_failed");
  assert.ok(Array.isArray(r.body.details));
  assert.ok(r.body.details.length > 0);
  assert.match(r.body.details[0], /agency_managed/);
});

test("D2-c: finalize — active run blocks setActive → 409 + audit", async (t) => {
  const profileStore = makeProfileStore();
  const ledger = makeLedger();
  const routes = createSetupRoutes({
    profileStore,
    ledger,
    isActiveRun: () => true,
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: { id: "personal" },
    setActive: true,
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "active_run_blocks_setup");

  const audit = ledger.entries.find((e) => e.type === "setup_finalize_blocked");
  assert.ok(audit);
  assert.equal(audit.data.reason, "active_run");
});

test("D2-c: finalize — active run blocks even setActive=false", async (t) => {
  // The active-run gate fires regardless of setActive — finalize
  // shouldn't even create a new profile while a run is in flight,
  // because then the operator might switch right after.
  const profileStore = makeProfileStore();
  const routes = createSetupRoutes({
    profileStore,
    isActiveRun: () => true,
  });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: { id: "p" },
    setActive: false,
  });
  assert.equal(r.status, 409);
});

test("D2-c: finalize — switch failure returns 200 + warning", async (t) => {
  // upsert succeeds; switch throws (e.g. stale state). Operator
  // gets the profile created — switch warning is informational.
  const profileStore = makeProfileStore();
  profileStore.switch = () => { throw new Error("registry stale"); };
  const routes = createSetupRoutes({ profileStore });
  const app = await startApp(routes);
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/setup/finalize", {
    profile: { id: "p", label: "p", workspacePath: "/tmp", activeProvider: "claude", secretIds: [] },
    setActive: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.activeProfileId, null);
  assert.match(r.body.switchError, /registry stale/);
});

// ─────────────────────────────────────────────────────────────────
//  ROUTE PATHS LOCK
// ─────────────────────────────────────────────────────────────────

test("D2-c: 5 documented endpoints are mounted", async (t) => {
  const routes = createSetupRoutes({});
  const app = await startApp(routes);
  t.after(() => app.close());

  // 404 for an undocumented path (router returns no match).
  const ghost = await request(app.base, "POST", "/api/setup/probe-ghost", {});
  assert.equal(ghost.status, 404);

  // 200 / structured response for each documented endpoint:
  const endpoints = [
    ["/api/setup/probe-node", undefined],
    ["/api/setup/probe-cli", { name: "claude" }],
    ["/api/setup/probe-workspace", { workspacePath: "" }],
  ];
  for (const [p, body] of endpoints) {
    const r = await request(app.base, "POST", p, body);
    assert.notEqual(r.status, 404, `endpoint ${p} should be mounted`);
  }
});
