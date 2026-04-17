const test = require("node:test");
const assert = require("node:assert/strict");
const { createHeartbeat } = require("../../executor/heartbeat");

test("heartbeat tick broadcasts when active present", () => {
  const events = [];
  let active = { startedAt: Date.now() - 1000, _codexStartedAt: null };
  const hb = createHeartbeat({
    broadcast: (e) => events.push(e),
    getActive: () => active,
    getCurrentPhase: () => ({ id: "A", agent: "claude" }),
  });
  hb.tick();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "heartbeat");
  assert.equal(events[0].data.phase, "A");
  assert.equal(events[0].data.agent, "claude");
  assert.ok(events[0].data.elapsedMs >= 1000);
});

test("heartbeat stops when active becomes null", () => {
  let active = { startedAt: Date.now() };
  const events = [];
  const hb = createHeartbeat({
    broadcast: (e) => events.push(e),
    getActive: () => active,
    getCurrentPhase: () => null,
    intervalMs: 10,
  });
  hb.start();
  assert.equal(hb.isRunning(), true);
  active = null;
  hb.tick(); // should auto-stop
  assert.equal(hb.isRunning(), false);
});

test("heartbeat includes codexRunning timestamp when present", () => {
  const codexStart = Date.now() - 5000;
  const active = { startedAt: Date.now() - 10000, _codexStartedAt: codexStart };
  const events = [];
  const hb = createHeartbeat({
    broadcast: (e) => events.push(e),
    getActive: () => active,
    getCurrentPhase: () => ({ id: "C", agent: "codex" }),
  });
  hb.tick();
  assert.equal(events[0].data.codexRunning, codexStart);
});

test("start/stop idempotent", () => {
  const hb = createHeartbeat({
    broadcast: () => {},
    getActive: () => ({ startedAt: Date.now() }),
    getCurrentPhase: () => null,
    intervalMs: 100000,
  });
  hb.start();
  hb.start(); // duplicate start ignored
  assert.equal(hb.isRunning(), true);
  hb.stop();
  assert.equal(hb.isRunning(), false);
  hb.stop(); // duplicate stop ignored
  assert.equal(hb.isRunning(), false);
});
