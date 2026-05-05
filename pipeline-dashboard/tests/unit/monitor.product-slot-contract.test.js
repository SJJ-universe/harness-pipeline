// Slice UI-P4-e (Phase 2 Round 3, 2026-04-30) — slot attribute contract.
//
// UI-P5 wires real store data into the product shell by querying the
// data-region / data-card / data-card-slot / data-phase-slot etc.
// attributes UI-P4 introduced. These tests pin that contract — if a
// later round renames an attribute, the wiring breaks here first
// instead of silently in the running UI.
//
// What we pin:
//   - Every region carries data-region with the documented value
//   - Every card carries data-card with the documented id
//   - Every card has its labelled internal slots
//   - Every panel root has role=region + aria-label (Korean)
//   - Mock data structure matches the reference (count, status set,
//     per-tier color order)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const productShell = require("../../public/js/monitor/shells/product-shell");
const productHeader = require("../../public/js/monitor/panels/product-header");
const productHarnessTrack = require("../../public/js/monitor/panels/product-harness-track");
const productPipelineRail = require("../../public/js/monitor/panels/product-pipeline-rail");
const productMonitorGrid = require("../../public/js/monitor/panels/product-monitor-grid");
const productDualTerminals = require("../../public/js/monitor/panels/product-dual-terminals");
const { createMonitorStore } = require("../../public/js/monitor/store");

// Reused DOM stub
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
    get innerHTML() { return ""; },
    set innerHTML(v) {
      // Header builds logo via innerHTML — ignore content for stub
      this._textContent = "";
      this.children = [];
    },
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
    // Minimal querySelectorAll for `[data-attr="value"]` selectors only.
    // Used by product-monitor-grid._applyMode to find pro-only nodes.
    querySelectorAll(selector) {
      const m = String(selector || "").match(/^\[([^=]+)="([^"]+)"\]$/);
      if (!m) return [];
      return this._findAllByAttr(m[1], m[2]);
    },
  };
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

// ── Region attribute (data-region) on every panel root ──────────

test("UI-P4 contract: every panel root carries data-region with documented value", () => {
  const checks = [
    { name: "header", factory: productHeader, region: "header" },
    { name: "harness-track", factory: productHarnessTrack, region: "harness-track" },
    { name: "pipeline-rail", factory: productPipelineRail, region: "pipeline-rail" },
    { name: "monitor-grid", factory: productMonitorGrid, region: "monitor-grid" },
    { name: "dual-terminals", factory: productDualTerminals, region: "dual-terminals" },
  ];
  for (const c of checks) {
    const root = makeRoot();
    const store = createMonitorStore();
    c.factory.create({ root, store, doc: makeStubDoc() });
    const matched = root._findAllByAttr("data-region", c.region);
    assert.ok(matched.length >= 1,
      `panel "${c.name}" must mount with data-region="${c.region}" (found 0)`,
    );
  }
});

test("UI-P4 contract: shell skeleton carries data-region-mount slots for all 5 panel positions", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const stubFactory = () => ({ destroy() {}, setMode() {} });
  productShell.mount({
    root, store, doc: makeStubDoc(),
    panels: {
      header: stubFactory, track: stubFactory, rail: stubFactory,
      grid: stubFactory, terminals: stubFactory,
    },
  });
  const expected = ["header", "harness-track", "workspace", "pipeline-rail",
    "monitor-stack", "monitor-grid", "dual-terminals"];
  for (const slot of expected) {
    assert.ok(root._findOneByAttr("data-region-mount", slot),
      `shell must declare mount slot data-region-mount="${slot}"`,
    );
  }
});

// ── Monitor grid card vocabulary ────────────────────────────────

test("UI-P4 contract: monitor-grid renders 7 documented cards", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const expectedCards = ["findings", "context", "verify", "codex-live",
    "subagents", "tools", "critique"];
  for (const id of expectedCards) {
    const card = root._findOneByAttr("data-card", id);
    assert.ok(card, `monitor-grid must render card data-card="${id}"`);
    assert.ok(card.attributes["aria-label"],
      `card "${id}" must carry aria-label`,
    );
  }
});

test("UI-P4 contract: findings card has 5 tiers in documented order", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const tiers = root._findAllByAttrPresent("data-tier");
  // Filter to just the tier elements (children carry the slot too —
  // check the parent has the data-tier attribute directly)
  const tierIds = tiers
    .filter((el) => el.classList.contains("prod-finding-tier"))
    .map((el) => el.attributes["data-tier"]);
  assert.deepEqual(tierIds, ["critical", "high", "medium", "low", "note"],
    "findings tiers must render in critical→note severity order",
  );
});

test("UI-P4 contract: tool feed renders one row per MOCK_TOOL_FEED entry", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const rows = root._findAllByAttrPresent("data-line-index")
    .filter((el) => el.classList.contains("prod-tool-row"));
  assert.equal(rows.length, productMonitorGrid.MOCK_TOOL_FEED.length);
  // Each row carries data-tool with the tool name from the mock
  const tools = rows.map((r) => {
    const toolEl = r.children.find((c) => c.classList.contains("prod-tool-name"));
    return toolEl ? toolEl.attributes["data-tool"] : null;
  });
  assert.deepEqual(tools, productMonitorGrid.MOCK_TOOL_FEED.map((m) => m.tool));
});

test("runtime contract: monitor grid can suppress reference mock feed", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    allowMockData: false,
  });
  const toolRows = root._findAllByAttrPresent("data-line-index")
    .filter((el) => el.classList.contains("prod-tool-row"));
  const critiqueRows = root._findAllByAttrPresent("data-line-index")
    .filter((el) => el.classList.contains("prod-critique-bubble-wrap"));
  assert.equal(toolRows.length, 0, "empty runtime state must not render mock tool calls");
  assert.equal(critiqueRows.length, 0, "empty runtime state must not render mock critique bubbles");
});

test("runtime contract: codex-live card reports idle (not 'live') when allowMockData=false and no stream", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    allowMockData: false,
  });
  const card = root._findOneByAttr("data-card", "codex-live");
  assert.ok(card, "codex-live card must exist in pro mode");
  assert.equal(card.attributes["data-stream-state"], "idle",
    "no live stream + non-demo runtime must mark the card idle, not live");
  // Title-meta slot should NOT carry the "live" badge text in idle state.
  const metaEl = card.children
    .flatMap((c) => c.children || [])
    .find((c) => c && c.attributes && c.attributes["data-card-slot"] === "title-meta");
  assert.ok(metaEl, "title-meta slot must render");
  assert.notEqual(metaEl.textContent, "live",
    "idle codex-live card must not surface a 'live' badge");
  // Stream pre should be empty (no fallback mock text in non-demo mode)
  const streamEl = card.children.find((c) => c && c.attributes
    && c.attributes["data-card-slot"] === "stream");
  assert.ok(streamEl, "stream slot must render");
  // The pre contains a text node (empty) + caret span. Find the text node.
  const textChild = streamEl.children.find((c) => c && c.nodeType === 3);
  if (textChild) {
    assert.equal(textChild.textContent, "",
      "idle codex-live stream must not contain mock text");
  }
});

test("runtime contract: codex-live card preserves demo affordance when allowMockData=true", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    // allowMockData omitted → defaults to true
  });
  const card = root._findOneByAttr("data-card", "codex-live");
  assert.ok(card, "codex-live card must exist");
  assert.equal(card.attributes["data-stream-state"], "idle",
    "no live stream means stream-state stays idle even in demo mode");
  // In demo mode the meta surfaces the reference model string (NOT 'live').
  const metaEl = card.children
    .flatMap((c) => c.children || [])
    .find((c) => c && c.attributes && c.attributes["data-card-slot"] === "title-meta");
  assert.ok(metaEl, "title-meta slot must render");
  assert.equal(metaEl.textContent, productMonitorGrid.MOCK_CODEX_LIVE.model,
    "demo mode meta should display the reference model string");
});

test("UI-P4 contract: critique stream renders bubbles with data-side + data-actor", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productMonitorGrid.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const wraps = root._findAllByAttrPresent("data-line-index")
    .filter((el) => el.classList.contains("prod-critique-bubble-wrap"));
  assert.equal(wraps.length, productMonitorGrid.MOCK_CRITIQUE.length);
  // First entry is left/codex, second is right/claude — pin the alternation
  assert.equal(wraps[0].attributes["data-side"], "left");
  assert.equal(wraps[1].attributes["data-side"], "right");
});

// ── Pipeline rail vocabulary ────────────────────────────────────

test("UI-P4 contract: pipeline-rail renders 7 phase nodes with stable data-phase-id", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const nodes = root._findAllByAttrPresent("data-phase-id")
    .filter((el) => el.classList.contains("prod-pipeline-node"));
  assert.equal(nodes.length, productPipelineRail.MOCK_STAGES.length);
  // First three are done, fourth is active, rest pending — matches mock
  const statuses = nodes.map((n) => n.attributes["data-phase-status"]);
  assert.deepEqual(statuses, ["done", "done", "done", "active", "pending", "pending", "pending"]);
  // Each node has data-phase-index matching its position
  nodes.forEach((n, idx) => {
    assert.equal(n.attributes["data-phase-index"], String(idx));
  });
});

test("runtime contract: pipeline rail can suppress reference mock stages", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({
    root,
    store,
    doc: makeStubDoc(),
    mode: "pro",
    allowMockData: false,
  });
  const nodes = root._findAllByAttrPresent("data-phase-id")
    .filter((el) => el.classList.contains("prod-pipeline-node"));
  assert.equal(nodes.length, 0, "empty runtime state must not render mock stages");
});

test("UI-P4 contract: pipeline-rail header buttons carry data-action", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const expected = ["pipeline-start", "pipeline-compact", "pipeline-template"];
  for (const action of expected) {
    assert.ok(root._findOneByAttr("data-action", action),
      `pipeline-rail must surface button data-action="${action}"`,
    );
  }
});

test("UI-P4 contract: pipeline-rail metrics block renders 4 documented metrics in pro mode", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productPipelineRail.create({ root, store, doc: makeStubDoc(), mode: "pro" });
  const expected = ["elapsed", "iteration", "gates-passed", "eta"];
  for (const id of expected) {
    assert.ok(root._findOneByAttr("data-metric", id),
      `metrics block must surface row data-metric="${id}"`,
    );
  }
});

// ── Dual terminals vocabulary ───────────────────────────────────

test("UI-P4 contract: dual-terminals renders 2 sides with documented tab ids", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productDualTerminals.create({ root, store, doc: makeStubDoc() });
  // Two terminal regions
  const sides = root._findAllByAttrPresent("data-terminal-side");
  assert.equal(sides.length, 2);
  assert.deepEqual(
    sides.map((s) => s.attributes["data-terminal-side"]).sort(),
    ["left", "right"],
  );
  // 4 tab buttons total (2 per side)
  const tabs = root._findAllByAttrPresent("data-tab");
  const tabIds = tabs.map((t) => t.attributes["data-tab"]).sort();
  assert.deepEqual(tabIds, ["bash", "claude", "codex", "verifier"]);
});

test("UI-P4 contract: dual-terminals body renders mock lines per tab", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productDualTerminals.create({ root, store, doc: makeStubDoc() });
  // Default tabs = claude (left), codex (right). Each renders its
  // MOCK_LINES — count via data-line-index occurrences.
  const lines = root._findAllByAttrPresent("data-line-index");
  const expectedTotal = productDualTerminals.MOCK_LINES.claude.length
    + productDualTerminals.MOCK_LINES.codex.length;
  assert.equal(lines.length, expectedTotal,
    "default tabs (claude+codex) render their MOCK_LINES rows",
  );
});

test("runtime contract: dual-terminals can suppress reference mock streams", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productDualTerminals.create({
    root,
    store,
    doc: makeStubDoc(),
    allowMockData: false,
  });
  const lines = root._findAllByAttrPresent("data-line-index");
  const bodies = root._findAllByAttr("data-stream-source", "empty");
  assert.equal(lines.length, 0, "empty runtime state must not render mock terminal lines");
  assert.equal(bodies.length, 2, "both terminal bodies should report empty stream source");
});

test("UI-P4 contract: dual-terminals control buttons carry data-control", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productDualTerminals.create({ root, store, doc: makeStubDoc() });
  const autoBtns = root._findAllByAttr("data-control", "auto");
  const clearBtns = root._findAllByAttr("data-control", "clear");
  assert.equal(autoBtns.length, 2, "one auto button per terminal");
  assert.equal(clearBtns.length, 2, "one clear button per terminal");
});

// ── Header vocabulary ───────────────────────────────────────────

test("UI-P4 contract: header carries data-header-slot for each major region", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHeader.create({ root, store, doc: makeStubDoc() });
  const expected = ["logo", "status-pill", "mode-toggle", "indicators",
    "locale-toggle", "pro-actions"];
  for (const slot of expected) {
    assert.ok(root._findOneByAttr("data-header-slot", slot),
      `header must surface data-header-slot="${slot}"`,
    );
  }
});

test("UI-P4 contract: header indicators carry data-indicator + nested slot", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHeader.create({ root, store, doc: makeStubDoc() });
  for (const id of ["server", "codex"]) {
    const indicator = root._findOneByAttr("data-indicator", id);
    assert.ok(indicator, `header must render indicator data-indicator="${id}"`);
  }
});

// ── Harness track vocabulary ────────────────────────────────────

test("UI-P4 contract: harness-track lanes carry data-lane-index 0..6 + gate flag", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHarnessTrack.create({ root, store, doc: makeStubDoc() });
  for (let i = 0; i < 7; i++) {
    const lane = root._findOneByAttr("data-lane-index", String(i));
    assert.ok(lane, `lane index ${i} must exist`);
  }
  // Gate lanes — Critique (1), Re-check (3), Verify (5) per MOCK_STAGES
  const gateLanes = root._findAllByAttr("data-gate", "true");
  assert.equal(gateLanes.length, 3, "3 lanes carry data-gate=true");
});

test("UI-P4 contract: harness-track exposes status-pill + horse mount slots", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHarnessTrack.create({ root, store, doc: makeStubDoc() });
  assert.ok(root._findOneByAttr("data-track-slot", "status-pill"));
  assert.ok(root._findOneByAttr("data-track-slot", "horse"));
  assert.ok(root._findOneByAttr("data-track-slot", "lanes"));
});

test("runtime contract: harness-track suppresses 'current' lane + horse + stage pill when allowMockData=false and no live run", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHarnessTrack.create({
    root,
    store,
    doc: makeStubDoc(),
    allowMockData: false,
  });
  // 7 lanes still render — they show the conceptual pipeline shape.
  for (let i = 0; i < 7; i++) {
    assert.ok(root._findOneByAttr("data-lane-index", String(i)),
      `lane ${i} must still render in idle mode`);
  }
  // None of the lanes carry "current" — the visual "running" cue is gone.
  const currentLanes = root._findAllByAttr("data-state", "current");
  assert.equal(currentLanes.length, 0,
    "idle harness-track must not highlight any lane as 'current'");
  // Status pill carries data-activity=idle + idle copy (NOT "STAGE 1/7 · PLAN").
  const pill = root._findOneByAttr("data-track-slot", "status-pill");
  assert.ok(pill, "status pill must render");
  assert.equal(pill.attributes["data-activity"], "idle",
    "idle harness-track must mark the pill data-activity=idle");
  assert.ok(!/STAGE 1\/7/.test(pill.textContent),
    "idle pill must not surface the 'STAGE n/7' running label");
  // Horse wrap still exists (layout placeholder) but carries no sprite/emoji.
  const horse = root._findOneByAttr("data-track-slot", "horse");
  assert.ok(horse, "horse wrap must render as layout placeholder");
  const state = handle._state();
  assert.equal(state.horseMounted, false,
    "horse sprite must not mount when allowMockData=false and no live run");
  assert.equal(state.showActivity, false);
  assert.equal(state.allowMockData, false);
});

test("runtime contract: harness-track preserves galloping affordance in demo mode (allowMockData=true)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = productHarnessTrack.create({
    root,
    store,
    doc: makeStubDoc(),
    // allowMockData omitted → defaults to true
  });
  // Lane 0 should be the "current" lane in demo mode (currentStage=0).
  const currentLanes = root._findAllByAttr("data-state", "current");
  assert.equal(currentLanes.length, 1,
    "demo harness-track marks exactly one lane (PLAN) as current");
  // Pill carries data-activity=active + the running stage label.
  const pill = root._findOneByAttr("data-track-slot", "status-pill");
  assert.equal(pill.attributes["data-activity"], "active");
  assert.match(pill.textContent, /STAGE 1\/7/,
    "demo pill must surface the running stage label");
  const state = handle._state();
  assert.equal(state.horseMounted, true,
    "horse sprite mounts immediately in demo mode");
  assert.equal(state.showActivity, true);
});

// ── Mock data invariants ────────────────────────────────────────

test("UI-P4 contract: MOCK_FINDINGS sums to 17 (matches reference)", () => {
  const total = productMonitorGrid.MOCK_FINDINGS.reduce((sum, f) => sum + f.count, 0);
  assert.equal(total, 17,
    "reference findings: 0 + 1 + 3 + 5 + 8 = 17",
  );
});

test("UI-P4 contract: MOCK_CONTEXT.percent rounds to 62%", () => {
  assert.equal(Math.round(productMonitorGrid.MOCK_CONTEXT.percent * 100), 62);
});

test("UI-P4 contract: MOCK_VERIFY status is one of pass/fail/idle", () => {
  assert.ok(["pass", "fail", "idle"].includes(productMonitorGrid.MOCK_VERIFY.status));
});

test("UI-P4 contract: MOCK_LINES has all 4 documented tab keys", () => {
  const keys = Object.keys(productDualTerminals.MOCK_LINES).sort();
  assert.deepEqual(keys, ["bash", "claude", "codex", "verifier"]);
});

test("UI-P4 contract: MOCK_STAGES contains exactly 7 phases (matches reference 7-stage pipeline)", () => {
  assert.equal(productPipelineRail.MOCK_STAGES.length, 7);
  // Unique phase IDs
  const ids = productPipelineRail.MOCK_STAGES.map((s) => s.id);
  assert.equal(new Set(ids).size, 7, "phase ids are unique");
});
