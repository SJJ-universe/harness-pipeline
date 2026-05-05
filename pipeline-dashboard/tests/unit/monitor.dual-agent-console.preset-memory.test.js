// Slice SMART-3-POLISH-a (Phase 2 v2 follow-up, 2026-05-05) —
// dual-agent-console preset memory tests.
//
// Reuses the DOM-stub pattern from monitor.dual-agent-console.preset.test.js.
// Covers the operator-DX win: when an operator picks "보안" / "Security"
// once, the dropdown remembers the choice across mounts (localStorage
// is the persistence layer; tests inject a Map-backed shim).
//
// Invariants verified:
//   - Storage shim option accepted (falsy values pass through cleanly)
//   - Default storage = globalThis.localStorage, missing = no-op
//   - On preset selection change, storage.setItem(key, presetId)
//   - On free-form selection, storage.setItem(key, "") sentinel
//   - On next mount, _readRecentPresetId restores selectedPresetId
//   - Restoration respects current availablePresets — preset removed
//     from server falls back to null (legacy free-form)
//   - storage=null (explicit) disables persistence
//   - recentPresetsKey custom value honored
//   - Storage throws on getItem → graceful fallback to null
//   - Storage throws on setItem → panel does not crash
//   - Corrupt storage value (>128 chars) ignored
//   - Storage value not in availablePresets ignored

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const dualConsole = require("../../public/js/monitor/panels/dual-agent-console");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (copy from preset.test.js) ─────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
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
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    get options() { return this.children.filter((c) => c.tagName === "OPTION"); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    _change(value) {
      this.value = value;
      const ev = { target: { value: this.value } };
      for (const fn of (listeners.change || []).slice()) fn(ev);
    },
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
    _findOneByClass(cls) {
      const arr = this._findAllByClass(cls);
      return arr.length > 0 ? arr[0] : null;
    },
  };
  el.disabled = false;
  return el;
}
function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

// ── In-memory storage shim with call tracking ──────────────────

function makeStorage(initial) {
  const calls = { getItem: [], setItem: [] };
  const map = new Map(Object.entries(initial || {}));
  return {
    calls,
    map,
    getItem(k) {
      calls.getItem.push(k);
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      calls.setItem.push({ k, v });
      map.set(k, String(v));
    },
    removeItem(k) { map.delete(k); },
  };
}

// Throwing storage shim (every getItem / setItem throws).
function makeThrowingStorage() {
  const calls = { getItem: 0, setItem: 0 };
  return {
    calls,
    getItem() { calls.getItem++; throw new Error("storage unavailable"); },
    setItem() { calls.setItem++; throw new Error("storage unavailable"); },
  };
}

// Fake client + 6-preset stable list (shape matches /api/review-presets)
function fakeClient(presets) {
  const list = presets || [
    { presetId: "accuracy",            defaultLabel: "정확성",    defaultDescription: "" },
    { presetId: "security",            defaultLabel: "보안",      defaultDescription: "" },
    { presetId: "privacy",             defaultLabel: "개인정보",  defaultDescription: "" },
    { presetId: "performance",         defaultLabel: "성능",      defaultDescription: "" },
    { presetId: "release",             defaultLabel: "배포",      defaultDescription: "" },
    { presetId: "public-sector-audit", defaultLabel: "공공기관 감사", defaultDescription: "" },
  ];
  return {
    listPresets: async () => ({ presets: list }),
    sendToCodex: async () => ({ ok: true }),
    followUp: async () => ({ ok: true }),
    handBackToClaude: async () => ({ ok: true }),
    createSession: async () => ({ ok: true, session: {} }),
    archiveSession: async () => ({ ok: true }),
  };
}

// Yield to the microtask that resolves Promise.resolve().then(client.listPresets).
function tick() { return new Promise((r) => setImmediate(r)); }

// ── Tests ───────────────────────────────────────────────────────

test("SMART-3-POLISH-a: change writes selectedPresetId to storage", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick(); // allow listPresets to resolve
  // Find the dropdown <select> and trigger change → "security"
  const select = root._findOneByClass("dac-preset-select");
  assert.ok(select, "dropdown select rendered");
  select._change("security");
  // setItem called with the canonical key + presetId
  assert.equal(storage.calls.setItem.length, 1, "setItem invoked once");
  assert.equal(storage.calls.setItem[0].k, "harness:recentPresetId:v1");
  assert.equal(storage.calls.setItem[0].v, "security");
  handle.destroy();
});

test("SMART-3-POLISH-a: change to free-form writes empty-string sentinel", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage({ "harness:recentPresetId:v1": "security" });
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const select = root._findOneByClass("dac-preset-select");
  select._change("");
  assert.equal(storage.calls.setItem.length, 1);
  assert.equal(storage.calls.setItem[0].v, "",
    "free-form choice persists as empty-string sentinel");
  handle.destroy();
});

test("SMART-3-POLISH-a: pre-existing storage value restores selectedPresetId on mount", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage({ "harness:recentPresetId:v1": "security" });
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const state = handle._state();
  assert.equal(state.selectedPresetId, "security",
    "selectedPresetId restored from storage after presets fetch resolves");
  handle.destroy();
});

test("SMART-3-POLISH-a: empty-string sentinel does NOT restore (free-form)", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Operator previously chose free-form; the empty-string sentinel
  // should result in selectedPresetId === null after mount (NOT a
  // crash, NOT an auto-restore of the catalog's first preset).
  const storage = makeStorage({ "harness:recentPresetId:v1": "" });
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const state = handle._state();
  assert.equal(state.selectedPresetId, null,
    "empty-string sentinel collapses to null (free-form)");
  handle.destroy();
});

test("SMART-3-POLISH-a: stored presetId removed from server falls back to null", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Storage remembers a preset that the server no longer ships.
  const storage = makeStorage({
    "harness:recentPresetId:v1": "removed-preset-id",
  });
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const state = handle._state();
  assert.equal(state.selectedPresetId, null,
    "removed preset falls back to null (legacy free-form)");
  handle.destroy();
});

test("SMART-3-POLISH-a: storage=null disables persistence entirely", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage: null,           // explicit opt-out
  });
  await tick();
  const select = root._findOneByClass("dac-preset-select");
  // No throw on selection
  assert.doesNotThrow(() => select._change("security"));
  const state = handle._state();
  assert.equal(state.selectedPresetId, "security",
    "selection still updates in-memory state");
  handle.destroy();
});

test("SMART-3-POLISH-a: recentPresetsKey custom value is honored", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
    recentPresetsKey: "harness:custom-key:v9",
  });
  await tick();
  const select = root._findOneByClass("dac-preset-select");
  select._change("security");
  assert.equal(storage.calls.setItem[0].k, "harness:custom-key:v9",
    "custom key honored on write");
  // And on read (next mount with same key)
  const handle2 = dualConsole.create({
    root: makeRoot(), store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
    recentPresetsKey: "harness:custom-key:v9",
  });
  await tick();
  assert.equal(handle2._state().selectedPresetId, "security",
    "custom key honored on read");
  handle.destroy();
  handle2.destroy();
});

test("SMART-3-POLISH-a: storage throwing on getItem → graceful null", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeThrowingStorage();
  // Should mount without throwing; selectedPresetId=null.
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  assert.equal(handle._state().selectedPresetId, null,
    "throwing getItem → graceful fallback to null");
  assert.ok(storage.calls.getItem >= 1,
    "getItem was attempted at least once");
  handle.destroy();
});

test("SMART-3-POLISH-a: storage throwing on setItem → panel does not crash", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeThrowingStorage();
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const select = root._findOneByClass("dac-preset-select");
  // setItem will throw — panel must absorb it
  assert.doesNotThrow(() => select._change("security"));
  assert.equal(handle._state().selectedPresetId, "security",
    "in-memory state still updates");
  handle.destroy();
});

test("SMART-3-POLISH-a: corrupt storage value (>128 chars) ignored", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage({
    "harness:recentPresetId:v1": "x".repeat(200),  // pathological
  });
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  assert.equal(handle._state().selectedPresetId, null,
    "corrupt long value clamped to null (defensive cap)");
  handle.destroy();
});

test("SMART-3-POLISH-a: change → unmount → remount restores selection", async () => {
  const store = createMonitorStore();
  const storage = makeStorage();
  // First mount
  const root1 = makeRoot();
  const handle1 = dualConsole.create({
    root: root1, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  root1._findOneByClass("dac-preset-select")._change("public-sector-audit");
  assert.equal(handle1._state().selectedPresetId, "public-sector-audit");
  handle1.destroy();
  // Second mount with the SAME storage — should restore.
  const root2 = makeRoot();
  const handle2 = dualConsole.create({
    root: root2, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  assert.equal(handle2._state().selectedPresetId, "public-sector-audit",
    "second mount restores last-selected preset");
  handle2.destroy();
});

test("SMART-3-POLISH-a: free-form change → unmount → remount stays free-form", async () => {
  const store = createMonitorStore();
  // Storage starts with a remembered preset; operator switches to
  // free-form on first mount; the second mount should NOT
  // auto-restore the prior preset (operator's choice persists).
  const storage = makeStorage({ "harness:recentPresetId:v1": "security" });
  const root1 = makeRoot();
  const handle1 = dualConsole.create({
    root: root1, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  // First mount restored "security"; operator now flips to free-form
  assert.equal(handle1._state().selectedPresetId, "security");
  root1._findOneByClass("dac-preset-select")._change("");
  assert.equal(handle1._state().selectedPresetId, null);
  handle1.destroy();
  // Second mount
  const handle2 = dualConsole.create({
    root: makeRoot(), store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  assert.equal(handle2._state().selectedPresetId, null,
    "explicit free-form choice survives the next mount");
  handle2.destroy();
});

test("SMART-3-POLISH-a: presetsFetchFailed → no restore attempted (storage left intact)", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage({ "harness:recentPresetId:v1": "security" });
  // Client whose listPresets returns null (soft-fail path).
  const failingClient = {
    listPresets: async () => null,
    sendToCodex: async () => ({}), followUp: async () => ({}),
    handBackToClaude: async () => ({}), createSession: async () => ({}),
    archiveSession: async () => ({}),
  };
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: failingClient,
    storage,
  });
  await tick();
  // No restore because availablePresets ended up as []
  assert.equal(handle._state().selectedPresetId, null,
    "soft-fail path leaves selectedPresetId null (cannot validate stored id)");
  // Storage value still present (not auto-cleared)
  assert.equal(storage.map.get("harness:recentPresetId:v1"), "security",
    "storage value preserved across a soft-fail mount");
  handle.destroy();
});

test("SMART-3-POLISH-a: handle._state() exposes selectedPresetId for downstream tests", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  const handle = dualConsole.create({
    root, store, doc: makeStubDoc(),
    client: fakeClient(),
    storage,
  });
  await tick();
  const state = handle._state();
  assert.ok(Object.prototype.hasOwnProperty.call(state, "selectedPresetId"),
    "_state() includes selectedPresetId field");
  assert.ok(Object.prototype.hasOwnProperty.call(state, "availablePresets"),
    "_state() includes availablePresets field");
  handle.destroy();
});
