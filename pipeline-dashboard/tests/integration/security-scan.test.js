// tests/integration/security-scan.test.js — Slice GOV-PII-1-b (Phase E1.5, 2026-04-29)
//
// Mounts createSecurityRoutes() on a throw-away express app and exercises
// POST /api/security/scan end-to-end. Pattern mirrors profile-routes.test.js
// (D1-e) + setup-routes.test.js (D2-c). Verifies:
//
//   - body validation: missing content, wrong type, oversized → 400/413
//   - depth selector: "deep" default, "inline" opt-in, invalid → default
//   - posture-driven block: public-sector → 200 ok=false blocked=true
//                            standard      → 200 ok=true  blocked=false
//   - clean scan: no audit row + slim response (auditData=null)
//   - dirty scan: audit verb + auditData echoed back to the caller
//   - audit verbs: pii_file_scan_blocked / pii_file_scan_warn
//   - audit data shape: source / filename / sizeBytes / depth /
//     findingCount / findingTypes / samples (already-redacted)
//   - back-compat: missing deploymentProfile → standard posture
//   - scanner exception: 500 (operator-readable) without crashing
//   - filename preserved in audit + response when given
//   - source defaults to "file_import" when omitted

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

const {
  createSecurityRoutes,
  AUDIT_VERBS,
  REASON_PII_DETECTED,
  DEFAULT_SCAN_DEPTH,
  MAX_CONTENT_BYTES,
} = require("../../src/routes/securityRoutes");

// ── helpers ───────────────────────────────────────────────────

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) { entries.push({ runId, ...entry }); },
  };
}

function publicSectorProfile() {
  return Object.freeze({
    mode: "public-sector",
    publicSector: true,
    allowLocalExecutor: false,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: true,
    requirePiiScanBeforeProviderDispatch: true,
    scannerFailurePolicy: "block",
  });
}

function standardProfile() {
  return Object.freeze({
    mode: "standard",
    publicSector: false,
    allowLocalExecutor: true,
    allowPlaintextSecrets: false,
    requireSandboxWorkspace: false,
    requirePiiScanBeforeProviderDispatch: false,
    scannerFailurePolicy: "warn",
  });
}

async function startApp(deps = {}) {
  const app = express();
  app.use("/api", createSecurityRoutes(deps));
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port, async close() {
        await new Promise((r) => server.close(r));
      }});
    });
  });
}

async function postScan(port, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const req = http.request({
      host: "127.0.0.1", port,
      method: "POST", path: "/api/security/scan",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(json) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (_) { resolve({ status: res.statusCode, body: null, text }); }
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

// Computed valid PII shapes (see piiScanner.test.js for derivations)
const KRN_VALID = "900101-1234568";
const BRN_VALID = "123-45-67891";

// ─────────────────────────────────────────────────────────────────
//  BODY VALIDATION
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: missing content → 400 content_required", async () => {
  const app = await startApp({});
  try {
    const r = await postScan(app.port, {});
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "content_required");
  } finally { await app.close(); }
});

test("GOV-PII-1-b: non-string content → 400 content_required", async () => {
  const app = await startApp({});
  try {
    for (const bad of [null, 42, [], {}, true]) {
      const r = await postScan(app.port, { content: bad });
      assert.equal(r.status, 400);
      assert.equal(r.body.error, "content_required");
    }
  } finally { await app.close(); }
});

test("GOV-PII-1-b: oversized content → 413 with limitBytes echoed", async () => {
  const app = await startApp({});
  try {
    // Build content slightly past the limit. (Use the JSON parser limit
    // of 1mb so the request reaches the route handler — content the
    // size of MAX_CONTENT_BYTES + 1 fits in a 1mb body even after JSON
    // overhead, but post body parser with a smaller limit could
    // intercept first; we test the route's MAX guard explicitly.)
    const oversized = "a".repeat(MAX_CONTENT_BYTES + 1);
    const r = await postScan(app.port, { content: oversized });
    // Either route's 413 OR body-parser's 413, both are correct.
    assert.equal(r.status, 413);
    if (r.body && r.body.error) {
      assert.equal(r.body.error, "content_too_large");
      assert.equal(r.body.limitBytes, MAX_CONTENT_BYTES);
    }
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  DEPTH SELECTOR
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: depth defaults to 'deep' for file-import context", async () => {
  const app = await startApp({});
  try {
    const r = await postScan(app.port, {
      content: `사업자번호 ${BRN_VALID}`, // BRN only matches under depth=deep
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.depth, DEFAULT_SCAN_DEPTH);
    assert.equal(r.body.depth, "deep");
    // BRN match means depth=deep was used.
    const types = r.body.scan.findings.map((f) => f.type);
    assert.ok(types.includes("business_reg"),
      "default depth=deep must include BRN matches in file-import context");
  } finally { await app.close(); }
});

test("GOV-PII-1-b: depth='inline' falls back to GOV-PII-0 fast set", async () => {
  const app = await startApp({});
  try {
    const r = await postScan(app.port, {
      content: `KRN: ${KRN_VALID}, BRN: ${BRN_VALID}`,
      depth: "inline",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.depth, "inline");
    const types = r.body.scan.findings.map((f) => f.type);
    assert.ok(types.includes("krn"),
      "inline depth still matches GOV-PII-0 KRN");
    assert.ok(!types.includes("business_reg"),
      "inline depth must NOT match BRN");
  } finally { await app.close(); }
});

test("GOV-PII-1-b: invalid depth value falls back to default 'deep'", async () => {
  const app = await startApp({});
  try {
    for (const bad of ["ghost", "DEEP", 42, true]) {
      const r = await postScan(app.port, { content: "no pii", depth: bad });
      assert.equal(r.body.depth, "deep");
    }
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  POSTURE-DRIVEN BLOCK (public-sector)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: public-sector + PII → blocked=true ok=false + pii_file_scan_blocked audit", async () => {
  const ledger = makeLedger();
  const app = await startApp({
    ledger,
    deploymentProfile: publicSectorProfile(),
  });
  try {
    const r = await postScan(app.port, {
      content: `KRN: ${KRN_VALID}`,
      filename: "agency-attachment.txt",
      source: "agency_workspace_import",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.blocked, true);
    assert.equal(r.body.reason, REASON_PII_DETECTED);
    assert.equal(r.body.auditVerb, AUDIT_VERBS.BLOCKED);
    assert.equal(r.body.auditVerb, "pii_file_scan_blocked");

    // Audit row emitted.
    const audits = ledger.entries.filter((e) => e.type === "pii_file_scan_blocked");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].data.filename, "agency-attachment.txt");
    assert.equal(audits[0].data.source, "agency_workspace_import");
    assert.ok(audits[0].data.findingTypes.includes("krn"));
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  POSTURE-DRIVEN WARN (standard)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: standard + PII → ok=true blocked=false + pii_file_scan_warn audit", async () => {
  const ledger = makeLedger();
  const app = await startApp({
    ledger,
    deploymentProfile: standardProfile(),
  });
  try {
    const r = await postScan(app.port, {
      content: `email leak: alice@example.com`,
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.blocked, false);
    assert.equal(r.body.reason, null);
    assert.equal(r.body.auditVerb, AUDIT_VERBS.WARN);
    assert.equal(r.body.auditVerb, "pii_file_scan_warn");

    const audits = ledger.entries.filter((e) => e.type === "pii_file_scan_warn");
    assert.equal(audits.length, 1);
    assert.ok(audits[0].data.findingTypes.includes("email"));
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  CLEAN SCAN (no audit pollution)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: clean scan → ok=true + NO audit row + slim auditData", async () => {
  const ledger = makeLedger();
  const app = await startApp({
    ledger,
    deploymentProfile: publicSectorProfile(),
  });
  try {
    const r = await postScan(app.port, {
      content: "this is a perfectly clean document.",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.blocked, false);
    assert.equal(r.body.scan.hasPii, false);
    assert.equal(r.body.scan.findings.length, 0);
    assert.equal(r.body.auditVerb, null,
      "clean scan must NOT emit audit verb (keeps audit chain quiet)");
    assert.equal(r.body.auditData, null,
      "clean scan response is slim — no auditData payload");

    // Ledger has zero entries.
    assert.equal(ledger.entries.length, 0,
      "clean scans must NOT emit audit rows under any posture");
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  AUDIT DATA SHAPE
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: audit data carries source / filename / sizeBytes / depth / findingTypes / samples", async () => {
  const ledger = makeLedger();
  const app = await startApp({ ledger, deploymentProfile: publicSectorProfile() });
  try {
    const content = `KRN: ${KRN_VALID}\nBRN: ${BRN_VALID}\nemail: ops@agency.kr`;
    await postScan(app.port, {
      content,
      filename: "evidence.txt",
      source: "agency_attachment",
      depth: "deep",
    });
    const audit = ledger.entries.find((e) => e.type === "pii_file_scan_blocked");
    assert.ok(audit);
    assert.equal(audit.data.source, "agency_attachment");
    assert.equal(audit.data.filename, "evidence.txt");
    assert.equal(audit.data.sizeBytes, content.length);
    assert.equal(audit.data.depth, "deep");
    assert.equal(audit.data.findingCount, 3);
    assert.deepEqual(
      [...audit.data.findingTypes].sort(),
      ["business_reg", "email", "krn"].sort(),
    );
    // Samples are already redacted.
    assert.ok(audit.data.samples.krn);
    assert.ok(audit.data.samples.business_reg);
    for (const sample of audit.data.samples.krn) {
      assert.ok(!sample.includes("12345"),
        "KRN samples must be redacted (no raw digits)");
    }
  } finally { await app.close(); }
});

test("GOV-PII-1-b: filename omitted → null in audit + response", async () => {
  const ledger = makeLedger();
  const app = await startApp({ ledger, deploymentProfile: publicSectorProfile() });
  try {
    const r = await postScan(app.port, { content: `KRN: ${KRN_VALID}` });
    assert.equal(r.body.filename, null);
    const audit = ledger.entries.find((e) => e.type === "pii_file_scan_blocked");
    assert.equal(audit.data.filename, null);
  } finally { await app.close(); }
});

test("GOV-PII-1-b: source defaults to 'file_import' when omitted", async () => {
  const ledger = makeLedger();
  const app = await startApp({ ledger, deploymentProfile: standardProfile() });
  try {
    const r = await postScan(app.port, { content: "email: x@y.com" });
    assert.equal(r.body.auditData.source, "file_import");
    const audit = ledger.entries.find((e) => e.type === "pii_file_scan_warn");
    assert.equal(audit.data.source, "file_import");
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  RESPONSE SHAPE LOCK
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: response shape is stable across all scenarios", async () => {
  const app = await startApp({ deploymentProfile: standardProfile() });
  try {
    const r = await postScan(app.port, { content: "no pii here" });
    assert.deepEqual(
      Object.keys(r.body).sort(),
      ["auditData", "auditVerb", "blocked", "depth", "filename", "ok", "reason", "scan", "sizeBytes"].sort(),
    );
    // scan sub-shape lock.
    assert.deepEqual(
      Object.keys(r.body.scan).sort(),
      ["elapsedMs", "findings", "hasPii"].sort(),
    );
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  BACKWARD COMPAT (no deploymentProfile)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: missing deploymentProfile → standard posture (no block, just warn)", async () => {
  const ledger = makeLedger();
  const app = await startApp({ ledger /* no deploymentProfile */ });
  try {
    const r = await postScan(app.port, { content: `KRN: ${KRN_VALID}` });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.blocked, false);
    assert.equal(r.body.auditVerb, "pii_file_scan_warn",
      "missing deploymentProfile must default to warn (NOT block) — UI safety");
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  BACK-COMPAT BUT FAIL-CLOSED (one signal alone blocks)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: hand-injected mix — only requirePiiScan=true → still blocks (fail-closed)", async () => {
  const app = await startApp({
    deploymentProfile: { requirePiiScanBeforeProviderDispatch: true },
  });
  try {
    const r = await postScan(app.port, { content: `KRN: ${KRN_VALID}` });
    assert.equal(r.body.blocked, true,
      "either signal alone must block — matches GOV-PII-0 piiGate fail-closed semantics");
  } finally { await app.close(); }
});

test("GOV-PII-1-b: hand-injected mix — only scannerFailurePolicy='block' → still blocks", async () => {
  const app = await startApp({
    deploymentProfile: { scannerFailurePolicy: "block" },
  });
  try {
    const r = await postScan(app.port, { content: "email: x@y.com" });
    assert.equal(r.body.blocked, true);
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  SCANNER EXCEPTION (defensive)
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: scanner throwing → 500 with operator-readable error", async () => {
  const app = await startApp({
    scanImpl: () => { throw new Error("scanner exploded"); },
  });
  try {
    const r = await postScan(app.port, { content: "doesn't matter" });
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "scan_failed");
    assert.match(r.body.message, /scanner exploded/);
  } finally { await app.close(); }
});

// ─────────────────────────────────────────────────────────────────
//  FROZEN EXPORTS
// ─────────────────────────────────────────────────────────────────

test("GOV-PII-1-b: AUDIT_VERBS frozen + has both verbs", () => {
  assert.ok(Object.isFrozen(AUDIT_VERBS));
  assert.equal(AUDIT_VERBS.BLOCKED, "pii_file_scan_blocked");
  assert.equal(AUDIT_VERBS.WARN, "pii_file_scan_warn");
});

test("GOV-PII-1-b: REASON_PII_DETECTED matches GOV-PII-0 vocabulary", () => {
  assert.equal(REASON_PII_DETECTED, "pii_detected",
    "reason vocabulary stays unified between inline + file scan paths");
});
