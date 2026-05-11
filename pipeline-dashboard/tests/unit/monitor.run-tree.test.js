// Slice MA4 (Phase D, 2026-04-27) — OrchestratorMonitorRunTree unit tests.
//
// Hand-rolled DOM stub (matches global-bar / focus-trap pattern). Only
// the surface the panel actually touches is implemented; that keeps the
// test reading like a list of "what the user sees".

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, _statusClass, _metaLine } = require("../../public/js/monitor/panels/run-tree");
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
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
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
  };
  return el;
}

function makeDoc() { return { createElement: makeStubElement }; }

function findItemByRunId(root, runId) {
  return root._findAllByClass("rt-item").find((li) => li.attributes["data-run-id"] === runId) || null;
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_statusClass maps status → class suffix", () => {
  assert.equal(_statusClass("active"), "is-active");
  assert.equal(_statusClass("paused"), "is-paused");
  assert.equal(_statusClass("idle"), "is-idle");
  assert.equal(_statusClass(undefined), "is-idle");
  assert.equal(_statusClass("garbage"), "is-idle");
});

test("_metaLine formats template + phase, omits missing pieces", () => {
  assert.equal(_metaLine({ templateId: "general", phase: "B" }), "general · phase B");
  assert.equal(_metaLine({ templateId: "general" }), "general");
  assert.equal(_metaLine({ phase: "C" }), "phase C");
  assert.equal(_metaLine({}), "");
  assert.equal(_metaLine(null), "");
});

// ── empty case ────────────────────────────────────────────────────────

test("create renders the empty state when no runs", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const empty = root._firstByClass("rt-empty");
  assert.ok(empty, "empty state present");
  assert.equal(empty._textContent, "실행 중인 런 없음");
  assert.equal(root._firstByClass("rt-list"), null, "list not rendered when empty");
});

// ── populated case ────────────────────────────────────────────────────

test("create renders one li per run with status + label + meta", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "active", templateId: "general", phase: "B" });
  store.upsertRun("session-2", { status: "idle" });
  store.upsertRun("session-3", { status: "paused", phase: "D" });
  create({ root, store, doc });

  const items = root._findAllByClass("rt-item");
  assert.equal(items.length, 3);
  // Order matches insertion order (Map iteration).
  const ids = items.map((li) => li.attributes["data-run-id"]);
  assert.deepEqual(ids, ["default", "session-2", "session-3"]);

  // Item 0: status active, label "default", meta "general · phase B".
  const i0 = items[0];
  const dot0 = i0._firstByClass("rt-status");
  assert.ok(dot0.classList.contains("is-active"));
  const id0 = i0._firstByClass("rt-id");
  assert.equal(id0._textContent, "default");
  const meta0 = i0._firstByClass("rt-meta");
  assert.equal(meta0._textContent, "general · phase B");

  // Item 1: idle, no meta line because no template/phase.
  const i1 = items[1];
  assert.ok(i1._firstByClass("rt-status").classList.contains("is-idle"));
  assert.equal(i1._firstByClass("rt-meta"), null);

  // Item 2: paused, meta "phase D".
  const i2 = items[2];
  assert.ok(i2._firstByClass("rt-status").classList.contains("is-paused"));
  assert.equal(i2._firstByClass("rt-meta")._textContent, "phase D");
});

// ── selection highlight ──────────────────────────────────────────────

test("create highlights the selected run + sets aria-selected/tabindex", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "active" });
  store.upsertRun("b", { status: "idle" });
  store.selectRun("b");
  create({ root, store, doc });
  const a = findItemByRunId(root, "a");
  const b = findItemByRunId(root, "b");
  assert.ok(!a.classList.contains("is-selected"));
  assert.ok(b.classList.contains("is-selected"));
  assert.equal(a.attributes["aria-selected"], "false");
  assert.equal(b.attributes["aria-selected"], "true");
  assert.equal(a.attributes.tabindex, "-1");
  assert.equal(b.attributes.tabindex, "0", "selected item is keyboard-focusable");
});

// ── click + keyboard → onSelect ──────────────────────────────────────

test("clicking an item invokes onSelect with the runId", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "idle" });
  store.upsertRun("b", { status: "active" });
  let selected = null;
  create({ root, store, doc, onSelect(id) { selected = id; } });
  const b = findItemByRunId(root, "b");
  b._dispatch("click", {});
  assert.equal(selected, "b");
});

test("Enter / Space key on an item invokes onSelect + prevents default", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "idle" });
  let selected = null;
  let prevented = false;
  create({ root, store, doc, onSelect(id) { selected = id; } });
  const a = findItemByRunId(root, "a");
  a._dispatch("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  assert.equal(selected, "a");
  assert.equal(prevented, true);

  selected = null; prevented = false;
  a._dispatch("keydown", { key: " ", preventDefault() { prevented = true; } });
  assert.equal(selected, "a");
  assert.equal(prevented, true);

  // Other keys: no-op.
  selected = null;
  a._dispatch("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.equal(selected, null);
});

test("onSelect throw is swallowed (panel keeps working)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "idle" });
  create({ root, store, doc, onSelect() { throw new Error("user crash"); } });
  const a = findItemByRunId(root, "a");
  assert.doesNotThrow(() => a._dispatch("click", {}));
});

// ── live re-render on store publish ──────────────────────────────────

test("re-renders when the store publishes (new run appears in list)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  // Initially empty.
  assert.ok(root._firstByClass("rt-empty"));
  // Add a run.
  store.upsertRun("a", { status: "active" });
  assert.equal(root._firstByClass("rt-empty"), null);
  assert.equal(root._findAllByClass("rt-item").length, 1);
});

test("re-renders when selectedRunId changes", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "active" });
  store.upsertRun("b", { status: "idle" });
  create({ root, store, doc });
  // No selection initially → neither item is selected.
  assert.ok(!findItemByRunId(root, "a").classList.contains("is-selected"));
  assert.ok(!findItemByRunId(root, "b").classList.contains("is-selected"));
  store.selectRun("a");
  assert.ok(findItemByRunId(root, "a").classList.contains("is-selected"));
  store.selectRun("b");
  assert.ok(findItemByRunId(root, "b").classList.contains("is-selected"));
  assert.ok(!findItemByRunId(root, "a").classList.contains("is-selected"));
});

// ── destroy ───────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "active" });
  const handle = create({ root, store, doc });
  assert.ok(root._findAllByClass("rt-item").length > 0);
  handle.destroy();
  assert.equal(root.children.length, 0);
  store.upsertRun("b", { status: "active" });
  assert.equal(root.children.length, 0, "no resurrection after destroy");
});

// ── input validation ──────────────────────────────────────────────────

test("create throws on bad inputs", () => {
  const store = createMonitorStore();
  const doc = makeDoc();
  assert.throws(() => create({ store, doc }), /root must be an element/);
  assert.throws(() => create({ root: doc.createElement("div"), doc }), /store must be a OrchestratorMonitorStore/);
  assert.throws(
    () => create({ root: doc.createElement("div"), store, doc: {} }),
    /no document available/
  );
});
