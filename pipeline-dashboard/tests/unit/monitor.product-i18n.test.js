// Slice UI-P7 (Phase 2 Round 3, 2026-04-30) — product shell i18n
// integration tests.
//
// Pins:
//   - All UI-P7 prod.* keys exist in both ko + en tables (key-level
//     parity is enforced by i18n.coverage.test.js; this file asserts
//     that each documented surface has its key).
//   - product-header renders translated text when an i18n stub is
//     injected via opts.i18n.
//   - product-header.setLocale(next) re-renders translatable surfaces
//     (mode toggle innerHTML, status pill text, indicator labels,
//     pro-action button labels, shutdown button, aria labels).
//   - product-dual-terminals renders translated action-row labels +
//     posture badge text + state indicator from the i18n table.
//   - product-dual-terminals.setLocale(next) re-renders the action
//     row using the new translations.
//   - product-shell-data selectServerStatus / selectCodexStatus expose
//     `labelKey` alongside `label` for header to consume.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const ko = require("../../public/js/i18n/ko");
const en = require("../../public/js/i18n/en");
const productHeader = require("../../public/js/monitor/panels/product-header");
const productDualTerminals = require("../../public/js/monitor/panels/product-dual-terminals");
const productShellData = require("../../public/js/monitor/product-shell-data");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub mirroring the rest of the product test suite ─────────

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
    get firstChild() { return this.children[0] || null; },
    get innerHTML() { return ""; },
    set innerHTML(v) {
      // Header builds mode buttons via innerHTML — capture the raw
      // string so tests can assert against the text it contains.
      this._textContent = String(v).replace(/<[^>]*>/g, "");
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
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
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
  };
  el.disabled = false;
  el.type = "";
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
  };
}
const makeStubDoc = () => ({
  createElement: makeStubElement,
  createTextNode: makeStubTextNode,
});
const makeRoot = () => makeStubElement("div");

// Build a mutable i18n stub that mirrors OrchestratorI18n.t/getLang/setLang.
function makeI18nStub(initialLang = "ko") {
  let lang = initialLang;
  return {
    t(key) {
      const table = (lang === "en") ? en : ko;
      return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
    },
    getLang() { return lang; },
    setLang(next) {
      if (next === "ko" || next === "en") { lang = next; return true; }
      return false;
    },
  };
}

// ── i18n key presence (enforced surface) ──────────────────────────

test("UI-P7: all documented prod.* keys exist in BOTH ko + en tables", () => {
  const required = [
    // Mode toggle
    "prod.mode.simple", "prod.mode.simple.eng",
    "prod.mode.pro",    "prod.mode.pro.eng",
    // Status pill
    "prod.status.idle", "prod.status.running", "prod.status.error",
    // Indicators
    "prod.indicator.server.online", "prod.indicator.server.offline",
    "prod.indicator.server.checking",
    "prod.indicator.codex.ready", "prod.indicator.codex.authNeeded",
    "prod.indicator.codex.notInstalled",
    // Aria
    "prod.aria.header", "prod.aria.statusPill", "prod.aria.modeToggle",
    "prod.aria.localeToggle", "prod.aria.serverIndicator",
    "prod.aria.codexIndicator", "prod.aria.dualTerminals",
    "prod.aria.actionRow",
    // Dual-terminals action row
    "prod.terminals.session.none", "prod.terminals.posture.publicSector",
    "prod.terminals.action.start", "prod.terminals.action.start.title",
    "prod.terminals.action.sendCodex", "prod.terminals.action.sendCodex.title",
    "prod.terminals.action.followUpCodex", "prod.terminals.action.followUpCodex.title",
    "prod.terminals.action.handBack", "prod.terminals.action.handBack.title",
    "prod.terminals.action.archive", "prod.terminals.action.archive.title",
    // States
    "prod.terminals.state.created", "prod.terminals.state.awaiting_critique",
    "prod.terminals.state.critique_received", "prod.terminals.state.awaiting_claude",
    "prod.terminals.state.claude_received", "prod.terminals.state.archived",
  ];
  const missingKo = required.filter((k) => !Object.prototype.hasOwnProperty.call(ko, k));
  const missingEn = required.filter((k) => !Object.prototype.hasOwnProperty.call(en, k));
  assert.deepEqual(missingKo, [], "ko must define every prod.* key");
  assert.deepEqual(missingEn, [], "en must define every prod.* key");
});

test("UI-P7: bilingual mode-toggle subscript stays English in BOTH locales", () => {
  // Per UI-P0 §6 the design ribbon (Korean primary + English subscript)
  // is a fixed bilingual constant — the EN locale doesn't translate
  // "Simple"/"Pro" away.
  assert.equal(ko["prod.mode.simple.eng"], "Simple");
  assert.equal(en["prod.mode.simple.eng"], "Simple");
  assert.equal(ko["prod.mode.pro.eng"],    "Pro");
  assert.equal(en["prod.mode.pro.eng"],    "Pro");
});

// ── product-shell-data selector exposes labelKey ─────────────────

test("UI-P7: selectServerStatus returns labelKey alongside label", () => {
  const ok = productShellData.selectServerStatus({ server: { up: true } });
  assert.equal(ok.status, "ok");
  assert.equal(ok.label, "서버 ONLINE");
  assert.equal(ok.labelKey, "prod.indicator.server.online");
  const offline = productShellData.selectServerStatus({ server: { up: false } });
  assert.equal(offline.labelKey, "prod.indicator.server.offline");
});

test("UI-P7: selectCodexStatus returns labelKey for ready/auth/missing", () => {
  const ready = productShellData.selectCodexStatus({});
  assert.equal(ready.labelKey, "prod.indicator.codex.ready");
  const auth = productShellData.selectCodexStatus({
    accountStatus: { profile: { codexLastTest: { installed: true, authenticated: false } } },
  });
  assert.equal(auth.status, "warn");
  assert.equal(auth.labelKey, "prod.indicator.codex.authNeeded");
  const missing = productShellData.selectCodexStatus({
    accountStatus: { profile: { codexLastTest: { installed: false } } },
  });
  assert.equal(missing.status, "fail");
  assert.equal(missing.labelKey, "prod.indicator.codex.notInstalled");
});

// ── product-header renders translated text via injected i18n ─────

test("UI-P7: header status pill uses i18n table when injected", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHeader.create({
    root, store, doc: makeStubDoc(),
    i18n: makeI18nStub("ko"),
  });
  // Status pill defaults to idle until store reports a run
  const pill = root._findOneByAttr("data-header-slot", "status-pill");
  assert.ok(pill);
  // The label child is the first non-dot child — but easier: walk for textContent
  // The inner span with class prod-header-status-label has the text.
  const labelEl = pill.children.find((c) =>
    c.classList && c.classList.contains("prod-header-status-label"),
  );
  assert.ok(labelEl);
  assert.equal(labelEl.textContent, ko["prod.status.idle"], "ko: 대기 중");
});

test("UI-P7: header pro-action buttons reuse existing btn.* keys", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  productHeader.create({
    root, store, doc: makeStubDoc(),
    i18n: makeI18nStub("ko"), mode: "pro",
  });
  // LEGACY-VIEW-REMOVE-0 (2026-05-11): metrics + history buttons were
  // removed when their legacy-view targets disappeared. The remaining
  // header buttons are codex-verify (tools cluster) + shutdown
  // (pro-actions cluster).
  const verify  = root._findOneByAttr("data-action", "codex-verify");
  const stop    = root._findOneByAttr("data-action", "shutdown");
  assert.equal(verify.textContent,  ko["btn.codexVerify"]);
  assert.equal(stop.textContent,    ko["btn.serverStop"]);
});

test("UI-P7: header.setLocale('en') swaps every translatable surface", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const i18n = makeI18nStub("ko");
  const handle = productHeader.create({
    root, store, doc: makeStubDoc(), i18n: i18n,
  });
  // Confirm initial KO text
  const pill = root._findOneByAttr("data-header-slot", "status-pill");
  const labelEl = pill.children.find((c) =>
    c.classList && c.classList.contains("prod-header-status-label"),
  );
  assert.equal(labelEl.textContent, "대기 중");
  // Flip locale on the table, then call setLocale to re-render
  i18n.setLang("en");
  handle.setLocale("en");
  assert.equal(labelEl.textContent, en["prod.status.idle"], "en: Idle");
  // Aria label also flipped
  const header = root.children[0];
  assert.equal(header.attributes["aria-label"], en["prod.aria.header"]);
  // Mode toggle re-rendered (innerHTML swap → textContent capture in stub)
  const simpleBtn = root._findOneByAttr("data-mode", "simple");
  assert.match(simpleBtn.textContent, /일반사용자/,
    "Korean primary stays Korean (bilingual design ribbon)",
  );
  assert.match(simpleBtn.textContent, /Simple/, "English subscript stays visible");
});

test("UI-P7: header without i18n falls back to Korean defaults (Node test path)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  // No i18n injected — _t() returns fallback only.
  productHeader.create({ root, store, doc: makeStubDoc() });
  const pill = root._findOneByAttr("data-header-slot", "status-pill");
  const labelEl = pill.children.find((c) =>
    c.classList && c.classList.contains("prod-header-status-label"),
  );
  // Fallback is Korean (matches existing UI-P5 test expectations).
  assert.equal(labelEl.textContent, "대기 중");
});

// ── product-dual-terminals renders translated action row ─────────

test("UI-P7: dual-terminals action row labels + posture use i18n", { skip: "LAYOUT-REORG-PRO-0: action row removed" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "critique_received", runId: null });
  store.selectReviewSession("s1");
  store.setAccountStatus({ deployment: { publicSector: true, allowLocalExecutor: false } });
  const client = { async createSession() {}, async sendToCodex() {},
                   async followUp() {}, async handBackToClaude() {},
                   async archiveSession() {} };
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client: client,
    dataSelectors: productShellData,
    i18n: makeI18nStub("en"),
  });
  // Indicator: shows EN state label
  const indicator = root._findOneByAttr("data-actions-slot", "indicator");
  assert.match(indicator.textContent, /Critique received/, "EN state translation");
  // Send-to-Codex button label (English)
  const sendBtn = root._findOneByAttr("data-action-id", "send-codex");
  assert.equal(sendBtn.textContent, en["prod.terminals.action.sendCodex"]);
  assert.equal(sendBtn.attributes.title, en["prod.terminals.action.sendCodex.title"]);
  // Hand-back hidden (public-sector); posture badge in EN
  assert.equal(root._findOneByAttr("data-action-id", "hand-back"), null);
  const badge = root._findOneByAttr("data-actions-slot", "posture-badge");
  assert.match(badge.textContent, /Public-sector/, "EN posture text");
});

test("UI-P7: dual-terminals.setLocale('en') refreshes action row labels", { skip: "LAYOUT-REORG-PRO-0: action row removed" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  store.upsertReviewSession("s1", { sessionId: "s1", state: "created", runId: null });
  store.selectReviewSession("s1");
  const client = { async createSession() {}, async sendToCodex() {},
                   async followUp() {}, async handBackToClaude() {},
                   async archiveSession() {} };
  const i18n = makeI18nStub("ko");
  const handle = productDualTerminals.create({
    root, store, doc: makeStubDoc(), client: client,
    dataSelectors: productShellData,
    i18n: i18n,
  });
  // Initial KO labels
  let startBtn = root._findOneByAttr("data-action-id", "start");
  assert.equal(startBtn.textContent, ko["prod.terminals.action.start"]);
  // Flip table + locale
  i18n.setLang("en");
  handle.setLocale("en");
  startBtn = root._findOneByAttr("data-action-id", "start");
  assert.equal(startBtn.textContent, en["prod.terminals.action.start"]);
});

test("UI-P7: dual-terminals without i18n falls back to Korean (Node test path)", { skip: "LAYOUT-REORG-PRO-0: action row removed" }, () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const client = { async createSession() {}, async sendToCodex() {},
                   async followUp() {}, async handBackToClaude() {},
                   async archiveSession() {} };
  productDualTerminals.create({
    root, store, doc: makeStubDoc(), client: client,
    dataSelectors: productShellData,
  });
  const startBtn = root._findOneByAttr("data-action-id", "start");
  assert.equal(startBtn.textContent, "+ 세션 시작");
  const indicator = root._findOneByAttr("data-actions-slot", "indicator");
  assert.match(indicator.textContent, /세션 없음/);
});

test("UI-P7: STATE_LABELS exposes i18n-key map for every documented state", () => {
  const states = ["created", "awaiting_critique", "critique_received",
                  "awaiting_claude", "claude_received", "archived"];
  for (const s of states) {
    assert.ok(productDualTerminals.STATE_LABELS[s],
      `STATE_LABELS["${s}"] must exist for action-row indicator translation`);
    assert.ok(productDualTerminals.STATE_LABELS[s].key,
      `STATE_LABELS["${s}"] must carry an i18n key`);
  }
});
