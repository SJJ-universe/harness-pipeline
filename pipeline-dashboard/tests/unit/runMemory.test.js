// Slice S4-a (Phase 2 / SMART-4, 2026-05-05) — runMemory unit tests.
//
// Privacy-by-design invariants pinned per plan §S §S-SMART-4 v2:
//   1. TTL cleanup-friendly (records live in ledger as
//      `run_memory_recorded` audit rows)
//   2. Opt-out via ORCHESTRATOR_RUN_MEMORY_DISABLE=1
//   3. Per-field length caps (256/2K/4K/512/1K) — overflow truncate
//      + truncated:true marker
//   4. NO raw text persistence — sourceHash only (sha256 of canonical
//      change content)
//   5. Public-sector: piiScanner-backed redaction + redacted:true +
//      redactedTypes list
//   6. Public-sector route audit (covered in S4-b)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const runMemory = require("../../src/runtime/runMemory");

const standardProfile = { publicSector: false };
const publicProfile = { publicSector: true };

// ── Frozen vocabulary ───────────────────────────────────────────

test("runMemory: SCHEMA constant", () => {
  assert.equal(runMemory.SCHEMA, "orchestrator-run-memory/v1");
});

test("runMemory: AUDIT_VERBS frozen", () => {
  assert.ok(Object.isFrozen(runMemory.AUDIT_VERBS));
  assert.equal(runMemory.AUDIT_VERBS.RECORDED, "run_memory_recorded");
  assert.equal(runMemory.AUDIT_VERBS.ACCESSED, "run_memory_accessed");
});

test("runMemory: FIELD_LIMITS frozen + correct caps", () => {
  assert.ok(Object.isFrozen(runMemory.FIELD_LIMITS));
  assert.equal(runMemory.FIELD_LIMITS.goal, 256);
  assert.equal(runMemory.FIELD_LIMITS.changeSummary, 2 * 1024);
  assert.equal(runMemory.FIELD_LIMITS.codexFindings, 4 * 1024);
  assert.equal(runMemory.FIELD_LIMITS.failureCause, 512);
  assert.equal(runMemory.FIELD_LIMITS.nextTimeWatchOuts, 1024);
});

// ── _isOptOut helper ────────────────────────────────────────────

test("_isOptOut: ORCHESTRATOR_RUN_MEMORY_DISABLE=1 → true", () => {
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "1" }), true);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "true" }), true);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "yes" }), true);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "TRUE" }), true);
});

test("_isOptOut: missing / 0 / false → false", () => {
  assert.equal(runMemory._isOptOut({}), false);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "0" }), false);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "false" }), false);
  assert.equal(runMemory._isOptOut({ ORCHESTRATOR_RUN_MEMORY_DISABLE: "" }), false);
});

// ── _truncateField helper ───────────────────────────────────────

test("_truncateField: under limit → unchanged + truncated:false", () => {
  const r = runMemory._truncateField("hi", 100);
  assert.equal(r.text, "hi");
  assert.equal(r.truncated, false);
});

test("_truncateField: over limit → truncated + ellipsis + truncated:true", () => {
  const r = runMemory._truncateField("a".repeat(20), 10);
  assert.equal(r.text.length, 10);
  assert.ok(r.text.endsWith("..."));
  assert.equal(r.truncated, true);
});

test("_truncateField: non-string → empty + truncated:false", () => {
  const r = runMemory._truncateField(null, 10);
  assert.equal(r.text, "");
  assert.equal(r.truncated, false);
});

test("_truncateField: exactly at limit → unchanged", () => {
  const r = runMemory._truncateField("ab".repeat(5), 10);
  assert.equal(r.text, "ababababab");
  assert.equal(r.truncated, false);
});

// ── _safeRedactString helper ─────────────────────────────────────

test("_safeRedactString: standard mode → no redaction", () => {
  const r = runMemory._safeRedactString(
    "contact john.doe@example.com", standardProfile,
  );
  assert.equal(r.redacted, false);
  assert.equal(r.text, "contact john.doe@example.com");
  assert.deepEqual(r.types, []);
});

test("_safeRedactString: public-sector + clean text → no redaction", () => {
  const r = runMemory._safeRedactString("review the auth flow", publicProfile);
  assert.equal(r.redacted, false);
  assert.deepEqual(r.types, []);
});

test("_safeRedactString: public-sector + email → redacted + types includes email", () => {
  const r = runMemory._safeRedactString(
    "contact john.doe@example.com for review", publicProfile,
  );
  assert.equal(r.redacted, true);
  assert.ok(r.types.includes("email"));
  assert.ok(r.text.includes("[REDACTED:email]"));
  assert.ok(!r.text.includes("john.doe@example.com"));
});

test("_safeRedactString: empty / non-string → no redaction", () => {
  assert.deepEqual(
    runMemory._safeRedactString("", publicProfile),
    { text: "", redacted: false, types: [] },
  );
  assert.deepEqual(
    runMemory._safeRedactString(null, publicProfile),
    { text: "", redacted: false, types: [] },
  );
});

// ── computeSourceHash ───────────────────────────────────────────

test("computeSourceHash: null/undefined → null", () => {
  assert.equal(runMemory.computeSourceHash(null), null);
  assert.equal(runMemory.computeSourceHash(undefined), null);
});

test("computeSourceHash: empty string → null (no content)", () => {
  assert.equal(runMemory.computeSourceHash(""), null);
});

test("computeSourceHash: same string → stable hash", () => {
  const a = runMemory.computeSourceHash("diff content");
  const b = runMemory.computeSourceHash("diff content");
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("computeSourceHash: different content → different hash", () => {
  const a = runMemory.computeSourceHash("a");
  const b = runMemory.computeSourceHash("b");
  assert.notEqual(a, b);
});

test("computeSourceHash: object → canonicalized + hashed", () => {
  // Order-independence — same content with different key order.
  const a = runMemory.computeSourceHash({ x: 1, y: 2 });
  const b = runMemory.computeSourceHash({ y: 2, x: 1 });
  assert.equal(a, b);
});

test("computeSourceHash: empty object → null", () => {
  assert.equal(runMemory.computeSourceHash({}), null);
});

// ── buildRunMemoryRecord ────────────────────────────────────────

test("buildRunMemoryRecord: standard mode + clean inputs → no truncate, no redact", () => {
  const rec = runMemory.buildRunMemoryRecord("run-1", {
    goal: "review auth",
    changeSummary: "added input validation",
    codexFindings: "[medium] missing test for null path",
    failureCause: null,
    nextTimeWatchOuts: "watch for null guards",
  }, { deploymentProfile: standardProfile, clockFn: () => "2026-05-05T00:00:00Z" });
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.fields));
  assert.equal(rec.schema, "orchestrator-run-memory/v1");
  assert.equal(rec.runId, "run-1");
  assert.equal(rec.recordedAt, "2026-05-05T00:00:00Z");
  assert.equal(rec.truncated, false);
  assert.equal(rec.redacted, false);
  assert.deepEqual(rec.redactedTypes, []);
  assert.equal(rec.sourceHash, null);
  assert.equal(rec.fields.goal, "review auth");
  assert.equal(rec.fields.changeSummary, "added input validation");
  assert.equal(rec.fields.codexFindings, "[medium] missing test for null path");
  assert.equal(rec.fields.nextTimeWatchOuts, "watch for null guards");
});

test("buildRunMemoryRecord: requires non-empty runId", () => {
  assert.throws(() => runMemory.buildRunMemoryRecord("", {}));
  assert.throws(() => runMemory.buildRunMemoryRecord(null, {}));
});

test("buildRunMemoryRecord: missing inputs → empty fields, no errors", () => {
  const rec = runMemory.buildRunMemoryRecord("run-2", null, {
    deploymentProfile: standardProfile, clockFn: () => "T",
  });
  assert.equal(rec.fields.goal, "");
  assert.equal(rec.fields.approvals, null);
  assert.equal(rec.fields.piiDetected, null);
});

test("buildRunMemoryRecord: oversize fields → truncated + flag", () => {
  const longGoal = "g".repeat(500);
  const longChange = "c".repeat(5 * 1024);
  const rec = runMemory.buildRunMemoryRecord("run-3", {
    goal: longGoal,
    changeSummary: longChange,
  }, { deploymentProfile: standardProfile });
  assert.equal(rec.truncated, true);
  assert.ok(rec.fields.goal.length <= 256);
  assert.ok(rec.fields.goal.endsWith("..."));
  assert.ok(rec.fields.changeSummary.length <= 2 * 1024);
  assert.ok(rec.fields.changeSummary.endsWith("..."));
});

test("buildRunMemoryRecord: public-sector + PII in goal → redacted + types collected", () => {
  const rec = runMemory.buildRunMemoryRecord("run-4", {
    goal: "review profile of jane.doe@example.com",
    changeSummary: "no PII here",
  }, { deploymentProfile: publicProfile });
  assert.equal(rec.redacted, true);
  assert.ok(rec.redactedTypes.includes("email"));
  assert.ok(rec.fields.goal.includes("[REDACTED:email]"));
  assert.ok(!rec.fields.goal.includes("jane.doe@example.com"));
  // changeSummary had no PII → unchanged
  assert.equal(rec.fields.changeSummary, "no PII here");
});

test("buildRunMemoryRecord: public-sector + PII in multiple fields → all types collected", () => {
  const rec = runMemory.buildRunMemoryRecord("run-5", {
    goal: "review john@example.com",
    changeSummary: "user 010-1234-5678 reported",
  }, { deploymentProfile: publicProfile });
  assert.equal(rec.redacted, true);
  assert.ok(rec.redactedTypes.includes("email"));
  assert.ok(rec.redactedTypes.includes("phone_kr_mobile"));
});

test("buildRunMemoryRecord: approvals counts only (no names/decider IDs)", () => {
  const rec = runMemory.buildRunMemoryRecord("run-6", {
    approvals: {
      granted: 3, denied: 1, timeout: 0,
      // These should NOT land in the record:
      grantedBy: "alice@example.com",
      denyReasons: ["sensitive payload"],
    },
  }, { deploymentProfile: standardProfile });
  assert.deepEqual(rec.fields.approvals, { granted: 3, denied: 1, timeout: 0 });
  assert.equal(rec.fields.approvals.grantedBy, undefined);
  assert.equal(rec.fields.approvals.denyReasons, undefined);
});

test("buildRunMemoryRecord: piiDetected only carries types, no samples", () => {
  const rec = runMemory.buildRunMemoryRecord("run-7", {
    piiDetected: {
      hasPii: true,
      types: ["krn", "email"],
      samples: { krn: ["95**"], email: ["jo**@ex**.com"] },  // should be dropped
    },
  }, { deploymentProfile: standardProfile });
  assert.equal(rec.fields.piiDetected.hasPii, true);
  assert.deepEqual(rec.fields.piiDetected.types, ["krn", "email"]);
  assert.equal(rec.fields.piiDetected.samples, undefined);
});

test("buildRunMemoryRecord: piiDetected.types caps at 16", () => {
  const types = Array.from({ length: 30 }, (_, i) => `t${i}`);
  const rec = runMemory.buildRunMemoryRecord("run-8", {
    piiDetected: { hasPii: true, types },
  }, { deploymentProfile: standardProfile });
  assert.equal(rec.fields.piiDetected.types.length, 16);
});

test("buildRunMemoryRecord: sourceContent → sourceHash, content NOT persisted", () => {
  const diff = "+ new line\n- old line\n";
  const rec = runMemory.buildRunMemoryRecord("run-9", {
    goal: "x", sourceContent: diff,
  }, { deploymentProfile: standardProfile });
  assert.match(rec.sourceHash, /^[0-9a-f]{64}$/);
  // The diff text is NOT in any field.
  for (const k of Object.keys(rec.fields)) {
    const v = rec.fields[k];
    if (typeof v === "string") {
      assert.ok(!v.includes("+ new line"), `${k} must not contain raw diff`);
    }
  }
});

test("buildRunMemoryRecord: gateMode propagates to record", () => {
  const rec = runMemory.buildRunMemoryRecord("run-10", {}, {
    deploymentProfile: standardProfile, gateMode: "hard",
  });
  assert.equal(rec.gateMode, "hard");
});

test("buildRunMemoryRecord: returned record is frozen + fields frozen + types array frozen", () => {
  const rec = runMemory.buildRunMemoryRecord("run-11", {
    piiDetected: { hasPii: true, types: ["krn"] },
  }, { deploymentProfile: standardProfile });
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.fields));
  assert.ok(Object.isFrozen(rec.fields.piiDetected));
  assert.ok(Object.isFrozen(rec.fields.piiDetected.types));
  assert.throws(() => { rec.runId = "tampered"; });
});

// ── recordRunMemory ─────────────────────────────────────────────

function fakeLedger() {
  const calls = [];
  return {
    calls,
    append(runId, entry) {
      calls.push({ runId, entry });
      return { ok: true };
    },
    read(runId) {
      return calls
        .filter((c) => c.runId === runId)
        .map((c) => c.entry);
    },
  };
}

test("recordRunMemory: opt-out env → recorded:false, reason:disabled_by_env", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "r", inputs: {},
    ledger, env: { ORCHESTRATOR_RUN_MEMORY_DISABLE: "1" },
    deploymentProfile: standardProfile,
  });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, "disabled_by_env");
  assert.equal(ledger.calls.length, 0);
});

test("recordRunMemory: missing ledger → recorded:false, reason:ledger_unavailable", () => {
  const r = runMemory.recordRunMemory({
    runId: "r", inputs: {},
    env: {},
    deploymentProfile: standardProfile,
  });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, "ledger_unavailable");
});

test("recordRunMemory: happy path → recorded:true + ledger appended with run_memory_recorded verb", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "r-1",
    inputs: { goal: "review auth", changeSummary: "added validation" },
    ledger,
    env: {},
    deploymentProfile: standardProfile,
    clockFn: () => "T1",
  });
  assert.equal(r.recorded, true);
  assert.equal(r.reason, "recorded");
  assert.ok(r.record);
  assert.equal(ledger.calls.length, 1);
  assert.equal(ledger.calls[0].runId, "r-1");
  assert.equal(ledger.calls[0].entry.type, "run_memory_recorded");
  assert.equal(ledger.calls[0].entry.data.runId, "r-1");
  assert.equal(ledger.calls[0].entry.data.recordedAt, "T1");
  assert.equal(ledger.calls[0].entry.data.fields.goal, "review auth");
});

test("recordRunMemory: invalid runId → recorded:false, reason:build_failed", () => {
  const ledger = fakeLedger();
  const r = runMemory.recordRunMemory({
    runId: "", inputs: {}, ledger, env: {},
    deploymentProfile: standardProfile,
  });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, "build_failed");
  assert.match(r.error, /runId required/);
});

test("recordRunMemory: ledger.append throws → recorded:false, record still in result for forensics", () => {
  const ledger = {
    append() { throw new Error("disk full"); },
    read() { return []; },
  };
  const r = runMemory.recordRunMemory({
    runId: "r", inputs: { goal: "x" }, ledger, env: {},
    deploymentProfile: standardProfile,
  });
  assert.equal(r.recorded, false);
  assert.equal(r.reason, "ledger_append_failed");
  assert.ok(r.record, "record provided for forensics even when persist failed");
  assert.match(r.error, /disk full/);
});

test("recordRunMemory: gateMode lands in audit data", () => {
  const ledger = fakeLedger();
  runMemory.recordRunMemory({
    runId: "r", inputs: { goal: "x" }, ledger,
    env: {}, deploymentProfile: standardProfile, gateMode: "hard",
  });
  assert.equal(ledger.calls[0].entry.data.gateMode, "hard");
});

test("recordRunMemory: public-sector + PII inputs → record carries redacted fields", () => {
  const ledger = fakeLedger();
  runMemory.recordRunMemory({
    runId: "r",
    inputs: { goal: "review jane@example.com" },
    ledger, env: {}, deploymentProfile: publicProfile,
  });
  const rec = ledger.calls[0].entry.data;
  assert.equal(rec.redacted, true);
  assert.ok(rec.fields.goal.includes("[REDACTED:email]"));
  assert.ok(!rec.fields.goal.includes("jane@example.com"));
  assert.ok(rec.redactedTypes.includes("email"));
});

// ── getRunMemory ────────────────────────────────────────────────

test("getRunMemory: empty ledger → null", () => {
  const ledger = fakeLedger();
  assert.equal(runMemory.getRunMemory("nope", ledger), null);
});

test("getRunMemory: ledger has run_memory_recorded → returns latest record", () => {
  const ledger = fakeLedger();
  runMemory.recordRunMemory({
    runId: "r", inputs: { goal: "first" }, ledger,
    env: {}, deploymentProfile: standardProfile, clockFn: () => "T1",
  });
  runMemory.recordRunMemory({
    runId: "r", inputs: { goal: "second" }, ledger,
    env: {}, deploymentProfile: standardProfile, clockFn: () => "T2",
  });
  const found = runMemory.getRunMemory("r", ledger);
  assert.ok(found);
  assert.equal(found.fields.goal, "second", "returns latest record (walk backwards)");
  assert.equal(found.recordedAt, "T2");
});

test("getRunMemory: ledger has only other audit verbs → null", () => {
  const ledger = {
    append() {},
    read() {
      return [
        { type: "review_session_dispatch_started", data: {} },
        { type: "policy_gate_warn", data: {} },
      ];
    },
  };
  assert.equal(runMemory.getRunMemory("r", ledger), null);
});

test("getRunMemory: invalid runId → null", () => {
  const ledger = fakeLedger();
  assert.equal(runMemory.getRunMemory("", ledger), null);
  assert.equal(runMemory.getRunMemory(null, ledger), null);
});

test("getRunMemory: missing ledger → null", () => {
  assert.equal(runMemory.getRunMemory("r"), null);
  assert.equal(runMemory.getRunMemory("r", null), null);
  assert.equal(runMemory.getRunMemory("r", {}), null);
});

test("getRunMemory: ledger.read throws → null (defensive)", () => {
  const ledger = {
    read() { throw new Error("ledger corrupt"); },
  };
  assert.equal(runMemory.getRunMemory("r", ledger), null);
});

// ── End-to-end privacy invariant: NO RAW PERSISTED ──────────────

test("privacy invariant: ledger NEVER stores raw sourceContent", () => {
  const ledger = fakeLedger();
  const secretDiff = "diff --git a/x.js b/x.js\n+const APIKEY = \"sk-secret-12345\";\n";
  runMemory.recordRunMemory({
    runId: "r",
    inputs: { goal: "x", sourceContent: secretDiff },
    ledger, env: {},
    deploymentProfile: standardProfile,
  });
  const persisted = JSON.stringify(ledger.calls[0]);
  assert.ok(!persisted.includes("APIKEY"), "raw secret must not land in ledger");
  assert.ok(!persisted.includes("sk-secret-12345"));
  // sourceHash must be present
  assert.match(ledger.calls[0].entry.data.sourceHash, /^[0-9a-f]{64}$/);
});

test("privacy invariant: public-sector → NO raw PII in persisted record", () => {
  const ledger = fakeLedger();
  runMemory.recordRunMemory({
    runId: "r",
    inputs: {
      goal: "review user jane@example.com",
      changeSummary: "phone 010-1234-5678 captured",
    },
    ledger, env: {}, deploymentProfile: publicProfile,
  });
  const persisted = JSON.stringify(ledger.calls[0]);
  assert.ok(!persisted.includes("jane@example.com"), "raw email must be redacted");
  assert.ok(!persisted.includes("010-1234-5678"), "raw phone must be redacted");
  assert.ok(persisted.includes("[REDACTED:email]"));
});
