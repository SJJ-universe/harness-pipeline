// Slice UI-Doc-Gov-a (Phase D Round UI-P, 2026-05-04) — sanity checks
// that `docs/visual-contract-governance.md` claims about catalog
// versions match the actual frozen lists in source.
//
// Why: the governance doc is the canonical README for visual
// contracts. If we add an axe custom rule but forget to update §7,
// the doc lies. This test catches that drift.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const DOC_PATH = path.resolve(
  __dirname, "..", "..", "docs", "visual-contract-governance.md",
);

const { ASSERTIONS } = require("../../scripts/visual-live/assertions");
const {
  A11Y_AXE_TAGS,
  A11Y_CUSTOM_RULES,
} = require("../../scripts/visual-live/a11y-rules");
const { BUTTONS } = require("../../scripts/visual-live/button-catalog");

function _readDoc() {
  return fs.readFileSync(DOC_PATH, "utf-8");
}

test("UI-Doc-Gov: governance doc exists at canonical path", () => {
  assert.ok(fs.existsSync(DOC_PATH), `expected doc at ${DOC_PATH}`);
});

test("UI-Doc-Gov: doc lists all 6 contract families with correct npm commands", () => {
  const doc = _readDoc();
  const required = [
    "npm run visual:check",
    "npm run visual:capture-live",
    "npm run visual:assert-live",
    "npm run visual:a11y-live",
    "npm run visual:button-live",
    // UI-Fuse: fused orchestrator
    "npm run visual:fused-live",
  ];
  for (const cmd of required) {
    assert.ok(doc.includes(cmd),
      `governance doc must mention "${cmd}" — it's a documented operator command`,
    );
  }
});

test("UI-Doc-Gov: doc lists all 6 manifest schemas (or baseline file path)", () => {
  const doc = _readDoc();
  const required = [
    "tests/visual/baseline-product-shell.json",
    "orchestrator-visual-live/v1",
    "orchestrator-visual-assert/v1",
    "orchestrator-visual-a11y/v1",
    "orchestrator-visual-button/v1",
    // UI-Fuse: top-level fused summary schema
    "orchestrator-visual-fused/v1",
  ];
  for (const schema of required) {
    assert.ok(doc.includes(schema),
      `governance doc must mention manifest schema/path "${schema}"`,
    );
  }
});

test("UI-Doc-Gov: §1 contract table mentions UI-Fuse as the orchestrator (not new schema)", () => {
  const doc = _readDoc();
  assert.match(doc, /UI-Fuse/,
    "doc must reference UI-Fuse as the 6th contract family");
  assert.match(doc, /orchestrator/,
    "doc must explicitly frame UI-Fuse as orchestrator (Contract 6 = 2-5 의 orchestrator)");
});

test("UI-Doc-Gov: §7 catalog version table matches actual frozen lists", () => {
  const doc = _readDoc();
  // Responsive assertions count
  const assertCount = ASSERTIONS.length;
  assert.ok(doc.includes(`${assertCount} rules`),
    `governance doc must echo "${assertCount} rules" for responsive assertions ` +
    `(scripts/visual-live/assertions.js)`,
  );
  // axe tags count
  assert.ok(doc.includes(`${A11Y_AXE_TAGS.length} (\`wcag2a\``),
    `governance doc must echo axe tag count (${A11Y_AXE_TAGS.length}) and at ` +
    `least the first tag in §7 catalog table`,
  );
  // custom rules count
  const customCount = A11Y_CUSTOM_RULES.length;
  assert.ok(doc.includes(`${customCount} (\`lang-matches-locale\``),
    `governance doc must echo custom rule count (${customCount}) + first ID`,
  );
  // Button count
  assert.ok(doc.includes(`${BUTTONS.length} entries`),
    `governance doc must echo button count (${BUTTONS.length}) in §7 table`,
  );
});

test("UI-Doc-Gov: §1 contract table includes all 4 manifest count claims", () => {
  const doc = _readDoc();
  // 6 frozen rules × 16 cells (UI-P11)
  assert.ok(/6 frozen rules/.test(doc) || /6 rules/.test(doc),
    "P11 row should mention 6 rules");
  // 13 buttons (UI-P13)
  assert.ok(doc.includes("13 buttons"),
    "P13 row should mention 13 buttons");
  // 4 routes × 4 viewports = 16 (UI-P10/P11/P12)
  assert.ok(doc.includes("4 routes × 4 viewports"),
    "common matrix description should appear");
});

test("UI-Doc-Gov: anti-patterns section is present + has at least 5 items", () => {
  const doc = _readDoc();
  // §4 anti-patterns
  assert.match(doc, /## 4\. Anti-patterns/,
    "doc must have a §4 Anti-patterns section");
  // Each subsection 4.1..4.5+
  for (const i of [1, 2, 3, 4, 5]) {
    assert.match(doc, new RegExp(`### 4\\.${i}`),
      `Anti-patterns §4.${i} must exist (5 documented anti-patterns minimum)`,
    );
  }
});

test("UI-Doc-Gov: decision tree section + CI policy section present", () => {
  const doc = _readDoc();
  assert.match(doc, /## 5\. Decision Tree/,
    "doc must include §5 Decision Tree");
  assert.match(doc, /## 6\. CI Policy/,
    "doc must include §6 CI Policy");
});

test("UI-Doc-Gov: doc explicitly states UI-P9 is the only PR-gating contract", () => {
  const doc = _readDoc();
  // UI-P9 is the structural snapshot — only one with CI gate ✅
  assert.ok(doc.includes("CI gate"),
    "doc must use the phrase 'CI gate' to identify gated contract");
  // Other 4 are manual-dispatch
  assert.match(doc, /workflow_dispatch/i,
    "doc must reference workflow_dispatch as the trigger for non-gated contracts");
});
