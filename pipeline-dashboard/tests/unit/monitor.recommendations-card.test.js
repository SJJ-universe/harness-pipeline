// Slice SMART-1-b (Phase 2 SMART arc, 2026-05-04) — recommendations
// card panel tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("../../public/js/monitor/panels/recommendations-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (matches next-action-card test pattern) ─────────────

function _makeDoc() {
  function _makeEl(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      _classList: new Set(),
      _hidden: false,
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
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
      addEventListener(ev, fn) {
        this._listeners = this._listeners || {};
        this._listeners[ev] = this._listeners[ev] || [];
        this._listeners[ev].push(fn);
      },
      type: "",
      _click() {
        if (this._listeners && this._listeners.click) {
          this._listeners.click.forEach((fn) => fn({}));
        }
      },
      _findByAttr(attr, value) {
        if (this.attrs[attr] === value) return this;
        for (const c of this.children) {
          if (c._findByAttr) {
            const found = c._findByAttr(attr, value);
            if (found) return found;
          }
        }
        return null;
      },
      _findAllByAttr(attr) {
        const out = [];
        if (this.attrs[attr] !== undefined) out.push(this);
        for (const c of this.children) {
          if (c._findAllByAttr) out.push.apply(out, c._findAllByAttr(attr));
        }
        return out;
      },
    };
  }
  return {
    createElement(tag) { return _makeEl(tag); },
    body: _makeEl("body"),
  };
}

function _validDc(overrides) {
  return {
    schema: "harness-decision-context/v1",
    timestamp: "2026-05-04T00:00:00.000Z",
    booleans: Object.assign({
      hasPii: false, approvalPending: false, codexReviewMissing: false,
      auditExportReady: false, publicSector: false, hasActiveProfile: true,
      needsHumanDecision: false, remoteRunnerActive: false,
    }, overrides && overrides.booleans),
    counts: Object.assign({
      activeRuns: 0, pendingApprovals: 0, openReviewSessions: 0,
      remoteRunnerCount: 0, evidenceLedgerEntries: 0,
    }, overrides && overrides.counts),
    posture: { mode: "standard", publicSector: false },
    sources: {},
  };
}

// ── Module surface ──────────────────────────────────────────────

test("SMART-1-b card: documented exports", () => {
  assert.equal(typeof panel.create, "function");
  assert.equal(typeof panel.SEVERITY_STATE, "object");
});

test("SMART-1-b card: SEVERITY_STATE covers 4 documented severities", () => {
  for (const sev of ["critical", "high", "medium", "info"]) {
    assert.ok(panel.SEVERITY_STATE[sev], `SEVERITY_STATE missing "${sev}"`);
  }
});

// ── Construction ────────────────────────────────────────────────

test("SMART-1-b card: create() requires root + store + doc", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  assert.throws(() => panel.create({ root: null, store, doc }),
    /root must be an element/);
  assert.throws(() => panel.create({ root: doc.body, store: null, doc }),
    /store with subscribe/);
});

test("SMART-1-b card: mounts a section with data-card='recommendations'", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const handle = panel.create({ root: doc.body, store, doc });
  assert.ok(handle.card);
  assert.equal(handle.card.tagName, "SECTION");
  assert.equal(handle.card.getAttribute("data-card"), "recommendations");
  assert.equal(handle.card.getAttribute("role"), "region");
});

// ── Empty state ─────────────────────────────────────────────────

test("SMART-1-b card: empty decisionContext → 'empty' state + empty list", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const handle = panel.create({ root: doc.body, store, doc });
  assert.equal(handle.card.getAttribute("data-state"), "empty");
  const list = handle.card._findByAttr("data-card-slot", "list");
  assert.equal(list.children.length, 0);
});

test("SMART-1-b card: ready-state decisionContext → still empty (nothing to recommend)", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { hasActiveProfile: true, needsHumanDecision: false },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  assert.equal(handle.card.getAttribute("data-state"), "empty");
});

// ── Per-rule rendering ──────────────────────────────────────────

test("SMART-1-b card: !hasActiveProfile → renders complete-profile-setup row (critical)", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { hasActiveProfile: false, needsHumanDecision: true },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  assert.equal(handle.card.getAttribute("data-state"), "populated");
  assert.equal(handle.card.getAttribute("data-top-severity"), "critical");
  const list = handle.card._findByAttr("data-card-slot", "list");
  assert.equal(list.children.length, 1);
  const row = list.children[0];
  assert.equal(row.getAttribute("data-rec-id"), "complete-profile-setup");
  assert.equal(row.getAttribute("data-severity"), "critical");
});

test("SMART-1-b card: approvalPending → resolve-pending-approvals row with count interpolated", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { approvalPending: true, needsHumanDecision: true },
    counts: { pendingApprovals: 3 },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  const row = handle.card._findByAttr("data-rec-id", "resolve-pending-approvals");
  assert.ok(row);
  const title = row._findByAttr("data-rec-slot", "title");
  assert.match(title.textContent, /3/, "title must include count placeholder");
});

test("SMART-1-b card: public-sector + PII → public-sector-pii-block row visible", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { publicSector: true, hasPii: true, needsHumanDecision: true },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  const row = handle.card._findByAttr("data-rec-id", "public-sector-pii-block");
  assert.ok(row);
  assert.equal(row.getAttribute("data-severity"), "critical");
});

test("SMART-1-b card: multiple recs sorted critical → high → medium → info", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: {
      hasActiveProfile: false,    // critical
      approvalPending: true,       // high
      codexReviewMissing: true,    // medium
      needsHumanDecision: true,
    },
    counts: { activeRuns: 1 },     // info
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  const list = handle.card._findByAttr("data-card-slot", "list");
  // Verify each row appears in expected severity order
  const severities = list.children.map((row) => row.getAttribute("data-severity"));
  assert.equal(severities[0], "critical");
  assert.equal(severities[severities.length - 1], "info");
});

// ── CTA wiring ──────────────────────────────────────────────────

test("SMART-1-b card: CTA click fires onCta(actionId, {ruleId, meta})", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { approvalPending: true, needsHumanDecision: true },
    counts: { pendingApprovals: 5 },
  }));
  const ctaCalls = [];
  const handle = panel.create({
    root: doc.body, store, doc,
    onCta: (id, opts) => ctaCalls.push({ id, opts }),
  });
  const row = handle.card._findByAttr("data-rec-id", "resolve-pending-approvals");
  const ctaBtn = row._findByAttr("data-cta", "scroll-to-approval-card");
  ctaBtn._click();
  assert.equal(ctaCalls.length, 1);
  assert.equal(ctaCalls[0].id, "scroll-to-approval-card");
  assert.equal(ctaCalls[0].opts.ruleId, "resolve-pending-approvals");
  assert.equal(ctaCalls[0].opts.meta.count, 5);
});

test("SMART-1-b card: missing onCta does not throw", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { hasActiveProfile: false, needsHumanDecision: true },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  const row = handle.card._findByAttr("data-rec-id", "complete-profile-setup");
  const ctaBtn = row._findByAttr("data-cta", "open-setup-wizard");
  // Should NOT throw
  ctaBtn._click();
});

// ── Dismiss wiring ──────────────────────────────────────────────

test("SMART-1-b card: Dismiss button calls store.dismissRecommendation + row disappears", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    counts: { activeRuns: 2 },     // monitor-active-runs (info)
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  let row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.ok(row, "row visible initially");
  const dismissBtn = row._findByAttr("data-action", "dismiss-rec");
  dismissBtn._click();
  // After dismiss, store should have the ID + re-render hides the row
  assert.deepEqual(store.snapshot().dismissedRecommendations, ["monitor-active-runs"]);
  row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.equal(row, null, "row removed after dismiss + re-render");
});

test("SMART-1-b card: dismissed rec stays hidden across re-renders", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.dismissRecommendation("monitor-active-runs");
  store.setDecisionContext(_validDc({ counts: { activeRuns: 5 } }));
  const handle = panel.create({ root: doc.body, store, doc });
  const row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.equal(row, null,
    "previously-dismissed rule does not render even when conditions trigger");
});

// ── Reactivity ──────────────────────────────────────────────────

test("SMART-1-b card: re-renders on decisionContext publish", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  const handle = panel.create({ root: doc.body, store, doc });
  assert.equal(handle.card.getAttribute("data-state"), "empty");
  store.setDecisionContext(_validDc({ counts: { activeRuns: 1 } }));
  assert.equal(handle.card.getAttribute("data-state"), "populated");
});

test("SMART-1-b card: re-renders on dismissedRecommendations publish (without DC change)", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({ counts: { activeRuns: 1 } }));
  const handle = panel.create({ root: doc.body, store, doc });
  let row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.ok(row);
  store.dismissRecommendation("monitor-active-runs");
  row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.equal(row, null);
});

test("SMART-1-b card: undoDismiss restores the row", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({ counts: { activeRuns: 1 } }));
  store.dismissRecommendation("monitor-active-runs");
  const handle = panel.create({ root: doc.body, store, doc });
  let row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.equal(row, null);
  store.undoDismissRecommendation("monitor-active-runs");
  row = handle.card._findByAttr("data-rec-id", "monitor-active-runs");
  assert.ok(row, "undoDismiss restores the row on next publish");
});

// ── Lifecycle ───────────────────────────────────────────────────

test("SMART-1-b card: destroy unsubs + removes the element", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  let publishesAfterDestroy = 0;
  const handle = panel.create({ root: doc.body, store, doc });
  assert.equal(doc.body.children.length, 1);
  handle.destroy();
  assert.equal(doc.body.children.length, 0);
  // Subsequent publishes shouldn't increment internal subscribers
  store.subscribe(() => { publishesAfterDestroy += 1; });
  store.setDecisionContext(_validDc({ counts: { activeRuns: 1 } }));
  // Non-card subscriber fires once; destroyed card's no-op
  assert.equal(publishesAfterDestroy, 1);
});

// ── _readRecs test hook ─────────────────────────────────────────

test("SMART-1-b card: _readRecs returns engine output (test hook)", () => {
  const doc = _makeDoc();
  const store = createMonitorStore();
  store.setDecisionContext(_validDc({
    booleans: { hasActiveProfile: false, needsHumanDecision: true },
  }));
  const handle = panel.create({ root: doc.body, store, doc });
  const recs = handle._readRecs();
  assert.ok(Array.isArray(recs));
  assert.equal(recs[0].id, "complete-profile-setup");
});
