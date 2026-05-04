// Slice UI-P1-h (Phase 2 Round 3, 2026-04-30) — product-shell mount tests.
// Pins: mount lifecycle, mode propagation, panel factory injection,
// destroy cleanup, missing-panel placeholder + error handling.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productShell = require("../../public/js/monitor/shells/product-shell");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (mirrors monitor.run-viewer.test.js) ─────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      _classes: new Set(),
      add(...args) { for (const c of args) this._classes.add(c); return this; },
      remove(...args) { for (const c of args) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    style: {},
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
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) { this.children.splice(idx, 1); c.parentNode = null; }
      return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    _findOneByClass(cls) {
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) return c;
        if (typeof c._findOneByClass === "function") {
          const found = c._findOneByClass(cls);
          if (found) return found;
        }
      }
      return null;
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
function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

// ── _coerceMode ──────────────────────────────────────────────────

test("UI-P1: _coerceMode accepts simple/pro, falls back to simple otherwise", () => {
  assert.equal(productShell._coerceMode("simple"), "simple");
  assert.equal(productShell._coerceMode("pro"), "pro");
  assert.equal(productShell._coerceMode("legacy"), "simple");
  assert.equal(productShell._coerceMode("nonsense"), "simple");
  assert.equal(productShell._coerceMode(null), "simple");
  assert.equal(productShell._coerceMode(undefined), "simple");
});

// ── mount/destroy ────────────────────────────────────────────────

test("UI-P1: mount throws on missing root + store + doc", () => {
  const store = createMonitorStore();
  assert.throws(() => productShell.mount({}), /opts required.*|root must be an element/);
  assert.throws(() => productShell.mount({ root: makeRoot() }), /store/);
  assert.throws(
    () => productShell.mount({ root: makeRoot(), store, doc: {} }),
    /no document available/,
  );
});

test("UI-P1: mount creates the 5-region skeleton inside root", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Pass stub panel factories so we don't need window globals.
  const stubFactory = (opts) => {
    const stub = makeStubElement("div");
    stub.className = "stub-panel";
    opts.root.appendChild(stub);
    return { destroy() {}, setMode() {} };
  };
  productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  // root has one child (the .prod-shell wrapper).
  assert.equal(root.children.length, 1);
  const shell = root.children[0];
  assert.ok(shell.classList.contains("prod-shell"));
  assert.equal(shell.getAttribute("data-mode"), "simple", "default mode is simple");
  // Skeleton mounts: header + track + workspace (rail + (grid + terminals)).
  assert.ok(shell._findOneByClass("prod-header-mount"));
  assert.ok(shell._findOneByClass("prod-track-mount"));
  assert.ok(shell._findOneByClass("prod-rail-mount"));
  assert.ok(shell._findOneByClass("prod-grid-mount"));
  assert.ok(shell._findOneByClass("prod-terminals-mount"));
  // All 5 stub panels mounted
  const stubs = shell._findAllByClass("stub-panel");
  assert.equal(stubs.length, 5);
});

test("UI-P1: mount with mode=pro sets data-mode=pro on the shell", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const stubFactory = () => ({ destroy() {}, setMode() {} });
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(), mode: "pro",
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  assert.equal(root.children[0].getAttribute("data-mode"), "pro");
  assert.equal(handle.getMode(), "pro");
});

test("UI-P1: setMode propagates to data-mode + every panel that exposes setMode", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const calls = [];
  const stubFactory = (opts) => ({
    destroy() {},
    setMode(m) { calls.push({ mounted: opts.root.className, mode: m }); },
  });
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  // No setMode called yet — initial mount uses opts.mode.
  assert.equal(calls.length, 0);
  handle.setMode("pro");
  assert.equal(handle.getMode(), "pro");
  assert.equal(root.children[0].getAttribute("data-mode"), "pro");
  // Every panel saw the mode change
  assert.equal(calls.length, 5);
  for (const c of calls) assert.equal(c.mode, "pro");
  // Idempotent — second call to same mode is no-op
  const before = calls.length;
  handle.setMode("pro");
  assert.equal(calls.length, before);
});

test("UI-P1: setMode coerces unknown values to simple (no panel notification on no-op)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const calls = [];
  const stubFactory = () => ({ setMode(m) { calls.push(m); } });
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(), mode: "simple",
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  handle.setMode("garbage");
  // Coerced to "simple" which is current — no propagation
  assert.equal(handle.getMode(), "simple");
  assert.equal(calls.length, 0);
});

test("UI-P1: missing panel factory renders [panel missing: name] placeholder", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Only provide header; track/rail/grid/terminals undefined → placeholders
  productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: () => ({}),
      // track / rail / grid / terminals omitted
    },
  });
  const placeholders = root._findAllByClass("prod-panel-missing");
  assert.equal(placeholders.length, 4, "4 missing panels surface 4 placeholders");
  // Placeholders include the panel name in their text
  const names = placeholders.map((p) => p._textContent);
  assert.ok(names.some((n) => n.includes("harness-track")));
  assert.ok(names.some((n) => n.includes("pipeline-rail")));
  assert.ok(names.some((n) => n.includes("monitor-grid")));
  assert.ok(names.some((n) => n.includes("dual-terminals")));
});

test("UI-P1: panel factory throw renders [panel error] (does NOT crash mount)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: () => { throw new Error("intentional test failure"); },
      track: () => ({}),
      rail: () => ({}),
      grid: () => ({}),
      terminals: () => ({}),
    },
  });
  const errs = root._findAllByClass("prod-panel-error");
  assert.equal(errs.length, 1);
  assert.match(errs[0]._textContent, /intentional test failure/);
});

test("UI-P1: destroy unmounts shell from root + invokes panel destroy hooks", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let destroyed = 0;
  const stubFactory = () => ({ destroy() { destroyed += 1; } });
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  assert.equal(root.children.length, 1);
  handle.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(destroyed, 5, "every panel's destroy hook fires");
});

test("UI-P1: onModeChange callback fires on setMode (for localStorage persistence)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let lastMode = null;
  const stubFactory = () => ({ setMode() {} });
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
    onModeChange(m) { lastMode = m; },
  });
  handle.setMode("pro");
  assert.equal(lastMode, "pro");
});

test("UI-P1: _state() exposes mode + mounted panel count for inspection", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: () => ({}),
      track: () => ({}),
      rail: () => ({}),
      grid: () => ({}),
      terminals: () => ({}),
    },
  });
  const s = handle._state();
  assert.equal(s.mode, "simple");
  assert.equal(s.panelsMounted.length, 5);
});

test("UI-P1: VALID_MODES vocabulary frozen at exactly {simple, pro}", () => {
  assert.deepEqual(productShell.VALID_MODES.slice().sort(), ["pro", "simple"]);
  // Frozen Array — push() throws in strict mode (Node test runner runs
  // modules under strict-mode semantics).
  assert.throws(() => { productShell.VALID_MODES.push("legacy"); });
  assert.throws(() => { productShell.VALID_MODES[0] = "garbage"; });
});
