// Slice K (v5) — HarnessWsClient unit tests.
//
// We don't need a real WebSocket — the module accepts a WebSocketCtor hook
// so tests can inject a mock that lets us drive onopen/onmessage/onclose/
// onerror deterministically. setTimeout is also injectable so reconnect
// scheduling can be asserted without actually waiting.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/ws-client");

class MockWs {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWs.instances.push(this);
  }
  close() {
    this.readyState = 3;
    if (this.onclose) this.onclose({});
  }
  // Test helpers
  _open() {
    this.readyState = 1;
    if (this.onopen) this.onopen({});
  }
  _msg(data) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }
  _closeFromServer() {
    this.readyState = 3;
    if (this.onclose) this.onclose({});
  }
  _error() {
    if (this.onerror) this.onerror({});
  }
}
MockWs.OPEN = 1;
MockWs.instances = [];

function freshMockCtor() {
  // Each test gets its own fresh list.
  MockWs.instances = [];
  return MockWs;
}

function deferredTimeout() {
  // Replacement for setTimeout: captures scheduled callbacks instead of
  // running them via the event loop. Call `run()` to fire them.
  const scheduled = [];
  const fn = (cb, ms) => { scheduled.push({ cb, ms }); return scheduled.length; };
  fn._pending = scheduled;
  fn._runAll = () => {
    const copy = scheduled.slice();
    scheduled.length = 0;
    copy.forEach((s) => s.cb());
  };
  return fn;
}

// ── Tests ────────────────────────────────────────────────────────

test("onConnected fires exactly once on the first open", () => {
  const W = freshMockCtor();
  let connected = 0;
  let reconnected = 0;
  install({
    url: "ws://x",
    onConnected: () => { connected++; },
    onReconnected: () => { reconnected++; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._open();
  assert.equal(connected, 1);
  assert.equal(reconnected, 0);
});

test("onReconnected fires on every open AFTER the first", () => {
  const W = freshMockCtor();
  const st = deferredTimeout();
  let connected = 0, reconnected = 0, disconnected = 0;
  install({
    url: "ws://x",
    onConnected: () => { connected++; },
    onReconnected: () => { reconnected++; },
    onDisconnected: () => { disconnected++; },
    WebSocketCtor: W,
    setTimeoutFn: st,
  });
  MockWs.instances[0]._open();
  MockWs.instances[0]._closeFromServer();
  assert.equal(disconnected, 1);

  // Reconnect scheduled — run the deferred callback which creates a new MockWs.
  st._runAll();
  assert.equal(MockWs.instances.length, 2);
  MockWs.instances[1]._open();
  assert.equal(connected, 1, "initial connect stays at 1");
  assert.equal(reconnected, 1, "second open should be a reconnect");
});

test("onDisconnected fires on close but only after at least one open", () => {
  const W = freshMockCtor();
  let disconnected = 0;
  install({
    url: "ws://x",
    onDisconnected: () => { disconnected++; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._closeFromServer();  // never opened
  assert.equal(disconnected, 0, "no open → no disconnect toast");
  MockWs.instances[0]._open();
  MockWs.instances[0]._closeFromServer();
  assert.equal(disconnected, 1);
});

test("onInitialError fires on error BEFORE first open; retry() reopens", () => {
  const W = freshMockCtor();
  let errFired = 0;
  let retry = null;
  install({
    url: "ws://x",
    onInitialError: (args) => { errFired++; retry = args.retry; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._error();
  assert.equal(errFired, 1);
  assert.equal(typeof retry, "function");
  retry();
  assert.equal(MockWs.instances.length, 2, "retry should create a new socket");
});

test("onInitialError does NOT fire once we've connected", () => {
  const W = freshMockCtor();
  let errFired = 0;
  install({
    url: "ws://x",
    onInitialError: () => { errFired++; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._open();
  MockWs.instances[0]._error(); // post-open error is a transient, not initial
  assert.equal(errFired, 0);
});

test("onEvent is called with the parsed JSON message", () => {
  const W = freshMockCtor();
  let lastEvent = null;
  install({
    url: "ws://x",
    onEvent: (ev) => { lastEvent = ev; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._open();
  MockWs.instances[0]._msg({ type: "phase_update", data: { phase: "A" } });
  assert.deepEqual(lastEvent, { type: "phase_update", data: { phase: "A" } });
});

test("malformed message is swallowed without throwing", () => {
  const W = freshMockCtor();
  let fired = 0;
  const client = install({
    url: "ws://x",
    onEvent: () => { fired++; },
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  MockWs.instances[0]._open();
  // Bypass _msg so we feed garbage directly
  MockWs.instances[0].onmessage({ data: "<<not json>>" });
  assert.equal(fired, 0);
  // Client still functional afterwards
  MockWs.instances[0]._msg({ type: "ok" });
  assert.equal(fired, 1);
});

test("getLastEventAt advances on every message", async () => {
  const W = freshMockCtor();
  const client = install({
    url: "ws://x",
    onEvent: () => {},
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  const before = client.getLastEventAt();
  await new Promise((r) => setTimeout(r, 5));
  MockWs.instances[0]._open();
  MockWs.instances[0]._msg({ type: "x" });
  const after = client.getLastEventAt();
  assert.ok(after >= before + 4, `expected advancement, got ${before} → ${after}`);
});

test("close() prevents subsequent reconnect attempts", () => {
  const W = freshMockCtor();
  const st = deferredTimeout();
  const client = install({
    url: "ws://x",
    WebSocketCtor: W,
    setTimeoutFn: st,
  });
  MockWs.instances[0]._open();
  client.close();
  MockWs.instances[0]._closeFromServer();
  // Even if a reconnect was scheduled, running it should NOT create a new socket.
  st._runAll();
  assert.equal(MockWs.instances.length, 1, "closed client must not reconnect");
});

test("install returns a no-op client when WebSocketCtor is not a function", () => {
  // Pass a non-function so the install short-circuits to the no-op return.
  // Mirrors the behavior in SSR / Node environments without global WebSocket.
  const client = install({ url: "ws://x", WebSocketCtor: "not-a-function" });
  assert.equal(client.isConnected(), false);
  assert.equal(client.getLastEventAt(), 0);
  client.close(); // must not throw
  assert.equal(client.getRawSocket(), null);
});

test("isConnected reports OPEN state correctly", () => {
  const W = freshMockCtor();
  const client = install({
    url: "ws://x",
    WebSocketCtor: W,
    setTimeoutFn: deferredTimeout(),
  });
  assert.equal(client.isConnected(), false, "before open");
  MockWs.instances[0]._open();
  assert.equal(client.isConnected(), true, "after open");
  MockWs.instances[0]._closeFromServer();
  assert.equal(client.isConnected(), false, "after close");
});
