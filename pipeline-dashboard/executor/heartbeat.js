// Heartbeat — broadcasts a "heartbeat" event every intervalMs while a pipeline
// is active. Used by the UI to show elapsed time and confirm the server/pipeline
// is still working (vs. hung or waiting for input).
//
// Separate from WebSocket ping/pong: this is for UI visibility, not connection liveness.

function createHeartbeat({ broadcast, getActive, getCurrentPhase, intervalMs = 5000 } = {}) {
  let timer = null;

  function tick() {
    const active = getActive();
    if (!active) {
      stop();
      return;
    }
    const phase = getCurrentPhase ? getCurrentPhase() : null;
    broadcast({
      type: "heartbeat",
      data: {
        phase: phase ? phase.id : null,
        agent: phase ? phase.agent : null,
        elapsedMs: Date.now() - (active.startedAt || Date.now()),
        codexRunning: active._codexStartedAt || null,
        at: Date.now(),
      },
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function isRunning() {
    return timer !== null;
  }

  return { start, stop, isRunning, tick };
}

module.exports = { createHeartbeat };
