// Slice MA3 (Phase D, 2026-04-27) — index.html wiring anchor.
//
// Pure source-grep test: confirms public/index.html declares the monitor
// shell mount point, loads the right UMD modules, and contains the
// opt-in init script. This complements the unit tests for layout.js +
// global-bar.js by ensuring the HTML side stays wired up to them.
//
// We avoid asserting the exact line numbers — only the presence of the
// anchor strings and their relative ordering, so future cosmetic edits
// to surrounding markup don't break the test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(
  path.join(__dirname, "../../public/index.html"),
  "utf-8"
);

test("index.html links the monitor stylesheet", () => {
  assert.match(HTML, /<link rel="stylesheet" href="style\.monitor\.css"/);
});

test("index.html declares the monitor-shell-root mount point hidden by default", () => {
  // hidden attribute matters — without it, the empty div would still
  // collapse but a future CSS rule could accidentally show it.
  assert.match(
    HTML,
    /<div\s+id="monitor-shell-root"[^>]*\bhidden\b[^>]*><\/div>/
  );
});

test("index.html loads all monitor UMD modules", () => {
  // MA3 set: store/normalizer/hydrate/global-bar/layout.
  // MA4 added: panels/run-tree + panels/run-summary.
  // MA5 added: panels/timeline + panels/inspector + panels/bottom-dock.
  const required = [
    "js/monitor/store.js",
    "js/monitor/normalizer.js",
    "js/monitor/hydrate.js",
    "js/monitor/panels/global-bar.js",
    "js/monitor/panels/run-tree.js",
    "js/monitor/panels/run-summary.js",
    "js/monitor/panels/timeline.js",
    "js/monitor/panels/inspector.js",
    "js/monitor/panels/bottom-dock.js",
    "js/monitor/layout.js",
  ];
  for (const src of required) {
    assert.match(HTML, new RegExp(`<script src="${src.replace(/\//g, "\\/")}"`), `script tag for ${src}`);
  }
});

test("MA4 panels load BEFORE layout.js (so layout.js can resolve them)", () => {
  const runTreeIdx = HTML.indexOf("<script src=\"js/monitor/panels/run-tree.js\"></script>");
  const runSummaryIdx = HTML.indexOf("<script src=\"js/monitor/panels/run-summary.js\"></script>");
  const layoutIdx = HTML.indexOf("<script src=\"js/monitor/layout.js\"></script>");
  assert.ok(runTreeIdx > -1 && runSummaryIdx > -1 && layoutIdx > -1);
  assert.ok(runTreeIdx < layoutIdx, "run-tree must load before layout");
  assert.ok(runSummaryIdx < layoutIdx, "run-summary must load before layout");
});

test("MA5 panels load BEFORE layout.js (so layout.js can resolve them)", () => {
  const timelineIdx = HTML.indexOf("<script src=\"js/monitor/panels/timeline.js\"></script>");
  const inspectorIdx = HTML.indexOf("<script src=\"js/monitor/panels/inspector.js\"></script>");
  const dockIdx = HTML.indexOf("<script src=\"js/monitor/panels/bottom-dock.js\"></script>");
  const layoutIdx = HTML.indexOf("<script src=\"js/monitor/layout.js\"></script>");
  assert.ok(timelineIdx > -1 && inspectorIdx > -1 && dockIdx > -1 && layoutIdx > -1);
  assert.ok(timelineIdx < layoutIdx, "timeline must load before layout");
  assert.ok(inspectorIdx < layoutIdx, "inspector must load before layout");
  assert.ok(dockIdx < layoutIdx, "bottom-dock must load before layout");
});

test("monitor scripts load AFTER app.js so they don't race the legacy mount", () => {
  const appIdx = HTML.indexOf("<script src=\"app.js\"></script>");
  const storeIdx = HTML.indexOf("<script src=\"js/monitor/store.js\"></script>");
  const layoutIdx = HTML.indexOf("<script src=\"js/monitor/layout.js\"></script>");
  assert.ok(appIdx > -1 && storeIdx > -1 && layoutIdx > -1);
  assert.ok(storeIdx > appIdx, "monitor/store.js must load after app.js");
  assert.ok(layoutIdx > storeIdx, "monitor/layout.js must load after monitor/store.js");
});

test("index.html contains the opt-in init script (inline, auto-nonced by indexRenderer)", () => {
  // Look for the recognisable opt-in flags inside an inline <script>.
  // We don't pin the exact wording — just that BOTH gates are present.
  const initBlock = HTML.match(/<script>[\s\S]*?monitor-shell-root[\s\S]*?<\/script>/);
  assert.ok(initBlock, "inline init script with monitor-shell-root reference");
  assert.match(initBlock[0], /\?monitor=1|monitor.*=.*"1"|searchParams\.get\("monitor"\)/);
  assert.match(initBlock[0], /harnessMonitor/, "localStorage gate present");
  assert.match(initBlock[0], /HarnessMonitorLayout/, "init calls into the layout module");
});

test("init script bails out cleanly when neither opt-in flag is set", () => {
  // Behaviour-preserving guarantee: no opt-in → no DOM mutation, no
  // fetch, no thrown error. The simplest static check is that the init
  // script has an early-return when both gates are false.
  const initBlock = HTML.match(/<script>[\s\S]*?monitor-shell-root[\s\S]*?<\/script>/);
  assert.ok(initBlock);
  // Look for the if (!qsOptIn && !lsOptIn) return; pattern (whitespace
  // tolerant).
  assert.match(initBlock[0], /if\s*\(\s*!qsOptIn\s*&&\s*!lsOptIn\s*\)\s*return/);
});

test("monitor shell root keeps Slice MA3 traceability tag", () => {
  assert.match(HTML, /Slice MA3/);
});
