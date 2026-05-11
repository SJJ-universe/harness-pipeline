// Slice UI-FirstRun-c (Phase D Round UI-P, 2026-05-04) — simple-shell
// integration tests for the next-action-card mount + onFirstRunCta
// dispatch behavior. Mounts a stub panel via `panels:` injection
// so we can assert the mount happens and the CTA dispatcher is
// wired correctly.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const shell = require("../../public/js/monitor/shells/simple-shell");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (matches monitor.next-action-card.test.js shape) ──

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
    };
  }
  return {
    createElement(tag) { return _makeEl(tag); },
    body: _makeEl("body"),
  };
}

// Stub next-action-card panel — we only verify simple-shell DOES
// mount it and DOES pass it the `onCta` callback.
function _stubNextActionCard() {
  const calls = { creates: [], destroys: [] };
  const handles = [];
  return {
    calls,
    panel: {
      create({ root, store, doc, onCta, i18n }) {
        const card = doc.createElement("section");
        card.setAttribute("data-card", "next-action");
        root.appendChild(card);
        const h = {
          card,
          _onCta: onCta,
          _hasI18n: !!i18n,
          destroy() { calls.destroys.push(card); root.removeChild(card); },
        };
        calls.creates.push({ root, store, onCta, i18n });
        handles.push(h);
        return h;
      },
    },
    handles,
  };
}

// ── Tests ───────────────────────────────────────────────────────

test("UI-FirstRun simple-shell: mounts next-action-card via panels.nextActionCard injection", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
  });
  assert.equal(stub.calls.creates.length, 1, "next-action-card must be mounted exactly once");
  // The card must be in the ss-first-run-mount container, NOT the grid.
  const firstRunMount = doc.body._findByClass("ss-first-run-mount");
  assert.ok(firstRunMount, "simple-shell must create .ss-first-run-mount container");
  const card = firstRunMount.children[0];
  assert.equal(card.getAttribute("data-card"), "next-action",
    "next-action-card must mount inside ss-first-run-mount");
});

test("UI-FirstRun simple-shell: forwards i18n option to next-action-card", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const fakeI18n = { t: (k) => k };
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    i18n: fakeI18n,
  });
  assert.equal(stub.calls.creates[0].i18n, fakeI18n,
    "i18n must be forwarded to next-action-card so it can localize copy");
});

test("UI-FirstRun simple-shell: onFirstRunCta is the primary dispatcher when wired", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const ctaCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onFirstRunCta: (id, meta) => ctaCalls.push({ id, meta }),
  });
  // Simulate the panel's onCta firing
  const onCta = stub.calls.creates[0].onCta;
  onCta("open-setup-wizard", { foo: "bar" });
  assert.equal(ctaCalls.length, 1);
  assert.equal(ctaCalls[0].id, "open-setup-wizard");
  assert.deepEqual(ctaCalls[0].meta, { foo: "bar" });
});

test("UI-FirstRun simple-shell: open-setup-wizard CTA falls back to onOpenSetupWizard", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const wizardCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onOpenSetupWizard: () => wizardCalls.push(true),
    // Note: onFirstRunCta not wired — fallback dispatch should kick in.
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("open-setup-wizard", {});
  onCta("reopen-setup-for-providers", {});
  onCta("create-profile", {});
  assert.equal(wizardCalls.length, 3,
    "all 3 setup-wizard-style CTAs should fall back to onOpenSetupWizard");
});

test("UI-FirstRun simple-shell: open-settings-profiles + open-public-sector-setup fall back to onOpenSettings", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const settingsCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onOpenSettings: () => settingsCalls.push(true),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("open-settings-profiles", {});
  onCta("open-public-sector-setup", {});
  assert.equal(settingsCalls.length, 2);
});

test("UI-FirstRun simple-shell: test-claude / test-codex fall back to onTestProvider with runner ID", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const testCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onTestProvider: (runner) => testCalls.push(runner),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("test-claude", {});
  onCta("test-codex", {});
  assert.deepEqual(testCalls, ["claude", "codex"]);
});

test("UI-FirstRun simple-shell: auth-claude / auth-codex fall back to onAuthProvider with runner ID", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const authCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onAuthProvider: (runner) => authCalls.push(runner),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("auth-claude", {});
  onCta("auth-codex", {});
  assert.deepEqual(authCalls, ["claude", "codex"]);
});

test("UI-FirstRun simple-shell: unknown CTA with no fallback handler is a silent no-op", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    // No callbacks wired
  });
  const onCta = stub.calls.creates[0].onCta;
  // Should NOT throw
  onCta("unknown-cta", {});
  onCta("test-claude", {});
});

test("UI-FirstRun simple-shell: thrown handler in fallback dispatch does not crash the shell", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
    onOpenSetupWizard: () => { throw new Error("boom"); },
  });
  const onCta = stub.calls.creates[0].onCta;
  // Should NOT throw — the dispatcher swallows handler exceptions
  onCta("open-setup-wizard", {});
});

test("UI-FirstRun simple-shell: next-action-card is destroyed when shell is destroyed", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubNextActionCard();
  const handle = shell.mount({
    root: doc.body, store, doc,
    panels: { nextActionCard: stub.panel },
  });
  assert.equal(stub.handles.length, 1);
  handle.destroy();
  assert.equal(stub.calls.destroys.length, 1,
    "next-action-card.destroy must be called from shell.destroy");
});

test("UI-FirstRun simple-shell: card mount survives if the panel constructor is missing", () => {
  // No panels.nextActionCard, no globalThis.OrchestratorNextActionCard.
  // Shell should NOT crash — the absent card simply doesn't render.
  const doc = _makeDoc();
  const store = createMonitorStore();
  const handle = shell.mount({ root: doc.body, store, doc });
  assert.ok(handle, "shell.mount must succeed even without next-action-card");
  // ss-first-run-mount container is still created (cheap empty div)
  const firstRunMount = doc.body._findByClass("ss-first-run-mount");
  assert.ok(firstRunMount);
  assert.equal(firstRunMount.children.length, 0,
    "first-run mount container is empty when panel is absent");
});
