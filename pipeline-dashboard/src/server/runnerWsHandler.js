// Slice R1-e-2 (Phase D R1, 2026-04-28) — runner WS connection lifecycle.
// Slice R1-g  (Phase D R1, 2026-04-28) — message routing + child projection.
// Slice R1-k1 (Phase D R1, 2026-04-28) — agent_stopped + close auto-cleanup
//   call unregisterRemote with the {id, runId, hostIdentity} triple.
//   runId + hostIdentity come from the JWT verdict, so a runner cannot
//   smuggle a stop frame for another run's child id.
//
// The handler's job:
//
//   1. Acknowledge the upgrade (send a `hello` frame so the runner knows
//      the orchestrator accepted the JWT).
//   2. Emit ledger entries on every state transition (`runner_ws_connected`,
//      `runner_ws_disconnected`, `runner_ws_error`) so a forensic audit can
//      reconstruct the channel timeline.
//   3. Track message counts as a coarse health signal.
//   4. (R1-g) Parse incoming frames + dispatch to childRegistry / hookRouter:
//        { type: "agent_started", id, label, agentType }
//          → childRegistry.registerRemote({ id, label, runId, hostIdentity, agentType })
//        { type: "agent_stopped", id }
//          → childRegistry.unregisterRemote({ id, runId, hostIdentity })  (R1-k1)
//        { type: "hook", event }
//          → hookRouter.routeRemote(runId, event)
//      Unknown / malformed frames are dropped + counted.
//   5. (R1-g) On WS close, auto-unregister every agent the runner started
//      during this connection. Without this, an unclean disconnect would
//      leak `remote: true` entries into childRegistry forever.
//
// What this slice still doesn't do (deferred):
//
//   - Apply schema validation to the `hook.event` body. routeRemote does
//     defensive copy + broadcast; R2+ adds an allowlist of accepted hook
//     names + tool-arg sanitization.
//   - Stream-back orchestrator-driven control frames. The runner only
//     reads the hello frame today. R2+ adds run-dispatch and shutdown
//     control over the same channel.
//   - Backpressure / flow control. The handler counts messages but does
//     not enforce any rate limit.

const HELLO_TYPE = "hello";

// Frame types the handler recognises. Anything else is dropped.
const FRAME_AGENT_STARTED = "agent_started";
const FRAME_AGENT_STOPPED = "agent_stopped";
const FRAME_HOOK = "hook";

function _ledgerAudit(ledger, runId, type, data) {
  if (!ledger || typeof ledger.append !== "function") return;
  try { ledger.append(runId || "system", { type, data }); }
  catch (_) { /* ledger failure must not break the handler */ }
}

/**
 * @param {object} [opts]
 * @param {EvidenceLedger} [opts.ledger]
 *   Optional. Audit entries are appended on connect/disconnect/error +
 *   on every recognised frame.
 * @param {object} [opts.childRegistry]
 *   Optional. R1-g routes `agent_started`/`agent_stopped` frames here.
 *   R1-k1: must implement `registerRemote({id, label, runId, hostIdentity,
 *   agentType})` and `unregisterRemote({id, runId, hostIdentity})`.
 *   When absent the handler accepts the frames but skips the projection.
 * @param {object} [opts.hookRouter]
 *   Optional. R1-g routes `hook` frames here via `routeRemote(runId, event)`.
 * @param {function} [opts.now=Date.now]   Override clock (tests).
 * @returns {function(ws, req, verdict)}   The connection callback.
 */
function createRunnerWsHandler({
  ledger = null,
  childRegistry = null,
  hookRouter = null,
  now,
} = {}) {
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

    // R1-g: track which agent IDs THIS connection started so we can clean
    // them up on disconnect. We never trust agent IDs across connections —
    // a runner reconnecting must re-emit `agent_started` frames.
    const agentsStartedThisConnection = new Set();

    let messagesReceived = 0;
    let messagesDropped = 0;
    let messagesRouted = 0;
    let lastFrameType = null;

    ws.on("message", (raw) => {
      messagesReceived += 1;
      let frame;
      try { frame = JSON.parse(raw.toString()); }
      catch (_) {
        messagesDropped += 1;
        return;
      }
      if (!frame || typeof frame !== "object" || typeof frame.type !== "string") {
        messagesDropped += 1;
        return;
      }
      lastFrameType = frame.type;

      switch (frame.type) {
        case FRAME_AGENT_STARTED: {
          const id = typeof frame.id === "string" ? frame.id : null;
          if (!id) { messagesDropped += 1; break; }
          if (childRegistry && typeof childRegistry.registerRemote === "function") {
            childRegistry.registerRemote({
              id,
              label: typeof frame.label === "string" ? frame.label : null,
              runId,
              hostIdentity,
              agentType: typeof frame.agentType === "string" ? frame.agentType : null,
            });
          }
          agentsStartedThisConnection.add(id);
          messagesRouted += 1;
          _ledgerAudit(ledger, runId, "runner_agent_started", {
            id, hostIdentity,
            label: frame.label || null, agentType: frame.agentType || null,
          });
          break;
        }
        case FRAME_AGENT_STOPPED: {
          const id = typeof frame.id === "string" ? frame.id : null;
          if (!id) { messagesDropped += 1; break; }
          // R1-k1: pass the verdict's runId + hostIdentity. If the runner
          // tries to stop a child registered under a different scope, the
          // registry returns false and nothing happens — the trust
          // boundary is enforced inside the registry, not just here.
          if (childRegistry && typeof childRegistry.unregisterRemote === "function") {
            childRegistry.unregisterRemote({ id, runId, hostIdentity });
          }
          agentsStartedThisConnection.delete(id);
          messagesRouted += 1;
          _ledgerAudit(ledger, runId, "runner_agent_stopped", { id, hostIdentity });
          break;
        }
        case FRAME_HOOK: {
          const event = frame.event && typeof frame.event === "object" ? frame.event : null;
          if (!event) { messagesDropped += 1; break; }
          if (hookRouter && typeof hookRouter.routeRemote === "function") {
            try { hookRouter.routeRemote(runId, event); }
            catch (err) {
              // Don't let a routing failure crash the WS handler.
              _ledgerAudit(ledger, runId, "runner_hook_route_error", {
                error: err && err.message ? err.message : String(err),
              });
            }
          }
          messagesRouted += 1;
          break;
        }
        default:
          messagesDropped += 1;
      }
    });

    ws.on("close", (code, reasonBuf) => {
      // R1-g: auto-cleanup any remote children this connection started
      // but didn't explicitly stop. Without this, a forced WS close (e.g.
      // operator killed the runner host) would leak entries into the
      // registry until orchestrator restart.
      // R1-k1: cleanup uses the same {runId, hostIdentity} tuple the
      // start frame used. The auto-cleanup is therefore scoped — it only
      // touches entries this exact connection is responsible for.
      let leaked = 0;
      if (childRegistry && typeof childRegistry.unregisterRemote === "function") {
        for (const id of agentsStartedThisConnection) {
          if (childRegistry.unregisterRemote({ id, runId, hostIdentity })) leaked += 1;
        }
      }
      agentsStartedThisConnection.clear();

      _ledgerAudit(ledger, runId, "runner_ws_disconnected", {
        hostIdentity,
        code: typeof code === "number" ? code : null,
        reason: reasonBuf ? String(reasonBuf) : "",
        messagesReceived,
        messagesRouted,
        messagesDropped,
        agentsAutoCleared: leaked,
        lastFrameType,
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

module.exports = {
  createRunnerWsHandler,
  HELLO_TYPE,
  FRAME_AGENT_STARTED,
  FRAME_AGENT_STOPPED,
  FRAME_HOOK,
};
