// tests/integration/audit-sanitization.test.js — Slice D1-f (Phase E1, 2026-04-29)
//
// Verifies the EvidenceLedger sanitizer integration:
//   - When `sanitizer` is wired, append() runs data through it BEFORE
//     hashing and writing the JSONL entry.
//   - The persisted entry's `data` field reflects the SANITIZED form
//     (not the caller's original).
//   - The hash chain (and signature) cover the sanitized form, so
//     verifyChain() and verify() still pass on persisted data.
//   - Without a sanitizer wired, behavior is identical to pre-D1-f
//     (regression guard).

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { EvidenceLedger } = require("../../src/runtime/evidenceLedger");
const { sanitizeAuditData } = require("../../src/security/auditSanitizer");

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-d1f-test-"));
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return dir;
}

// ─────────────────────────────────────────────────────────────────
//  SANITIZER WIRED
// ─────────────────────────────────────────────────────────────────

test("D1-f: sanitizer wired → append redacts secret-shaped fields BEFORE persisting", (t) => {
  const dir = tmpDir(t);
  const ledger = new EvidenceLedger({ rootDir: dir, sanitizer: sanitizeAuditData });

  ledger.append("test-run", {
    type: "credential_set",
    data: {
      profileId: "personal",
      key: "ANTHROPIC_API_KEY",
      backend: "wincred",
      // Pathological: a future buggy callsite includes the actual value.
      // The sanitizer must catch it.
      ANTHROPIC_API_KEY: "sk-leaked-VALUE-must-not-persist",
    },
  });

  const entries = ledger.read("test-run");
  assert.equal(entries.length, 1);
  const stored = entries[0].data;
  assert.equal(stored.profileId, "personal");
  assert.equal(stored.key, "ANTHROPIC_API_KEY"); // key NAME passes (SAFE_KEY_NAMES)
  assert.equal(stored.backend, "wincred");
  // The leaked value field is replaced with a redaction marker.
  assert.equal(typeof stored.ANTHROPIC_API_KEY, "object");
  assert.equal(stored.ANTHROPIC_API_KEY.redacted, true);
  assert.equal(stored.ANTHROPIC_API_KEY.keyName, "ANTHROPIC_API_KEY");
  // CRITICAL regression guard: the actual value must NOT appear
  // anywhere in the persisted JSONL file. The ledger lays files
  // out as <rootDir>/<runId>/ledger.jsonl (no intermediate "runs/").
  const raw = fs.readFileSync(path.join(dir, "test-run", "ledger.jsonl"), "utf-8");
  assert.ok(!raw.includes("sk-leaked-VALUE-must-not-persist"),
    "leaked value MUST NOT appear in the persisted ledger file");
});

test("D1-f: hash chain covers SANITIZED data (verify() still passes)", (t) => {
  const dir = tmpDir(t);
  const ledger = new EvidenceLedger({ rootDir: dir, sanitizer: sanitizeAuditData });

  ledger.append("run-1", { type: "evt-1", data: { ok: true } });
  ledger.append("run-1", {
    type: "evt-2",
    data: { OPENAI_API_KEY: "leaked", normal: 42 },
  });
  ledger.append("run-1", { type: "evt-3", data: { final: "step" } });

  // Read back + verify the chain. Even though the caller passed a
  // secret-shaped value into evt-2's data, the chain must verify
  // because the sanitized form is what got hashed AND persisted.
  // verify() returns {valid, entries, errors}.
  const v = ledger.verify("run-1");
  assert.equal(v.valid, true, `verify failed: ${JSON.stringify(v)}`);
  assert.equal(v.entries, 3);
  assert.deepEqual(v.errors, []);
});

test("D1-f: signed ledger + sanitizer (verifyChain) round-trips cleanly", (t) => {
  const dir = tmpDir(t);
  const signingKey = Buffer.from("0123456789abcdef0123456789abcdef", "utf-8");
  const ledger = new EvidenceLedger({
    rootDir: dir,
    signingKey,
    sanitizer: sanitizeAuditData,
  });

  ledger.append("run-1", {
    type: "credential_set",
    data: {
      profileId: "personal",
      ANTHROPIC_API_KEY: "leaked-and-redacted",
    },
  });
  ledger.append("run-1", { type: "next", data: { ok: 1 } });

  // verifyChain must succeed with both hash chain + signature.
  // Return shape is {valid, entries, ...} per evidenceLedger.js.
  const result = ledger.verifyChain("run-1");
  assert.equal(result.valid, true,
    `verifyChain should succeed under sanitizer: ${JSON.stringify(result)}`);
  assert.equal(result.entries, 2);
});

// ─────────────────────────────────────────────────────────────────
//  SANITIZER NOT WIRED (regression guard)
// ─────────────────────────────────────────────────────────────────

test("D1-f: NO sanitizer wired → data persists unchanged (pre-D1-f behavior)", (t) => {
  // Existing tests + pre-D1-f production callers use the no-sanitizer
  // form. They keep working because sanitizer defaults to null.
  const dir = tmpDir(t);
  const ledger = new EvidenceLedger({ rootDir: dir }); // no sanitizer

  ledger.append("run-1", {
    type: "credential_set",
    data: {
      profileId: "personal",
      ANTHROPIC_API_KEY: "this-passes-through",
    },
  });
  const entries = ledger.read("run-1");
  // Pre-D1-f behavior: passes through unchanged. We still get
  // tamper-evidence via the hash chain.
  assert.equal(entries[0].data.ANTHROPIC_API_KEY, "this-passes-through");
});

// ─────────────────────────────────────────────────────────────────
//  CONSTRUCTOR VALIDATION
// ─────────────────────────────────────────────────────────────────

test("D1-f: non-function sanitizer throws at construction time", (t) => {
  const dir = tmpDir(t);
  for (const bad of [42, "not-a-fn", {}, [], true]) {
    assert.throws(
      () => new EvidenceLedger({ rootDir: dir, sanitizer: bad }),
      /sanitizer must be a function or null/,
      `must reject ${typeof bad} sanitizer`,
    );
  }
});

test("D1-f: sanitizer=null is the same as no sanitizer (default)", (t) => {
  const dir1 = tmpDir(t);
  const dir2 = tmpDir(t);
  const l1 = new EvidenceLedger({ rootDir: dir1 });             // omitted
  const l2 = new EvidenceLedger({ rootDir: dir2, sanitizer: null }); // explicit null

  l1.append("run", { type: "x", data: { ANTHROPIC_API_KEY: "v" } });
  l2.append("run", { type: "x", data: { ANTHROPIC_API_KEY: "v" } });

  const e1 = l1.read("run")[0];
  const e2 = l2.read("run")[0];
  assert.equal(e1.data.ANTHROPIC_API_KEY, "v");
  assert.equal(e2.data.ANTHROPIC_API_KEY, "v");
});

// ─────────────────────────────────────────────────────────────────
//  REAL-WORLD AUDIT VERBS (from D1-a..e)
// ─────────────────────────────────────────────────────────────────

test("D1-f: real D1 audit verbs survive sanitizer (no false positives)", (t) => {
  // The audit verbs we ship in D1-a..e are CAREFULLY constructed so
  // they don't accidentally include secret values. Verify the
  // sanitizer doesn't over-redact common audit shapes (regression
  // guard for the SAFE_KEY_NAMES allowlist).
  const dir = tmpDir(t);
  const ledger = new EvidenceLedger({ rootDir: dir, sanitizer: sanitizeAuditData });

  // Cases keyed to actual D1 verbs:
  ledger.append("run", {
    type: "credential_set",
    data: { profileId: "personal", key: "ANTHROPIC_API_KEY", backend: "wincred" },
  });
  ledger.append("run", {
    type: "profile_created",
    data: {
      profileId: "personal",
      label: "Personal",
      activeProvider: "claude",
      secretCount: 1,
      accountType: null,
      workspaceMode: null,
    },
  });
  ledger.append("run", {
    type: "profile_spawn_env_built",
    data: {
      profileId: "personal",
      workspacePath: "/tmp/ws",
      secretsInjected: 1,
      runner: "claude",
      runId: "r-12345",
    },
  });

  const entries = ledger.read("run");
  // Every audit field must pass through unchanged — none are values.
  assert.equal(entries[0].data.key, "ANTHROPIC_API_KEY",
    "credential_set.key (a NAME) must pass — it's in SAFE_KEY_NAMES");
  assert.equal(entries[1].data.secretCount, 1,
    "profile_created.secretCount (a count) must pass");
  assert.equal(entries[2].data.secretsInjected, 1,
    "profile_spawn_env_built.secretsInjected (a count) must pass");
});
