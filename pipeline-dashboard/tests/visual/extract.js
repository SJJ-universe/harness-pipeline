// Slice UI-P9 (Phase 2 Round 3, 2026-04-30) — visual contract extract.
//
// Pure helpers that turn HTML / CSS / a rendered DOM-stub tree into a
// structured snapshot suitable for JSON diffing against a committed
// baseline. The "visual" gate is structural — it catches drift in
// the SHAPE that produces the visual (mounts, region vocabulary,
// design tokens) without booting a browser.
//
// Why a snapshot harness vs. Playwright:
//   - CI-friendly: no browser binaries, no native build, no cache tier
//   - Fast: pure HTML/CSS regex + existing DOM stub walk
//   - Deterministic: zero flake from font rendering / GPU / antialiasing
//   - Operator-friendly: `npm run visual:update` rewrites the baseline
//     when the change is intentional; review the JSON diff in the PR
//
// What this catches:
//   - Region/mount removal (e.g., #product-shell-root deleted)
//   - Design token deletion (e.g., --prod-bronze removed from :root)
//   - Script load order regression (broken init sequence)
//   - Stylesheet removal (UI-P8 banner CSS dropped accidentally)
//   - Per-panel region/card/slot vocabulary drift
//
// What this does NOT catch (would need real browser):
//   - Font rendering, antialiasing
//   - Computed layout pixels
//   - Animation timing
//   - Image diff (sprite changes)
//
// Per UI-P0 §239 + §S sign-off: "Visual regression gate — Playwright
// or screenshot harness, CI gate against reference baseline." This
// implementation lands the structural half; pixel comparison is a
// follow-up if the operator opts in to a separate Playwright job.

"use strict";

// ── HTML extract ─────────────────────────────────────────────────

/**
 * Parse a simple top-level HTML document into a stable shape. The
 * regex-based extraction is intentional — we want to fail loudly on
 * structural drift, NOT silently re-interpret malformed markup.
 *
 * @param {string} html - raw HTML source
 * @returns {{
 *   lang: string|null,
 *   title: string|null,
 *   stylesheets: string[],
 *   scripts: string[],
 *   inlineScriptCount: number,
 *   mountIds: string[],
 *   dataRegions: string[],
 *   metaCharset: string|null,
 * }}
 */
function extractHtmlShape(html) {
  if (typeof html !== "string") {
    throw new Error("extractHtmlShape: html must be a string");
  }
  // Strip HTML comments first so `<script>` mentions inside them don't
  // pollute the inline-script count or the script src list. Operators
  // freely document the script load order in comments above the real
  // tags; that text shouldn't show up as a "script".
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");
  const langMatch = stripped.match(/<html[^>]*\blang="([^"]+)"/i);
  const titleMatch = stripped.match(/<title>([\s\S]*?)<\/title>/i);
  const charsetMatch = stripped.match(/<meta\s+charset="([^"]+)"/i);
  // Stylesheets — both relative + absolute (for CDN entries)
  const stylesheets = Array.from(
    stripped.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
  ).map((m) => m[1]);
  // Scripts with src + count of inline scripts (script with no src)
  const scripts = Array.from(
    stripped.matchAll(/<script[^>]+src="([^"]+)"/g),
  ).map((m) => m[1]);
  const inlineScriptCount = (stripped.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []).length;
  // Element id="..." — limit to top-level mounts (heuristic: any id
  // attribute since the legacy + product files only declare mounts +
  // utility nodes). The baseline filters to a known list at diff time.
  const mountIds = Array.from(
    stripped.matchAll(/\bid="([^"]+)"/g),
  ).map((m) => m[1]);
  // data-region attributes (product shell signal)
  const dataRegions = Array.from(
    stripped.matchAll(/\bdata-region="([^"]+)"/g),
  ).map((m) => m[1]);
  return {
    lang: langMatch ? langMatch[1] : null,
    title: titleMatch ? titleMatch[1].trim() : null,
    metaCharset: charsetMatch ? charsetMatch[1] : null,
    stylesheets: stylesheets,
    scripts: scripts,
    inlineScriptCount: inlineScriptCount,
    mountIds: _uniqueSorted(mountIds),
    dataRegions: _uniqueSorted(dataRegions),
  };
}

// ── CSS extract ──────────────────────────────────────────────────

/**
 * Extract sorted custom-property NAMES from the first :root { ... }
 * block. We snapshot names only — value drift (e.g., bronze tweak)
 * is permitted; missing names is the failure signal.
 *
 * @param {string} css
 * @param {string} prefix - e.g., "--prod-" to scope to the product
 *                          shell tokens
 * @returns {string[]} sorted unique token names
 */
function extractCssTokens(css, prefix) {
  if (typeof css !== "string") {
    throw new Error("extractCssTokens: css must be a string");
  }
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!rootMatch) return [];
  const body = rootMatch[1];
  const re = new RegExp("(" + _escape(prefix || "--") + "[\\w-]+)\\s*:", "g");
  const names = Array.from(body.matchAll(re)).map((m) => m[1]);
  return _uniqueSorted(names);
}

/**
 * Count occurrences of a CSS class in the stylesheet (top-level
 * selector match, not inside comments). Used to verify high-signal
 * selectors weren't deleted (e.g., .prod-shell, .legacy-banner-cta).
 *
 * @param {string} css
 * @param {string[]} classes - class names WITHOUT the leading dot
 * @returns {Object<string, number>}
 */
function countCssClasses(css, classes) {
  // Strip block comments first so commented-out selectors don't count.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = {};
  for (const cls of classes) {
    const re = new RegExp("\\." + _escape(cls) + "\\b", "g");
    out[cls] = (stripped.match(re) || []).length;
  }
  return out;
}

// ── Panel render extract ─────────────────────────────────────────

/**
 * Walk a DOM-stub root that a panel rendered into and produce a
 * structural snapshot. Designed for the slot-contract DOM stub
 * shape (children array + attributes object + classList).
 *
 * @param {object} root - stub element with .children, .attributes
 * @returns {{
 *   regions: string[],
 *   regionMounts: string[],
 *   cards: string[],
 *   headerSlots: string[],
 *   trackSlots: string[],
 *   railSlots: string[],
 *   actionsSlots: string[],
 *   indicators: string[],
 *   actions: string[],
 *   tabs: string[],
 *   tiers: string[],
 *   tools: string[],
 *   modes: string[],
 *   laneIndices: number[],
 *   gateLanes: number,
 *   proOnlyCount: number,
 * }}
 */
function extractPanelShape(root) {
  const out = {
    regions:        _uniqueSorted(_collectAttr(root, "data-region")),
    regionMounts:   _uniqueSorted(_collectAttr(root, "data-region-mount")),
    cards:          _uniqueSorted(_collectAttr(root, "data-card")),
    headerSlots:    _uniqueSorted(_collectAttr(root, "data-header-slot")),
    trackSlots:     _uniqueSorted(_collectAttr(root, "data-track-slot")),
    railSlots:      _uniqueSorted(_collectAttr(root, "data-rail-slot")),
    actionsSlots:   _uniqueSorted(_collectAttr(root, "data-actions-slot")),
    indicators:     _uniqueSorted(_collectAttr(root, "data-indicator")),
    actions:        _uniqueSorted(_collectAttr(root, "data-action")),
    tabs:           _uniqueSorted(_collectAttr(root, "data-tab")),
    tiers:          _uniqueSorted(_collectAttr(root, "data-tier")),
    tools:          _uniqueSorted(_collectAttr(root, "data-tool")),
    modes:          _uniqueSorted(_collectAttr(root, "data-mode")),
    laneIndices:    _collectAttr(root, "data-lane-index").map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b),
    gateLanes:      _collectAttr(root, "data-gate").filter((v) => v === "true").length,
    proOnlyCount:   _collectAttr(root, "data-pro-only").filter((v) => v === "true").length,
  };
  return out;
}

// ── Snapshot diff ────────────────────────────────────────────────

/**
 * Compare two snapshot objects and return a list of human-readable
 * differences. Each entry is { path, kind, expected, actual }.
 * Kinds: "missing" (path absent in actual), "added" (path absent in
 * expected), "changed" (different value).
 *
 * The diff is deep but value-shallow — it doesn't try to align
 * arrays element-by-element, just compares them as JSON-stringified
 * scalars at each path.
 */
function diffSnapshot(actual, expected, pathPrefix) {
  const out = [];
  const prefix = pathPrefix || "";
  if (_isPlainObject(expected) && _isPlainObject(actual)) {
    const keys = _uniqueSorted(Object.keys(actual).concat(Object.keys(expected)));
    for (const k of keys) {
      const subPath = prefix ? prefix + "." + k : k;
      const a = actual[k];
      const e = expected[k];
      if (!(k in expected)) {
        out.push({ path: subPath, kind: "added", expected: undefined, actual: a });
      } else if (!(k in actual)) {
        out.push({ path: subPath, kind: "missing", expected: e, actual: undefined });
      } else {
        out.push.apply(out, diffSnapshot(a, e, subPath));
      }
    }
  } else if (Array.isArray(expected) && Array.isArray(actual)) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      out.push({ path: prefix, kind: "changed", expected: expected, actual: actual });
    }
  } else if (actual !== expected) {
    out.push({ path: prefix, kind: "changed", expected: expected, actual: actual });
  }
  return out;
}

/** Format diff entries as a multi-line block for assertion messages. */
function formatDiff(diff) {
  if (!Array.isArray(diff) || diff.length === 0) return "";
  return diff.map(function (d) {
    const e = JSON.stringify(d.expected);
    const a = JSON.stringify(d.actual);
    return "  • " + d.path + " [" + d.kind + "]\n"
      + "      expected: " + e + "\n"
      + "      actual:   " + a;
  }).join("\n");
}

// ── Internal helpers ─────────────────────────────────────────────

function _uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort();
}

function _collectAttr(root, attrName) {
  const out = [];
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (node.attributes && Object.prototype.hasOwnProperty.call(node.attributes, attrName)) {
      out.push(node.attributes[attrName]);
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) walk(c);
    }
  }
  walk(root);
  return out;
}

function _isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function _escape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  extractHtmlShape,
  extractCssTokens,
  countCssClasses,
  extractPanelShape,
  diffSnapshot,
  formatDiff,
};
