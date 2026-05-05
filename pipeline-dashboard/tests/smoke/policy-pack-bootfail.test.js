// Slice S5-c (Phase 2 / SMART-5, 2026-05-05) — server-boot fail-closed smoke.
//
// Plan §S §S-SMART-5 v2 invariant: an unknown HARNESS_DEPLOYMENT_PROFILE
// in production (default) MUST cause server.js to exit 1 at boot,
// not silently fall back to standard. The escape hatch
// HARNESS_POLICY_FAIL_OPEN=1 reverts to legacy fallback behavior.
//
// Both behaviors are asserted via child_process spawn so the
// process.exit(1) path is observable end-to-end (unit tests already
// pin the throw inside resolveDeploymentProfile; this test pins the
// SERVER-LEVEL behavior).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const APP_ROOT = path.resolve(__dirname, "..", "..");

// Spawn a node script that does `require("./server.js")` then prints
// "BOOT_OK" + exits clean (boot succeeded). When server.js fail-closes
// at boot, the process.exit(1) inside the require call terminates
// before "BOOT_OK" is written. So:
//   exit 0 + stdout has "BOOT_OK"   → boot succeeded
//   exit 1 + stderr has the FATAL   → fail-closed kicked in
function spawnServerWithEnv(envOverrides) {
  // Use process.exit(0) right after require so the http server (still
  // listening on no port) doesn't keep the event loop alive.
  const script = `
    try {
      require("./server.js");
      // If we got here, boot succeeded. Exit immediately so the http
      // server (created but not .listen()ing) doesn't hold the event
      // loop open — there are heartbeat timers + remote runner watchers
      // that would otherwise keep us alive.
      process.stdout.write("BOOT_OK\\n");
      process.exit(0);
    } catch (err) {
      process.stderr.write("REQUIRE_THROW: " + err.message + "\\n");
      process.exit(2);
    }
  `;
  return spawnSync(process.execPath, ["-e", script], {
    cwd: APP_ROOT,
    env: {
      // Inherit minimum needed env for boot (PATH for node-pty
      // native build path resolution, etc.) but override the bits
      // SMART-5 cares about.
      ...process.env,
      // Make boot fast: skip browser open, disable remote runner
      // entirely (HARNESS_REMOTE_MODE=off is the default).
      HARNESS_NO_BROWSER: "1",
      // Force a fresh port-free state — server.js listens on
      // 0 = ephemeral when start() is called, but we never call
      // start() so this just keeps env tidy.
      ...envOverrides,
    },
    timeout: 30_000,
    encoding: "utf-8",
  });
}

// ── Tests ──────────────────────────────────────────────────────────

test("S5-c: server boots cleanly under known pack 'standard' (sanity)", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "standard",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: server boots cleanly under known pack 'public-sector'", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "public-sector",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: server boots cleanly under known pack 'finance-high-privacy'", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "finance-high-privacy",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: server boots cleanly under known pack 'offline-internal-network'", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "offline-internal-network",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: server boots cleanly under known pack 'developer-lab'", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "developer-lab",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: unset HARNESS_DEPLOYMENT_PROFILE → boots as standard (backward compat)", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "",
  });
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

// ── Fail-closed boot ──────────────────────────────────────────────

test("S5-c: typo'd HARNESS_DEPLOYMENT_PROFILE='publicsector' → exit 1 + FATAL stderr", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "publicsector",
  });
  assert.equal(result.status, 1, `expected exit 1 (fail-closed), got ${result.status}`);
  assert.ok(!/BOOT_OK/.test(result.stdout), "BOOT_OK must NOT print when fail-closed");
  // FATAL message + remediation hint should be on stderr
  assert.match(result.stderr, /FATAL/);
  assert.match(result.stderr, /Unknown HARNESS_DEPLOYMENT_PROFILE/);
  assert.match(result.stderr, /HARNESS_POLICY_FAIL_OPEN=1/);
});

test("S5-c: gibberish HARNESS_DEPLOYMENT_PROFILE → exit 1", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "completely-not-a-pack",
  });
  assert.equal(result.status, 1);
});

test("S5-c: typo + HARNESS_POLICY_FAIL_OPEN=1 → boots as standard (legacy escape)", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "publicsector",
    HARNESS_POLICY_FAIL_OPEN: "1",
  });
  assert.equal(result.status, 0, `expected exit 0 with escape, got ${result.status}: ${result.stderr}`);
  assert.match(result.stdout, /BOOT_OK/);
});

test("S5-c: typo + HARNESS_POLICY_FAIL_OPEN=0 → exit 1 (escape NOT enabled)", () => {
  const result = spawnServerWithEnv({
    HARNESS_DEPLOYMENT_PROFILE: "publicsector",
    HARNESS_POLICY_FAIL_OPEN: "0",
  });
  assert.equal(result.status, 1, `escape should NOT enable on '0', got ${result.status}`);
});
