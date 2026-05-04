// Slice SMART-1-c (Phase 2 SMART arc, 2026-05-04) — simple-shell
// integration tests for the recommendations-card mount.

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
    };
  }
  return {
    createElement(tag) { return _makeEl(tag); },
    body: _makeEl("body"),
  };
}

function _stubRecsCard() {
  const calls = { creates: [], destroys: [] };
  return {
    calls,
    panel: {
      create({ root, store, doc, onCta, i18n }) {
        const card = doc.createElement("section");
        card.setAttribute("data-card", "recommendations");
        root.appendChild(card);
        calls.creates.push({ root, store, onCta, i18n });
        return {
          card,
          destroy() { calls.destroys.push(card); root.removeChild(card); },
        };
      },
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────

test("SMART-1-c shell: mounts recommendations-card via panels.recommendationsCard injection", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
  });
  assert.equal(stub.calls.creates.length, 1,
    "recommendations-card must be mounted exactly once");
  // Card mounts in `.ss-recs-mount` container, NOT inside grid.
  const recsMount = doc.body._findByClass("ss-recs-mount");
  assert.ok(recsMount,
    "simple-shell must create .ss-recs-mount container");
  const card = recsMount.children[0];
  assert.equal(card.getAttribute("data-card"), "recommendations");
});

test("SMART-1-c shell: forwards i18n option to recommendations-card", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const fakeI18n = { t: (k) => k };
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    i18n: fakeI18n,
  });
  assert.equal(stub.calls.creates[0].i18n, fakeI18n);
});

test("SMART-1-c shell: onSmartCta is the primary dispatcher when wired", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const ctaCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    onSmartCta: (id, opts) => ctaCalls.push({ id, opts }),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("scroll-to-approval-card", { ruleId: "resolve-pending-approvals" });
  assert.equal(ctaCalls.length, 1);
  assert.equal(ctaCalls[0].id, "scroll-to-approval-card");
  assert.equal(ctaCalls[0].opts.ruleId, "resolve-pending-approvals");
});

test("SMART-1-c shell: open-setup-wizard CTA falls back to onOpenSetupWizard", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const wizardCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    onOpenSetupWizard: () => wizardCalls.push(true),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("open-setup-wizard", {});
  assert.equal(wizardCalls.length, 1,
    "complete-profile-setup CTA falls back to onOpenSetupWizard");
});

test("SMART-1-c shell: scroll-to-approval-card falls back to onApprovalsClick", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const approvalCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    onApprovalsClick: () => approvalCalls.push(true),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("scroll-to-approval-card", {});
  assert.equal(approvalCalls.length, 1);
});

test("SMART-1-c shell: SMART-1-specific CTAs route to onOpenSettings as fallback", () => {
  // open-review-sessions / open-recent-results / open-audit-export /
  // open-security-policy — future SMART rounds can refine each;
  // for now they all fall to onOpenSettings as a safe destination.
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const settingsCalls = [];
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    onOpenSettings: () => settingsCalls.push(true),
  });
  const onCta = stub.calls.creates[0].onCta;
  onCta("open-review-sessions", {});
  onCta("open-recent-results", {});
  onCta("open-audit-export", {});
  onCta("open-security-policy", {});
  assert.equal(settingsCalls.length, 4,
    "all 4 SMART-1-specific CTAs fall back to onOpenSettings");
});

test("SMART-1-c shell: unknown CTA without dispatch handler is a silent no-op", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    // No callbacks
  });
  const onCta = stub.calls.creates[0].onCta;
  // Should not throw
  onCta("unknown-cta", {});
  onCta("scroll-to-approval-card", {});
});

test("SMART-1-c shell: thrown handler in fallback dispatch does not crash the shell", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
    onOpenSettings: () => { throw new Error("boom"); },
  });
  const onCta = stub.calls.creates[0].onCta;
  // Should NOT throw — dispatcher swallows handler exceptions
  onCta("open-review-sessions", {});
});

test("SMART-1-c shell: recommendations-card destroyed when shell destroyed", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const stub = _stubRecsCard();
  const handle = shell.mount({
    root: doc.body, store, doc,
    panels: { recommendationsCard: stub.panel },
  });
  handle.destroy();
  assert.equal(stub.calls.destroys.length, 1);
});

test("SMART-1-c shell: card mount survives if panel is missing", () => {
  // No panels.recommendationsCard injected, no globalThis registration.
  const doc = _makeDoc();
  const store = createMonitorStore();
  const handle = shell.mount({ root: doc.body, store, doc });
  assert.ok(handle, "shell.mount must succeed even without recs panel");
  const recsMount = doc.body._findByClass("ss-recs-mount");
  assert.ok(recsMount, "ss-recs-mount container always created");
  assert.equal(recsMount.children.length, 0,
    "container empty when panel constructor absent");
});
