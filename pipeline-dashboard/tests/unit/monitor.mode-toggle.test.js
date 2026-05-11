// Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30) — mode-toggle panel tests.
//
// Drives the panel against the same DOM stub the project uses elsewhere
// (jsdom isn't a project dependency). Pins:
//   - Render: 3 buttons in mode order, current mode marked is-active
//   - Click: persistMode + reload (only on different mode)
//   - Click on current mode: no-op
//   - destroy() clears DOM + removes ARIA attrs

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const modeToggle = require("../../public/js/monitor/panels/mode-toggle");
const OrchestratorMonitorMode = require("../../public/js/monitor/mode");

// ── DOM stub ──────────────────────────────────────────────────────

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
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
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
    _findOneByDataAttr(attr, val) {
      for (const c of this.children) {
        if (c.attributes && c.attributes[attr] === val) return c;
        if (typeof c._findOneByDataAttr === "function") {
          const found = c._findOneByDataAttr(attr, val);
          if (found) return found;
        }
      }
      return null;
    },
  };
  el.disabled = false;
  return el;
}

function makeStubDoc() {
  return { createElement: makeStubElement };
}

function makeStubStorage() {
  const store = new Map();
  return {
    setItem(k, v) { store.set(k, v); },
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    removeItem(k) { store.delete(k); },
    _store: store,
  };
}

// ── Construction guards ──────────────────────────────────────────

test("UI-H1: create throws without root element", () => {
  assert.throws(() => modeToggle.create({}),
    /root must be an element/);
});

// ── Render ───────────────────────────────────────────────────────

test("UI-H1: renders 3 buttons (simple / advanced / legacy)", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root,
    currentMode: "simple",
    doc: makeStubDoc(),
    reloadFn: () => {},
    storage: makeStubStorage(),
  });
  const btns = root._findAllByClass("mt-btn");
  assert.equal(btns.length, 3);
  // Order: simple / advanced / legacy
  const modes = btns.map((b) => b.attributes["data-mode"]);
  assert.deepEqual(modes, ["simple", "advanced", "legacy"]);
});

test("UI-H1: current mode button has is-active class + aria-pressed=true", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root, currentMode: "advanced",
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  const advancedBtn = root._findOneByDataAttr("data-mode", "advanced");
  assert.ok(advancedBtn.classList.contains("is-active"));
  assert.equal(advancedBtn.attributes["aria-pressed"], "true");
  const simpleBtn = root._findOneByDataAttr("data-mode", "simple");
  assert.ok(!simpleBtn.classList.contains("is-active"));
  assert.equal(simpleBtn.attributes["aria-pressed"], "false");
});

test("UI-H1: each button shows Korean label + English subscript", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  const simpleBtn = root._findOneByDataAttr("data-mode", "simple");
  const ko = simpleBtn._findAllByClass("mt-btn-ko");
  const en = simpleBtn._findAllByClass("mt-btn-en");
  assert.equal(ko[0]._textContent, "일반사용자");
  assert.equal(en[0]._textContent, "Simple");
});

test("UI-H1: root has role='group' + aria-label='Monitor mode'", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  assert.equal(root.attributes.role, "group");
  assert.equal(root.attributes["aria-label"], "Monitor mode");
});

test("UI-H1: garbage currentMode falls back to 'simple'", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root, currentMode: "pro",  // invalid
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  const simpleBtn = root._findOneByDataAttr("data-mode", "simple");
  assert.ok(simpleBtn.classList.contains("is-active"));
});

// ── Click behavior ───────────────────────────────────────────────

test("UI-H1: clicking a different mode persists + reloads", () => {
  const root = makeStubElement("div");
  const storage = makeStubStorage();
  let reloadCalls = 0;
  let onSelectArg = null;
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(),
    reloadFn: () => { reloadCalls += 1; },
    storage,
    onModeSelect: (m) => { onSelectArg = m; },
  });

  const advancedBtn = root._findOneByDataAttr("data-mode", "advanced");
  advancedBtn._click();

  // Persistence
  assert.equal(storage.getItem(OrchestratorMonitorMode.STORAGE_KEY), "advanced");
  // Optional callback
  assert.equal(onSelectArg, "advanced");
  // Reload triggered
  assert.equal(reloadCalls, 1);
});

test("UI-H1: clicking the CURRENT mode is a no-op (no persist, no reload)", () => {
  const root = makeStubElement("div");
  const storage = makeStubStorage();
  let reloadCalls = 0;
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(),
    reloadFn: () => { reloadCalls += 1; },
    storage,
  });

  const simpleBtn = root._findOneByDataAttr("data-mode", "simple");
  simpleBtn._click();

  assert.equal(storage.getItem(OrchestratorMonitorMode.STORAGE_KEY), null,
    "no persist on current-mode click");
  assert.equal(reloadCalls, 0, "no reload on current-mode click");
});

test("UI-H1: callback that throws does not break the click handler", () => {
  const root = makeStubElement("div");
  let reloadCalls = 0;
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(),
    reloadFn: () => { reloadCalls += 1; },
    storage: makeStubStorage(),
    onModeSelect: () => { throw new Error("boom"); },
  });

  const advancedBtn = root._findOneByDataAttr("data-mode", "advanced");
  assert.doesNotThrow(() => advancedBtn._click());
  // Reload still happens.
  assert.equal(reloadCalls, 1);
});

test("UI-H1: reloadFn that throws does not throw out of click handler", () => {
  const root = makeStubElement("div");
  modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(),
    reloadFn: () => { throw new Error("nope"); },
    storage: makeStubStorage(),
  });

  const advancedBtn = root._findOneByDataAttr("data-mode", "advanced");
  assert.doesNotThrow(() => advancedBtn._click());
});

// ── Lifecycle ────────────────────────────────────────────────────

test("UI-H1: destroy() clears DOM + removes ARIA attrs", () => {
  const root = makeStubElement("div");
  const handle = modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  assert.equal(root.children.length, 3);

  handle.destroy();

  assert.equal(root.children.length, 0);
  assert.equal(root.attributes.role, undefined);
  assert.equal(root.attributes["aria-label"], undefined);
});

test("UI-H1: _setActive test hook re-renders with new active mode", () => {
  const root = makeStubElement("div");
  const handle = modeToggle.create({
    root, currentMode: "simple",
    doc: makeStubDoc(), reloadFn: () => {},
    storage: makeStubStorage(),
  });
  // Initially: simple is active
  assert.ok(root._findOneByDataAttr("data-mode", "simple")
    .classList.contains("is-active"));

  handle._setActive("legacy");

  // After: legacy is active, simple is not
  assert.ok(root._findOneByDataAttr("data-mode", "legacy")
    .classList.contains("is-active"));
  assert.ok(!root._findOneByDataAttr("data-mode", "simple")
    .classList.contains("is-active"));
});
