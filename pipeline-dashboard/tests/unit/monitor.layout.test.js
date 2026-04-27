// Slice MA3 (Phase D, 2026-04-27) — HarnessMonitorLayout unit tests.
//
// Drives layout.mount() with a hand-rolled DOM stub (matches the
// global-bar / focus-trap pattern) plus the real store/normalizer/hydrate.
// Covers shell activation, body class wiring, panel mount, hydration
// success/failure, and destroy cleanup.

const test = require("node:test");
const assert = require("node:assert/strict");
const { mount } = require("../../public/js/monitor/layout");
const { createMonitorStore } = require("../../public/js/monitor/store");
const { normalize } = require("../../public/js/monitor/normalizer");
const { hydrateMonitorStore } = require("../../public/js/monitor/hydrate");

// ── DOM stub (subset of what layout + the panel actually use) ─────────

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
    set innerHTML(v) {
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    get hidden() { return Object.prototype.hasOwnProperty.call(this.attributes, "hidden"); },
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
    _dispatch(name, ev) {
      for (const fn of (listeners[name] || []).slice()) fn(ev || {});
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

function makeStubDoc() {
  const body = makeStubElement("body");
  return { createElement: makeStubElement, body };
}

function fakeOkResponse(body = {}) {
  return {
    ok: true,
    status: 200,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

function fakeFailResponse(status = 500, body = "boom") {
  return {
    ok: false,
    status,
    async json() { return null; },
    async text() { return body; },
  };
}

// ── shell activation ──────────────────────────────────────────────────

test("mount adds .monitor-shell + .is-active classes and removes hidden", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  root.setAttribute("hidden", "");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  assert.ok(root.classList.contains("monitor-shell"));
  assert.ok(root.classList.contains("is-active"));
  assert.equal(root.hasAttribute("hidden"), false);
  assert.ok(doc.body.classList.contains("monitor-active"), "body marked monitor-active");
});

test("mount builds the global-bar + error skeleton", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  // Expect a .global-bar region + a hidden .gb-error sibling.
  const bars = root._findAllByClass("global-bar");
  assert.equal(bars.length, 1, "exactly one global-bar region");
  assert.equal(bars[0].attributes.role, "region");
  const errBoxes = root._findAllByClass("gb-error");
  assert.equal(errBoxes.length, 1);
  assert.equal(errBoxes[0].hasAttribute("hidden"), true, "error box hidden by default");
});

// ── MA4: shell body (run-rail + center-workspace) ────────────────────

test("mount builds the shell-body row with run-rail + center-workspace", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  const bodies = root._findAllByClass("shell-body");
  assert.equal(bodies.length, 1, "exactly one shell-body");
  const rails = root._findAllByClass("run-rail");
  const centers = root._findAllByClass("center-workspace");
  assert.equal(rails.length, 1);
  assert.equal(centers.length, 1);
  assert.equal(rails[0].attributes.role, "navigation");
  assert.equal(centers[0].attributes.role, "region");
  // Test hooks expose the same elements.
  assert.equal(handle._runRail, rails[0]);
  assert.equal(handle._centerWs, centers[0]);
  assert.equal(handle._shellBody, bodies[0]);
});

test("mount uses panels.runTree + panels.runSummary overrides", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let runTreeOpts = null;
  let runSummaryOpts = null;
  const stubRunTree = {
    create(opts) { runTreeOpts = opts; return { destroy() { stubRunTree._destroyed = true; } }; },
  };
  const stubRunSummary = {
    create(opts) { runSummaryOpts = opts; return { destroy() { stubRunSummary._destroyed = true; } }; },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { runTree: stubRunTree, runSummary: stubRunSummary },
  });
  await handle.hydrationPromise;
  assert.ok(runTreeOpts, "run-tree.create called");
  assert.equal(runTreeOpts.store, store);
  assert.equal(runTreeOpts.doc, doc);
  assert.equal(typeof runTreeOpts.onSelect, "function");
  // onSelect routes through store.selectRun.
  store.upsertRun("xyz", {});
  runTreeOpts.onSelect("xyz");
  assert.equal(store.snapshot().selectedRunId, "xyz");

  assert.ok(runSummaryOpts, "run-summary.create called");
  assert.equal(runSummaryOpts.store, store);
  assert.equal(runSummaryOpts.doc, doc);

  // destroy fans out to all three panels.
  handle.destroy();
  assert.equal(stubRunTree._destroyed, true);
  assert.equal(stubRunSummary._destroyed, true);
});

// ── MA5: cw-summary/cw-timeline split + right-inspector + shell-dock ─

test("MA5: shell skeleton grows the cw-summary/cw-timeline split", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  // Center workspace now contains cw-summary and cw-timeline.
  assert.equal(root._findAllByClass("cw-summary").length, 1);
  assert.equal(root._findAllByClass("cw-timeline").length, 1);
  assert.equal(handle._cwSummary.attributes["aria-label"], "Run summary");
  assert.equal(handle._cwTimeline.attributes["aria-label"], "Event timeline");
});

test("MA5: shell skeleton adds right-inspector + shell-dock siblings", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  assert.equal(root._findAllByClass("right-inspector").length, 1);
  assert.equal(root._findAllByClass("shell-dock").length, 1);
  // Inspector lives inside shell-body; shell-dock is a sibling under root.
  assert.equal(handle._rightInspector.attributes["aria-label"], "Inspector");
  assert.equal(handle._shellDock.attributes["aria-label"], "Bottom dock");
  assert.equal(handle._shellDock.parentNode, root);
  assert.equal(handle._rightInspector.parentNode, handle._shellBody);
});

test("MA5: panel overrides timeline/inspector/bottomDock are honored", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let timelineOpts = null;
  let inspectorOpts = null;
  let dockOpts = null;
  const stubTimeline = {
    create(opts) { timelineOpts = opts; return { destroy() { stubTimeline._destroyed = true; } }; },
  };
  const stubInspector = {
    create(opts) { inspectorOpts = opts; return { destroy() { stubInspector._destroyed = true; } }; },
  };
  const stubDock = {
    create(opts) { dockOpts = opts; return { destroy() { stubDock._destroyed = true; } }; },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { timeline: stubTimeline, inspector: stubInspector, bottomDock: stubDock },
  });
  await handle.hydrationPromise;

  // timeline mounts to cw-timeline + receives onSelect that routes to selectItem.
  assert.equal(timelineOpts.root, handle._cwTimeline);
  assert.equal(typeof timelineOpts.onSelect, "function");
  const env = { type: "phase_update", scope: "phase", payload: {} };
  timelineOpts.onSelect(env);
  assert.deepEqual(store.snapshot().selectedItem, { kind: "event", payload: env });

  // inspector mounts to right-inspector.
  assert.equal(inspectorOpts.root, handle._rightInspector);
  // bottom-dock mounts to shell-dock.
  assert.equal(dockOpts.root, handle._shellDock);

  handle.destroy();
  assert.equal(stubTimeline._destroyed, true);
  assert.equal(stubInspector._destroyed, true);
  assert.equal(stubDock._destroyed, true);
});

// ── MA6: rail subdivision + agent-tree mount ─────────────────────────

test("MA6: run-rail splits into run-rail-section + agent-rail-section", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  assert.equal(root._findAllByClass("rail-section").length, 2);
  assert.equal(root._findAllByClass("run-rail-section").length, 1);
  assert.equal(root._findAllByClass("agent-rail-section").length, 1);
  // Test hooks expose them.
  assert.ok(handle._runRailSection);
  assert.ok(handle._agentRailSection);
  assert.ok(handle._runTreeMount);
  assert.ok(handle._agentTreeMount);
});

test("MA6: run-tree now mounts to .run-tree-mount, not the whole rail", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let runTreeRoot = null;
  const stubRunTree = {
    create(opts) { runTreeRoot = opts.root; return { destroy() {} }; },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { runTree: stubRunTree },
  });
  await handle.hydrationPromise;
  assert.equal(runTreeRoot, handle._runTreeMount);
});

test("MA6: panels.agentTree override is honored + onSelect routes through store.selectItem", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let agentTreeOpts = null;
  const stubAgentTree = {
    create(opts) { agentTreeOpts = opts; return { destroy() { stubAgentTree._destroyed = true; } }; },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { agentTree: stubAgentTree },
  });
  await handle.hydrationPromise;
  assert.ok(agentTreeOpts);
  assert.equal(agentTreeOpts.root, handle._agentTreeMount);
  assert.equal(agentTreeOpts.store, store);
  assert.equal(typeof agentTreeOpts.onSelect, "function");
  // Calling onSelect routes through store.selectItem.
  const child = { pid: 101, label: "codex", runId: "X", ageMs: 100 };
  agentTreeOpts.onSelect("child", child);
  assert.deepEqual(store.snapshot().selectedItem, { kind: "child", payload: child });
  // destroy fans out.
  handle.destroy();
  assert.equal(stubAgentTree._destroyed, true);
});

// ── panel injection (via panels override) ─────────────────────────────

test("mount uses the panels.globalBar override when provided", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let createdWith = null;
  const stubPanel = {
    create(opts) {
      createdWith = opts;
      return {
        destroy() { stubPanel._destroyed = true; },
      };
    },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { globalBar: stubPanel },
  });
  await handle.hydrationPromise;
  assert.ok(createdWith, "stub panel.create was called");
  assert.equal(createdWith.store, store, "panel got the store");
  assert.equal(createdWith.doc, doc, "panel got the doc");
  assert.equal(typeof createdWith.onClose, "function", "panel got onClose");
});

// ── hydration error surfaces in the error box ─────────────────────────

test("mount shows the error box when hydrate rejects", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.reject(new Error("HTTP 401")),
    doc,
  });
  await handle.hydrationPromise; // resolves (error is captured, not thrown)
  assert.equal(handle._errorBox.hasAttribute("hidden"), false, "error box visible after fail");
  assert.match(handle._errorBox._textContent, /HTTP 401/);
});

test("mount clears the error box when hydrate resolves", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  assert.equal(handle._errorBox.hasAttribute("hidden"), true, "error box hidden after success");
});

// ── full hydration flow with real hydrateMonitorStore + stub fetch ────

test("mount with real hydrate + stub fetch populates the store", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();

  let fetchedUrl = null;
  const stubFetch = async (url) => {
    fetchedUrl = url;
    return fakeOkResponse({
      server: { pid: 9001, uptime: 12.3 },
      runs: [{ id: "default", status: "active", templateId: "general" }],
      selectedRunId: "default",
      activeChildren: [{ pid: 1, label: "codex", runId: "default", ageMs: 200 }],
      activeChildCount: 1,
      recentEvents: [
        { ts: 1, event: { type: "phase_update", data: { runId: "default", phase: "B" } } },
      ],
      exportedAt: "2026-04-27T00:00:00Z",
    });
  };

  const handle = mount({
    root,
    store,
    normalize,
    hydrate: hydrateMonitorStore,
    fetchImpl: stubFetch,
    doc,
  });
  await handle.hydrationPromise;
  assert.equal(fetchedUrl, "/api/monitor/bootstrap");

  const snap = store.snapshot();
  assert.equal(snap.server.pid, 9001);
  assert.equal(snap.runs.default.status, "active");
  assert.equal(snap.selectedRunId, "default");
  assert.equal(snap.activeChildren.length, 1);
  assert.equal(snap.events.length, 1);
  assert.equal(snap.events[0].scope, "phase");
});

test("mount with real hydrate + failing fetch surfaces the HTTP code", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: hydrateMonitorStore,
    fetchImpl: async () => fakeFailResponse(503, "down"),
    doc,
  });
  await handle.hydrationPromise;
  assert.equal(handle._errorBox.hasAttribute("hidden"), false);
  assert.match(handle._errorBox._textContent, /HTTP 503/);
});

// ── onClose hides the shell without persistence ──────────────────────

test("the panel onClose callback removes is-active + monitor-active", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let capturedOnClose = null;
  const stubPanel = {
    create(opts) {
      capturedOnClose = opts.onClose;
      return { destroy() {} };
    },
  };
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { globalBar: stubPanel },
  });
  await handle.hydrationPromise;
  // onClose toggles the visible state without resetting the shell DOM.
  capturedOnClose();
  assert.ok(!root.classList.contains("is-active"));
  assert.ok(!doc.body.classList.contains("monitor-active"));
  // .monitor-shell stays so the next show is cheap.
  assert.ok(root.classList.contains("monitor-shell"));
});

// ── destroy fully tears down ──────────────────────────────────────────

test("destroy removes classes + restores hidden + empties root", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  handle.destroy();
  assert.ok(!root.classList.contains("is-active"));
  assert.ok(!root.classList.contains("monitor-shell"));
  assert.ok(!doc.body.classList.contains("monitor-active"));
  assert.equal(root.hasAttribute("hidden"), true);
  assert.equal(root.children.length, 0);
});

// ── input validation ──────────────────────────────────────────────────

test("mount throws on missing root / store / doc", () => {
  const doc = makeStubDoc();
  const store = createMonitorStore();
  assert.throws(() => mount({ store, doc, normalize }), /root must be an element/);
  assert.throws(() => mount({ root: doc.createElement("div"), doc, normalize }), /store is required/);
  assert.throws(
    () => mount({ root: doc.createElement("div"), store, normalize, doc: {} }),
    /no document available/
  );
});

// ── hydration is skipped when neither hydrate fn nor normalize is given

test("mount skips hydration cleanly when no hydrate fn is available", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root,
    store,
    normalize: null,        // intentionally missing
    hydrate: null,          // intentionally missing
    doc,
  });
  // Should resolve without calling fetch or throwing.
  await handle.hydrationPromise;
  assert.equal(handle._errorBox.hasAttribute("hidden"), true);
});
