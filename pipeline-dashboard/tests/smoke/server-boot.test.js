const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { start } = require("../../server");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const PORT = 4318;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitFor(pathname) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}${pathname}`);
      if (res.ok) return res;
    } catch (_) {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not respond on ${pathname}`);
}

test("server boots and exposes health and version proof", async () => {
  const listener = start(PORT, "127.0.0.1");

  try {
    const health = await waitFor("/api/health");
    assert.equal((await health.json()).status, "ok");

    const version = await waitFor("/api/version");
    const body = await version.json();
    assert.ok(body.gitSha);
    assert.ok(body.bootTime);
    assert.ok(body.templateHash);
    assert.ok(body.policyHash);
    assert.equal(body.mode, "local");
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
});
