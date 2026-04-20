// EventReplayBuffer — ring buffer for UI-restoration events.
//
// Stores only UI-relevant event types (not high-frequency internals).
// On WebSocket reconnect, the server replays this buffer so the dashboard
// can restore tool feed, critique timeline, stage logs, etc. without
// needing the events to also live in PipelineState (which is domain state).

const REPLAY_TYPES = new Set([
  "phase_update",
  "node_update",
  "tool_recorded",
  "tool_blocked",
  "gate_failed",
  "gate_evaluated",
  "gate_bypassed",
  "codex_started",
  "critique_received",
  "critique_persist_failed",
  "cycle_iteration",
  "artifact_captured",
  "claim_verification_failed",
  "context_alarm",
  "hook_event",
  "auto_pipeline_detect",
  "pipeline_mutated",
  // Slice D (v4): subagent lifecycle. Both start+completed are replayed so a
  // browser refreshing mid-run sees the correct tray state. Volume is low
  // (Agent tool dispatches are bursty, not sustained), so including both
  // stays within the 500-entry ring budget comfortably.
  "subagent_started",
  "subagent_completed",
]);

function createEventReplayBuffer({ maxSize = 500 } = {}) {
  const buf = [];

  return {
    append(event) {
      if (!event || typeof event !== "object") return;
      if (!REPLAY_TYPES.has(event.type)) return;
      buf.push({ ts: Date.now(), event });
      if (buf.length > maxSize) {
        buf.splice(0, buf.length - maxSize);
      }
    },
    snapshot() {
      return buf.slice();
    },
    clear() {
      buf.length = 0;
    },
    size() {
      return buf.length;
    },
  };
}

module.exports = { createEventReplayBuffer, REPLAY_TYPES };
