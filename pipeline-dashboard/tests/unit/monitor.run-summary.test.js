// Slice MA4 (Phase D, 2026-04-27) — HarnessMonitorRunSummary unit tests.
//
// Hand-rolled DOM stub. The summary is a "selected run detail card" with
// a header (id + status pill) and a definition list of metadata, plus an
// empty state when nothing is selected.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  create,
  _formatRelative,
  _statusClass,
  _selectedRun,
} = require("../../public/js/monitor/panels/run-summary");
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
    _firstByTag(tag) {
      const t = String(tag).toUpperCase();
      for (const c of this.children) {
        if (c.tagName === t) return c;
        if (typeof c._firstByTag === "function") {
          const f = c._firstByTag(tag);
          if (f) return f;
        }
      }
      return null;
    },
    _findAllByTag(tag) {
      const t = String(tag).toUpperCase();
      const out = [];
      for (const c of this.children) {
        if (c.tagName === t) out.push(c);
        if (typeof c._findAllByTag === "function") out.push(...c._findAllByTag(tag));
      }
      return out;
    },
  };
  return el;
}

function makeDoc() { return { createElement: makeStubElement }; }

function findKvByLabel(card, label) {
  const dts = card._findAllByTag("dt");
  for (let i = 0; i < dts.length; i++) {
    if (dts[i]._textContent === label) {
      // The matching dd is the next sibling within the parent dl.
      const dl = dts[i].parentNode;
      const idx = dl.children.indexOf(dts[i]);
      return { dt: dts[i], dd: dl.children[idx + 1] };
    }
  }
  return null;
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatRelative covers 방금/초/분/시간 ranges + bad input", () => {
  const NOW = 1_700_000_000_000;
  assert.equal(_formatRelative(NOW, NOW), "방금 전");
  assert.equal(_formatRelative(NOW - 800, NOW), "방금 전");
  assert.equal(_formatRelative(NOW - 1500, NOW), "1초 전");
  assert.equal(_formatRelative(NOW - 45_000, NOW), "45초 전");
  assert.equal(_formatRelative(NOW - 60_000, NOW), "1분 전");
  assert.equal(_formatRelative(NOW - 75_000, NOW), "1분 15초 전");
  assert.equal(_formatRelative(NOW - 3_600_000, NOW), "1시간 전");
  assert.equal(_formatRelative(NOW - (3725 * 1000), NOW), "1시간 2분 전");
  assert.equal(_formatRelative(0, NOW), "—");
  assert.equal(_formatRelative(-5, NOW), "—");
  assert.equal(_formatRelative(NaN, NOW), "—");
});

test("_statusClass mirrors the run-tree mapping", () => {
  assert.equal(_statusClass("active"), "is-active");
  assert.equal(_statusClass("paused"), "is-paused");
  assert.equal(_statusClass("idle"), "is-idle");
  assert.equal(_statusClass(undefined), "is-idle");
});

test("_selectedRun returns the snapshot's selected run object or null", () => {
  assert.equal(_selectedRun(null), null);
  assert.equal(_selectedRun({}), null);
  assert.equal(_selectedRun({ selectedRunId: "a", runs: {} }), null);
  assert.deepEqual(
    _selectedRun({ selectedRunId: "a", runs: { a: { id: "a", status: "active" } } }),
    { id: "a", status: "active" }
  );
});

// ── empty state ───────────────────────────────────────────────────────

test("empty state when no run is selected", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const empty = root._firstByClass("rs-empty");
  assert.ok(empty);
  assert.match(empty._textContent, /선택된 런 없음/);
});

test("empty state when selectedRunId points to an unknown run", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Force selection of an unknown run via _internal (selectRun rejects unknown).
  store.upsertRun("real", {});
  store.selectRun("real");
  store._internal().state.selectedRunId = "ghost"; // bypass guard
  create({ root, store, doc });
  const empty = root._firstByClass("rs-empty");
  assert.ok(empty);
  assert.match(empty._textContent, /선택된 런\(ghost\)/);
});

// ── populated render ─────────────────────────────────────────────────

test("renders the selected run's id + status pill + meta dl", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const NOW = 1_700_000_000_000;
  store.upsertRun("default", {
    status: "active",
    templateId: "general",
    phase: "B",
    phaseIdx: 1,
    startedAt: NOW - 75_000,
    lastEventAt: NOW - 5_000,
  });
  store.selectRun("default");
  create({ root, store, doc, now: () => NOW });

  const card = root._firstByClass("rs-card");
  assert.ok(card, "card rendered");

  // Header: id + status pill.
  const idEl = card._firstByClass("rs-id");
  assert.equal(idEl._textContent, "default");
  const statusEl = card._firstByClass("rs-status");
  assert.equal(statusEl._textContent, "active");
  assert.ok(statusEl.classList.contains("is-active"));

  // Meta dl: template + phase + started + last event.
  const tmpl = findKvByLabel(card, "template");
  assert.equal(tmpl.dd._textContent, "general");
  const phase = findKvByLabel(card, "phase");
  assert.equal(phase.dd._textContent, "B (idx 1)");
  const started = findKvByLabel(card, "started");
  assert.equal(started.dd._textContent, "1분 15초 전");
  const lastEvent = findKvByLabel(card, "last event");
  assert.equal(lastEvent.dd._textContent, "5초 전");
});

test("missing fields render as em-dash", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "idle" });
  store.selectRun("default");
  create({ root, store, doc, now: () => 1_700_000_000_000 });

  const card = root._firstByClass("rs-card");
  assert.equal(findKvByLabel(card, "template").dd._textContent, "—");
  assert.equal(findKvByLabel(card, "phase").dd._textContent, "—");
  assert.equal(findKvByLabel(card, "started").dd._textContent, "—");
  // lastEventAt was auto-stamped by upsertRun, so it shows a relative time
  // — we don't assert the exact value here since now() is fixed but the
  // upsertRun timestamp was Date.now(). Just confirm it's not "—".
  assert.notEqual(findKvByLabel(card, "last event").dd._textContent, "—");
});

// ── live re-render ───────────────────────────────────────────────────

test("re-renders on store publish (selection change → different run)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "active", templateId: "X" });
  store.upsertRun("b", { status: "paused", templateId: "Y" });
  store.selectRun("a");
  create({ root, store, doc });

  let id = root._firstByClass("rs-id");
  assert.equal(id._textContent, "a");
  let tmpl = findKvByLabel(root, "template");
  assert.equal(tmpl.dd._textContent, "X");

  store.selectRun("b");

  id = root._firstByClass("rs-id");
  assert.equal(id._textContent, "b");
  tmpl = findKvByLabel(root, "template");
  assert.equal(tmpl.dd._textContent, "Y");
  // status pill should now reflect paused.
  assert.ok(root._firstByClass("rs-status").classList.contains("is-paused"));
});

test("re-renders when the same run's data changes (phase update)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "active", phase: "B", phaseIdx: 1 });
  store.selectRun("default");
  create({ root, store, doc });
  assert.equal(findKvByLabel(root, "phase").dd._textContent, "B (idx 1)");
  store.upsertRun("default", { phase: "C", phaseIdx: 2 });
  assert.equal(findKvByLabel(root, "phase").dd._textContent, "C (idx 2)");
});

// ── destroy ──────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("a", { status: "active" });
  store.selectRun("a");
  const handle = create({ root, store, doc });
  assert.ok(root.children.length > 0);
  handle.destroy();
  assert.equal(root.children.length, 0);
  store.upsertRun("a", { status: "paused" });
  assert.equal(root.children.length, 0, "no resurrection after destroy");
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
