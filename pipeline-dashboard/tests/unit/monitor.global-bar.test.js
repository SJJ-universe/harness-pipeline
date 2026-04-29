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

// ─────────────────────────────────────────────────────────────────
//  Slice D3-c (Phase E1.5, 2026-04-29) — account-status cells
//
//  Renders 4 new cells (profile / posture / bridge / remote) sourced
//  from snapshot.accountStatus (D3-b slice fed by D3-a server-info
//  poll). Each cell:
//    - Always present (even pre-first-poll, shows "(loading)").
//    - Tone:warn / tone:error on operationally-significant signals.
//    - Title attribute carries operator-readable context.
//
//  No claude / codex cells in D3-c — those move to D3-d settings
//  modal with explicit "Test" buttons.
// ─────────────────────────────────────────────────────────────────

function exampleAccountStatus(overrides = {}) {
  return {
    profile: {
      activeId: "personal",
      activeLabel: "Personal",
      count: 1,
      credentialBackend: "keychain",
    },
    deployment: {
      mode: "standard",
      publicSector: false,
      allowLocalExecutor: true,
      allowPlaintextSecrets: false,
      requireSandboxWorkspace: false,
      requirePiiScan: false,
    },
    bridge: { mode: "off" },
    remote: { mode: "off", activeRunnerCount: 0 },
    ...overrides,
  };
}

// ── pre-first-poll: 4 (loading) cells render without throwing ──

test("D3-c: 4 account-status cells render '(loading)' before first poll", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore(); // accountStatus is null by default
  create({ root, store, doc });

  for (const label of ["profile", "posture", "bridge", "remote"]) {
    const cell = findCellByLabel(root, label);
    assert.ok(cell, label + " cell present even pre-first-poll");
    assert.equal(cell.value._textContent, "(loading)");
    // No tone — the placeholder is neutral.
    assert.ok(!cell.value.classList.contains("is-warn"));
    assert.ok(!cell.value.classList.contains("is-error"));
  }
});

// ── profile cell ──

test("D3-c profile cell: shows active label + credential-backend tooltip", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  create({ root, store, doc });

  const profile = findCellByLabel(root, "profile");
  assert.equal(profile.value._textContent, "Personal");
  assert.equal(profile.cell.attributes.title, "credential backend: keychain");
});

test("D3-c profile cell: shows '(setup)' + warn tone when no active profile", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    profile: { activeId: null, activeLabel: null, count: 0, credentialBackend: null },
  }));
  create({ root, store, doc });

  const profile = findCellByLabel(root, "profile");
  assert.equal(profile.value._textContent, "(setup)");
  assert.ok(profile.value.classList.contains("is-warn"),
    "no-active-profile must surface as warn (operator nudge to setup-wizard)");
  assert.match(profile.cell.attributes.title || "", /No active profile/);
});

test("D3-c profile cell: count > 1 shows '+N' suffix", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    profile: { activeId: "personal", activeLabel: "Personal", count: 3, credentialBackend: "keychain" },
  }));
  create({ root, store, doc });

  const profile = findCellByLabel(root, "profile");
  assert.equal(profile.value._textContent, "Personal (+2)",
    "count=3 means active + 2 others → '+2'");
});

test("D3-c profile cell: falls back to activeId when activeLabel missing", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    profile: { activeId: "agency-x", activeLabel: null, count: 1, credentialBackend: "keychain" },
  }));
  create({ root, store, doc });

  const profile = findCellByLabel(root, "profile");
  assert.equal(profile.value._textContent, "agency-x",
    "missing activeLabel must fall back to activeId — never empty");
});

// ── posture cell ──

test("D3-c posture cell: standard → no tone", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus()); // standard by default
  create({ root, store, doc });

  const p = findCellByLabel(root, "posture");
  assert.equal(p.value._textContent, "standard");
  assert.ok(!p.value.classList.contains("is-error"));
});

test("D3-c posture cell: public-sector → error tone + flag summary tooltip", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    deployment: {
      mode: "public-sector",
      publicSector: true,
      allowLocalExecutor: false,
      allowPlaintextSecrets: false,
      requireSandboxWorkspace: true,
      requirePiiScan: true,
    },
  }));
  create({ root, store, doc });

  const p = findCellByLabel(root, "posture");
  assert.equal(p.value._textContent, "public-sector");
  assert.ok(p.value.classList.contains("is-error"),
    "public-sector posture is high-salience — operators MUST notice if posture flips");
  // Tooltip summarizes the active flags.
  const title = p.cell.attributes.title || "";
  assert.match(title, /sandbox-only/);
  assert.match(title, /PII gate/);
  assert.match(title, /no local executor/);
});

test("D3-c posture cell: plaintext OK shown as flag (operator should know)", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    deployment: {
      mode: "standard",
      publicSector: false,
      allowLocalExecutor: true,
      allowPlaintextSecrets: true, // dev opt-in
      requireSandboxWorkspace: false,
      requirePiiScan: false,
    },
  }));
  create({ root, store, doc });

  const p = findCellByLabel(root, "posture");
  assert.match(p.cell.attributes.title || "", /plaintext OK/);
});

// ── bridge cell ──

test("D3-c bridge cell: 'off' → no tone", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  create({ root, store, doc });

  const b = findCellByLabel(root, "bridge");
  assert.equal(b.value._textContent, "off");
  assert.ok(!b.value.classList.contains("is-warn"));
});

test("D3-c bridge cell: 'report' → no tone (observability only)", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({ bridge: { mode: "report" } }));
  create({ root, store, doc });

  const b = findCellByLabel(root, "bridge");
  assert.equal(b.value._textContent, "report");
  assert.ok(!b.value.classList.contains("is-warn"));
});

test("D3-c bridge cell: 'dispatch' → warn tone (active execution path)", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({ bridge: { mode: "dispatch" } }));
  create({ root, store, doc });

  const b = findCellByLabel(root, "bridge");
  assert.equal(b.value._textContent, "dispatch");
  assert.ok(b.value.classList.contains("is-warn"),
    "dispatch is the active-execution mode — warn tone surfaces R2.5 controlled bridge being on");
});

// ── remote cell ──

test("D3-c remote cell: 'off' + 0 runners → no tone", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus());
  create({ root, store, doc });

  const r = findCellByLabel(root, "remote");
  assert.equal(r.value._textContent, "off");
  assert.ok(!r.value.classList.contains("is-warn"));
});

test("D3-c remote cell: 'on' + 2 runners → 'on (2)' + warn tone", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    remote: { mode: "on", activeRunnerCount: 2 },
  }));
  create({ root, store, doc });

  const r = findCellByLabel(root, "remote");
  assert.equal(r.value._textContent, "on (2)");
  assert.ok(r.value.classList.contains("is-warn"),
    "active remote runners → warn tone (operator sees remote is doing work)");
  assert.match(r.cell.attributes.title || "", /2 active remote runners/);
});

test("D3-c remote cell: singular noun for activeRunnerCount=1", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setAccountStatus(exampleAccountStatus({
    remote: { mode: "preview", activeRunnerCount: 1 },
  }));
  create({ root, store, doc });

  const r = findCellByLabel(root, "remote");
  assert.equal(r.value._textContent, "preview (1)");
  assert.match(r.cell.attributes.title || "", /1 active remote runner$/,
    "singular noun for count=1; plural for everything else");
});

// ── re-render on store update ──

// ── D3-d: Settings button (toggles accounts modal) ──

test("D3-d global-bar: Settings button only renders when onOpenSettings is provided", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();

  // Without onOpenSettings — no Settings button.
  create({ root, store, doc });
  let settingsBtns = root._findAllByClass("gb-btn-settings");
  assert.equal(settingsBtns.length, 0,
    "no Settings button when onOpenSettings is omitted (back-compat for legacy callers)");

  // Re-mount with onOpenSettings.
  const root2 = doc.createElement("div");
  let opened = 0;
  create({ root: root2, store, doc, onOpenSettings: () => { opened += 1; } });
  settingsBtns = root2._findAllByClass("gb-btn-settings");
  assert.equal(settingsBtns.length, 1);
  // Click triggers the callback.
  settingsBtns[0]._dispatch("click");
  assert.equal(opened, 1);
});

test("D3-d global-bar: Settings button onOpenSettings throw is swallowed (panel keeps working)", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  create({ root, store, doc, onOpenSettings: () => { throw new Error("user callback exploded"); } });

  const settingsBtns = root._findAllByClass("gb-btn-settings");
  assert.equal(settingsBtns.length, 1);
  // Click must NOT throw out of the panel.
  assert.doesNotThrow(() => settingsBtns[0]._dispatch("click"));
});

test("D3-c: setAccountStatus triggers re-render of all 4 cells", () => {
  const doc = makeStubDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Pre-first-poll: all 4 cells show (loading).
  create({ root, store, doc });
  const beforeProfile = findCellByLabel(root, "profile");
  assert.equal(beforeProfile.value._textContent, "(loading)");

  // Drive the store as if /api/server/info returned account-status.
  store.setAccountStatus(exampleAccountStatus({
    deployment: {
      mode: "public-sector",
      publicSector: true,
      allowLocalExecutor: false,
      allowPlaintextSecrets: false,
      requireSandboxWorkspace: true,
      requirePiiScan: true,
    },
    bridge: { mode: "dispatch" },
    remote: { mode: "on", activeRunnerCount: 3 },
  }));

  // Re-fetch — root is repainted in place.
  const profile = findCellByLabel(root, "profile");
  assert.equal(profile.value._textContent, "Personal");
  const posture = findCellByLabel(root, "posture");
  assert.equal(posture.value._textContent, "public-sector");
  assert.ok(posture.value.classList.contains("is-error"));
  const bridge = findCellByLabel(root, "bridge");
  assert.equal(bridge.value._textContent, "dispatch");
  assert.ok(bridge.value.classList.contains("is-warn"));
  const remote = findCellByLabel(root, "remote");
  assert.equal(remote.value._textContent, "on (3)");
});
