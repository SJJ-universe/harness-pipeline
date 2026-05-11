// Slice UI-P1-h (Phase 2 Round 3, 2026-04-30) — product-header tests.
// Pins: status pill state machine (idle/running/error per §S decision 4),
// mode toggle, locale toggle, action callbacks, pro-only visibility.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productHeader = require("../../public/js/monitor/panels/product-header");
const { createMonitorStore } = require("../../public/js/monitor/store");

// Reused DOM stub (parallel of product-shell test stub)
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
      // The product-header builds the logo via innerHTML. Allow it.
      this._textContent = "";
      this._innerHtmlBlob = String(v);
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
    _findByAttr(k, v) {
      for (const c of this.children) {
        if (c.attributes && c.attributes[k] === v) return c;
        if (typeof c._findByAttr === "function") {
          const found = c._findByAttr(k, v);
          if (found) return found;
        }
      }
      return null;
    },
  };
  return el;
}
const makeStubDoc = () => ({ createElement: makeStubElement });
const makeRoot = () => makeStubElement("div");

// ── _statusFromStoreSnapshot ─────────────────────────────────────

test("UI-P1: _statusFromStoreSnapshot returns idle on empty/null/missing runs", () => {
  assert.equal(productHeader._statusFromStoreSnapshot(null), "idle");
  assert.equal(productHeader._statusFromStoreSnapshot({}), "idle");
  assert.equal(productHeader._statusFromStoreSnapshot({ runs: null }), "idle");
  assert.equal(productHeader._statusFromStoreSnapshot({ runs: {} }), "idle");
  assert.equal(productHeader._statusFromStoreSnapshot({ runs: new Map() }), "idle");
});

test("UI-P1: _statusFromStoreSnapshot detects active run as running", () => {
  // Map shape (real store)
  const runs = new Map([["r1", { status: "active" }]]);
  assert.equal(productHeader._statusFromStoreSnapshot({ runs }), "running");
  // Plain object shape (test fixture)
  assert.equal(
    productHeader._statusFromStoreSnapshot({ runs: { r1: { status: "running" } } }),
    "running",
  );
});

test("UI-P1: _statusFromStoreSnapshot detects error run when no active runs", () => {
  const runs = new Map([["r1", { status: "error" }], ["r2", { status: "idle" }]]);
  assert.equal(productHeader._statusFromStoreSnapshot({ runs }), "error");
});

test("UI-P1: _statusFromStoreSnapshot prefers active over error (live > stale)", () => {
  const runs = new Map([
    ["r1", { status: "error" }],
    ["r2", { status: "active" }],
  ]);
  assert.equal(productHeader._statusFromStoreSnapshot({ runs }), "running");
});

// ── header creation + initial render ──────────────────────────────

test("UI-P1: create() throws on missing root + store + doc", () => {
  const store = createMonitorStore();
  assert.throws(() => productHeader.create({}), /opts required.*|root must be an element/);
  assert.throws(
    () => productHeader.create({ root: makeRoot() }),
    /store required/,
  );
  assert.throws(
    () => productHeader.create({ root: makeRoot(), store, doc: {} }),
    /no document available/,
  );
});

test("UI-P1: create() initial status pill shows 대기 중 when no runs", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHeader.create({ root, store, doc: makeStubDoc() });
  const s = handle._state();
  assert.equal(s.status, "idle");
  assert.equal(s.statusLabel, "대기 중");
});

test("UI-P1: live store update flips status pill to 실행 중 then 중단됨", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHeader.create({ root, store, doc: makeStubDoc() });
  // Add an active run via the store API
  store.upsertRun("r1", { status: "active" });
  assert.equal(handle._state().status, "running");
  assert.equal(handle._state().statusLabel, "실행 중");
  // Move to error
  store.upsertRun("r1", { status: "error" });
  assert.equal(handle._state().status, "error");
  assert.equal(handle._state().statusLabel, "중단됨");
});

// ── mode toggle ──────────────────────────────────────────────────

test("UI-P1: mode toggle button click invokes onModeChange + updates state", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let lastMode = null;
  const handle = productHeader.create({
    root, store, doc: makeStubDoc(), mode: "simple",
    onModeChange(m) { lastMode = m; },
  });
  // Find the "pro" button via data-mode attribute
  const proBtn = root._findByAttr("data-mode", "pro");
  assert.ok(proBtn, "pro toggle button must exist");
  proBtn._click();
  assert.equal(lastMode, "pro");
  assert.equal(handle._state().mode, "pro");
  assert.equal(proBtn.getAttribute("aria-pressed"), "true");
  // The simple button is now de-pressed
  const simpleBtn = root._findByAttr("data-mode", "simple");
  assert.equal(simpleBtn.getAttribute("aria-pressed"), "false");
});

test("UI-P1: setMode() programmatically updates aria-pressed without firing callback", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let calls = 0;
  const handle = productHeader.create({
    root, store, doc: makeStubDoc(), mode: "simple",
    onModeChange() { calls += 1; },
  });
  handle.setMode("pro");
  // setMode is the programmatic path — callback NOT invoked (avoids
  // infinite loop when shell.setMode → header.setMode).
  assert.equal(calls, 0);
  assert.equal(handle._state().mode, "pro");
});

// ── locale toggle ────────────────────────────────────────────────

test("UI-P1: locale toggle calls onLocaleChange + updates aria-pressed", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let lastLocale = null;
  productHeader.create({
    root, store, doc: makeStubDoc(),
    onLocaleChange(l) { lastLocale = l; },
  });
  const enBtn = root._findByAttr("data-locale", "en");
  enBtn._click();
  assert.equal(lastLocale, "en");
  assert.equal(enBtn.getAttribute("aria-pressed"), "true");
  const koBtn = root._findByAttr("data-locale", "ko");
  assert.equal(koBtn.getAttribute("aria-pressed"), "false");
});

// ── action callbacks ─────────────────────────────────────────────

test("UI-P1: pro action button click fires onActionClick with action id", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const actions = [];
  productHeader.create({
    root, store, doc: makeStubDoc(),
    onActionClick(id) { actions.push(id); },
  });
  // LEGACY-VIEW-REMOVE-0 (2026-05-11): metrics + history buttons were
  // removed when their legacy-view targets disappeared. The remaining
  // pro-action surface is just shutdown.
  const shutdownBtn = root._findByAttr("data-action", "shutdown");
  shutdownBtn._click();
  assert.deepEqual(actions, ["shutdown"]);
});

// ── pro-only visibility ──────────────────────────────────────────

test("UI-P1: pro-only buttons hidden in simple mode (display:none)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHeader.create({
    root, store, doc: makeStubDoc(), mode: "simple",
  });
  const proActions = root._findOneByClass("prod-header-pro-actions");
  assert.equal(proActions.style.display, "none");
  // Switch mode → reveals
  handle.setMode("pro");
  assert.equal(proActions.style.display, "");
});

// ── lifecycle ────────────────────────────────────────────────────

test("UI-P1: destroy unsubscribes + removes from root", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHeader.create({ root, store, doc: makeStubDoc() });
  assert.equal(root.children.length, 1);
  handle.destroy();
  assert.equal(root.children.length, 0);
  // Subsequent store updates do not throw (subscription gone)
  assert.doesNotThrow(() => store.upsertRun("r1", { status: "active" }));
});

// ── frozen vocabulary ────────────────────────────────────────────

test("UI-P1: STATUS_VARIANTS is frozen with 3 keys (idle/running/error)", () => {
  const keys = Object.keys(productHeader.STATUS_VARIANTS).sort();
  assert.deepEqual(keys, ["error", "idle", "running"]);
  assert.throws(() => { productHeader.STATUS_VARIANTS.foo = {}; });
});
