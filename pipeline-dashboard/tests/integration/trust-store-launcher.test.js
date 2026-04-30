// Slice TRUST-STORE-0-g (Phase E Round 2, 2026-04-30) — launcher↔store
// integration. Closes the loop: operator adds a public key via the
// server-side trustStore runtime → file appears at the resolved path
// → launcher-cli `verify-manifest-signature` finds it → manifest
// signed by that key verifies. Then operator removes the key →
// launcher rejects the same manifest with `unknown_key_id`.
//
// This is the round-trip the launcher and the UI MUST share. If
// the resolvers drift the test fails before any operator-facing
// regression ships.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LAUNCHER_CLI = path.join(REPO_ROOT, "scripts", "launcher", "launcher-cli.js");
const SIGN_CLI = path.join(REPO_ROOT, "scripts", "sign-manifest.js");

const { createTrustStore } = require("../../src/runtime/trustStore");
const trustStorePath = require("../../src/runtime/trustStorePath");
const launcherTrustStorePath = require("../../scripts/launcher/trust-store-path");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trust-launcher-test-"));
}

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [LAUNCHER_CLI, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
}

function runSign(args) {
  return spawnSync(process.execPath, [SIGN_CLI, ...args], { encoding: "utf-8" });
}

// ── Resolver-parity: launcher and server-side resolve same path ────

test("TRUST-STORE-0 integration: server + launcher resolvers are the SAME module", () => {
  // The src/ wrapper re-exports the launcher module. If a future PR
  // forks the implementations, this assertion fails fast — operators
  // never see the silent drift symptom (UI writes to path X, launcher
  // reads from path Y).
  assert.strictEqual(
    trustStorePath.resolveTrustStorePath,
    launcherTrustStorePath.resolveTrustStorePath,
  );
});

test("TRUST-STORE-0 integration: same env produces same resolved path on both sides", () => {
  const env = { HARNESS_TRUST_STORE: "/explicit/path/from/env.json" };
  const fromServer = trustStorePath.resolveTrustStorePath({ env });
  const fromLauncher = launcherTrustStorePath.resolveTrustStorePath({ env });
  assert.equal(fromServer.path, fromLauncher.path);
  assert.equal(fromServer.source, fromLauncher.source);
});

// ── Round-trip: add via store → launcher verifies → remove → launcher rejects ──

test("TRUST-STORE-0 integration: add → sign → launcher verifies + remove → launcher rejects", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const trustFile = path.join(dir, "trust-store.json");

  // 1. Generate a keypair via sign-manifest.js (the same CLI an
  //    operator would use to mint a release key).
  const g = runSign(["genkey", "--out", dir]);
  assert.equal(g.status, 0, `genkey stderr: ${g.stderr}`);
  const archive = JSON.parse(fs.readFileSync(path.join(dir, "keypair.json"), "utf-8"));
  const keyId = archive.keyId;

  // 2. Add the public key via the server-side trustStore runtime
  //    (NOT a copy of the public.json file the CLI emits — we want
  //    to prove the runtime's serialization matches what the
  //    launcher reads). We use the canonical publicKeyDerBase64 from
  //    the keypair archive.
  const trustStore = createTrustStore({ filePath: trustFile });
  trustStore.add({
    publicKeyDerBase64: archive.publicKeyDerBase64,
    label: "Round-trip test key",
  });

  // File now exists at the path the launcher will be told to use.
  assert.ok(fs.existsSync(trustFile));

  // 3. Sign a manifest with the matching private key.
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: "1.2.3",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example.com/release.zip",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    minNodeVersion: "24.0.0",
  }, null, 2));
  const s = runSign([
    "sign",
    "--manifest", manifestPath,
    "--private-key", path.join(dir, "private.pem"),
    "--key-id", keyId,
  ]);
  assert.equal(s.status, 0, `sign stderr: ${s.stderr}`);

  // 4. Launcher verifies — using the trust file the runtime wrote.
  const v = runCli([
    "verify-manifest-signature", manifestPath, "--trust-store", trustFile,
  ]);
  assert.equal(v.status, 0, `verify stderr: ${v.stderr}\nstdout: ${v.stdout}`);
  const verifyResult = JSON.parse(v.stdout);
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.keyId, keyId);
  assert.equal(verifyResult.keyLabel, "Round-trip test key");

  // 5. Operator removes the key via the runtime.
  const removed = trustStore.remove(keyId);
  assert.equal(removed, true);

  // 6. Launcher now rejects the SAME manifest. Either reason is
  //    correct: with the removed key as the only entry the trust
  //    store goes empty → `no_trusted_keys`. install-version maps
  //    BOTH codes to exit 37 (they're both "this key isn't trusted
  //    anymore" verdicts) — what matters here is the launcher
  //    refuses, not the exact code.
  const v2 = runCli([
    "verify-manifest-signature", manifestPath, "--trust-store", trustFile,
  ]);
  assert.equal(v2.status, 1);
  const verifyResult2 = JSON.parse(v2.stdout);
  assert.equal(verifyResult2.ok, false);
  assert.match(verifyResult2.reason, /^(unknown_key_id|no_trusted_keys)$/);
});

test("TRUST-STORE-0 integration: removing one key when other keys remain → unknown_key_id", (t) => {
  // Belt-and-braces: when the trust store has OTHER keys after the
  // operator removes the signing key, the failure code must be
  // unknown_key_id specifically (install-version maps to exit 38).
  // This pins the install-version exit-code matrix.
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const trustFile = path.join(dir, "trust-store.json");

  // Generate two keypairs into separate dirs so neither overwrites
  // the other's private.pem / public.json.
  const dirA = path.join(dir, "keys-a"); fs.mkdirSync(dirA);
  const dirB = path.join(dir, "keys-b"); fs.mkdirSync(dirB);
  runSign(["genkey", "--out", dirA]);
  runSign(["genkey", "--out", dirB]);
  const archiveA = JSON.parse(fs.readFileSync(path.join(dirA, "keypair.json"), "utf-8"));
  const archiveB = JSON.parse(fs.readFileSync(path.join(dirB, "keypair.json"), "utf-8"));

  const trustStore = createTrustStore({ filePath: trustFile });
  trustStore.add({ publicKeyDerBase64: archiveA.publicKeyDerBase64, label: "A" });
  trustStore.add({ publicKeyDerBase64: archiveB.publicKeyDerBase64, label: "B" });

  // Sign with A, then remove A from the store. B is still trusted
  // but the manifest's keyId is A → unknown_key_id specifically.
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: "1.0.0",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example.com/r.zip",
    sha256: "f".repeat(64),
    minNodeVersion: "24.0.0",
  }));
  runSign([
    "sign", "--manifest", manifestPath,
    "--private-key", path.join(dirA, "private.pem"),
    "--key-id", archiveA.keyId,
  ]);

  trustStore.remove(archiveA.keyId);

  const v = runCli(["verify-manifest-signature", manifestPath, "--trust-store", trustFile]);
  assert.equal(v.status, 1);
  const result = JSON.parse(v.stdout);
  assert.equal(result.reason, "unknown_key_id",
    "with B still trusted, removing A must yield unknown_key_id (NOT no_trusted_keys)",
  );
});

// ── Resolver-honoring: HARNESS_TRUST_STORE env path round-trip ─────

test("TRUST-STORE-0 integration: launcher honors HARNESS_TRUST_STORE env when runtime wrote there", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const customPath = path.join(dir, "custom-trust.json");

  // 1. Generate keypair + add public key via runtime to the CUSTOM
  //    path (not OS default).
  const g = runSign(["genkey", "--out", dir]);
  assert.equal(g.status, 0);
  const archive = JSON.parse(fs.readFileSync(path.join(dir, "keypair.json"), "utf-8"));
  createTrustStore({ filePath: customPath }).add({
    publicKeyDerBase64: archive.publicKeyDerBase64,
    label: "Env-path test",
  });

  // 2. Sign a manifest.
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: "1.0.0",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example.com/r.zip",
    sha256: "f".repeat(64),
    minNodeVersion: "24.0.0",
  }));
  const s = runSign([
    "sign",
    "--manifest", manifestPath,
    "--private-key", path.join(dir, "private.pem"),
    "--key-id", archive.keyId,
  ]);
  assert.equal(s.status, 0);

  // 3. Launcher verifies — pointed at the custom path via env (no
  //    --trust-store flag). The shared resolver finds it.
  const v = runCli(
    ["verify-manifest-signature", manifestPath],
    { HARNESS_TRUST_STORE: customPath },
  );
  assert.equal(v.status, 0, `stderr: ${v.stderr}`);
  const verifyResult = JSON.parse(v.stdout);
  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.trustStorePath, customPath);
  assert.equal(verifyResult.trustStoreSource, "env-trust-store");
});

test("TRUST-STORE-0 integration: launcher 2 reports trust_store_source for forensic audit", (t) => {
  // Confirm the resolver source label survives end-to-end. install-
  // version emits the source in audit lines so a forensic auditor
  // can grep "where did the launcher load the trust file from?".
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ts.json");

  const g = runSign(["genkey", "--out", dir]);
  assert.equal(g.status, 0);
  const archive = JSON.parse(fs.readFileSync(path.join(dir, "keypair.json"), "utf-8"));
  createTrustStore({ filePath: file }).add({ publicKeyDerBase64: archive.publicKeyDerBase64 });

  const manifestPath = path.join(dir, "m.json");
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: "1.0.0",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example.com/r.zip",
    sha256: "f".repeat(64),
    minNodeVersion: "24.0.0",
  }));
  runSign(["sign", "--manifest", manifestPath, "--private-key", path.join(dir, "private.pem"), "--key-id", archive.keyId]);

  // CLI flag → source = "cli-flag"
  const v1 = runCli(["verify-manifest-signature", manifestPath, "--trust-store", file]);
  assert.equal(JSON.parse(v1.stdout).trustStoreSource, "cli-flag");

  // Env override → source = "env-trust-store"
  const v2 = runCli(["verify-manifest-signature", manifestPath], { HARNESS_TRUST_STORE: file });
  assert.equal(JSON.parse(v2.stdout).trustStoreSource, "env-trust-store");
});
