// Slice POL-DIFF-1-a (Phase 2 v2 follow-up, 2026-05-05) —
// pack-info-card diff toggle tests.
//
// Builds on monitor.pack-info-card.test.js (DOM-stub pattern).
// Covers the new "비교 보기" interaction:
//   - diffPacks helper: 9+ rule field comparison
//   - alt-card click expands a 3-column rule diff
//   - Click again collapses
//   - Diff shows changed rows first, unchanged rows de-emphasized
//   - aria-expanded toggles correctly (a11y)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("../../public/js/monitor/panels/pack-info-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (extended copy from pack-info-card.test.js) ────────

function _makeDoc() {
  function _makeEl(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      _classList: new Set(),
      _hidden: false,
      _listeners: {},
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
      get hidden() { return this._hidden; },
      set hidden(v) { this._hidden = !!v; },
      get firstChild() { return this.children[0] || null; },
      get innerHTML() { return ""; },
      set innerHTML(_v) { this.children = []; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        return c;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      getAttribute(k) { return this.attrs[k] !== undefined ? this.attrs[k] : null; },
      addEventListener(ev, fn) {
        this._listeners[ev] = this._listeners[ev] || [];
        this._listeners[ev].push(fn);
      },
      _click() {
        for (const fn of (this._listeners.click || []).slice()) fn({});
      },
      _findByAttr(attr, value) {
        if (this.attrs[attr] === value) return this;
        for (const c of this.children) {
          if (c._findByAttr) {
            const f = c._findByAttr(attr, value);
            if (f) return f;
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
      _findAllByClass(cls) {
        const out = [];
        if (this._classList && this._classList.has(cls)) out.push(this);
        for (const c of this.children) {
          if (c._findAllByClass) out.push.apply(out, c._findAllByClass(cls));
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

// ── Test packs ──────────────────────────────────────────────────

const STANDARD_PACK = Object.freeze({
  modeId: "standard", label: "Standard", description: "default",
  publicSector: false, allowLocalExecutor: true,
  allowPersonalAccounts: true, allowPlaintextSecrets: false,
  requireSandboxWorkspace: false, requireAgencyManagedAccount: false,
  requireSignedManifest: false, requirePiiScanBeforeProviderDispatch: false,
  scannerFailurePolicy: "warn-only",
  hardGatesDefault: false, runMemoryEnabled: true,
  isCurrent: true,
});

const PUBLIC_SECTOR_PACK = Object.freeze({
  modeId: "public-sector", label: "Public sector",
  description: "public sector",
  publicSector: true, allowLocalExecutor: false,
  allowPersonalAccounts: false, allowPlaintextSecrets: false,
  requireSandboxWorkspace: true, requireAgencyManagedAccount: true,
  requireSignedManifest: true, requirePiiScanBeforeProviderDispatch: true,
  scannerFailurePolicy: "fail-closed",
  hardGatesDefault: false, runMemoryEnabled: true,
  isCurrent: false,
});

const FINANCE_PACK = Object.freeze({
  modeId: "finance-high-privacy", label: "Finance",
  description: "finance",
  publicSector: true, allowLocalExecutor: false,
  allowPersonalAccounts: false, allowPlaintextSecrets: false,
  requireSandboxWorkspace: true, requireAgencyManagedAccount: true,
  requireSignedManifest: true, requirePiiScanBeforeProviderDispatch: true,
  scannerFailurePolicy: "fail-closed",
  hardGatesDefault: true, runMemoryEnabled: false,
  isCurrent: false,
});

function _makePayload(currentPack) {
  return {
    schema: "harness-policy-pack/v1",
    currentPack,
    packs: [STANDARD_PACK, PUBLIC_SECTOR_PACK, FINANCE_PACK],
    metadata: {
      hardGatesEffectiveMode: "warn",
      runMemoryEffective: true,
      hardGatesEnvOverride: false,
      runMemoryEnvOverride: false,
      publicSectorRequirements: ["a", "b", "c", "d", "e"],
    },
    serverTime: Date.now(),
  };
}

// ── diffPacks helper ────────────────────────────────────────────

test("POL-DIFF-1-a: diffPacks exports + DIFFABLE_RULE_FIELDS includes 11 fields", () => {
  assert.equal(typeof panel.diffPacks, "function");
  assert.ok(Array.isArray(panel.DIFFABLE_RULE_FIELDS));
  // 10 boolean + 1 string field
  assert.equal(panel.DIFFABLE_RULE_FIELDS.length, 11);
  for (const f of [
    "publicSector", "allowLocalExecutor", "hardGatesDefault",
    "runMemoryEnabled", "scannerFailurePolicy",
  ]) {
    assert.ok(panel.DIFFABLE_RULE_FIELDS.includes(f),
      `DIFFABLE_RULE_FIELDS must include "${f}"`);
  }
});

test("POL-DIFF-1-a: diffPacks(standard, public-sector) reports correct changed count", () => {
  const diff = panel.diffPacks(STANDARD_PACK, PUBLIC_SECTOR_PACK);
  // Differences: publicSector (false→true), allowLocalExecutor (true→false),
  // allowPersonalAccounts (true→false), requireSandboxWorkspace (false→true),
  // requireAgencyManagedAccount (false→true), requireSignedManifest (false→true),
  // requirePiiScanBeforeProviderDispatch (false→true),
  // scannerFailurePolicy (warn-only→fail-closed)
  // = 8 changes
  assert.equal(diff.changed, 8,
    "standard vs public-sector: 8 rule differences");
  assert.equal(diff.rows.length, 11, "all 11 rows present in diff output");
  const changedRows = diff.rows.filter((r) => r.isChanged);
  assert.equal(changedRows.length, 8);
});

test("POL-DIFF-1-a: diffPacks(public-sector, finance) finds hardGates+runMemory diff", () => {
  const diff = panel.diffPacks(PUBLIC_SECTOR_PACK, FINANCE_PACK);
  // Differences: hardGatesDefault (false→true), runMemoryEnabled (true→false)
  // (description differs too but description is NOT in DIFFABLE_RULE_FIELDS)
  assert.equal(diff.changed, 2);
  const changedFields = diff.rows.filter((r) => r.isChanged).map((r) => r.field);
  assert.ok(changedFields.includes("hardGatesDefault"));
  assert.ok(changedFields.includes("runMemoryEnabled"));
});

test("POL-DIFF-1-a: diffPacks(pack, pack) returns 0 changes for identical inputs", () => {
  const diff = panel.diffPacks(STANDARD_PACK, STANDARD_PACK);
  assert.equal(diff.changed, 0);
  assert.equal(diff.rows.filter((r) => r.isChanged).length, 0);
});

test("POL-DIFF-1-a: diffPacks tolerates missing fields (treats as null)", () => {
  const partial = { modeId: "partial" };  // no rule fields
  const diff = panel.diffPacks(STANDARD_PACK, partial);
  // standard has explicit values for all 11 fields; partial has all null.
  // null !== false → all 11 changes
  assert.equal(diff.changed, 11);
});

test("POL-DIFF-1-a: diffPacks rows preserve fromValue + toValue for changed rows", () => {
  const diff = panel.diffPacks(STANDARD_PACK, PUBLIC_SECTOR_PACK);
  const localExec = diff.rows.find((r) => r.field === "allowLocalExecutor");
  assert.ok(localExec);
  assert.equal(localExec.fromValue, true);
  assert.equal(localExec.toValue, false);
  assert.equal(localExec.isChanged, true);
});

test("POL-DIFF-1-a: diffPacks scannerFailurePolicy string change", () => {
  const diff = panel.diffPacks(STANDARD_PACK, PUBLIC_SECTOR_PACK);
  const sfp = diff.rows.find((r) => r.field === "scannerFailurePolicy");
  assert.ok(sfp);
  assert.equal(sfp.fromValue, "warn-only");
  assert.equal(sfp.toValue, "fail-closed");
  assert.equal(sfp.isChanged, true);
});

// ── UI: diff toggle button ──────────────────────────────────────

test("POL-DIFF-1-a UI: alt-card has 'Compare' toggle button when diff exists", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  // Public-sector alt card → has toggle
  const toggle = card._findByAttr("data-diff-toggle", "public-sector");
  assert.ok(toggle, "public-sector alt has Compare toggle");
  assert.equal(toggle.tagName, "BUTTON");
  // type is set as a JS property (toggleBtn.type = "button"), not
  // an attribute — same pattern as existing buttons in the repo.
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  // Default text uses Korean default
  assert.match(toggle.textContent, /비교 보기.*8/);
  handle.destroy();
});

test("POL-DIFF-1-a UI: diff panel is hidden by default", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const panel1 = card._findByAttr("data-diff-panel", "public-sector");
  assert.ok(panel1, "diff panel exists");
  assert.equal(panel1.hidden, true, "panel hidden by default");
  handle.destroy();
});

test("POL-DIFF-1-a UI: clicking toggle expands the panel + flips aria-expanded", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const toggle = card._findByAttr("data-diff-toggle", "public-sector");
  const diffPanel = card._findByAttr("data-diff-panel", "public-sector");
  // Click → expand
  toggle._click();
  assert.equal(diffPanel.hidden, false, "panel expanded");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(toggle.textContent, /비교 닫기/, "label switches to Hide");
  // Click again → collapse
  toggle._click();
  assert.equal(diffPanel.hidden, true, "panel collapsed");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.match(toggle.textContent, /비교 보기/, "label back to Compare");
  handle.destroy();
});

test("POL-DIFF-1-a UI: data-diff-state attribute toggles collapsed↔expanded", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const wrap = card._findAllByClass("pic-alt-diff-wrap")[0];
  assert.ok(wrap);
  assert.equal(wrap.getAttribute("data-diff-state"), "collapsed");
  const toggle = card._findByAttr("data-diff-toggle", "public-sector");
  toggle._click();
  assert.equal(wrap.getAttribute("data-diff-state"), "expanded");
  handle.destroy();
});

test("POL-DIFF-1-a UI: diff table has 1 header row + 11 body rows when expanded", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const diffPanel = card._findByAttr("data-diff-panel", "public-sector");
  // Build complete — count rows even though hidden (it's pre-rendered)
  const rows = diffPanel._findAllByClass("pic-alt-diff-row");
  assert.equal(rows.length, 12, "1 header + 11 body rows");
  const headerRows = diffPanel._findAllByClass("pic-alt-diff-header");
  assert.equal(headerRows.length, 1, "1 header row");
  handle.destroy();
});

test("POL-DIFF-1-a UI: changed rows render BEFORE unchanged rows", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const diffPanel = card._findByAttr("data-diff-panel", "public-sector");
  // The first body row (after header) should have data-changed="true"
  const allRows = diffPanel._findAllByClass("pic-alt-diff-row");
  // Skip header (index 0); body row 1+ ordered changed-first
  const firstBodyRow = allRows[1];
  assert.equal(firstBodyRow.getAttribute("data-changed"), "true",
    "first body row is a changed row (sort: changed first)");
  handle.destroy();
});

test("POL-DIFF-1-a UI: alt-card with no rule diff has NO toggle (e.g. diff.changed === 0)", () => {
  // Construct synthetic packs that are identical-but-different-modeId
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Two packs with identical rules — only modeId/description differ.
  // diffPacks returns changed=0 because DIFFABLE_RULE_FIELDS doesn't
  // include modeId/description. The toggle should NOT appear.
  const samePack = { ...STANDARD_PACK, modeId: "twin", isCurrent: false,
    description: "twin pack" };
  const payload = {
    schema: "harness-policy-pack/v1",
    currentPack: "standard",
    packs: [STANDARD_PACK, samePack],
    metadata: {
      hardGatesEffectiveMode: "warn", runMemoryEffective: true,
      hardGatesEnvOverride: false, runMemoryEnvOverride: false,
      publicSectorRequirements: [],
    },
    serverTime: Date.now(),
  };
  store.setPolicyPacks(payload);
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  // The alt-card for "twin" exists (alternatives section renders all
  // non-current packs)
  const altCard = card._findByAttr("data-alt-pack", "twin");
  assert.ok(altCard, "twin alt card exists");
  // But there's no diff toggle (no rule changes)
  const toggles = altCard._findAllByClass("pic-alt-diff-toggle");
  assert.equal(toggles.length, 0,
    "no Compare toggle when packs have identical rules");
  handle.destroy();
});

test("POL-DIFF-1-a UI: i18n placeholder substitution in toggle label", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Custom i18n that hooks the toggle key
  const customI18n = {
    t(key, params) {
      if (key === "policyPack.altDiff.toggle") {
        return `[${params.count} CHANGES]`;
      }
      return key;
    },
  };
  store.setPolicyPacks(_makePayload("standard"));
  const handle = panel.create({ root, store, doc, i18n: customI18n });
  const card = root._findByAttr("data-card", "pack-info");
  const toggle = card._findByAttr("data-diff-toggle", "public-sector");
  assert.equal(toggle.textContent, "[8 CHANGES]",
    "i18n placeholder {count} substituted via custom translator");
  handle.destroy();
});

test("POL-DIFF-1-a UI: finance-high-privacy alt has Compare with smaller diff count", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Set current pack = public-sector, then finance-high-privacy alt's
  // diff is only 2 (hardGatesDefault + runMemoryEnabled).
  store.setPolicyPacks(_makePayload("public-sector"));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const toggle = card._findByAttr("data-diff-toggle", "finance-high-privacy");
  assert.ok(toggle);
  assert.match(toggle.textContent, /2/,
    "diff count 2 reflected in toggle label");
  handle.destroy();
});
