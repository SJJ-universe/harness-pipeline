// Slice UI-H5 (Phase D / Phase E1.5, 2026-04-30) — security-status-card tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ssc = require("../../public/js/monitor/panels/security-status-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

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
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
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

// ── Construction guards ──────────────────────────────────────────

test("UI-H5: security-status-card.create throws without root", () => {
  assert.throws(() => ssc.create({ store: createMonitorStore() }),
    /root must be an element/);
});

test("UI-H5: security-status-card.create throws without store", () => {
  assert.throws(() => ssc.create({ root: makeRoot(), doc: makeStubDoc() }),
    /store must be a HarnessMonitorStore/);
});

// ── Default state (no accountStatus loaded) ──────────────────────

test("UI-H5: empty store renders standard-mode card with safe defaults", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  // ARIA
  assert.equal(root.attributes.role, "region");
  assert.equal(root.attributes["aria-label"], "Security status");
  // data-posture defaults to "standard"
  assert.equal(root.attributes["data-posture"], "standard");

  // Title + posture badge present
  const title = root._findOneByClass("ssc-title");
  assert.match(title._textContent, /보안.*개인정보 상태/);

  const badge = root._findOneByClass("ssc-posture-badge");
  assert.match(badge._textContent, /표준 모드/);

  // 6 rows
  const rows = root._findAllByClass("ssc-row");
  assert.equal(rows.length, 6);
});

// ── Public-sector posture ────────────────────────────────────────

test("UI-H5: public-sector posture flips badge + data-posture", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  store.setAccountStatus({
    deployment: {
      mode: "public-sector",
      publicSector: true,
      requireSandboxWorkspace: true,
      requirePiiScan: true,
      allowLocalExecutor: false,
      allowPlaintextSecrets: false,
    },
  });

  assert.equal(root.attributes["data-posture"], "public-sector");
  const badge = root._findOneByClass("ssc-posture-badge");
  assert.match(badge._textContent, /공공기관 모드/);
  assert.ok(badge.classList.contains("ssc-tone-error"));
});

test("UI-H5: footer copy switches by posture", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });
  let footer = root._findOneByClass("ssc-footer");
  assert.match(footer._textContent, /표준 모드/);

  store.setAccountStatus({ deployment: { publicSector: true } });
  footer = root._findOneByClass("ssc-footer");
  assert.match(footer._textContent, /공공기관 모드/);
  assert.match(footer._textContent, /Bash\/Edit\/Write/);
});

// ── Per-row content ─────────────────────────────────────────────

test("UI-H5: sandbox row reflects requireSandboxWorkspace", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  // Default: 선택
  let rows = root._findAllByClass("ssc-row");
  assert.match(rows[0]._allText(), /샌드박스/);
  assert.match(rows[0]._allText(), /선택/);

  // After setting required
  store.setAccountStatus({ deployment: { requireSandboxWorkspace: true } });
  rows = root._findAllByClass("ssc-row");
  assert.match(rows[0]._allText(), /필수.*GOV-SB-0/);
});

test("UI-H5: PII row reflects requirePiiScan flag", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  let rows = root._findAllByClass("ssc-row");
  assert.match(rows[1]._allText(), /관찰 모드/);

  store.setAccountStatus({ deployment: { requirePiiScan: true } });
  rows = root._findAllByClass("ssc-row");
  assert.match(rows[1]._allText(), /활성.*GOV-PII-0/);
});

test("UI-H5: file-scan row points operators at /api/security/scan", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });
  const rows = root._findAllByClass("ssc-row");
  assert.match(rows[2]._allText(), /\/api\/security\/scan/);
  assert.match(rows[2]._allText(), /GOV-PII-1/);
});

test("UI-H5: pending-approvals row reflects store.pendingApprovals.length", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });
  let rows = root._findAllByClass("ssc-row");
  assert.match(rows[5]._allText(), /승인 대기.*없음/);

  store.upsertApproval({
    approvalId: "a", tool: "Bash", argsSummary: "x", requestedAt: 1,
  });
  store.upsertApproval({
    approvalId: "b", tool: "Bash", argsSummary: "y", requestedAt: 2,
  });

  rows = root._findAllByClass("ssc-row");
  assert.match(rows[5]._allText(), /승인 대기.*2건/);
});

test("UI-H5: local-executor row goes warn-tone when blocked", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  store.setAccountStatus({
    deployment: { publicSector: true, allowLocalExecutor: false },
  });

  const rows = root._findAllByClass("ssc-row");
  // Find the local-executor row
  const local = rows.find((r) => /로컬 실행기/.test(r._allText()));
  assert.ok(local);
  assert.match(local._allText(), /차단/);
  assert.ok(local.classList.contains("ssc-tone-warn"));
});

// ── Reactivity ───────────────────────────────────────────────────

test("UI-H5: card re-renders on accountStatus change", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  // Initial: standard
  assert.equal(root.attributes["data-posture"], "standard");

  // Flip to public-sector
  store.setAccountStatus({ deployment: { publicSector: true } });
  assert.equal(root.attributes["data-posture"], "public-sector");

  // Flip back to standard
  store.setAccountStatus({ deployment: { publicSector: false } });
  assert.equal(root.attributes["data-posture"], "standard");
});

test("UI-H5: card re-renders on pendingApprovals change", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  ssc.create({ root, store, doc: makeStubDoc() });

  let rows = root._findAllByClass("ssc-row");
  assert.match(rows[5]._allText(), /없음/);

  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "y", requestedAt: 1,
  });

  rows = root._findAllByClass("ssc-row");
  assert.match(rows[5]._allText(), /1건/);
});

// ── Lifecycle ────────────────────────────────────────────────────

test("UI-H5: destroy() unsubscribes + clears DOM + ARIA", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = ssc.create({ root, store, doc: makeStubDoc() });
  assert.ok(root._findOneByClass("ssc-row"));

  handle.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(root.hasAttribute("role"), false);
  assert.equal(root.hasAttribute("data-posture"), false);

  // After destroy, store updates do NOT re-render.
  store.setAccountStatus({ deployment: { publicSector: true } });
  assert.equal(root.children.length, 0);
});
