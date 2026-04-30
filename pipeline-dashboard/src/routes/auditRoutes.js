// Slice UI-H9-a (Phase D / Phase E1.5, 2026-04-30) — audit read API.
//
// Operator-facing read-only HTTP for evidence-ledger inspection.
// The drill-down view (UI-H9-b/c) needs to surface what the harness
// audited for a particular run; the existing read API was internal-only
// (`evidenceLedger.read(runId)`) so we expose it under /api/audit.
//
// Endpoints:
//
//   GET /api/audit/runs/:runId
//     No body. Returns { runId, entries: [...], chain: {valid, ...} }.
//     - entries: at most DEFAULT_LIMIT (256) most-recent entries; a
//       `?limit=N` query param can shrink this further. Older-than-limit
//       entries are truncated and `truncated: true` is set on the
//       response so the UI can show "earlier rows hidden".
//     - chain: result of evidenceLedger.verifyChain(runId). The full
//       chain (not just the limited slice) is verified — operator UI
//       gets a single boolean for "tampered or not?" plus the broken
//       index when it fails.
//     - 404 when the runId has no ledger file (no audit yet → empty).
//
//   GET /api/audit/runs/:runId/verify
//     No body. Lighter call: just runs verifyChain. Useful for the
//     auditor card that just wants a green/red dot. Returns
//     { runId, valid, entries, ... }.
//
// What this does NOT do:
//   - No filtering by event-type. The drill-down UI does that
//     client-side because the data set is small (256 entries cap).
//   - No write surface. Append-only is the ledger's job; this module
//     is read-only and does not import any mutating method.
//   - No PII redaction beyond what append() already does. The
//     evidenceLedger sanitizer redacts before write, so what comes
//     back is already redacted.
//   - No CSV / JSON-bundle export. That's GOV-AUDIT-0 (next round).
//     This route ships only the read surface UI-H9 needs.

"use strict";

const express = require("express");

const DEFAULT_LIMIT = 256;
const MAX_LIMIT = 1024;
const RUN_ID_MAX_LENGTH = 128;

// Frozen so a future caller can't mutate the error vocabulary.
const AUDIT_ERROR_CODES = Object.freeze({
  invalid_run_id: "invalid_run_id",
  not_found: "not_found",
  ledger_unavailable: "ledger_unavailable",
});

function _writeError(res, status, code, extra = null) {
  const body = { ok: false, error: code };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return res.status(status).json(body);
}

function _validateRunId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > RUN_ID_MAX_LENGTH) return null;
  // No path traversal — the ledger path uses runId directly. Allow
  // hyphen / underscore / slash-free word chars only. The ledger
  // also rejects but defending here keeps malformed IDs out of the
  // 404 path entirely.
  if (!/^[A-Za-z0-9_\-:.]+$/.test(trimmed)) return null;
  return trimmed;
}

function _parseLimit(raw) {
  if (raw == null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

function createAuditRoutes({ evidenceLedger } = {}) {
  if (!evidenceLedger || typeof evidenceLedger.read !== "function" || typeof evidenceLedger.verifyChain !== "function") {
    // Don't fail boot — return a stub router that 503s every call.
    // This preserves the rest of the harness if a future refactor
    // accidentally drops the ledger. The drill-down panel surfaces
    // the 503 cleanly and falls back to "audit unavailable" copy.
    const router = express.Router();
    router.use((req, res) => _writeError(res, 503, AUDIT_ERROR_CODES.ledger_unavailable));
    return router;
  }

  const router = express.Router();

  // ── GET /api/audit/runs/:runId ─────────────────────────────────

  router.get("/audit/runs/:runId", (req, res) => {
    const runId = _validateRunId(req.params.runId);
    if (!runId) return _writeError(res, 400, AUDIT_ERROR_CODES.invalid_run_id);

    let entries;
    try {
      entries = evidenceLedger.read(runId);
    } catch (_err) {
      return _writeError(res, 503, AUDIT_ERROR_CODES.ledger_unavailable);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return _writeError(res, 404, AUDIT_ERROR_CODES.not_found, { runId });
    }

    const limit = _parseLimit(req.query.limit);
    const truncated = entries.length > limit;
    // Slice from the END so the operator sees the most-recent rows.
    const sliced = truncated ? entries.slice(entries.length - limit) : entries;

    let chain;
    try {
      chain = evidenceLedger.verifyChain(runId);
    } catch (_err) {
      chain = { valid: false, error: "verify_threw" };
    }

    return res.json({
      ok: true,
      runId,
      total: entries.length,
      returned: sliced.length,
      truncated,
      limit,
      chain,
      entries: sliced,
    });
  });

  // ── GET /api/audit/runs/:runId/verify ──────────────────────────

  router.get("/audit/runs/:runId/verify", (req, res) => {
    const runId = _validateRunId(req.params.runId);
    if (!runId) return _writeError(res, 400, AUDIT_ERROR_CODES.invalid_run_id);

    let result;
    try {
      result = evidenceLedger.verifyChain(runId);
    } catch (_err) {
      return _writeError(res, 503, AUDIT_ERROR_CODES.ledger_unavailable);
    }

    if (!result || (result.entries === 0 && result.valid !== false)) {
      return _writeError(res, 404, AUDIT_ERROR_CODES.not_found, { runId });
    }

    return res.json({ ok: true, runId, ...result });
  });

  return router;
}

module.exports = {
  createAuditRoutes,
  AUDIT_ERROR_CODES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  _validateRunId,
  _parseLimit,
};
