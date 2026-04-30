// Slice UI-H8 (Phase D / Phase E1.5, 2026-04-30) — first-visit welcome
// overlay panel tests. Pins the three classifications + dismissal +
// CTA wiring + simple-shell integration.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const welcomeOverlay = require("../../public/js/monitor/panels/welcome-overlay");
const simpleShell = require("../../public/js/monitor/shells/simple-shell");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (matches monitor.simple-shell.test.js conventions) ────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(...args) { for (const c of args) this._classes.add(c); return this; },
      remove(...args) { for (const c of args) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toggle(c, force) {
        if (force === true) { this._classes.add(c); return true; }
        if (force === false) { this._classes.delete(c); return false; }
        if (this._classes.has(c)) { this._classes.delete(c); return false; }
        this._classes.add(c); return true;
      },
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
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
    _findOneByClass(cls) {
      const arr = this._findAllByClass(cls);
      return arr.length > 0 ? arr[0] : null;
    },
    _allText() {
      let out = this._textContent || "";
      for (const c of this.children) {
        if (typeof c._allText === "function") out += c._allText();
      }
      return out;
    },
  };
  return el;
}
function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }
function makeStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _map() { return map; },
  };
}

// ── _classify ──────────────────────────────────────────────────────

test("UI-H8: _classify returns 'first-visit' when no profiles + no active", () => {
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  assert.equal(welcomeOverlay._classify(store.snapshot()), "first-visit");
});

test("UI-H8: _classify returns 'no-active' when profiles > 0 but activeId null", () => {
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 2, activeId: null } });
  assert.equal(welcomeOverlay._classify(store.snapshot()), "no-active");
});

test("UI-H8: _classify returns 'ready' when activeId is set", () => {
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 1, activeId: "personal", activeLabel: "Personal" } });
  assert.equal(welcomeOverlay._classify(store.snapshot()), "ready");
});

test("UI-H8: _classify treats missing accountStatus as 'first-visit'", () => {
  const store = createMonitorStore();
  // accountStatus is null on a fresh store
  assert.equal(welcomeOverlay._classify(store.snapshot()), "first-visit");
});

// ── First-visit render ────────────────────────────────────────────

test("UI-H8: renders first-visit banner with two CTAs + dismiss", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
  });
  assert.ok(root.classList.contains("wo-banner"));
  assert.ok(root.classList.contains("wo-first-visit"));
  assert.equal(root.attributes.role, "region");
  assert.match(root._findOneByClass("wo-title")._textContent, /환영합니다/);

  const actions = root._findAllByClass("wo-action");
  assert.equal(actions.length, 2);
  assert.match(actions[0]._textContent, /설정 마법사로 시작/);
  assert.match(actions[1]._textContent, /개인 프로필 빠른 생성/);
  assert.ok(root._findOneByClass("wo-dismiss"));
  assert.equal(handle._classification(), "first-visit");
});

test("UI-H8: first-visit primary CTA fires onOpenSetupWizard", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  let opened = 0;
  welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
    onOpenSetupWizard: () => { opened += 1; },
  });
  root._findAllByClass("wo-action")[0]._click();
  assert.equal(opened, 1);
});

test("UI-H8: first-visit secondary CTA fires onCreatePersonal", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  let created = 0;
  welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
    onCreatePersonal: () => { created += 1; },
  });
  root._findAllByClass("wo-action")[1]._click();
  assert.equal(created, 1);
});

// ── No-active render ──────────────────────────────────────────────

test("UI-H8: renders no-active banner with single CTA → onOpenSettings", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 3, activeId: null } });
  let openedSettings = 0;
  welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
    onOpenSettings: () => { openedSettings += 1; },
  });
  assert.ok(root.classList.contains("wo-no-active"));
  assert.match(root._findOneByClass("wo-title")._textContent, /활성 프로필이 없습니다/);
  assert.match(root._findOneByClass("wo-lede")._textContent, /3개/);
  const actions = root._findAllByClass("wo-action");
  assert.equal(actions.length, 1);
  actions[0]._click();
  assert.equal(openedSettings, 1);
});

// ── Ready: hide ────────────────────────────────────────────────────

test("UI-H8: hides itself when accountStatus.profile.activeId is set", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 1, activeId: "personal" } });
  welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
  });
  assert.ok(root.classList.contains("wo-hidden"));
  // Hidden state has no role / aria-label
  assert.ok(!root.attributes.role);
});

// ── Live updates ──────────────────────────────────────────────────

test("UI-H8: re-classifies when store updates from first-visit → ready", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
  });
  assert.equal(handle._classification(), "first-visit");
  // operator creates a profile + makes it active
  store.setAccountStatus({ profile: { count: 1, activeId: "personal", activeLabel: "P" } });
  assert.ok(root.classList.contains("wo-hidden"));
  assert.equal(handle._classification(), "ready");
});

test("UI-H8: re-classifies first-visit → no-active when count grows but no active", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
  });
  assert.equal(handle._classification(), "first-visit");
  store.setAccountStatus({ profile: { count: 2, activeId: null } });
  assert.equal(handle._classification(), "no-active");
  assert.ok(root.classList.contains("wo-no-active"));
});

// ── Dismissal ─────────────────────────────────────────────────────

test("UI-H8: dismiss button hides + persists to storage", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  let dismissed = 0;
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage,
    onDismiss: () => { dismissed += 1; },
  });
  root._findOneByClass("wo-dismiss")._click();
  assert.equal(dismissed, 1);
  assert.equal(storage.getItem(welcomeOverlay.DISMISS_KEY), "1");
  assert.ok(root.classList.contains("wo-hidden"));
  assert.ok(handle._isDismissed());
});

test("UI-H8: skips render when storage already has dismissed flag", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  storage.setItem(welcomeOverlay.DISMISS_KEY, "1");
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage,
  });
  // Banner is not visible — dismissed flag persisted.
  assert.ok(root.classList.contains("wo-hidden"));
});

test("UI-H8: _resetDismiss clears storage + re-renders", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const storage = makeStorage();
  storage.setItem(welcomeOverlay.DISMISS_KEY, "1");
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage,
  });
  // Hidden initially.
  assert.ok(root.classList.contains("wo-hidden"));
  handle._resetDismiss();
  assert.ok(!handle._isDismissed());
  assert.ok(root.classList.contains("wo-first-visit"));
});

// ── Destroy ───────────────────────────────────────────────────────

test("UI-H8: destroy unsubscribes + clears DOM", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  const handle = welcomeOverlay.create({
    root, store, doc: makeStubDoc(), storage: makeStorage(),
  });
  assert.ok(root._findOneByClass("wo-title"));
  handle.destroy();
  assert.equal(root.children.length, 0);
  // Subsequent store updates do NOT re-render.
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  assert.equal(root.children.length, 0);
});

// ── simple-shell integration ──────────────────────────────────────

test("UI-H8: simple-shell mounts welcome-overlay when injected via panels", () => {
  // We cannot rely on monitor.simple-shell.test.js; do the integration
  // test here by importing both and explicitly injecting welcomeOverlay.
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });

  // Stub out the cards we don't care about (simple-shell tries to
  // mount them but a missing panel is silently skipped).
  const handle = simpleShell.mount({
    root, store, doc: makeStubDoc(),
    storage: makeStorage(),
    panels: { welcomeOverlay },
  });
  // overlay mount cell — wo-banner is applied to the mount element
  // itself by the panel, not as a child. Children are wo-title, wo-lede, etc.
  const mountCell = root._findOneByClass("ss-welcome-mount");
  assert.ok(mountCell);
  assert.ok(mountCell.classList.contains("wo-banner"));
  assert.ok(mountCell._findOneByClass("wo-title"));
  // 1 panel handled (welcomeOverlay only — other cards weren't injected)
  assert.equal(handle._handleCount(), 1);
});

test("UI-H8: simple-shell propagates onOpenSetupWizard to welcome-overlay", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  let opened = 0;
  simpleShell.mount({
    root, store, doc: makeStubDoc(),
    storage: makeStorage(),
    panels: { welcomeOverlay },
    onOpenSetupWizard: () => { opened += 1; },
  });
  const mountCell = root._findOneByClass("ss-welcome-mount");
  mountCell._findAllByClass("wo-action")[0]._click();
  assert.equal(opened, 1);
});

test("UI-H8: simple-shell propagates onCreatePersonal to welcome-overlay", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.setAccountStatus({ profile: { count: 0, activeId: null } });
  let created = 0;
  simpleShell.mount({
    root, store, doc: makeStubDoc(),
    storage: makeStorage(),
    panels: { welcomeOverlay },
    onCreatePersonal: () => { created += 1; },
  });
  const mountCell = root._findOneByClass("ss-welcome-mount");
  mountCell._findAllByClass("wo-action")[1]._click();
  assert.equal(created, 1);
});
