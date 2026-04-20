// Slice I (v5) — HarnessI18n pure-logic + applyDom() unit tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const i18n = require("../../public/js/i18n");

function withTables(tables) {
  i18n._resetForTests();
  i18n.setTables(tables);
}

test("t(known key) returns the translated value from the active locale", () => {
  withTables({
    ko: { "hello.world": "안녕, 세계" },
    en: { "hello.world": "Hello, world" },
  });
  assert.equal(i18n.t("hello.world"), "안녕, 세계");
});

test("t() falls back to the default locale when the active one lacks the key", () => {
  withTables({
    ko: { "only.ko": "한국어만" },
    en: { /* no only.ko */ "other.key": "other" },
  });
  i18n.setLang("en", { persist: false, applyNow: false });
  assert.equal(i18n.t("only.ko"), "한국어만"); // falls through to ko (DEFAULT)
});

test("t(unknown key) returns the raw key", () => {
  withTables({ ko: {}, en: {} });
  assert.equal(i18n.t("nothing.matches"), "nothing.matches");
});

test("t(key, params) replaces {placeholder} tokens", () => {
  withTables({ ko: { greet: "안녕 {name}! 오늘 {n}번째 방문" } });
  assert.equal(i18n.t("greet", { name: "SJ", n: 5 }), "안녕 SJ! 오늘 5번째 방문");
});

test("setLang rejects unsupported locales and returns false", () => {
  withTables({ ko: {}, en: {} });
  assert.equal(i18n.setLang("jp"), false);
  assert.equal(i18n.getLang(), "ko");
});

test("setLang accepts supported locales and returns true", () => {
  withTables({ ko: {}, en: {} });
  assert.equal(i18n.setLang("en", { persist: false, applyNow: false }), true);
  assert.equal(i18n.getLang(), "en");
});

// ── applyDom() with a hand-rolled DOM shim ──────────────────────

function makeDoc(elements) {
  return {
    querySelectorAll(sel) {
      // Bare-bones attribute-selector support: [data-i18n], [data-i18n-title], etc.
      const attr = sel.match(/^\[([a-z0-9-]+)\]$/);
      if (!attr) return [];
      const name = attr[1];
      return elements.filter((el) => name in el._attrs);
    },
  };
}

function makeEl(attrs = {}) {
  return {
    _attrs: { ...attrs },
    textContent: "",
    getAttribute(k) { return this._attrs[k] ?? null; },
    setAttribute(k, v) { this._attrs[k] = v; },
  };
}

test("applyDom updates textContent for [data-i18n]", () => {
  withTables({ ko: { "btn.save": "저장" }, en: { "btn.save": "Save" } });
  const btn = makeEl({ "data-i18n": "btn.save" });
  const doc = makeDoc([btn]);
  i18n.applyDom(doc);
  assert.equal(btn.textContent, "저장");
});

test("applyDom updates title, aria-label, placeholder attributes", () => {
  withTables({
    ko: {
      "btn.x.title": "제목",
      "btn.x.aria": "aria 라벨",
      "field.ph": "입력하세요",
    },
    en: {},
  });
  const titleEl = makeEl({ "data-i18n-title": "btn.x.title" });
  const ariaEl = makeEl({ "data-i18n-aria-label": "btn.x.aria" });
  const phEl = makeEl({ "data-i18n-placeholder": "field.ph" });
  const doc = makeDoc([titleEl, ariaEl, phEl]);
  i18n.applyDom(doc);
  assert.equal(titleEl.getAttribute("title"), "제목");
  assert.equal(ariaEl.getAttribute("aria-label"), "aria 라벨");
  assert.equal(phEl.getAttribute("placeholder"), "입력하세요");
});

test("applyDom on a null doc is a no-op (smoke for test envs)", () => {
  i18n.applyDom(null);
  i18n.applyDom({ /* no querySelectorAll */ });
});

test("SUPPORTED includes ko and en", () => {
  assert.ok(i18n.SUPPORTED.includes("ko"));
  assert.ok(i18n.SUPPORTED.includes("en"));
});

test("DEFAULT is ko", () => {
  assert.equal(i18n.DEFAULT, "ko");
});
