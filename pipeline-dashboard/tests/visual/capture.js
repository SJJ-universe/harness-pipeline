// Slice UI-P9 (Phase 2 Round 3, 2026-04-30) — visual contract capture.
//
// Reads the production HTML/CSS/panels and produces a single snapshot
// object that the test diffs against the committed baseline. Both the
// test (`tests/unit/visual.contract.test.js`) and the operator CLI
// (`scripts/visual-baseline-update.js`) consume captureSnapshot() —
// keeping a single source of truth for what "visual shape" means.

"use strict";

const path = require("path");
const fs = require("fs");
const extract = require("./extract");

const PUBLIC = path.resolve(__dirname, "..", "..", "public");

// ── DOM stub (lifted from monitor.product-slot-contract.test.js) ──
//
// Same shape as the slot-contract tests so the panels render exactly
// the way the existing suite verifies. Maintaining the stub here
// rather than reaching into the test file keeps the capture pure
// (no test framework coupling).

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      _classes: new Set(),
      add() { for (const c of arguments) this._classes.add(c); return this; },
      remove() { for (const c of arguments) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    style: {},
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get firstChild() { return this.children[0] || null; },
    get innerHTML() { return ""; },
    set innerHTML(v) {
      // Header builds logo via innerHTML — for snapshot purposes we
      // ignore the inner markup (we only care about top-level slot
      // attributes) and clear children to mirror jsdom semantics.
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
    querySelectorAll(selector) {
      const m = String(selector || "").match(/^\[([^=]+)="([^"]+)"\]$/);
      if (!m) return [];
      const out = [];
      function walk(node) {
        if (!node || typeof node !== "object") return;
        if (node.attributes && node.attributes[m[1]] === m[2]) out.push(node);
        if (Array.isArray(node.children)) for (const c of node.children) walk(c);
      }
      walk(this);
      return out;
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
  };
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  createTextNode: makeStubTextNode,
});
const makeRoot = () => makeStubElement("div");

// ── Snapshot composition ─────────────────────────────────────────

/**
 * Capture the current visual shape of the product shell + legacy
 * view + design tokens + each product panel's rendered DOM.
 *
 * The shape is intentionally COARSE — names + counts + sorted lists
 * — so meaningful structural drift surfaces as a diff while harmless
 * value tweaks (token color tuning, label copy edits) stay invisible.
 */
function captureSnapshot() {
  const indexHtml  = fs.readFileSync(path.join(PUBLIC, "index.html"),         "utf-8");
  const legacyHtml = fs.readFileSync(path.join(PUBLIC, "index.legacy.html"),  "utf-8");
  const productCss = fs.readFileSync(path.join(PUBLIC, "style.product.css"),  "utf-8");
  const sharedCss  = fs.readFileSync(path.join(PUBLIC, "style.css"),          "utf-8");

  const panelShapes = _capturePanelShapes();

  return {
    _version: 1,
    _description:
      "UI-P9 visual contract baseline. Updated via " +
      "`npm run visual:update`. Drift requires explicit operator " +
      "review of the JSON diff in the PR.",
    indexHtml:           extract.extractHtmlShape(indexHtml),
    indexLegacyHtml:     extract.extractHtmlShape(legacyHtml),
    productCssTokens:    extract.extractCssTokens(productCss, "--prod-"),
    productCssClasses:   extract.countCssClasses(productCss, [
      "prod-shell",
      "prod-header",
      "prod-track",
      "prod-rail",
      "prod-grid",
      "prod-terminals",
      "prod-terminals-wrap",
      "prod-terminals-actions",
      "prod-actions-buttons",
      "prod-actions-indicator",
      "prod-actions-posture-badge",
    ]),
    legacyBannerCss:     extract.countCssClasses(sharedCss, [
      "harness-legacy-banner",
      "legacy-banner-body",
      "legacy-banner-message",
      "legacy-banner-cta",
      "legacy-banner-footnote",
      "legacy-banner-dismiss",
    ]),
    panels:              panelShapes,
  };
}

function _capturePanelShapes() {
  // Lazy require so the capture module loads even if a panel module
  // is temporarily broken — the test will still produce a useful
  // diff pointing at the failing panel.
  const productHeader        = require("../../public/js/monitor/panels/product-header");
  const productHarnessTrack  = require("../../public/js/monitor/panels/product-harness-track");
  const productPipelineRail  = require("../../public/js/monitor/panels/product-pipeline-rail");
  const productMonitorGrid   = require("../../public/js/monitor/panels/product-monitor-grid");
  const productDualTerminals = require("../../public/js/monitor/panels/product-dual-terminals");
  const productShell         = require("../../public/js/monitor/shells/product-shell");
  const { createMonitorStore } = require("../../public/js/monitor/store");

  const out = {};

  // Per-panel render in pro mode (shows max card surface — pro is the
  // densest variant; simple is a strict subset gated by data-pro-only).
  const factories = [
    ["header",         productHeader],
    ["harness-track",  productHarnessTrack],
    ["pipeline-rail",  productPipelineRail],
    ["monitor-grid",   productMonitorGrid],
    ["dual-terminals", productDualTerminals],
  ];
  for (const entry of factories) {
    const name = entry[0];
    const factory = entry[1];
    const root = makeRoot();
    const store = createMonitorStore();
    factory.create({ root: root, store: store, doc: makeStubDoc(), mode: "pro" });
    out[name] = extract.extractPanelShape(root);
  }

  // Shell skeleton — verifies the 5 mount points still wire up
  // correctly after any mount() refactor.
  const shellRoot = makeRoot();
  const stubFactory = function (opts) {
    const stub = makeStubElement("div");
    stub.className = "stub-panel";
    opts.root.appendChild(stub);
    return { destroy() {}, setMode() {}, setLocale() {} };
  };
  productShell.mount({
    root: shellRoot,
    store: createMonitorStore(),
    doc: makeStubDoc(),
    panels: {
      header:    stubFactory,
      track:     stubFactory,
      rail:      stubFactory,
      grid:      stubFactory,
      terminals: stubFactory,
    },
  });
  out.shell = extract.extractPanelShape(shellRoot);

  return out;
}

module.exports = {
  captureSnapshot,
};
