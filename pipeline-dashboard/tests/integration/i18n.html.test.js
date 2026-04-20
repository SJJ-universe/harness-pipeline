// Slice I (v5) — index.html data-i18n audit.
//
// Statically parses index.html and enforces:
//   1. Every data-i18n / data-i18n-title / data-i18n-aria-label /
//      data-i18n-placeholder attribute points at a key that exists in ko.js.
//   2. The set of localized surfaces is the expected shape — we want the
//      core buttons, stats, tabs, and modal titles all wired up. This is
//      a "coverage high-water mark" test: if someone removes a data-i18n
//      attribute, the test fails loudly.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const ko = require("../../public/js/i18n/ko");

const index = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "public", "index.html"),
  "utf-8"
);

function collectKeys(attrName) {
  const re = new RegExp(`${attrName}="([^"]+)"`, "g");
  const keys = [];
  let m;
  while ((m = re.exec(index)) !== null) keys.push(m[1]);
  return keys;
}

test("every data-i18n key resolves to a known ko table entry", () => {
  const keys = collectKeys("data-i18n");
  assert.ok(keys.length >= 20, `expected ≥20 data-i18n usages, got ${keys.length}`);
  const unknown = keys.filter((k) => !(k in ko));
  assert.deepEqual(unknown, [], `unknown data-i18n keys:\n  ${unknown.join("\n  ")}`);
});

test("every data-i18n-title key resolves", () => {
  const keys = collectKeys("data-i18n-title");
  const unknown = keys.filter((k) => !(k in ko));
  assert.deepEqual(unknown, [], `unknown data-i18n-title keys: ${unknown.join(", ")}`);
});

test("every data-i18n-aria-label key resolves", () => {
  const keys = collectKeys("data-i18n-aria-label");
  const unknown = keys.filter((k) => !(k in ko));
  assert.deepEqual(unknown, [], `unknown data-i18n-aria-label keys: ${unknown.join(", ")}`);
});

test("every data-i18n-placeholder key resolves", () => {
  const keys = collectKeys("data-i18n-placeholder");
  const unknown = keys.filter((k) => !(k in ko));
  assert.deepEqual(unknown, [], `unknown data-i18n-placeholder keys: ${unknown.join(", ")}`);
});

test("core header surfaces are localized", () => {
  // Regression guard — these MUST stay wired to i18n so the toolbar
  // doesn't partially translate when the user flips to English.
  for (const key of [
    "header.title",
    "btn.codexVerify",
    "btn.openAnalytics",
    "btn.openRunHistory",
    "btn.serverRestart",
    "btn.serverStop",
    "stat.findings",
    "stat.context",
    "stat.verify",
    "modal.analytics.title",
    "modal.runHistory.title",
    "modal.templateEditor.title",
  ]) {
    const needle = new RegExp(`data-i18n="${key.replace(/\./g, "\\.")}"`);
    assert.match(index, needle, `${key} must appear as a data-i18n attribute in index.html`);
  }
});

test("language toggle buttons exist with data-lang=ko / data-lang=en", () => {
  assert.match(index, /class="lang-btn" data-lang="ko"/);
  assert.match(index, /class="lang-btn" data-lang="en"/);
});

test("i18n scripts load before panel scripts (ko/en/i18n first)", () => {
  const posKo = index.indexOf("js/i18n/ko.js");
  const posEn = index.indexOf("js/i18n/en.js");
  const posI18n = index.indexOf("js/i18n.js");
  const posToast = index.indexOf("js/toast.js");
  assert.ok(posKo > 0 && posEn > 0 && posI18n > 0, "i18n scripts not loaded");
  assert.ok(posKo < posEn, "ko must load before en");
  assert.ok(posEn < posI18n, "en must load before i18n.js");
  assert.ok(posI18n < posToast, "i18n must load before toast.js (panels may call t())");
});
