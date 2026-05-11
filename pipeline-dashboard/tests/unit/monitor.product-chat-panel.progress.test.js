// UX-POLISH-1 + UX-POLISH-2 (2026-05-11) — product-chat-panel
// progress emitter tests (event-based).
//
// Verifies the chat panel subscribes to the store and converts the
// event-derived milestones into [system] bubbles. snap.events is the
// production source of lifecycle signals; session.history is empty for
// general-task synthetic sessions.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const chatPanel = require("../../public/js/monitor/panels/product-chat-panel");
const productShellData = require("../../public/js/monitor/product-shell-data");

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

// ── i18n stub — echoes key (production miss behavior) ────────────

function makeI18nStub() {
  return { t(key) { return key; } };
}

// ── Snapshot factory (event-based) ───────────────────────────────

function ev(type, dataPayload, ts) {
  return {
    type: type,
    ts: typeof ts === "string" ? Date.parse(ts) : (ts || Date.now()),
    runId: (dataPayload && dataPayload.runId) || null,
    data: dataPayload || {},
  };
}
function makeSnap({ runId = "r1", events = [] } = {}) {
  const runDetails = new Map();
  runDetails.set(runId, {
    run: { id: runId, status: "active", phases: [], completedAt: null, metrics: null },
    findings: [],
  });
  return {
    runs: new Map([[runId, { id: runId, status: "active" }]]),
    runDetails: runDetails,
    reviewSessions: new Map(),
    events: events,
    selectedRunId: runId,
  };
}

// ── Tests ────────────────────────────────────────────────────────

test("UX-POLISH chat: mounts cleanly without store (no progress wiring)", () => {
  const root = makeRoot();
  const handle = chatPanel.create({ root, doc: makeStubDoc() });
  assert.ok(handle, "panel must return handle without store");
});

test("UX-POLISH chat: subscribes to store on mount when store provided", () => {
  const root = makeRoot();
  let subscribed = false;
  const store = {
    snapshot() { return makeSnap(); },
    subscribe(fn) { subscribed = true; return function () {}; },
  };
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  assert.ok(subscribed, "panel must call store.subscribe on mount");
});

test("UX-POLISH chat: codex_started → iteration_start bubble", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  // Fire a snapshot containing a codex_started event.
  store._setSnap(makeSnap({
    events: [ev("codex_started", { runId: "r1", iteration: 0, phase: "C" },
                                    "2026-05-11T10:00:00Z")],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  assert.equal(sys.length, 1);
  assert.match(sys[0].textContent, /1번 비평 시작/);
});

test("UX-POLISH chat: critique_received ok=true → iteration_done bubble", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z"),
      ev("critique_received", {
        runId: "r1", iteration: 0, ok: true,
        severityCounts: { critical: 0, high: 1 },
      }, "2026-05-11T10:00:15Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  // 1 iteration_start + 1 iteration_done = 2
  assert.equal(sys.length, 2);
  assert.match(sys[1].textContent, /1번 비평 완료/);
  assert.match(sys[1].textContent, /CRITICAL 0/);
  assert.match(sys[1].textContent, /HIGH 1/);
});

test("UX-POLISH chat: error event → halt_error bubble (the screenshot incident)", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("codex_started", { runId: "r1", iteration: 0, phase: "C" },
                                                "2026-05-11T10:00:00Z"),
      ev("error", {
        runId: "r1", phase: "C", node: "plan-critic",
        message: "Codex flagged content for cybersecurity risk",
      }, "2026-05-11T10:00:10Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  const haltBubble = sys[sys.length - 1].textContent;
  assert.match(haltBubble, /중단됨/);
  assert.match(haltBubble, /C \(CRITIQUE\)/);
  assert.match(haltBubble, /plan-critic/);
  assert.match(haltBubble, /cybersecurity risk/);
});

test("UX-POLISH chat: pipeline_complete failed → halt_failed bubble", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("pipeline_complete", { runId: "r1", failed: true, reason: "codex-critique-failed" },
                                                "2026-05-11T10:00:25Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  const haltBubble = sys[sys.length - 1].textContent;
  assert.match(haltBubble, /작업 중단/);
  assert.match(haltBubble, /codex-critique-failed/);
  assert.match(haltBubble, /25초|25\.0/);
});

test("UX-POLISH chat: pipeline_complete ok → pipeline_complete bubble", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("codex_started",     { runId: "r1", iteration: 0 }, "2026-05-11T10:00:05Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true },
                                                "2026-05-11T10:00:15Z"),
      ev("pipeline_complete", { runId: "r1", failed: false }, "2026-05-11T10:00:40Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  const completeBubble = sys[sys.length - 1].textContent;
  assert.match(completeBubble, /작업 완료/);
  assert.match(completeBubble, /1번 반복/);
  assert.match(completeBubble, /40초|40\.0/);
});

test("UX-POLISH chat: pipeline_paused → pause bubble (with reason variant)", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("pipeline_paused", { runId: "r1", reason: "operator paused" },
                                                "2026-05-11T10:00:10Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  assert.match(sys[0].textContent, /일시중지/);
  assert.match(sys[0].textContent, /operator paused/);
});

test("UX-POLISH chat: tool_blocked → tool_blocked bubble", () => {
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("tool_blocked", {
        runId: "r1", tool: "Bash", reason: "denylist: rm -rf",
      }, "2026-05-11T10:00:10Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  assert.match(sys[0].textContent, /도구 차단/);
  assert.match(sys[0].textContent, /Bash/);
  assert.match(sys[0].textContent, /denylist/);
});

test("UX-POLISH chat: dedupes same milestone across repeated subscribe fires", () => {
  const root = makeRoot();
  const snap = makeSnap({
    events: [ev("codex_started", { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z")],
  });
  const store = makeStubStore(snap);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(snap);
  store._setSnap(snap);
  store._setSnap(snap);
  const sys = root._findAllByAttr("data-role", "system");
  assert.equal(sys.length, 1, "milestone with same id must NOT double-emit");
});

test("UX-POLISH chat: resets dedupe when runId changes", () => {
  const root = makeRoot();
  const snapA = makeSnap({
    runId: "r1",
    events: [ev("codex_started", { runId: "r1", iteration: 0 }, "2026-05-11T10:00:00Z")],
  });
  const store = makeStubStore(snapA);
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  let sys = root._findAllByAttr("data-role", "system");
  assert.equal(sys.length, 1);
  const snapB = makeSnap({
    runId: "r2",
    events: [ev("codex_started", { runId: "r2", iteration: 0 }, "2026-05-11T11:00:00Z")],
  });
  store._setSnap(snapB);
  sys = root._findAllByAttr("data-role", "system");
  assert.equal(sys.length, 2, "new run's first iteration_start fires fresh bubble");
});

test("UX-POLISH chat: destroy unsubscribes from the store", () => {
  const root = makeRoot();
  let subs = 0;
  const store = {
    snapshot() { return makeSnap(); },
    subscribe() { subs += 1; return () => { subs -= 1; }; },
  };
  const handle = chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  assert.equal(subs, 1);
  handle.destroy();
  assert.equal(subs, 0);
});

test("UX-POLISH chat: full life-cycle stream produces ordered bubbles", () => {
  // End-to-end smoke: pipeline_start → phase_update B → codex_started
  // → critique_received → phase_update D → pipeline_complete. Expected
  // bubbles (in order):
  //   ▸ B (PLAN) 단계 진입
  //   ⏳ 1번 비평 시작 (C (CRITIQUE))
  //   ✓ 1번 비평 완료 (CRITICAL 0 · HIGH 0)
  //   ▸ C (CRITIQUE) 단계 진입
  //   ▸ D (REVISE) 단계 진입
  //   ✓ 작업 완료 (1번 반복, 30초)
  const root = makeRoot();
  const store = makeStubStore(makeSnap({ events: [] }));
  chatPanel.create({
    root, doc: makeStubDoc(),
    store: store, selectors: productShellData, i18n: makeI18nStub(),
  });
  store._setSnap(makeSnap({
    events: [
      ev("pipeline_start",    { runId: "r1" }, "2026-05-11T10:00:00Z"),
      ev("phase_update",      { runId: "r1", phase: "B", status: "active" },
                                                "2026-05-11T10:00:01Z"),
      ev("phase_update",      { runId: "r1", phase: "C", status: "active" },
                                                "2026-05-11T10:00:05Z"),
      ev("codex_started",     { runId: "r1", iteration: 0, phase: "C" },
                                                "2026-05-11T10:00:06Z"),
      ev("critique_received", { runId: "r1", iteration: 0, ok: true,
                                severityCounts: { critical: 0, high: 0 } },
                                                "2026-05-11T10:00:15Z"),
      ev("phase_update",      { runId: "r1", phase: "D", status: "active" },
                                                "2026-05-11T10:00:16Z"),
      ev("pipeline_complete", { runId: "r1", failed: false }, "2026-05-11T10:00:30Z"),
    ],
  }));
  const sys = root._findAllByAttr("data-role", "system");
  const texts = sys.map(function (m) { return m.textContent; });
  assert.equal(texts.length, 6);
  assert.match(texts[0], /B \(PLAN\) 단계 진입/);
  assert.match(texts[1], /C \(CRITIQUE\) 단계 진입/);
  assert.match(texts[2], /1번 비평 시작/);
  assert.match(texts[3], /1번 비평 완료/);
  assert.match(texts[4], /D \(REVISE\) 단계 진입/);
  assert.match(texts[5], /작업 완료/);
});
