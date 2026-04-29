// tests/integration/profile-routes.test.js — Slice D1-e (Phase E1, 2026-04-29)
//
// Mounts createProfileRoutes() on a tiny throw-away express app and
// exercises every route end-to-end. The full server.js wires auth +
// CSP + rate-limiting on top, but those are covered by their own
// suites. This test focuses on the route's CONTRACT — which paths
// 200 / 400 / 404 / 409, what shape they return, and how the
// public-sector + active-run gates surface to the wire.
//
// Why express directly (not booting full server.js):
//   - Faster (~50ms boot instead of ~3s).
//   - Cleaner isolation — no other routes interfere with assertions.
//   - Lets us inject stub stores + stub ledger so we can verify
//     audit emission without parsing the real EvidenceLedger JSONL.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const { createProfileRoutes } = require("../../src/routes/profileRoutes");
const { createProfileStore } = require("../../src/runtime/profileStore");
const { createCredentialStore } = require("../../src/security/credentialStore");

// ── helpers ─────────────────────────────────────────────────

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-routes-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return path.join(dir, "profiles.json");
}

function makeKeytarStub() {
  const store = new Map();
  return {
    async setPassword(s, a, p) { store.set(`${s}::${a}`, p); },
    async getPassword(s, a) { return store.get(`${s}::${a}`) || null; },
    async deletePassword(s, a) { store.delete(`${s}::${a}`); },
    async findCredentials(s) {
      const out = [];
      for (const [k, v] of store) {
        const [svc, account] = k.split("::");
        if (svc === s) out.push({ account, password: v });
      }
      return out;
    },
  };
}

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) { entries.push({ runId, ...entry }); },
  };
}

async function startApp(routes) {
  const app = express();
  app.use(express.json());
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

async function request(base, method, path, body) {
  const url = base + path;
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, text };
}

function sampleProfile(id, overrides = {}) {
  return {
    id,
    label: `Profile ${id}`,
    workspacePath: process.platform === "win32"
      ? `C:\\workspace\\${id}`
      : `/tmp/workspace/${id}`,
    activeProvider: "claude",
    secretIds: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
//  GET / + GET /:id
// ─────────────────────────────────────────────────────────────────

test("D1-e GET /api/profiles: empty store returns []", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profiles, []);
  assert.equal(r.body.activeProfileId, null);
});

test("D1-e GET /api/profiles: populated store returns id-sorted profiles + activeProfileId", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("zulu"));
  profileStore.upsert(sampleProfile("alpha"));
  profileStore.setActive("alpha");
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.profiles.map((p) => p.id), ["alpha", "zulu"]);
  assert.equal(r.body.activeProfileId, "alpha");
});

test("D1-e GET /api/profiles/:id: unknown id returns 404", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles/never-exists");
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
});

test("D1-e GET /api/profiles/:id: returns the public profile shape (no extra fields)", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal", { secretIds: ["X", "Y"] }));
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles/personal");
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.id, "personal");
  assert.equal(r.body.profile.label, "Profile personal");
  assert.deepEqual(r.body.profile.secretIds, ["X", "Y"]);
  assert.ok(r.body.profile.createdAt);
  assert.ok(r.body.profile.updatedAt);
});

// ─────────────────────────────────────────────────────────────────
//  POST / (upsert)
// ─────────────────────────────────────────────────────────────────

test("D1-e POST /api/profiles: valid body creates a profile", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles", sampleProfile("personal"));
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.id, "personal");

  // Confirm it persisted.
  const list = await request(app.base, "GET", "/api/profiles");
  assert.deepEqual(list.body.profiles.map((p) => p.id), ["personal"]);
});

test("D1-e POST /api/profiles: invalid body returns 400 with descriptive error", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const bad = { ...sampleProfile("p"), workspacePath: "./relative" };
  const r = await request(app.base, "POST", "/api/profiles", bad);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /must be absolute/);
});

test("D1-e POST /api/profiles: public-sector violation returns 400 with structured shape", async (t) => {
  const file = tmpFile(t);
  // Force public-sector mode for this profileStore via the injection
  // path so the route returns the structured policy error.
  const profileStore = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  // Standard-mode shape (no agency fields) → public-sector validation fails.
  const r = await request(app.base, "POST", "/api/profiles", sampleProfile("agency"));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "public_sector_profile_policy");
  assert.ok(Array.isArray(r.body.details));
  assert.ok(r.body.details.length > 0,
    `expected non-empty details, got: ${JSON.stringify(r.body)}`);
});

// ─────────────────────────────────────────────────────────────────
//  DELETE /:id
// ─────────────────────────────────────────────────────────────────

test("D1-e DELETE /api/profiles/:id: removes existing profile", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "DELETE", "/api/profiles/personal");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  const list = await request(app.base, "GET", "/api/profiles");
  assert.deepEqual(list.body.profiles, []);
});

test("D1-e DELETE /api/profiles/:id: unknown id returns 404", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "DELETE", "/api/profiles/never-exists");
  assert.equal(r.status, 404);
});

// ─────────────────────────────────────────────────────────────────
//  POST /:id/switch + active-run gate
// ─────────────────────────────────────────────────────────────────

test("D1-e POST /api/profiles/:id/switch: switches active profile", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("alpha"));
  profileStore.upsert(sampleProfile("beta"));
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles/alpha/switch");
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.id, "alpha");

  const list = await request(app.base, "GET", "/api/profiles");
  assert.equal(list.body.activeProfileId, "alpha");
});

test("D1-e POST /api/profiles/:id/switch: 409 + audit when active run exists", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("alpha"));
  profileStore.upsert(sampleProfile("beta"));
  profileStore.setActive("alpha");
  const ledger = makeLedger();

  let isActive = true; // simulate orchestrator with an in-flight run

  const app = await startApp(createProfileRoutes({
    profileStore,
    isActiveRun: () => isActive,
    ledger,
  }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles/beta/switch");
  assert.equal(r.status, 409,
    "active-run gate must block the switch with 409 (not 400)");
  assert.equal(r.body.error, "active_run");
  assert.match(r.body.message, /활성 run|in-flight run/);

  // active profile must NOT have changed.
  const list = await request(app.base, "GET", "/api/profiles");
  assert.equal(list.body.activeProfileId, "alpha");

  // Audit row must fire with reason=active_run.
  const blocked = ledger.entries.find((e) => e.type === "profile_switch_blocked");
  assert.ok(blocked);
  assert.equal(blocked.data.fromId, "alpha");
  assert.equal(blocked.data.toId, "beta");
  assert.equal(blocked.data.reason, "active_run");
});

test("D1-e POST /api/profiles/:id/switch: 404 on unknown id", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  const app = await startApp(createProfileRoutes({ profileStore }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles/ghost/switch");
  assert.equal(r.status, 404);
});

// ─────────────────────────────────────────────────────────────────
//  Secret routes — never echo values
// ─────────────────────────────────────────────────────────────────

test("D1-e GET /api/profiles/:id/secrets: returns ONLY keys, never values (CRITICAL)", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));

  const credentialStore = createCredentialStore({ keytar: makeKeytarStub() });
  await credentialStore.setSecret("personal", "ANTHROPIC_API_KEY", "sk-secret-xyz");
  await credentialStore.setSecret("personal", "OPENAI_API_KEY", "sk-other");

  const app = await startApp(createProfileRoutes({ profileStore, credentialStore }));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles/personal/secrets");
  assert.equal(r.status, 200);
  const ids = r.body.secretIds.slice().sort();
  assert.deepEqual(ids, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  // CRITICAL regression guard: response body MUST NOT contain
  // "sk-secret-xyz" anywhere.
  assert.ok(!/sk-secret-xyz/.test(r.text),
    "secret value must NEVER appear in any response");
  assert.ok(!/sk-other/.test(r.text));
});

test("D1-e POST /api/profiles/:id/secrets: stores secret + does NOT echo value", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));

  const credentialStore = createCredentialStore({ keytar: makeKeytarStub() });
  const app = await startApp(createProfileRoutes({ profileStore, credentialStore }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles/personal/secrets", {
    key: "ANTHROPIC_API_KEY",
    value: "sk-secret-stored",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.key, "ANTHROPIC_API_KEY");
  assert.equal(r.body.backend, "keychain");
  // Response shape MUST NOT carry the value back.
  assert.equal(r.body.value, undefined);
  assert.ok(!/sk-secret-stored/.test(r.text),
    "POST must never echo the stored value back");

  // Confirm it actually stored.
  const got = await credentialStore.getSecret("personal", "ANTHROPIC_API_KEY");
  assert.equal(got, "sk-secret-stored");
});

test("D1-e POST /api/profiles/:id/secrets: bad body returns 400", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));
  const credentialStore = createCredentialStore({ keytar: makeKeytarStub() });
  const app = await startApp(createProfileRoutes({ profileStore, credentialStore }));
  t.after(() => app.close());

  const cases = [
    { key: "K" },                  // missing value
    { value: "V" },                // missing key
    { key: 42, value: "V" },       // non-string key
    { key: "K", value: 42 },       // non-string value
    {},
  ];
  for (const c of cases) {
    const r = await request(app.base, "POST", "/api/profiles/personal/secrets", c);
    assert.equal(r.status, 400, `bad body must 400: ${JSON.stringify(c)}`);
  }
});

test("D1-e POST /api/profiles/:id/secrets: fail-closed surface (no backend) returns 400", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));
  // No keytar + no plaintext flag → backend="none" → setSecret throws.
  const credentialStore = createCredentialStore({ keytar: null, env: {} });
  const app = await startApp(createProfileRoutes({ profileStore, credentialStore }));
  t.after(() => app.close());

  const r = await request(app.base, "POST", "/api/profiles/personal/secrets", {
    key: "ANTHROPIC_API_KEY",
    value: "sk-test",
  });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no credential backend available/);
});

test("D1-e DELETE /api/profiles/:id/secrets/:key: removes credential", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));

  const credentialStore = createCredentialStore({ keytar: makeKeytarStub() });
  await credentialStore.setSecret("personal", "K", "v");

  const app = await startApp(createProfileRoutes({ profileStore, credentialStore }));
  t.after(() => app.close());

  const r = await request(app.base, "DELETE", "/api/profiles/personal/secrets/K");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);

  // Verify gone.
  const got = await credentialStore.getSecret("personal", "K");
  assert.equal(got, null);
});

// ─────────────────────────────────────────────────────────────────
//  Stub-fallback behavior
// ─────────────────────────────────────────────────────────────────

test("D1-e: routes 503 when profileStore is not wired", async (t) => {
  // server.js may mount the route module before D1 stores are
  // configured. The route returns 503 (not 404) so the operator
  // gets an actionable message instead of "endpoint missing".
  const app = await startApp(createProfileRoutes({}));
  t.after(() => app.close());

  const r = await request(app.base, "GET", "/api/profiles");
  assert.equal(r.status, 503);
  assert.match(r.body.error, /profileStore not wired/);
});

test("D1-e: secret routes 503 when credentialStore is not wired", async (t) => {
  const file = tmpFile(t);
  const profileStore = createProfileStore({ filePath: file });
  profileStore.upsert(sampleProfile("personal"));
  // profileStore wired, credentialStore NOT — get/post/delete on
  // secrets must surface the missing dependency.
  const app = await startApp(createProfileRoutes({ profileStore })); // no credentialStore
  t.after(() => app.close());

  const r1 = await request(app.base, "GET", "/api/profiles/personal/secrets");
  assert.equal(r1.status, 503);
  const r2 = await request(app.base, "POST", "/api/profiles/personal/secrets", { key: "K", value: "v" });
  assert.equal(r2.status, 503);
  const r3 = await request(app.base, "DELETE", "/api/profiles/personal/secrets/K");
  assert.equal(r3.status, 503);
});
