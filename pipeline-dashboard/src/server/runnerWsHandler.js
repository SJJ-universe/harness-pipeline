// Slice R1-e-2 (Phase D R1, 2026-04-28) — runner WS connection lifecycle.
//
// Transport-only handler for the R1-e round. Its job is:
//
//   1. Acknowledge the upgrade (send a `hello` frame so the runner knows
//      the orchestrator accepted the JWT).
//   2. Emit ledger entries on every state transition (`runner_ws_connected`,
//      `runner_ws_disconnected`, `runner_ws_error`) so a forensic audit can
//      reconstruct the channel timeline.
//   3. Track message counts as a coarse health signal.
//
// What it does NOT do (intentionally — those are R1-g):
//
//   - Parse incoming WS frames as hook events. R1-g wires this into the
//     `hookRouter.routeRemote(runId, payload)` call path.
//   - Project agent lifecycle into `childRegistry`. R1-g is the slice that
//     decides the on-the-wire schema for `agent_started` / `agent_stopped`
//     and how those map into the registry's snapshot.
//   - Fan-out remote events into the dashboard's broadcast channel. That
//     also depends on the R1-g schema.
//
// Keeping R1-e transport-only means the runner agent can be exercised end-
// to-end (handshake → heartbeat → WS connect → hello frame → keepalive)
// before any business semantics land. This is the "transport-first" review
// recommendation captured in plan Part J's `J-out-of-scope` table.

const HELLO_TYPE = "hello";

function _ledgerAudit(ledger, runId, type, data) {
  if (!ledger || typeof ledger.append !== "function") return;
  try { ledger.append(runId || "system", { type, data }); }
  catch (_) { /* ledger failure must not break the handler */ }
}

/**
 * @param {object} [opts]
 * @param {EvidenceLedger} [opts.ledger]   Optional. Audit entries are
 *   appended on connect/disconnect/error. When absent the handler
 *   still works — entries are just dropped.
 * @param {function} [opts.now=Date.now]   Override clock (tests).
 * @returns {function(ws, req, verdict)}   The connection callback.
 */
function createRunnerWsHandler({ ledger = null, now } = {}) {
  const clock = typeof now === "function" ? now : Date.now;

  return function handleRunnerWsConnection(ws, req, verdict) {
    const runId = verdict && typeof verdict.runId === "string" ? verdict.runId : null;
    const hostIdentity = verdict && typeof verdict.hostIdentity === "string" ? verdict.hostIdentity : null;
    const runOrigin = verdict && typeof verdict.runOrigin === "string" ? verdict.runOrigin : null;
    const sandboxClass = verdict && typeof verdict.sandboxClass === "string" ? verdict.sandboxClass : null;

    _ledgerAudit(ledger, runId, "runner_ws_connected", {
      hostIdentity, runOrigin, sandboxClass,
    });

    // Hello frame — confirms the JWT was accepted and the channel is live.
    // The runner uses this as its readiness signal before sending any
    // business messages (R1-g).
    try {
      ws.send(JSON.stringify({ type: HELLO_TYPE, runId, ts: clock() }));
    } catch (_) {
      // ws.send can throw on a half-closed socket — let the close handler
      // record the disconnect. Don't crash the orchestrator's WS server.
    }

    let messagesReceived = 0;
    ws.on("message", () => {
      messagesReceived += 1;
      // R1-g: parse + route to hookRouter.routeRemote(runId, payload).
      // For R1-e we drop the body but track the count for the close audit.
    });

    ws.on("close", (code, reasonBuf) => {
      _ledgerAudit(ledger, runId, "runner_ws_disconnected", {
        hostIdentity,
        code: typeof code === "number" ? code : null,
        reason: reasonBuf ? String(reasonBuf) : "",
        messagesReceived,
      });
    });

    ws.on("error", (err) => {
      _ledgerAudit(ledger, runId, "runner_ws_error", {
        hostIdentity,
        error: err && err.message ? err.message : String(err),
      });
    });
  };
}

module.exports = { createRunnerWsHandler, HELLO_TYPE };
