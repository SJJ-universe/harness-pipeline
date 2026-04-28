#!/usr/bin/env node
// Slice R1-f (Phase D R1, 2026-04-28) — harness-runner stub entrypoint.
//
// R1-e replaces this with the full agent:
//   - 3-step handshake (POST /api/runner/handshake → runnerToken)
//   - heartbeat loop (POST /api/runner/heartbeat every 5s)
//   - WS upgrade to /api/runner/events (runJWT-authenticated)
//   - tool exec + hook emission via the WS channel
//   - HTTPS POST /api/runner/hook one-shot fallback on partition
//
// For R1-f we just want a buildable image whose ENTRYPOINT is well-defined.
// Exit code 78 is the BSD sysexits.h "EX_CONFIG" — "configuration error /
// not yet runnable". CI gates that distinguish "stub-on-purpose" from
// "broken" rely on this, and tests/unit/runner-stub.test.js asserts it.

const STUB_EXIT_CODE = 78;

console.error(
  "[harness-runner] Stub entrypoint (Phase D R1-f). " +
  "Full agent ships in R1-e — handshake, heartbeat, WS, hook ingress.",
);
process.exit(STUB_EXIT_CODE);
