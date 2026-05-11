// Slice POL-UI-1-a (Phase 2 v2 follow-up, 2026-05-05) — pack-info-card
// panel tests. Mirrors recommendations-card.test.js DOM stub pattern.
//
// What this verifies:
//   - module surface (create exported)
//   - guard rails (root + store + doc required)
//   - empty state (no policyPacks → empty placeholder visible)
//   - filled state (current pack badge + runtime row + alternatives)
//   - public-sector pack → requirements section visible (with bullets)
//   - standard pack → requirements section hidden
//   - hard-gates env override → override badge appears
//   - run-memory env override → override badge appears
//   - 3 alt-card badges (publicSector / hardGatesDefault / no-runMemory)
//   - i18n translations applied
//   - subscribe + later setPolicyPacks → re-render
//   - destroy() unsubscribes + removes scaffold

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("../../public/js/monitor/panels/pack-info-card");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub (matches recommendations-card test pattern) ─────────

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
      // hidden attribute round-trip (panel uses .hidden = true/false)
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
        this._listeners = this._listeners || {};
        this._listeners[ev] = this._listeners[ev] || [];
        this._listeners[ev].push(fn);
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

// Build a valid /api/policy-packs payload for store.setPolicyPacks().
function _makePacksPayload(opts) {
  const o = opts || {};
  return {
    schema: "orchestrator-policy-pack/v1",
    currentPack: o.currentPack || "standard",
    packs: o.packs || [
      {
        modeId: "standard",
        label: "Standard",
        description: "Default pack — all gates default to warn.",
        publicSector: false,
        allowLocalExecutor: true,
        allowPersonalAccounts: true,
        allowPlaintextSecrets: false,
        requireSandboxWorkspace: false,
        requireAgencyManagedAccount: false,
        requireSignedManifest: false,
        requirePiiScanBeforeProviderDispatch: false,
        scannerFailurePolicy: "warn-only",
        hardGatesDefault: false,
        runMemoryEnabled: true,
        isCurrent: o.currentPack === "standard" || !o.currentPack,
      },
      {
        modeId: "public-sector",
        label: "Public sector",
        description: "Public sector pack — local executor blocked.",
        publicSector: true,
        allowLocalExecutor: false,
        allowPersonalAccounts: false,
        allowPlaintextSecrets: false,
        requireSandboxWorkspace: true,
        requireAgencyManagedAccount: true,
        requireSignedManifest: true,
        requirePiiScanBeforeProviderDispatch: true,
        scannerFailurePolicy: "fail-closed",
        hardGatesDefault: false,
        runMemoryEnabled: true,
        isCurrent: o.currentPack === "public-sector",
      },
      {
        modeId: "finance-high-privacy",
        label: "Finance High-Privacy",
        description: "Finance pack — hardGatesDefault auto-applies.",
        publicSector: true,
        allowLocalExecutor: false,
        allowPlaintextSecrets: false,
        requireSandboxWorkspace: true,
        requireAgencyManagedAccount: true,
        requireSignedManifest: true,
        requirePiiScanBeforeProviderDispatch: true,
        scannerFailurePolicy: "fail-closed",
        hardGatesDefault: true,
        runMemoryEnabled: false,
        isCurrent: o.currentPack === "finance-high-privacy",
      },
    ],
    metadata: {
      hardGatesEffectiveMode: o.hardGatesEffectiveMode || "warn",
      runMemoryEffective: o.runMemoryEffective !== false,
      hardGatesEnvOverride: !!o.hardGatesEnvOverride,
      runMemoryEnvOverride: !!o.runMemoryEnvOverride,
      publicSectorRequirements: o.publicSectorRequirements || [
        "agency-managed account",
        "sandbox workspace",
        "signed manifest",
        "PII scan fail-closed",
        "no plaintext secrets",
      ],
    },
    serverTime: Date.now(),
  };
}

// ── Module surface ────────────────────────────────────────────────

test("POL-UI-1-a panel: documented exports", () => {
  assert.equal(typeof panel.create, "function");
});

// ── Guard rails ──────────────────────────────────────────────────

test("POL-UI-1-a panel: rejects when root missing", () => {
  const store = createMonitorStore();
  const doc = _makeDoc();
  assert.throws(
    () => panel.create({ store, doc }),
    /root must be an element/,
  );
});

test("POL-UI-1-a panel: rejects when store missing", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  assert.throws(
    () => panel.create({ root, doc }),
    /store with subscribe/,
  );
});

// ── Empty state ──────────────────────────────────────────────────

test("POL-UI-1-a panel: empty store renders empty placeholder", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = panel.create({ root, store, doc });
  // Card is mounted
  const card = root._findByAttr("data-card", "pack-info");
  assert.ok(card, "card should be mounted");
  // Empty placeholder is visible
  const empty = card._findByAttr("data-empty", "");
  assert.ok(empty, "empty placeholder should exist");
  assert.equal(empty.hidden, false, "empty placeholder visible until store has data");
  // Header / runtime / alternatives all hidden in empty state
  const headerCells = card._findAllByClass("pic-header");
  assert.ok(headerCells[0].hidden, "header hidden in empty state");
  handle.destroy();
});

// ── Filled state ─────────────────────────────────────────────────

test("POL-UI-1-a panel: filled store renders pack badge + runtime + alternatives", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  // Empty placeholder hidden once data arrives
  const empty = card._findByAttr("data-empty", "");
  assert.equal(empty.hidden, true, "empty placeholder hidden after data");
  // Current pack badge populated
  const badge = card._findByAttr("data-current-pack", "standard");
  assert.ok(badge, "current pack badge with modeId=standard");
  assert.match(badge.textContent, /Standard/, "badge shows pack label");
  // Runtime row visible
  const runtime = card._findByAttr("data-runtime-row", "");
  assert.equal(runtime.hidden, false);
  const hgItem = card._findByAttr("data-runtime-key", "hardGates");
  assert.ok(hgItem);
  assert.match(hgItem.textContent, /warn/, "hard-gates effective mode rendered");
  const rmItem = card._findByAttr("data-runtime-key", "runMemory");
  assert.ok(rmItem);
  // Alternatives section is present and contains the 2 non-current packs
  const altDetails = card._findByAttr("data-alternatives", "");
  assert.ok(altDetails);
  const altCards = altDetails._findAllByAttr("data-alt-pack");
  assert.equal(altCards.length, 2,
    "two alternative pack cards (public-sector + finance-high-privacy)");
  handle.destroy();
});

// ── Public-sector / standard branch ──────────────────────────────

test("POL-UI-1-a panel: public-sector pack shows requirements section with bullets", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "public-sector" }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const reqs = card._findByAttr("data-public-sector-reqs", "");
  assert.ok(reqs, "requirements panel exists");
  assert.equal(reqs.hidden, false, "requirements visible for public-sector pack");
  // 5 bullet items
  const items = reqs._findAllByClass("pic-reqs-item");
  assert.equal(items.length, 5, "5 requirement bullets");
  assert.match(items[0].textContent, /agency-managed/);
  // Badge has data-public-sector="true" attribute
  const badge = card._findByAttr("data-current-pack", "public-sector");
  assert.equal(badge.getAttribute("data-public-sector"), "true",
    "badge tagged data-public-sector=true for visual variant");
  handle.destroy();
});

test("POL-UI-1-a panel: standard pack hides requirements section", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const reqs = card._findByAttr("data-public-sector-reqs", "");
  assert.equal(reqs.hidden, true, "requirements hidden for standard pack");
  // Badge should NOT have public-sector attribute
  const badge = card._findByAttr("data-current-pack", "standard");
  assert.equal(badge.getAttribute("data-public-sector"), null,
    "badge has no public-sector tag for standard pack");
  handle.destroy();
});

// ── Env override badges ──────────────────────────────────────────

test("POL-UI-1-a panel: hard-gates env override appends override badge", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({
    currentPack: "standard",
    hardGatesEffectiveMode: "hard",
    hardGatesEnvOverride: true,
  }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const hgItem = card._findByAttr("data-runtime-key", "hardGates");
  // Should have an override child element with the env-override label
  const overrides = hgItem._findAllByClass("pic-runtime-override");
  assert.ok(overrides.length >= 1, "hard-gates env override badge appended");
  // The override child carries the localized "환경변수" / "env" text
  assert.match(overrides[0].textContent, /환경변수|env/i,
    "override badge text includes localized env-override label");
  handle.destroy();
});

test("POL-UI-1-a panel: run-memory env override appends override badge", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({
    currentPack: "standard",
    runMemoryEffective: false,
    runMemoryEnvOverride: true,
  }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const rmItem = card._findByAttr("data-runtime-key", "runMemory");
  const overrides = rmItem._findAllByClass("pic-runtime-override");
  assert.ok(overrides.length >= 1, "run-memory env override badge appended");
  // Run-memory base text (set via textContent= before override appendChild)
  // shows the disabled state through the {state} placeholder substitution.
  assert.match(rmItem.textContent, /비활성|Disabled/i,
    "run-memory state shows disabled");
  handle.destroy();
});

// ── Alternatives badges ──────────────────────────────────────────

test("POL-UI-1-a panel: alternatives render publicSector + hardGates + noRunMemory badges", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  // public-sector alt card
  const psAlt = card._findByAttr("data-alt-pack", "public-sector");
  assert.ok(psAlt);
  const psBadges = psAlt._findAllByClass("pic-alt-badge-ps");
  assert.equal(psBadges.length, 1, "public-sector pack has publicSector badge");
  // finance-high-privacy alt card
  const finAlt = card._findByAttr("data-alt-pack", "finance-high-privacy");
  assert.ok(finAlt);
  const hgBadges = finAlt._findAllByClass("pic-alt-badge-hg");
  assert.equal(hgBadges.length, 1,
    "finance-high-privacy pack has hardGates badge");
  const noRmBadges = finAlt._findAllByClass("pic-alt-badge-norm");
  assert.equal(noRmBadges.length, 1,
    "finance-high-privacy pack has no-runMemory badge");
  handle.destroy();
});

test("POL-UI-1-a panel: empty packs[] alternatives shows 'none registered' message", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({
    currentPack: "standard",
    packs: [
      { modeId: "standard", label: "Standard", isCurrent: true,
        publicSector: false, allowLocalExecutor: true },
    ],
  }));
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const altDetails = card._findByAttr("data-alternatives", "");
  const noneCells = altDetails._findAllByClass("pic-alt-none");
  assert.equal(noneCells.length, 1, "empty alternatives shows none-registered cell");
  handle.destroy();
});

// ── i18n ────────────────────────────────────────────────────────

test("POL-UI-1-a panel: i18n translates label strings + modeId", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const customI18n = {
    t(key, params) {
      if (key === "policyPack.cardLabel") return "TRANSLATED:cardLabel";
      if (key === "policyPack.modeId.standard") return "TRANSLATED:standard";
      if (key === "policyPack.runtimeEffective.hardGates") {
        return "TRANSLATED:hg=" + params.mode;
      }
      return key;
    },
  };
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc, i18n: customI18n });
  const card = root._findByAttr("data-card", "pack-info");
  const labelCells = card._findAllByClass("pic-label");
  assert.equal(labelCells[0].textContent, "TRANSLATED:cardLabel");
  const badge = card._findByAttr("data-current-pack", "standard");
  assert.equal(badge.textContent, "TRANSLATED:standard");
  const hgItem = card._findByAttr("data-runtime-key", "hardGates");
  assert.match(hgItem.textContent, /TRANSLATED:hg=warn/);
  handle.destroy();
});

test("POL-UI-1-a panel: missing i18n falls back to Korean defaults", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  const labelCells = card._findAllByClass("pic-label");
  assert.equal(labelCells[0].textContent, "현재 정책 팩",
    "fallback to Korean default when no i18n provided");
  // Empty-state placeholder fallback
  const empty = card._findByAttr("data-empty", "");
  assert.match(empty.textContent, /불러오는 중/);
  handle.destroy();
});

// ── Subscribe + re-render ───────────────────────────────────────

test("POL-UI-1-a panel: subscribes; later setPolicyPacks updates render", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  // Mount with empty store
  const handle = panel.create({ root, store, doc });
  const card = root._findByAttr("data-card", "pack-info");
  let badge = card._findByAttr("data-current-pack", "");
  assert.ok(!badge || !badge.textContent.match(/Standard/),
    "no pack name yet — empty state");
  // Now feed payload — render should trigger
  store.setPolicyPacks(_makePacksPayload({ currentPack: "public-sector" }));
  badge = card._findByAttr("data-current-pack", "public-sector");
  assert.ok(badge, "badge appears after data arrives");
  assert.match(badge.textContent, /Public sector|공공기관/i);
  handle.destroy();
});

// ── destroy() ──────────────────────────────────────────────────

test("POL-UI-1-a panel: destroy() removes card + unsubscribes", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc });
  assert.ok(root._findByAttr("data-card", "pack-info"));
  handle.destroy();
  assert.equal(root._findByAttr("data-card", "pack-info"), null,
    "card removed from root after destroy()");
  // Subsequent setPolicyPacks should not throw (panel has detached)
  store.setPolicyPacks(_makePacksPayload({ currentPack: "public-sector" }));
});

// ── Defensive: snapshot throws → render survives ─────────────────

test("POL-UI-1-a panel: defensive against store throwing on snapshot", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  // Build a minimal mock store that throws on snapshot()
  let _subscribed = false;
  const broken = {
    snapshot() { throw new Error("simulated store fault"); },
    subscribe(_cb) { _subscribed = true; return () => {}; },
  };
  // Should not throw on init or render
  const handle = panel.create({ root, store: broken, doc });
  assert.ok(_subscribed, "subscribe was called");
  // Destroy still works
  assert.doesNotThrow(() => handle.destroy());
});

// ── _lastSnapshot exposed for debug ──────────────────────────────

test("POL-UI-1-a panel: handle exposes _lastSnapshot() helper for tests", () => {
  const doc = _makeDoc();
  const root = doc.createElement("div");
  const store = createMonitorStore();
  store.setPolicyPacks(_makePacksPayload({ currentPack: "standard" }));
  const handle = panel.create({ root, store, doc });
  const snap = handle._lastSnapshot();
  assert.ok(snap.policyPacks, "last snapshot includes policyPacks");
  assert.equal(snap.policyPacks.currentPack, "standard");
  handle.destroy();
});
