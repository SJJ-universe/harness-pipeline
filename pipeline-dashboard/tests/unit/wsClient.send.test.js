// Slice AA-2 (Phase 2.5) — HarnessWsClient.send() unit tests.
//
// The tab switch flow (app.js onSelect) uses `_wsClient.send(...)` to ask
// the server for a run-scoped replay. Send must:
//   - no-op when the socket isn't OPEN (not {open} yet, or already closed)
//   - JSON-serialise non-string payloads
//   - pass string payloads through verbatim
//   - return true/false so callers know whether the frame was dispatched
// Without these guarantees every send in app.js would need its own guard.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/ws-client");

class MockWs {
  constructor(url) {
    this.url = url;
    this.readyState = 0;        // CONNECTING
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWs.instances.push(this);
  }
  close() { this.readyState = 3; if (this.onclose) this.onclose({}); }
  send(frame) {
    if (this.forceSendThrow) throw new Error("stub-send-failure");
    this.sent.push(frame);
  }
  _open() { this.readyState = 1; if (this.onopen) this.onopen({}); }
}
MockWs.OPEN = 1;
MockWs.instances = [];

function fresh() {
  MockWs.instances = [];
  return MockWs;
}

test("send before OPEN returns false and does not transmit", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  const ok = client.send({ type: "replay_request", runId: "A" });
  assert.equal(ok, false, "send returns false while CONNECTING");
  assert.equal(MockWs.instances[0].sent.length, 0, "no frame handed to the socket");
});

test("send after OPEN returns true and transmits JSON", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  MockWs.instances[0]._open();
  const payload = { type: "replay_request", runId: "run-X", includeGlobal: false };
  const ok = client.send(payload);
  assert.equal(ok, true, "send returns true when socket is OPEN");
  assert.equal(MockWs.instances[0].sent.length, 1, "exactly one frame transmitted");
  assert.equal(
    MockWs.instances[0].sent[0],
    JSON.stringify(payload),
    "frame is JSON-serialised payload"
  );
});

test("string payloads pass through without double-encoding", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  MockWs.instances[0]._open();
  const ok = client.send("raw-string");
  assert.equal(ok, true);
  assert.equal(MockWs.instances[0].sent[0], "raw-string", "string is sent verbatim");
});

test("send after close() returns false (userClosed guard)", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  MockWs.instances[0]._open();
  client.close();
  // After close(), readyState in the mock moved to 3 (CLOSED)
  const ok = client.send({ type: "replay_request", runId: "A" });
  assert.equal(ok, false, "closed socket rejects sends");
});

test("send swallows socket.send() throws and returns false", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  MockWs.instances[0]._open();
  MockWs.instances[0].forceSendThrow = true;
  const ok = client.send({ type: "replay_request", runId: "A" });
  assert.equal(ok, false, "returns false on transport error rather than throwing");
});

test("send is exposed as a function on the install() return value", () => {
  const WS = fresh();
  const client = install({ url: "ws://x", onEvent: () => {}, WebSocketCtor: WS, setTimeoutFn: () => 0 });
  assert.equal(typeof client.send, "function", "send() is part of the public API");
});
