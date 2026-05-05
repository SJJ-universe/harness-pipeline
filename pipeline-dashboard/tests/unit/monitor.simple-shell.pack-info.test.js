// Slice POL-UI-1-a (Phase 2 v2 follow-up, 2026-05-05) — simple-shell
// integration tests for the pack-info-card mount.
//
// Mirrors monitor.simple-shell.smart1.test.js pattern: stub the panel,
// inject via panels.packInfo, verify the shell:
//   1. mounts pack-info-card exactly once
//   2. creates the .ss-pack-info-mount container
//   3. forwards i18n option through
//   4. is tolerant of pack-info-card not being injected
//   5. destroys the panel cleanly on shell teardown

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const shell = require("../../public/js/monitor/shells/simple-shell");
const { createMonitorStore } = require("../../public/js/monitor/store");

function _makeDoc() {
  function _makeEl(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      _classList: new Set(),
      _innerHTML: "",
      get className() { return Array.from(this._classList).join(" "); },
      set className(v) {
        this._classList = new Set(String(v).split(/\s+/).filter(Boolean));
      },
      _textContent: "",
      get textContent() {
        if (this._textContent) return this._textContent;
        return this.children.map((c) => c.textContent || "").join("");
      },
      set textContent(v) {
        this._textContent = String(v);
        this.children = [];
      },
      get firstChild() { return this.children[0] || null; },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) {
        this._innerHTML = String(v);
        if (v === "") this.children = [];
      },
      get classList() {
        return {
          add: (cls) => this._classList.add(cls),
          remove: (cls) => this._classList.delete(cls),
          contains: (cls) => this._classList.has(cls),
        };
      },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
      addEventListener() {},
      type: "",
      _findByClass(cls) {
        if (this._classList.has(cls)) return this;
        for (const c of this.children) {
          if (c._findByClass) {
            const found = c._findByClass(cls);
            if (found) return found;
          }
        }
        return null;
      },
      _findByAttr(attr, value) {
        if (this.attrs[attr] === value) return this;
        for (const c of this.children) {
          if (c._findByAttr) {
            const found = c._findByAttr(attr, value);
            if (found) return found;
          }
        }
        return null;
      },
    };
  }
  return {
    createElement(tag) { return _makeEl(tag); },
    body: _makeEl("body"),
  };
}

function _stubPackInfo() {
  const calls = { creates: [], destroys: [] };
  return {
    calls,
    panel: {
      create({ root, store, doc, onCta, i18n }) {
        const card = doc.createElement("section");
        card.setAttribute("data-card", "pack-info");
        root.appendChild(card);
        calls.creates.push({ root, store, onCta, i18n });
        return {
          card,
          destroy() {
            calls.destroys.push(card);
            try { root.removeChild(card); } catch (_) {}
          },
        };
      },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────

test("POL-UI-1-a shell: mounts pack-info-card via panels.packInfo injection", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubPackInfo();
  shell.mount({
    root: doc.body, store, doc,
    panels: { packInfo: stub.panel },
  });
  assert.equal(stub.calls.creates.length, 1,
    "pack-info-card must be mounted exactly once");
  // Card mounts in .ss-pack-info-mount container
  const mount = doc.body._findByClass("ss-pack-info-mount");
  assert.ok(mount, "simple-shell must create .ss-pack-info-mount container");
  const card = mount.children[0];
  assert.equal(card.getAttribute("data-card"), "pack-info");
});

test("POL-UI-1-a shell: forwards i18n option to pack-info-card", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubPackInfo();
  const fakeI18n = { t: (k) => k };
  shell.mount({
    root: doc.body, store, doc,
    panels: { packInfo: stub.panel },
    i18n: fakeI18n,
  });
  assert.equal(stub.calls.creates[0].i18n, fakeI18n,
    "i18n module forwarded to pack-info create()");
});

test("POL-UI-1-a shell: forwards a callable onCta seam to pack-info-card", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubPackInfo();
  shell.mount({
    root: doc.body, store, doc,
    panels: { packInfo: stub.panel },
  });
  const onCta = stub.calls.creates[0].onCta;
  // The seam exists today as a placeholder for future CTAs (e.g. "open
  // deployment guide" / "compare packs"). It must be callable without
  // throwing even though it has no wired behaviour yet.
  assert.equal(typeof onCta, "function",
    "shell forwards a callable onCta seam (future-extensible)");
  assert.doesNotThrow(() => onCta("any-future-cta", { meta: "x" }),
    "onCta is a no-op stub today; future slices may add dispatch");
});

test("POL-UI-1-a shell: tolerates pack-info-card NOT being injected (missing panel)", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  // No panels.packInfo — and no globalThis.HarnessPackInfoCard
  // (Node test process is clean per file). Shell must not throw.
  assert.doesNotThrow(() => {
    shell.mount({ root: doc.body, store, doc });
  });
  // Mount container is still created (empty placeholder) — that's
  // fine because the shell itself owns the layout slot.
  const mount = doc.body._findByClass("ss-pack-info-mount");
  assert.ok(mount, ".ss-pack-info-mount container always exists");
  // No child card was added (panel constructor wasn't resolvable)
  assert.equal(mount.children.length, 0,
    "no card injected when panels.packInfo missing");
});

test("POL-UI-1-a shell: destroy() tears down pack-info-card", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubPackInfo();
  const handle = shell.mount({
    root: doc.body, store, doc,
    panels: { packInfo: stub.panel },
  });
  assert.equal(stub.calls.creates.length, 1);
  handle.destroy();
  assert.equal(stub.calls.destroys.length, 1,
    "pack-info-card destroy() must run on shell teardown");
});

test("POL-UI-1-a shell: pack-info-card mount sits BETWEEN recommendations and the 4-card grid", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  // No panel stubs at all — just verify the mount slots exist in
  // the right order in the root's children.
  shell.mount({ root: doc.body, store, doc });
  const root = doc.body;
  // Iterate through root.children, find positions of named mounts
  const classNames = root.children.map((c) => c.className);
  const idxRecs = classNames.indexOf("ss-recs-mount");
  const idxPackInfo = classNames.indexOf("ss-pack-info-mount");
  // Find the grid (.ss-grid)
  const idxGrid = classNames.findIndex((cn) => cn.split(/\s+/).includes("ss-grid"));
  assert.ok(idxRecs >= 0, ".ss-recs-mount exists");
  assert.ok(idxPackInfo >= 0, ".ss-pack-info-mount exists");
  assert.ok(idxGrid >= 0, ".ss-grid exists");
  assert.ok(idxRecs < idxPackInfo,
    "recommendations-card mount must come BEFORE pack-info-card mount");
  assert.ok(idxPackInfo < idxGrid,
    "pack-info-card mount must come BEFORE the 4-card grid");
});
