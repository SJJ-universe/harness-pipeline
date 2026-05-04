// Slice SMART-0-b (Phase D Round UI-P / Phase 2 SMART arc, 2026-05-04)
// — HTTP exposure of the decision-context snapshot.
//
// Single endpoint:
//   GET /api/decision-context
//     → 200 {schema, timestamp, booleans, counts, posture, sources}
//
// The route reads from server-side singletons (approvalManager /
// reviewSessionManager / runRegistry / deploymentProfile /
// evidenceLedger / profileStore / runnerRegistry) and builds a
// fresh snapshot per request. Frequency: legacy-bridge polls
// every 5s (SMART-0-c), CI scrapers can hit it on demand.
//
// hasPii is a header signal (`x-harness-has-pii: 1`) not a body
// param — the route doesn't do PII scanning itself; if the panel
// has a recent piiScanner verdict it can pass it via the header.
// Default is hasPii=false.
//
// Loopback-only (relies on the existing global x-harness-token gate
// in server.js for state-changing routes — this is a read-only route
// so the token gate doesn't apply, but loopback binding still does).

"use strict";

const { Router } = require("express");
const { buildContext } = require("../runtime/decisionContext");

function createDecisionContextRoutes({
  approvalManager = null,
  reviewSessionManager = null,
  runRegistry = null,
  deploymentProfile = null,
  evidenceLedger = null,
  profileStore = null,
  runnerRegistry = null,
} = {}) {
  const router = Router();

  // Adapter for runRegistry — server-side runRegistry exposes
  // .list() returning Run records. Some legacy paths might use
  // .listAll() instead — adapt to a uniform shape here.
  const runRegistryAdapter = runRegistry
    ? {
        list: function () {
          if (typeof runRegistry.list === "function") return runRegistry.list();
          if (typeof runRegistry.listAll === "function") return runRegistry.listAll();
          return [];
        },
      }
    : null;

  // Adapter for runnerRegistry → snapshot() returning runner array.
  // Each entry ideally has {hostIdentity, healthy} or {hostIdentity, online}.
  const runnerAdapter = runnerRegistry
    ? {
        snapshot: function () {
          if (typeof runnerRegistry.snapshot === "function") return runnerRegistry.snapshot();
          if (typeof runnerRegistry.list === "function") return runnerRegistry.list();
          return [];
        },
      }
    : null;

  // Adapter for evidenceLedger — count() preferred; size() fallback.
  const evidenceAdapter = evidenceLedger
    ? {
        count: function () {
          if (typeof evidenceLedger.count === "function") return evidenceLedger.count();
          if (typeof evidenceLedger.size === "function") return evidenceLedger.size();
          return 0;
        },
      }
    : null;

  router.get("/decision-context", function (req, res) {
    const hasPii = req.header("x-harness-has-pii") === "1";
    let snapshot;
    try {
      snapshot = buildContext({
        approvalManager,
        reviewSessionManager,
        runRegistry: runRegistryAdapter,
        deploymentProfile,
        evidenceLedger: evidenceAdapter,
        profileStore,
        remoteRunner: runnerAdapter,
      }, { hasPii });
    } catch (err) {
      // buildContext() is pure + can't throw under normal conditions
      // (per-adapter try/catch). If it does — fail open with a 500
      // and log the cause. Should never happen in practice.
      return res.status(500).json({
        error: "decision_context_failed",
        message: String(err && err.message ? err.message : err).slice(0, 200),
      });
    }
    res.json(snapshot);
  });

  return router;
}

module.exports = { createDecisionContextRoutes };
