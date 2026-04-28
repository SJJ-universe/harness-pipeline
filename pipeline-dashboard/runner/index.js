#!/usr/bin/env node
// Slice R1-e-3 (Phase D R1, 2026-04-28) — harness-runner entrypoint.
//
// Replaces the R1-f stub. Reads env, constructs RunnerAgent with the
// real `ws` + global fetch, runs until SIGTERM/SIGINT.
//
// Required env:
//
//   HARNESS_BOOTSTRAP_TOKEN     bootstrap token from operator
//   HARNESS_HOST_IDENTITY       host id (e.g., "runner-a/3")
//   HARNESS_ORCHESTRATOR_URL    e.g., "http://orchestrator:4201"
//   HARNESS_RUN_ID              pre-assigned run id
//   HARNESS_RUN_JWT             per-run JWT issued by orchestrator
//
// Optional env:
//
//   HARNESS_SANDBOX_CLASS       default "container-strict"
//   HARNESS_HEARTBEAT_INTERVAL_MS  default 5000
//   HARNESS_RECONNECT_BASE_MS      default 1000
//   HARNESS_RECONNECT_MAX_MS       default 30000
//
// Exit codes:
//
//   0   clean shutdown via SIGTERM/SIGINT
//   2   missing/invalid env
//   3   fatal protocol error (1008/1011 close — orchestrator rejected)
//   78  EX_CONFIG (legacy stub) — never returned by the real entrypoint;
//       reserved so a future "downgrade to stub" can resurrect it
//   1   any other unhandled error

const { WebSocket } = require("ws");
const { RunnerAgent, configFromEnv } = require("../src/runner/runnerAgent");

async function main() {
  let config;
  try {
    config = configFromEnv();
  } catch (err) {
    process.stderr.write("[harness-runner] " + err.message + "\n");
    process.exit(2);
  }

  const agent = new RunnerAgent(config, {
    fetchImpl: globalThis.fetch,
    WebSocketCtor: WebSocket,
  });

  // Track fatal-close state so we can pick the right exit code.
  const originalStop = agent.stop.bind(agent);
  let fatalProtocol = false;
  agent.stop = async function patchedStop() {
    if (agent.state === "running" || agent.state === "reconnecting") {
      // Distinguish operator-initiated stop from protocol-driven stop:
      // when the agent stops itself due to 1008/1011, it goes through
      // the close handler which logs an error first.
    }
    return originalStop();
  };

  // Listen for the stop trigger from a fatal close. The agent's own
  // close handler calls stop() on 1008/1011; we just need to remember
  // it for the exit code.
  const origLogger = agent.logger;
  agent.logger = {
    log: origLogger.log.bind(origLogger),
    warn: origLogger.warn.bind(origLogger),
    error: (msg, ...rest) => {
      if (typeof msg === "string" && /ws close (1008|1011) is fatal/.test(msg)) {
        fatalProtocol = true;
      }
      origLogger.error(msg, ...rest);
    },
  };

  let signalReceived = null;
  const shutdown = async (signal) => {
    if (signalReceived) return;
    signalReceived = signal;
    console.log(`[harness-runner] ${signal} — shutting down`);
    try { await agent.stop(); } catch (_) {}
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  try {
    await agent.start();
    console.log(`[harness-runner] started (host=${config.hostIdentity}, run=${config.runId})`);
  } catch (err) {
    console.error("[harness-runner] start failed:", err.message);
    process.exit(1);
  }

  // Idle loop: wake every second to check for stop. RunnerAgent has its
  // own timers, so this loop only exists to keep the process alive
  // until something flips state to STOPPED.
  while (agent.state !== "stopped") {
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (signalReceived) {
    process.exit(0);
  }
  if (fatalProtocol) {
    process.exit(3);
  }
  // Unexpected stop — agent went to stopped without a signal or fatal.
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write("[harness-runner] unhandled: " + err.message + "\n");
  process.exit(1);
});
