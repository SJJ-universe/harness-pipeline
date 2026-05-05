// Slice PRODUCT-SHELL-WIRING (rc.5 prep, 2026-05-06) — pipeline-rail
// onActionClick wiring tests.
//
// Pre-rc.5 the rail panel created the 작업 시작 / compact / 템플릿 buttons
// with `data-action` attributes but attached zero event listeners — clicks
// fired into the void. This round adds an `opts.onActionClick(actionId)`
// callback that the rail invokes per click. These tests pin the contract.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productPipelineRail = require("../../public/js/monitor/panels/product-pipeline-rail");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (mirrors the one used in monitor.product-slot-contract.test.js
//    and monitor.product-shell.test.js). Supports addEventListener capture
//    so we can fire synthetic clicks via `_click()`.

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    style: {},
    classList: {
      _classes: new Set(),
      add(...args) { for (const c of args) this._classes.add(c); return this; },
      remove(...args) { for (const c of args) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
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
    _click() {
      const fns = listeners.click || [];
      for (const fn of fns) fn({ type: "click", target: el });
    },
    _findOneByAttr(k, v) {
      if (this.attributes && this.attributes[k] === v) return this;
      for (const c of this.children) {
        if (typeof c._findOneByAttr === "function") {
          const found = c._findOneByAttr(k, v);
          if (found) return found;
        }
      }
      return null;
    },
  };
  return el;
}
function makeStubTextNode(text) {
  return {
    nodeType: 3,
    nodeValue: String(text || ""),
    textContent: String(text || ""),
    parentNode: null,
    classList: { contains() { return false; } },
    attributes: {},
    children: [],
    _findOneByAttr() { return null; },
  };
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  createTextNode: makeStubTextNode,
});
const makeRoot = () => makeStubElement("div");

test("rail fires onActionClick(\"pipeline-start\") when 작업 시작 button is clicked", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const seen = [];
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "simple",
    onActionClick: (id) => seen.push(id),
  });
  const btn = root._findOneByAttr("data-action", "pipeline-start");
  assert.ok(btn, "작업 시작 button must be rendered");
  btn._click();
  assert.deepEqual(seen, ["pipeline-start"]);
});

test("rail fires onActionClick(\"pipeline-compact\") in pro mode", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const seen = [];
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    onActionClick: (id) => seen.push(id),
  });
  const btn = root._findOneByAttr("data-action", "pipeline-compact");
  assert.ok(btn, "compact button must be rendered in pro mode");
  btn._click();
  assert.deepEqual(seen, ["pipeline-compact"]);
});

test("rail fires onActionClick(\"pipeline-template\") in pro mode", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const seen = [];
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    onActionClick: (id) => seen.push(id),
  });
  const btn = root._findOneByAttr("data-action", "pipeline-template");
  assert.ok(btn, "템플릿 button must be rendered in pro mode");
  btn._click();
  assert.deepEqual(seen, ["pipeline-template"]);
});

test("rail does NOT throw when opts.onActionClick is omitted (default no-op)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    // onActionClick omitted on purpose
  });
  const startBtn = root._findOneByAttr("data-action", "pipeline-start");
  const compactBtn = root._findOneByAttr("data-action", "pipeline-compact");
  const templateBtn = root._findOneByAttr("data-action", "pipeline-template");
  // Defensive default — clicking should be a silent no-op, never throw.
  assert.doesNotThrow(() => startBtn._click());
  assert.doesNotThrow(() => compactBtn._click());
  assert.doesNotThrow(() => templateBtn._click());
});

test("rail swallows handler errors so a buggy action handler can't break the panel", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    onActionClick: () => { throw new Error("handler exploded"); },
  });
  const btn = root._findOneByAttr("data-action", "pipeline-start");
  // Click MUST NOT bubble the error — the rail's try/catch defends.
  assert.doesNotThrow(() => btn._click());
});
