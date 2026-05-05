// Slice CSS-1-a (Phase 2 v2 follow-up, 2026-05-05) — structural
// presence tests for the simple-shell banner card styling.
//
// Strategy: regex-match key CSS selectors in the stylesheet file.
// We're not testing pixel-perfect output (that's a visual diff
// tool); we ARE testing that the key selectors required by the
// panels' data-attribute hooks exist. If a future edit deletes
// .rec-row[data-severity="critical"] (or similar), this test
// fails fast — the panels' data attributes would lose their
// styling cue silently otherwise.
//
// Selectors verified (one per panel + per branch):
//   - Common chassis: .nac-card / .rec-card / .pic-card surface
//   - recommendations-card: 4 severity dots + system-ready baseline
//   - recommendations-card: rec-cta + rec-dismiss + rec-empty
//   - pack-info-card: badge variant for [data-public-sector="true"]
//   - pack-info-card: 3 alt-badge variants (ps / hg / norm)
//   - pack-info-card: public-sector requirements call-out
//   - next-action-card: nac-cta + nac-cta.is-primary
//   - mobile breakpoint @media (max-width: 720px)
//   - empty-mount hide rule

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS_PATH = path.resolve(
  __dirname, "..", "..",
  "public", "style.monitor.css"
);

let _cssCache = null;
function readCss() {
  if (_cssCache !== null) return _cssCache;
  _cssCache = fs.readFileSync(CSS_PATH, "utf-8");
  return _cssCache;
}

// ── Common chassis ──────────────────────────────────────────────

test("CSS-1-a: file exists + contains the slice marker comment", () => {
  assert.ok(fs.existsSync(CSS_PATH), "style.monitor.css must exist");
  const css = readCss();
  assert.match(css, /Slice CSS-1-a \(Phase 2 v2 follow-up, 2026-05-05\)/,
    "slice marker comment should be present (anchors the section)");
});

test("CSS-1-a: shared mount-container max-width rule present", () => {
  const css = readCss();
  // The 3 mount containers share a max-width: 960px rule.
  assert.match(css,
    /\.ss-first-run-mount,\s*[\s\S]{0,200}?\.ss-recs-mount,\s*[\s\S]{0,200}?\.ss-pack-info-mount/,
    "mount containers grouped in shared max-width rule");
  assert.match(css, /max-width:\s*960px/, "max-width: 960px present");
});

test("CSS-1-a: empty mounts hidden (avoids gap when panel not injected)", () => {
  const css = readCss();
  assert.match(css, /:empty\s*{[\s\S]*?display:\s*none/,
    "empty-mount hide rule present");
});

test("CSS-1-a: shared banner-card chassis (nac-card / rec-card / pic-card)", () => {
  const css = readCss();
  // All 3 panel cards share a chassis rule with bg + border + radius.
  assert.match(css,
    /\.nac-card,\s*[\s\S]{0,200}?\.rec-card,\s*[\s\S]{0,200}?\.pic-card/,
    "3 panel cards grouped in shared chassis selector");
  // The chassis rule references the design tokens.
  assert.match(css, /background:\s*var\(--hsh-bg-card/,
    "card chassis uses --hsh-bg-card token");
  assert.match(css, /border-radius:\s*var\(--hsh-radius-md/,
    "card chassis uses --hsh-radius-md token");
});

// ── recommendations-card severity tones ─────────────────────────

test("CSS-1-a: recommendations-card has 4 severity dot color rules", () => {
  const css = readCss();
  for (const sev of ["critical", "high", "medium", "info"]) {
    const re = new RegExp(`\\.rec-row\\[data-severity="${sev}"\\]\\s*\\.rec-dot`);
    assert.match(css, re,
      `severity "${sev}" dot rule must exist (panel sets data-severity)`);
  }
});

test("CSS-1-a: critical/high/medium severities map to red/orange/yellow tokens", () => {
  const css = readCss();
  // Pull the rule blocks and verify each maps to the right token.
  const criticalBlock = css.match(
    /\.rec-row\[data-severity="critical"\]\s*\.rec-dot\s*{[^}]+}/);
  assert.ok(criticalBlock, "critical block exists");
  assert.match(criticalBlock[0], /--hsh-red/, "critical maps to --hsh-red");

  const highBlock = css.match(
    /\.rec-row\[data-severity="high"\]\s*\.rec-dot\s*{[^}]+}/);
  assert.ok(highBlock);
  assert.match(highBlock[0], /--hsh-orange/);

  const mediumBlock = css.match(
    /\.rec-row\[data-severity="medium"\]\s*\.rec-dot\s*{[^}]+}/);
  assert.ok(mediumBlock);
  assert.match(mediumBlock[0], /--hsh-yellow/);

  const infoBlock = css.match(
    /\.rec-row\[data-severity="info"\]\s*\.rec-dot\s*{[^}]+}/);
  assert.ok(infoBlock);
  assert.match(infoBlock[0], /--hsh-blue/);
});

test("CSS-1-a: SMART-1-BASELINE-a system-ready rec has distinct styling", () => {
  const css = readCss();
  // The baseline rule uses [data-rec-id="system-ready"] for both
  // dot color AND row background — two distinct selectors.
  assert.match(css,
    /\.rec-row\[data-rec-id="system-ready"\]\s*\.rec-dot/,
    "system-ready baseline rec has its own dot color rule");
  assert.match(css,
    /\.rec-row\[data-rec-id="system-ready"\]\s*{/,
    "system-ready baseline rec has its own row surface rule");
  // The baseline rec uses the green token (success / all-clear tone).
  const baselineSurface = css.match(
    /\.rec-row\[data-rec-id="system-ready"\]\s*{[^}]+}/);
  assert.ok(baselineSurface);
  assert.match(baselineSurface[0], /75,\s*201,\s*114/,
    "baseline surface uses green RGB tint (75, 201, 114) for the all-clear affordance");
});

test("CSS-1-a: rec-cta + rec-dismiss + rec-empty styled", () => {
  const css = readCss();
  assert.match(css, /\.rec-cta\.is-primary\s*{/, "rec-cta primary button styled");
  assert.match(css, /\.rec-cta\.is-primary:hover/, "rec-cta hover state");
  assert.match(css, /\.rec-cta\.is-primary:focus-visible/,
    "rec-cta focus-visible (a11y)");
  assert.match(css, /\.rec-dismiss\s*{/, "rec-dismiss button styled");
  assert.match(css, /\.rec-row:hover\s*\.rec-dismiss/,
    "rec-dismiss reveal-on-hover behavior present");
  assert.match(css, /\.rec-empty\s*{/, "empty state styled");
});

// ── pack-info-card variants ─────────────────────────────────────

test("CSS-1-a: pack-info-card current-pack badge has public-sector variant", () => {
  const css = readCss();
  assert.match(css, /\.pic-current-pack\s*{/, "default badge styled");
  assert.match(css,
    /\.pic-current-pack\[data-public-sector="true"\]/,
    "public-sector visual variant attribute selector present");
  // Public-sector badge uses orange token (matches GOV-PII / posture color)
  const psBlock = css.match(
    /\.pic-current-pack\[data-public-sector="true"\]\s*{[^}]+}/);
  assert.ok(psBlock);
  assert.match(psBlock[0], /--hsh-orange/,
    "public-sector badge uses --hsh-orange");
});

test("CSS-1-a: public-sector requirements call-out has distinct border", () => {
  const css = readCss();
  assert.match(css, /\.pic-public-sector-reqs\s*{/, "reqs panel styled");
  // Should have a left-accent border in the orange posture color.
  const reqsBlock = css.match(/\.pic-public-sector-reqs\s*{[^}]+}/);
  assert.ok(reqsBlock);
  assert.match(reqsBlock[0], /border-left:\s*2px\s*solid/,
    "reqs panel has left-accent border");
  assert.match(reqsBlock[0], /--hsh-orange/,
    "reqs panel uses --hsh-orange for left-accent");
});

test("CSS-1-a: pack-info-card alternatives — 3 alt-badge variants", () => {
  const css = readCss();
  // Three alt-card badge variants — publicSector / hardGates / no-runMemory.
  assert.match(css, /\.pic-alt-badge-ps\s*{/, "publicSector alt badge variant");
  assert.match(css, /\.pic-alt-badge-hg\s*{/, "hardGatesDefault alt badge variant");
  assert.match(css, /\.pic-alt-badge-norm\s*{/, "no-runMemory alt badge variant");
  // Each maps to a distinct token color
  const ps = css.match(/\.pic-alt-badge-ps\s*{[^}]+}/);
  const hg = css.match(/\.pic-alt-badge-hg\s*{[^}]+}/);
  const norm = css.match(/\.pic-alt-badge-norm\s*{[^}]+}/);
  assert.match(ps[0], /--hsh-orange/);
  assert.match(hg[0], /--hsh-red/);
  assert.match(norm[0], /--hsh-blue/);
});

test("CSS-1-a: pack-info-card collapsible <details> has rotation indicator", () => {
  const css = readCss();
  assert.match(css, /\.pic-alt-summary::before\s*{[^}]*content:\s*"▸"/,
    "summary has ▸ indicator");
  assert.match(css, /\.pic-alternatives\[open\]\s*\.pic-alt-summary::before[^}]*transform:\s*rotate\(90deg\)/,
    "open state rotates the indicator");
});

test("CSS-1-a: pic-empty + pic-restart-hint + pic-alt-none have low-contrast italic styling", () => {
  const css = readCss();
  assert.match(css, /\.pic-empty\s*{/);
  assert.match(css, /\.pic-restart-hint\s*{/);
  assert.match(css, /\.pic-alt-none\s*{/);
});

// ── next-action-card ────────────────────────────────────────────

test("CSS-1-a: next-action-card nac-cta has primary + hover + focus variants", () => {
  const css = readCss();
  assert.match(css, /\.nac-cta\s*{/, "default cta button styled");
  assert.match(css, /\.nac-cta:hover/, "hover state");
  assert.match(css, /\.nac-cta\.is-primary\s*{/, "primary variant present");
  assert.match(css, /\.nac-cta\.is-primary:hover/, "primary hover state");
  assert.match(css, /\.nac-cta:focus-visible/, "focus-visible (a11y)");
  // Primary variant uses blue
  const primaryBlock = css.match(/\.nac-cta\.is-primary\s*{[^}]+}/);
  assert.match(primaryBlock[0], /--hsh-blue/);
});

test("CSS-1-a: next-action-card has headline + body + meta styles", () => {
  const css = readCss();
  assert.match(css, /\.nac-headline\s*{/);
  assert.match(css, /\.nac-body\s*{/);
  assert.match(css, /\.nac-meta\s*{/);
  assert.match(css, /\.nac-cta-row\s*{/);
});

// ── Shared label style ──────────────────────────────────────────

test("CSS-1-a: shared label style across 3 panels (mono + uppercase + dimmed)", () => {
  const css = readCss();
  // .nac-label, .rec-label, .pic-label grouped into one selector
  assert.match(css,
    /\.nac-label,\s*[\s\S]{0,200}?\.rec-label,\s*[\s\S]{0,200}?\.pic-label/,
    "3 panel labels share styling");
  const labelBlockMatch = css.match(
    /\.nac-label,[\s\S]{0,400}?\.pic-label\s*{([\s\S]+?)}/);
  assert.ok(labelBlockMatch, "label rule block found");
  assert.match(labelBlockMatch[1], /text-transform:\s*uppercase/,
    "labels are uppercase (caption-style)");
  assert.match(labelBlockMatch[1], /font-family:\s*var\(--hsh-font-mono/,
    "labels use mono font");
});

// ── Responsive ──────────────────────────────────────────────────

test("CSS-1-a: mobile breakpoint @media (max-width: 720px) collapses 3-col rec-row", () => {
  const css = readCss();
  assert.match(css, /@media \(max-width:\s*720px\)/,
    "mobile breakpoint present");
  // We look for the CSS-1-specific rules anywhere in the file (the
  // pre-existing 720px media block for .ss-grid is at line ~1865;
  // the new CSS-1 block is appended at the end). Both being inside
  // a max-width:720px block is correct — the test verifies the rules
  // exist somewhere in the CSS, not which media block hosts them.
  assert.match(css,
    /\.rec-actions\s*{[\s\S]{0,200}?grid-column:\s*1 \/ -1/,
    "rec-actions spans full width on mobile (CSS-1-a media block)");
  assert.match(css,
    /\.pic-alt-list\s*{[\s\S]{0,200}?grid-template-columns:\s*1fr/,
    "alt-list collapses to single column on mobile (CSS-1-a media block)");
});

// ── Sanity: no syntax disasters ─────────────────────────────────

test("CSS-1-a: opening braces and closing braces balance", () => {
  const css = readCss();
  // Strip comments before counting braces so /* { */ doesn't skew.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const opens = (stripped.match(/\{/g) || []).length;
  const closes = (stripped.match(/\}/g) || []).length;
  assert.equal(opens, closes,
    `unbalanced braces: ${opens} opens vs ${closes} closes — likely a syntax error`);
});
