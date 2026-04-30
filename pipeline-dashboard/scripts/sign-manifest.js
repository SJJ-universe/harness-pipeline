#!/usr/bin/env node
// Slice GOV-RELEASE-0 (Phase E1.5, 2026-04-30) — manifest signing CLI.
//
// Three subcommands for the operator who's preparing a signed release:
//
//   genkey [--out <dir>]
//     Generates an Ed25519 keypair. Writes <dir>/private.pem +
//     <dir>/public.json (a single-key trust store fragment) +
//     <dir>/keypair.json (combined for archival). Prints the keyId
//     to stdout.
//
//   sign --manifest <path> --private-key <pem-path> --key-id <id>
//        [--out <path>]
//     Loads the manifest JSON, signs the canonical projection, writes
//     the manifest with `signature` field added.
//
//   verify --manifest <path> --trust-store <json-path>
//     Loads the manifest + trust store, verifies the signature.
//     Exit 0 PASS / 1 FAIL / 2 CONFIG.
//
// Why a separate CLI vs server endpoint:
//   - Signing happens on the publisher's release box, NOT the
//     orchestrator. Private keys never live on the orchestrator host.
//   - Public-sector operators sign locally + upload the signed
//     manifest to a CDN. The orchestrator never touches the private
//     key.
//   - The CLI is offline (no network). An air-gapped publisher box
//     can sign + write the manifest to removable media.

"use strict";

const fs = require("fs");
const path = require("path");
const {
  signManifest,
  verifyManifestSignature,
  generateKeyPair,
  loadTrustStore,
  SCHEMA_TRUST,
  ALG,
} = require("../src/security/manifestSigner");

function _findFlag(args, flag) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  if (idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function _printHelp() {
  process.stdout.write([
    "Usage:",
    "  node scripts/sign-manifest.js genkey [--out <dir>]",
    "  node scripts/sign-manifest.js sign --manifest <path> --private-key <pem> --key-id <id> [--out <path>]",
    "  node scripts/sign-manifest.js verify --manifest <path> --trust-store <json>",
    "",
    "Exit codes:",
    "  0   command succeeded (verify: signature PASS)",
    "  1   verify FAILED",
    "  2   config error (missing arg / file missing / parse error)",
    "",
  ].join("\n"));
}

function cmdGenkey(args) {
  const outDir = _findFlag(args, "--out") || ".";
  if (!fs.existsSync(outDir)) {
    try { fs.mkdirSync(outDir, { recursive: true }); }
    catch (err) {
      process.stderr.write(`error: cannot create out dir: ${err.message}\n`);
      return 2;
    }
  }
  const kp = generateKeyPair();
  const privPath = path.join(outDir, "private.pem");
  const trustPath = path.join(outDir, "public.json");
  const archivePath = path.join(outDir, "keypair.json");
  // Single-key trust store fragment so verifier can import directly.
  const trustFragment = {
    schema: SCHEMA_TRUST,
    keys: [{
      keyId: kp.keyId,
      label: "default",
      publicKeyDerBase64: kp.publicKeyDerBase64,
      addedAt: kp.createdAt,
    }],
  };
  try {
    fs.writeFileSync(privPath, kp.privateKeyPem, { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    process.stderr.write(`error: cannot write private.pem: ${err.message}\n`);
    return 2;
  }
  fs.writeFileSync(trustPath, JSON.stringify(trustFragment, null, 2), "utf-8");
  fs.writeFileSync(archivePath, JSON.stringify({
    schema: kp.schema,
    alg: kp.alg,
    keyId: kp.keyId,
    publicKeyDerBase64: kp.publicKeyDerBase64,
    createdAt: kp.createdAt,
    privateKeyPath: privPath,
  }, null, 2), "utf-8");
  process.stdout.write(`generated keypair\n`);
  process.stdout.write(`  alg:         ${kp.alg}\n`);
  process.stdout.write(`  keyId:       ${kp.keyId}\n`);
  process.stdout.write(`  private:     ${privPath}\n`);
  process.stdout.write(`  trust frag:  ${trustPath}\n`);
  process.stdout.write(`  archive:     ${archivePath}\n`);
  process.stdout.write(`\n`);
  process.stdout.write(`KEEP ${privPath} SECRET. Distribute ${trustPath} to recipients.\n`);
  return 0;
}

function cmdSign(args) {
  const manifestPath = _findFlag(args, "--manifest");
  const privPath = _findFlag(args, "--private-key");
  const keyId = _findFlag(args, "--key-id");
  const outPath = _findFlag(args, "--out") || manifestPath;
  if (!manifestPath || !privPath || !keyId) {
    _printHelp();
    return 2;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    process.stderr.write(`error: cannot read manifest: ${err.message}\n`);
    return 2;
  }
  let privateKeyPem;
  try {
    privateKeyPem = fs.readFileSync(privPath, "utf-8");
  } catch (err) {
    process.stderr.write(`error: cannot read private key: ${err.message}\n`);
    return 2;
  }
  let signature;
  try {
    signature = signManifest({ manifest, privateKeyPem, keyId });
  } catch (err) {
    process.stderr.write(`error: signing failed: ${err.message}\n`);
    return 2;
  }
  const signed = Object.assign({}, manifest, { signature });
  try {
    fs.writeFileSync(outPath, JSON.stringify(signed, null, 2), "utf-8");
  } catch (err) {
    process.stderr.write(`error: cannot write signed manifest: ${err.message}\n`);
    return 2;
  }
  process.stdout.write(`signed manifest\n`);
  process.stdout.write(`  alg:    ${ALG}\n`);
  process.stdout.write(`  keyId:  ${keyId}\n`);
  process.stdout.write(`  out:    ${outPath}\n`);
  return 0;
}

function cmdVerify(args) {
  const manifestPath = _findFlag(args, "--manifest");
  const trustPath = _findFlag(args, "--trust-store");
  if (!manifestPath || !trustPath) {
    _printHelp();
    return 2;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); }
  catch (err) {
    process.stderr.write(`error: cannot read manifest: ${err.message}\n`);
    return 2;
  }
  let parsedTrust;
  try { parsedTrust = JSON.parse(fs.readFileSync(trustPath, "utf-8")); }
  catch (err) {
    process.stderr.write(`error: cannot read trust store: ${err.message}\n`);
    return 2;
  }
  const tsResult = loadTrustStore(parsedTrust);
  if (!tsResult.ok) {
    process.stderr.write(`error: trust store invalid: ${tsResult.reason}${tsResult.detail ? " (" + tsResult.detail + ")" : ""}\n`);
    return 2;
  }
  const result = verifyManifestSignature({ manifest, trustStore: tsResult.trustStore });
  process.stdout.write(`manifest:    ${path.resolve(manifestPath)}\n`);
  process.stdout.write(`trust store: ${path.resolve(trustPath)}\n`);
  if (result.ok) {
    process.stdout.write(`RESULT: PASS\n`);
    process.stdout.write(`  keyId:    ${result.keyId}\n`);
    if (result.keyLabel) process.stdout.write(`  label:    ${result.keyLabel}\n`);
    process.stdout.write(`  coverage: ${result.coverage.join(", ")}\n`);
    return 0;
  }
  process.stdout.write(`RESULT: FAIL\n`);
  process.stdout.write(`  reason: ${result.reason}\n`);
  if (result.alg)     process.stdout.write(`  alg:    ${result.alg}\n`);
  if (result.keyId)   process.stdout.write(`  keyId:  ${result.keyId}\n`);
  if (result.detail)  process.stdout.write(`  detail: ${result.detail}\n`);
  return 1;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    _printHelp();
    return args.length === 0 ? 2 : 0;
  }
  const cmd = args[0];
  const rest = args.slice(1);
  if (cmd === "genkey")  return cmdGenkey(rest);
  if (cmd === "sign")    return cmdSign(rest);
  if (cmd === "verify")  return cmdVerify(rest);
  process.stderr.write(`error: unknown subcommand: ${cmd}\n`);
  _printHelp();
  return 2;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main };
