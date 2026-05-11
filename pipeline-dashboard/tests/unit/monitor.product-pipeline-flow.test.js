// SIMPLE-MODE-VIZ-0 (2026-05-08) — Phase Flow Diagram tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productPipelineFlow = require("../../public/js/monitor/panels/product-pipeline-flow");
const productShellData = require("../../public/js/monitor/product-shell-data");
const { createMonitorStore } = require("../../public/js/monitor/store");

// DOM stub mirroring the rest of the monitor test suite.
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
    _findAllByAttr(k, v) {
      const out = [];
      if (this.attributes && this.attributes[k] === v) out.push(this);
      for (const c of this.children) {
        if (typeof c._findAllByAttr === "function") {
          out.push(...c._findAllByAttr(k, v));
        }
      }
      return out;
    },
    _findAllByAttrPresent(k) {
      const out = [];
      if (this.attributes && Object.prototype.hasOwnProperty.call(this.attributes, k)) out.push(this);
      for (const c of this.children) {
        if (typeof c._findAllByAttrPresent === "function") {
          out.push(...c._findAllByAttrPresent(k));
        }
      }
      return out;
    },
  };
  return el;
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  createTextNode: (t) => ({ nodeType: 3, textContent: String(t || "") }),
});
const makeRoot = () => makeStubElement("div");

// ── Skeleton ──────────────────────────────────────────────────────

test("SIMPLE-MODE-VIZ-0: flow mounts 4 phase boxes (A/B/C/D) + 3 forward arrows + loop", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  const flow = root._findOneByAttr("data-region", "pipeline-flow");
  assert.ok(flow);
  for (const id of ["A", "B", "C", "D"]) {
    assert.ok(root._findOneByAttr("data-flow-box", id),
      `box data-flow-box="${id}" must mount`);
  }
  for (const id of ["A>B", "B>C", "C>D"]) {
    assert.ok(root._findOneByAttr("data-flow-arrow", id),
      `arrow data-flow-arrow="${id}" must mount`);
  }
  assert.ok(root._findOneByAttr("data-flow-arrow", "D>C"),
    "loop arrow data-flow-arrow='D>C' must mount");
});

test("SIMPLE-MODE-VIZ-0: idle state — all boxes pending, all arrows dormant", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  const flow = root._findOneByAttr("data-region", "pipeline-flow");
  assert.equal(flow.attributes["data-flow-state"], "idle");
  for (const id of ["A", "B", "C", "D"]) {
    const b = root._findOneByAttr("data-flow-box", id);
    assert.equal(b.attributes["data-flow-box-state"], "pending");
  }
  for (const id of ["A>B", "B>C", "C>D", "D>C"]) {
    const a = root._findOneByAttr("data-flow-arrow", id);
    assert.equal(a.attributes["data-flow-arrow-state"], "dormant");
  }
});

// ── Phase progression ────────────────────────────────────────────

test("SIMPLE-MODE-VIZ-0: run.phase='B' active → box B active, A completed", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", { status: "active", phase: "B", startedAt: 1000 });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-flow-box", "A").attributes["data-flow-box-state"], "completed");
  assert.equal(root._findOneByAttr("data-flow-box", "B").attributes["data-flow-box-state"], "active");
  assert.equal(root._findOneByAttr("data-flow-box", "C").attributes["data-flow-box-state"], "pending");
});

test("SIMPLE-MODE-VIZ-0: run.phase='C' active → C active, A+B completed", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", { status: "active", phase: "C", startedAt: 1000 });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-flow-box", "A").attributes["data-flow-box-state"], "completed");
  assert.equal(root._findOneByAttr("data-flow-box", "B").attributes["data-flow-box-state"], "completed");
  assert.equal(root._findOneByAttr("data-flow-box", "C").attributes["data-flow-box-state"], "active");
  assert.equal(root._findOneByAttr("data-flow-box", "D").attributes["data-flow-box-state"], "pending");
});

test("SIMPLE-MODE-VIZ-0: phase='C' active → arrow B>C is active", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", { status: "active", phase: "C", startedAt: 1000 });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-flow-arrow", "B>C").attributes["data-flow-arrow-state"], "active");
  assert.equal(root._findOneByAttr("data-flow-arrow", "A>B").attributes["data-flow-arrow-state"], "dormant");
});

test("SIMPLE-MODE-VIZ-0: phase='D' active → loop D>C is active", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", { status: "active", phase: "D", startedAt: 1000 });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  const loop = root._findOneByAttr("data-flow-arrow", "D>C");
  assert.equal(loop.attributes["data-flow-arrow-state"], "active");
});

test("SIMPLE-MODE-VIZ-0: status='completed' → all boxes completed, root state 'complete'", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", {
    status: "completed", phase: "C", startedAt: 1000, completedAt: 5000,
  });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  for (const id of ["A", "B", "C", "D"]) {
    assert.equal(root._findOneByAttr("data-flow-box", id).attributes["data-flow-box-state"], "completed");
  }
  assert.equal(root._findOneByAttr("data-region", "pipeline-flow").attributes["data-flow-state"], "complete");
});

test("SIMPLE-MODE-VIZ-0: status='error' → root state 'error', meta says Failed", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R", { status: "error", phase: "C", startedAt: 1000 });
  store.selectRun("R");
  productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-region", "pipeline-flow").attributes["data-flow-state"], "error");
  const meta = root._findOneByAttr("data-flow-slot", "meta");
  assert.match(meta.textContent, /실패|Failed/);
});

// ── Locale ──────────────────────────────────────────────────────

test("SIMPLE-MODE-VIZ-0: setLocale('en') swaps box labels to English", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData, locale: "ko",
  });
  // Korean default
  const boxA = root._findOneByAttr("data-flow-box", "A");
  const labelA = boxA.children.find(c => c.classList && c.classList.contains("prod-pipeline-flow-box-label"));
  assert.equal(labelA.textContent, "컨텍스트");
  // Switch
  handle.setLocale("en");
  assert.equal(labelA.textContent, "Context");
});

// ── Lifecycle ───────────────────────────────────────────────────

test("SIMPLE-MODE-VIZ-0: destroy() clears interval + unsubscribes + removes from DOM", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productPipelineFlow.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  assert.equal(root.children.length, 1);
  handle.destroy();
  assert.equal(root.children.length, 0);
});

test("SIMPLE-MODE-VIZ-0: PHASES export has 4 entries A/B/C/D", () => {
  assert.equal(productPipelineFlow.PHASES.length, 4);
  assert.deepEqual(
    productPipelineFlow.PHASES.map(p => p.letter),
    ["A", "B", "C", "D"],
  );
});
