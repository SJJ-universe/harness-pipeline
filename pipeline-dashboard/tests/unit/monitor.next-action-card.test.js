// Slice UI-FirstRun-b (Phase D Round UI-P, 2026-05-04) — next-action
// card panel tests. JSDOM-style stub document since this is a UMD
// browser module.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const panel = require("../../public/js/monitor/panels/next-action-card");

// ── DOM stub ────────────────────────────────────────────────────

function _makeDoc() {
  function _makeEl(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      _classList: new Set(),
      get className() {
        return Array.from(this._classList).join(" ");
      },
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
      // Convenience for tests
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

function _makeStore(initialAccountStatus) {
  let snap = { accountStatus: initialAccountStatus || null };
  const subs = [];
  return {
    snapshot() { return snap; },
    subscribe(fn) { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    setAccountStatus(ac) {
      snap = { accountStatus: ac };
      subs.forEach((fn) => fn(snap));
    },
    _subs: subs,
  };
}

// ── Module surface ──────────────────────────────────────────────

test("UI-FirstRun next-action-card: documented exports", () => {
  assert.equal(typeof panel.create, "function");
  assert.equal(typeof panel.STATE_COPY, "object");
  assert.equal(typeof panel.CTA_COPY, "object");
});

test("UI-FirstRun next-action-card: STATE_COPY covers all 6 states", () => {
  for (const id of [
    "no-profile", "no-active-profile", "public-sector-incomplete",
    "provider-missing", "provider-not-authenticated", "ready",
  ]) {
    assert.ok(panel.STATE_COPY[id], `STATE_COPY missing entry for ${id}`);
    assert.ok(panel.STATE_COPY[id].headlineKey);
    assert.ok(panel.STATE_COPY[id].headlineFallback);
    assert.ok(panel.STATE_COPY[id].bodyKey);
    assert.ok(panel.STATE_COPY[id].bodyFallback);
  }
});

test("UI-FirstRun next-action-card: CTA_COPY covers all 9 CTA IDs", () => {
  for (const id of [
    "create-profile", "open-setup-wizard", "open-settings-profiles",
    "open-public-sector-setup", "test-claude", "test-codex",
    "reopen-setup-for-providers", "auth-claude", "auth-codex",
  ]) {
    assert.ok(panel.CTA_COPY[id], `CTA_COPY missing entry for ${id}`);
    assert.ok(panel.CTA_COPY[id].labelKey);
    assert.ok(panel.CTA_COPY[id].labelFallback);
  }
});

// ── Construction ────────────────────────────────────────────────

test("UI-FirstRun next-action-card: create() requires root + store + doc", () => {
  const doc = _makeDoc();
  const store = _makeStore();
  assert.throws(() => panel.create({ root: null, store, doc }), /root must be an element/);
  assert.throws(() => panel.create({ root: doc.body, store: null, doc }), /store with subscribe/);
});

test("UI-FirstRun next-action-card: mounts a section with data-card='next-action'", () => {
  const doc = _makeDoc();
  const store = _makeStore({ profile: { count: 0 } });
  const handle = panel.create({ root: doc.body, store, doc });
  assert.ok(handle.card);
  assert.equal(handle.card.tagName, "SECTION");
  assert.equal(handle.card.getAttribute("data-card"), "next-action");
  assert.equal(handle.card.getAttribute("role"), "region");
  assert.ok(doc.body.children.indexOf(handle.card) >= 0,
    "card must be appended to root");
});

// ── Per-state rendering ─────────────────────────────────────────

function _setupForState(accountStatus) {
  const doc = _makeDoc();
  const store = _makeStore(accountStatus);
  const ctaCalls = [];
  const handle = panel.create({
    root: doc.body, store, doc,
    onCta: (ctaId, meta) => ctaCalls.push({ ctaId, meta }),
  });
  return { doc, store, handle, ctaCalls };
}

test("UI-FirstRun next-action-card: NO_PROFILE state renders headline + setup wizard CTA", () => {
  const { handle } = _setupForState({ profile: { count: 0 } });
  assert.equal(handle.card.getAttribute("data-state"), "no-profile");
  const headline = handle.card._findByAttr("data-card-slot", "headline");
  assert.match(headline.textContent, /프로필이 아직 없습니다/);
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  // First CTA = open-setup-wizard, second = create-profile
  assert.equal(ctaRow.children.length, 2);
  assert.equal(ctaRow.children[0].getAttribute("data-cta"), "open-setup-wizard");
  assert.equal(ctaRow.children[1].getAttribute("data-cta"), "create-profile");
  // Primary class on first
  assert.ok(ctaRow.children[0].className.includes("is-primary"));
});

test("UI-FirstRun next-action-card: NO_ACTIVE_PROFILE renders one CTA + meta line with count", () => {
  const { handle } = _setupForState({
    profile: { count: 3, activeId: null },
    deployment: { publicSector: false },
  });
  assert.equal(handle.card.getAttribute("data-state"), "no-active-profile");
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  assert.equal(ctaRow.children.length, 1);
  assert.equal(ctaRow.children[0].getAttribute("data-cta"), "open-settings-profiles");
  const meta = handle.card._findByAttr("data-card-slot", "meta");
  assert.match(meta.textContent, /3/, "meta must display profile count");
});

test("UI-FirstRun next-action-card: PUBLIC_SECTOR_INCOMPLETE flips data-posture attribute", () => {
  const { handle } = _setupForState({
    profile: { count: 1, activeId: null },
    deployment: { publicSector: true },
  });
  assert.equal(handle.card.getAttribute("data-state"), "public-sector-incomplete");
  assert.equal(handle.card.getAttribute("data-posture"), "public-sector",
    "public-sector posture must surface as data-posture for CSS treatment");
  const headline = handle.card._findByAttr("data-card-slot", "headline");
  assert.match(headline.textContent, /공공기관/);
});

test("UI-FirstRun next-action-card: PROVIDER_MISSING shows missing runners in meta", () => {
  const { handle } = _setupForState({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(handle.card.getAttribute("data-state"), "provider-missing");
  const meta = handle.card._findByAttr("data-card-slot", "meta");
  assert.match(meta.textContent, /claude/i,
    "meta must list which runner is missing");
});

test("UI-FirstRun next-action-card: PROVIDER_NOT_AUTHENTICATED shows 2 auth CTAs", () => {
  const { handle } = _setupForState({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: false },
      codex: { installed: true, authenticated: true },
    },
  });
  assert.equal(handle.card.getAttribute("data-state"), "provider-not-authenticated");
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  assert.equal(ctaRow.children.length, 2);
  assert.equal(ctaRow.children[0].getAttribute("data-cta"), "auth-claude");
  assert.equal(ctaRow.children[1].getAttribute("data-cta"), "auth-codex");
});

test("UI-FirstRun next-action-card: READY state shows test CTAs + 'untested' hint when no providerStatus", () => {
  const { handle } = _setupForState({
    profile: { count: 1, activeId: "personal" },
    deployment: { publicSector: false },
  });
  assert.equal(handle.card.getAttribute("data-state"), "ready");
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  assert.equal(ctaRow.children.length, 2);
  assert.equal(ctaRow.children[0].getAttribute("data-cta"), "test-claude");
  assert.equal(ctaRow.children[1].getAttribute("data-cta"), "test-codex");
  const meta = handle.card._findByAttr("data-card-slot", "meta");
  assert.match(meta.textContent, /확인되지 않았습니다/,
    "ready state with unknown provider status must show honest 'untested' hint");
});

test("UI-FirstRun next-action-card: READY state with full providerStatus has no untested-hint meta", () => {
  const { handle } = _setupForState({
    profile: { count: 1, activeId: "personal" },
    providerStatus: {
      claude: { installed: true, authenticated: true },
      codex: { installed: true, authenticated: true },
    },
  });
  const meta = handle.card._findByAttr("data-card-slot", "meta");
  assert.equal(meta.textContent, "",
    "ready + providerStatus known → no honest-uncertainty hint");
});

// ── CTA wiring ──────────────────────────────────────────────────

test("UI-FirstRun next-action-card: clicking a CTA fires onCta(id, meta)", () => {
  const { handle, ctaCalls } = _setupForState({
    profile: { count: 1, activeId: null },
    deployment: { publicSector: false },
  });
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  ctaRow.children[0]._click();
  assert.equal(ctaCalls.length, 1);
  assert.equal(ctaCalls[0].ctaId, "open-settings-profiles");
  assert.equal(ctaCalls[0].meta.profileCount, 1);
});

test("UI-FirstRun next-action-card: missing onCta does not throw on click", () => {
  const doc = _makeDoc();
  const store = _makeStore({ profile: { count: 0 } });
  const handle = panel.create({ root: doc.body, store, doc });
  const ctaRow = handle.card._findByAttr("data-card-slot", "cta-row");
  // Should not throw
  ctaRow.children[0]._click();
});

// ── Reactivity ──────────────────────────────────────────────────

test("UI-FirstRun next-action-card: re-renders on store publish", () => {
  const { store, handle } = _setupForState({ profile: { count: 0 } });
  assert.equal(handle.card.getAttribute("data-state"), "no-profile");
  store.setAccountStatus({ profile: { count: 1, activeId: "personal" } });
  assert.equal(handle.card.getAttribute("data-state"), "ready",
    "store mutation must re-render the card");
});

// ── Lifecycle ───────────────────────────────────────────────────

test("UI-FirstRun next-action-card: destroy unsubs + removes the element", () => {
  const { doc, store, handle } = _setupForState({ profile: { count: 0 } });
  assert.equal(doc.body.children.length, 1);
  assert.equal(store._subs.length, 1);
  handle.destroy();
  assert.equal(doc.body.children.length, 0);
  assert.equal(store._subs.length, 0,
    "destroy must unsubscribe from store");
});
