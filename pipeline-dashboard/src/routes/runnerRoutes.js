// Slice R1-d (Phase D R1, 2026-04-28) — runner ingress routes.
//
// Implements the HTTP side of MG1 §8.1's three-step handshake:
//
//   POST /api/runner/handshake   — bootstrap → runnerToken
//   POST /api/runner/heartbeat   — runnerToken refresh
//   POST /api/runner/hook        — runJWT-authenticated one-shot hook
//                                   (WS partition recovery; primary is
//                                    /api/runner/events in R1-e)
//
// Auth taxonomy (matches RunnerRegistry):
//
//   /handshake   reads Authorization: Bearer <bootstrap>
//                bootstrap is matched via constant-time compare against
//                ORCHESTRATOR_REMOTE_RUNNER_TOKEN_<host> (env or test override).
//                On success returns { runnerToken } in the response body.
//
//   /heartbeat   reads Authorization: Bearer <runnerToken>
//                runnerToken matched via timing-safe-equal against the
//                in-memory mapping; sliding 24h TTL refreshes on each
//                successful call.
//
//   /hook        reads Authorization: Bearer <runJWT>
//                JWT verified via src/security/jwt.js. exp / aud / sub
//                checks all enforced. The body is forwarded as-is to
//                the hook router (same path as a local hook).
//
// FEATURE FLAG (MG1 §3.3):
//
//   Routes 404 when ORCHESTRATOR_REMOTE_MODE === "off" (or not set).
//   "preview" is the R1 default; "on" is reserved for R2+.
//   The flag is read once at construction; restart to flip it.

const { Router } = require("express");
const jwt = require("../security/jwt");

function _parseBearer(req) {
  const h = req.get("Authorization");
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/);
  return m ? m[1].trim() : null;
}

/**
 * createRunnerRoutes({ runnerRegistry, jwtKey, mode, ledger?, hookRouter? })
 *
 *   runnerRegistry  — required. The RunnerRegistry instance.
 *   jwtKey          — required for /hook. Buffer/string. The HKDF-derived
 *                     JWT signing key (info="runner-jwt").
 *   mode            — "off" | "preview" | "on" (default "off"). When "off"
 *                     all routes 404.
 *   ledger          — optional EvidenceLedger. When provided, the routes
 *                     append audit entries on every auth result (success
 *                     or failure). Without it the routes still work but
 *                     no ledger trail is written.
 *   hookRouter      — optional. When provided, /hook delegates to its
 *                     `routeRemote(runId, payload)` method. Without it,
 *                     /hook returns 200 with `{ ok: true, queued: true }`
 *                     and the body is dropped (R1-d stub; R1-h wires it).
 */
function createRunnerRoutes({
  runnerRegistry = null,
  jwtKey = null,
  mode = "off",
  ledger = null,
  hookRouter = null,
} = {}) {
  const router = Router();

  const isEnabled = mode === "preview" || mode === "on";

  // When disabled: every route 404s. The handlers below are still
  // declared so the route table is valid and tests can detect the gate.
  function _gate(req, res, next) {
    if (!isEnabled) {
      return res.status(404).json({ error: "remote mode disabled", mode });
    }
    if (!runnerRegistry) {
      return res.status(503).json({ error: "runner registry not wired" });
    }
    return next();
  }

  function _ledgerAudit(runId, type, data) {
    if (!ledger || typeof ledger.append !== "function") return;
    try { ledger.append(runId || "system", { type, data }); }
    catch (_) { /* ledger failure must not break the route */ }
  }

  // ── POST /api/runner/handshake ──────────────────────────────────

  router.post("/runner/handshake", _gate, (req, res) => {
    const bootstrap = _parseBearer(req);
    const body = req.body || {};
    const hostIdentity = typeof body.hostIdentity === "string" ? body.hostIdentity : null;
    if (!bootstrap || !hostIdentity) {
      _ledgerAudit("system", "runner_handshake_rejected", {
        reason: !bootstrap ? "auth_missing" : "host_missing",
      });
      return res.status(400).json({ error: "hostIdentity + bootstrap required" });
    }
    const result = runnerRegistry.handshake({
      hostIdentity,
      bootstrapToken: bootstrap,
      capabilities: body.capabilities,
      sandboxClass: body.sandboxClass,
    });
    if (!result.ok) {
      // Slice R3-c-1 (Phase D R3, 2026-04-28): split the audit event
      // by reason so true collisions surface separately. R3-G06.
      //
      //   host_in_use            existing host is fresh + bootstrap
      //                          reused → collision attempt. Emit
      //                          `runner_handshake_collision` so an
      //                          operator can grep the chain for
      //                          "someone tried to claim a hostIdentity
      //                          that's already in use" without
      //                          confusing it with replay-after-stale
      //                          or wrong-bootstrap noise.
      //   everything else        emit the established
      //                          `runner_handshake_rejected` event so
      //                          existing R1/R2 audit consumers stay
      //                          intact (no shape change for already-
      //                          green tests).
      const auditType = result.reason === "host_in_use"
        ? "runner_handshake_collision"
        : "runner_handshake_rejected";
      _ledgerAudit("system", auditType, {
        hostIdentity,
        reason: result.reason,
      });
      return res.status(401).json({ error: "handshake rejected", reason: result.reason });
    }
    _ledgerAudit("system", "runner_handshake_ok", { hostIdentity });
    return res.json({ runnerToken: result.runnerToken });
  });

  // ── POST /api/runner/heartbeat ──────────────────────────────────

  router.post("/runner/heartbeat", _gate, (req, res) => {
    const runnerToken = _parseBearer(req);
    const body = req.body || {};
    const hostIdentity = typeof body.hostIdentity === "string" ? body.hostIdentity : null;
    if (!runnerToken || !hostIdentity) {
      return res.status(400).json({ error: "hostIdentity + runnerToken required" });
    }
    const result = runnerRegistry.heartbeat({ hostIdentity, runnerToken });
    if (!result.ok) {
      _ledgerAudit("system", "runner_heartbeat_rejected", {
        hostIdentity,
        reason: result.reason,
      });
      return res.status(401).json({ error: "heartbeat rejected", reason: result.reason });
    }
    return res.json({ ok: true });
  });

  // ── POST /api/runner/hook ──────────────────────────────────────

  router.post("/runner/hook", _gate, (req, res) => {
    if (!jwtKey) {
      return res.status(503).json({ error: "jwt key not wired" });
    }
    const token = _parseBearer(req);
    const body = req.body || {};
    const runId = typeof body.runId === "string" ? body.runId : null;
    if (!token || !runId) {
      return res.status(400).json({ error: "runId + JWT required" });
    }
    const result = jwt.verify({ token, runId, key: jwtKey });
    if (!result.ok) {
      _ledgerAudit(runId, "runner_hook_rejected", { reason: result.reason });
      return res.status(401).json({ error: "JWT rejected", reason: result.reason });
    }
    if (hookRouter && typeof hookRouter.routeRemote === "function") {
      try {
        hookRouter.routeRemote(runId, body.event || body);
      } catch (err) {
        _ledgerAudit(runId, "runner_hook_route_error", { error: err.message });
        return res.status(500).json({ error: "hook routing failed" });
      }
    }
    _ledgerAudit(runId, "runner_hook_ok", { hostIdentity: result.payload.orchestrator && result.payload.orchestrator.hostIdentity });
    return res.json({ ok: true, accepted: true });
  });

  return router;
}

module.exports = { createRunnerRoutes };
