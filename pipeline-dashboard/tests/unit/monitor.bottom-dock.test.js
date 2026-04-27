// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorBottomDock unit tests.
//
// Verifies the raw-log header (tab + count), newest-first display,
// MAX_DISPLAY cap, empty state, live re-render, destroy.

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, _formatTimeMs, MAX_DISPLAY } = require("../../public/js/monitor/panels/bottom-dock");
const { createMonitorStore } = require("../../public/js/monitor/store");

function makeStubElement(tag) {
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
    addEventListener() {},
    removeEventListener() {},
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
