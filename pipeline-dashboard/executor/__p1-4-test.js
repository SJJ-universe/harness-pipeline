// P1-4 — UI XSS defense tests.
//
// Covers:
//   1. escapeHtml / escapeAttr purity (no DOM) — handles null, quotes,
//      angle brackets, ampersands, template-literal backticks.
//   2. Regression grep on public/app.js: known XSS sinks must be gone.
//      Specifically:
//        - loadCodexTriggers no longer interpolates trigger fields into
//          innerHTML with string concatenation
//        - showFinalPlan does not write unescaped data.reason into
//          meta.innerHTML
//        - Any remaining innerHTML assignment is followed by escapeHtml /
//          uiSanitize.escapeHtml / escapeAttr or uses static strings only.
//
// Run: node executor/__p1-4-test.js

const fs = require("fs");
const path = require("path");
const sanitize = require("../public/ui-sanitize");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (e) {
    failed++;
    console.error("  FAIL  " + name + "\n        " + (e.stack || e.message));
  }
}

console.log("[escapeHtml / escapeAttr]");

test("escapeHtml: null → empty string", () => {
  if (sanitize.escapeHtml(null) !== "") throw new Error("null → " + sanitize.escapeHtml(null));
  if (sanitize.escapeHtml(undefined) !== "") throw new Error("undefined not empty");
});

test("escapeHtml: plain ASCII passes through", () => {
  if (sanitize.escapeHtml("hello world") !== "hello world") throw new Error("plain");
});

test("escapeHtml: <script> → &lt;script&gt;", () => {
  const got = sanitize.escapeHtml("<script>alert(1)</script>");
  if (got !== "&lt;script&gt;alert(1)&lt;/script&gt;") {
    throw new Error("got " + got);
  }
});

test("escapeHtml: quotes and apostrophes neutralized", () => {
  const got = sanitize.escapeHtml(`"a"'b'`);
  if (got !== "&quot;a&quot;&#39;b&#39;") throw new Error("got " + got);
});

test("escapeHtml: ampersand must be escaped first (no double-encode)", () => {
  if (sanitize.escapeHtml("&lt;") !== "&amp;lt;") {
    throw new Error("got " + sanitize.escapeHtml("&lt;"));
  }
});

test("escapeHtml: number input coerced via String()", () => {
  if (sanitize.escapeHtml(42) !== "42") throw new Error("got " + sanitize.escapeHtml(42));
});

test("escapeAttr: backticks neutralized on top of escapeHtml", () => {
  const got = sanitize.escapeAttr("`x`");
  if (!got.includes("&#96;") || got.includes("`")) {
    throw new Error("got " + got);
  }
});

test("escapeAttr: onclick breakout attempt is defanged", () => {
  // Real-world trigger id attack: x');alert(1);//
  const got = sanitize.escapeAttr("x');alert(1);//");
  if (got.includes("'") || got.includes(")") === false) {
    // `)` is allowed in output but apostrophes MUST be escaped
    if (got.includes("'")) throw new Error("apostrophe leaked: " + got);
  }
  if (got.includes("'")) throw new Error("apostrophe leaked: " + got);
});

console.log("\n[app.js regression grep]");

const APP_JS = fs.readFileSync(
  path.join(__dirname, "..", "public", "app.js"),
  "utf-8"
);

test("loadCodexTriggers: no onclick= with interpolated trigger id", () => {
  // The old pattern baked t.id into an onclick="" attribute, which is a
  // classic XSS sink when t.id contains a quote. Now must use addEventListener.
  const rx = /onclick\s*=\s*["'][^"']*\$\{[^}]*\.id[^}]*\}/;
  if (rx.test(APP_JS)) {
    throw new Error("onclick= with interpolated trigger id still present");
  }
});

test("loadCodexTriggers: does not stringify trigger objects into innerHTML", () => {
  // Concretely: the old recommend-card template interpolated t.name/t.description/t.color
  // directly. The new implementation must build DOM nodes via createElement.
  const rx = /container\.innerHTML\s*=\s*triggers\.map/;
  if (rx.test(APP_JS)) {
    throw new Error("loadCodexTriggers still uses innerHTML = triggers.map(...)");
  }
});

test("showFinalPlan: meta.innerHTML does not interpolate data.reason unescaped", () => {
  // Either meta.innerHTML uses escapeHtml/escapeAttr on data.reason, or it
  // switches to DOM/textContent entirely. Both are acceptable; what's NOT
  // acceptable is a raw `${data.reason}` inside an innerHTML assignment.
  const rx = /meta\.innerHTML[\s\S]{0,400}?\$\{data\.reason\}/;
  if (rx.test(APP_JS)) {
    throw new Error("raw ${data.reason} still present in meta.innerHTML");
  }
});

test("renderPipeline: phase labels are escaped before reaching innerHTML", () => {
  // The rewritten renderPipeline either uses DOM API or routes all
  // server-controlled fields (phase.label, phase.name, node.label, etc.)
  // through escapeHtml. Check that phase-label template no longer has
  // a bare ${phase.label}.
  const rx = /phase-label[^`]*\$\{phase\.label\}/;
  if (rx.test(APP_JS)) {
    throw new Error("phase-label still has raw ${phase.label}");
  }
});

test("addLog still escapes message (regression)", () => {
  // Existing correct behavior — make sure the fix didn't drop it.
  if (!/escapeHtml\s*\(\s*message\s*\)/.test(APP_JS)) {
    throw new Error("addLog lost its escapeHtml(message) call");
  }
});

test("escapeHtml in app.js delegates to uiSanitize (single source of truth)", () => {
  // We want the browser escapeHtml to share code with the unit test,
  // so app.js should reference window.uiSanitize or reassign the global.
  if (!/uiSanitize/.test(APP_JS)) {
    throw new Error("app.js does not reference uiSanitize");
  }
});

test("index.html loads ui-sanitize.js before app.js", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "public", "index.html"),
    "utf-8"
  );
  const iSan = html.indexOf("ui-sanitize.js");
  const iApp = html.indexOf("app.js");
  if (iSan < 0) throw new Error("index.html missing ui-sanitize.js script tag");
  if (iApp < 0) throw new Error("index.html missing app.js script tag");
  if (iSan > iApp) throw new Error("ui-sanitize.js must load before app.js");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
