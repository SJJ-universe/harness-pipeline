// Slice MA0 (Phase D, 2026-04-27) — /api/server/info exposes activeChildren.
//
// childRegistry.snapshot() (Phase 3-S Slice S3-a) used to be visible only
// through `child_registered` / `child_unregistered` broadcasts. The
// monitor UI / operations needs a pull-based view too. This integration
// test mounts the real serverControlRoutes router with a real
// childRegistry, then exercises both the empty and the populated case
// against an Express test instance.
//
// We avoid spinning up the full server (no WebSocket, no pipeline) so the
// test stays fast + deterministic; only the routes module + a fake
// childRegistry-shape contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const { createServerControlRoutes } = require("../../src/routes/serverControlRoutes");
const { createChildRegistry } = require("../../src/runtime/childRegistry");

function startApp({ childRegistry, clients = new Set(), CLIENT_GRACE_MS = 1000 } = {}) {
  const app = express();
  // graceful shutdown is required by the route module but not exercised here.
  const broadcast = () => {};
  const fakeServer = { close() {} };
  const shutdownTimerRef = { timer: null };
  app.use("/api", createServerControlRoutes({
    broadcast,
    clients,
    gracefulShutdown: () => {},
    server: fakeServer,
    CLIENT_GRACE_MS,
    shutdownTimerRef,
    childRegistry,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        try { resolve({ status: res.statusCode, body: JSON.parse(text) }); }
        catch (e) { reject(new Error("non-json: " + text)); }
      });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function mockChild(pid) {
  return { pid, kill() {} };
}

// ── empty case ─────────────────────────────────────────────────────────

test("/api/server/info exposes activeChildren=[] when no spawn", async () => {
  const childRegistry = createChildRegistry();
  const { server, port } = await startApp({ childRegistry });
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.activeChildren), "activeChildren is always an array");
    assert.equal(body.activeChildren.length, 0);
    assert.equal(body.activeChildCount, 0);
    // Other existing fields still present.
    assert.equal(typeof body.pid, "number");
    assert.ok("uptime" in body);
    assert.ok("clients" in body);
    assert.ok("graceMs" in body);
  } finally {
    server.close();
  }
});

// ── populated case ─────────────────────────────────────────────────────

test("/api/server/info reflects every active child registered", async () => {
  const childRegistry = createChildRegistry();
  childRegistry.register(mockChild(101), { label: "claude", runId: "run-A" });
  childRegistry.register(mockChild(102), { label: "codex", runId: "run-A" });
  childRegistry.register(mockChild(103), { label: "codex", runId: "run-B" });
  const { server, port } = await startApp({ childRegistry });
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    assert.equal(body.activeChildren.length, 3, "all three appear");
    assert.equal(body.activeChildCount, 3);
    const labels = body.activeChildren.map((c) => c.label).sort();
    assert.deepEqual(labels, ["claude", "codex", "codex"]);
    const runIds = body.activeChildren.map((c) => c.runId).sort();
    assert.deepEqual(runIds, ["run-A", "run-A", "run-B"]);
    for (const c of body.activeChildren) {
      assert.ok(typeof c.pid === "number");
      assert.ok(typeof c.ageMs === "number");
      assert.ok(c.ageMs >= 0);
    }
  } finally {
    server.close();
  }
});

// ── unregister reflects in the next call ───────────────────────────────

test("/api/server/info drops a child after unregister (live snapshot)", async () => {
  const childRegistry = createChildRegistry();
  const a = mockChild(201);
  const b = mockChild(202);
  childRegistry.register(a, { label: "claude", runId: "X" });
  childRegistry.register(b, { label: "codex", runId: "X" });
  const { server, port } = await startApp({ childRegistry });
  try {
    let r = await get(port, "/api/server/info");
    assert.equal(r.body.activeChildCount, 2);
    childRegistry.unregister(a);
    r = await get(port, "/api/server/info");
    assert.equal(r.body.activeChildCount, 1);
    assert.equal(r.body.activeChildren[0].pid, 202);
  } finally {
    server.close();
  }
});

// ── safe degradation when no childRegistry is wired ────────────────────

test("/api/server/info still returns an empty activeChildren when childRegistry is absent", async () => {
  // Backward-compat path: routes were originally created without childRegistry;
  // missing-registry must not break the endpoint.
  const { server, port } = await startApp({ childRegistry: null });
  try {
    const { status, body } = await get(port, "/api/server/info");
    assert.equal(status, 200);
    assert.deepEqual(body.activeChildren, []);
    assert.equal(body.activeChildCount, 0);
  } finally {
    server.close();
  }
});

// ── source-level wiring anchor ────────────────────────────────────────

test("server.js wires childRegistry into createServerControlRoutes", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const SRC = fs.readFileSync(
    path.join(__dirname, "../../server.js"), "utf-8"
  );
  // The constructor block for ServerControlRoutes must mention childRegistry.
  const idx = SRC.indexOf("createServerControlRoutes({");
  assert.ok(idx > -1, "createServerControlRoutes call exists");
  const block = SRC.slice(idx, idx + 600);
  assert.match(block, /childRegistry/, "childRegistry passed in");
  assert.match(block, /Slice MA0/, "Slice MA0 tag attached for traceability");
});
