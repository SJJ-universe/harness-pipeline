#!/usr/bin/env node
// Slice GOV-AUDIT-0 (Phase E1.5, 2026-04-30) — auditor bundle verifier.
//
// Usage:
//   node scripts/verify-auditor-bundle.js <bundle.json>
//   node scripts/verify-auditor-bundle.js <bundle.json> --key <hex>
//   HARNESS_AUDIT_KEY=<hex> node scripts/verify-auditor-bundle.js <bundle.json>
//
// Exit codes:
//   0  bundle PASSES (chain valid, hashes match, seal verifies if sealKey provided)
//   1  bundle FAILS verification
//   2  config error (file missing, malformed JSON, etc.)
//
// What this verifier checks (offline, no network):
//   1. Schema is "harness-auditor-bundle/v1"
//   2. entriesHash recomputes to the published value
//   3. chainHash recomputes to the published value
//   4. Internal chain validity (bundle.chain.valid !== false)
//   5. (sealed bundles only) HMAC seal recomputes when --key / env is set
//
// External auditor pattern:
//   1. Operator emits bundle via POST /api/audit/runs/:runId/export
//   2. Operator hands bundle.json + (optionally) HMAC key to auditor
//   3. Auditor runs this script — exit 0 means tamper-free
//   4. Auditor inspects bundle.entries[] / bundle.chain manually

"use strict";

const fs = require("fs");
const path = require("path");
const { verifyBundle } = require("../src/runtime/auditorBundle");

function _readKey(args) {
  const idx = args.indexOf("--key");
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  if (process.env.HARNESS_AUDIT_KEY) return process.env.HARNESS_AUDIT_KEY;
  return null;
}

function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write([
      "Usage: node scripts/verify-auditor-bundle.js <bundle.json> [--key <hex>]",
      "",
      "Pass HARNESS_AUDIT_KEY=<hex> via env if you prefer not to expose the key in argv.",
      "",
      "Exit codes:",
      "  0   bundle verified — chain valid + hashes match + (optional) seal verifies",
      "  1   verification FAILED",
      "  2   config error (missing path / invalid JSON / unreadable file)",
      "",
    ].join("\n"));
    return 0;
  }

  const bundlePath = args[0];
  if (!fs.existsSync(bundlePath)) {
    process.stderr.write(`error: bundle file not found: ${bundlePath}\n`);
    return 2;
  }

  let bundle;
  try {
    const raw = fs.readFileSync(bundlePath, "utf-8");
    bundle = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`error: failed to read / parse bundle: ${err.message}\n`);
    return 2;
  }

  // Some endpoints wrap the bundle in `{ ok: true, bundle: {...} }`.
  // Accept either shape — if `.bundle` is a nested object, drill in.
  const target = bundle && typeof bundle === "object" && bundle.bundle
    && typeof bundle.bundle === "object" && bundle.bundle.schema
    ? bundle.bundle
    : bundle;

  const keyHex = _readKey(args);
  const sealKey = keyHex
    ? Buffer.from(keyHex, /^[0-9a-fA-F]+$/.test(keyHex) ? "hex" : "utf-8")
    : null;

  const result = verifyBundle(target, sealKey);

  // Summary block.
  process.stdout.write(`bundle:        ${path.resolve(bundlePath)}\n`);
  process.stdout.write(`schema:        ${target.schema || "(none)"}\n`);
  process.stdout.write(`mode:          ${target.mode || "(none)"}\n`);
  process.stdout.write(`exportedAt:    ${target.exportedAt || "(none)"}\n`);
  process.stdout.write(`totalEntries:  ${target.totalEntries ?? "?"}\n`);
  process.stdout.write(`truncated:     ${target.truncated ? "YES" : "no"}\n`);
  process.stdout.write(`seal alg:      ${target.seal && target.seal.alg ? target.seal.alg : "(none)"}\n`);
  process.stdout.write("\n");

  if (result.ok) {
    process.stdout.write("RESULT: PASS\n");
    process.stdout.write(`  sealed:        ${result.sealed ? "yes" : "no (alg=none)"}\n`);
    if (result.chain) {
      process.stdout.write(`  chain valid:   ${result.chain.valid !== false ? "yes" : "no"}\n`);
      if (typeof result.chain.entries === "number") {
        process.stdout.write(`  chain entries: ${result.chain.entries}\n`);
      }
    }
    return 0;
  }

  process.stdout.write("RESULT: FAIL\n");
  process.stdout.write(`  reason: ${result.reason}\n`);
  if (result.expected) process.stdout.write(`  expected: ${result.expected}\n`);
  if (result.actual)   process.stdout.write(`  actual:   ${result.actual}\n`);
  if (result.alg)      process.stdout.write(`  alg:      ${result.alg}\n`);
  if (result.chain)    process.stdout.write(`  chain:    ${JSON.stringify(result.chain)}\n`);
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main };
