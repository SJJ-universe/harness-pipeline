// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorTimeline unit tests.
//
// Hand-rolled DOM stub. Exercises filter contract (focused run + global
// passthrough), newest-first display cap, click/Enter/Space dispatch,
// selection highlight via reference equality, live re-render, destroy.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  create,
  _formatTime,
  _filterEvents,
  _isSelectedEvent,
  MAX_DISPLAY,
} = require("../../public/js/monitor/panels/timeline");
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

function pushEnv(store, partial) {
  // Push an envelope shaped the way HarnessMonitorNormalizer produces.
  store.pushEvent(Object.assign(
    { type: "phase_update", runId: "default", ts: 1, scope: "phase", summary: "x", payload: {} },
    partial
  ));
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatTime renders HH:MM:SS for valid ts and em-dash for bad", () => {
  const ts = new Date(2026, 0, 1, 14, 7, 9).getTime();
  assert.equal(_formatTime(ts), "14:07:09");
  assert.equal(_formatTime(0), "—");
  assert.equal(_formatTime(NaN), "—");
});

test("_filterEvents returns ALL when focusRunId is null", () => {
  const events = [
    { runId: "a", scope: "phase" },
    { runId: "b", scope: "tool" },
    { scope: "global" },
  ];
  assert.deepEqual(_filterEvents(events, null), events);
});

test("_filterEvents passes through scope:global even when focused", () => {
  const a = { runId: "a", scope: "phase" };
  const b = { runId: "b", scope: "tool" };
  const g = { scope: "global" };
  const out = _filterEvents([a, b, g], "a");
  assert.deepEqual(out, [a, g], "focused run keeps its events + globals; other runs dropped");
});

test("_filterEvents skips falsy entries", () => {
  assert.deepEqual(_filterEvents([null, undefined, { scope: "global" }], null), [{ scope: "global" }]);
  assert.deepEqual(_filterEvents(null, null), []);
  assert.deepEqual(_filterEvents("garbage", null), []);
});

test("_isSelectedEvent matches by reference for kind:'event'", () => {
  const env = { type: "x" };
  assert.equal(_isSelectedEvent({ kind: "event", payload: env }, env), true);
  assert.equal(_isSelectedEvent({ kind: "event", payload: { type: "x" } }, env), false);
  assert.equal(_isSelectedEvent({ kind: "child", payload: env }, env), false);
  assert.equal(_isSelectedEvent(null, env), false);
});

test("MAX_DISPLAY exported and reasonable", () => {
  assert.ok(typeof MAX_DISPLAY === "number");
  assert.ok(MAX_DISPLAY >= 20 && MAX_DISPLAY <= 200);
});

// ── empty state ──────────────────────────────────────────────────────

test("create renders empty state when no events", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const empty = root._firstByClass("tl-empty");
  assert.ok(empty);
  assert.equal(empty._textContent, "이벤트 없음");
});

test("empty state varies when a run is focused but has no events", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("focused", {});
  store.selectRun("focused");
  // events for OTHER runs should not satisfy the focused-run filter.
  pushEnv(store, { runId: "other", type: "phase_update", scope: "phase" });
  create({ root, store, doc });
  const empty = root._firstByClass("tl-empty");
  assert.ok(empty);
  assert.match(empty._textContent, /이 런의 이벤트 없음/);
});

// ── populated render + filter behaviour ──────────────────────────────

test("renders newest-first rows for the focused run + global events", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("focused", {});
  store.selectRun("focused");
  pushEnv(store, { ts: 1, runId: "focused", type: "phase_update", scope: "phase" });
  pushEnv(store, { ts: 2, runId: "other", type: "tool_recorded", scope: "tool" });
  pushEnv(store, { ts: 3, scope: "global", type: "toast" });
  pushEnv(store, { ts: 4, runId: "focused", type: "tool_recorded", scope: "tool" });
  create({ root, store, doc });

  const rows = root._findAllByClass("tl-row");
  // Filter keeps focused (ts 1, 4) + global (ts 3); drops ts 2.
  assert.equal(rows.length, 3);
  // Newest-first: ts 4, ts 3, ts 1.
  assert.equal(rows[0].attributes["data-type"], "tool_recorded");
  assert.equal(rows[1].attributes["data-type"], "toast");
  assert.equal(rows[2].attributes["data-type"], "phase_update");
});

test("renders cap at MAX_DISPLAY rows", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  // larger ring so we can push past MAX_DISPLAY
  const store = createMonitorStore({ maxEvents: MAX_DISPLAY * 4 });
  for (let i = 0; i < MAX_DISPLAY * 2; i++) {
    pushEnv(store, { ts: i + 1, type: "tool_recorded", scope: "tool" });
  }
  create({ root, store, doc });
  const rows = root._findAllByClass("tl-row");
  assert.equal(rows.length, MAX_DISPLAY);
});

// ── selection highlight + click/keyboard dispatch ────────────────────

test("clicking a row invokes onSelect with the envelope", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let captured = null;
  pushEnv(store, { ts: 1, type: "phase_update", scope: "phase", summary: "A" });
  pushEnv(store, { ts: 2, type: "tool_recorded", scope: "tool", summary: "B" });
  create({ root, store, doc, onSelect(env) { captured = env; } });
  const rows = root._findAllByClass("tl-row");
  rows[1]._dispatch("click", {});  // newest-first, [0]=tool_recorded, [1]=phase_update
  assert.ok(captured);
  assert.equal(captured.summary, "A");
});

test("Enter / Space on a row calls onSelect + preventDefault", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let captured = null;
  let prevented = false;
  pushEnv(store, { ts: 1, type: "phase_update", scope: "phase", summary: "X" });
  create({ root, store, doc, onSelect(env) { captured = env; } });
  const row = root._findAllByClass("tl-row")[0];
  row._dispatch("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  assert.ok(captured);
  assert.equal(prevented, true);

  captured = null; prevented = false;
  row._dispatch("keydown", { key: " ", preventDefault() { prevented = true; } });
  assert.ok(captured);
  assert.equal(prevented, true);

  captured = null;
  row._dispatch("keydown", { key: "Tab", preventDefault() {} });
  assert.equal(captured, null, "non-activation keys are ignored");
});

test("onSelect throw is swallowed (panel keeps working)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1 });
  create({ root, store, doc, onSelect() { throw new Error("user crash"); } });
  const row = root._findAllByClass("tl-row")[0];
  assert.doesNotThrow(() => row._dispatch("click", {}));
});

test("selected envelope gets is-selected highlight (via store.selectItem)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1, type: "phase_update", scope: "phase" });
  pushEnv(store, { ts: 2, type: "tool_recorded", scope: "tool" });
  create({ root, store, doc });
  // Pick the second-newest envelope (ts:1). Snapshot returns events in
  // insertion order; the newest is at the end.
  const events = store.snapshot().events;
  store.selectItem("event", events[0]);
  const rows = root._findAllByClass("tl-row");
  // Newest-first: rows[0] = ts:2 (tool_recorded), rows[1] = ts:1 (phase_update).
  assert.ok(!rows[0].classList.contains("is-selected"));
  assert.ok(rows[1].classList.contains("is-selected"));
});

// ── live re-render on store publish ──────────────────────────────────

test("re-renders when a new event is pushed", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  assert.ok(root._firstByClass("tl-empty"));
  pushEnv(store, { ts: 1 });
  assert.equal(root._findAllByClass("tl-row").length, 1);
});

// ── destroy ───────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { ts: 1 });
  const handle = create({ root, store, doc });
  assert.ok(root._findAllByClass("tl-row").length > 0);
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
