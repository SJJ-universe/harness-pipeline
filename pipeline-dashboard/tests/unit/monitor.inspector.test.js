// Slice MA5 (Phase D, 2026-04-27) — OrchestratorMonitorInspector unit tests.
//
// Hand-rolled DOM stub. Verifies the empty state, the kind:"event"
// renderer (header + meta dl + payload pre), the generic fallback for
// unknown kinds, safe stringify against unserializable payloads, and
// live re-render via store.

const test = require("node:test");
const assert = require("node:assert/strict");
const { create, _formatTime, _safeStringify } = require("../../public/js/monitor/panels/inspector");
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
      const dl = dts[i].parentNode;
      const idx = dl.children.indexOf(dts[i]);
      return { dt: dts[i], dd: dl.children[idx + 1] };
    }
  }
  return null;
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatTime renders HH:MM:SS.mmm + em-dash on bad input", () => {
  const ts = new Date(2026, 0, 1, 14, 7, 9, 234).getTime();
  assert.equal(_formatTime(ts), "14:07:09.234");
  assert.equal(_formatTime(0), "—");
  assert.equal(_formatTime(NaN), "—");
});

test("_safeStringify pretty-prints objects and tolerates circular refs", () => {
  assert.equal(_safeStringify({ a: 1 }), "{\n  \"a\": 1\n}");
  assert.equal(_safeStringify(null), "null");
  // Circular structure → falls through to String() / "(unserializable)".
  const cyc = {}; cyc.self = cyc;
  const out = _safeStringify(cyc);
  assert.equal(typeof out, "string");
  // Negative regex assertion via plain JS (assert.notMatch lands in Node 16+
  // but isn't always available in legacy runners). The string must NOT be
  // a JSON tree — i.e. shouldn't contain a quoted "self" field.
  assert.equal(/"self"/.test(out), false, "did not produce a JSON tree");
});

// ── empty state ──────────────────────────────────────────────────────

test("renders empty state when nothing is selected", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const empty = root._firstByClass("ip-empty");
  assert.ok(empty);
  assert.match(empty._textContent, /선택된 항목 없음/);
});

// ── event kind ───────────────────────────────────────────────────────

test("renders event card with type + scope + meta + payload", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const ts = new Date(2026, 0, 1, 9, 0, 1, 5).getTime();
  const env = {
    type: "phase_update",
    runId: "default",
    ts,
    scope: "phase",
    summary: "phase_update B active",
    payload: { phase: "B", status: "active" },
  };
  store.selectItem("event", env);
  create({ root, store, doc });

  const card = root._firstByClass("ip-card");
  assert.ok(card);
  assert.equal(card._firstByClass("ip-type")._textContent, "phase_update");
  assert.equal(card._firstByClass("ip-scope")._textContent, "phase");
  assert.equal(findKvByLabel(card, "runId").dd._textContent, "default");
  assert.equal(findKvByLabel(card, "ts").dd._textContent, "09:00:01.005");
  assert.equal(findKvByLabel(card, "summary").dd._textContent, "phase_update B active");
  const pre = card._firstByClass("ip-payload");
  assert.ok(pre);
  assert.match(pre._textContent, /"phase": "B"/);
  assert.match(pre._textContent, /"status": "active"/);
});

test("event with missing fields renders sane fallbacks", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("event", { type: "x", scope: "unknown", payload: null });
  create({ root, store, doc });
  const card = root._firstByClass("ip-card");
  assert.equal(findKvByLabel(card, "runId").dd._textContent, "—");
  assert.equal(findKvByLabel(card, "ts").dd._textContent, "—");
  // Empty summary becomes "—" because _kv treats "" as missing.
  assert.equal(findKvByLabel(card, "summary").dd._textContent, "—");
  assert.equal(card._firstByClass("ip-payload")._textContent, "null");
});

// ── unknown kind fallback ────────────────────────────────────────────

test("unknown kinds render the generic JSON dump card", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // MA6 added "child" + "subagent" renderers — use a kind we explicitly
  // do NOT have a dedicated renderer for (placeholder for MA7+).
  store.selectItem("finding", { severity: "high", message: "x" });
  create({ root, store, doc });
  const card = root._firstByClass("ip-card-generic");
  assert.ok(card, "generic card rendered for unknown kind");
  assert.equal(card._firstByClass("ip-type")._textContent, "kind: finding");
  const pre = card._firstByClass("ip-payload");
  assert.match(pre._textContent, /"severity": "high"/);
});

// ── live re-render ────────────────────────────────────────────────────

test("re-renders on store publish (selection cleared → empty state)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("event", { type: "x", scope: "phase", payload: {} });
  create({ root, store, doc });
  assert.ok(root._firstByClass("ip-card"));
  store.clearSelection();
  assert.ok(root._firstByClass("ip-empty"));
  assert.equal(root._firstByClass("ip-card"), null);
});

test("re-renders when selection switches to a new envelope", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("event", { type: "first", scope: "phase", payload: {} });
  create({ root, store, doc });
  assert.equal(root._firstByClass("ip-type")._textContent, "first");
  store.selectItem("event", { type: "second", scope: "tool", payload: {} });
  assert.equal(root._firstByClass("ip-type")._textContent, "second");
  assert.equal(root._firstByClass("ip-scope")._textContent, "tool");
});

// ── destroy ───────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("event", { type: "x", scope: "phase", payload: {} });
  const handle = create({ root, store, doc });
  assert.ok(root.children.length > 0);
  handle.destroy();
  assert.equal(root.children.length, 0);
  store.selectItem("event", { type: "y", scope: "phase", payload: {} });
  assert.equal(root.children.length, 0);
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

// ── Slice MA6: child + subagent kinds + pin button ───────────────────

test("kind:'child' renders the child detail card with pid/label/runId/ageMs", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("child", { pid: 101, label: "codex", runId: "default", ageMs: 5000 });
  create({ root, store, doc });
  const card = root._firstByClass("ip-card-child");
  assert.ok(card);
  assert.equal(card._firstByClass("ip-type")._textContent, "child: codex");
  assert.equal(card._firstByClass("ip-scope")._textContent, "child");
  assert.equal(findKvByLabel(card, "pid").dd._textContent, "101");
  assert.equal(findKvByLabel(card, "label").dd._textContent, "codex");
  assert.equal(findKvByLabel(card, "runId").dd._textContent, "default");
  assert.equal(findKvByLabel(card, "ageMs").dd._textContent, "5000");
});

test("kind:'subagent' renders the subagent detail card", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("subagent", {
    session_id: "s1",
    agent_id: "agent-1",
    agent_type: "codex",
    runId: "default",
    ts: new Date(2026, 0, 1, 9, 0, 0).getTime(),
  });
  create({ root, store, doc });
  const card = root._firstByClass("ip-card-subagent");
  assert.ok(card);
  assert.equal(card._firstByClass("ip-type")._textContent, "subagent: codex");
  assert.equal(findKvByLabel(card, "session_id").dd._textContent, "s1");
  assert.equal(findKvByLabel(card, "agent_id").dd._textContent, "agent-1");
  assert.equal(findKvByLabel(card, "agent_type").dd._textContent, "codex");
  assert.equal(findKvByLabel(card, "runId").dd._textContent, "default");
});

test("event card includes a pin button + flips label when pinned", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const env = { type: "phase_update", scope: "phase", payload: {} };
  store.selectItem("event", env);
  create({ root, store, doc });
  let pinBtn = root._firstByClass("ip-pin-btn");
  assert.ok(pinBtn, "pin button rendered for kind:event");
  assert.equal(pinBtn._textContent, "📌 pin");
  assert.equal(pinBtn.attributes["aria-pressed"], "false");
  // Click → store.togglePinEvent → re-render → label flip.
  pinBtn._dispatch("click", {});
  assert.equal(store.snapshot().pinnedEvents.length, 1);
  pinBtn = root._firstByClass("ip-pin-btn");
  assert.equal(pinBtn._textContent, "✕ unpin");
  assert.equal(pinBtn.attributes["aria-pressed"], "true");
  assert.ok(pinBtn.classList.contains("is-pinned"));
  // Click again → unpins.
  pinBtn._dispatch("click", {});
  assert.equal(store.snapshot().pinnedEvents.length, 0);
});

test("non-event kinds do NOT render a pin button (avoid mis-pinning)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.selectItem("child", { pid: 101, label: "codex", runId: "X", ageMs: 5 });
  create({ root, store, doc });
  assert.equal(root._firstByClass("ip-pin-btn"), null);
});
