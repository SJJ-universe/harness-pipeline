// Slice UI-P8 (Phase 2 Round 3, 2026-04-30) — legacy banner controller.
//
// Pins:
//   - install() returns ok:false when no document / no banner element
//   - First paint REMOVES the banner element when localStorage flag is "true"
//   - First paint LEAVES the banner element when flag is missing/false
//   - Dismiss button click removes the banner element + persists "true"
//   - i18n.applyDom is called on the banner subtree on first paint
//     when an i18n stub is provided
//   - orchestrator:lang-changed event re-applies i18n on the banner
//   - reset() clears the storage key (operator escape hatch)
//   - STORAGE_KEY + BANNER_ID exposed as constants for tests + future
//     audit chain entries

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const legacyBanner = require("../../public/js/legacy-banner");

// ── Stubs ─────────────────────────────────────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    querySelector(sel) {
      // Minimal `.class-name` selector match
      if (sel && sel.charAt(0) === ".") {
        const cls = sel.slice(1);
        for (const c of this.children) {
          if (c._classes && c._classes.has(cls)) return c;
        }
      }
      return null;
    },
  };
  el._classes = new Set();
  return el;
}

function makeStubDoc() {
  const _byId = {};
  const _docListeners = {};
  return {
    _byId,
    getElementById(id) { return _byId[id] || null; },
    addEventListener(name, fn) { (_docListeners[name] = _docListeners[name] || []).push(fn); },
    _fireDocEvent(name, detail) {
      for (const fn of (_docListeners[name] || []).slice()) fn({ detail });
    },
  };
}

function makeStubStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _internal: m,
  };
}

function makeBannerElement(doc) {
  const banner = makeStubElement("div");
  banner.id = legacyBanner.BANNER_ID;
  // dismiss button as child
  const btn = makeStubElement("button");
  btn._classes.add("legacy-banner-dismiss");
  btn.parentNode = banner;
  banner.children.push(btn);
  // Mount under a parent so removeChild works
  const parent = makeStubElement("body");
  parent.children.push(banner);
  parent.removeChild = function (c) {
    const idx = this.children.indexOf(c);
    if (idx >= 0) { this.children.splice(idx, 1); c.parentNode = null; }
    return c;
  };
  banner.parentNode = parent;
  doc._byId[legacyBanner.BANNER_ID] = banner;
  return { banner, btn, parent };
}

// ── install() guards ─────────────────────────────────────────────

test("UI-P8: install returns ok:false when no document", () => {
  const r = legacyBanner.install({ doc: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_document");
});

test("UI-P8: install returns ok:false when banner element is missing", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const r = legacyBanner.install({ doc, storage });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_banner_element");
});

// ── First paint behavior ─────────────────────────────────────────

test("UI-P8: first paint LEAVES the banner element when not dismissed", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { banner, parent } = makeBannerElement(doc);
  const r = legacyBanner.install({ doc, storage });
  assert.equal(r.ok, true);
  assert.equal(r.dismissed, false);
  assert.equal(r.bannerEl, banner);
  assert.ok(parent.children.includes(banner));
});

test("UI-P8: first paint REMOVES the banner element when localStorage flag is 'true'", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  storage.setItem(legacyBanner.STORAGE_KEY, "true");
  const { banner, parent } = makeBannerElement(doc);
  const r = legacyBanner.install({ doc, storage });
  assert.equal(r.ok, true);
  assert.equal(r.dismissed, true);
  assert.equal(r.bannerEl, null);
  assert.equal(parent.children.includes(banner), false,
    "dismissed banner is removed from the DOM (no flicker)");
});

// ── Dismiss flow ─────────────────────────────────────────────────

test("UI-P8: dismiss click removes banner + persists 'true' to storage", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { banner, btn, parent } = makeBannerElement(doc);
  legacyBanner.install({ doc, storage });
  assert.equal(parent.children.includes(banner), true,
    "sanity: banner present pre-dismiss");
  // Simulate operator click
  btn._click();
  assert.equal(parent.children.includes(banner), false,
    "post-dismiss: banner removed from parent");
  assert.equal(storage.getItem(legacyBanner.STORAGE_KEY), "true",
    "post-dismiss: localStorage flag is 'true'");
});

test("UI-P8: subsequent install() with stored flag also removes banner (idempotent)", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { btn } = makeBannerElement(doc);
  legacyBanner.install({ doc, storage });
  btn._click();
  // Re-mount banner element + re-install (simulating a subsequent visit)
  const { banner: banner2, parent: parent2 } = makeBannerElement(doc);
  const r2 = legacyBanner.install({ doc, storage });
  assert.equal(r2.dismissed, true);
  assert.equal(parent2.children.includes(banner2), false);
});

// ── reset() escape hatch ─────────────────────────────────────────

test("UI-P8: reset() clears the storage key — banner reappears on next install", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  storage.setItem(legacyBanner.STORAGE_KEY, "true");
  // First mount: banner present in DOM, storage flag set → install
  // sees the flag and removes the element.
  makeBannerElement(doc);
  const handle = legacyBanner.install({ doc, storage });
  assert.equal(handle.dismissed, true);
  handle.reset();
  assert.equal(storage.getItem(legacyBanner.STORAGE_KEY), null);
  // Re-install with a fresh banner — should be visible
  const doc2 = makeStubDoc();
  const { parent: parent2, banner: banner2 } = makeBannerElement(doc2);
  const r2 = legacyBanner.install({ doc: doc2, storage });
  assert.equal(r2.dismissed, false);
  assert.equal(parent2.children.includes(banner2), true);
});

// ── i18n integration ─────────────────────────────────────────────

test("UI-P8: i18n.applyDom is called on the banner subtree on first paint", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { banner } = makeBannerElement(doc);
  const calls = [];
  const i18n = { applyDom: (el) => calls.push(el) };
  legacyBanner.install({ doc, storage, i18n });
  assert.equal(calls.length, 1, "applyDom called once on install");
  assert.equal(calls[0], banner, "applyDom called with the banner element");
});

test("UI-P8: orchestrator:lang-changed event re-applies i18n on the banner", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { banner } = makeBannerElement(doc);
  const calls = [];
  const i18n = { applyDom: (el) => calls.push(el) };
  legacyBanner.install({ doc, storage, i18n });
  assert.equal(calls.length, 1, "initial applyDom");
  // Simulate OrchestratorI18n.setLang dispatching the event
  doc._fireDocEvent("orchestrator:lang-changed", { lang: "en" });
  assert.equal(calls.length, 2, "applyDom re-fired on lang change");
  assert.equal(calls[1], banner);
});

test("UI-P8: lang-changed handler is a no-op when banner already removed", () => {
  const doc = makeStubDoc();
  const storage = makeStubStorage();
  const { btn } = makeBannerElement(doc);
  const calls = [];
  const i18n = { applyDom: (el) => calls.push(el) };
  legacyBanner.install({ doc, storage, i18n });
  btn._click(); // dismiss → banner removed from parent
  doc._fireDocEvent("orchestrator:lang-changed", { lang: "en" });
  assert.equal(calls.length, 1,
    "applyDom only fired on initial install — dismissed banner doesn't re-translate",
  );
});

// ── _isDismissed defensive paths ─────────────────────────────────

test("UI-P8: _isDismissed returns false when storage is unavailable", () => {
  assert.equal(legacyBanner._isDismissed(null), false);
  // throwing storage
  const throwing = {
    getItem() { throw new Error("quota exceeded"); },
  };
  assert.equal(legacyBanner._isDismissed(throwing), false);
});

test("UI-P8: _isDismissed returns true only when storage value is exactly 'true'", () => {
  const s = makeStubStorage();
  assert.equal(legacyBanner._isDismissed(s), false, "missing → false");
  s.setItem(legacyBanner.STORAGE_KEY, "false");
  assert.equal(legacyBanner._isDismissed(s), false, "string 'false' → false");
  s.setItem(legacyBanner.STORAGE_KEY, "1");
  assert.equal(legacyBanner._isDismissed(s), false, "'1' is NOT 'true'");
  s.setItem(legacyBanner.STORAGE_KEY, "true");
  assert.equal(legacyBanner._isDismissed(s), true);
});

// ── Surface contract ─────────────────────────────────────────────

test("UI-P8: STORAGE_KEY + BANNER_ID exported as stable constants", () => {
  assert.equal(legacyBanner.STORAGE_KEY, "orchestrator:legacy-banner-dismissed");
  assert.equal(legacyBanner.BANNER_ID,   "orchestrator-legacy-banner");
});
