// Slice E (v4) — GET /api/runs/current contract.
//
// The endpoint is readonly so auth rules match other GET routes (loopback
// allowed without a state-changing token). The response must include:
//   - snapshot: replay snapshot from pipelineExecutor.getReplaySnapshot()
//   - events: array (possibly empty) of events from eventReplayBuffer
//   - exportedAt: ISO timestamp
//
// We don't attempt to spin up a real pipeline; idle status is enough to verify
// the shape.

const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("../../server");

const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
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

test("GET /api/runs/current returns { snapshot, events, exportedAt }", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/api/runs/current`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.snapshot, "snapshot key required");
    assert.ok(Array.isArray(body.events), "events must be an array");
    assert.ok(typeof body.exportedAt === "string", "exportedAt must be ISO string");
    // Idle default: status is 'idle' when no active pipeline and no
    // checkpoint.
    assert.ok(["idle", "active", "paused"].includes(body.snapshot.status));
  });
});

test("idle response still has a valid ISO exportedAt", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/api/runs/current`);
    const body = await res.json();
    const ts = new Date(body.exportedAt);
    assert.ok(!Number.isNaN(ts.getTime()), "exportedAt must parse as a Date");
    // Close to now
    assert.ok(Math.abs(Date.now() - ts.getTime()) < 30_000);
  });
});

test("GET /api/runs/current does not require x-harness-token", async () => {
  await withServer(async () => {
    // Same rationale as /api/pipeline/templates: GET-only endpoints are
    // loopback-trusted and don't need the state-changing token. An explicit
    // request without any auth headers must succeed.
    const res = await fetch(`${BASE}/api/runs/current`);
    assert.equal(res.status, 200);
  });
});
