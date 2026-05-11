// Slice UI-H2 (Phase D / Phase E1.5, 2026-04-30) — orchestrator-track panel tests.
//
// Drives the panel against the same DOM stub the project uses elsewhere.
// State machine itself is independently tested in
// monitor.horse-state-machine.test.js — these tests pin the panel's
// rendering contract: which DOM elements appear, ARIA, gate marker,
// reduced-motion behavior.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const orchestratorTrack = require("../../public/js/monitor/panels/orchestrator-track");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub ──────────────────────────────────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    style: {},
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
  };
  return el;
}

function makeStubDoc() {
  return { createElement: makeStubElement };
}

function makeRoot() { return makeStubElement("div"); }

// ── Construction guards ──────────────────────────────────────────

test("UI-H2: orchestrator-track.create throws without root", () => {
  assert.throws(() => orchestratorTrack.create({ store: createMonitorStore() }),
    /root must be an element/);
});

test("UI-H2: orchestrator-track.create throws without store", () => {
  assert.throws(() => orchestratorTrack.create({ root: makeRoot(), doc: makeStubDoc() }),
    /store must be a OrchestratorMonitorStore/);
});

// ── Initial render ───────────────────────────────────────────────

test("UI-H2: empty store → 7 lanes + waiting state", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  // ARIA contract
  assert.equal(root.attributes.role, "region");
  assert.equal(root.attributes["aria-label"], "Orchestrator pipeline track");
  assert.equal(root.attributes["aria-live"], "polite");

  // 7 lane cells
  const lanes = root._findAllByClass("ht-lane");
  assert.equal(lanes.length, 7);

  // Waiting state
  assert.equal(root.attributes["data-lane-idx"], "-1");
  assert.equal(root.attributes["data-display-state"], "waiting");
  assert.equal(root.hasAttribute("data-gate"), false);

  // Status pill says "관찰 중" or similar waiting label
  const pill = root._findOneByClass("ht-status");
  assert.ok(pill);
  assert.match(pill._textContent, /관찰 중|⏳/);
});

test("UI-H2: lane labels show English uppercase per LANES order", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });
  const labels = root._findAllByClass("ht-lane-label").map((e) => e._textContent);
  assert.deepEqual(labels, ["PLAN", "CRITIQUE", "REVISE", "RE-CHECK", "EXECUTE", "VERIFY", "DONE"]);
});

// ── Phase advancement ────────────────────────────────────────────

test("UI-H2: setting selectedRunId + phase moves the horse", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "critique" });
  store.selectRun("r1");

  assert.equal(root.attributes["data-lane-idx"], "1");
  assert.equal(root.attributes["data-display-state"], "running");

  // is-current class on lane 1
  const lanes = root._findAllByClass("ht-lane");
  assert.ok(lanes[1].classList.contains("is-current"));
  assert.ok(lanes[0].classList.contains("is-passed"),
    "lanes before current should have is-passed");
  assert.ok(!lanes[2].classList.contains("is-passed"));
});

test("UI-H2: status pill shows STAGE N/7 · {phase} when running", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "execute" });
  store.selectRun("r1");

  const pill = root._findOneByClass("ht-status");
  // Lane 4 (Execute) → STAGE 5/7 · 실행
  assert.match(pill._textContent, /STAGE 5\/7/);
  assert.match(pill._textContent, /실행/);
});

// ── Approval gate ────────────────────────────────────────────────

test("UI-H2: pendingApproval → rearing state + callout + status pill 'APPROVAL'", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "execute" });
  store.selectRun("r1");
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "x",
    requestedAt: 1, runId: "r1",
  });

  assert.equal(root.attributes["data-display-state"], "rearing");
  assert.equal(root.attributes["data-gate"], "approval");

  // Callout appears above the track
  const callout = root._findOneByClass("ht-callout");
  assert.ok(callout, "rear callout should render");
  assert.match(callout._textContent, /HARNESS/);
  assert.match(callout._textContent, /APPROVAL/);
  assert.equal(callout.attributes.role, "status");

  // Status pill switches to gate format
  const pill = root._findOneByClass("ht-status");
  assert.match(pill._textContent, /HARNESS · APPROVAL/);
  assert.ok(pill.classList.contains("is-rearing"));
});

test("UI-H2: clearing the approval clears the rear state", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "execute" });
  store.selectRun("r1");
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "x", requestedAt: 1, runId: "r1",
  });
  assert.equal(root.attributes["data-display-state"], "rearing");

  store.resolveApproval("x");

  assert.equal(root.attributes["data-display-state"], "running");
  assert.equal(root.hasAttribute("data-gate"), false);
});

// ── Verify gate ──────────────────────────────────────────────────

test("UI-H2: verify lane + verifyStatus='fail' → rearing + gate=verify", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "verify" });
  store.selectRun("r1");
  store.setRunDetail("r1", { verifyStatus: "fail" });

  assert.equal(root.attributes["data-display-state"], "rearing");
  assert.equal(root.attributes["data-gate"], "verify");
  const callout = root._findOneByClass("ht-callout");
  assert.match(callout._textContent, /VERIFY/);
});

test("UI-H2: verify lane + verifyStatus='pass' → running (no rear)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "verify" });
  store.selectRun("r1");
  store.setRunDetail("r1", { verifyStatus: "pass" });

  assert.equal(root.attributes["data-display-state"], "running");
});

// ── Reduced motion ───────────────────────────────────────────────

test("UI-H2: public-sector posture forces idle state (reduced motion)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "execute" });
  store.selectRun("r1");
  store.setAccountStatus({
    deployment: {
      mode: "public-sector", publicSector: true,
    },
  });

  assert.equal(root.attributes["data-display-state"], "idle",
    "public-sector posture freezes animation");
});

test("UI-H2: reduced motion + approval pending → still idle (no rear animation)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  store.upsertRun("r1", { phase: "execute" });
  store.selectRun("r1");
  store.setAccountStatus({ deployment: { publicSector: true } });
  store.upsertApproval({
    approvalId: "x", tool: "Bash", argsSummary: "x", requestedAt: 1, runId: "r1",
  });

  // displayState is idle (no animation), but gate flag still set so
  // the static UI shows the operator a pending-approval marker.
  assert.equal(root.attributes["data-display-state"], "idle");
  assert.equal(root.attributes["data-gate"], "approval");
});

// ── Lifecycle ────────────────────────────────────────────────────

test("UI-H2: destroy() unsubscribes + clears DOM + ARIA attrs", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = orchestratorTrack.create({ root, store, doc: makeStubDoc() });
  store.upsertRun("r1", { phase: "plan" });
  store.selectRun("r1");

  assert.ok(root._findOneByClass("ht-lane"));
  handle.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(root.hasAttribute("role"), false);
  assert.equal(root.hasAttribute("aria-label"), false);
  assert.equal(root.hasAttribute("data-lane-idx"), false);

  // After destroy, store updates do not re-render.
  store.upsertRun("r1", { phase: "verify" });
  assert.equal(root.children.length, 0);
});

test("UI-H2: gate icon (◈) renders on lanes 4 (Execute) + 5 (Verify) only", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  orchestratorTrack.create({ root, store, doc: makeStubDoc() });

  const gates = root._findAllByClass("ht-lane-gate");
  // Lanes 4 + 5 have a gate marker; others don't
  assert.equal(gates.length, 2, "gate icons on lanes 4 + 5 only");
});
