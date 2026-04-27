// Slice MA3 (Phase D, 2026-04-27) — HarnessMonitorGlobalBar unit tests.
//
// Pattern matches focus-trap.test.js / runHistory.test.js — hand-rolled
// DOM stub instead of jsdom (which isn't a project dependency). The stub
// implements only the DOM surface the panel actually touches:
// createElement, appendChild, innerHTML="", setAttribute, addEventListener,
// classList, textContent, className.

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, _formatUptime, _activeRunCount } = require("../../public/js/monitor/panels/global-bar");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub ───────────────────────────────────────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); return this; },
      remove(c) { this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get innerHTML() { return ""; },
    set innerHTML(v) {
      // Tests only ever set "" to clear — anything else means panel is
      // doing something unexpected.
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _dispatch(name, ev) {
      for (const fn of (listeners[name] || []).slice()) fn(ev || {});
    },
    // Test-only walker — finds the first descendant whose textContent matches.
    _findByText(text) {
      for (const c of this.children) {
        if (c._textContent === text) return c;
        if (typeof c._findByText === "function") {
          const found = c._findByText(text);
          if (found) return found;
        }
      }
      return null;
    },
    // Test-only walker — collects all descendants matching a class name.
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") {
          out.push(...c._findAllByClass(cls));
        }
      }
      return out;
    },
  };
  return el;
}

function makeStubDoc() {
  return { createElement: makeStubElement };
}

// ── helpers ──────────────────────────────────────────────────────────

function findCellByLabel(root, label) {
  const cells = root._findAllByClass("gb-cell");
  for (const c of cells) {
    const labelEl = c.children.find((ch) => ch.classList && ch.classList.contains("gb-cell-label"));
    if (labelEl && labelEl._textContent === label) {
      const valueEl = c.children.find((ch) => ch.classList && ch.classList.contains("gb-cell-value"));
      return { cell: c, label: labelEl, value: valueEl };
    }
  }
  return null;
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatUptime handles seconds / minutes / hours / nonsense", () => {
  assert.equal(_formatUptime(0), "0s");
  assert.equal(_formatUptime(45), "45s");
  assert.equal(_formatUptime(60), "1m");
  assert.equal(_formatUptime(75), "1m 15s");
  assert.equal(_formatUptime(3600), "1h");
  assert.equal(_formatUptime(3725), "1h 2m");
  assert.equal(_formatUptime(NaN), "—");
  assert.equal(_formatUptime(-1), "—");
});

test("_activeRunCount counts only runs whose status === 'active'", () => {
  assert.equal(_activeRunCount(null), 0);
  assert.equal(_activeRunCount({}), 0);
  assert.equal(_activeRunCount({ runs: {} }), 0);
  assert.equal(_activeRunCount({
    runs: {
      a: { status: "active" },
      b: { status: "idle" },
      c: { status: "active" },
      d: { status: "paused" },
    },
  }), 2);
});

// ── render ────────────────────────────────────────────────────────────

test("create renders the canonical cells from an empty snapshot", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });

  // server cell shows em-dash when no pid
  const server = findCellByLabel(root, "server");
  assert.ok(server, "server cell present");
  assert.equal(server.value._textContent, "—");

  // uptime is "—" because server is null
  const uptime = findCellByLabel(root, "uptime");
  assert.equal(uptime.value._textContent, "—");

  // runs are 0/0 when fresh
  const runs = findCellByLabel(root, "runs");
  assert.equal(runs.value._textContent, "0 / 0");

  // children are 0
  const children = findCellByLabel(root, "children");
  assert.equal(children.value._textContent, "0");
  // and not warning when 0
  assert.ok(!children.value.classList.contains("is-warn"));

  // critical cell is omitted when counter is 0
  assert.equal(findCellByLabel(root, "critical"), null);
});

test("create renders populated state from a hydrated snapshot", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setServerSummary({ pid: 9001, uptime: 3725, bootTime: "2026-04-27T01:00:00Z" });
  store.setActiveChildren([{ pid: 1, label: "codex" }, { pid: 2, label: "claude" }]);
  store.upsertRun("default", { status: "active" });
  store.upsertRun("session-2", { status: "idle" });
  store.selectRun("default");
  store.bumpCounter("critical", 3);

  create({ root, store, doc });

  const server = findCellByLabel(root, "server");
  assert.equal(server.value._textContent, "pid 9001");
  assert.equal(server.cell.attributes.title, "boot 2026-04-27T01:00:00Z");

  const uptime = findCellByLabel(root, "uptime");
  assert.equal(uptime.value._textContent, "1h 2m");

  const runs = findCellByLabel(root, "runs");
  assert.equal(runs.value._textContent, "1 / 2");
  assert.equal(runs.cell.attributes.title, "selected: default");

  const children = findCellByLabel(root, "children");
  assert.equal(children.value._textContent, "2");
  assert.ok(children.value.classList.contains("is-warn"), "tone=warn when >0 children");

  const critical = findCellByLabel(root, "critical");
  assert.ok(critical, "critical cell shown when counter > 0");
  assert.equal(critical.value._textContent, "3");
  assert.ok(critical.value.classList.contains("is-error"));
});

// ── live updates from store ────────────────────────────────────────────

test("create re-renders when the store publishes", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });

  // Before update: 0 runs.
  let runs = findCellByLabel(root, "runs");
  assert.equal(runs.value._textContent, "0 / 0");

  store.upsertRun("a", { status: "active" });

  // After update: 1/1, full re-render produced new elements.
  runs = findCellByLabel(root, "runs");
  assert.equal(runs.value._textContent, "1 / 1");
});

// ── close button ──────────────────────────────────────────────────────

test("create wires a Close button that calls onClose", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let closeCalled = 0;
  create({
    root, store, doc,
    onClose() { closeCalled++; },
  });
  // Find the close button — only <button> with class gb-btn.
  const buttons = root._findAllByClass("gb-btn");
  assert.equal(buttons.length, 1);
  buttons[0]._dispatch("click", {});
  assert.equal(closeCalled, 1);
});

test("close button without an onClose callback is harmless", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const buttons = root._findAllByClass("gb-btn");
  assert.doesNotThrow(() => buttons[0]._dispatch("click", {}));
});

test("onClose throw is swallowed (panel must keep working)", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({
    root, store, doc,
    onClose() { throw new Error("user code is angry"); },
  });
  const buttons = root._findAllByClass("gb-btn");
  assert.doesNotThrow(() => buttons[0]._dispatch("click", {}));
});

// ── destroy unsubscribes + clears DOM ─────────────────────────────────

test("destroy unsubscribes + clears the root", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = create({ root, store, doc });
  // Sanity: rendered content present.
  assert.ok(root.children.length > 0);
  handle.destroy();
  // Root cleared.
  assert.equal(root.children.length, 0);
  // Subsequent store updates do NOT re-render (subscription gone).
  store.upsertRun("x", { status: "active" });
  assert.equal(root.children.length, 0, "no resurrection after destroy");
});

// ── input validation ──────────────────────────────────────────────────

test("create throws on bad inputs", () => {
  const store = createMonitorStore();
  const doc = makeStubDoc();
  assert.throws(() => create({ store, doc }), /root must be an element/);
  assert.throws(() => create({ root: doc.createElement("div"), doc }), /store must be a HarnessMonitorStore/);
  assert.throws(
    () => create({ root: doc.createElement("div"), store, doc: {} }),
    /no document available/
  );
});
