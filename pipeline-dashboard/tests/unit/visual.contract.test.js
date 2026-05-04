// Slice UI-P9 (Phase 2 Round 3, 2026-04-30) — visual contract gate.
//
// CI-side guardrail that fails when the production UI shape drifts
// away from the committed baseline at
//   tests/visual/baseline-product-shell.json
//
// What "shape drift" means here:
//   - Mount removed from index.html (e.g., #product-shell-root)
//   - Stylesheet dropped from <link> chain
//   - Script load order reshuffled
//   - Design token deleted from style.product.css :root
//   - High-signal CSS class no longer compiled (e.g., .prod-shell)
//   - Legacy banner CSS class missing (UI-P8 surface)
//   - Per-panel region/card/slot vocabulary changes (e.g., a card
//     dropped from monitor-grid, a header slot renamed)
//
// What this gate does NOT catch (out of scope):
//   - Pixel-level rendering (no headless browser in this test)
//   - Animation timing
//   - Computed layout dimensions
//
// Refresh procedure (operator-driven):
//   1. Make the intentional UI change
//   2. Run `npm run visual:update` — writes the new baseline JSON
//   3. Review the JSON diff in your PR (line-friendly two-space
//      indent makes the change reviewable like code)
//   4. Commit BOTH the code change AND the baseline update together
//
// Sister gate: scripts/visual-baseline-update.js --check returns
// exit 1 when the disk baseline is stale relative to current state.
// CI runs it as part of `visual:check` (alongside this test) so
// drift surfaces twice — once via the JSON diff in this assertion,
// once via the staleness flag in the script gate.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { captureSnapshot } = require("../visual/capture");
const { diffSnapshot, formatDiff } = require("../visual/extract");

const BASELINE_PATH = path.resolve(
  __dirname, "..", "visual", "baseline-product-shell.json",
);

function _readBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, "utf-8");
  return JSON.parse(raw);
}

// ── Top-level gate ──────────────────────────────────────────────

test("UI-P9 visual contract: full snapshot matches baseline", () => {
  const baseline = _readBaseline();
  const actual = captureSnapshot();
  const diff = diffSnapshot(actual, baseline);
  if (diff.length > 0) {
    const message =
      "Visual contract drift detected — baseline at\n  " + BASELINE_PATH + "\n\n"
      + "Differences:\n" + formatDiff(diff) + "\n\n"
      + "If this change is intentional, refresh the baseline:\n"
      + "  npm run visual:update\n"
      + "and commit the JSON diff alongside the code change.\n"
      + "(See header comment in tests/unit/visual.contract.test.js " +
        "for full procedure.)";
    assert.fail(message);
  }
});

// ── Targeted contract assertions ────────────────────────────────
//
// These give cheaper / more focused failure messages than the full
// snapshot diff when a specific structural invariant breaks. They
// mirror invariants stated in docs/ui-reference-port-plan.md.

test("UI-P9 visual contract: product shell mount + load chain match", () => {
  const baseline = _readBaseline();
  const actual = captureSnapshot();
  assert.deepEqual(actual.indexHtml.mountIds, baseline.indexHtml.mountIds,
    "product index.html must declare exactly the documented mount IDs"
  );
  assert.deepEqual(actual.indexHtml.stylesheets, baseline.indexHtml.stylesheets,
    "product index.html stylesheet chain must match (UI-P1 single-stylesheet contract)"
  );
  assert.deepEqual(actual.indexHtml.scripts, baseline.indexHtml.scripts,
    "product index.html script load order must match (init sequencing matters)"
  );
});

test("UI-P9 visual contract: legacy view retains UI-P8 banner mount + script", () => {
  const baseline = _readBaseline();
  const actual = captureSnapshot();
  // Banner element is present
  assert.ok(
    actual.indexLegacyHtml.mountIds.indexOf("harness-legacy-banner") >= 0,
    "/?mode=legacy must mount the UI-P8 deprecation banner — operator " +
    "escape hatch needs the visible CTA to the product shell",
  );
  // legacy-banner.js is loaded
  assert.ok(
    actual.indexLegacyHtml.scripts.indexOf("js/legacy-banner.js") >= 0,
    "legacy view must load legacy-banner.js (dismiss controller)",
  );
  // No regression in stylesheet chain
  assert.deepEqual(actual.indexLegacyHtml.stylesheets, baseline.indexLegacyHtml.stylesheets);
});

test("UI-P9 visual contract: design tokens (--prod-*) all present", () => {
  const baseline = _readBaseline();
  const actual = captureSnapshot();
  const missing = baseline.productCssTokens
    .filter((t) => actual.productCssTokens.indexOf(t) < 0);
  const added = actual.productCssTokens
    .filter((t) => baseline.productCssTokens.indexOf(t) < 0);
  assert.deepEqual(missing, [],
    "design tokens must not be removed without a baseline update — " +
    "missing: " + JSON.stringify(missing),
  );
  // Added tokens are non-fatal (they signal "new design token landed");
  // they still need a baseline refresh so the operator notices in PR.
  if (added.length > 0) {
    assert.deepEqual(added, [],
      "new design tokens detected — refresh baseline via " +
      "`npm run visual:update`. New tokens: " + JSON.stringify(added),
    );
  }
});

test("UI-P9 visual contract: high-signal product CSS classes compile in style.product.css", () => {
  const actual = captureSnapshot();
  const c = actual.productCssClasses;
  // Each class MUST appear at least once in compiled CSS — zero count
  // means the class was removed (visual breaks immediately).
  for (const cls of Object.keys(c)) {
    assert.ok(c[cls] > 0,
      `class .${cls} must appear at least once in style.product.css — ` +
      `current count: ${c[cls]} (UI-P1/P2 layout class deleted?)`,
    );
  }
});

test("UI-P9 visual contract: UI-P8 legacy-banner CSS classes compile in style.css", () => {
  const actual = captureSnapshot();
  const c = actual.legacyBannerCss;
  for (const cls of Object.keys(c)) {
    assert.ok(c[cls] > 0,
      `class .${cls} must appear at least once in style.css — ` +
      `UI-P8 banner styling deleted?`,
    );
  }
});

test("UI-P9 visual contract: every product panel renders the documented region/slot vocabulary", () => {
  const baseline = _readBaseline();
  const actual = captureSnapshot();
  const expectedPanels = ["header", "harness-track", "pipeline-rail",
                          "monitor-grid", "dual-terminals", "shell"];
  for (const name of expectedPanels) {
    assert.ok(actual.panels[name],
      `panel "${name}" must render — capture missing`);
    const panelDiff = diffSnapshot(actual.panels[name], baseline.panels[name]);
    if (panelDiff.length > 0) {
      assert.fail(
        "Panel \"" + name + "\" drift:\n" + formatDiff(panelDiff) + "\n\n"
        + "Refresh via `npm run visual:update` if intentional.",
      );
    }
  }
});

test("UI-P9 visual contract: monitor-grid renders 7 documented cards", () => {
  const actual = captureSnapshot();
  assert.deepEqual(
    actual.panels["monitor-grid"].cards.slice().sort(),
    ["codex-live", "critique", "findings", "subagents", "tools", "verify"]
      .concat(["context"]).sort(),
    "monitor-grid must render the 7 cards documented in " +
    "ui-reference-port-plan.md §4 reference layout"
  );
});

test("UI-P9 visual contract: harness-track has 7 lanes + 3 gate markers", () => {
  const actual = captureSnapshot();
  assert.deepEqual(actual.panels["harness-track"].laneIndices, [0, 1, 2, 3, 4, 5, 6],
    "track must render exactly 7 lanes (PLAN ─ DONE)");
  assert.equal(actual.panels["harness-track"].gateLanes, 3,
    "track must mark exactly 3 lanes as gates (CRITIQUE / RE-CHECK / VERIFY)");
});

test("UI-P9 visual contract: shell skeleton mounts 5 region slots", () => {
  const actual = captureSnapshot();
  const required = ["header", "harness-track", "workspace",
                    "pipeline-rail", "monitor-stack",
                    "monitor-grid", "dual-terminals"];
  for (const slot of required) {
    assert.ok(actual.panels.shell.regionMounts.indexOf(slot) >= 0,
      `shell skeleton must declare data-region-mount="${slot}"`);
  }
});
