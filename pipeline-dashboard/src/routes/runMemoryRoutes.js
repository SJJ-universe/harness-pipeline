// Slice S4-b (Phase 2 / SMART-4, 2026-05-05) — run-memory read API.
//
// Endpoint:
//
//   GET /api/runs/:runId/memory
//     No body. Returns { ok, runId, memory: <record>|null, recordedAt }.
//     - 404 when the runId has no run_memory_recorded entry yet
//     - 400 when runId is malformed
//     - 503 when the ledger is unavailable
//     - The `memory` field is the FROZEN record (same shape S4-a's
//       buildRunMemoryRecord returns). Already redacted under public-
//       sector posture (the recorder did the redact at write time);
//       this endpoint is a pure read.
//
// Auth contract (state-machine identical to /api/audit/runs/:runId):
//   - Loopback only (covered by global X-Orchestrator-Token middleware
//     in server.js — same gate every other state-altering endpoint
//     uses; we don't re-check here)
//   - run_memory_accessed audit verb fires on every successful read
//     (and on 404, so a forensic auditor can see "operator X tried
//     to read memory for run Y at time Z" even when nothing was
//     there). Does NOT fire on 400 (malformed input — operator UI
//     bug, not a forensic event).
//   - Public-sector posture is the operator's responsibility to
//     enforce via deployment env (ORCHESTRATOR_DEPLOYMENT_PROFILE=
//     public-sector + their loopback proxy). The route doesn't
//     re-check posture because the ROUTE itself is loopback-only.
//
// Why audit even on 404:
//   Plan §S §S-SMART-4 v2 specifies the audit verb as observability
//   for "who looked at what memory". A 404 is still a read attempt
//   that happened — operators tracking memory access don't want a
//   404 to silently disappear from the audit chain.
//
// What this does NOT do:
//   - No write surface (recordRunMemory lives inside the executor,
//     fired on pipeline_complete via S4-c)
//   - No memory listing across runs (that would risk listing PII
//     across operator sessions in public-sector)
//   - No deletion (TTL is the cleanup mechanism; manual delete is
//     out of scope for SMART-4)

"use strict";

const express = require("express");

const runMemory = require("../runtime/runMemory");

const RUN_ID_MAX_LENGTH = 128;

const ROUTE_ERROR_CODES = Object.freeze({
  invalid_run_id: "invalid_run_id",
  not_found: "not_found",
  ledger_unavailable: "ledger_unavailable",
});

function _validateRunId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > RUN_ID_MAX_LENGTH) return null;
  // Same character set as auditRoutes — keeps the audit chain's
  // ledger path bounded.
  if (!/^[A-Za-z0-9_\-:.]+$/.test(trimmed)) return null;
  return trimmed;
}

function _writeError(res, status, code, extra = null) {
  const body = { ok: false, error: code };
  if (extra && typeof extra === "object") Object.assign(body, extra);
  return res.status(status).json(body);
}

function _safeAudit(auditFn, verb, data) {
  if (typeof auditFn !== "function") return;
  try {
    auditFn(verb, data);
  } catch (_) {
    // Audit emit must NEVER break the route. Plan §S §S-SMART-2
    // baked this invariant; SMART-4 carries it forward.
  }
}

/**
 * @param {object} deps
 * @param {object} deps.evidenceLedger - must have .read(runId)
 * @param {function} [deps.auditFn]    - bound evidenceLedger.append
 *   for run_memory_accessed emission. Optional — when missing, audit
 *   trail is dropped but read still works.
 * @returns {express.Router}
 */
function createRunMemoryRoutes({ evidenceLedger, auditFn } = {}) {
  if (!evidenceLedger || typeof evidenceLedger.read !== "function") {
    // Stub router — every call 503s. Mirrors auditRoutes.js pattern.
    const router = express.Router();
    router.use((req, res) =>
      _writeError(res, 503, ROUTE_ERROR_CODES.ledger_unavailable));
    return router;
  }

  const router = express.Router();

  router.get("/runs/:runId/memory", (req, res) => {
    const runId = _validateRunId(req.params.runId);
    if (!runId) {
      return _writeError(res, 400, ROUTE_ERROR_CODES.invalid_run_id);
    }

    // Probe ledger health BEFORE calling getRunMemory. getRunMemory
    // is defensive (swallows throws → null) so the operator UI gets
    // a unified "no record" signal — but the route layer wants to
    // distinguish "ledger broken" (503) from "no record yet" (404).
    // Calling ledger.read directly with our own try/catch surfaces
    // the broken-ledger case as a 503 + audit row.
    let entries;
    try {
      entries = evidenceLedger.read(runId);
    } catch (_err) {
      _safeAudit(auditFn, runMemory.AUDIT_VERBS.ACCESSED, {
        runId, found: false, error: "ledger_read_failed",
      });
      return _writeError(res, 503, ROUTE_ERROR_CODES.ledger_unavailable);
    }

    // Walk backwards for the latest run_memory_recorded entry. We
    // could call getRunMemory(runId, evidenceLedger) here, but
    // we already have `entries` in memory — re-using avoids a
    // second read.
    let memory = null;
    if (Array.isArray(entries)) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e && e.type === runMemory.AUDIT_VERBS.RECORDED && e.data) {
          memory = e.data;
          break;
        }
      }
    }

    if (!memory) {
      // 404 still emits audit — operators tracking memory access
      // don't want a missing read to silently disappear.
      _safeAudit(auditFn, runMemory.AUDIT_VERBS.ACCESSED, {
        runId, found: false,
      });
      return _writeError(res, 404, ROUTE_ERROR_CODES.not_found, { runId });
    }

    _safeAudit(auditFn, runMemory.AUDIT_VERBS.ACCESSED, {
      runId, found: true,
      // Compact metadata — the FULL record is on the wire to the
      // operator's UI, but we don't echo all fields back into the
      // audit chain (that would amplify storage AND mean a future
      // ledger-cleanup TTL would erase the access record's context).
      recordedAt: memory.recordedAt,
      truncated: !!memory.truncated,
      redacted: !!memory.redacted,
    });

    return res.json({
      ok: true,
      runId,
      memory,
      recordedAt: memory.recordedAt,
    });
  });

  return router;
}

module.exports = {
  createRunMemoryRoutes,
  ROUTE_ERROR_CODES,
  _validateRunId,
};
