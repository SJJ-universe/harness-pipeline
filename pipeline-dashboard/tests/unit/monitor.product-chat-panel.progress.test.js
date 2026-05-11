// UX-POLISH-1 (2026-05-11) — product-chat-panel progress emitter tests.
//
// Verifies the new store subscription path:
//   - chat panel subscribes to store on mount
//   - selectProgressMilestones results become [system] bubbles
//   - milestones with the same `id` are deduped (single-emit)
//   - run change resets the dedupe set
//   - i18n params (n, c, h, phase, ...) are substituted into text
//   - panel without store still mounts cleanly (graceful degrade)
//   - destroy unsubscribes from the store

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const chatPanel = require("../../public/js/monitor/panels/product-chat-panel");

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
    _value: "",
    get value() { return this._value; },
    set value(v) { this._value = String(v == null ? "" : v); },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _findAllByAttr(k, v) {
      const out = [];
      if (this.attributes && this.attributes[k] === v) out.push(this);
      for (const c of this.children) {
        if (typeof c._findAllByAttr === "function") out.push(...c._findAllByAttr(k, v));
      }
      return out;
    },
  };
  return el;
}
const makeStubDoc = () => ({ createElement: makeStubElement });
const makeRoot = () => makeStubElement("div");

// ── Store stub ───────────────────────────────────────────────────

function makeStubStore(initialSnap) {
  let snap = initialSnap;
  const subs = new Set();
  return {
    snapshot() { return snap; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    _setSnap(next) { snap = next; for (const fn of Array.from(subs)) fn(snap); },
  };
}

// ── i18n stub (echoes the param-substituted fallback when key missing) ──
//
// product-chat-panel.js falls back to module-scope `_PROGRESS_FALLBACKS`
// when `_i18n.t(key)` returns the key itself. So we pass an i18n stub
// that does exactly that — the panel must still produce the correct
// substituted text from the fallback table.

function makeI18nStub(table) {
  return {
    t(key) {
      if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
      return key;  // mirror the production i18n.t miss behavior
    },
  };
}

// ── Snapshot factories ───────────────────────────────────────────

function makeSnap({ runId = "r1", history = [], state = "awaiting_critique" } = {}) {
  const runDetails = new Map();
  runDetails.set(runId, {
    run: { id: runId, status: "active", phases: [], completedAt: null, metrics: null },
    findings: [],
  });
  const reviewSessions = new Map();
  reviewSessions.set("s1", {
    sessionId: "s1", runId: runId, state: state, history: history,
    lastActivityAt: history.length ? history[history.length - 1].at : "2026-05-11T10:00:00Z",
  });
  return {
    runs: new Map([[runId, { id: runId, status: "active" }]]),
    runDetails: runDetails,
    reviewSessions: reviewSessions,
    events: [],
    selectedRunId: runId,
  };
}

const productShellData = require("../../public/js/monitor/product-shell-data");

// ── Tests ────────────────────────────────────────────────────────

test("UX-POLISH-1 chat: mounts cleanly without store (no progress wiring)", () => {
  const root = makeRoot();
  const handle = chatPanel.create({ root, doc: makeStubDoc() });
  assert.ok(handle, "panel must return handle without store");
  assert.ok(typeof handle.destroy === "function");
});

test("UX-POLISH-1 chat: subscribes to store on mount when store provided", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap());
  let subscribed = false;
  store.subscribe = function (fn) { subscribed = true; return function () {}; };
  // Re-decorate snapshot so the panel can call it without throwing.
  store.snapshot = function () { return makeSnap(); };
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  assert.ok(subscribed, "panel must call store.subscribe on mount");
});

test("UX-POLISH-1 chat: emits system bubble for each milestone on store update", () => {
  const root = makeRoot();
  const initialSnap = makeSnap({ history: [], state: "created" });
  const store = makeStubStore(initialSnap);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  // Initial: no milestones (empty history)
  let systemMessages = root._findAllByAttr("data-role", "system");
  assert.equal(systemMessages.length, 0, "no milestones at idle state");
  // Add codex turn → should emit 1 iteration_done milestone.
  const nextSnap = makeSnap({
    history: [{ actor: "codex", at: "2026-05-11T10:00:10Z", severityCounts: { critical: 0, high: 1 } }],
    state: "critique_received",
  });
  store._setSnap(nextSnap);
  systemMessages = root._findAllByAttr("data-role", "system");
  assert.equal(systemMessages.length, 1, "exactly 1 iteration_done bubble emitted");
  assert.match(systemMessages[0].textContent, /1번 비평 완료/);
  assert.match(systemMessages[0].textContent, /CRITICAL 0/);
  assert.match(systemMessages[0].textContent, /HIGH 1/);
});

test("UX-POLISH-1 chat: dedupes same milestone across repeated subscribe fires", () => {
  const root = makeRoot();
  const snap = makeSnap({
    history: [{ actor: "codex", at: "2026-05-11T10:00:10Z", severityCounts: { critical: 0, high: 0 } }],
    state: "critique_received",
  });
  const store = makeStubStore(snap);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  // Fire 3 more times with the SAME snap — no new bubbles.
  store._setSnap(snap);
  store._setSnap(snap);
  store._setSnap(snap);
  const systemMessages = root._findAllByAttr("data-role", "system");
  assert.equal(systemMessages.length, 1, "milestone with same id must NOT double-emit");
});

test("UX-POLISH-1 chat: resets dedupe set when runId changes (new task)", () => {
  const root = makeRoot();
  const snapA = makeSnap({
    runId: "r1",
    history: [{ actor: "codex", at: "2026-05-11T10:00:10Z" }],
    state: "critique_received",
  });
  const store = makeStubStore(snapA);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  let sys = root._findAllByAttr("data-role", "system");
  assert.equal(sys.length, 1, "first run emits 1 milestone");
  // Switch to a brand new run with its own first iteration.
  const snapB = makeSnap({
    runId: "r2",
    history: [{ actor: "codex", at: "2026-05-11T11:00:10Z" }],
    state: "critique_received",
  });
  store._setSnap(snapB);
  sys = root._findAllByAttr("data-role", "system");
  // 1 (from r1) + 1 (from r2's first iteration) = 2
  assert.equal(sys.length, 2,
    "new run's first iteration emits a fresh bubble (dedupe set was reset)");
});

test("UX-POLISH-1 chat: pipeline_complete emits with iteration count + duration", () => {
  const root = makeRoot();
  const startSnap = makeSnap({ history: [], state: "created" });
  const store = makeStubStore(startSnap);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  // Run completes after 2 iterations.
  const doneRunDetails = new Map();
  doneRunDetails.set("r1", {
    run: {
      id: "r1", status: "completed",
      completedAt: "2026-05-11T10:05:00Z",
      metrics: { elapsedMs: 90000 },
      phases: [],
    },
    findings: [],
  });
  const reviewSessions = new Map();
  reviewSessions.set("s1", {
    sessionId: "s1", runId: "r1", state: "archived",
    history: [
      { actor: "codex", at: "2026-05-11T10:00:10Z" },
      { actor: "codex", at: "2026-05-11T10:03:10Z" },
    ],
  });
  const completedSnap = {
    runs: new Map([["r1", { id: "r1", status: "completed" }]]),
    runDetails: doneRunDetails,
    reviewSessions: reviewSessions,
    events: [],
    selectedRunId: "r1",
  };
  store._setSnap(completedSnap);
  const sys = root._findAllByAttr("data-role", "system");
  // Expect: 2 iteration_done + 1 pipeline_complete = 3
  assert.equal(sys.length, 3);
  const completeMsg = sys[sys.length - 1].textContent;
  assert.match(completeMsg, /작업 완료/);
  assert.match(completeMsg, /2번 반복/);
  assert.match(completeMsg, /90초|90\.0/);
});

test("UX-POLISH-1 chat: pipeline_error renders error message in bubble", () => {
  const root = makeRoot();
  const startSnap = makeSnap({ history: [], state: "created" });
  const store = makeStubStore(startSnap);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store,
    selectors: productShellData,
    i18n: makeI18nStub(),
  });
  const errRunDetails = new Map();
  errRunDetails.set("r1", {
    run: {
      id: "r1", status: "failed",
      completedAt: "2026-05-11T10:01:00Z",
      errorMessage: "codex unreachable",
      phases: [],
    },
    findings: [],
  });
  const reviewSessions = new Map();
  reviewSessions.set("s1", { sessionId: "s1", runId: "r1", state: "archived", history: [] });
  const errSnap = {
    runs: new Map([["r1", { id: "r1", status: "failed" }]]),
    runDetails: errRunDetails,
    reviewSessions: reviewSessions,
    events: [],
    selectedRunId: "r1",
  };
  store._setSnap(errSnap);
  const sys = root._findAllByAttr("data-role", "system");
  // The last bubble is pipeline_error.
  const errBubble = sys[sys.length - 1];
  assert.match(errBubble.textContent, /작업 실패/);
  assert.match(errBubble.textContent, /codex unreachable/);
});

test("UX-POLISH-1 chat: destroy unsubscribes from the store", () => {
  const root = makeRoot();
  const snap = makeSnap();
  let subscribers = 0;
  const store = {
    snapshot() { return snap; },
    subscribe(fn) {
      subscribers += 1;
      return function () { subscribers -= 1; };
    },
  };
  const handle = chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  assert.equal(subscribers, 1);
  handle.destroy();
  assert.equal(subscribers, 0, "destroy must call the unsubscribe returned by subscribe()");
});
