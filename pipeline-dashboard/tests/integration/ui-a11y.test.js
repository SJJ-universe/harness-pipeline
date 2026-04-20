// Slice H (v5) — static a11y assertions against the built index.html.
//
// We don't run a headless browser here; instead we parse the static HTML and
// verify the structural invariants: skip-link, main landmark, dialog roles,
// aria-labelledby pointing at valid title ids, and that the focus-trap /
// keybindings scripts are loaded before the panels that need them.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const index = fs.readFileSync(path.join(root, "public", "index.html"), "utf-8");

test("skip-link to #main-content exists near <body>", () => {
  assert.match(index, /<a class="skip-link" href="#main-content">/);
  assert.match(index, /본문 바로가기/);
});

test("main landmark wraps the dashboard body", () => {
  assert.match(
    index,
    /<main id="main-content" role="main" tabindex="-1">/,
    "main landmark missing or missing required attrs"
  );
  assert.ok(
    index.indexOf('<main id="main-content"') < index.indexOf("<!-- General Pipeline Task Input Modal -->"),
    "main must open before the modal region"
  );
  assert.match(index, /<\/main>/);
});

test("header declares role=\"banner\"", () => {
  assert.match(index, /<header role="banner">/);
});

test("every modal-overlay carries role=dialog + aria-modal + aria-labelledby", () => {
  // Find every `<div class="modal-overlay..." id="...">...` opening line,
  // ensure it's adjacent to role="dialog" and friends.
  const dialogBlocks = index.match(/<div class="modal-overlay[^"]*" id="([^"]+)"[\s\S]*?>/g) || [];
  assert.ok(dialogBlocks.length >= 6, `expected ≥6 modal overlays, got ${dialogBlocks.length}`);
  for (const block of dialogBlocks) {
    const idMatch = /id="([^"]+)"/.exec(block);
    const id = idMatch ? idMatch[1] : "(unknown)";
    assert.match(block, /role="dialog"/, `modal ${id} missing role="dialog"`);
    assert.match(block, /aria-modal="true"/, `modal ${id} missing aria-modal="true"`);
    assert.match(block, /aria-labelledby="([a-z-]+)"/, `modal ${id} missing aria-labelledby`);
  }
});

test("every aria-labelledby id resolves to a title element in the document", () => {
  const ids = Array.from(index.matchAll(/aria-labelledby="([a-z-]+)"/g)).map((m) => m[1]);
  assert.ok(ids.length >= 6, `expected ≥6 labelledby targets, got ${ids.length}`);
  for (const id of ids) {
    // The id must appear as `id="<id>"` SOMEWHERE in the document (on a title span).
    const needle = new RegExp(`id="${id}"`);
    assert.match(index, needle, `aria-labelledby target #${id} not found in document`);
  }
});

test("icon-only header buttons carry aria-label", () => {
  // After Slice H, these header buttons must expose aria-label so screen
  // readers announce the action (title alone is not an a11y name).
  for (const btnId of [
    "btn-open-analytics",
    "btn-open-run-history",
    "btn-server-restart",
    "btn-server-stop",
  ]) {
    const re = new RegExp(`id="${btnId}"[^>]*aria-label="`);
    assert.match(index, re, `button #${btnId} missing aria-label`);
  }
});

test("focus-trap and keybindings scripts load before the panels that use them", () => {
  const posFocus = index.indexOf('js/focus-trap.js');
  const posKey = index.indexOf('js/keybindings.js');
  const posTpl = index.indexOf('js/template-editor.js');
  const posHist = index.indexOf('js/run-history.js');
  const posAnalytics = index.indexOf('js/analytics-panel.js');
  assert.ok(posFocus > 0, "focus-trap.js script tag missing");
  assert.ok(posKey > 0, "keybindings.js script tag missing");
  assert.ok(
    posFocus < posTpl && posFocus < posHist && posFocus < posAnalytics,
    "focus-trap.js must load before template-editor / run-history / analytics-panel"
  );
  assert.ok(
    posKey < posTpl && posKey < posHist && posKey < posAnalytics,
    "keybindings.js must load before the panels"
  );
});

test("app.js wraps panels with HarnessFocusTrap and registers keybindings", () => {
  const app = fs.readFileSync(path.join(root, "public", "app.js"), "utf-8");
  assert.match(app, /HarnessFocusTrap\.trap/);
  assert.match(app, /HarnessKeybindings\.install/);
  assert.match(app, /HarnessKeybindings\.register/);
  assert.match(app, /"g t"/);
  assert.match(app, /"g h"/);
  assert.match(app, /"g m"/);
});

test("style.css defines skip-link and global :focus-visible rules", () => {
  const css = fs.readFileSync(path.join(root, "public", "style.css"), "utf-8");
  assert.match(css, /\.skip-link\s*\{/);
  assert.match(css, /\.skip-link:focus\s*\{/);
  assert.match(css, /:focus-visible\s*\{/);
});
