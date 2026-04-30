// Slice GOV-RELEASE-0 (Phase E1.5, 2026-04-30) — sign-manifest CLI smoke.
// Drives genkey + sign + verify end-to-end through subprocess spawn.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const SCRIPT = path.join(__dirname, "..", "..", "scripts", "sign-manifest.js");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sign-manifest-smoke-"));
}

test("GOV-RELEASE-0 smoke: --help exits 0 + prints usage", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf-8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
  assert.match(r.stdout, /genkey/);
  assert.match(r.stdout, /sign --manifest/);
  assert.match(r.stdout, /verify --manifest/);
});

test("GOV-RELEASE-0 smoke: no args → usage + exit 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf-8" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /Usage:/);
});

test("GOV-RELEASE-0 smoke: unknown subcommand exits 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "foo"], { encoding: "utf-8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown subcommand/);
});

test("GOV-RELEASE-0 smoke: genkey + sign + verify round-trip", () => {
  const dir = tmpDir();
  try {
    // genkey
    const g = spawnSync(process.execPath, [SCRIPT, "genkey", "--out", dir], { encoding: "utf-8" });
    assert.equal(g.status, 0, `genkey stderr: ${g.stderr}`);
    assert.match(g.stdout, /generated keypair/);
    assert.match(g.stdout, /keyId:\s+[0-9a-f]{16}/);
    // Files created
    const privPath = path.join(dir, "private.pem");
    const trustPath = path.join(dir, "public.json");
    const archivePath = path.join(dir, "keypair.json");
    assert.ok(fs.existsSync(privPath), "private.pem written");
    assert.ok(fs.existsSync(trustPath), "public.json written");
    assert.ok(fs.existsSync(archivePath), "keypair.json written");
    // Extract keyId from archive
    const archive = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
    const keyId = archive.keyId;
    assert.match(keyId, /^[0-9a-f]{16}$/);
    // Write a manifest
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: "1.2.0",
      publishedAt: "2026-04-30T00:00:00Z",
      url: "https://example.com/h.zip",
      sha256: "deadbeef",
      minNodeVersion: "24.0.0",
    }, null, 2), "utf-8");
    // sign
    const s = spawnSync(process.execPath, [
      SCRIPT, "sign",
      "--manifest", manifestPath,
      "--private-key", privPath,
      "--key-id", keyId,
    ], { encoding: "utf-8" });
    assert.equal(s.status, 0, `sign stderr: ${s.stderr}`);
    assert.match(s.stdout, /signed manifest/);
    // Manifest now has signature field
    const signedManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    assert.ok(signedManifest.signature);
    assert.equal(signedManifest.signature.alg, "Ed25519");
    assert.equal(signedManifest.signature.keyId, keyId);
    // verify
    const v = spawnSync(process.execPath, [
      SCRIPT, "verify",
      "--manifest", manifestPath,
      "--trust-store", trustPath,
    ], { encoding: "utf-8" });
    assert.equal(v.status, 0, `verify stderr: ${v.stderr}`);
    assert.match(v.stdout, /RESULT: PASS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-RELEASE-0 smoke: tampered manifest → verify exits 1, FAIL", () => {
  const dir = tmpDir();
  try {
    spawnSync(process.execPath, [SCRIPT, "genkey", "--out", dir], { encoding: "utf-8" });
    const privPath = path.join(dir, "private.pem");
    const trustPath = path.join(dir, "public.json");
    const archive = JSON.parse(fs.readFileSync(path.join(dir, "keypair.json"), "utf-8"));
    const manifestPath = path.join(dir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: "1.0", publishedAt: "T", url: "https://good", sha256: "x", minNodeVersion: "24.0.0",
    }), "utf-8");
    spawnSync(process.execPath, [
      SCRIPT, "sign",
      "--manifest", manifestPath,
      "--private-key", privPath,
      "--key-id", archive.keyId,
    ], { encoding: "utf-8" });
    // Tamper after signing
    const tampered = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    tampered.url = "https://evil.example.com";
    fs.writeFileSync(manifestPath, JSON.stringify(tampered), "utf-8");
    const v = spawnSync(process.execPath, [
      SCRIPT, "verify",
      "--manifest", manifestPath,
      "--trust-store", trustPath,
    ], { encoding: "utf-8" });
    assert.equal(v.status, 1);
    assert.match(v.stdout, /RESULT: FAIL/);
    assert.match(v.stdout, /signature_mismatch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("GOV-RELEASE-0 smoke: verify with wrong trust store → unknown_key_id", () => {
  const dirA = tmpDir();
  const dirB = tmpDir();
  try {
    // Generate two distinct keypairs
    spawnSync(process.execPath, [SCRIPT, "genkey", "--out", dirA], { encoding: "utf-8" });
    spawnSync(process.execPath, [SCRIPT, "genkey", "--out", dirB], { encoding: "utf-8" });
    const archiveA = JSON.parse(fs.readFileSync(path.join(dirA, "keypair.json"), "utf-8"));
    const manifestPath = path.join(dirA, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      version: "1.0", publishedAt: "T", url: "u", sha256: "h", minNodeVersion: "24.0.0",
    }), "utf-8");
    spawnSync(process.execPath, [
      SCRIPT, "sign",
      "--manifest", manifestPath,
      "--private-key", path.join(dirA, "private.pem"),
      "--key-id", archiveA.keyId,
    ], { encoding: "utf-8" });
    // Verify with dirB's trust store (different keyId)
    const v = spawnSync(process.execPath, [
      SCRIPT, "verify",
      "--manifest", manifestPath,
      "--trust-store", path.join(dirB, "public.json"),
    ], { encoding: "utf-8" });
    assert.equal(v.status, 1);
    assert.match(v.stdout, /unknown_key_id/);
  } finally {
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

test("GOV-RELEASE-0 smoke: sign without args returns 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "sign"], { encoding: "utf-8" });
  assert.equal(r.status, 2);
});

test("GOV-RELEASE-0 smoke: verify without args returns 2", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "verify"], { encoding: "utf-8" });
  assert.equal(r.status, 2);
});

test("GOV-RELEASE-0 smoke: sign with missing manifest file returns 2", () => {
  const dir = tmpDir();
  try {
    spawnSync(process.execPath, [SCRIPT, "genkey", "--out", dir], { encoding: "utf-8" });
    const archive = JSON.parse(fs.readFileSync(path.join(dir, "keypair.json"), "utf-8"));
    const r = spawnSync(process.execPath, [
      SCRIPT, "sign",
      "--manifest", "/path/does/not/exist.json",
      "--private-key", path.join(dir, "private.pem"),
      "--key-id", archive.keyId,
    ], { encoding: "utf-8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /cannot read manifest/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
