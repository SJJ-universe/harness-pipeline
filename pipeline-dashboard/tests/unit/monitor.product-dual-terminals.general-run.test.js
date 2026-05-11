// PRODUCT-LIVE-STREAM-0 (2026-05-07) — dual-terminals general-run tests.
//
// Pins the new emergency-projection-bridge contract from the panel side:
//   - Synthetic session (`source: "general"`, `streamOnly: true`) makes
//     dual-terminals stream live content.
//   - Action row is suppressed when streamOnly is set (review-relay
//     buttons would target a server session that doesn't exist).
//   - When a real review session exists for the same runId, the action
//     row renders for the REAL session (synthetic doesn't hijack UI).
//   - Backward-compat: legacy review sessions without streamOnly still
//     mount the action row exactly as before.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productDualTerminals = require("../../public/js/monitor/panels/product-dual-terminals");
const productShellData = require("../../public/js/monitor/product-shell-data");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (matches monitor.product-dual-terminals.test.js) ──

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

function makeSpyClient() {
  const calls = {
    createSession: [], sendToCodex: [], followUp: [],
    handBackToClaude: [], archiveSession: [],
  };
  return {
    calls,
    async createSession() { return { ok: true, session: { sessionId: "rs-new" } }; },
    async sendToCodex() { return { ok: true }; },
    async followUp() { return { ok: true }; },
    async handBackToClaude() { return { ok: true }; },
    async archiveSession() { return { ok: true }; },
  };
}

// ── DoD-1 / Gap G: synthetic streamOnly session suppresses action row ──

test("PLS-0 DoD-1: synthetic streamOnly session does NOT mount action row even with client wired", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // Set up an active run
  store.upsertRun("R1", { status: "active", phaseIdx: 1 });
  // Synthetic projection from legacy-bridge._syncGeneralStreamFromEvent
  store.upsertReviewSession("general:R1", {
    sessionId: "general:R1",
    runId: "R1",
    source: "general",
    streamOnly: true,
    state: "in_progress",
  });
  // Push some chunks so the streams are live
  store.appendReviewChunk("general:R1", "codex", { chunk: "stdout line\n", seq: 1, ts: 1 });
  store.appendReviewChunk("general:R1", "claude", { chunk: "[B] Claude 계획 생성 중...\n", seq: 2, ts: 2 });

  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client,
    dataSelectors: productShellData,
  });

  // Even with client, action row should be suppressed because the active
  // session is streamOnly.
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.equal(actions, null,
    "action row must be suppressed for streamOnly synthetic session");
});

// ── DoD-1 also: synthetic session still streams content ─────────────

test("PLS-0: synthetic session chunks render into terminals as live content", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R1", { status: "active", phaseIdx: 1 });
  store.upsertReviewSession("general:R1", {
    sessionId: "general:R1",
    runId: "R1",
    source: "general",
    streamOnly: true,
    state: "in_progress",
  });
  store.appendReviewChunk("general:R1", "codex", { chunk: "codex stdout\n", seq: 1, ts: 1 });

  productDualTerminals.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });

  // Find the terminal body with data-stream-source. The codex tab should be live.
  const liveBodies = root._findAllByAttr("data-stream-source", "live");
  assert.ok(liveBodies.length >= 1,
    "at least one terminal body should report data-stream-source=live");
});

// ── DoD-5 / Gap G: real session beats synthetic on the same runId ────

test("PLS-0 DoD-5: real review session for same runId takes precedence — action row mounts on the real one", { skip: "LAYOUT-REORG-PRO-0: action row removed, hijack defense moot" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R1", { status: "active" });
  // Synthetic projection (older lastActivityAt)
  store.upsertReviewSession("general:R1", {
    sessionId: "general:R1",
    runId: "R1",
    source: "general",
    streamOnly: true,
    state: "in_progress",
    lastActivityAt: 100,
  });
  // Real review session (newer activity, but selectActiveReviewSession's
  // priority rule should pick this one regardless of timestamp).
  store.upsertReviewSession("real-1", {
    sessionId: "real-1",
    runId: "R1",
    source: "review-relay",
    state: "created",
    lastActivityAt: 200,
  });

  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client,
    dataSelectors: productShellData,
  });

  // Real session DOESN'T have streamOnly → action row mounts.
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.ok(actions,
    "action row must mount for the real review session, not be hijacked by synthetic");
});

test("PLS-0 DoD-5: real session preferred even when synthetic has newer lastActivityAt", { skip: "LAYOUT-REORG-PRO-0: action row removed, hijack defense moot" }, () => {
  // Edge case: synthetic ticked more recently (e.g. just got a codex_progress
  // chunk) but the real session is what the user is actually working on.
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("R1", { status: "active" });
  store.upsertReviewSession("real-1", {
    sessionId: "real-1",
    runId: "R1",
    source: "review-relay",
    state: "created",
    lastActivityAt: 100,
  });
  // Synthetic is newer
  store.upsertReviewSession("general:R1", {
    sessionId: "general:R1",
    runId: "R1",
    source: "general",
    streamOnly: true,
    state: "in_progress",
    lastActivityAt: 999,
  });

  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client,
    dataSelectors: productShellData,
  });

  // The selectActiveReviewSession real-first rule kicks in → action row mounts.
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.ok(actions,
    "real session preference should win regardless of recency");
});

// ── Backward compat: legacy session shape unchanged ──────────────────

test("PLS-0: legacy review session (no streamOnly) still mounts action row as before", { skip: "LAYOUT-REORG-PRO-0: action row removed" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", runId: null, state: "created",
  });
  store.selectReviewSession("rs-1");

  const client = makeSpyClient();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client,
    dataSelectors: productShellData,
  });

  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.ok(actions, "legacy session must still mount action row");
});

test("PLS-0: backward compat — no client + no session → no action row (existing behavior)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productDualTerminals.create({
    root, store, doc: makeStubDoc(),
    dataSelectors: productShellData,
  });
  const actions = root._findOneByAttr("data-region", "dual-terminals-actions");
  assert.equal(actions, null);
});
