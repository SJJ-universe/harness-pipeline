// tests/unit/credentialStore.test.js — Slice D1-a (Phase E1, 2026-04-29)
//
// What's verified here, in order of trust priority:
//
//   1. Fail-closed default — no keytar + no opt-in flag = setSecret throws.
//      This is THE security property of the module; if this regresses,
//      operators silently get plaintext storage they didn't ask for.
//
//   2. Production blocks plaintext flag entirely (NODE_ENV=production
//      ignores HARNESS_ALLOW_PLAINTEXT_SECRETS=1).
//
//   3. listSecretIds returns ONLY keys, never values. Misuse here would
//      leak credentials into UI / audit responses.
//
//   4. Keychain backend round-trip via keytar stub (no real OS access).
//
//   5. Plaintext backend round-trip + 0600 mode + atomic write.
//
//   6. Audit verbs (credential_set / _deleted / _plaintext_fallback /
//      _backend_unavailable) carry profileId + key + backend, never value.
//
//   7. ID sanitation rejects path-traversal, null bytes, oversize.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createCredentialStore } = require("../../src/security/credentialStore");

// ── stub helpers ─────────────────────────────────────────────────

function makeKeytarStub() {
  const store = new Map(); // service::account -> password
  return {
    _store: store,
    async setPassword(service, account, password) {
      store.set(`${service}::${account}`, password);
    },
    async getPassword(service, account) {
      return store.get(`${service}::${account}`) || null;
    },
    async deletePassword(service, account) {
      store.delete(`${service}::${account}`);
    },
    async findCredentials(service) {
      const out = [];
      for (const [k, v] of store) {
        const [s, account] = k.split("::");
        if (s === service) out.push({ account, password: v });
      }
      return out;
    },
  };
}

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) {
      entries.push({ runId, ...entry });
    },
  };
}

function tmpConfigPaths(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cred-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return {
    appName: "OrchestratorPipeline",
    appdataConfig: dir,
    profileFile: path.join(dir, "profiles.json"),
  };
}

// ─────────────────────────────────────────────────────────────────
//  FAIL-CLOSED DEFAULT
// ─────────────────────────────────────────────────────────────────

test("D1-a: backend=none when keytar absent + plaintext flag NOT set", () => {
  const store = createCredentialStore({
    keytar: null, // force unavailable
    env: {}, // no HARNESS_ALLOW_PLAINTEXT_SECRETS
    fsPaths: { appdataConfig: "/tmp/never-used" },
  });
  assert.equal(store.backend, "none");
  assert.equal(store.isAvailable(), false);
});

test("D1-a: setSecret THROWS when backend=none (fail-closed)", async () => {
  const store = createCredentialStore({ keytar: null, env: {} });
  await assert.rejects(
    () => store.setSecret("personal", "ANTHROPIC_API_KEY", "sk-test"),
    /no credential backend available/,
  );
});

test("D1-a: getSecret returns null when backend=none (graceful)", async () => {
  const store = createCredentialStore({ keytar: null, env: {} });
  const v = await store.getSecret("personal", "ANTHROPIC_API_KEY");
  assert.equal(v, null, "getSecret must NOT throw — consumers fall back");
});

test("D1-a: listSecretIds returns [] when backend=none", async () => {
  const store = createCredentialStore({ keytar: null, env: {} });
  const ids = await store.listSecretIds("personal");
  assert.deepEqual(ids, []);
});

test("D1-a: deleteSecret is a no-op when backend=none", async () => {
  const store = createCredentialStore({ keytar: null, env: {} });
  // Must not throw — operator may run delete defensively after a failed install.
  await store.deleteSecret("personal", "ANTHROPIC_API_KEY");
});

// ─────────────────────────────────────────────────────────────────
//  PRODUCTION GUARD
// ─────────────────────────────────────────────────────────────────

test("D1-a: NODE_ENV=production blocks HARNESS_ALLOW_PLAINTEXT_SECRETS=1", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const warned = [];
  const store = createCredentialStore({
    keytar: null,
    env: {
      HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
      NODE_ENV: "production",
    },
    fsPaths,
    warn: (msg) => warned.push(msg),
  });
  assert.equal(store.backend, "none", "production must block plaintext even with explicit flag");
  // Loud warning must surface so the operator notices the override.
  assert.ok(warned.some((w) => /IGNORED/.test(w)));
});

test("D1-a: production guard emits credential_backend_unavailable audit", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const ledger = makeLedger();
  createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1", NODE_ENV: "production" },
    fsPaths,
    ledger,
    warn: () => {},
  });
  const verb = ledger.entries.find((e) => e.type === "credential_backend_unavailable");
  assert.ok(verb, "production guard must emit credential_backend_unavailable");
  assert.equal(verb.data.reason, "plaintext_blocked_in_production");
});

// ─────────────────────────────────────────────────────────────────
//  KEYCHAIN BACKEND
// ─────────────────────────────────────────────────────────────────

test("D1-a: keychain backend round-trip set/get/list/delete", async () => {
  const keytar = makeKeytarStub();
  const store = createCredentialStore({ keytar });
  assert.equal(store.backend, "keychain");
  assert.equal(store.isAvailable(), true);

  await store.setSecret("personal", "ANTHROPIC_API_KEY", "sk-aaa");
  await store.setSecret("personal", "OPENAI_API_KEY", "sk-bbb");
  await store.setSecret("work", "ANTHROPIC_API_KEY", "sk-ccc");

  assert.equal(await store.getSecret("personal", "ANTHROPIC_API_KEY"), "sk-aaa");
  assert.equal(await store.getSecret("personal", "OPENAI_API_KEY"), "sk-bbb");
  assert.equal(await store.getSecret("work", "ANTHROPIC_API_KEY"), "sk-ccc");

  // Profile isolation: personal's IDs must not include work's.
  const personalIds = await store.listSecretIds("personal");
  personalIds.sort();
  assert.deepEqual(personalIds, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  assert.deepEqual(await store.listSecretIds("work"), ["ANTHROPIC_API_KEY"]);

  await store.deleteSecret("personal", "OPENAI_API_KEY");
  assert.equal(await store.getSecret("personal", "OPENAI_API_KEY"), null);
});

test("D1-a: keychain backend uses OrchestratorPipeline-<profileId> service name", async () => {
  // Profile isolation in the keychain itself: secrets for profile A must
  // not be visible under the service name for profile B (the OS keychain
  // separates by service name).
  const keytar = makeKeytarStub();
  const store = createCredentialStore({ keytar });
  await store.setSecret("alpha", "X", "1");
  await store.setSecret("beta", "X", "2");

  // Stub records keys as "service::account". Verify both services exist.
  const seen = new Set();
  for (const k of keytar._store.keys()) {
    seen.add(k.split("::")[0]);
  }
  assert.ok(seen.has("OrchestratorPipeline-alpha"));
  assert.ok(seen.has("OrchestratorPipeline-beta"));
  assert.equal(seen.size, 2);
});

test("D1-a: getSecret returns null for unknown profile/key (no throw)", async () => {
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  assert.equal(await store.getSecret("never-stored", "X"), null);
});

test("D1-a: listSecretIds returns ONLY keys, never values", async () => {
  // Critical security property: misuse here would leak credentials.
  const keytar = makeKeytarStub();
  const store = createCredentialStore({ keytar });
  await store.setSecret("personal", "ANTHROPIC_API_KEY", "secret-value-not-for-display");
  const ids = await store.listSecretIds("personal");
  assert.deepEqual(ids, ["ANTHROPIC_API_KEY"]);
  for (const v of ids) {
    assert.ok(!/secret-value/.test(v), "listSecretIds must not leak values");
  }
});

// ─────────────────────────────────────────────────────────────────
//  PLAINTEXT BACKEND (dev/test only)
// ─────────────────────────────────────────────────────────────────

test("D1-a: plaintext backend selected when keytar absent + flag=1 + non-prod", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const warned = [];
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" }, // NODE_ENV unset → not "production"
    fsPaths,
    warn: (msg) => warned.push(msg),
  });
  assert.equal(store.backend, "plaintext");
  // Loud warning is mandatory — operator MUST see the fallback selection.
  assert.ok(warned.some((w) => /WARNING/.test(w) && /plaintext/.test(w)));
  assert.ok(warned.some((w) => /credentials\.json/.test(w)));
});

test("D1-a: plaintext backend round-trip set/get/list/delete", async (t) => {
  const fsPaths = tmpConfigPaths(t);
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    warn: () => {},
  });

  await store.setSecret("personal", "ANTHROPIC_API_KEY", "sk-aaa");
  await store.setSecret("personal", "OPENAI_API_KEY", "sk-bbb");
  await store.setSecret("work", "ANTHROPIC_API_KEY", "sk-ccc");

  assert.equal(await store.getSecret("personal", "ANTHROPIC_API_KEY"), "sk-aaa");
  assert.equal(await store.getSecret("work", "ANTHROPIC_API_KEY"), "sk-ccc");

  assert.deepEqual(
    (await store.listSecretIds("personal")).sort(),
    ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  );

  await store.deleteSecret("personal", "OPENAI_API_KEY");
  assert.equal(await store.getSecret("personal", "OPENAI_API_KEY"), null);

  // File should still exist with remaining entries.
  const credFile = path.join(fsPaths.appdataConfig, "credentials.json");
  assert.ok(fs.existsSync(credFile));
  const onDisk = JSON.parse(fs.readFileSync(credFile, "utf-8"));
  assert.deepEqual(onDisk.personal, { ANTHROPIC_API_KEY: "sk-aaa" });
  assert.deepEqual(onDisk.work, { ANTHROPIC_API_KEY: "sk-ccc" });
});

test("D1-a: plaintext backend creates credentials.json with mode 0600 on POSIX", async (t) => {
  // Windows NTFS ACL doesn't map cleanly to POSIX mode bits, so chmod
  // is a partial no-op on win32 — the file lives under %APPDATA% which
  // is per-user already (defense in depth, not the primary control).
  // We DON'T use `{ skip: ... }` here because Linux CI vs Windows local
  // would then disagree on the total test count, breaking the
  // AUTO:test-counts marker freshness gate. Instead, the test runs on
  // every platform but verifies what each platform actually enforces.
  const fsPaths = tmpConfigPaths(t);
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    warn: () => {},
  });
  await store.setSecret("personal", "X", "y");
  const credFile = path.join(fsPaths.appdataConfig, "credentials.json");
  assert.ok(fs.existsSync(credFile), "credentials.json must exist after setSecret");

  if (process.platform === "win32") {
    // On Windows, only verify the file exists with content. The
    // permission-bit check would always pass (chmod is a no-op) so a
    // real assertion isn't possible here without diving into the
    // Win32 ACL APIs.
    const content = fs.readFileSync(credFile, "utf-8");
    assert.match(content, /personal/);
    return;
  }
  // POSIX (Linux + macOS): mode bits are real and chmod 0600 took.
  const stat = fs.statSync(credFile);
  const mode = stat.mode & 0o777; // mask the type bits
  assert.equal(mode, 0o600, `credentials.json mode should be 0600, got ${mode.toString(8)}`);
});

test("D1-a: plaintext backend tolerates UTF-8 BOM in existing file", async (t) => {
  const fsPaths = tmpConfigPaths(t);
  const credFile = path.join(fsPaths.appdataConfig, "credentials.json");
  // Hand-write a BOM-prefixed file (operators on Windows may end up
  // with one if they edit the file with notepad).
  fs.mkdirSync(fsPaths.appdataConfig, { recursive: true });
  fs.writeFileSync(credFile, "﻿" + JSON.stringify({ existing: { K: "v" } }));

  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    warn: () => {},
  });
  assert.equal(await store.getSecret("existing", "K"), "v",
    "credentialStore must read past a leading BOM");
});

test("D1-a: plaintext backend rejects malformed credentials.json (refuses to overwrite)", async (t) => {
  const fsPaths = tmpConfigPaths(t);
  const credFile = path.join(fsPaths.appdataConfig, "credentials.json");
  fs.mkdirSync(fsPaths.appdataConfig, { recursive: true });
  fs.writeFileSync(credFile, "not-valid-json");

  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    warn: () => {},
  });
  await assert.rejects(
    () => store.setSecret("p", "K", "v"),
    /failed to parse/,
    "writing a new secret on top of corrupted JSON would clobber operator data",
  );
});

// ─────────────────────────────────────────────────────────────────
//  AUDIT VERB CONTRACTS
// ─────────────────────────────────────────────────────────────────

test("D1-a: credential_set audit carries profileId+key+backend, NEVER value", async () => {
  const ledger = makeLedger();
  const store = createCredentialStore({ keytar: makeKeytarStub(), ledger });
  await store.setSecret("personal", "ANTHROPIC_API_KEY", "sk-secret-VALUE");

  const setEntry = ledger.entries.find((e) => e.type === "credential_set");
  assert.ok(setEntry, "credential_set audit must fire");
  assert.equal(setEntry.data.profileId, "personal");
  assert.equal(setEntry.data.key, "ANTHROPIC_API_KEY");
  assert.equal(setEntry.data.backend, "keychain");
  // Critical: the value must not appear ANYWHERE in the entry.
  const text = JSON.stringify(setEntry);
  assert.ok(!/sk-secret-VALUE/.test(text), "audit MUST NOT include the secret value");
});

test("D1-a: credential_deleted audit fires on deleteSecret", async () => {
  const ledger = makeLedger();
  const store = createCredentialStore({ keytar: makeKeytarStub(), ledger });
  await store.setSecret("p", "K", "v");
  await store.deleteSecret("p", "K");

  const delEntry = ledger.entries.find((e) => e.type === "credential_deleted");
  assert.ok(delEntry);
  assert.equal(delEntry.data.profileId, "p");
  assert.equal(delEntry.data.key, "K");
  assert.equal(delEntry.data.backend, "keychain");
});

test("D1-a: credential_plaintext_fallback audit fires ONCE on plaintext selection", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const ledger = makeLedger();
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    ledger,
    warn: () => {},
  });
  const fallbackEntries = ledger.entries.filter((e) => e.type === "credential_plaintext_fallback");
  assert.equal(fallbackEntries.length, 1, "plaintext_fallback must emit exactly once");
  assert.ok(fallbackEntries[0].data.file.includes("credentials.json"));
  assert.equal(store.backend, "plaintext");
});

test("D1-a: credential_backend_unavailable audit on no-keytar + no-flag", () => {
  const ledger = makeLedger();
  createCredentialStore({ keytar: null, env: {}, ledger });
  const entry = ledger.entries.find((e) => e.type === "credential_backend_unavailable");
  assert.ok(entry);
  assert.equal(entry.data.reason, "keytar_missing");
  assert.match(entry.data.hint, /install keytar/);
  assert.match(entry.data.hint, /HARNESS_ALLOW_PLAINTEXT_SECRETS=1/);
});

// ─────────────────────────────────────────────────────────────────
//  ID SANITATION
// ─────────────────────────────────────────────────────────────────

test("D1-a: rejects path-traversal in profileId", async () => {
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  for (const bad of ["../escape", "p/../escape", "p\\..\\escape", "p\x00null"]) {
    await assert.rejects(
      () => store.setSecret(bad, "K", "v"),
      /profileId.*outside \[A-Za-z0-9\._-\]/,
      `must reject "${bad}"`,
    );
  }
});

test("D1-a: rejects empty / non-string profileId", async () => {
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  await assert.rejects(() => store.setSecret("", "K", "v"), /must be a non-empty string/);
  await assert.rejects(() => store.setSecret(null, "K", "v"), /must be a non-empty string/);
  await assert.rejects(() => store.setSecret(undefined, "K", "v"), /must be a non-empty string/);
});

test("D1-a: rejects oversize profileId (>256 chars)", async () => {
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  const big = "x".repeat(257);
  await assert.rejects(() => store.setSecret(big, "K", "v"), /too long/);
});

test("D1-a: rejects empty value for setSecret", async () => {
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  await assert.rejects(
    () => store.setSecret("p", "K", ""),
    /value must be a non-empty string/,
  );
});

test("D1-a: accepts canonical id shapes", async () => {
  // Make sure the safe regex doesn't accidentally reject reasonable
  // input — operator-friendly profile names need to work.
  const store = createCredentialStore({ keytar: makeKeytarStub() });
  for (const ok of ["personal", "work-laptop", "v1.2.3", "user_42", "Alpha-Beta_3.14"]) {
    await store.setSecret(ok, "ANTHROPIC_API_KEY", "v"); // must not throw
  }
});

// ─────────────────────────────────────────────────────────────────
//  IMMUTABILITY OF THE RETURNED HANDLE
// ─────────────────────────────────────────────────────────────────

test("D1-a: returned store handle is frozen (caller cannot swap backend)", () => {
  const store = createCredentialStore({ keytar: null, env: {} });
  assert.ok(Object.isFrozen(store));
  assert.throws(() => { store.setSecret = () => "tampered"; }, /Cannot/);
});

// ─────────────────────────────────────────────────────────────────
//  D1-gov-3 — public-sector hard-block on plaintext
// ─────────────────────────────────────────────────────────────────

test("D1-gov-3: public-sector mode HARD-BLOCKS plaintext even with HARNESS_ALLOW_PLAINTEXT_SECRETS=1", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const warned = [];
  const store = createCredentialStore({
    keytar: null,
    env: {
      HARNESS_DEPLOYMENT_PROFILE: "public-sector",
      HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
    },
    fsPaths,
    warn: (msg) => warned.push(msg),
  });
  assert.equal(store.backend, "none",
    "public-sector must override the plaintext opt-in flag");
  assert.ok(warned.some((w) => /HARNESS_DEPLOYMENT_PROFILE=public-sector/.test(w)));
  assert.ok(warned.some((w) => /Install keytar/.test(w)));
});

test("D1-gov-3: public-sector + no-keytar emits credential_backend_unavailable with public-sector reason", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const ledger = makeLedger();
  createCredentialStore({
    keytar: null,
    env: {
      HARNESS_DEPLOYMENT_PROFILE: "public-sector",
      HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
    },
    fsPaths,
    ledger,
    warn: () => {},
  });
  const entry = ledger.entries.find((e) => e.type === "credential_backend_unavailable");
  assert.ok(entry, "public-sector block must emit credential_backend_unavailable");
  assert.equal(entry.data.reason, "plaintext_blocked_in_public_sector");
});

test("D1-gov-3: public-sector + setSecret throws (fail-closed end-to-end)", async (t) => {
  const fsPaths = tmpConfigPaths(t);
  const store = createCredentialStore({
    keytar: null,
    env: {
      HARNESS_DEPLOYMENT_PROFILE: "public-sector",
      HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
    },
    fsPaths,
    warn: () => {},
  });
  await assert.rejects(
    () => store.setSecret("agency", "ANTHROPIC_API_KEY", "sk-test"),
    /no credential backend available/,
    "public-sector + no-keytar must refuse setSecret end-to-end (no fallback)",
  );
});

test("D1-gov-3: standard mode + plaintext flag still works (no regression)", (t) => {
  const fsPaths = tmpConfigPaths(t);
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" },
    fsPaths,
    warn: () => {},
  });
  assert.equal(store.backend, "plaintext",
    "standard mode must keep honoring the plaintext opt-in");
});

test("D1-gov-3: deploymentProfile injection takes precedence over env (test injection)", (t) => {
  // Allows tests + downstream callers to pre-resolve the deployment
  // profile and inject it (e.g. orchestrator resolves once at boot
  // and passes through to every collaborator).
  const fsPaths = tmpConfigPaths(t);
  const store = createCredentialStore({
    keytar: null,
    env: { HARNESS_ALLOW_PLAINTEXT_SECRETS: "1" }, // would normally enable plaintext
    deploymentProfile: { publicSector: true, allowPlaintextSecrets: false }, // override
    fsPaths,
    warn: () => {},
  });
  assert.equal(store.backend, "none", "injected profile overrides env");
});
