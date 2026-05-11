// Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30) — mode resolution unit tests.
//
// resolveMode() is a pure function: priority pinning + garbage-input
// handling. persistMode() / clearPersistedMode() defensive against
// storage access errors.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const OrchestratorMonitorMode = require("../../public/js/monitor/mode");
const {
  MODES,
  DEFAULT_MODE,
  STORAGE_KEY,
  resolveMode,
  persistMode,
  clearPersistedMode,
  _validateMode,
  _readUrlMode,
  _readStorageMode,
} = OrchestratorMonitorMode;

// ── Constants ──────────────────────────────────────────────────────

test("UI-H1: MODES is exactly simple/advanced/legacy", () => {
  // Pin the set so adding a 4th mode forces a code-review-visible diff
  // here AND in docs/ui-h-redesign-plan.md §2.2.
  assert.deepEqual([...MODES].sort(), ["advanced", "legacy", "simple"]);
});

test("UI-H1: DEFAULT_MODE is 'simple' (operator-friendly fallback)", () => {
  assert.equal(DEFAULT_MODE, "simple");
});

test("UI-H1: STORAGE_KEY is namespaced 'orchestrator.monitor.mode'", () => {
  assert.equal(STORAGE_KEY, "orchestrator.monitor.mode");
});

// ── _validateMode ──────────────────────────────────────────────────

test("UI-H1: _validateMode accepts every valid mode (case-insensitive, trim)", () => {
  for (const m of MODES) {
    assert.equal(_validateMode(m), m, `${m} must validate as itself`);
  }
  assert.equal(_validateMode("Simple"), "simple", "case-insensitive");
  assert.equal(_validateMode("  ADVANCED  "), "advanced", "trims whitespace");
});

test("UI-H1: _validateMode rejects garbage input", () => {
  for (const v of [null, undefined, 0, 1, true, false, {}, [], () => {}]) {
    assert.equal(_validateMode(v), null,
      `garbage input ${String(v)} must yield null`);
  }
  assert.equal(_validateMode(""), null);
  assert.equal(_validateMode("pro"), null, "unrecognized mode rejected");
  assert.equal(_validateMode("advanced "), "advanced", "trailing whitespace ok");
  assert.equal(_validateMode("simple|legacy"), null, "compound rejected");
});

// ── _readUrlMode ───────────────────────────────────────────────────

test("UI-H1: _readUrlMode reads ?mode= from URL search", () => {
  assert.equal(_readUrlMode("?mode=simple"), "simple");
  assert.equal(_readUrlMode("?mode=advanced"), "advanced");
  // LEGACY-VIEW-REMOVE-0 (2026-05-11): "legacy" is still a parsed value
  // (the parser stays mode-agnostic) but the server-side route now
  // 302-redirects ?mode=legacy to / so this value never reaches the
  // product shell's resolver in practice.
  assert.equal(_readUrlMode("?mode=legacy"), "legacy");
  assert.equal(_readUrlMode("?monitor=1&mode=simple"), "simple");
  assert.equal(_readUrlMode("?mode=Simple"), "simple", "case-insensitive");
});

test("UI-H1: _readUrlMode returns null when ?mode= absent or invalid", () => {
  assert.equal(_readUrlMode(""), null);
  assert.equal(_readUrlMode("?monitor=1"), null);
  assert.equal(_readUrlMode("?mode="), null);
  assert.equal(_readUrlMode("?mode=pro"), null, "unknown mode rejected");
  assert.equal(_readUrlMode(null), null);
  assert.equal(_readUrlMode(undefined), null);
  assert.equal(_readUrlMode(42), null);
});

// ── _readStorageMode ───────────────────────────────────────────────

test("UI-H1: _readStorageMode reads from a Storage-like object", () => {
  const stub = { getItem: (k) => k === STORAGE_KEY ? "advanced" : null };
  assert.equal(_readStorageMode(stub), "advanced");
});

test("UI-H1: _readStorageMode returns null when storage missing or method absent", () => {
  assert.equal(_readStorageMode(null), null);
  assert.equal(_readStorageMode(undefined), null);
  assert.equal(_readStorageMode({}), null, "no getItem method");
  assert.equal(_readStorageMode({ getItem: "not a fn" }), null);
});

test("UI-H1: _readStorageMode returns null when storage.getItem throws", () => {
  // Some browsers throw on localStorage access in private mode etc.
  const stub = { getItem: () => { throw new Error("denied"); } };
  assert.equal(_readStorageMode(stub), null);
});

test("UI-H1: _readStorageMode rejects garbage values from storage", () => {
  const stub = { getItem: () => "pro" };
  assert.equal(_readStorageMode(stub), null);
});

// ── resolveMode — priority order ───────────────────────────────────

test("UI-H1: resolveMode falls back to 'simple' with no inputs", () => {
  assert.equal(resolveMode(), "simple");
  assert.equal(resolveMode({}), "simple");
});

test("UI-H1: resolveMode honors envDefault when nothing else set", () => {
  assert.equal(resolveMode({ envDefault: "advanced" }), "advanced");
  assert.equal(resolveMode({ envDefault: "legacy" }), "legacy");
});

test("UI-H1: resolveMode falls back to default when envDefault is invalid", () => {
  assert.equal(resolveMode({ envDefault: "pro" }), "simple");
  assert.equal(resolveMode({ envDefault: "" }), "simple");
});

test("UI-H1: resolveMode prefers localStorage over envDefault", () => {
  const storage = { getItem: () => "advanced" };
  assert.equal(resolveMode({ storage, envDefault: "legacy" }), "advanced");
});

test("UI-H1: resolveMode prefers URL over localStorage AND envDefault", () => {
  const storage = { getItem: () => "advanced" };
  assert.equal(resolveMode({
    location: { search: "?mode=legacy" },
    storage,
    envDefault: "simple",
  }), "legacy");
});

test("UI-H1: resolveMode skips invalid URL ?mode=, falls through to localStorage", () => {
  const storage = { getItem: () => "legacy" };
  assert.equal(resolveMode({
    location: { search: "?mode=garbage" },
    storage,
    envDefault: "simple",
  }), "legacy");
});

test("UI-H1: resolveMode skips invalid localStorage, falls through to envDefault", () => {
  const storage = { getItem: () => "garbage-value" };
  assert.equal(resolveMode({
    storage,
    envDefault: "advanced",
  }), "advanced");
});

test("UI-H1: resolveMode handles location with no search string", () => {
  assert.equal(resolveMode({ location: {} }), "simple");
  assert.equal(resolveMode({ location: { search: "" } }), "simple");
  assert.equal(resolveMode({ location: { search: null } }), "simple");
});

test("UI-H1: resolveMode handles storage that throws", () => {
  const storage = { getItem: () => { throw new Error("denied"); } };
  assert.equal(resolveMode({ storage, envDefault: "advanced" }), "advanced",
    "throwing storage falls through to envDefault");
});

// ── persistMode ────────────────────────────────────────────────────

test("UI-H1: persistMode writes a valid mode to storage", () => {
  let written = null;
  const storage = { setItem: (k, v) => { written = { k, v }; } };
  assert.equal(persistMode("advanced", storage), true);
  assert.deepEqual(written, { k: STORAGE_KEY, v: "advanced" });
});

test("UI-H1: persistMode rejects invalid modes (no write)", () => {
  let calls = 0;
  const storage = { setItem: () => { calls += 1; } };
  assert.equal(persistMode("pro", storage), false);
  assert.equal(persistMode(null, storage), false);
  assert.equal(persistMode(123, storage), false);
  assert.equal(calls, 0, "setItem must not run on invalid input");
});

test("UI-H1: persistMode normalizes case before writing", () => {
  let written = null;
  const storage = { setItem: (k, v) => { written = v; } };
  persistMode("ADVANCED", storage);
  assert.equal(written, "advanced");
});

test("UI-H1: persistMode survives storage that throws", () => {
  const storage = { setItem: () => { throw new Error("quota"); } };
  assert.equal(persistMode("simple", storage), false,
    "exception must be swallowed; return false");
});

test("UI-H1: persistMode without storage falls back to window.localStorage when present", () => {
  // Simulate node — no window. persistMode must NOT throw.
  assert.equal(persistMode("simple"), false,
    "no storage available -> false");
});

// ── clearPersistedMode ─────────────────────────────────────────────

test("UI-H1: clearPersistedMode removes the storage key", () => {
  let removed = null;
  const storage = { removeItem: (k) => { removed = k; } };
  clearPersistedMode(storage);
  assert.equal(removed, STORAGE_KEY);
});

test("UI-H1: clearPersistedMode is safe with no storage / throwing storage", () => {
  assert.doesNotThrow(() => clearPersistedMode(null));
  assert.doesNotThrow(() => clearPersistedMode({}));  // no removeItem
  const throwing = { removeItem: () => { throw new Error("nope"); } };
  assert.doesNotThrow(() => clearPersistedMode(throwing));
});
