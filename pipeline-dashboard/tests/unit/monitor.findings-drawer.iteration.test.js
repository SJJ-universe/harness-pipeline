// UX-POLISH-1 (2026-05-11) — findings-drawer iteration section tests.
//
// Asserts the new "비평 반복" section renders:
//   - iteration count line
//   - drivers grouped by severity with sample message
//   - per-iteration timeline (done vs. active)
//   - i18n key resolution (NOT raw keys like "drawer.findings.title")
//   - empty state when there's no iteration data
//
// Also pins the legacy sections (findings/tools/critique) still render
// correctly alongside the new iteration section.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const drawer = require("../../public/js/monitor/panels/findings-drawer");

// ── DOM stub ─────────────────────────────────────────────────────

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
      add(...a) { for (const c of a) this._classes.add(c); return this; },
      remove(...a) { for (const c of a) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    get firstChild() { return this.children[0] || null; },
    _textContent: "",
    get textContent() {
      if (this.children.length === 0) return this._textContent;
      let s = this._textContent;
      for (const c of this.children) {
        s += (c.textContent || "");
      }
      return s;
    },
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
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    focus() { this._focused = true; },
    _findOneByAttr(k, v) {
      if (this.attributes && this.attributes[k] === v) return this;
      for (const c of this.children) {
        if (typeof c._findOneByAttr === "function") {
          const f = c._findOneByAttr(k, v);
          if (f) return f;
        }
      }
      return null;
    },
    _findAllByClass(cls) {
      const out = [];
      if (this.classList && this.classList.contains(cls)) out.push(this);
      for (const c of this.children) {
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
  };
  return el;
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
});
const makeRoot = () => makeStubElement("div");

// ── Store stub ───────────────────────────────────────────────────

function makeStubStore(snap) {
  const subs = new Set();
  return {
    snapshot() { return snap; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    _publish() { for (const fn of subs) fn(snap); },
  };
}

// ── i18n stub (Korean fallback) ──────────────────────────────────

const KO_KEYS = {
  "drawer.findings.title":              "비평 요약 · 발견 사항 · 도구 호출",
  "drawer.findings.aria":               "비평 요약 + 발견 사항 + 도구 호출 + 비평 타임라인 drawer",
  "drawer.findings.close":              "닫기",
  "drawer.findings.section.iterations": "비평 반복",
  "drawer.findings.section.findings":   "발견 사항",
  "drawer.findings.section.tools":      "도구 호출",
  "drawer.findings.section.critique":   "비평 타임라인",
  "drawer.findings.empty.iterations":   "아직 비평 반복이 없습니다.",
  "drawer.findings.iteration.totalLabel":   "총 진행:",
  "drawer.findings.iteration.totalValue":   "{n}번",
  "drawer.findings.iteration.driverHeader": "재진입 사유",
  "drawer.findings.iteration.driverItem":   "{sev} × {n}",
  "drawer.findings.iteration.timelineHeader": "단계별 소요",
  "drawer.findings.iteration.timelineItem":   "{n}번 비평 — {sec}초",
  "drawer.findings.iteration.timelineActive": "{n}번 비평 — 진행 중",
};
function tFn(key) { return KO_KEYS[key] || key; }

// ── Mount with iteration data ────────────────────────────────────

function mountDrawer(opts) {
  const root = makeRoot();
  // Default snapshot so _refresh() doesn't bail at `if (!snap) return`.
  // The selectors stub is what really drives the test data — snap is
  // just a non-null token the drawer passes through.
  const snap = (opts && opts.snap) || { _stub: true };
  const store = makeStubStore(snap);
  const selectors = (opts && opts.selectors) || {};
  const handle = drawer.mount({
    root: root,
    doc: makeStubDoc(),
    store: store,
    selectors: selectors,
    t: opts && opts.t,
  });
  return { root, store, handle };
}

// ── Tests ────────────────────────────────────────────────────────

test("UX-POLISH-1 drawer: mounts new iterations section in addition to existing sections", () => {
  const { root } = mountDrawer({});
  const sections = ["iterations", "findings", "tools", "critique"];
  for (const id of sections) {
    const sec = root._findOneByAttr("data-drawer-section", id);
    assert.ok(sec, "section " + id + " must mount");
  }
});

test("UX-POLISH-1 drawer: iteration section title renders i18n value, not raw key", () => {
  const { root } = mountDrawer({ t: tFn });
  const iterSec = root._findOneByAttr("data-drawer-section", "iterations");
  // The title h3 lives as the first child of the section.
  const title = iterSec.children[0];
  assert.equal(title.textContent, "비평 반복",
    "section title must use the i18n value, not the literal key");
  // Drawer header title should also be translated.
  const headSlot = root._findOneByAttr("data-drawer-slot", "head");
  const headTitle = headSlot.children[0];
  assert.equal(headTitle.textContent, "비평 요약 · 발견 사항 · 도구 호출");
});

test("UX-POLISH-1 drawer: empty iteration data renders empty-state message (translated)", () => {
  const { root, handle } = mountDrawer({
    t: tFn,
    selectors: {
      selectActiveRunId() { return "r1"; },
      selectIterationSummary() { return null; },
      selectFindings() { return null; },
      selectRecentToolCalls() { return null; },
      selectCritique() { return null; },
    },
  });
  handle.open();
  const iterSec = root._findOneByAttr("data-drawer-section", "iterations");
  const emptyMsgs = iterSec._findAllByClass("prod-findings-drawer-empty");
  assert.equal(emptyMsgs.length, 1);
  assert.equal(emptyMsgs[0].textContent, "아직 비평 반복이 없습니다.");
});

test("UX-POLISH-1 drawer: iteration count line renders with i18n + count substitution", () => {
  const summary = {
    iterations: 3,
    drivers: [],
    timeline: [],
  };
  const { root, handle } = mountDrawer({
    t: tFn,
    selectors: {
      selectActiveRunId() { return "r1"; },
      selectIterationSummary() { return summary; },
    },
  });
  handle.open();
  const iterSec = root._findOneByAttr("data-drawer-section", "iterations");
  const totalRow = iterSec._findAllByClass("prod-findings-drawer-iter-total")[0];
  assert.ok(totalRow, "total row must mount");
  // textContent concatenates label + value: "총 진행:" + "3번"
  assert.match(totalRow.textContent, /총 진행:/);
  assert.match(totalRow.textContent, /3번/);
});

test("UX-POLISH-1 drawer: drivers list renders with severity + count + sample message", () => {
  const summary = {
    iterations: 2,
    drivers: [
      { severity: "critical", count: 1, sampleMessage: "null ref in foo.js" },
      { severity: "high",     count: 2, sampleMessage: "unused import" },
    ],
    timeline: [],
  };
  const { root, handle } = mountDrawer({
    t: tFn,
    selectors: {
      selectActiveRunId() { return "r1"; },
      selectIterationSummary() { return summary; },
    },
  });
  handle.open();
  const iterSec = root._findOneByAttr("data-drawer-section", "iterations");
  const driverItems = iterSec._findAllByClass("prod-findings-drawer-iter-driver");
  assert.equal(driverItems.length, 2);
  assert.match(driverItems[0].textContent, /CRITICAL × 1/);
  assert.match(driverItems[0].textContent, /null ref in foo\.js/);
  assert.equal(driverItems[0].getAttribute("data-severity"), "critical");
  assert.match(driverItems[1].textContent, /HIGH × 2/);
  assert.match(driverItems[1].textContent, /unused import/);
});

test("UX-POLISH-1 drawer: timeline shows duration in seconds + active marker", () => {
  const summary = {
    iterations: 2,
    drivers: [],
    timeline: [
      { n: 1, durationMs: 12300, status: "done" },
      { n: 2, durationMs: null,  status: "active" },
    ],
  };
  const { root, handle } = mountDrawer({
    t: tFn,
    selectors: {
      selectActiveRunId() { return "r1"; },
      selectIterationSummary() { return summary; },
    },
  });
  handle.open();
  const iterSec = root._findOneByAttr("data-drawer-section", "iterations");
  const timelineRows = iterSec._findAllByClass("prod-findings-drawer-iter-timeline-row");
  assert.equal(timelineRows.length, 2);
  assert.match(timelineRows[0].textContent, /1번 비평 — 12\.3초/);
  assert.equal(timelineRows[0].getAttribute("data-status"), "done");
  assert.match(timelineRows[1].textContent, /2번 비평 — 진행 중/);
  assert.equal(timelineRows[1].getAttribute("data-status"), "active");
});

test("UX-POLISH-1 drawer: raw i18n keys NEVER reach the DOM (regression for raw-key bug)", () => {
  const { root } = mountDrawer({ t: tFn });
  // Walk the whole tree and assert no element's textContent equals
  // a literal key path like "drawer.findings.*"
  function walk(node) {
    if (!node) return;
    const txt = node._textContent || "";
    assert.ok(!/^drawer\.findings\./.test(txt),
      "found raw key on element: " + txt);
    for (const c of (node.children || [])) walk(c);
  }
  walk(root);
});
