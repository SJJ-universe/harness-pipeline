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

// ── MB4-a: legacy-bridge install / destroy ───────────────────────────

test("MB4-a: bridge override is invoked with store + normalize, destroy fans out", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let bridgeOpts = null;
  const stubBridge = {
    install(opts) {
      bridgeOpts = opts;
      return { destroy() { stubBridge._destroyed = true; } };
    },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    bridge: stubBridge,
    bridgeRefreshIntervalMs: 0,
  });
  await handle.hydrationPromise;
  assert.ok(bridgeOpts, "bridge.install was called");
  assert.equal(bridgeOpts.store, store);
  assert.equal(bridgeOpts.normalize, normalize);
  assert.equal(bridgeOpts.refreshIntervalMs, 0);
  assert.ok(handle._bridgeHandle, "bridge handle exposed for destroy");
  handle.destroy();
  assert.equal(stubBridge._destroyed, true);
});

test("MB4-a: bridge install throw is caught + surfaces in error box", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const angryBridge = {
    install() { throw new Error("bridge boom"); },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    bridge: angryBridge,
  });
  await handle.hydrationPromise;
  assert.equal(handle._errorBox.hasAttribute("hidden"), false);
  assert.match(handle._errorBox._textContent, /bridge boom/);
});

test("MB4-a: layout works without a bridge (graceful — older deployments)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    bridge: null,                  // explicit no-bridge
  });
  await handle.hydrationPromise;
  // Skeleton + panels still present.
  assert.equal(root._findAllByClass("global-bar").length, 1);
  assert.equal(handle._bridgeHandle, null);
  // destroy is a no-op for the bridge slot — must not throw.
  assert.doesNotThrow(() => handle.destroy());
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

// ── MC1: auto-hydrate run detail on selectRun ────────────────────────

test("MC1: runTree.onSelect invokes the runDetail hydrator", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("default", { status: "active" });
  store.upsertRun("session-2", { status: "idle" });

  let captured = null;
  const stubRunTree = {
    create(opts) { captured = opts; return { destroy() {} }; },
  };
  let hydrateCalls = [];
  const stubRunDetailHydrate = ({ runId }) => {
    hydrateCalls.push(runId);
    return Promise.resolve({ snapshot: store.snapshot(), raw: {} });
  };

  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    runDetailHydrate: stubRunDetailHydrate,
    runDetailTtlMs: 0,    // disable TTL for this test so back-to-back clicks both fire
    panels: { runTree: stubRunTree },
    doc,
  });
  await handle.hydrationPromise;

  // onSelect → store.selectRun + auto-hydrate.
  captured.onSelect("session-2");
  // hydrate is async; flush the microtask queue.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(hydrateCalls, ["session-2"]);
  assert.equal(store.snapshot().selectedRunId, "session-2");
});

test("MC1: in-flight dedupe — same runId clicked twice → only 1 fetch", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("X", {});

  let captured = null;
  const stubRunTree = {
    create(opts) { captured = opts; return { destroy() {} }; },
  };

  // Slow hydrate so the second call lands while the first is in-flight.
  let resolveFetch;
  const slow = () => new Promise((res) => { resolveFetch = res; });
  let hydrateCalls = 0;
  const stubRunDetailHydrate = () => {
    hydrateCalls++;
    return slow();
  };

  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    runDetailHydrate: stubRunDetailHydrate,
    runDetailTtlMs: 0,
    panels: { runTree: stubRunTree },
    doc,
  });
  await handle.hydrationPromise;

  captured.onSelect("X");
  captured.onSelect("X");
  captured.onSelect("X");
  // Three clicks, one fetch (still in-flight).
  assert.equal(hydrateCalls, 1);
  assert.ok(handle._runDetailInFlight.has("X"));

  // Resolve → in-flight Set drains.
  resolveFetch({ snapshot: store.snapshot(), raw: {} });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.ok(!handle._runDetailInFlight.has("X"));
});

test("MC1: TTL cache — re-select within TTL → no re-fetch", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("Y", {});

  let captured = null;
  const stubRunTree = {
    create(opts) { captured = opts; return { destroy() {} }; },
  };
  let hydrateCalls = 0;
  const stubRunDetailHydrate = () => {
    hydrateCalls++;
    return Promise.resolve({ snapshot: store.snapshot(), raw: {} });
  };

  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    runDetailHydrate: stubRunDetailHydrate,
    runDetailTtlMs: 60_000,    // 1 min — second click is well within
    panels: { runTree: stubRunTree },
    doc,
  });
  await handle.hydrationPromise;

  captured.onSelect("Y");
  await new Promise((r) => setImmediate(r));
  // Second click on the SAME runId — TTL hit, no new fetch.
  captured.onSelect("Y");
  await new Promise((r) => setImmediate(r));
  assert.equal(hydrateCalls, 1, "TTL kicked in for second click");
});

test("MC1: hydrate failure does NOT block selection or break the panel", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.upsertRun("Z", {});

  let captured = null;
  const stubRunTree = {
    create(opts) { captured = opts; return { destroy() {} }; },
  };
  const stubRunDetailHydrate = () => Promise.reject(new Error("404"));

  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    runDetailHydrate: stubRunDetailHydrate,
    runDetailTtlMs: 0,
    panels: { runTree: stubRunTree },
    doc,
  });
  await handle.hydrationPromise;

  assert.doesNotThrow(() => captured.onSelect("Z"));
  await new Promise((r) => setImmediate(r));
  // Selection still applied even though hydrate threw.
  assert.equal(store.snapshot().selectedRunId, "Z");
  // In-flight is drained.
  assert.ok(!handle._runDetailInFlight.has("Z"));
});

// ── Slice UX-2-c: approval card region ─────────────────────────

test("UX-2-c: mount builds the approval-card region between global-bar and shell-body", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
  });
  await handle.hydrationPromise;
  const regions = root._findAllByClass("approval-card-region");
  assert.equal(regions.length, 1, "exactly one approval-card-region");
  assert.equal(regions[0].attributes.role, "region");
  assert.equal(regions[0].attributes["aria-label"], "Pending approvals");
  assert.equal(handle._approvalMount, regions[0]);
});

test("UX-2-c: mount uses panels.approvalCard override", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let captured = null;
  const stubApproval = {
    create(opts) {
      captured = opts;
      return {
        destroy() { captured = null; },
      };
    },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    panels: { approvalCard: stubApproval },
    doc,
  });
  await handle.hydrationPromise;
  assert.ok(captured, "approvalCard.create was invoked");
  assert.equal(captured.root, handle._approvalMount);
  assert.equal(captured.store, store);
  // destroy() should clean up the panel handle.
  assert.ok(handle._approvalHandle);
  handle.destroy();
  assert.equal(captured, null, "approval handle.destroy ran on layout teardown");
});

test("UX-2-c: missing approvalCard panel does not break layout (graceful)", async () => {
  // Ensure no global resolution finds the panel — tests run with the
  // module loaded but the layout's _resolvePanel falls through to
  // window.HarnessMonitorApprovalCard, which is undefined here.
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Pass panels: {} explicitly to bypass any prior global registration.
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    panels: {},
    doc,
  });
  await handle.hydrationPromise;
  // Region still exists, panel handle is null.
  assert.ok(handle._approvalMount);
  assert.equal(handle._approvalHandle, null);
});

test("UX-2-c: approvalCard.create that throws surfaces error but layout survives", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const stubApproval = {
    create() { throw new Error("approval mount blew up"); },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    panels: { approvalCard: stubApproval },
    doc,
  });
  await handle.hydrationPromise;
  // Layout did not crash — error surfaces in errorBox.
  assert.ok(handle._errorBox);
  // Approval handle remains null.
  assert.equal(handle._approvalHandle, null);
});

// ── Slice UI-H1: shell mode foundation ─────────────────────────

test("UI-H1: default mode is 'advanced' (preserves existing behavior)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    // mode omitted — should default to "advanced"
  });
  await handle.hydrationPromise;
  assert.equal(handle._mode, "advanced");
  // Shell-body is mounted in advanced mode
  assert.equal(root._findAllByClass("shell-body").length, 1);
  assert.equal(root._findAllByClass("shell-dock").length, 1);
  assert.equal(root._findAllByClass("simple-shell-mount").length, 0);
});

test("UI-H1: mode='advanced' mounts run-tree, run-summary, timeline, etc.", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let runTreeMounted = false, timelineMounted = false, agentTreeMounted = false;
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "advanced",
    panels: {
      runTree: { create: () => { runTreeMounted = true; return { destroy() {} }; } },
      timeline: { create: () => { timelineMounted = true; return { destroy() {} }; } },
      agentTree: { create: () => { agentTreeMounted = true; return { destroy() {} }; } },
    },
  });
  await handle.hydrationPromise;
  assert.ok(runTreeMounted, "run-tree must mount in advanced mode");
  assert.ok(timelineMounted, "timeline must mount in advanced mode");
  assert.ok(agentTreeMounted, "agent-tree must mount in advanced mode");
});

test("UI-H1: mode='simple' mounts simple-shell-mount, NOT shell-body", async () => {
  // UI-H6 update: placeholder removed in favor of the SimpleShell
  // orchestrator which mounts cards directly. Without panels.simpleShell
  // injected, the orchestrator is unavailable → no cards but the
  // mount region is still attached.
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "simple",
    // No simpleShell panel registered — verifies graceful no-op.
    panels: {},
  });
  await handle.hydrationPromise;
  assert.equal(handle._mode, "simple");
  assert.equal(root._findAllByClass("simple-shell-mount").length, 1);
  assert.equal(root._findAllByClass("shell-body").length, 0);
  assert.equal(root._findAllByClass("shell-dock").length, 0);
  // simpleShellHandle null when panels.simpleShell missing
  assert.equal(handle._simpleShellHandle, null);
});

test("UI-H1: mode='simple' does NOT mount run-tree / timeline / agent-tree", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let runTreeMounted = false, timelineMounted = false, agentTreeMounted = false;
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "simple",
    panels: {
      runTree: { create: () => { runTreeMounted = true; return { destroy() {} }; } },
      timeline: { create: () => { timelineMounted = true; return { destroy() {} }; } },
      agentTree: { create: () => { agentTreeMounted = true; return { destroy() {} }; } },
    },
  });
  await handle.hydrationPromise;
  assert.equal(runTreeMounted, false);
  assert.equal(timelineMounted, false);
  assert.equal(agentTreeMounted, false);
});

test("UI-H1: mode='simple' STILL mounts global-bar, mode-toggle, approval-card, settings", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let globalBarMounted = false, approvalMounted = false, settingsMounted = false;
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "simple",
    panels: {
      globalBar: { create: () => { globalBarMounted = true; return { destroy() {} }; } },
      approvalCard: { create: () => { approvalMounted = true; return { destroy() {} }; } },
      settingsAccounts: { create: () => { settingsMounted = true; return { destroy() {} }; } },
    },
  });
  await handle.hydrationPromise;
  assert.ok(globalBarMounted, "global-bar mounts in simple mode");
  assert.ok(approvalMounted, "approval-card mounts in simple mode");
  assert.ok(settingsMounted, "settings-accounts mounts in simple mode");
});

test("UI-H1: mode='legacy' short-circuits — no shell DOM, no panels", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let anyPanelMounted = false;
  const stubPanel = {
    create: () => { anyPanelMounted = true; return { destroy() {} }; },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "legacy",
    panels: {
      globalBar: stubPanel, runTree: stubPanel, timeline: stubPanel,
      agentTree: stubPanel, approvalCard: stubPanel,
    },
  });
  await handle.hydrationPromise;
  assert.equal(handle._mode, "legacy");
  assert.equal(anyPanelMounted, false, "legacy mode mounts no panels");
  assert.equal(root.children.length, 0, "legacy mode leaves DOM untouched");
  // Shell classes NOT applied
  assert.equal(root.classList.contains("monitor-shell"), false);
  assert.equal(root.classList.contains("is-active"), false);
  // Body class NOT applied
  assert.equal(doc.body.classList.contains("monitor-active"), false);
});

test("UI-H1: legacy mode destroy() is safe (no panels to tear down)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize, doc, mode: "legacy",
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
  });
  await handle.hydrationPromise;
  assert.doesNotThrow(() => handle.destroy());
});

test("UI-H1: invalid mode falls back to 'advanced' (defensive)", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    mode: "garbage",
  });
  await handle.hydrationPromise;
  assert.equal(handle._mode, "advanced");
  assert.equal(root._findAllByClass("shell-body").length, 1);
});

test("UI-H1: mode-toggle region is mounted in BOTH simple AND advanced", async () => {
  for (const mode of ["simple", "advanced"]) {
    const doc = makeStubDoc();
    const root = doc.createElement("div");
    const store = createMonitorStore();
    const handle = mount({
      root, store, normalize,
      hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
      doc,
      mode,
    });
    await handle.hydrationPromise;
    const region = root._findAllByClass("mode-toggle-mount");
    assert.equal(region.length, 1, `mode-toggle-mount should exist in ${mode}`);
    assert.equal(handle._modeToggleMount, region[0]);
  }
});

test("UI-H1: panels.modeToggle override is invoked + handle exposed", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  let captured = null;
  const stubModeToggle = {
    create(opts) { captured = opts; return { destroy() { captured = null; } }; },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc, mode: "advanced",
    panels: { modeToggle: stubModeToggle },
  });
  await handle.hydrationPromise;
  assert.ok(captured, "modeToggle.create was invoked");
  assert.equal(captured.root, handle._modeToggleMount);
  assert.equal(captured.currentMode, "advanced");
  // destroy unmounts the panel
  handle.destroy();
  assert.equal(captured, null);
});

test("UI-H1: modeToggle.create that throws surfaces error but layout survives", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const stubModeToggle = {
    create() { throw new Error("toggle init blew up"); },
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc,
    panels: { modeToggle: stubModeToggle },
  });
  await handle.hydrationPromise;
  // Layout did NOT crash
  assert.ok(handle._errorBox);
  // mode-toggle handle is null after failed mount
  assert.equal(handle._modeToggleHandle, null);
});

test("UI-H1: mode-X class added to root + body for theme + density adjustments", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve({ snapshot: store.snapshot(), raw: {} }),
    doc, mode: "simple",
  });
  await handle.hydrationPromise;
  assert.ok(root.classList.contains("mode-simple"));
  assert.ok(doc.body.classList.contains("monitor-mode-simple"));
});

test("MC1: bootstrap-time selectedRunId triggers an initial detail fetch", async () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Hydrate puts a selection in place; runDetailHydrate then fires for it.
  let hydrateCalls = [];
  const stubRunDetailHydrate = ({ runId }) => {
    hydrateCalls.push(runId);
    return Promise.resolve({ snapshot: store.snapshot(), raw: {} });
  };
  const handle = mount({
    root, store, normalize,
    hydrate: () => Promise.resolve().then(() => {
      store.upsertRun("default", { status: "active" });
      store.selectRun("default");
      return { snapshot: store.snapshot(), raw: {} };
    }),
    runDetailHydrate: stubRunDetailHydrate,
    runDetailTtlMs: 0,
    doc,
  });
  await handle.hydrationPromise;
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(hydrateCalls, ["default"]);
});
