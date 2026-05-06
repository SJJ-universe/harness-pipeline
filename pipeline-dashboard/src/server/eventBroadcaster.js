// Slice MB4-d (Phase D Round 2, 2026-04-27) — eventBroadcaster.
//
// Behaviour-preserving lift of the event broadcast + replay buffer +
// throttle plumbing out of server.js. Same wire contract as before:
//   broadcast(event) → JSON.stringify + send to every OPEN WebSocket
//                      in `clients`, with throttle on non-IMMEDIATE
//                      types and auto heartbeat start/stop on pipeline
//                      lifecycle events.
//
// Why a factory?
//   - server.js was holding 60+ lines of broadcast plumbing that
//     several other modules (event routes, hookRouter, runners) all
//     consumed via a closure reference. Lifting it out shrinks
//     server.js and gives us a clean unit-test target.
//   - The replay buffer is created here so it lives next to the only
//     code that knows when to clear it (pipeline_start / pipeline_reset).
//
// Heartbeat note: heartbeat is constructed AFTER broadcast in the
// legacy server.js bootstrap because heartbeat itself reads through
// the orchestrator. We provide attachHeartbeat() so server.js can
// hand the heartbeat over once it exists. Until then the lifecycle
// hooks are no-ops.

const { createEventReplayBuffer } = require("../runtime/eventReplayBuffer");

const DEFAULT_IMMEDIATE_TYPES = [
  "pipeline_start", "pipeline_complete", "pipeline_reset",
  "phase_update", "gate_failed", "gate_evaluated", "gate_bypassed",
  "tool_blocked", "error", "server_shutdown", "server_restart",
  "general_plan_complete", "critique_received", "codex_trigger_done",
  "codex_started", "codex_progress", "context_alarm", "pipeline_mutated",
  // Audit/append-only events — must not be coalesced (Codex T0 fix)
  "tool_recorded", "hook_event", "log_message", "cycle_iteration",
  "node_update", "artifact_captured",
  // Slice A (v4): user-facing lifecycle — never throttle
  "harness_notification", "pipeline_compacted",
];

function createEventBroadcaster({
  clients,
  immediateTypes,
  throttleMs = 100,
  replayBuffer = null,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  if (!clients || typeof clients[Symbol.iterator] !== "function") {
    throw new Error("createEventBroadcaster: clients must be iterable (Set<WebSocket>)");
  }
  const _setTimeout = setTimeoutFn
    || (typeof setTimeout !== "undefined" ? setTimeout : null);
  const _clearTimeout = clearTimeoutFn
    || (typeof clearTimeout !== "undefined" ? clearTimeout : null);
  const _immediate = immediateTypes instanceof Set
    ? immediateTypes
    : new Set(immediateTypes || DEFAULT_IMMEDIATE_TYPES);
  const _replay = replayBuffer || createEventReplayBuffer({ maxSize: 500 });
  const _timers = new Map();
  let _heartbeat = null;

  function _broadcastRaw(event) {
    const data = JSON.stringify(event);
    let sent = 0;
    let total = 0;
    for (const ws of clients) {
      total++;
      if (ws && ws.readyState === 1 && typeof ws.send === "function") {
        try { ws.send(data); sent++; } catch (_) {}
      }
    }
    // AGENT-DESKTOP-0-diag2 (2026-05-06): log lifecycle event delivery
    // counts so the operator can see whether a pipeline_start broadcast
    // actually reached any browser. The 0/0 case (no WS clients
    // connected) is the silent failure mode we're trying to surface.
    const t = event && event.type;
    if (t === "pipeline_start" || t === "pipeline_complete" || t === "phase_update" || t === "error") {
      try {
        console.log(`[broadcaster] ${t} → sent=${sent}/${total} clients`);
      } catch (_) {}
    }
  }

  function broadcast(event) {
    const type = event && event.type;
    // Capture before send so reconnecting clients see consistent history.
    try { _replay.append(event); } catch (_) {}
    // Auto-manage heartbeat + replay buffer on pipeline lifecycle events.
    if (type === "pipeline_start" || type === "pipeline_reset") {
      try { _replay.clear(); } catch (_) {}
      if (_heartbeat && typeof _heartbeat.start === "function") {
        try { _heartbeat.start(); } catch (_) {}
      }
    } else if (type === "pipeline_complete" || type === "pipeline_paused") {
      if (_heartbeat && typeof _heartbeat.stop === "function") {
        try { _heartbeat.stop(); } catch (_) {}
      }
    } else if (type === "auto_pipeline_detect") {
      if (_heartbeat && typeof _heartbeat.start === "function") {
        try { _heartbeat.start(); } catch (_) {}
      }
    }
    if (!type || _immediate.has(type)) {
      _broadcastRaw(event);
      return;
    }
    // Throttle: first event of a type sends immediately, subsequent
    // debounce throttleMs.
    if (!_timers.has(type)) {
      _broadcastRaw(event);
      if (typeof _setTimeout === "function") {
        _timers.set(type, _setTimeout(() => {
          _timers.delete(type);
        }, throttleMs));
      }
    } else {
      // Replace pending — when timer fires the latest event is already
      // sent. Store for edge case where timer just expired.
      if (typeof _clearTimeout === "function") {
        _clearTimeout(_timers.get(type));
      }
      if (typeof _setTimeout === "function") {
        _timers.set(type, _setTimeout(() => {
          _timers.delete(type);
          _broadcastRaw(event);
        }, throttleMs));
      }
    }
  }

  function attachHeartbeat(hb) {
    _heartbeat = hb || null;
  }

  function disposeAllTimers() {
    if (typeof _clearTimeout === "function") {
      for (const id of _timers.values()) {
        try { _clearTimeout(id); } catch (_) {}
      }
    }
    _timers.clear();
  }

  return {
    broadcast,
    eventReplayBuffer: _replay,
    attachHeartbeat,
    disposeAllTimers,
    // Test hooks
    _broadcastRaw,
    _timers,
    _immediate,
  };
}

module.exports = { createEventBroadcaster, DEFAULT_IMMEDIATE_TYPES };
