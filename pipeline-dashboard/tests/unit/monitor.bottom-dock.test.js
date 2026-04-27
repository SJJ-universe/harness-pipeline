// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorBottomDock unit tests.
//
// Verifies the raw-log header (tab + count), newest-first display,
// MAX_DISPLAY cap, empty state, live re-render, destroy.

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, _formatTimeMs, MAX_DISPLAY, TABS } = require("../../public/js/monitor/panels/bottom-dock");
const { createMonitorStore } = require("../../public/js/monitor/store");

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get innerHTML() { return ""; },
    set innerHTML(v) { if (v !== "") throw new Error("stub: innerHTML must be ''"); this.children = []; },
    get className() { return this.classList.toString(); },
    set className(v) { this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _dispatch(name, ev) { for (const fn of (listeners[name] || []).slice()) fn(ev || {}); },
    _firstByClass(cls) {
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) return c;
        if (typeof c._firstByClass === "function") {
          const f = c._firstByClass(cls);
          if (f) return f;
        }
      }
      return null;
    },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
  };
  return el;
}
function makeDoc() { return { createElement: makeStubElement }; }

function pushEnv(store, partial) {
  store.pushEvent(Object.assign(
    { type: "phase_update", runId: "default", ts: 1, scope: "phase", summary: "x", payload: {} },
    partial
  ));
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatTimeMs renders HH:MM:SS.mmm + em-dash on bad input", () => {
  const ts = new Date(2026, 0, 1, 3, 14, 5, 7).getTime();
  assert.equal(_formatTimeMs(ts), "03:14:05.007");
  assert.equal(_formatTimeMs(0), "—");
  assert.equal(_formatTimeMs(NaN), "—");
});

test("MAX_DISPLAY exported and reasonable", () => {
  assert.ok(typeof MAX_DISPLAY === "number");
  assert.ok(MAX_DISPLAY >= 40);
});

// ── header (tab + count) ─────────────────────────────────────────────

test("header always renders the active tab + total event count", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1 });
  pushEnv(store, { ts: 2 });
  pushEnv(store, { ts: 3 });
  create({ root, store, doc });
  const tab = root._firstByClass("bd-tab");
  assert.ok(tab);
  assert.ok(tab.classList.contains("is-active"));
  assert.equal(tab._textContent, "raw event log");
  const count = root._firstByClass("bd-count");
  assert.equal(count._textContent, "3");
});

// ── empty state ──────────────────────────────────────────────────────

test("renders empty state when no events", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const empty = root._firstByClass("bd-empty");
  assert.ok(empty);
  assert.equal(empty._textContent, "이벤트 없음");
  assert.equal(root._firstByClass("bd-list"), null);
});

// ── populated render ─────────────────────────────────────────────────

test("renders newest-first rows with ts + type + runId + summary", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1, type: "phase_update", runId: "A", summary: "first" });
  pushEnv(store, { ts: 2, type: "tool_recorded", runId: "B", summary: "second" });
  pushEnv(store, { ts: 3, scope: "global", runId: undefined, type: "toast", summary: "third" });
  create({ root, store, doc });
  const rows = root._findAllByClass("bd-row");
  assert.equal(rows.length, 3);
  // Newest-first.
  assert.equal(rows[0]._firstByClass("bd-type")._textContent, "toast");
  assert.equal(rows[0]._firstByClass("bd-runId")._textContent, "[—]", "no runId → [—]");
  assert.equal(rows[1]._firstByClass("bd-type")._textContent, "tool_recorded");
  assert.equal(rows[1]._firstByClass("bd-runId")._textContent, "[B]");
  assert.equal(rows[2]._firstByClass("bd-type")._textContent, "phase_update");
  assert.equal(rows[2]._firstByClass("bd-runId")._textContent, "[A]");
});

test("caps row count at MAX_DISPLAY", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore({ maxEvents: MAX_DISPLAY * 4 });
  for (let i = 0; i < MAX_DISPLAY * 2; i++) {
    pushEnv(store, { ts: i + 1, type: "tool_recorded" });
  }
  create({ root, store, doc });
  const rows = root._findAllByClass("bd-row");
  assert.equal(rows.length, MAX_DISPLAY);
});

// ── live re-render ────────────────────────────────────────────────────

test("re-renders when a new event is pushed (count advances)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  assert.equal(root._firstByClass("bd-count")._textContent, "0");
  pushEnv(store, { ts: 1 });
  assert.equal(root._firstByClass("bd-count")._textContent, "1");
  pushEnv(store, { ts: 2 });
  assert.equal(root._firstByClass("bd-count")._textContent, "2");
  assert.equal(root._findAllByClass("bd-row").length, 2);
});

// ── destroy ───────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1 });
  const handle = create({ root, store, doc });
  assert.ok(root.children.length > 0);
  handle.destroy();
  assert.equal(root.children.length, 0);
  pushEnv(store, { ts: 2 });
  assert.equal(root.children.length, 0);
});

// ── input validation ──────────────────────────────────────────────────

test("create throws on bad inputs", () => {
  const store = createMonitorStore();
  const doc = makeDoc();
  assert.throws(() => create({ store, doc }), /root must be an element/);
  assert.throws(() => create({ root: doc.createElement("div"), doc }), /store must be a HarnessMonitorStore/);
  assert.throws(
    () => create({ root: doc.createElement("div"), store, doc: {} }),
    /no document available/
  );
});

// ── Slice MB3: tab orchestration ─────────────────────────────────────

test("TABS exports the canonical tab order", () => {
  assert.deepEqual(TABS, ["raw", "terminal", "replay", "debug"]);
});

test("renders 4 tab buttons in the canonical order", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const tabs = root._findAllByClass("bd-tab");
  assert.equal(tabs.length, 4);
  const labels = tabs.map((t) => t._textContent);
  assert.deepEqual(labels, ["raw event log", "terminal", "replay", "debug"]);
  // Only the first (raw) is active by default.
  assert.ok(tabs[0].classList.contains("is-active"));
  for (let i = 1; i < 4; i++) assert.ok(!tabs[i].classList.contains("is-active"));
});

test("setTab() switches active tab + repaints body", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1 });
  const handle = create({ root, store, doc });
  assert.equal(handle.getActiveTab(), "raw");
  // raw body has rows.
  assert.equal(root._findAllByClass("bd-row").length, 1);
  // Switch to debug — raw body should be torn down, debug pre rendered.
  handle.setTab("debug");
  assert.equal(handle.getActiveTab(), "debug");
  assert.equal(root._findAllByClass("bd-row").length, 0);
  assert.ok(root._firstByClass("bd-debug"));
});

test("clicking a tab button invokes setTab", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  // Find the replay tab button + click.
  const replayBtn = root._findAllByClass("bd-tab").find((t) => t.attributes["data-tab"] === "replay");
  assert.ok(replayBtn);
  replayBtn._dispatch("click", {});
  assert.equal(handle.getActiveTab(), "replay");
  assert.ok(root._firstByClass("bd-replay-wrap"));
});

test("setTab on unknown name is a no-op", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  handle.setTab("nonsense");
  assert.equal(handle.getActiveTab(), "raw");
});

test("initialTab option lets the dock open on a non-default tab", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc, initialTab: "debug" });
  assert.equal(handle.getActiveTab(), "debug");
  // raw rows aren't rendered, debug pre is.
  assert.ok(root._firstByClass("bd-debug"));
  assert.equal(root._firstByClass("bd-list"), null);
});

// ── tab-specific rendering ───────────────────────────────────────────

test("terminal tab without xterm/WebSocket shows the unavailable stub", () => {
  // Test env has no xterm / no global WebSocket — stub message expected.
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({
    root, store, doc,
    TerminalCtor: null, WebSocketCtor: null,
  });
  handle.setTab("terminal");
  const stub = root._firstByClass("bd-empty");
  assert.ok(stub);
  assert.match(stub._textContent, /터미널을 사용할 수 없습니다/);
});

test("terminal tab with stub xterm + ws lifecycle wires up + tears down on switch", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();

  let termOpened = false;
  let termDisposed = false;
  let wsClosed = false;
  let wsConstructed = null;
  function StubTerminal() {
    return {
      open(_) { termOpened = true; },
      writeln() {}, write() {},
      onData(_) {},
      loadAddon() {},
      dispose() { termDisposed = true; },
    };
  }
  function StubWS(url) {
    wsConstructed = url;
    this.readyState = 1;
    this.close = () => { wsClosed = true; };
    this.send = () => {};
    setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
  }

  const handle = create({
    root, store, doc,
    TerminalCtor: StubTerminal,
    WebSocketCtor: StubWS,
    apiToken: "tok-abc",
    locationProtocol: "https:",
    locationHost: "127.0.0.1:4201",
  });
  handle.setTab("terminal");
  assert.equal(termOpened, true, "term.open was called");
  assert.match(wsConstructed, /^wss:\/\/127\.0\.0\.1:4201\/terminal\?token=tok-abc$/);
  // Switch away → both should be torn down.
  handle.setTab("raw");
  assert.equal(termDisposed, true);
  assert.equal(wsClosed, true);
});

// ── replay tab ───────────────────────────────────────────────────────

test("replay tab lists runs from snapshot.runs + click selects", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "active", templateId: "general" });
  store.upsertRun("session-2", { status: "idle", templateId: null });
  const handle = create({ root, store, doc });
  handle.setTab("replay");
  const items = root._findAllByClass("bd-replay-item");
  assert.equal(items.length, 2);
  // Click the second run → selectRun fires.
  items[1]._dispatch("click", {});
  assert.equal(store.snapshot().selectedRunId, "session-2");
  // Re-render should now mark it selected.
  // (store.selectRun publishes → render runs again)
  const refreshedItems = root._findAllByClass("bd-replay-item");
  const targetItem = refreshedItems.find((li) => li.attributes["data-run-id"] === "session-2");
  assert.ok(targetItem.classList.contains("is-selected"));
});

test("replay tab Open run history button delegates to legacy element if present", () => {
  // Provide a fake global document with a legacy button so the bridge
  // logic can find + click it.
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let legacyClicked = 0;
  const fakeLegacy = { click() { legacyClicked++; } };
  const savedDoc = globalThis.document;
  globalThis.document = { getElementById: (id) => id === "btn-open-run-history" ? fakeLegacy : null };
  try {
    const handle = create({ root, store, doc });
    handle.setTab("replay");
    const btn = root._firstByClass("bd-btn");
    btn._dispatch("click", {});
    assert.equal(legacyClicked, 1);
  } finally {
    globalThis.document = savedDoc;
  }
});

test("replay tab empty state when no runs", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  handle.setTab("replay");
  // empty placeholder under bd-replay-wrap
  assert.ok(root._firstByClass("bd-empty"));
  assert.match(root._firstByClass("bd-empty")._textContent, /활성 런 없음/);
});

// ── debug tab ────────────────────────────────────────────────────────

test("debug tab dumps store.snapshot() as JSON", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "active" });
  const handle = create({ root, store, doc });
  handle.setTab("debug");
  const pre = root._firstByClass("bd-debug");
  assert.ok(pre);
  // Snapshot serialised — should contain the runId we just upserted.
  assert.match(pre._textContent, /"default"/);
  assert.match(pre._textContent, /"runs"/);
});

test("debug tab re-renders on store publish", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  handle.setTab("debug");
  const before = root._firstByClass("bd-debug")._textContent;
  store.bumpCounter("warnings");
  const after = root._firstByClass("bd-debug")._textContent;
  assert.notEqual(before, after);
  assert.match(after, /"warnings": 1/);
});

// ── header count badge updates regardless of active tab ─────────────

test("header count badge advances even when active tab isn't raw", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  handle.setTab("debug");
  pushEnv(store, { ts: 1 });
  pushEnv(store, { ts: 2 });
  // The header subscriber updates the count even though debug is the
  // active tab.
  assert.equal(root._firstByClass("bd-count")._textContent, "2");
});
