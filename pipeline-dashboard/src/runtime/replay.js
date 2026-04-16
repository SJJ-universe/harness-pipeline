// Replay — deterministic replay of saved hook fixtures.
// Feeds events through HookRouter sequentially and collects decisions/broadcasts.
// No actual Claude/Codex subprocess is spawned.

class Replay {
  constructor({ hookRouter, broadcast }) {
    this.hookRouter = hookRouter;
    this.broadcast = broadcast || (() => {});
  }

  async run(fixture) {
    const { events } = fixture;
    if (!Array.isArray(events)) throw new Error("fixture must have events array");

    const broadcastedEvents = [];
    const decisions = [];
    const blockedTools = [];

    // Intercept broadcast to collect events
    const origBroadcast = this.hookRouter.broadcast;
    this.hookRouter.broadcast = (evt) => {
      broadcastedEvents.push(evt);
      this.broadcast(evt);
    };

    try {
      for (const { event, payload } of events) {
        const decision = await this.hookRouter.route(event, payload || {});
        decisions.push({ event, decision });
        if (decision && decision.decision === "block") {
          blockedTools.push({ event, tool: payload?.tool_name, reason: decision.reason });
        }
      }
    } finally {
      this.hookRouter.broadcast = origBroadcast;
    }

    // Determine final phase from executor state
    const executor = this.hookRouter.executor;
    const finalPhase = executor && executor._currentPhase ? executor._currentPhase.id : null;

    return {
      broadcastedEvents,
      decisions,
      finalPhase,
      blockedTools,
      eventCount: events.length,
    };
  }
}

module.exports = { Replay };
