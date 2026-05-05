// Slice PRODUCT-SHELL-WIRING (rc.5 prep, 2026-05-06) — legacy hash-on-load
// router tests.
//
// `_handleHashOnLoad` (defined inside `public/app.js`) reads
// `window.location.hash` after the legacy modules are installed and
// dispatches to the matching opener. This wiring lets the product
// shell's Wave 2 redirect (e.g. `/?mode=legacy#analytics`) auto-open
// the right legacy panel.
//
// app.js is a browser script, not a CommonJS module — loading it
// directly in node would fire `initEventBindings()` and reach for
// dozens of globals. Instead we extract the function via regex and
// rebuild it inside a `new Function` scope where we control the
// `window` + `toggleCompactMode` references.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ── Extract `_handleHashOnLoad` from app.js source ─────────────────

const APP_SRC_PATH = path.join(
  __dirname,
  "..", "..", "public", "app.js",
);
// Normalise CRLF → LF so the regex below matches on Windows checkouts
// where git's autocrlf has expanded the on-disk file. The function we
// extract is pure ASCII / no embedded `\r`, so this is safe.
const APP_SRC = fs.readFileSync(APP_SRC_PATH, "utf-8").replace(/\r\n/g, "\n");

// Match the function from `function _handleHashOnLoad() {` to its
// matching closing `}` at column 0. The function lives at module
// scope (no leading whitespace) so the simple anchor works.
const FN_MATCH = APP_SRC.match(/^function _handleHashOnLoad\(\)[\s\S]*?\n\}\n/m);
if (!FN_MATCH) {
  throw new Error("_handleHashOnLoad function not found in app.js — rename or refactor?");
}
const FN_TEXT = FN_MATCH[0];

function buildHandler({ hash, panels = {}, toggleCompactMode = () => {} }) {
  // Build a window stub with the requested hash + optional panel modules.
  const win = {
    location: { hash: String(hash || "") },
    HarnessAnalyticsPanel: panels.analytics || null,
    HarnessRunHistory: panels.runHistory || null,
    HarnessTemplateEditor: panels.templateEditor || null,
  };
  // Construct a closure that exposes the function and runs it once.
  // The function body references `window` + `toggleCompactMode` — both
  // come from the outer scope of the new Function we build here.
  // eslint-disable-next-line no-new-func
  const wrapper = new Function(
    "window", "toggleCompactMode",
    FN_TEXT + "\nreturn _handleHashOnLoad;",
  );
  const handler = wrapper(win, toggleCompactMode);
  return { handler, win };
}

// ── Tests ──────────────────────────────────────────────────────────

test("_handleHashOnLoad opens analytics panel for hash=\"#analytics\"", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "#analytics",
    panels: { analytics: { open: () => opens.push("analytics") } },
  });
  handler();
  assert.deepEqual(opens, ["analytics"]);
});

test("_handleHashOnLoad opens run-history for hash=\"#run-history\"", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "#run-history",
    panels: { runHistory: { open: () => opens.push("run-history") } },
  });
  handler();
  assert.deepEqual(opens, ["run-history"]);
});

test("_handleHashOnLoad opens template-editor for hash=\"#template-editor\"", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "#template-editor",
    panels: { templateEditor: { open: () => opens.push("template-editor") } },
  });
  handler();
  assert.deepEqual(opens, ["template-editor"]);
});

test("_handleHashOnLoad invokes toggleCompactMode for hash=\"#compact\"", () => {
  const calls = [];
  const { handler } = buildHandler({
    hash: "#compact",
    toggleCompactMode: () => calls.push("compact"),
  });
  handler();
  assert.deepEqual(calls, ["compact"]);
});

test("_handleHashOnLoad is a no-op for unknown hash", () => {
  const opens = [];
  const calls = [];
  const { handler } = buildHandler({
    hash: "#something-else",
    panels: {
      analytics: { open: () => opens.push("a") },
      runHistory: { open: () => opens.push("r") },
      templateEditor: { open: () => opens.push("t") },
    },
    toggleCompactMode: () => calls.push("c"),
  });
  handler();
  assert.equal(opens.length, 0);
  assert.equal(calls.length, 0);
});

test("_handleHashOnLoad is a no-op for empty hash", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "",
    panels: { analytics: { open: () => opens.push("a") } },
  });
  handler();
  assert.equal(opens.length, 0);
});

test("_handleHashOnLoad survives missing panel modules (defensive)", () => {
  const { handler } = buildHandler({ hash: "#analytics", panels: {} });
  // No analytics module + no error — silent no-op.
  assert.doesNotThrow(() => handler());
});

test("_handleHashOnLoad case-insensitive: #ANALYTICS opens analytics panel too", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "#ANALYTICS",
    panels: { analytics: { open: () => opens.push("a") } },
  });
  handler();
  assert.deepEqual(opens, ["a"]);
});

test("_handleHashOnLoad strips ?query suffix before matching", () => {
  const opens = [];
  const { handler } = buildHandler({
    hash: "#run-history?from=dashboard",
    panels: { runHistory: { open: () => opens.push("rh") } },
  });
  handler();
  assert.deepEqual(opens, ["rh"]);
});
