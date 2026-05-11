// Slice MA6 (Phase D, 2026-04-27) — OrchestratorMonitorAgentTree unit tests.
//
// Hand-rolled DOM stub. Verifies child + subagent grouping by runId,
// active-subagent derivation from the events ring, click → onSelect,
// selection highlight, live re-render, destroy.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  create,
  _formatAge,
  _groupByRunId,
  _activeSubagents,
  _mergeSubagentSources,
} = require("../../public/js/monitor/panels/agent-tree");
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
  store.pushEvent(Object.assign(
    { type: "phase_update", runId: "default", ts: 1, scope: "phase", summary: "", payload: {} },
    partial
  ));
}

// ── pure helpers ─────────────────────────────────────────────────────

test("_formatAge handles seconds / minutes / hours / nonsense", () => {
  assert.equal(_formatAge(0), "0s");
  assert.equal(_formatAge(45_000), "45s");
  assert.equal(_formatAge(60_000), "1m 0s");
  assert.equal(_formatAge(75_000), "1m 15s");
  assert.equal(_formatAge(3_600_000), "1h 0m");
  assert.equal(_formatAge(3_725_000), "1h 2m");
  assert.equal(_formatAge(NaN), "—");
  assert.equal(_formatAge(-1), "—");
});

test("_groupByRunId groups by runId, falling back to '(no run)'", () => {
  const map = _groupByRunId([
    { pid: 1, runId: "A" },
    { pid: 2, runId: "B" },
    { pid: 3, runId: "A" },
    { pid: 4 },
  ]);
  assert.equal(map.size, 3);
  assert.equal(map.get("A").length, 2);
  assert.equal(map.get("B").length, 1);
  assert.equal(map.get("(no run)").length, 1);
});

test("_activeSubagents yields started events without matching completed", () => {
  // events array oldest → newest (matches store.events ordering).
  const ev = [
    { type: "subagent_started", runId: "A", ts: 1, payload: { session_id: "s1", agent_type: "codex" } },
    { type: "subagent_started", runId: "A", ts: 2, payload: { session_id: "s2", agent_type: "claude" } },
    { type: "subagent_completed", runId: "A", ts: 3, payload: { session_id: "s1" } },
    { type: "subagent_started", runId: "B", ts: 4, payload: { session_id: "s3" } },
  ];
  const out = _activeSubagents(ev);
  // s1 is completed, s2 + s3 are still active.
  const ids = out.map((s) => s.session_id).sort();
  assert.deepEqual(ids, ["s2", "s3"]);
  // _activeSubagents preserves the agent_type from the started event.
  const s2 = out.find((s) => s.session_id === "s2");
  assert.equal(s2.agent_type, "claude");
  assert.equal(s2.runId, "A");
});

test("_activeSubagents falls back to agent_id when session_id missing", () => {
  const ev = [
    { type: "subagent_started", runId: "X", ts: 1, payload: { agent_id: "a-only" } },
  ];
  const out = _activeSubagents(ev);
  assert.equal(out.length, 1);
  assert.equal(out[0].session_id, "a-only");
});

test("_activeSubagents tolerates empty / non-array input", () => {
  assert.deepEqual(_activeSubagents([]), []);
  assert.deepEqual(_activeSubagents(null), []);
  assert.deepEqual(_activeSubagents("garbage"), []);
});

// ── empty + populated render ─────────────────────────────────────────

test("renders both sections empty when no children + no subagents", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  const sections = root._findAllByClass("at-section");
  assert.equal(sections.length, 2);
  // Both empty placeholders present.
  const empties = root._findAllByClass("at-empty");
  assert.equal(empties.length, 2);
  assert.match(empties[0]._textContent, /활성 자식/);
  assert.match(empties[1]._textContent, /활성 서브에이전트/);
});

test("renders Children section grouped by runId with name + age", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([
    { pid: 101, label: "codex", runId: "default", ageMs: 5000 },
    { pid: 102, label: "claude", runId: "default", ageMs: 12000 },
    { pid: 103, label: "codex", runId: "session-2", ageMs: 800 },
  ]);
  create({ root, store, doc });
  const childItems = root._findAllByClass("at-child");
  assert.equal(childItems.length, 3);
  // First group is "default" (insertion order on Map.set).
  const groups = root._findAllByClass("at-group");
  assert.match(groups[0]._firstByClass("at-group-title")._textContent, /\[default\]/);
  assert.equal(groups[0]._firstByClass("at-group-title")._textContent, "[default] Children");
  // Item label includes pid.
  assert.equal(childItems[0]._firstByClass("at-name")._textContent, "codex (101)");
  assert.equal(childItems[0]._firstByClass("at-meta")._textContent, "5s");
  // Last group is for session-2.
  assert.equal(groups[1]._firstByClass("at-group-title")._textContent, "[session-2] Children");
});

test("renders Subagents section derived from events ring", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "default", payload: { session_id: "s1", agent_type: "codex" } });
  pushEnv(store, { type: "subagent_started", ts: 2, runId: "default", payload: { session_id: "s2", agent_type: "claude" } });
  pushEnv(store, { type: "subagent_completed", ts: 3, runId: "default", payload: { session_id: "s1" } });
  create({ root, store, doc });
  const subs = root._findAllByClass("at-subagent");
  assert.equal(subs.length, 1, "only s2 still active");
  assert.equal(subs[0]._firstByClass("at-name")._textContent, "claude");
  assert.equal(subs[0]._firstByClass("at-meta")._textContent, "s2");
});

// ── click + selection highlight ──────────────────────────────────────

test("clicking a child row invokes onSelect('child', payload)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([{ pid: 101, label: "codex", runId: "default", ageMs: 100 }]);
  let kind = null; let payload = null;
  create({ root, store, doc, onSelect(k, p) { kind = k; payload = p; } });
  const item = root._findAllByClass("at-child")[0];
  item._dispatch("click", {});
  assert.equal(kind, "child");
  assert.equal(payload.pid, 101);
  assert.equal(payload.label, "codex");
});

test("clicking a subagent row invokes onSelect('subagent', payload)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "X", payload: { session_id: "s9", agent_type: "codex" } });
  let kind = null; let payload = null;
  create({ root, store, doc, onSelect(k, p) { kind = k; payload = p; } });
  const item = root._findAllByClass("at-subagent")[0];
  item._dispatch("click", {});
  assert.equal(kind, "subagent");
  assert.equal(payload.session_id, "s9");
  assert.equal(payload.agent_type, "codex");
});

test("Enter / Space dispatches the same selection as click", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([{ pid: 101, label: "codex", runId: "default", ageMs: 100 }]);
  let calls = 0;
  let prevented = false;
  create({ root, store, doc, onSelect() { calls++; } });
  const item = root._findAllByClass("at-child")[0];
  item._dispatch("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  item._dispatch("keydown", { key: " ", preventDefault() {} });
  item._dispatch("keydown", { key: "Tab", preventDefault() {} }); // ignored
  assert.equal(calls, 2);
  assert.equal(prevented, true);
});

test("onSelect throw is swallowed", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([{ pid: 1, label: "codex", runId: "X", ageMs: 0 }]);
  create({ root, store, doc, onSelect() { throw new Error("user crash"); } });
  const item = root._findAllByClass("at-child")[0];
  assert.doesNotThrow(() => item._dispatch("click", {}));
});

test("selected child gets is-selected highlight (matched by pid)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([
    { pid: 101, label: "codex", runId: "default", ageMs: 100 },
    { pid: 102, label: "claude", runId: "default", ageMs: 200 },
  ]);
  store.selectItem("child", { pid: 102, label: "claude" });
  create({ root, store, doc });
  const items = root._findAllByClass("at-child");
  assert.ok(!items[0].classList.contains("is-selected"));
  assert.ok(items[1].classList.contains("is-selected"));
});

test("selected subagent gets is-selected highlight (matched by session_id)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "X", payload: { session_id: "s1", agent_type: "codex" } });
  pushEnv(store, { type: "subagent_started", ts: 2, runId: "X", payload: { session_id: "s2", agent_type: "claude" } });
  store.selectItem("subagent", { session_id: "s2" });
  create({ root, store, doc });
  const items = root._findAllByClass("at-subagent");
  assert.ok(!items[0].classList.contains("is-selected"));
  assert.ok(items[1].classList.contains("is-selected"));
});

// ── live re-render ───────────────────────────────────────────────────

test("re-renders when activeChildren changes (new child appears)", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  assert.equal(root._findAllByClass("at-child").length, 0);
  store.setActiveChildren([{ pid: 1, label: "codex", runId: "X", ageMs: 5 }]);
  assert.equal(root._findAllByClass("at-child").length, 1);
});

test("re-renders when a subagent_started arrives via pushEvent", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc });
  assert.equal(root._findAllByClass("at-subagent").length, 0);
  pushEnv(store, { type: "subagent_started", ts: 99, runId: "X", payload: { session_id: "s1", agent_type: "codex" } });
  assert.equal(root._findAllByClass("at-subagent").length, 1);
});

// ── destroy ───────────────────────────────────────────────────────────

test("destroy unsubscribes + clears DOM", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setActiveChildren([{ pid: 1, label: "codex", runId: "X", ageMs: 5 }]);
  const handle = create({ root, store, doc });
  assert.ok(root.children.length > 0);
  handle.destroy();
  assert.equal(root.children.length, 0);
  store.setActiveChildren([{ pid: 2, label: "claude", runId: "X", ageMs: 5 }]);
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

// ── Slice MB2: _mergeSubagentSources ──────────────────────────────────

test("_mergeSubagentSources prefers server entries on session_id collision", () => {
  const serverByRun = {
    default: [
      { session_id: "s-1", agent_type: "codex-server", startedAt: 100, completedAt: null, active: true },
    ],
  };
  const eventDerived = [
    { session_id: "s-1", agent_type: "codex-events", runId: "default", ts: 50 }, // collides
    { session_id: "s-2", agent_type: "claude",      runId: "default", ts: 200 },
  ];
  const out = _mergeSubagentSources(serverByRun, eventDerived);
  assert.equal(out.length, 2);
  const byId = Object.fromEntries(out.map((s) => [s.session_id, s]));
  // server wins on s-1.
  assert.equal(byId["s-1"].agent_type, "codex-server");
  assert.equal(byId["s-1"].source, "server");
  // events-only s-2 is preserved.
  assert.equal(byId["s-2"].source, "events");
});

test("_mergeSubagentSources tolerates missing or empty inputs", () => {
  assert.deepEqual(_mergeSubagentSources(null, null), []);
  assert.deepEqual(_mergeSubagentSources({}, []), []);
  // Server-only.
  const out1 = _mergeSubagentSources(
    { default: [{ session_id: "x", agent_type: "codex" }] },
    null
  );
  assert.equal(out1[0].source, "server");
  // Events-only.
  const out2 = _mergeSubagentSources(null, [{ session_id: "y", runId: "default" }]);
  assert.equal(out2[0].source, "events");
});

test("_mergeSubagentSources skips entries without session_id", () => {
  const out = _mergeSubagentSources(
    { default: [{ agent_type: "codex" }] },               // no session_id
    [null, undefined, { agent_type: "claude" }]           // no session_id either
  );
  assert.deepEqual(out, []);
});

// ── Slice MB2: render uses server snapshot when present ──────────────

test("render prefers runDetails subagents over events-ring derivation", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Push an old subagent_started event but DON'T push completed (events
  // ring would normally show this as active).
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "default", payload: { session_id: "s-1", agent_type: "events-derived-codex" } });
  // Now hydrate run detail with a different agent_type for the same session_id.
  store.setRunDetail("default", {
    run: { id: "default", status: "active" },
    recentEvents: [],
    children: [],
    subagents: [
      { session_id: "s-1", agent_type: "server-codex", parent_session_id: null, startedAt: 1000, completedAt: null, active: true },
    ],
    findings: [],
    findingsOverflow: null,
    replayMeta: { hasCheckpoint: false, savedAt: null },
  });
  create({ root, store, doc });
  const items = root._findAllByClass("at-subagent");
  assert.equal(items.length, 1, "merge dedupes by session_id");
  // Server name wins.
  assert.equal(items[0]._firstByClass("at-name")._textContent, "server-codex");
  assert.ok(items[0].classList.contains("is-source-server"));
});

test("render shows completed subagents with is-completed class + ✓ prefix", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setRunDetail("default", {
    run: { id: "default", status: "active" },
    recentEvents: [], children: [],
    subagents: [
      { session_id: "s-done", agent_type: "codex", startedAt: 1000, completedAt: 1500, active: false },
    ],
    findings: [], findingsOverflow: null, replayMeta: { hasCheckpoint: false },
  });
  create({ root, store, doc });
  const item = root._findAllByClass("at-subagent")[0];
  assert.ok(item.classList.contains("is-completed"));
  assert.equal(item._firstByClass("at-name")._textContent, "✓ codex");
});

test("render uses events-ring derivation as fallback when no runDetails subagents", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "default", payload: { session_id: "s-fallback", agent_type: "claude" } });
  // No runDetails set → fallback path active.
  create({ root, store, doc });
  const items = root._findAllByClass("at-subagent");
  assert.equal(items.length, 1);
  assert.equal(items[0]._firstByClass("at-name")._textContent, "claude");
  assert.ok(items[0].classList.contains("is-source-events"));
});

test("server-backed subagent survives events-ring eviction", () => {
  const doc = makeDoc();
  const root = doc.createElement("div");
  // Tiny ring — easy to evict.
  const store = createMonitorStore({ maxEvents: 3 });
  // Pre-push subagent_started (will be evicted shortly).
  pushEnv(store, { type: "subagent_started", ts: 1, runId: "default", payload: { session_id: "s-long", agent_type: "codex" } });
  // Then push enough other events to evict it.
  for (let i = 0; i < 5; i++) pushEnv(store, { type: "tool_recorded", ts: 100 + i, runId: "default" });
  // Hydrate runDetails with the still-active subagent.
  store.setRunDetail("default", {
    run: { id: "default", status: "active" },
    recentEvents: [], children: [],
    subagents: [
      { session_id: "s-long", agent_type: "codex", startedAt: 1, completedAt: null, active: true },
    ],
    findings: [], findingsOverflow: null, replayMeta: { hasCheckpoint: false },
  });
  create({ root, store, doc });
  const items = root._findAllByClass("at-subagent");
  // Without server snapshot, derivation would yield 0 (start event evicted).
  // With MB2 wiring, server snapshot keeps the row alive.
  assert.equal(items.length, 1);
  assert.equal(items[0].attributes["data-session-id"], "s-long");
});
