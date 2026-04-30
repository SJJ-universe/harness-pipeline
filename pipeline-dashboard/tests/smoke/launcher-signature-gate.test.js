// Slice E3-F1-e (Phase E, 2026-04-30) — launcher signature gate smoke.
//
// Three layers of coverage:
//
//   1. resolve-trust-store-path CLI bridge — exercises the JS resolver
//      through the spawnSync boundary the launcher scripts will use.
//
//   2. verify-manifest-signature scenarios — every branch the install-
//      version.{ps1,sh} matrix dispatches on (signed PASS, unsigned,
//      unknown_key_id, signature_mismatch, trust-store missing).
//
//   3. install-version + harness-start lint — the script content
//      contains the audit verbs and exit-code wiring. We can't run
//      PowerShell on Linux CI or bash on Windows CI, so the script
//      bodies are pinned via grep tests instead. The actual interactive
//      runs live in tests/e2e/* (manual verification only).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(REPO_ROOT, "scripts", "launcher", "launcher-cli.js");
const SIGN_CLI = path.join(REPO_ROOT, "scripts", "sign-manifest.js");

function runCli(args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: "utf-8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "launcher-sig-test-"));
}

// Build the "everything you need to verify" fixture: keypair + trust store
// + signed manifest in a fresh tmp dir. Reused across most tests so the
// matrix branches each consume their own dir.
function buildFixture(tmp, manifestOverrides = {}) {
  // Use sign-manifest CLI (same path operators use) so we exercise the
  // public surface, not internal helpers. Generate keypair → write trust
  // file → write manifest → sign in-place.
  const g = spawnSync(process.execPath, [SIGN_CLI, "genkey", "--out", tmp], { encoding: "utf-8" });
  assert.equal(g.status, 0, `genkey stderr: ${g.stderr}`);
  const archive = JSON.parse(fs.readFileSync(path.join(tmp, "keypair.json"), "utf-8"));
  const manifestPath = path.join(tmp, "manifest.json");
  const baseManifest = {
    version: "1.2.3",
    publishedAt: "2026-04-30T00:00:00Z",
    url: "https://example.com/release.zip",
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    minNodeVersion: "24.0.0",
  };
  const manifest = { ...baseManifest, ...manifestOverrides };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // Sign in-place. After this, the manifest file has a signature field.
  const s = spawnSync(process.execPath, [
    SIGN_CLI, "sign",
    "--manifest", manifestPath,
    "--private-key", path.join(tmp, "private.pem"),
    "--key-id", archive.keyId,
  ], { encoding: "utf-8" });
  assert.equal(s.status, 0, `sign stderr: ${s.stderr}`);
  return {
    tmp,
    keyId: archive.keyId,
    privatePath: path.join(tmp, "private.pem"),
    trustPath: path.join(tmp, "public.json"),
    manifestPath,
  };
}

// ───── 1) resolve-trust-store-path CLI bridge ─────────────────────────

test("E3-F1 smoke: resolve-trust-store-path returns env-trust-store source", () => {
  const dir = tmpDir();
  try {
    const target = path.join(dir, "tstore.json");
    const r = runCli(["resolve-trust-store-path"], {
      env: { HARNESS_TRUST_STORE: target },
    });
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.path, target);
    assert.equal(out.source, "env-trust-store");
    assert.equal(out.exists, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("E3-F1 smoke: resolve-trust-store-path honors --trust-store flag", () => {
  const r = runCli(["resolve-trust-store-path", "--trust-store", "/explicit/cli/path.json"]);
  assert.equal(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.path, "/explicit/cli/path.json");
  assert.equal(out.source, "cli-flag");
});

test("E3-F1 smoke: resolve-trust-store-path appends FILENAME for HARNESS_CONFIG_DIR", () => {
  const dir = tmpDir();
  try {
    const r = runCli(["resolve-trust-store-path"], {
      env: { HARNESS_CONFIG_DIR: dir },
    });
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.path, path.join(dir, "trust-store.json"));
    assert.equal(out.source, "env-config-dir");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───── 2) verify-manifest-signature scenarios ─────────────────────────

test("E3-F1 smoke: verify-manifest-signature PASS on signed + valid trust store", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fx = buildFixture(dir);
  const r = runCli([
    "verify-manifest-signature", fx.manifestPath, "--trust-store", fx.trustPath,
  ]);
  assert.equal(r.code, 0, `expected exit 0; stdout=${r.stdout} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.keyId, fx.keyId);
  assert.equal(out.trustStorePath, fx.trustPath);
  assert.equal(out.trustStoreSource, "cli-flag");
});

test("E3-F1 smoke: verify-manifest-signature FAIL on unknown_key_id (different trust store)", (t) => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  t.after(() => fs.rmSync(dirA, { recursive: true, force: true }));
  t.after(() => fs.rmSync(dirB, { recursive: true, force: true }));
  const fxA = buildFixture(dirA);
  // dirB has its own keypair → its trust store doesn't recognize fxA's keyId.
  buildFixture(dirB);
  const r = runCli([
    "verify-manifest-signature", fxA.manifestPath, "--trust-store", path.join(dirB, "public.json"),
  ]);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "unknown_key_id");
  // install-version maps "unknown_key_id" to exit 38 specifically.
  // Other reasons map to 37. The matrix depends on this reason vocabulary.
});

test("E3-F1 smoke: verify-manifest-signature FAIL on tampered manifest (signature_mismatch)", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fx = buildFixture(dir);
  // Tamper the manifest after signing — flip the URL.
  const tampered = JSON.parse(fs.readFileSync(fx.manifestPath, "utf-8"));
  tampered.url = "https://attacker.example.com/evil.zip";
  fs.writeFileSync(fx.manifestPath, JSON.stringify(tampered, null, 2));
  const r = runCli([
    "verify-manifest-signature", fx.manifestPath, "--trust-store", fx.trustPath,
  ]);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "signature_mismatch");
});

test("E3-F1 smoke: verify-manifest-signature FAIL on unsigned manifest (missing_signature)", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fx = buildFixture(dir);
  // Strip the signature from the manifest after building.
  const manifest = JSON.parse(fs.readFileSync(fx.manifestPath, "utf-8"));
  delete manifest.signature;
  fs.writeFileSync(fx.manifestPath, JSON.stringify(manifest, null, 2));
  const r = runCli([
    "verify-manifest-signature", fx.manifestPath, "--trust-store", fx.trustPath,
  ]);
  assert.equal(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.reason, "missing_signature");
});

test("E3-F1 smoke: verify-manifest-signature exits 2 when trust store path doesn't exist", (t) => {
  const dir = tmpDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fx = buildFixture(dir);
  // Point at a non-existent file via flag → exit 2 (configuration error,
  // not a signature failure). install-version.{ps1,sh} maps this to its
  // own exit 37 with reason=trust_store_unavailable.
  const r = runCli([
    "verify-manifest-signature", fx.manifestPath, "--trust-store", path.join(dir, "does-not-exist.json"),
  ]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /trust store not found/i);
});

test("E3-F1 smoke: verify-manifest-signature requires manifest path arg", () => {
  const r = runCli(["verify-manifest-signature"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /missing/);
});

// ───── 3) install-version + harness-start script integrity (lint) ─────

test("E3-F1 smoke: install-version.ps1 contains signature gate matrix wiring", () => {
  const ps = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "launcher", "install-version.ps1"), "utf-8",
  );
  // Every key matrix branch must be visible in the script body.
  const required = [
    "HARNESS_DEPLOYMENT_PROFILE",                      // posture detection
    "HARNESS_ALLOW_UNSIGNED_MANIFEST",                 // dev escape env
    "effectiveAllowUnsigned",                          // public-sector ignores escape
    "launcher_signature_verified",                     // PASS audit verb
    "launcher_signature_failed",                       // FAIL audit verb
    "launcher_signature_bypass",                       // BYPASS audit verb
    "exit 37",                                         // default fail-closed code
    "exit 38",                                         // unknown_key_id specific code
    "verify-manifest-signature",                       // CLI invocation
    "resolve-trust-store-path",                        // resolver invocation
  ];
  for (const tok of required) {
    assert.ok(ps.includes(tok), `install-version.ps1 must contain "${tok}"`);
  }
});

test("E3-F1 smoke: install-version.sh contains signature gate matrix wiring", () => {
  const sh = fs.readFileSync(
    path.join(REPO_ROOT, "scripts", "launcher", "install-version.sh"), "utf-8",
  );
  const required = [
    "HARNESS_DEPLOYMENT_PROFILE",
    "HARNESS_ALLOW_UNSIGNED_MANIFEST",
    "EFFECTIVE_ALLOW_UNSIGNED",
    "launcher_signature_verified",
    "launcher_signature_failed",
    "launcher_signature_bypass",
    "exit 37",
    "exit 38",
    "verify-manifest-signature",
    "resolve-trust-store-path",
  ];
  for (const tok of required) {
    assert.ok(sh.includes(tok), `install-version.sh must contain "${tok}"`);
  }
});

test("E3-F1 smoke: harness-start.bat surfaces signature posture pre-flight", () => {
  const bat = fs.readFileSync(path.join(REPO_ROOT, "harness-start.bat"), "utf-8");
  const required = [
    "HARNESS_DEPLOYMENT_PROFILE",                      // env documented in header
    "HARNESS_ALLOW_UNSIGNED_MANIFEST",                 // env documented
    "HARNESS_TRUST_STORE",                             // env documented
    "signature gate posture",                          // pre-flight echo
    "resolve-trust-store-path",                        // pre-flight call
  ];
  for (const tok of required) {
    assert.ok(bat.includes(tok), `harness-start.bat must contain "${tok}"`);
  }
});

test("E3-F1 smoke: harness-start.sh surfaces signature posture pre-flight", () => {
  const sh = fs.readFileSync(path.join(REPO_ROOT, "harness-start.sh"), "utf-8");
  const required = [
    "HARNESS_DEPLOYMENT_PROFILE",
    "HARNESS_ALLOW_UNSIGNED_MANIFEST",
    "HARNESS_TRUST_STORE",
    "signature gate posture",
    "resolve-trust-store-path",
  ];
  for (const tok of required) {
    assert.ok(sh.includes(tok), `harness-start.sh must contain "${tok}"`);
  }
});

test("E3-F1 smoke: launcher-cli --help advertises new commands", () => {
  const r = runCli(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /verify-manifest-signature/, "help mentions verify-manifest-signature");
  assert.match(r.stdout, /resolve-trust-store-path/, "help mentions resolve-trust-store-path");
});
