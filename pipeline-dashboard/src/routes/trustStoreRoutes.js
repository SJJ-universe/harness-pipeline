// Slice TRUST-STORE-0-c (Phase E Round 2, 2026-04-30) — trust store routes.
//
// HTTP surface that lets the dashboard UI manage the operator's
// manifest-signing trust store. Backed by:
//   - src/runtime/trustStore.js     — CRUD + atomic write
//   - src/security/manifestSigner   — fingerprint derivation
//
// Routes (mounted under /api/trust-store in server.js):
//
//   GET    /api/trust-store                   list keys (read-only)
//   POST   /api/trust-store/keys              add a key
//   PATCH  /api/trust-store/keys/:keyId       update label only
//   DELETE /api/trust-store/keys/:keyId       remove (or 2-step under public-sector)
//   DELETE /api/trust-store/keys/:keyId/confirm
//                                             public-sector confirmation step
//
// Why a 2-step delete under public-sector posture:
//
//   The trust store is the root of the launcher's signature gate.
//   Deleting the only trusted key in public-sector mode means the next
//   install fails — and an attacker who pivoted to a low-privilege
//   delete capability could bait the operator into a single click that
//   blocks legitimate updates. Public-sector posture forces an explicit
//   confirmation token round trip (default TTL 5 min) so an accidental
//   click can't take effect. Standard posture skips the gate.
//
// Why GET is unauthenticated by the route layer:
//
//   Public keys are NOT secret. The token gate at the global middleware
//   layer (auth.js requireToken) is what protects the endpoint from
//   web-page requests; once a request is past that gate, listing the
//   keys is fine. We do NOT echo the requireCoverage hint or any
//   "extra metadata" — only the public key shape that operators see in
//   the UI.
//
// Audit verbs (frozen):
//
//   trust_store_key_added         — runtime emits on successful add
//   trust_store_key_updated       — runtime emits on successful update
//   trust_store_key_removed       — runtime emits on successful remove
//   trust_store_private_key_rejected — defense-in-depth, runtime emits
//   trust_store_delete_requested  — public-sector first-step (this layer)
//   trust_store_delete_confirmed  — public-sector second-step
//
//   The two delete-related verbs (requested + confirmed) are emitted
//   by THIS file, not the runtime — they're route-layer concerns
//   (the storage layer doesn't care that posture demands two clicks).

"use strict";

const express = require("express");
const crypto = require("node:crypto");

const TRUST_STORE_ERROR_CODES = require("../runtime/trustStore").TRUST_STORE_ERROR_CODES;
const { _detectPrivateKeyMarkers } = require("../runtime/trustStore");

// Frozen so the route audit vocabulary is greppable + stable. Mirrors
// the runtime verbs the storage layer emits.
const ROUTE_AUDIT_VERBS = Object.freeze({
  delete_requested: "trust_store_delete_requested",
  delete_confirmed: "trust_store_delete_confirmed",
});

// Confirmation tokens live in process memory keyed by token. We don't
// persist them — a server restart invalidates pending confirmations,
// which matches the "explicit step in the same operator session"
// intent. A 5-minute TTL is short enough that a confirm token can't
// linger long enough to be replayed by a stale tab.
const CONFIRM_TTL_MS = 5 * 60 * 1000;

function _writeError(res, status, code, extra = null) {
  const body = { ok: false, error: code };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return res.status(status).json(body);
}

// Map runtime error codes to (HTTP status, response shape). The route
// layer NEVER strips err.code so the operator UI can branch by code
// without parsing message text.
function _writeStoreError(res, err) {
  const code = (err && err.code) || "internal";
  switch (code) {
    case TRUST_STORE_ERROR_CODES.invalid_input:
      return _writeError(res, 400, code, { message: err.message });
    case TRUST_STORE_ERROR_CODES.invalid_public_key:
      return _writeError(res, 400, code, { message: err.message });
    case TRUST_STORE_ERROR_CODES.private_key_rejected:
      return _writeError(res, 400, code, {
        message: err.message,
        marker: err.marker || null,
      });
    case TRUST_STORE_ERROR_CODES.duplicate_key_id:
      return _writeError(res, 409, code, {
        message: err.message,
        keyId: err.keyId || null,
      });
    case TRUST_STORE_ERROR_CODES.key_not_found:
      return _writeError(res, 404, code, {
        message: err.message,
        keyId: err.keyId || null,
      });
    case TRUST_STORE_ERROR_CODES.trust_file_invalid:
      return _writeError(res, 500, code, { message: err.message });
    case TRUST_STORE_ERROR_CODES.store_unwritable:
      return _writeError(res, 500, code, { message: err.message });
    default:
      return _writeError(res, 500, "internal", { message: err && err.message });
  }
}

function _publicKeyShape(k) {
  if (!k) return null;
  return {
    keyId: k.keyId,
    publicKeyDerBase64: k.publicKeyDerBase64,
    label: k.label || null,
    addedAt: k.addedAt || null,
  };
}

function _newConfirmToken() {
  // 32 hex chars = 128 bits — plenty for one-shot anti-fat-finger
  // confirmation. We don't use a JWT or HMAC because the token is
  // single-use + short-lived + process-scoped; complexity buys nothing.
  return crypto.randomBytes(16).toString("hex");
}

/**
 * @param {object} opts
 * @param {object} opts.trustStore        - createTrustStore() handle
 * @param {function} [opts.audit]         - audit emitter; receives (verb, data)
 * @param {object}   [opts.deploymentProfile] - resolveDeploymentProfile() result;
 *                                           when publicSector: 2-step delete enforced
 * @param {function} [opts.now]           - clock injection (test default)
 * @param {number}   [opts.confirmTtlMs]  - override TTL (test default)
 */
function createTrustStoreRoutes(opts = {}) {
  const router = express.Router();

  if (!opts.trustStore || typeof opts.trustStore.list !== "function") {
    // 503 every call when the store isn't wired. server.js can mount
    // unconditionally; the UI surfaces the 503 cleanly as "trust store
    // unavailable" rather than a confusing 404.
    router.use((_req, res) => _writeError(res, 503, "trust_store_not_wired"));
    return router;
  }
  const trustStore = opts.trustStore;
  const audit = typeof opts.audit === "function" ? opts.audit : () => {};
  const deploymentProfile = opts.deploymentProfile || null;
  const publicSector = !!(deploymentProfile && deploymentProfile.publicSector);
  const now = opts.now || (() => Date.now());
  const confirmTtlMs = typeof opts.confirmTtlMs === "number" && opts.confirmTtlMs > 0
    ? opts.confirmTtlMs : CONFIRM_TTL_MS;

  // In-process map: token → { keyId, expiresAt }. Garbage-collected
  // on read (every confirm + every issue) — never grows unbounded.
  const _pendingConfirms = new Map();

  function _gcConfirms() {
    const t = now();
    for (const [tok, rec] of _pendingConfirms.entries()) {
      if (rec.expiresAt <= t) _pendingConfirms.delete(tok);
    }
  }

  function _safeAudit(verb, data) {
    try { audit(verb, data); }
    catch (_) { /* never break the route on audit faults */ }
  }

  // ── GET /api/trust-store ─────────────────────────────────────
  router.get("/trust-store", (req, res) => {
    let keys;
    try { keys = trustStore.list(); }
    catch (err) { return _writeStoreError(res, err); }
    return res.json({
      ok: true,
      keys: keys.map(_publicKeyShape),
      posture: publicSector ? "public-sector" : "standard",
      // Operator UI surfaces a banner when public-sector + 0 keys.
      requireSignedManifest: publicSector,
      keyCount: keys.length,
    });
  });

  // ── POST /api/trust-store/keys ───────────────────────────────
  router.post("/trust-store/keys", express.json({ limit: "32kb" }), (req, res) => {
    const body = req.body || {};
    // Defense-in-depth pre-check: scan the entire request body for
    // PEM private-key markers BEFORE delegating to the store.add.
    // We re-detect on the raw body so a curl operator can't slip a
    // private key in via a non-standard field name.
    try {
      const bodyText = JSON.stringify(body);
      const marker = _detectPrivateKeyMarkers(bodyText);
      if (marker) {
        _safeAudit("trust_store_private_key_rejected", { marker, route: "POST /trust-store/keys" });
        return _writeError(res, 400, TRUST_STORE_ERROR_CODES.private_key_rejected, {
          message: `request body contains private-key marker "${marker}"`,
          marker,
        });
      }
    } catch (_) { /* JSON.stringify failure is rare; fall through to store */ }

    let added;
    try {
      added = trustStore.add({
        publicKeyDerBase64: body.publicKeyDerBase64,
        label: body.label,
      });
    } catch (err) { return _writeStoreError(res, err); }
    return res.status(201).json({ ok: true, key: _publicKeyShape(added) });
  });

  // ── PATCH /api/trust-store/keys/:keyId ───────────────────────
  router.patch("/trust-store/keys/:keyId", express.json({ limit: "8kb" }), (req, res) => {
    const keyId = req.params.keyId;
    const body = req.body || {};
    let updated;
    try { updated = trustStore.update(keyId, { label: body.label }); }
    catch (err) { return _writeStoreError(res, err); }
    return res.json({ ok: true, key: _publicKeyShape(updated) });
  });

  // ── DELETE /api/trust-store/keys/:keyId ──────────────────────
  // Standard posture: removes immediately.
  // Public-sector posture: returns 409 + a confirm token; operator must
  // POST to /confirm with the token to actually remove.
  router.delete("/trust-store/keys/:keyId", (req, res) => {
    const keyId = req.params.keyId;
    if (typeof keyId !== "string" || keyId.length === 0) {
      return _writeError(res, 400, TRUST_STORE_ERROR_CODES.invalid_input, {
        message: "keyId required",
      });
    }
    // Verify the key actually exists before issuing a confirm token —
    // surfaces 404 immediately rather than baiting the operator
    // through a confirmation flow that ends in not-found.
    let existing;
    try { existing = trustStore.get(keyId); }
    catch (err) { return _writeStoreError(res, err); }
    if (!existing) {
      return _writeError(res, 404, TRUST_STORE_ERROR_CODES.key_not_found, {
        message: `keyId ${keyId} not in trust store`,
        keyId,
      });
    }

    if (publicSector) {
      _gcConfirms();
      const token = _newConfirmToken();
      const expiresAt = now() + confirmTtlMs;
      _pendingConfirms.set(token, { keyId, expiresAt });
      _safeAudit(ROUTE_AUDIT_VERBS.delete_requested, {
        keyId,
        confirmTtlMs,
        posture: "public-sector",
      });
      return res.status(409).json({
        ok: false,
        error: "confirm_required",
        message:
          "공공기관 모드에서 신뢰 저장소 키 삭제는 2단계 확인이 필요합니다. " +
          "이 토큰으로 /api/trust-store/keys/" + encodeURIComponent(keyId) +
          "/confirm 에 POST 하세요.",
        confirmToken: token,
        confirmTtlMs,
        keyId,
      });
    }

    // Standard posture — direct delete.
    let removed;
    try { removed = trustStore.remove(keyId); }
    catch (err) { return _writeStoreError(res, err); }
    if (!removed) {
      // Race: key disappeared between get() and remove(). Surface as
      // 404 — operator sees consistent "not found" rather than a
      // misleading 500.
      return _writeError(res, 404, TRUST_STORE_ERROR_CODES.key_not_found, {
        message: `keyId ${keyId} not in trust store`,
        keyId,
      });
    }
    return res.json({ ok: true, removed: keyId });
  });

  // ── POST /api/trust-store/keys/:keyId/confirm ───────────────
  // Public-sector second step. The body must include the confirmToken
  // returned by the first DELETE call. Standard mode rejects with 405
  // since the confirm flow is public-sector-only.
  router.post(
    "/trust-store/keys/:keyId/confirm",
    express.json({ limit: "8kb" }),
    (req, res) => {
      const keyId = req.params.keyId;
      const body = req.body || {};
      if (!publicSector) {
        return _writeError(res, 405, "confirm_not_required", {
          message: "/confirm is only used under public-sector posture",
        });
      }
      const token = body.confirmToken;
      if (typeof token !== "string" || token.length === 0) {
        return _writeError(res, 400, "confirm_token_missing", {
          message: "confirmToken required in body",
        });
      }
      _gcConfirms();
      const rec = _pendingConfirms.get(token);
      if (!rec) {
        return _writeError(res, 400, "confirm_token_invalid", {
          message: "confirmToken not recognized or expired",
        });
      }
      if (rec.keyId !== keyId) {
        // Token was for a different key — defense against operator
        // pasting wrong token. Reject loudly + invalidate the token.
        _pendingConfirms.delete(token);
        return _writeError(res, 400, "confirm_token_mismatch", {
          message: "confirmToken does not match this keyId",
        });
      }
      if (rec.expiresAt <= now()) {
        _pendingConfirms.delete(token);
        return _writeError(res, 400, "confirm_token_expired", {
          message: "confirmToken expired",
        });
      }
      // One-shot — burn the token regardless of whether the delete
      // succeeds. Prevents replay if the actual delete throws.
      _pendingConfirms.delete(token);
      let removed;
      try { removed = trustStore.remove(keyId); }
      catch (err) { return _writeStoreError(res, err); }
      if (!removed) {
        return _writeError(res, 404, TRUST_STORE_ERROR_CODES.key_not_found, {
          message: `keyId ${keyId} not in trust store`, keyId,
        });
      }
      _safeAudit(ROUTE_AUDIT_VERBS.delete_confirmed, {
        keyId,
        posture: "public-sector",
      });
      return res.json({ ok: true, removed: keyId });
    },
  );

  return router;
}

module.exports = {
  createTrustStoreRoutes,
  ROUTE_AUDIT_VERBS,
  CONFIRM_TTL_MS,
};
