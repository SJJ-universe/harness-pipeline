// Slice UI-P10-a (Phase D Round UI-P, 2026-05-04) — server boot helper
// for live browser visual verification.
//
// Mirrors the per-test boot pattern from
// tests/integration/product-shell-routing.test.js (line 32-40), but
// scoped to a single capture run rather than per-test:
//   - boot() starts the server in-process (server.start) on a port
//     the operator can override via env, polls /api/health up to
//     bootTimeoutMs, returns a handle with `.base` + `.close()`.
//   - close() invokes the supervised server shutdown so the
//     sessionWatcher / ledger cleanup / runner stale monitor all
//     drain (server.js once("close") hooks the cleanup chain).
//
// The capture script runs the entire 16-cell matrix against ONE boot,
// then closes the server. No per-route reboot — keeps total wall
// time under ~10 seconds for the standard matrix on developer laptops.
//
// Default port is 4799 — distinct from:
//   - production port 4201 (server default, may already be running)
//   - integration test ports 4318/4099/etc.
//   - readiness-report port 5099
// Operator can override via HARNESS_VISUAL_LIVE_PORT or --port arg.

"use strict";

const { start } = require("../../server");

const DEFAULT_PORT = Number(process.env.HARNESS_VISUAL_LIVE_PORT || 4799);
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_BOOT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 100;

async function _waitForHealth(base, timeoutMs, pollMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) {
        const body = await res.json().catch(() => null);
        if (body && body.app === "OrchestratorPipeline") {
          return { ok: true, elapsedMs: Date.now() - started };
        }
      }
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, elapsedMs: Date.now() - started };
}

/**
 * Boot the harness server in-process and wait for /api/health.
 *
 * @param {object} [opts]
 * @param {number} [opts.port=4799]
 * @param {string} [opts.host="127.0.0.1"]
 * @param {number} [opts.bootTimeoutMs=10000]
 * @param {number} [opts.pollIntervalMs=100]
 * @returns {Promise<{base: string, port: number, host: string,
 *                    elapsedMs: number, close: () => Promise<void>}>}
 */
async function boot(opts = {}) {
  const port = Number(opts.port || DEFAULT_PORT);
  const host = String(opts.host || DEFAULT_HOST);
  const bootTimeoutMs = Number(opts.bootTimeoutMs || DEFAULT_BOOT_TIMEOUT_MS);
  const pollMs = Number(opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  const base = `http://${host}:${port}`;

  const listener = start(port, host);
  const health = await _waitForHealth(base, bootTimeoutMs, pollMs);
  if (!health.ok) {
    await new Promise((r) => listener.close(r));
    throw new Error(
      `server did not respond on /api/health within ${bootTimeoutMs}ms ` +
      `(port=${port})`,
    );
  }

  return {
    base,
    port,
    host,
    elapsedMs: health.elapsedMs,
    async close() {
      await new Promise((r) => listener.close(r));
    },
  };
}

module.exports = {
  boot,
  DEFAULT_PORT,
  DEFAULT_HOST,
  DEFAULT_BOOT_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  // Internal exposure for the helpers test only.
  _waitForHealth,
};
