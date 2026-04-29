// tests/unit/profileStore.test.js — Slice D1-b (Phase E1, 2026-04-29)
//
// Verifies the profile registry's:
//   1. Round-trip correctness — upsert/list/get/delete return what
//      callers actually wrote, with stable ordering.
//   2. Schema validation rejects every malformed shape that the route
//      layer would otherwise pass through unchecked.
//   3. Atomic write semantics — no half-writes after a parse failure
//      on read; existing data is preserved when validation fails.
//   4. Audit verbs (profile_created / _updated / _deleted / _switched)
//      fire with the right shape and DO NOT include sensitive material.
//   5. Active-profile lifecycle: setActive → setActive elsewhere →
//      delete-while-active → clearActive.
//   6. ID sanitation matches credentialStore so the two stores never
//      disagree about what's a valid profile id.

"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createProfileStore, validateProfile, SCHEMA_VERSION } = require(
  "../../src/runtime/profileStore",
);

// ── helpers ────────────────────────────────────────────────────

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-profile-test-"));
  const file = path.join(dir, "profiles.json");
  t.after(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });
  return file;
}

function makeLedger() {
  const entries = [];
  return {
    entries,
    append(runId, entry) { entries.push({ runId, ...entry }); },
  };
}

function sampleProfile(id = "personal") {
  return {
    id,
    label: `Profile ${id}`,
    workspacePath: process.platform === "win32"
      ? `C:\\workspace\\${id}`
      : `/tmp/workspace/${id}`,
    activeProvider: "claude",
    secretIds: ["ANTHROPIC_API_KEY"],
  };
}

// ─────────────────────────────────────────────────────────────────
//  ROUND-TRIP
// ─────────────────────────────────────────────────────────────────

test("D1-b: empty file → list=[], getActive=null", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  assert.deepEqual(store.list(), []);
  assert.equal(store.getActive(), null);
  assert.equal(store.getActiveId(), null);
  assert.equal(store.get("personal"), null);
});

test("D1-b: upsert assigns timestamps + persists across new instance", (t) => {
  const file = tmpFile(t);
  const store1 = createProfileStore({ filePath: file });
  const before = Date.now();
  const created = store1.upsert(sampleProfile("personal"));
  const after = Date.now();

  assert.equal(created.id, "personal");
  assert.equal(created.label, "Profile personal");
  assert.equal(created.activeProvider, "claude");
  assert.deepEqual(created.secretIds, ["ANTHROPIC_API_KEY"]);
  // Timestamps assigned by the store, not the caller.
  assert.ok(created.createdAt);
  assert.ok(created.updatedAt);
  const createdMs = Date.parse(created.createdAt);
  assert.ok(createdMs >= before - 5 && createdMs <= after + 5,
    `createdAt should be ~now, got ${created.createdAt}`);

  // New store instance reads back the same data.
  const store2 = createProfileStore({ filePath: file });
  const reread = store2.get("personal");
  assert.deepEqual(reread, created);
});

test("D1-b: upsert preserves createdAt, advances updatedAt on update", (t) => {
  const file = tmpFile(t);
  const ticks = [
    new Date("2026-04-29T10:00:00.000Z"),
    new Date("2026-04-29T10:05:00.000Z"),
  ];
  let i = 0;
  const store = createProfileStore({ filePath: file, now: () => ticks[i++] });

  const v1 = store.upsert(sampleProfile("personal"));
  assert.equal(v1.createdAt, "2026-04-29T10:00:00.000Z");
  assert.equal(v1.updatedAt, "2026-04-29T10:00:00.000Z");

  const v2 = store.upsert({ ...sampleProfile("personal"), label: "Renamed" });
  assert.equal(v2.label, "Renamed");
  assert.equal(v2.createdAt, "2026-04-29T10:00:00.000Z", "createdAt must NOT change on update");
  assert.equal(v2.updatedAt, "2026-04-29T10:05:00.000Z", "updatedAt must advance on update");
});

test("D1-b: list returns stable id-sorted order", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  store.upsert(sampleProfile("zulu"));
  store.upsert(sampleProfile("alpha"));
  store.upsert(sampleProfile("bravo"));
  const ids = store.list().map((p) => p.id);
  assert.deepEqual(ids, ["alpha", "bravo", "zulu"]);
});

test("D1-b: secretIds caller-mutation isolation (defensive copy)", (t) => {
  // The store must defensively copy the caller's secretIds array so
  // post-call mutation can't sneak into persisted state. (Duplicates
  // in the input are handled separately by validateProfile — see the
  // "rejects duplicate secretIds" test — so the input here has none.)
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  const input = {
    ...sampleProfile("personal"),
    secretIds: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
  };
  const created = store.upsert(input);
  assert.deepEqual(created.secretIds, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

  // Mutating the caller's array post-upsert must NOT touch persisted state.
  input.secretIds.push("MUTATED_AFTER_UPSERT");
  const reread = store.get("personal");
  assert.deepEqual(reread.secretIds, ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    "store must defensively copy caller's secretIds — caller mutation must not leak in");
});

// ─────────────────────────────────────────────────────────────────
//  ACTIVE LIFECYCLE
// ─────────────────────────────────────────────────────────────────

test("D1-b: setActive selects + getActive reads back", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  store.upsert(sampleProfile("personal"));
  store.upsert(sampleProfile("work"));

  assert.equal(store.getActiveId(), null, "no active by default");

  store.setActive("personal");
  assert.equal(store.getActiveId(), "personal");
  assert.equal(store.getActive().id, "personal");

  store.setActive("work");
  assert.equal(store.getActiveId(), "work");
});

test("D1-b: setActive throws when id unknown", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  store.upsert(sampleProfile("personal"));
  assert.throws(() => store.setActive("never-created"), /no profile with id/);
});

test("D1-b: delete clears active when deleting the active profile", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  store.upsert(sampleProfile("personal"));
  store.upsert(sampleProfile("work"));
  store.setActive("personal");

  const removed = store.delete("personal");
  assert.equal(removed, true);
  assert.equal(store.getActiveId(), null,
    "delete-active must clear activeProfileId — operator must explicitly re-select");
  // Other profile unaffected.
  assert.equal(store.get("work").id, "work");
});

test("D1-b: delete returns false on unknown id (no-op)", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  const removed = store.delete("never-existed");
  assert.equal(removed, false);
});

test("D1-b: clearActive sets active to null + emits switched-to-null", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  store.setActive("personal");

  ledger.entries.length = 0; // start fresh
  store.clearActive();
  assert.equal(store.getActiveId(), null);
  const sw = ledger.entries.find((e) => e.type === "profile_switched");
  assert.ok(sw);
  assert.equal(sw.data.fromId, "personal");
  assert.equal(sw.data.toId, null);
});

// ─────────────────────────────────────────────────────────────────
//  AUDIT VERBS
// ─────────────────────────────────────────────────────────────────

test("D1-b: profile_created audit on first upsert", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  const created = ledger.entries.find((e) => e.type === "profile_created");
  assert.ok(created);
  assert.equal(created.data.profileId, "personal");
  assert.equal(created.data.label, "Profile personal");
  assert.equal(created.data.activeProvider, "claude");
  assert.equal(created.data.secretCount, 1);
  // The actual key value should NOT appear in audit.
  const text = JSON.stringify(created);
  assert.ok(!/secretIds/.test(text), "audit must not include the raw secretIds list");
});

test("D1-b: profile_updated fires (not _created) when id already exists", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  ledger.entries.length = 0;
  store.upsert({ ...sampleProfile("personal"), label: "renamed" });

  const created = ledger.entries.find((e) => e.type === "profile_created");
  const updated = ledger.entries.find((e) => e.type === "profile_updated");
  assert.equal(created, undefined, "no profile_created on update");
  assert.ok(updated, "profile_updated must fire on re-upsert");
});

test("D1-b: profile_deleted + profile_switched fire when deleting active", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  store.setActive("personal");
  ledger.entries.length = 0;

  store.delete("personal");
  const del = ledger.entries.find((e) => e.type === "profile_deleted");
  const sw = ledger.entries.find((e) => e.type === "profile_switched");
  assert.ok(del);
  assert.equal(del.data.profileId, "personal");
  assert.equal(del.data.wasActive, true);
  assert.ok(sw);
  assert.equal(sw.data.fromId, "personal");
  assert.equal(sw.data.toId, null);
  assert.equal(sw.data.reason, "delete_active_cleared_active");
});

test("D1-b: setActive emits profile_switched with from/to", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  store.upsert(sampleProfile("work"));
  store.setActive("personal");
  ledger.entries.length = 0;

  store.setActive("work");
  const sw = ledger.entries.find((e) => e.type === "profile_switched");
  assert.ok(sw);
  assert.equal(sw.data.fromId, "personal");
  assert.equal(sw.data.toId, "work");
});

test("D1-b: setActive to same id is a no-op (no audit row)", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger });
  store.upsert(sampleProfile("personal"));
  store.setActive("personal");
  ledger.entries.length = 0;

  store.setActive("personal");
  assert.equal(ledger.entries.length, 0,
    "no-op switch must not spam the audit chain");
});

// ─────────────────────────────────────────────────────────────────
//  SCHEMA VALIDATION
// ─────────────────────────────────────────────────────────────────

test("D1-b: validateProfile rejects unknown activeProvider", () => {
  assert.throws(
    () => validateProfile({ ...sampleProfile(), activeProvider: "magic" }),
    /activeProvider.*claude.*codex/,
  );
});

test("D1-b: validateProfile rejects relative workspacePath", () => {
  assert.throws(
    () => validateProfile({ ...sampleProfile(), workspacePath: "./relative" }),
    /must be absolute/,
  );
});

test("D1-b: validateProfile rejects non-array secretIds", () => {
  assert.throws(
    () => validateProfile({ ...sampleProfile(), secretIds: "not-array" }),
    /secretIds must be an array/,
  );
});

test("D1-b: validateProfile rejects > 32 secretIds", () => {
  const tooMany = Array.from({ length: 33 }, (_, i) => `K${i}`);
  assert.throws(
    () => validateProfile({ ...sampleProfile(), secretIds: tooMany }),
    /at most 32 entries/,
  );
});

test("D1-b: validateProfile rejects duplicate secretIds (defensive)", () => {
  // upsert dedupes internally, but the route layer calls validateProfile
  // directly — we want a clean error there.
  assert.throws(
    () => validateProfile({ ...sampleProfile(), secretIds: ["A", "A"] }),
    /duplicate "A"/,
  );
});

test("D1-b: validateProfile rejects path-traversal in id", () => {
  for (const bad of ["../escape", "p/x", "p\\x", "p\x00null"]) {
    assert.throws(
      () => validateProfile({ ...sampleProfile(), id: bad }),
      /id.*outside \[A-Za-z0-9\._-\]/,
      `must reject "${bad}"`,
    );
  }
});

test("D1-b: validateProfile rejects empty label", () => {
  assert.throws(
    () => validateProfile({ ...sampleProfile(), label: "" }),
    /label.*non-empty/,
  );
});

test("D1-b: upsert (which calls validateProfile) blocks malformed input from persisting", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file });
  // Land a clean profile first so we can verify the bad call doesn't
  // clobber it.
  store.upsert(sampleProfile("personal"));
  const before = store.list();

  assert.throws(
    () => store.upsert({ ...sampleProfile("bad"), activeProvider: "magic" }),
    /activeProvider/,
  );
  // List must be unchanged after a failed upsert.
  const after = store.list();
  assert.deepEqual(after, before, "failed upsert must not touch persisted state");
});

// ─────────────────────────────────────────────────────────────────
//  PERSISTENCE EDGE CASES
// ─────────────────────────────────────────────────────────────────

test("D1-b: BOM-prefixed profiles.json reads correctly", (t) => {
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "﻿" + JSON.stringify({
    version: SCHEMA_VERSION,
    activeProfileId: "personal",
    profiles: {
      personal: {
        id: "personal",
        label: "P",
        workspacePath: process.platform === "win32" ? "C:\\ws" : "/ws",
        activeProvider: "claude",
        secretIds: [],
        createdAt: "2026-04-29T00:00:00.000Z",
        updatedAt: "2026-04-29T00:00:00.000Z",
      },
    },
  }));
  const store = createProfileStore({ filePath: file });
  assert.equal(store.get("personal").id, "personal");
  assert.equal(store.getActiveId(), "personal");
});

test("D1-b: malformed profiles.json refuses to operate (no clobber)", (t) => {
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "this-is-not-json");
  const store = createProfileStore({ filePath: file });
  assert.throws(() => store.list(), /failed to parse/);
  assert.throws(() => store.upsert(sampleProfile("personal")), /failed to parse/);
});

test("D1-b: schema version mismatch is loud, not silently migrated", (t) => {
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 999, // future schema we don't know how to read
    activeProfileId: null,
    profiles: {},
  }));
  const store = createProfileStore({ filePath: file });
  assert.throws(() => store.list(), /schema version 999/);
});

test("D1-b: write produces atomic temp + rename (no .tmp file on disk after success)", (t) => {
  const file = tmpFile(t);
  const dir = path.dirname(file);
  const store = createProfileStore({ filePath: file });
  store.upsert(sampleProfile("personal"));
  const stragglers = fs.readdirSync(dir).filter((n) => n.startsWith("profiles.json.tmp-"));
  assert.deepEqual(stragglers, [], "tmp file must be renamed away");
});

test("D1-b: returned store handle is frozen (caller cannot swap upsert)", () => {
  const file = path.join(os.tmpdir(), "noop-" + Math.random().toString(36).slice(2));
  const store = createProfileStore({ filePath: file });
  assert.ok(Object.isFrozen(store));
  assert.throws(() => { store.upsert = () => "tampered"; }, /Cannot/);
});

// ─────────────────────────────────────────────────────────────────
//  D1-gov-4 — public-sector schema enforcement on upsert
// ─────────────────────────────────────────────────────────────────

function publicSectorProfile(id = "agency-claude") {
  return {
    ...sampleProfile(id),
    // Public-sector schema fields:
    accountType: "agency_managed",
    workspaceMode: "sandbox",
    credentialBackend: "wincred",
    dataClassification: "internal",
    egressPolicyId: "agency-llm-egress",
  };
}

test("D1-gov-4: standard mode does NOT enforce public-sector schema (no regression)", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({ filePath: file, env: {} }); // standard mode
  // Existing standard-mode profile (no public-sector fields) must
  // still upsert successfully — D1-gov-4 is purely additive in
  // standard mode.
  const created = store.upsert(sampleProfile("personal"));
  assert.equal(created.id, "personal");
  assert.equal(created.accountType, undefined,
    "standard-mode profiles must not have accountType auto-populated");
});

test("D1-gov-4: public-sector mode enforces full agency schema", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  // Valid public-sector profile passes:
  const created = store.upsert(publicSectorProfile("agency-claude"));
  assert.equal(created.accountType, "agency_managed");
  assert.equal(created.workspaceMode, "sandbox");
  assert.equal(created.credentialBackend, "wincred");
  assert.equal(created.dataClassification, "internal");
  assert.equal(created.egressPolicyId, "agency-llm-egress");
});

test("D1-gov-4 GOV-G02: public-sector REJECTS accountType=personal", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  try {
    store.upsert({ ...publicSectorProfile(), accountType: "personal" });
    assert.fail("expected throw");
  } catch (err) {
    assert.equal(err.code, "PUBLIC_SECTOR_PROFILE_POLICY",
      "error must carry machine-checkable code for the route layer");
    assert.ok(Array.isArray(err.details));
    assert.match(err.details.join("\n"), /personal/);
  }
});

test("D1-gov-4 GOV-G04: public-sector REJECTS workspaceMode=local", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  assert.throws(
    () => store.upsert({ ...publicSectorProfile(), workspaceMode: "local" }),
    { code: "PUBLIC_SECTOR_PROFILE_POLICY" },
  );
});

test("D1-gov-4: public-sector REJECTS missing egressPolicyId", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  assert.throws(
    () => store.upsert({ ...publicSectorProfile(), egressPolicyId: "" }),
    { code: "PUBLIC_SECTOR_PROFILE_POLICY" },
  );
});

test("D1-gov-4 GOV-G03: public-sector REJECTS plaintext credentialBackend", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  for (const backend of ["plaintext", "plaintext_dev_only"]) {
    assert.throws(
      () => store.upsert({ ...publicSectorProfile(), credentialBackend: backend }),
      { code: "PUBLIC_SECTOR_PROFILE_POLICY" },
      `must reject "${backend}"`,
    );
  }
});

test("D1-gov-4: public-sector violations are persisted as a NO-OP (no clobber)", (t) => {
  const file = tmpFile(t);
  const store = createProfileStore({
    filePath: file,
    deploymentProfile: { publicSector: true },
  });
  // Land a clean profile first.
  store.upsert(publicSectorProfile("agency-claude"));
  const before = store.list();
  // Failed public-sector upsert must NOT touch persisted state.
  assert.throws(
    () => store.upsert({ ...publicSectorProfile("agency-rebel"), accountType: "personal" }),
    { code: "PUBLIC_SECTOR_PROFILE_POLICY" },
  );
  const after = store.list();
  assert.deepEqual(after, before, "failed public-sector upsert must not persist");
});

test("D1-gov-4: public-sector audit row carries accountType + workspaceMode", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({
    filePath: file,
    ledger,
    deploymentProfile: { publicSector: true },
  });
  store.upsert(publicSectorProfile("agency-claude"));
  const created = ledger.entries.find((e) => e.type === "profile_created");
  assert.ok(created);
  assert.equal(created.data.accountType, "agency_managed");
  assert.equal(created.data.workspaceMode, "sandbox");
  // Defensive: NO sensitive material in the audit data shape.
  const text = JSON.stringify(created);
  assert.ok(!/wincred/.test(text) || /credentialBackend/.test(text),
    "credentialBackend is informational, not sensitive");
});

test("D1-gov-4: standard-mode profile_created audit has accountType=null + workspaceMode=null", (t) => {
  const file = tmpFile(t);
  const ledger = makeLedger();
  const store = createProfileStore({ filePath: file, ledger, env: {} });
  store.upsert(sampleProfile("personal"));
  const created = ledger.entries.find((e) => e.type === "profile_created");
  assert.equal(created.data.accountType, null);
  assert.equal(created.data.workspaceMode, null);
});
