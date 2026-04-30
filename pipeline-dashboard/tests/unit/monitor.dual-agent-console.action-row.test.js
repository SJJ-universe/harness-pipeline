// Slice UI-H7-c (Phase D / Phase E1.5, 2026-04-30) — dual-agent-console
// structured action row tests.
//
// Pins:
//   - Action row appears only when `client` is provided
//   - Original footer still renders for legacy callers (no client)
//   - 5 buttons: start / send-codex / followup-codex / hand-back / archive
//   - State-aware enable/disable per session.state
//   - Public-sector posture hides hand-back + adds posture badge
//   - Click handlers call client methods with correct arguments
//   - Errors are routed through onError callback

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const dualConsole = require("../../public/js/monitor/panels/dual-agent-console");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (lifted from monitor.dual-agent-console.test.js) ────

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
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
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
    _findAllByDataAttr(attr, val) {
      const out = [];
      for (const c of this.children) {
        if (c.attributes && (val === undefined ? attr in c.attributes : c.attributes[attr] === val)) out.push(c);
        if (typeof c._findAllByDataAttr === "function") {
          out.push(...c._findAllByDataAttr(attr, val));
        }
      }
      return out;
    },
  };
  el.disabled = false;
  return el;
}

function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

function makeSpyClient() {
  const calls = { createSession: [], sendToCodex: [], followUp: [],
                  handBackToClaude: [], archiveSession: [] };
  return {
    calls,
    async createSession(opts) {
      calls.createSession.push(opts);
      return { ok: true, session: { sessionId: "rs-new", state: "created", lastActivityAt: 1 } };
    },
    async sendToCodex(sessionId, opts) {
      calls.sendToCodex.push({ sessionId, opts });
      return { ok: true, session: { sessionId, state: "awaiting_critique" } };
    },
    async followUp(sessionId, opts) {
      calls.followUp.push({ sessionId, opts });
      return { ok: true, session: { sessionId, state: "awaiting_critique" } };
    },
    async handBackToClaude(sessionId, opts) {
      calls.handBackToClaude.push({ sessionId, opts });
      return { ok: true, session: { sessionId, state: "awaiting_claude" } };
    },
    async archiveSession(sessionId, opts) {
      calls.archiveSession.push({ sessionId, opts });
      return { ok: true, session: { sessionId, state: "archived" } };
    },
  };
}

// ── Action row rendering ─────────────────────────────────────────

test("action row absent when no client provided (backward compat)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });
  const row = root._findOneByClass("dac-action-row");
  assert.equal(row, null);
  // Original H3 footer still there
  assert.ok(root._findOneByClass("dac-footer"));
});

test("action row present when client provided", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });
  const row = root._findOneByClass("dac-action-row");
  assert.ok(row);
  assert.equal(row.attributes.role, "toolbar");
  assert.equal(row.attributes["aria-label"], "Review relay actions");
  // Footer replaced — no read-only-stream-view text
  assert.equal(root._findOneByClass("dac-footer"), null);
});

test("action row indicates 'no session' when none selected", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });
  const indicator = root._findOneByClass("dac-session-indicator");
  assert.match(indicator._textContent, /세션 없음/);
});

test("action row 5 buttons render with stable data-action-id values", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });
  const buttons = root._findAllByClass("dac-action-btn");
  const ids = buttons.map((b) => b.attributes["data-action-id"]);
  assert.deepEqual(ids, ["start", "send-codex", "followup-codex", "hand-back", "archive"]);
});

// ── State-aware enable/disable ──────────────────────────────────

test("no session selected: only 'start' button enabled", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttonByAction = (id) =>
    root._findAllByClass("dac-action-btn").find(
      (b) => b.attributes["data-action-id"] === id);

  assert.equal(buttonByAction("start").disabled, false);
  assert.equal(buttonByAction("send-codex").disabled, true);
  assert.equal(buttonByAction("followup-codex").disabled, true);
  assert.equal(buttonByAction("hand-back").disabled, true);
  assert.equal(buttonByAction("archive").disabled, true);
});

test("session.state=created: send-codex enabled, others gated", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "created", label: "Test", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttonByAction = (id) =>
    root._findAllByClass("dac-action-btn").find(
      (b) => b.attributes["data-action-id"] === id);

  assert.equal(buttonByAction("start").disabled, false);
  assert.equal(buttonByAction("send-codex").disabled, false);
  assert.equal(buttonByAction("followup-codex").disabled, true);  // not yet sent
  assert.equal(buttonByAction("hand-back").disabled, true);
  assert.equal(buttonByAction("archive").disabled, false);
});

test("session.state=awaiting_critique: followup + archive only", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "awaiting_critique", lastActivityAt: 2,
  });
  store.selectReviewSession("rs-1");
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttonByAction = (id) =>
    root._findAllByClass("dac-action-btn").find(
      (b) => b.attributes["data-action-id"] === id);

  assert.equal(buttonByAction("send-codex").disabled, true);
  assert.equal(buttonByAction("followup-codex").disabled, false);
  assert.equal(buttonByAction("hand-back").disabled, true);  // not yet received
  assert.equal(buttonByAction("archive").disabled, false);
});

test("session.state=critique_received: hand-back + followup + archive", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 3,
  });
  store.selectReviewSession("rs-1");
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttonByAction = (id) =>
    root._findAllByClass("dac-action-btn").find(
      (b) => b.attributes["data-action-id"] === id);

  assert.equal(buttonByAction("hand-back").disabled, false);
  assert.equal(buttonByAction("followup-codex").disabled, false);
  assert.equal(buttonByAction("archive").disabled, false);
});

test("session.state=archived: all action buttons disabled (start still on)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "archived", lastActivityAt: 4,
  });
  store.selectReviewSession("rs-1");
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttonByAction = (id) =>
    root._findAllByClass("dac-action-btn").find(
      (b) => b.attributes["data-action-id"] === id);

  assert.equal(buttonByAction("start").disabled, false);
  assert.equal(buttonByAction("send-codex").disabled, true);
  assert.equal(buttonByAction("followup-codex").disabled, true);
  assert.equal(buttonByAction("hand-back").disabled, true);
  assert.equal(buttonByAction("archive").disabled, true);
});

// ── Public-sector posture (UI-H7-e shape) ───────────────────────

test("public-sector posture hides hand-back + adds posture badge", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  store.setAccountStatus({
    deployment: { mode: "public-sector", publicSector: true,
                  allowLocalExecutor: false },
  });
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  // Hand-back button should not be in DOM
  const buttons = root._findAllByClass("dac-action-btn");
  const ids = buttons.map((b) => b.attributes["data-action-id"]);
  assert.equal(ids.includes("hand-back"), false);

  // Posture badge present
  const badge = root._findOneByClass("dac-posture-badge");
  assert.ok(badge);
  assert.equal(badge.attributes["data-posture"], "public-sector");
  assert.match(badge._textContent, /공공기관/);
});

test("standard posture (publicSector=false) keeps hand-back visible", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  store.setAccountStatus({
    deployment: { mode: "standard", publicSector: false,
                  allowLocalExecutor: true },
  });
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });

  const buttons = root._findAllByClass("dac-action-btn");
  const ids = buttons.map((b) => b.attributes["data-action-id"]);
  assert.ok(ids.includes("hand-back"));
  assert.equal(root._findOneByClass("dac-posture-badge"), null);
});

// ── Click handlers ──────────────────────────────────────────────

test("Start button: prompt → client.createSession with label + runId", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertRun("run-99", { id: "run-99", phase: "plan" });
  store.selectRun("run-99");
  const client = makeSpyClient();
  let promptCount = 0;
  const promptFn = () => { promptCount++; return "My new review"; };
  dualConsole.create({ root, store, doc: makeStubDoc(), client, promptFn });

  const startBtn = root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "start");
  startBtn._click();
  // Wait microtask for async handler
  await new Promise((r) => setImmediate(r));

  assert.equal(promptCount, 1);
  assert.equal(client.calls.createSession.length, 1);
  const opts = client.calls.createSession[0];
  assert.equal(opts.label, "My new review");
  assert.equal(opts.runId, "run-99");
  assert.equal(opts.source, "selected_run");
  assert.equal(opts.store, store);
  assert.equal(opts.select, true);
});

test("Start button: empty/cancelled prompt does NOT call client", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = makeSpyClient();
  // null means cancel; whitespace also rejected
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    promptFn: () => null });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "start")._click();
  await new Promise((r) => setImmediate(r));
  assert.equal(client.calls.createSession.length, 0);
});

test("Send to Codex: prompt → client.sendToCodex with sessionId + instruction", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "created", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    promptFn: () => "Review for security" });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "send-codex")._click();
  await new Promise((r) => setImmediate(r));

  assert.equal(client.calls.sendToCodex.length, 1);
  const { sessionId, opts } = client.calls.sendToCodex[0];
  assert.equal(sessionId, "rs-1");
  assert.equal(opts.instruction, "Review for security");
  assert.equal(opts.store, store);
});

test("Hand back: prompt → client.handBackToClaude with includeCritique default", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    promptFn: () => "Apply the findings" });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "hand-back")._click();
  await new Promise((r) => setImmediate(r));

  assert.equal(client.calls.handBackToClaude.length, 1);
  const { sessionId, opts } = client.calls.handBackToClaude[0];
  assert.equal(sessionId, "rs-1");
  assert.equal(opts.instruction, "Apply the findings");
});

test("Archive: confirm + client.archiveSession", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    confirmFn: () => true });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "archive")._click();
  await new Promise((r) => setImmediate(r));

  assert.equal(client.calls.archiveSession.length, 1);
  const { sessionId, opts } = client.calls.archiveSession[0];
  assert.equal(sessionId, "rs-1");
  assert.equal(opts.reason, "operator-archive");
});

test("Archive cancel: confirm returns false → no client call", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  const client = makeSpyClient();
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    confirmFn: () => false });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "archive")._click();
  await new Promise((r) => setImmediate(r));

  assert.equal(client.calls.archiveSession.length, 0);
});

// ── Error handling ──────────────────────────────────────────────

test("client error routes through onError callback", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "created", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  const client = {
    sendToCodex: () => Promise.reject(Object.assign(new Error("backend died"), {
      code: "service_unavailable",
    })),
  };
  let captured = null;
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    promptFn: () => "x",
    onError: (err) => { captured = err; },
  });

  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "send-codex")._click();
  await new Promise((r) => setImmediate(r));

  assert.ok(captured);
  assert.equal(captured.code, "service_unavailable");
});

test("Public-sector 409 error: structured error reaches onError", async () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("rs-1", {
    sessionId: "rs-1", state: "critique_received", lastActivityAt: 1,
  });
  store.selectReviewSession("rs-1");
  store.setAccountStatus({
    deployment: { mode: "standard", publicSector: false, allowLocalExecutor: true },
  });
  // Even though UI is standard mode, server might still flip to public
  // mid-session. Client surfaces 409 → onError catches it.
  const client = {
    handBackToClaude: () => Promise.reject(Object.assign(new Error("locked"), {
      code: "public_sector_local_executor_disabled", status: 409,
    })),
  };
  let captured = null;
  dualConsole.create({ root, store, doc: makeStubDoc(), client,
    promptFn: () => "x",
    onError: (err) => { captured = err; },
  });
  root._findAllByClass("dac-action-btn")
    .find((b) => b.attributes["data-action-id"] === "hand-back")._click();
  await new Promise((r) => setImmediate(r));
  assert.ok(captured);
  assert.equal(captured.code, "public_sector_local_executor_disabled");
});

// ── Stream pane regression (UI-H7-c shouldn't break UI-H3) ─────

test("regression: UI-H3 stream filtering still works with action row", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc(), client: makeSpyClient() });
  store.pushEvent({
    type: "claude_stream_chunk", scope: "claude",
    payload: { runner: "claude", chunk: "Claude says hi" }, ts: 1,
  });
  store.pushEvent({
    type: "codex_stream_chunk", scope: "codex",
    payload: { runner: "codex", chunk: "Codex critiques" }, ts: 2,
  });
  const left = root._findOneByClass("dac-col-left")._findAllByClass("dac-line");
  const right = root._findOneByClass("dac-col-right")._findAllByClass("dac-line");
  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
});
