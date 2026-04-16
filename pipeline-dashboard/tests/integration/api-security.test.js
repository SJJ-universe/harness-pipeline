const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { start } = require("../../server");

const APP_ROOT = path.resolve(__dirname, "..", "..");
const PORT = 4317;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("server did not start");
}

async function withServer(fn) {
  const listener = start(PORT, "127.0.0.1");
  try {
    await waitForServer();
    await fn();
  } finally {
    await new Promise((resolve) => listener.close(resolve));
  }
}

test("state-changing APIs require token and validate event schema", async () => {
  await withServer(async () => {
    const tokenRes = await fetch(`${BASE}/api/auth/token`);
    const { token } = await tokenRes.json();
    assert.ok(token);

    const unauth = await fetch(`${BASE}/api/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "phase_update", data: {} }),
    });
    assert.equal(unauth.status, 401);

    const unknown = await fetch(`${BASE}/api/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-harness-token": token },
      body: JSON.stringify({ type: "unknown_event", data: {} }),
    });
    assert.equal(unknown.status, 400);

    const accepted = await fetch(`${BASE}/api/event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-harness-token": token },
      body: JSON.stringify({ type: "phase_update", data: { phase: "A" } }),
    });
    assert.equal(accepted.status, 200);
  });
});

test("context load blocks paths outside the repo root", async () => {
  await withServer(async () => {
    const { token } = await (await fetch(`${BASE}/api/auth/token`)).json();
    const outside = process.env.USERPROFILE || process.env.HOME || path.parse(APP_ROOT).root;
    const res = await fetch(`${BASE}/api/context/load`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-harness-token": token },
      body: JSON.stringify({ filePath: outside }),
    });
    assert.equal(res.status, 403);
  });
});
