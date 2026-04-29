// Slice D1-a (Phase E1 productization, 2026-04-29) — credential storage.
//
// Stores per-profile API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
// off-disk-by-default by going through the OS Credential Manager:
//   - Windows: Credential Manager (DPAPI) via keytar
//   - macOS:   Keychain via keytar
//   - Linux:   libsecret (gnome-keyring/KWallet) via keytar
//
// Why this exists (and why fail-closed):
//
//   The harness needs to launch Claude/Codex CLIs with their own API
//   keys per profile. The pre-D1 model passed parent process env (P0
//   stripped TOKEN/SECRET/KEY/PASSWORD/CREDENTIAL keys before spawn,
//   which is the right baseline). D1 layers profile-scoped credentials
//   on top: the operator stores their key once, the profile picks it
//   up at spawn time, and the key never lands on disk in plaintext.
//
//   "Fail-closed by default" means: when the OS keychain isn't
//   available AND the operator hasn't explicitly opted into plaintext
//   storage via `HARNESS_ALLOW_PLAINTEXT_SECRETS=1`, `setSecret` throws
//   instead of silently writing to a JSON file. This protects operators
//   who installed without keytar and would otherwise discover months
//   later that their API keys are in cleartext on disk.
//
// Why keytar is NOT a hard dependency in package.json:
//
//   - Native module: needs `python` + `node-gyp` + a C++ compiler at
//     install time. CI on minimal Ubuntu containers without build tools
//     would fail — and the harness should still install in those
//     environments (operators can either supply prebuilt keytar or use
//     the explicit plaintext flag).
//   - Lazy require with try/catch lets us run on systems that simply
//     don't have a credential manager (headless servers, some Docker
//     containers).
//   - Operators with a release zip may have keytar pre-built in the
//     bundled `node_modules/`; lazy require still picks it up.
//
// Backend taxonomy:
//
//   "keychain"  — keytar loaded successfully; secrets go to OS keystore.
//   "plaintext" — keytar unavailable + HARNESS_ALLOW_PLAINTEXT_SECRETS=1
//                 + NODE_ENV != "production". Secrets land in
//                 <configDir>/credentials.json with mode 0600.
//                 Loud audit + console warning on every selection.
//   "none"      — keytar unavailable + plaintext NOT enabled. setSecret
//                 throws; getSecret returns null (consumers fall back
//                 to "no credential, refuse to launch").
//
// Audit verbs (D1 introduces these — additive to the existing chain):
//
//   credential_set                 — operator stored a secret. Carries
//                                    {profileId, key, backend}; NEVER
//                                    the value.
//   credential_deleted             — operator removed a secret.
//   credential_plaintext_fallback  — emitted ONCE per process when the
//                                    plaintext backend is selected.
//                                    Loud signal in the audit chain so
//                                    a forensics review surfaces "this
//                                    profile's keys are NOT in keychain
//                                    storage during this window".
//   credential_backend_unavailable — emitted when keytar fails to load
//                                    AND plaintext is not enabled.
//                                    Operator gets a structured signal
//                                    rather than a raw stack trace.
//
// All four verbs are *additive* — none of them carry secret values,
// so the EvidenceLedger sanitizer (D1-e follow-up) is not strictly
// required for this module. We add it anyway to defend against future
// fields that might inadvertently include sensitive material.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const APP_NAME = "HarnessPipeline";

// ── keytar lazy-load ────────────────────────────────────────────────
//
// We try keytar at construction time (not module-load time) so tests
// can inject a stub `keytar` module via the factory's options. The
// fallback is fail-closed unless the operator explicitly opts in.

function loadKeytar() {
  try {
    // eslint-disable-next-line global-require
    return require("keytar");
  } catch (_) {
    return null;
  }
}

// ── Profile id / key sanitation ────────────────────────────────────
//
// keytar is permissive about service / account names but stuffing a
// path-traversal or null-byte through into the OS API would be ugly.
// Reject anything outside `[A-Za-z0-9._-]` — the same character class
// the manifest version validator uses.

const SAFE_ID_RE = /^[A-Za-z0-9_.-]+$/;

function assertSafeId(label, value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`credentialStore: ${label} must be a non-empty string`);
  }
  if (value.length > 256) {
    throw new Error(`credentialStore: ${label} too long (max 256 chars)`);
  }
  if (!SAFE_ID_RE.test(value)) {
    throw new Error(
      `credentialStore: ${label} "${value}" contains characters outside [A-Za-z0-9._-]`,
    );
  }
}

function serviceName(profileId) {
  return `${APP_NAME}-${profileId}`;
}

// ── Plaintext fallback file I/O ────────────────────────────────────
//
// Layout:
//   <configDir>/credentials.json
//   {
//     "<profileId>": {
//       "<key>": "<value>",
//       ...
//     },
//     ...
//   }
//
// We chmod the file to 0600 on creation. On Windows chmod is a partial
// no-op (NTFS ACL doesn't map cleanly), but the file lives under
// %APPDATA% which is per-user already — defense in depth, not the
// primary control.

function readPlaintextFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  let text = raw;
  // Strip a UTF-8 BOM if present (Windows tools may inject one).
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("credentials.json is not a JSON object");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `credentialStore: failed to parse ${filePath}: ${err.message} ` +
      `(refusing to overwrite — manual operator review required)`,
    );
  }
}

function writePlaintextFile(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: temp → rename so a crash mid-write can't corrupt.
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(tmp, 0o600);
  } catch (_) { /* Windows: chmod partial-noop, ignore */ }
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) { /* Windows: same as above */ }
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a credential store.
 *
 * @param {object} [opts]
 * @param {object|null} [opts.keytar]
 *   Pre-loaded keytar module for testing. Default: lazy `require("keytar")`.
 *   Pass `null` to force the keytar-unavailable code path.
 * @param {object} [opts.env=process.env]
 * @param {object} [opts.fsPaths]
 *   `{ profileFile, appdataConfig }` from configPaths.resolve(). Required
 *   for the plaintext fallback to know where to write credentials.json.
 * @param {object} [opts.ledger]
 *   EvidenceLedger-shaped object with append(runId, entry). Optional —
 *   when absent we silently no-op audit (used in tiny test setups).
 * @param {function} [opts.warn=console.warn]
 *   Hook for the fallback-warning banner. Tests can capture this.
 * @returns {{
 *   backend: "keychain"|"plaintext"|"none",
 *   isAvailable(): boolean,
 *   setSecret(profileId: string, key: string, value: string): Promise<void>,
 *   getSecret(profileId: string, key: string): Promise<string|null>,
 *   deleteSecret(profileId: string, key: string): Promise<void>,
 *   listSecretIds(profileId: string): Promise<string[]>,
 * }}
 */
function createCredentialStore(opts = {}) {
  const env = opts.env || process.env;
  const fsPaths = opts.fsPaths || null;
  const ledger = opts.ledger || null;
  const warn = opts.warn || ((...a) => console.warn(...a));

  // Lazy load keytar unless caller supplied a stub. Pass `null` to
  // force the not-available code path (tests do this).
  let keytar = "keytar" in opts ? opts.keytar : loadKeytar();

  // Decide backend.
  let backend;
  let plaintextFile = null;

  if (keytar && typeof keytar.setPassword === "function") {
    backend = "keychain";
  } else {
    const allowPlain = env.HARNESS_ALLOW_PLAINTEXT_SECRETS === "1";
    const isProd = env.NODE_ENV === "production";
    if (allowPlain && !isProd && fsPaths && fsPaths.appdataConfig) {
      backend = "plaintext";
      plaintextFile = path.join(fsPaths.appdataConfig, "credentials.json");
      warn(
        "[credentialStore] WARNING: plaintext credential backend selected. " +
        "Secrets will land in " + plaintextFile + " with mode 0600. " +
        "Install keytar for OS-keychain storage. Never enable in production.",
      );
      // Audit ONCE so a forensic review can pinpoint the time-window.
      if (ledger) {
        try {
          ledger.append("system", {
            type: "credential_plaintext_fallback",
            data: { file: plaintextFile },
          });
        } catch (_) { /* ledger best-effort during boot */ }
      }
    } else if (allowPlain && isProd) {
      // Production refuses the flag entirely — explicit "no, this is
      // not safe even if you ask" is part of fail-closed.
      warn(
        "[credentialStore] HARNESS_ALLOW_PLAINTEXT_SECRETS=1 IGNORED — " +
        "NODE_ENV=production blocks plaintext fallback. Install keytar.",
      );
      backend = "none";
      if (ledger) {
        try {
          ledger.append("system", {
            type: "credential_backend_unavailable",
            data: { reason: "plaintext_blocked_in_production" },
          });
        } catch (_) {}
      }
    } else {
      // No keytar + no plaintext opt-in = fail-closed.
      backend = "none";
      if (ledger) {
        try {
          ledger.append("system", {
            type: "credential_backend_unavailable",
            data: {
              reason: "keytar_missing",
              hint: "install keytar for OS-keychain or set HARNESS_ALLOW_PLAINTEXT_SECRETS=1 outside production",
            },
          });
        } catch (_) {}
      }
    }
  }

  // ── Operations ─────────────────────────────────────────────────

  async function setSecret(profileId, key, value) {
    assertSafeId("profileId", profileId);
    assertSafeId("key", key);
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("credentialStore: value must be a non-empty string");
    }

    if (backend === "keychain") {
      await keytar.setPassword(serviceName(profileId), key, value);
    } else if (backend === "plaintext") {
      const data = readPlaintextFile(plaintextFile);
      if (!data[profileId]) data[profileId] = {};
      data[profileId][key] = value;
      writePlaintextFile(plaintextFile, data);
    } else {
      // Fail-closed — never write a secret without an explicit backend.
      throw new Error(
        "credentialStore: no credential backend available. " +
        "Install keytar for OS-keychain storage, or set " +
        "HARNESS_ALLOW_PLAINTEXT_SECRETS=1 (dev only) to enable the " +
        "plaintext fallback.",
      );
    }

    if (ledger) {
      try {
        ledger.append("system", {
          type: "credential_set",
          data: { profileId, key, backend },
        });
      } catch (_) { /* best-effort */ }
    }
  }

  async function getSecret(profileId, key) {
    assertSafeId("profileId", profileId);
    assertSafeId("key", key);

    if (backend === "keychain") {
      // keytar returns null for missing entries (not throw) — preserve.
      return keytar.getPassword(serviceName(profileId), key);
    }
    if (backend === "plaintext") {
      const data = readPlaintextFile(plaintextFile);
      const v = data[profileId] && data[profileId][key];
      return typeof v === "string" ? v : null;
    }
    // backend === "none" — getSecret is the safer side; returning null
    // lets profile spawn fall back gracefully ("no credential, refuse
    // to launch this profile") rather than crashing read paths.
    return null;
  }

  async function deleteSecret(profileId, key) {
    assertSafeId("profileId", profileId);
    assertSafeId("key", key);

    if (backend === "keychain") {
      await keytar.deletePassword(serviceName(profileId), key);
    } else if (backend === "plaintext") {
      const data = readPlaintextFile(plaintextFile);
      if (data[profileId]) {
        delete data[profileId][key];
        if (Object.keys(data[profileId]).length === 0) {
          delete data[profileId];
        }
        writePlaintextFile(plaintextFile, data);
      }
    }
    // backend === "none": no-op (nothing was stored to delete).

    if (ledger) {
      try {
        ledger.append("system", {
          type: "credential_deleted",
          data: { profileId, key, backend },
        });
      } catch (_) {}
    }
  }

  async function listSecretIds(profileId) {
    assertSafeId("profileId", profileId);

    if (backend === "keychain") {
      const creds = await keytar.findCredentials(serviceName(profileId));
      // CRITICAL: only return account names (the keys), NEVER the
      // password values. This is the public listing surface; a misuse
      // here would leak credentials into UI / audit responses.
      return creds.map((c) => c.account);
    }
    if (backend === "plaintext") {
      const data = readPlaintextFile(plaintextFile);
      return data[profileId] ? Object.keys(data[profileId]) : [];
    }
    return [];
  }

  function isAvailable() {
    return backend !== "none";
  }

  return Object.freeze({
    get backend() { return backend; },
    isAvailable,
    setSecret,
    getSecret,
    deleteSecret,
    listSecretIds,
  });
}

module.exports = {
  createCredentialStore,
  // Exported for tests + callers that need to know the layout shape.
  APP_NAME,
  SAFE_ID_RE,
};
