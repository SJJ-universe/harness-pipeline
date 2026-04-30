// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — Simple shell + cards tests.
//
// Pins the orchestrator (mounts 4 cards in a grid) + each card's
// most-important rendering invariants.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const simpleShell = require("../../public/js/monitor/shells/simple-shell");
const nowDoing = require("../../public/js/monitor/panels/now-doing-card");
const pendingApprovals = require("../../public/js/monitor/panels/pending-approvals-card");
const recentResults = require("../../public/js/monitor/panels/recent-results-card");
const connectionStatus = require("../../public/js/monitor/panels/connection-status-card");
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

// ── now-doing-card ───────────────────────────────────────────────

test("UI-H6: now-doing-card renders 대기 중 with no run", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  nowDoing.create({ root, store, doc: makeStubDoc() });
  assert.match(root._findOneByClass("ndc-label")._textContent, /대기 중/);
  assert.match(root._findOneByClass("ndc-meta")._textContent, /활성 실행 없음/);
});

test("UI-H6: now-doing-card shows phase name + pulse dot when active", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  nowDoing.create({ root, store, doc: makeStubDoc() });
  store.upsertRun("r1", { phase: "execute", status: "active" });
  store.selectRun("r1");
  assert.match(root._findOneByClass("ndc-label")._textContent, /실행/);
  assert.ok(root._findOneByClass("ndc-pulse-dot"), "pulse dot should render for active run");
});

test("UI-H6: now-doing-card status meta switches by run.status", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  nowDoing.create({ root, store, doc: makeStubDoc() });
  store.upsertRun("r1", { phase: "done", status: "completed" });
  store.selectRun("r1");
  assert.match(root._findOneByClass("ndc-meta")._textContent, /완료됨/);
});

// ── pending-approvals-card ───────────────────────────────────────

test("UI-H6: pending-approvals-card shows 0 + helper text when empty", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  pendingApprovals.create({ root, store, doc: makeStubDoc() });
  assert.equal(root._findOneByClass("pac-count")._textContent, "0");
  assert.match(root._findOneByClass("pac-meta")._textContent, /대기 중인 승인 없음/);
  // No action button when empty.
  assert.equal(root._findOneByClass("pac-action"), null);
});

test("UI-H6: pending-approvals-card shows count + sample + action button", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let clicks = 0;
  pendingApprovals.create({
    root, store, doc: makeStubDoc(),
    onClick: () => { clicks += 1; },
  });
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "rm -rf /tmp",
    requestedAt: 1,
  });
  store.upsertApproval({
    approvalId: "y", tool: "Edit", argsSummary: "/etc/hosts",
    requestedAt: 2,
  });
  assert.equal(root._findOneByClass("pac-count")._textContent, "2");
  assert.match(root._findOneByClass("pac-meta")._textContent, /Bash/);
  // The +1 indicator (one extra approval beyond the sample)
  assert.match(root._findOneByClass("pac-meta")._textContent, /\+1/);
  // Action button is present + clickable
  const action = root._findOneByClass("pac-action");
  assert.ok(action);
  action._click();
  assert.equal(clicks, 1);
});

test("UI-H6: pending-approvals-card adds .pac-has-pending when count > 0", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  pendingApprovals.create({ root, store, doc: makeStubDoc() });
  assert.ok(!root.classList.contains("pac-has-pending"));
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "x", requestedAt: 1,
  });
  assert.ok(root.classList.contains("pac-has-pending"));
});

// ── recent-results-card ─────────────────────────────────────────

test("UI-H6: recent-results-card shows empty state when no completed runs", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  recentResults.create({ root, store, doc: makeStubDoc() });
  assert.match(root._findOneByClass("rrc-empty")._textContent, /최근 완료된 작업이 없습니다/);
});

test("UI-H6: recent-results-card lists last 3 completed runs sorted desc by completedAt", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  recentResults.create({ root, store, doc: makeStubDoc() });
  store.upsertRun("r1", { status: "completed", completedAt: 1000, label: "First" });
  store.upsertRun("r2", { status: "completed", completedAt: 3000, label: "Newest" });
  store.upsertRun("r3", { status: "completed", completedAt: 2000, label: "Middle" });
  store.upsertRun("r4", { status: "active" });  // not completed → excluded

  const rows = root._findAllByClass("rrc-row");
  assert.equal(rows.length, 3);
  // Newest first
  assert.equal(rows[0].attributes["data-run-id"], "r2");
  assert.equal(rows[1].attributes["data-run-id"], "r3");
  assert.equal(rows[2].attributes["data-run-id"], "r1");
});

test("UI-H6: recent-results-card verify dot reflects runDetails.verifyStatus", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  recentResults.create({ root, store, doc: makeStubDoc() });
  store.upsertRun("r1", { status: "completed", completedAt: 1, label: "X" });
  store.setRunDetail("r1", { verifyStatus: "pass" });
  let row = root._findAllByClass("rrc-row")[0];
  assert.ok(row._findOneByClass("rrc-dot-ok"));

  store.setRunDetail("r1", { verifyStatus: "fail" });
  row = root._findAllByClass("rrc-row")[0];
  assert.ok(row._findOneByClass("rrc-dot-error"));
});

// ── connection-status-card ─────────────────────────────────────

test("UI-H6: connection-status-card shows (설정 필요) when no profile", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  connectionStatus.create({ root, store, doc: makeStubDoc() });
  const profilePill = root._findAllByClass("csc-pill")[0];
  assert.match(profilePill._allText(), /설정 필요/);
  assert.ok(profilePill.classList.contains("csc-tone-warn"));
});

test("UI-H6: connection-status-card shows active profile + bridge + remote", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  connectionStatus.create({ root, store, doc: makeStubDoc() });
  store.setAccountStatus({
    profile: { activeId: "personal", activeLabel: "Personal" },
    bridge: { mode: "dispatch" },
    remote: { mode: "on", activeRunnerCount: 2 },
  });
  const pills = root._findAllByClass("csc-pill");
  assert.match(pills[0]._allText(), /Personal/);
  assert.match(pills[1]._allText(), /dispatch/);
  assert.match(pills[2]._allText(), /on.*2 runners/);
});

test("UI-H6: connection-status-card action button calls onOpenSettings", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let opened = 0;
  connectionStatus.create({
    root, store, doc: makeStubDoc(),
    onOpenSettings: () => { opened += 1; },
  });
  root._findOneByClass("csc-action")._click();
  assert.equal(opened, 1);
});

// ── simple-shell orchestrator ───────────────────────────────────

test("UI-H6: simple-shell.mount creates 4 cell grid + mounts every card", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = simpleShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      nowDoing, pendingApprovals, recentResults, connectionStatus,
    },
  });
  // 4 cells in the grid
  const cells = root._findAllByClass("ss-cell");
  assert.equal(cells.length, 4);
  // Each card mounted (count handles)
  assert.equal(handle._handleCount(), 4);
  // Outer ARIA
  assert.equal(root.attributes.role, "region");
  assert.equal(root.attributes["aria-label"], "Simple dashboard");
});

test("UI-H6: simple-shell.mount throws without root / store", () => {
  assert.throws(() => simpleShell.mount({ store: createMonitorStore() }),
    /root must be an element/);
  assert.throws(() => simpleShell.mount({ root: makeRoot(), doc: makeStubDoc() }),
    /store is required/);
});

test("UI-H6: simple-shell.destroy unsubscribes every card + clears DOM", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = simpleShell.mount({
    root, store, doc: makeStubDoc(),
    panels: { nowDoing, pendingApprovals, recentResults, connectionStatus },
  });
  store.upsertRun("r1", { phase: "plan" });
  assert.ok(root._findOneByClass("ss-cell"));
  handle.destroy();
  assert.equal(root.children.length, 0);
  // After destroy, store updates do NOT re-render.
  store.upsertRun("r2", { phase: "execute" });
  assert.equal(root.children.length, 0);
});

test("UI-H6: simple-shell propagates onApprovalsClick to pending-approvals card", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  let clicks = 0;
  simpleShell.mount({
    root, store, doc: makeStubDoc(),
    panels: { nowDoing, pendingApprovals, recentResults, connectionStatus },
    onApprovalsClick: () => { clicks += 1; },
  });
  // Trigger pending count > 0 + click
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "y", requestedAt: 1,
  });
  const action = root._findOneByClass("pac-action");
  action._click();
  assert.equal(clicks, 1);
});

test("UI-H6: simple-shell does NOT crash if a card panel throws on mount", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const broken = { create: () => { throw new Error("blew up"); } };
  // Should not throw out — broken card is skipped, others mount.
  let handle;
  assert.doesNotThrow(() => {
    handle = simpleShell.mount({
      root, store, doc: makeStubDoc(),
      panels: {
        nowDoing: broken,
        pendingApprovals, recentResults, connectionStatus,
      },
    });
  });
  // 3 of 4 mounted
  assert.equal(handle._handleCount(), 3);
});
