// Slice R1-f (Phase D R1, 2026-04-28) — harness-runner entrypoint test.
//
// HISTORY: this file used to assert the R1-f stub's EX_CONFIG (78) exit.
// R1-e-3 replaced the stub with the real agent (`src/runner/runnerAgent.js`
// + `runner/index.js`), so the contract under test changed:
//
//   - Missing required env → exit 2 + stderr lists the missing keys
//     (was: exit 78 stub message).
//
// The agent's transport behavior (handshake / heartbeat / WS) lives
// behind the dependency injection seam in src/runner/runnerAgent.js
// and is exercised by tests/unit/runnerAgent.test.js + the integration
// suite. This file just locks the entrypoint's env-validation contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ENTRYPOINT = path.resolve(__dirname, "../../runner/index.js");

function spawnEntry(env = {}) {
  return spawnSync(process.execPath, [ENTRYPOINT], {
    env: { ...process.env, ...env },
  });
}

test("R1-e-3: missing env → exit 2 with explanatory stderr", () => {
  // Spawn with no harness env — every required key missing.
  // Note: pass an empty env-like object that explicitly clears the
  // required keys so the parent shell's settings can't accidentally
  // satisfy them.
  const result = spawnSync(process.execPath, [ENTRYPOINT], {
    env: {
      // Keep PATH so node resolves; everything else stripped.
      PATH: process.env.PATH || "",
      HARNESS_BOOTSTRAP_TOKEN: "",
      HARNESS_HOST_IDENTITY: "",
      HARNESS_ORCHESTRATOR_URL: "",
      HARNESS_RUN_ID: "",
      HARNESS_RUN_JWT: "",
    },
  });
  assert.equal(result.status, 2, `expected exit 2, got ${result.status} (signal=${result.signal})`);
  const stderr = result.stderr.toString();
  assert.match(stderr, /missing required env/);
  // The error message should list at least one missing key by env name.
  assert.match(stderr, /HARNESS_/);
});

test("R1-e-3: entrypoint exit code is NOT 78 (the legacy stub code)", () => {
  // Reserved for a future "downgrade to stub" — production runs must
  // never report 78. Exit 2 (env error) is the typical no-config case.
  const result = spawnSync(process.execPath, [ENTRYPOINT], {
    env: { PATH: process.env.PATH || "" },
  });
  assert.notEqual(result.status, 78);
});
