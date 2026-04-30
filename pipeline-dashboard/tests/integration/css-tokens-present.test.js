// Slice UI-H0 (Phase D / Phase E1.5, 2026-04-30) — CSS token presence test.
//
// Verifies that the design-token layer at public/css/harness-shell.css
// declares every `--hsh-*` token the UI-H sub-rounds consume. Catches
// regressions where someone removes a token but a panel still
// references it (the panel would silently fall back to hex defaults
// or render with no value, which is hard to spot in JSDOM-free tests).
//
// We DON'T parse CSS into an AST — that would over-fit. Instead we
// scan for `--hsh-<name>:` declarations + ensure every documented
// token name appears at least once. The spec doc
// `docs/ui-dashboard-design-notes.md` is the source-of-truth list.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const CSS_PATH = path.resolve(__dirname, "..", "..", "public", "css", "harness-shell.css");
const INDEX_PATH = path.resolve(__dirname, "..", "..", "public", "index.html");

function readCss() {
  return fs.readFileSync(CSS_PATH, "utf8");
}

function readIndexHtml() {
  return fs.readFileSync(INDEX_PATH, "utf8");
}

// ── 1. File presence + load order in index.html ─────────────────────

test("UI-H0: harness-shell.css is loaded by index.html BEFORE style.css", () => {
  const html = readIndexHtml();
  const hshIdx = html.indexOf('href="css/harness-shell.css"');
  const styleIdx = html.indexOf('href="style.css"');
  const monitorIdx = html.indexOf('href="style.monitor.css"');

  assert.notEqual(hshIdx, -1, "index.html must reference css/harness-shell.css");
  assert.notEqual(styleIdx, -1, "index.html must reference style.css (legacy)");
  assert.notEqual(monitorIdx, -1, "index.html must reference style.monitor.css");
  // Token layer loads first so subsequent stylesheets can consume `--hsh-*`.
  assert.ok(hshIdx < styleIdx,
    "harness-shell.css must load BEFORE style.css for cascade");
  assert.ok(hshIdx < monitorIdx,
    "harness-shell.css must load BEFORE style.monitor.css for cascade");
});

test("UI-H0: harness-shell.css file exists + non-empty", () => {
  assert.ok(fs.existsSync(CSS_PATH), "public/css/harness-shell.css must exist");
  const css = readCss();
  assert.ok(css.length > 1000, "harness-shell.css is suspiciously small");
});

// ── 2. Token presence — every declared token category ──────────────

const REQUIRED_TOKENS = {
  "Color (background)": [
    "--hsh-bg-base", "--hsh-bg-shell", "--hsh-bg-card",
    "--hsh-bg-rail", "--hsh-bg-elev", "--hsh-bg-input",
  ],
  "Color (text)": [
    "--hsh-text", "--hsh-text-dim", "--hsh-text-mute", "--hsh-text-faint",
  ],
  "Color (border)": [
    "--hsh-border", "--hsh-border-strong", "--hsh-border-hairline",
  ],
  "Color (accent)": [
    "--hsh-bronze", "--hsh-bronze-soft", "--hsh-bronze-faint",
    "--hsh-codex-blue", "--hsh-codex-soft",
  ],
  "Color (semantic)": [
    "--hsh-green-pass", "--hsh-red-danger", "--hsh-orange",
    "--hsh-yellow", "--hsh-purple",
  ],
  "Color (soft)": [
    "--hsh-green-soft", "--hsh-red-soft", "--hsh-orange-soft",
    "--hsh-yellow-soft", "--hsh-purple-soft",
  ],
  "Typography": [
    "--hsh-font-body", "--hsh-font-mono", "--hsh-font-serif",
  ],
  "Type scale": [
    "--hsh-fs-xs", "--hsh-fs-sm", "--hsh-fs-md",
    "--hsh-fs-base", "--hsh-fs-lg", "--hsh-fs-xl", "--hsh-fs-display",
  ],
  "Letter spacing": [
    "--hsh-ls-tight", "--hsh-ls-mono", "--hsh-ls-mono-wide",
  ],
  "Density": [
    "--hsh-radius-sm", "--hsh-radius", "--hsh-radius-md", "--hsh-radius-pill",
    "--hsh-space-1", "--hsh-space-2", "--hsh-space-3",
    "--hsh-space-4", "--hsh-space-5", "--hsh-space-6",
  ],
  "Border weights": [
    "--hsh-bw-hairline", "--hsh-bw-thin", "--hsh-bw-thick",
  ],
  "Shadows": [
    "--hsh-shadow-card", "--hsh-shadow-glow-bronze",
    "--hsh-shadow-glow-codex", "--hsh-shadow-horse",
  ],
  "Motion (durations + easing)": [
    "--hsh-ease-snap", "--hsh-ease-out",
    "--hsh-dur-fast", "--hsh-dur-base", "--hsh-dur-slow",
  ],
  "Motion (animations)": [
    "--hsh-anim-pulse", "--hsh-anim-slide",
    "--hsh-anim-caret", "--hsh-anim-rear-callout",
  ],
};

for (const [category, tokens] of Object.entries(REQUIRED_TOKENS)) {
  test(`UI-H0: ${category} tokens declared`, () => {
    const css = readCss();
    for (const tok of tokens) {
      // Match `--hsh-name:` (with optional whitespace before `:`)
      const re = new RegExp(`${tok.replace(/-/g, "\\-")}\\s*:`);
      assert.ok(re.test(css), `token ${tok} missing from harness-shell.css`);
    }
  });
}

// ── 3. Reduced-motion + public-sector posture overrides present ─────

test("UI-H0: prefers-reduced-motion media query present", () => {
  const css = readCss();
  assert.match(css, /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/,
    "reduced-motion media query missing");
});

test("UI-H0: data-posture='public-sector' override present", () => {
  const css = readCss();
  assert.match(css, /\[data-posture\s*=\s*["']public-sector["']\]/,
    "public-sector posture override missing");
});

test("UI-H0: reduced-motion + public-sector both override --hsh-anim-pulse to none", () => {
  const css = readCss();
  // Both blocks should contain `--hsh-anim-pulse: none`
  // Find every block where --hsh-anim-pulse is `none`, and ensure
  // we have at least 2 occurrences (one in @media, one in [data-posture]).
  const matches = css.match(/--hsh-anim-pulse\s*:\s*none/g) || [];
  assert.ok(matches.length >= 2,
    `expected --hsh-anim-pulse:none in BOTH @media + [data-posture] (got ${matches.length})`);
});

// ── 4. Keyframes declared ────────────────────────────────────────────

const REQUIRED_KEYFRAMES = ["hsh-pulse", "hsh-slide", "hsh-caret-blink", "hsh-rear-callout"];

test("UI-H0: every named animation has a matching @keyframes", () => {
  const css = readCss();
  for (const kf of REQUIRED_KEYFRAMES) {
    const re = new RegExp(`@keyframes\\s+${kf}\\b`);
    assert.ok(re.test(css), `@keyframes ${kf} missing`);
  }
});

// ── 5. Utility classes present ─────────────────────────────────────

const REQUIRED_UTIL_CLASSES = [
  ".hsh-card", ".hsh-card-title",
  ".hsh-pill", ".hsh-pill--bronze", ".hsh-pill--codex",
  ".hsh-pill--green", ".hsh-pill--red",
  ".hsh-pill__dot",
  ".hsh-mono", ".hsh-text-mute", ".hsh-text-dim",
  ".hsh-sr-only",
];

test("UI-H0: utility classes declared for panel adoption", () => {
  const css = readCss();
  for (const cls of REQUIRED_UTIL_CLASSES) {
    // CSS class declaration pattern: `.classname {` or `.classname,`
    // or `.classname:` (modifier). Just check the literal substring.
    assert.ok(css.includes(cls),
      `utility class ${cls} missing from harness-shell.css`);
  }
});

// ── 6. Negative pin: no Google Fonts import ────────────────────────

test("UI-H0: no Google Fonts import (no fonts.googleapis.com / fonts.gstatic.com)", () => {
  const css = readCss();
  assert.ok(!css.includes("fonts.googleapis.com"),
    "harness-shell.css must NOT import from fonts.googleapis.com");
  assert.ok(!css.includes("fonts.gstatic.com"),
    "harness-shell.css must NOT import from fonts.gstatic.com");
  assert.ok(!css.includes("@import"),
    "harness-shell.css must NOT use @import (CSP-friendly)");
  // Index.html: also no Google Fonts.
  const html = readIndexHtml();
  assert.ok(!html.includes("fonts.googleapis.com"),
    "index.html must NOT preconnect or link to fonts.googleapis.com");
  assert.ok(!html.includes("fonts.gstatic.com"),
    "index.html must NOT preconnect or link to fonts.gstatic.com");
});

// ── 7. Negative pin: system-font stack only ────────────────────────

test("UI-H0: --hsh-font-body stack starts with system-ui or -apple-system", () => {
  const css = readCss();
  // Extract the value of --hsh-font-body
  const match = css.match(/--hsh-font-body\s*:\s*([^;]+);/);
  assert.ok(match, "--hsh-font-body declaration not found");
  const value = match[1].trim();
  // Must start with a system-font primitive
  assert.ok(
    /^system-ui\b/.test(value) || /^-apple-system\b/.test(value),
    `--hsh-font-body should start with system-ui or -apple-system; got: ${value.slice(0, 80)}`,
  );
});
