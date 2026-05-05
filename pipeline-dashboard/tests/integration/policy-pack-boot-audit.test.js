// Slice S5-c (Phase 2 / SMART-5, 2026-05-05) — boot audit-row contract.
//
// Plan §S §S-SMART-5 v2 spec for the `deployment_profile_resolved`
// audit verb:
//   - Fires once at server boot
//   - Lands under the "system" runId (same convention as
//     policy_gate / runner_handshake boot events)
//   - Carries the resolved pack id + every rule field a forensic
//     auditor needs to reconstruct posture without re-reading env
//   - When dev-escape fired (HARNESS_POLICY_FAIL_OPEN=1 + typo'd env),
//     the row also carries resolvedFromFallback:true + unknownRequested:<typo>
//
// This test mimics what server.js boot does (audit emit pattern) so
// we can lock the verb shape independently of full server boot. The
// smoke test (tests/smoke/policy-pack-bootfail.test.js) covers the
// process.exit(1) end-to-end behavior.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const { resolveDeploymentProfile } = require("../../src/policy/deploymentProfile");

function makeLedgerDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "harness-pack-audit-test-"));
}

// Mimics server.js boot audit emit (S5-c) so we can lock the verb shape.
function emitBootAuditRow(ledger, profile) {
  ledger.append("system", {
    type: "deployment_profile_resolved",
    data: {
      pack: profile.pack,
      packLabel: profile.packLabel,
      publicSector: profile.publicSector,
      allowLocalExecutor: profile.allowLocalExecutor,
      allowPlaintextSecrets: profile.allowPlaintextSecrets,
      requireSandboxWorkspace: profile.requireSandboxWorkspace,
      requireSignedManifest: profile.requireSignedManifest,
      requirePiiScanBeforeProviderDispatch: profile.requirePiiScanBeforeProviderDispatch,
      scannerFailurePolicy: profile.scannerFailurePolicy,
      hardGatesDefault: profile.hardGatesDefault,
      runMemoryEnabled: profile.runMemoryEnabled,
      resolvedFromFallback: profile.resolvedFromFallback,
      unknownRequested: profile.unknownRequested,
    },
  });
}

function readSystemRows(ledger) {
  return ledger.read("system");
}

function findResolvedRow(rows) {
  return rows.find((r) => r && r.type === "deployment_profile_resolved");
}

function withTempLedger(fn) {
  const dir = makeLedgerDir();
  const ledger = new EvidenceLedger({ rootDir: dir });
  try { fn(ledger, dir); }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
}

// ── Tests ──────────────────────────────────────────────────────────

test("S5-c boot audit: standard pack lands deployment_profile_resolved with all rule fields", () => {
  withTempLedger((ledger) => {
    const profile = resolveDeploymentProfile({
      env: { HARNESS_DEPLOYMENT_PROFILE: "standard" },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.ok(row);
    assert.equal(row.type, "deployment_profile_resolved");
    assert.equal(row.data.pack, "standard");
    assert.equal(row.data.packLabel, "Standard");
    assert.equal(row.data.publicSector, false);
    assert.equal(row.data.allowLocalExecutor, true);
    assert.equal(row.data.requireSandboxWorkspace, false);
    assert.equal(row.data.requireSignedManifest, false);
    assert.equal(row.data.scannerFailurePolicy, "warn");
    assert.equal(row.data.hardGatesDefault, false);
    assert.equal(row.data.runMemoryEnabled, true);
    assert.equal(row.data.resolvedFromFallback, false);
    assert.equal(row.data.unknownRequested, null);
  });
});

test("S5-c boot audit: public-sector pack carries 공공기관 rule snapshot", () => {
  withTempLedger((ledger) => {
    const profile = resolveDeploymentProfile({
      env: { HARNESS_DEPLOYMENT_PROFILE: "public-sector" },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.equal(row.data.pack, "public-sector");
    assert.equal(row.data.publicSector, true);
    assert.equal(row.data.allowLocalExecutor, false);
    assert.equal(row.data.requireSandboxWorkspace, true);
    assert.equal(row.data.requireSignedManifest, true);
    assert.equal(row.data.requirePiiScanBeforeProviderDispatch, true);
    assert.equal(row.data.scannerFailurePolicy, "block");
    assert.equal(row.data.hardGatesDefault, false);  // graduated rollout
  });
});

test("S5-c boot audit: finance-high-privacy carries hardGatesDefault=true", () => {
  withTempLedger((ledger) => {
    const profile = resolveDeploymentProfile({
      env: { HARNESS_DEPLOYMENT_PROFILE: "finance-high-privacy" },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.equal(row.data.pack, "finance-high-privacy");
    assert.equal(row.data.publicSector, true);
    assert.equal(row.data.hardGatesDefault, true,
      "finance-high-privacy is the only pack with hard gates default ON");
    assert.equal(row.data.scannerFailurePolicy, "block");
  });
});

test("S5-c boot audit: dev escape lands resolvedFromFallback:true + unknownRequested", () => {
  withTempLedger((ledger) => {
    const profile = resolveDeploymentProfile({
      env: {
        HARNESS_DEPLOYMENT_PROFILE: "publicsector",  // typo
        HARNESS_POLICY_FAIL_OPEN: "1",
      },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.equal(row.data.pack, "standard");
    assert.equal(row.data.resolvedFromFallback, true);
    assert.equal(row.data.unknownRequested, "publicsector");
  });
});

test("S5-c boot audit: chain integrity — boot row participates in hash chain", () => {
  withTempLedger((ledger) => {
    const profile = resolveDeploymentProfile({
      env: { HARNESS_DEPLOYMENT_PROFILE: "developer-lab" },
    });
    emitBootAuditRow(ledger, profile);
    // Append another event so we have a 2-entry chain
    ledger.append("system", {
      type: "test_marker",
      data: { ok: true },
    });
    const verify = ledger.verify("system");
    assert.equal(verify.valid, true);
    assert.equal(verify.entries, 2);
  });
});

test("S5-c boot audit: every recognized pack appears in audit chain identical to its rules", () => {
  // Walk all 5 packs + verify each lands a row with consistent
  // pack vs rule fields.
  for (const modeId of ["standard", "public-sector", "finance-high-privacy",
                         "offline-internal-network", "developer-lab"]) {
    withTempLedger((ledger) => {
      const profile = resolveDeploymentProfile({
        env: { HARNESS_DEPLOYMENT_PROFILE: modeId },
      });
      emitBootAuditRow(ledger, profile);
      const row = findResolvedRow(readSystemRows(ledger));
      assert.ok(row, `missing audit row for ${modeId}`);
      assert.equal(row.data.pack, modeId);
      // The audit row must agree with what resolveDeploymentProfile
      // returned. Spot-check by re-reading profile:
      const refresh = resolveDeploymentProfile({
        env: { HARNESS_DEPLOYMENT_PROFILE: modeId },
      });
      assert.equal(row.data.publicSector, refresh.publicSector);
      assert.equal(row.data.requireSandboxWorkspace, refresh.requireSandboxWorkspace);
      assert.equal(row.data.scannerFailurePolicy, refresh.scannerFailurePolicy);
      assert.equal(row.data.hardGatesDefault, refresh.hardGatesDefault);
    });
  }
});

test("S5-c boot audit: row data carries plaintext-aware allowPlaintextSecrets bit", () => {
  withTempLedger((ledger) => {
    // developer-lab + opt-in env → allowPlaintextSecrets = true
    const profile = resolveDeploymentProfile({
      env: {
        HARNESS_DEPLOYMENT_PROFILE: "developer-lab",
        HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
      },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.equal(row.data.allowPlaintextSecrets, true);
  });
});

test("S5-c boot audit: public-sector + plaintext opt-in is IGNORED in row", () => {
  withTempLedger((ledger) => {
    // public-sector pack ALWAYS overrides plaintext opt-in
    const profile = resolveDeploymentProfile({
      env: {
        HARNESS_DEPLOYMENT_PROFILE: "public-sector",
        HARNESS_ALLOW_PLAINTEXT_SECRETS: "1",
      },
    });
    emitBootAuditRow(ledger, profile);
    const row = findResolvedRow(readSystemRows(ledger));
    assert.equal(row.data.allowPlaintextSecrets, false,
      "public-sector ignores plaintext opt-in (defense-in-depth)");
  });
});
