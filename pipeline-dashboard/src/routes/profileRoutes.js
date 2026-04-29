// Slice D1-e (Phase E1 productization, 2026-04-29) — profile + credential routes.
//
// Route surface that lets the dashboard UI manage operator profiles
// + their credentials. Backed by D1-a credentialStore (secret values),
// D1-b profileStore (profile records), and D1-c profileSpawn (the
// composite layer that makes them spawn-time effective).
//
// Routes (all under /api/profiles, mounted in server.js):
//
//   GET    /api/profiles                       list profiles + activeProfileId
//   GET    /api/profiles/:id                   single profile
//   POST   /api/profiles                       upsert (body = profile)
//   DELETE /api/profiles/:id                   delete profile
//   POST   /api/profiles/:id/switch            set active profile
//   GET    /api/profiles/:id/secrets           list secret KEYS (never values)
//   POST   /api/profiles/:id/secrets           setSecret (body = {key, value})
//   DELETE /api/profiles/:id/secrets/:key      deleteSecret
//
// Why /switch is its own POST (not part of upsert):
//   Switching profiles changes which credentials the next spawn uses
//   — a fundamentally different audit verb (`profile_switched`) than
//   updating a profile's metadata (`profile_updated`). Keeping the
//   surfaces split lets the route enforce the active-run gate (409)
//   on /switch without leaking that policy into upsert.
//
// Active-run gate (per docs/public-sector-hardening-plan.md +
// the original D1-e plan):
//
//   POST /switch returns 409 + audit `profile_switch_blocked` when
//   the orchestrator has any in-flight runs. Switching credentials
//   under a live Claude/Codex child would mean the audit trail
//   forks mid-run — the run started under profile A but its
//   end-of-run telemetry would record profile B. The route gates
//   this by calling the injected `isActiveRun()` callback (server.js
//   wires it to childRegistry.snapshot().length > 0).
//
// Public-sector mode (D1-gov-4):
//
//   profileStore.upsert already validates against
//   validateProfileForPublicSector when the orchestrator is in
//   public-sector mode. It throws an Error with .code =
//   "PUBLIC_SECTOR_PROFILE_POLICY" and .details[]. This route maps
//   that to a 400 with the structured shape:
//     { error: "public_sector_profile_policy", details: [...] }
//   The route layer NEVER strips error.code — operators (or the UI)
//   need it for branching.
//
// Why never echo secret values:
//
//   GET /:id/secrets returns ONLY the key names (operator stores
//   ANTHROPIC_API_KEY, OPENAI_API_KEY in their profile — the route
//   confirms which keys exist but never the values). Even on
//   /:id/secrets/:key DELETE, the response body has no value field.
//   POST /:id/secrets accepts the value in the request body, never
//   echoes it back.

"use strict";

const { Router } = require("express");

/**
 * @param {object} opts
 * @param {object} opts.profileStore     - createProfileStore() handle (D1-b)
 * @param {object} opts.credentialStore  - createCredentialStore() handle (D1-a)
 * @param {function} [opts.isActiveRun]  - returns true when orchestrator
 *                                          has live runs. server.js wires it
 *                                          to childRegistry. Default returns
 *                                          false (no gate — useful for tests).
 * @param {object}   [opts.ledger]       - EvidenceLedger; profile_switch_blocked
 *                                          + profile_test_* audit verbs land here.
 * @returns {Router}
 */
function createProfileRoutes(opts = {}) {
  const router = Router();

  if (!opts.profileStore) {
    // Without a profileStore, every route 503s. Lets server.js mount
    // the route module unconditionally (D1-e rollout) and only wire
    // the storage when D1-a/b are configured. Avoids a "module
    // missing" route 404 that would be confusing.
    router.use((req, res) => {
      res.status(503).json({ error: "profileStore not wired" });
    });
    return router;
  }

  const profileStore = opts.profileStore;
  const credentialStore = opts.credentialStore || null;
  const isActiveRun = opts.isActiveRun || (() => false);
  const ledger = opts.ledger || null;

  function audit(verb, data) {
    if (!ledger) return;
    try {
      ledger.append("system", { type: verb, data });
    } catch (_) { /* best-effort */ }
  }

  // ── helpers ─────────────────────────────────────────────────

  /**
   * Maps a thrown profileStore error to an HTTP response.
   * - PUBLIC_SECTOR_PROFILE_POLICY → 400 with structured details
   * - Anything else                → 400 with the message
   */
  function _writeProfileError(res, err) {
    if (err && err.code === "PUBLIC_SECTOR_PROFILE_POLICY") {
      return res.status(400).json({
        error: "public_sector_profile_policy",
        details: err.details || [err.message],
      });
    }
    return res.status(400).json({ error: err.message || String(err) });
  }

  /**
   * Defensive shape for a profile in API responses. We do NOT pass
   * the raw store object through — even though profileStore never
   * holds secrets in the profile shape, future schema additions
   * might, and the explicit allowlist here keeps that risk low.
   */
  function _publicProfileShape(profile) {
    if (!profile) return null;
    const out = {
      id: profile.id,
      label: profile.label,
      workspacePath: profile.workspacePath,
      activeProvider: profile.activeProvider,
      secretIds: Array.from(profile.secretIds || []),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
    // Public-sector fields (when present — populated by D1-gov-4).
    for (const f of [
      "accountType",
      "workspaceMode",
      "credentialBackend",
      "dataClassification",
      "egressPolicyId",
    ]) {
      if (typeof profile[f] !== "undefined") out[f] = profile[f];
    }
    return out;
  }

  // ── GET /api/profiles ───────────────────────────────────────

  router.get("/profiles", (req, res) => {
    const profiles = profileStore.list().map(_publicProfileShape);
    res.json({
      profiles,
      activeProfileId: profileStore.getActiveId(),
    });
  });

  // ── GET /api/profiles/:id ───────────────────────────────────

  router.get("/profiles/:id", (req, res) => {
    let profile;
    try {
      profile = profileStore.get(req.params.id);
    } catch (err) {
      return _writeProfileError(res, err);
    }
    if (!profile) return res.status(404).json({ error: "not_found" });
    res.json({ profile: _publicProfileShape(profile) });
  });

  // ── POST /api/profiles (upsert) ─────────────────────────────

  router.post("/profiles", (req, res) => {
    const body = req.body || {};
    let profile;
    try {
      profile = profileStore.upsert(body);
    } catch (err) {
      return _writeProfileError(res, err);
    }
    res.json({ profile: _publicProfileShape(profile) });
  });

  // ── DELETE /api/profiles/:id ────────────────────────────────

  router.delete("/profiles/:id", (req, res) => {
    let removed;
    try {
      removed = profileStore.delete(req.params.id);
    } catch (err) {
      return _writeProfileError(res, err);
    }
    if (!removed) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, removed: req.params.id });
  });

  // ── POST /api/profiles/:id/switch ───────────────────────────

  router.post("/profiles/:id/switch", (req, res) => {
    const id = req.params.id;
    // Active-run gate. We check BEFORE touching the store so a
    // failed switch leaves no audit row at the storage layer
    // (we emit our own profile_switch_blocked audit instead).
    if (isActiveRun()) {
      const fromId = profileStore.getActiveId();
      audit("profile_switch_blocked", {
        fromId,
        toId: id,
        reason: "active_run",
      });
      return res.status(409).json({
        error: "active_run",
        message:
          "활성 run 종료 후 다시 시도하세요. " +
          "Switching profile under an in-flight run would fork the audit trail.",
      });
    }
    let profile;
    try {
      profile = profileStore.setActive(id);
    } catch (err) {
      // setActive throws for unknown id; not a public-sector violation.
      return res.status(404).json({ error: "not_found", message: err.message });
    }
    res.json({ profile: _publicProfileShape(profile) });
  });

  // ── GET /api/profiles/:id/secrets — list secret KEYS (never values)

  router.get("/profiles/:id/secrets", async (req, res) => {
    if (!credentialStore) {
      return res.status(503).json({ error: "credentialStore not wired" });
    }
    const id = req.params.id;
    let ids;
    try {
      ids = await credentialStore.listSecretIds(id);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    // CRITICAL: only secret KEYS — listSecretIds is contracted to never
    // return values, but we re-affirm by name here so a future bug in
    // the store doesn't accidentally leak through this route.
    res.json({ profileId: id, secretIds: ids });
  });

  // ── POST /api/profiles/:id/secrets — set secret value ───────

  router.post("/profiles/:id/secrets", async (req, res) => {
    if (!credentialStore) {
      return res.status(503).json({ error: "credentialStore not wired" });
    }
    const profileId = req.params.id;
    const body = req.body || {};
    const key = typeof body.key === "string" ? body.key : null;
    const value = typeof body.value === "string" ? body.value : null;
    if (!key || !value) {
      return res.status(400).json({
        error: "bad_request",
        message: "body must contain {key: string, value: string}",
      });
    }
    try {
      await credentialStore.setSecret(profileId, key, value);
    } catch (err) {
      // credentialStore.setSecret throws when backend=none (fail-closed),
      // public-sector blocks plaintext, or invalid id/key. Map to 400 in
      // all cases — none are 5xx from the operator's perspective.
      return res.status(400).json({ error: err.message });
    }
    // Response intentionally has no `value` field. Operator confirmed
    // the write by getting 200; the value never round-trips back.
    res.json({ ok: true, profileId, key, backend: credentialStore.backend });
  });

  // ── DELETE /api/profiles/:id/secrets/:key ───────────────────

  router.delete("/profiles/:id/secrets/:key", async (req, res) => {
    if (!credentialStore) {
      return res.status(503).json({ error: "credentialStore not wired" });
    }
    const { id, key } = req.params;
    try {
      await credentialStore.deleteSecret(id, key);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    res.json({ ok: true, profileId: id, key });
  });

  return router;
}

module.exports = { createProfileRoutes };
