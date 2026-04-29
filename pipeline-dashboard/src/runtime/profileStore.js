// Slice D1-b (Phase E1 productization, 2026-04-29) — profile registry.
//
// One profile = one "operator identity" the harness uses to launch
// Claude/Codex CLIs. A profile bundles:
//   - id          — short safe handle ("personal", "work-laptop")
//   - label       — human-readable name (UI display)
//   - workspacePath — absolute path the spawned CLI runs in
//   - secretIds[] — list of credential keys this profile holds
//                   (the values live in credentialStore; we only
//                   record the keys here so list/upsert never touches
//                   secrets)
//   - activeProvider — "claude" | "codex" (default action when the
//                      operator hits "Run")
//   - createdAt / updatedAt — ISO 8601 timestamps for forensics
//
// File layout (`<HARNESS_CONFIG_DIR>/profiles.json`):
//
//   {
//     "version": 1,
//     "activeProfileId": "personal",
//     "profiles": {
//       "personal": { id: "personal", label: "...", ... },
//       "work":     { id: "work",     label: "...", ... }
//     }
//   }
//
// Why a separate file from credentials.json:
//
//   profiles.json is non-secret — it lists which keys a profile
//   *uses*, never the values. The launcher operator-guide tells
//   operators they can safely include profiles.json in backups
//   (no secret material). credentials.json is sensitive and
//   excluded. Keeping the two side-by-side under HARNESS_CONFIG_DIR
//   means a future "export-import" feature can ship the public side
//   without leaking the private side.
//
// Concurrency model:
//
//   Single-orchestrator-writer. The harness orchestrator is the sole
//   process writing this file (no concurrent processes), so no file
//   lock is needed. We DO use atomic temp→rename so a crash
//   mid-write never corrupts the file.
//
// Audit verbs (D1-b introduces these — additive to the chain):
//
//   profile_created   — operator added a new profile
//   profile_updated   — operator changed fields on an existing profile
//                       (label / workspacePath / activeProvider /
//                        secretIds — same id)
//   profile_deleted   — operator removed a profile
//   profile_switched  — activeProfileId changed
//
//   profile_switch_blocked is emitted at the route layer (D1-e), not
//   here, because the "is there an active run?" check belongs to the
//   orchestrator, not the storage layer.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 1;
const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;
const VALID_PROVIDERS = Object.freeze(new Set(["claude", "codex"]));

// ── ID + field validators ──────────────────────────────────────────

function assertSafeId(label, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`profileStore: ${label} must be a non-empty string`);
  }
  if (value.length > 256) {
    throw new Error(`profileStore: ${label} too long (max 256 chars)`);
  }
  if (!SAFE_ID_RE.test(value)) {
    throw new Error(
      `profileStore: ${label} "${value}" contains characters outside [A-Za-z0-9._-]`,
    );
  }
}

function assertString(label, value, opts = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`profileStore: ${label} must be a non-empty string`);
  }
  const max = opts.max || 1024;
  if (value.length > max) {
    throw new Error(`profileStore: ${label} too long (max ${max} chars)`);
  }
}

function assertWorkspacePath(value) {
  assertString("workspacePath", value, { max: 4096 });
  if (!path.isAbsolute(value)) {
    throw new Error(
      `profileStore: workspacePath "${value}" must be absolute ` +
      `(spawn cwd cannot be a relative path — that would depend on ` +
      `the orchestrator's cwd at spawn time which is not stable)`,
    );
  }
}

function assertProvider(value) {
  if (!VALID_PROVIDERS.has(value)) {
    throw new Error(
      `profileStore: activeProvider "${value}" must be one of ` +
      Array.from(VALID_PROVIDERS).join(" | "),
    );
  }
}

function assertSecretIds(value) {
  if (!Array.isArray(value)) {
    throw new Error("profileStore: secretIds must be an array");
  }
  if (value.length > 32) {
    throw new Error("profileStore: secretIds may hold at most 32 entries");
  }
  const seen = new Set();
  for (const id of value) {
    assertSafeId("secretIds entry", id);
    if (seen.has(id)) {
      throw new Error(`profileStore: secretIds has duplicate "${id}"`);
    }
    seen.add(id);
  }
}

// ── Persistence ────────────────────────────────────────────────────

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    activeProfileId: null,
    profiles: {},
  };
}

function readStateSync(filePath) {
  if (!fs.existsSync(filePath)) return emptyState();
  let text = fs.readFileSync(filePath, "utf-8");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.trim().length === 0) return emptyState();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `profileStore: failed to parse ${filePath}: ${err.message} ` +
      `(refusing to overwrite — manual operator review required)`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`profileStore: ${filePath} root is not an object`);
  }
  // Forward-compat: future schema bumps can read older versions; for
  // now we accept v1 only and reject anything higher loudly. A lower
  // version is treated as "unmigrated old format" — also rejected.
  if (parsed.version !== SCHEMA_VERSION) {
    throw new Error(
      `profileStore: ${filePath} schema version ${parsed.version} ` +
      `does not match expected ${SCHEMA_VERSION} ` +
      `(future migration not yet implemented)`,
    );
  }
  // Defensive shape: pass-through but normalize null/missing fields.
  return {
    version: SCHEMA_VERSION,
    activeProfileId: typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : null,
    profiles: parsed.profiles && typeof parsed.profiles === "object" && !Array.isArray(parsed.profiles)
      ? parsed.profiles
      : {},
  };
}

function writeStateSync(filePath, state) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write — temp + rename. Same pattern as credentialStore.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (_) { /* Windows partial-noop */ }
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch (_) {}
}

// ── Schema validators ──────────────────────────────────────────────

/**
 * Validate a profile object as supplied by the operator. Throws on
 * any violation. Used by both upsert() and the route handlers (so
 * route validation matches storage validation exactly).
 *
 * @param {object} raw - operator-supplied object
 * @param {object} [opts]
 * @param {boolean} [opts.allowMissingTimestamps=true] - on create,
 *   timestamps will be assigned by the store. On a raw round-trip
 *   read, timestamps must be present (loud error to surface a
 *   manual edit gone wrong).
 */
function validateProfile(raw, opts = {}) {
  const allowMissingTimestamps = opts.allowMissingTimestamps !== false;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("profileStore: profile must be an object");
  }
  assertSafeId("profile.id", raw.id);
  assertString("profile.label", raw.label, { max: 256 });
  assertWorkspacePath(raw.workspacePath);
  assertProvider(raw.activeProvider);
  assertSecretIds(raw.secretIds || []);

  if (!allowMissingTimestamps) {
    if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) {
      throw new Error(`profileStore: profile.createdAt missing/invalid for id=${raw.id}`);
    }
    if (typeof raw.updatedAt !== "string" || Number.isNaN(Date.parse(raw.updatedAt))) {
      throw new Error(`profileStore: profile.updatedAt missing/invalid for id=${raw.id}`);
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.filePath - absolute path to profiles.json
 *   (typically `configPaths.resolve().profileFile`)
 * @param {object} [opts.ledger] - EvidenceLedger-shaped object with
 *   `append(runId, entry)`. Optional; tests can omit.
 * @param {function} [opts.now] - clock, default `() => new Date()`
 */
function createProfileStore(opts = {}) {
  if (typeof opts.filePath !== "string" || opts.filePath.length === 0) {
    throw new Error("profileStore: filePath is required");
  }
  const filePath = opts.filePath;
  const ledger = opts.ledger || null;
  const now = opts.now || (() => new Date());

  function nowIso() {
    return now().toISOString();
  }

  function audit(verb, data) {
    if (!ledger) return;
    try {
      ledger.append("system", { type: verb, data });
    } catch (_) { /* best-effort */ }
  }

  // ── Read paths ──────────────────────────────────────────────

  function list() {
    const state = readStateSync(filePath);
    // Stable order by id so UI / tests aren't flaky.
    return Object.keys(state.profiles).sort().map((id) => state.profiles[id]);
  }

  function get(id) {
    assertSafeId("id", id);
    const state = readStateSync(filePath);
    return state.profiles[id] || null;
  }

  function getActiveId() {
    const state = readStateSync(filePath);
    return state.activeProfileId;
  }

  function getActive() {
    const state = readStateSync(filePath);
    if (!state.activeProfileId) return null;
    return state.profiles[state.activeProfileId] || null;
  }

  // ── Write paths ─────────────────────────────────────────────

  function upsert(input) {
    validateProfile(input);
    const state = readStateSync(filePath);
    const existing = state.profiles[input.id];
    // Single nowIso() call so on creation `createdAt === updatedAt`,
    // matching operator intuition ("first save = no edits yet").
    // On update, we keep existing createdAt and only advance updatedAt.
    const stamp = nowIso();
    const createdAt = existing ? existing.createdAt : stamp;
    // Defensive copy: never store a reference to caller's object so
    // post-call mutations can't change persisted state.
    const profile = {
      id: input.id,
      label: input.label,
      workspacePath: input.workspacePath,
      activeProvider: input.activeProvider,
      secretIds: Array.from(new Set(input.secretIds || [])),
      createdAt,
      updatedAt: stamp,
    };
    state.profiles[input.id] = profile;
    writeStateSync(filePath, state);
    audit(existing ? "profile_updated" : "profile_created", {
      profileId: profile.id,
      label: profile.label,
      activeProvider: profile.activeProvider,
      secretCount: profile.secretIds.length,
    });
    return profile;
  }

  function deleteProfile(id) {
    assertSafeId("id", id);
    const state = readStateSync(filePath);
    if (!state.profiles[id]) return false;
    const wasActive = state.activeProfileId === id;
    delete state.profiles[id];
    if (wasActive) {
      // Don't auto-pick a new active — the operator must explicitly
      // choose. Leaving activeProfileId=null lets profileSpawn fall
      // back to "no profile, refuse to launch" instead of spawning
      // under unexpected credentials.
      state.activeProfileId = null;
    }
    writeStateSync(filePath, state);
    audit("profile_deleted", { profileId: id, wasActive });
    if (wasActive) {
      audit("profile_switched", { fromId: id, toId: null, reason: "delete_active_cleared_active" });
    }
    return true;
  }

  function setActive(id) {
    assertSafeId("id", id);
    const state = readStateSync(filePath);
    if (!state.profiles[id]) {
      throw new Error(`profileStore: cannot setActive — no profile with id "${id}"`);
    }
    const fromId = state.activeProfileId;
    if (fromId === id) return state.profiles[id]; // no-op, no audit
    state.activeProfileId = id;
    writeStateSync(filePath, state);
    audit("profile_switched", { fromId, toId: id });
    return state.profiles[id];
  }

  function clearActive() {
    const state = readStateSync(filePath);
    if (!state.activeProfileId) return;
    const fromId = state.activeProfileId;
    state.activeProfileId = null;
    writeStateSync(filePath, state);
    audit("profile_switched", { fromId, toId: null });
  }

  return Object.freeze({
    list,
    get,
    getActiveId,
    getActive,
    upsert,
    delete: deleteProfile,
    setActive,
    clearActive,
  });
}

module.exports = {
  createProfileStore,
  validateProfile,
  SCHEMA_VERSION,
  VALID_PROVIDERS,
  SAFE_ID_RE,
};
