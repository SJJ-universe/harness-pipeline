// Slice UI-P6 (Phase 2 Round 3, 2026-04-30) — product-dual-terminals
// review-relay action row + live-stream wiring tests.
//
// Pins:
//   - Action row absent when no client provided (backward compat)
//   - Action row appears with 5 documented buttons + indicator
//   - State-aware enable/disable (created/awaiting_critique/...)
//   - Public-sector posture hides hand-back + adds posture badge
//   - Click handlers call client methods with correct args
//   - prompt cancel returns null → no client call
//   - Live stream chunks override mock when active session has chunks
//   - data-stream-source attribute toggles "live" ↔ "mock"
//   - Errors routed through onError callback

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productDualTerminals = require("../../public/js/monitor/panels/product-dual-terminals");
const productShellData = require("../../public/js/monitor/product-shell-data");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (lifted from monitor.product-slot-contract.test.js) ──

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
    get firstChild() { return this.children[0] || null; },
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
  el.disabled = false;
  el.type = "";
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
    _findAllByAttr() { return []; },
    _findAllByAttrPresent() { return []; },
  };
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  createTextNode: makeStubTextNode,
});
const makeRoot = () => makeStubElement("div");

// Spy client mirroring OrchestratorReviewSessionClient surface
function makeSpyClient() {
  const calls = {
    createSession: [], sendToCodex: [], followUp: [],
    handBackToClaude: [], archiveSession: [],
  };
  return {
    calls: calls,
    async createSession(opts) {
      calls.createSession.push(opts);
      return { ok: true, session: { sessionId: "rs-new", state: "created", lastActivityAt: 1 } };
    },
    async sendToCodex(sessionId, opts) {
      calls.sendToCodex.push({ sessionId: sessionId, opts: opts });
      return { ok: true, session: { sessionId: sessionId, state: "awaiting_critique" } };
    },
    async followUp(sessionId, opts) {
      calls.followUp.push({ sessionId: sessionId, opts: opts });
      return { ok: true, session: { sessionId: sessionId, state: "awaiting_critique" } };
    },
    async handBackToClaude(sessionId, opts) {
      calls.handBackToClaude.push({ sessionId: sessionId, opts: opts });
      return { ok: true, session: { sessionId: sessionId, state: "awaiting_claude" } };
    },
    async archiveSession(sessionId, opts) {
      calls.archiveSession.push({ sessionId: sessionId, opts: opts });
      return { ok: true, session: { sessionId: sessionId, state: "archived" } };
    },
  };
}

// ── Action row presence ──────────────────────────────────────────

test("UI-P6: action row absent when no client provided (backward compat)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productDualTerminals.create({ root, store, doc: makeStubDoc() });
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.equal(actions, null, "no action row when client is null");
  assert.equal(handle._state().hasActionRow, false);
});

test("UI-P6: action row appears with 5 documented action buttons", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  const handle = productDualTerminals.create({
    root, store, doc: makeStubDoc(), client,
    dataSelectors: productShellData,
  });
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.ok(actions, "action row mounted when client wired");
  assert.equal(handle._state().hasActionRow, true);
  // Indicator
  const indicator = root._findOneByAttr("data-actions-slot", "indicator");
  assert.ok(indicator);
  assert.match(indicator.textContent, /세션 없음/);
  // 5 buttons in default (no session) state — but hand-back is ALWAYS rendered
  // when posture is standard (just disabled when no session).
  const buttons = ["start", "send-codex", "followup-codex", "hand-back", "archive"];
  for (const id of buttons) {
    assert.ok(root._findOneByAttr("data-action-id", id),
      `button data-action-id="${id}" must mount`,
    );
  }
});

// ── State-aware enable/disable ───────────────────────────────────

test("UI-P6: with no session — only Start button enabled", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  const start = root._findOneByAttr("data-action-id", "start");
  const sendCodex = root._findOneByAttr("data-action-id", "send-codex");
  const archive = root._findOneByAttr("data-action-id", "archive");
  assert.equal(start.disabled, false);
  assert.equal(sendCodex.disabled, true);
  assert.equal(archive.disabled, true);
});

test("UI-P6: state=created — Send to Codex enabled", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "created", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-action-id", "send-codex").disabled, false);
  assert.equal(root._findOneByAttr("data-action-id", "followup-codex").disabled, true);
  assert.equal(root._findOneByAttr("data-action-id", "hand-back").disabled, true);
});

test("UI-P6: state=critique_received — Hand back to Claude enabled", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "critique_received", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-action-id", "hand-back").disabled, false);
  assert.equal(root._findOneByAttr("data-action-id", "send-codex").disabled, false,
    "re-iterate is allowed from critique_received");
  assert.equal(root._findOneByAttr("data-action-id", "archive").disabled, false);
});

test("UI-P6: state=archived — all action buttons disabled except start", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "archived", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-action-id", "start").disabled, false);
  for (const id of ["send-codex", "followup-codex", "hand-back", "archive"]) {
    assert.equal(root._findOneByAttr("data-action-id", id).disabled, true,
      `${id} disabled when session is archived`);
  }
});

// ── Public-sector posture ────────────────────────────────────────

test("UI-P6: public-sector + !allowLocalExecutor hides hand-back + shows badge", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Stamp posture into accountStatus slice
  store.setAccountStatus({
    deployment: { publicSector: true, allowLocalExecutor: false },
  });
  store.upsertReviewSession("s1", { sessionId: "s1", state: "critique_received", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.equal(root._findOneByAttr("data-action-id", "hand-back"), null,
    "hand-back removed in public-sector + blocked posture");
  const badge = root._findOneByAttr("data-actions-slot", "posture-badge");
  assert.ok(badge, "posture badge mounted");
  assert.match(badge.textContent, /공공기관/);
});

test("UI-P6: standard posture keeps hand-back AND omits posture badge", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // No accountStatus → defaults to standard
  store.upsertReviewSession("s1", { sessionId: "s1", state: "critique_received", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.ok(root._findOneByAttr("data-action-id", "hand-back"));
  assert.equal(root._findOneByAttr("data-actions-slot", "posture-badge"), null);
});

// ── Click → client method dispatch ───────────────────────────────

test("UI-P6: Start → client.createSession with prompt label", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    promptFn: () => "보안 리뷰 라운드",
  });
  root._findOneByAttr("data-action-id", "start")._click();
  // Wait one microtask for async handler
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.createSession.length, 1);
  assert.equal(client.calls.createSession[0].label, "보안 리뷰 라운드");
});

test("UI-P6: Send to Codex → client.sendToCodex with sessionId + instruction", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { sessionId: "rs-1", state: "created", runId: null });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    promptFn: () => "정확성 리뷰",
  });
  root._findOneByAttr("data-action-id", "send-codex")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.sendToCodex.length, 1);
  assert.equal(client.calls.sendToCodex[0].sessionId, "rs-1");
  assert.equal(client.calls.sendToCodex[0].opts.instruction, "정확성 리뷰");
});

test("UI-P6: Hand back → client.handBackToClaude in standard posture", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { sessionId: "rs-1", state: "critique_received", runId: null });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    promptFn: () => "보안 권고 반영하세요",
  });
  root._findOneByAttr("data-action-id", "hand-back")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.handBackToClaude.length, 1);
  assert.equal(client.calls.handBackToClaude[0].sessionId, "rs-1");
  assert.equal(client.calls.handBackToClaude[0].opts.instruction, "보안 권고 반영하세요");
});

test("UI-P6: Archive → confirm + client.archiveSession", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { sessionId: "rs-1", state: "claude_received", runId: null });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    confirmFn: () => true,
  });
  root._findOneByAttr("data-action-id", "archive")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.archiveSession.length, 1);
  assert.equal(client.calls.archiveSession[0].sessionId, "rs-1");
});

test("UI-P6: prompt cancel (returns null) → no client call", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    promptFn: () => null,
  });
  root._findOneByAttr("data-action-id", "start")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.createSession.length, 0);
});

// ── Errors → onError callback ────────────────────────────────────

test("UI-P6: client.sendToCodex throw → onError invoked, panel survives", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed in this round" }, async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", { sessionId: "rs-1", state: "created", runId: null });
  store.selectReviewSession("rs-1");
  const errs = [];
  const client = {
    async sendToCodex() { throw new Error("dispatch_failed"); },
  };
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
    promptFn: () => "X", onError: (e) => errs.push(e),
  });
  root._findOneByAttr("data-action-id", "send-codex")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(errs.length, 1);
  assert.equal(errs[0].message, "dispatch_failed");
});

// ── Live stream chunks override mock ─────────────────────────────

test("UI-P6: data-stream-source defaults to mock when no session", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  const bodies = root._findAllByAttr("data-terminal-slot", "body");
  assert.equal(bodies.length, 2);
  for (const b of bodies) {
    assert.equal(b.attributes["data-stream-source"], "mock");
  }
});

test("UI-P6: live chunks for codex side toggles data-stream-source=live", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "awaiting_critique", runId: null });
  store.selectReviewSession("s1");
  store.appendReviewChunk("s1", "codex", { chunk: "Codex critique chunk", ts: Date.now(), seq: 0 });
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  // Right terminal defaults to codex tab — should now show live source
  const rightSide = root._findAllByAttr("data-terminal-side", "right")[0];
  const rightBody = rightSide._findOneByAttr("data-terminal-slot", "body");
  assert.equal(rightBody.attributes["data-stream-source"], "live",
    "right terminal flips to live source when codex chunks exist");
  // Left terminal (claude tab) has no claude chunks → stays mock
  const leftSide = root._findAllByAttr("data-terminal-side", "left")[0];
  const leftBody = leftSide._findOneByAttr("data-terminal-slot", "body");
  assert.equal(leftBody.attributes["data-stream-source"], "mock");
});

test("UI-P6: rerender on store change reflects new chunks", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "awaiting_critique", runId: null });
  store.selectReviewSession("s1");
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  // Initially mock (no chunks)
  let rightBody = root._findAllByAttr("data-terminal-side", "right")[0]
    ._findOneByAttr("data-terminal-slot", "body");
  assert.equal(rightBody.attributes["data-stream-source"], "mock");
  // Append a chunk → store publish → re-render
  store.appendReviewChunk("s1", "codex", { chunk: "live arrival", ts: Date.now(), seq: 0 });
  rightBody = root._findAllByAttr("data-terminal-side", "right")[0]
    ._findOneByAttr("data-terminal-slot", "body");
  assert.equal(rightBody.attributes["data-stream-source"], "live",
    "store subscribe re-renders body when chunks arrive");
});

// ── Slot contract additions for UI-P6 ────────────────────────────

test("UI-P6 contract: action row carries data-region=dual-terminals-actions", { skip: "LAYOUT-REORG-PRO-0: review-relay action row removed" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.ok(root._findOneByAttr("data-region", "dual-terminals-actions"));
  // 3 actions slots: indicator + buttons + (no badge in standard)
  assert.ok(root._findOneByAttr("data-actions-slot", "indicator"));
  assert.ok(root._findOneByAttr("data-actions-slot", "buttons"));
  assert.equal(root._findOneByAttr("data-actions-slot", "posture-badge"), null);
});

test("UI-P6: outer wrap retains data-region=dual-terminals (slot contract)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client, dataSelectors: productShellData,
  });
  assert.ok(root._findOneByAttr("data-region", "dual-terminals"),
    "outer wrap keeps the documented region attribute (UI-P4 backward compat)",
  );
});
