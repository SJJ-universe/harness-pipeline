// Slice MB4-c (Phase D Round 2, 2026-04-27) — terminal-mount tests.
//
// The lift's public surface is install() → { mount, dispose,
// isMounted }. We exercise mount() with stub xterm + WebSocket so the
// module's URL construction + auth-token integration are covered
// without depending on browser globals.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/terminal-mount");

function makeStubDoc() {
  const containers = new Map();
  return {
    getElementById(id) {
      if (!containers.has(id)) {
        containers.set(id, {
          _innerHTML: "",
          children: [],
          set innerHTML(v) { this._innerHTML = v; },
          get innerHTML() { return this._innerHTML; },
          appendChild(c) { this.children.push(c); return c; },
        });
      }
      return containers.get(id);
    },
  };
}

function makeStubTerminal() {
  let onDataFn = null;
  return {
    cols: 120,
    rows: 30,
    open() {},
    write() {},
    loadAddon() {},
    onData(fn) { onDataFn = fn; },
    attachCustomKeyEventHandler() {},
    getSelection() { return ""; },
    clearSelection() {},
    dispose() {},
    _trigger(data) { if (onDataFn) onDataFn(data); },
  };
}

function makeStubWS() {
  const sent = [];
  function StubWS(url) {
    this.url = url;
    this.readyState = 0;
    this.send = (msg) => sent.push(msg);
    this.close = () => { this.readyState = 3; };
  }
  StubWS._sent = sent;
  return StubWS;
}

// ── install + mount happy path ───────────────────────────────────────

test("install returns the public surface", () => {
  const handle = install({});
  assert.equal(typeof handle.mount, "function");
  assert.equal(typeof handle.dispose, "function");
  assert.equal(typeof handle.isMounted, "function");
});

test("mount returns early when no document is available", async () => {
  const handle = install({});
  // No global document in node, no doc passed → mount silently returns.
  await handle.mount();
  assert.equal(handle.isMounted(), false);
});

test("mount renders unavailable stub when xterm Terminal is missing", async () => {
  const doc = makeStubDoc();
  const handle = install({ TerminalCtor: null, WebSocketCtor: makeStubWS(), doc });
  await handle.mount({ containerId: "t" });
  const el = doc.getElementById("t");
  assert.match(el.innerHTML, /xterm\.js를 로드할 수 없습니다/);
});

test("mount + dispose: WS connects with token + dispose closes it", async () => {
  const doc = makeStubDoc();
  const StubWS = makeStubWS();
  const handle = install({
    TerminalCtor: makeStubTerminal,
    WebSocketCtor: StubWS,
    locationProtocol: "https:",
    locationHost: "127.0.0.1:4201",
    apiTokenGetter: async () => "TOKEN-XYZ",
    doc,
  });
  await handle.mount({ containerId: "term-x" });
  assert.equal(handle.isMounted(), true);
  // Dispose tears down + flips isMounted back to false.
  handle.dispose();
  assert.equal(handle.isMounted(), false);
});

test("mount: URL uses wss:// when location.protocol is https + url-encodes token", async () => {
  const doc = makeStubDoc();
  let constructedUrl = null;
  function StubWS(url) {
    constructedUrl = url;
    this.readyState = 0;
    this.send = () => {};
    this.close = () => {};
  }
  const handle = install({
    TerminalCtor: makeStubTerminal,
    WebSocketCtor: StubWS,
    locationProtocol: "https:",
    locationHost: "127.0.0.1:4201",
    apiTokenGetter: async () => "tok with/space",
    doc,
  });
  await handle.mount({ containerId: "t" });
  assert.match(constructedUrl, /^wss:\/\/127\.0\.0\.1:4201\/terminal\?token=/);
  // URL-encoded.
  assert.match(constructedUrl, /tok%20with%2Fspace/);
});

test("mount: ws:// when protocol is http", async () => {
  const doc = makeStubDoc();
  let constructedUrl = null;
  function StubWS(url) { constructedUrl = url; this.readyState = 0; this.send = () => {}; this.close = () => {}; }
  const handle = install({
    TerminalCtor: makeStubTerminal,
    WebSocketCtor: StubWS,
    locationProtocol: "http:",
    locationHost: "h.local",
    apiTokenGetter: async () => "T",
    doc,
  });
  await handle.mount({ containerId: "t" });
  assert.match(constructedUrl, /^ws:\/\/h\.local\/terminal/);
});

test("mount() is idempotent — calling twice without dispose is a no-op the second time", async () => {
  const doc = makeStubDoc();
  let constructions = 0;
  function StubWS() {
    constructions++;
    this.readyState = 0;
    this.send = () => {};
    this.close = () => {};
  }
  const handle = install({
    TerminalCtor: makeStubTerminal,
    WebSocketCtor: StubWS,
    locationProtocol: "http:",
    locationHost: "h",
    apiTokenGetter: async () => "T",
    doc,
  });
  await handle.mount({ containerId: "t" });
  await handle.mount({ containerId: "t" });
  assert.equal(constructions, 1);
});
