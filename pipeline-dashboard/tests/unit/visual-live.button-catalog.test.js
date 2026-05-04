// Slice UI-P13-a (Phase D Round UI-P, 2026-05-04) — button-catalog
// shape contract + verdict aggregation tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cat = require("../../scripts/visual-live/button-catalog");
const {
  BUTTONS,
  summarizeButtonResult,
  _evalStaticButtonState,
  MIN_DOM_MUTATIONS,
  MIN_NETWORK_REQUESTS,
  FAILS_ON_CONSOLE_ERROR,
} = cat;

// ── Frozen catalog shape ─────────────────────────────────────────

test("UI-P13 BUTTONS: frozen + 13 entries", () => {
  assert.ok(Object.isFrozen(BUTTONS),
    "BUTTONS must be frozen — adding/removing changes manifest schema",
  );
  assert.equal(BUTTONS.length, 13,
    "expected 13 documented buttons " +
    "(2 mode + 2 locale + 3 pro-actions + 1 shutdown + 5 dual-terminal)",
  );
});

test("UI-P13 BUTTONS: each entry frozen + required fields", () => {
  const REQUIRED = ["id", "label", "selector", "appliesTo", "clickSafe", "notes"];
  for (const b of BUTTONS) {
    assert.ok(Object.isFrozen(b), `button ${b.id} must be frozen`);
    for (const field of REQUIRED) {
      assert.ok(field in b, `button ${b.id} missing field "${field}"`);
    }
    assert.equal(typeof b.id, "string");
    assert.match(b.id, /^[a-z0-9-]+$/, `button id ${b.id} must be kebab-case`);
    assert.equal(typeof b.selector, "string");
    assert.ok(b.selector.length > 0);
    assert.equal(typeof b.appliesTo, "function");
    assert.equal(typeof b.clickSafe, "boolean");
  }
});

test("UI-P13 BUTTONS: clickSafe=true entries declare expectedActivity", () => {
  for (const b of BUTTONS) {
    if (b.clickSafe) {
      assert.ok(typeof b.expectedActivity === "string" && b.expectedActivity.length > 0,
        `clickSafe button ${b.id} must declare expectedActivity`,
      );
    }
  }
});

test("UI-P13 BUTTONS: dangerous buttons (shutdown / codex-verify / send-codex / etc) marked clickSafe:false", () => {
  // Server-affecting buttons — their click side effects (server kill,
  // provider spawn) make CI clicking unsafe.
  const mustBeUnsafe = [
    "header-action-shutdown",
    "header-action-codex-verify",
    "dual-action-send-codex",
    "dual-action-followup-codex",
    "dual-action-hand-back",
    "dual-action-archive",
  ];
  for (const id of mustBeUnsafe) {
    const b = BUTTONS.find((x) => x.id === id);
    assert.ok(b, `button ${id} must exist in catalog`);
    assert.equal(b.clickSafe, false,
      `button ${id} must be clickSafe:false — its activation has dangerous ` +
      "side effects on the real server (provider spawn / shutdown / state mutation)",
    );
  }
});

test("UI-P13 BUTTONS: known-safe buttons marked clickSafe:true", () => {
  const mustBeSafe = [
    "header-mode-simple",
    "header-mode-pro",
    "header-locale-ko",
    "header-locale-en",
    "header-action-metrics",
    "header-action-history",
    "dual-action-start",
  ];
  for (const id of mustBeSafe) {
    const b = BUTTONS.find((x) => x.id === id);
    assert.ok(b, `button ${id} must exist`);
    assert.equal(b.clickSafe, true);
  }
});

test("UI-P13 BUTTONS: legacy route filters out product-shell buttons", () => {
  const legacyRoute = { id: "legacy" };
  const desktopVp = { id: "desktop-1366", isMobile: false };
  for (const b of BUTTONS) {
    assert.equal(b.appliesTo(desktopVp, legacyRoute), false,
      `button ${b.id} must NOT apply to legacy route (different markup)`,
    );
  }
});

test("UI-P13 BUTTONS: pro-action buttons only apply to product-pro / product-default", () => {
  const desktopVp = { id: "desktop-1366", isMobile: false };
  const proActionIds = ["header-action-metrics", "header-action-history", "header-action-codex-verify"];
  for (const id of proActionIds) {
    const b = BUTTONS.find((x) => x.id === id);
    assert.equal(b.appliesTo(desktopVp, { id: "product-pro" }), true);
    assert.equal(b.appliesTo(desktopVp, { id: "product-default" }), true);
    assert.equal(b.appliesTo(desktopVp, { id: "product-simple" }), false,
      `${id} must NOT apply to simple mode`,
    );
  }
});

test("UI-P13 documented constants exposed", () => {
  assert.equal(typeof MIN_DOM_MUTATIONS, "number");
  assert.equal(typeof MIN_NETWORK_REQUESTS, "number");
  assert.equal(typeof FAILS_ON_CONSOLE_ERROR, "boolean");
});

// ── summarizeButtonResult verdicts ──────────────────────────────

test("UI-P13 summarizeButtonResult: not-found → skipped + ok", () => {
  const out = summarizeButtonResult({ found: false });
  assert.equal(out.ok, true);
  assert.equal(out.status, "skipped");
});

test("UI-P13 summarizeButtonResult: invisible → skipped + ok", () => {
  const out = summarizeButtonResult({ found: true, visible: false });
  assert.equal(out.ok, true);
  assert.equal(out.status, "skipped");
});

test("UI-P13 summarizeButtonResult: no-name → fail", () => {
  const out = summarizeButtonResult({
    found: true, visible: true, hasName: false, disabled: false,
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, "no-accessible-name");
});

test("UI-P13 summarizeButtonResult: disabled-without-reason → fail", () => {
  const out = summarizeButtonResult({
    found: true, visible: true, hasName: true,
    disabled: true, hasReason: false,
  });
  assert.equal(out.ok, false);
  assert.equal(out.status, "disabled-without-reason");
});

test("UI-P13 summarizeButtonResult: disabled-with-reason → ok", () => {
  const out = summarizeButtonResult({
    found: true, visible: true, hasName: true,
    disabled: true, hasReason: true,
  });
  assert.equal(out.ok, true);
  assert.equal(out.status, "disabled-with-reason");
});

test("UI-P13 summarizeButtonResult: clickSafe not-clicked → static-ok", () => {
  const out = summarizeButtonResult({
    found: true, visible: true, hasName: true, disabled: false,
  });  // no clickResult arg → not clicked
  assert.equal(out.ok, true);
  assert.equal(out.status, "static-ok-not-clicked");
});

test("UI-P13 summarizeButtonResult: click error → fail", () => {
  const out = summarizeButtonResult(
    { found: true, visible: true, hasName: true, disabled: false },
    { clickError: "Timeout 1000ms exceeded" },
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, "click-failed");
});

test("UI-P13 summarizeButtonResult: click console.error → fail with errors", () => {
  const out = summarizeButtonResult(
    { found: true, visible: true, hasName: true, disabled: false },
    { mutations: 5, requests: 0, errors: ["TypeError: handler is not a function"] },
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, "click-console-error");
  assert.ok(out.errors[0].includes("TypeError"));
});

test("UI-P13 summarizeButtonResult: click no activity (0 mut + 0 req) → fail", () => {
  const out = summarizeButtonResult(
    { found: true, visible: true, hasName: true, disabled: false },
    { mutations: 0, requests: 0, errors: [] },
  );
  assert.equal(out.ok, false);
  assert.equal(out.status, "click-no-activity");
});

test("UI-P13 summarizeButtonResult: click with mutation → ok", () => {
  const out = summarizeButtonResult(
    { found: true, visible: true, hasName: true, disabled: false },
    { mutations: 3, requests: 0, errors: [] },
  );
  assert.equal(out.ok, true);
  assert.equal(out.status, "click-fired-activity");
  assert.equal(out.detail.mutations, 3);
});

test("UI-P13 summarizeButtonResult: click with network request → ok (even with 0 mutations)", () => {
  const out = summarizeButtonResult(
    { found: true, visible: true, hasName: true, disabled: false },
    { mutations: 0, requests: 1, errors: [] },
  );
  assert.equal(out.ok, true);
  assert.equal(out.status, "click-fired-activity");
});

// ── Browser-side static evaluator smoke ─────────────────────────

test("UI-P13 _evalStaticButtonState: returns {found:false} for missing element", () => {
  const fn = _evalStaticButtonState;
  globalThis.document = { querySelector: () => null };
  try {
    const out = fn("button");
    assert.equal(out.found, false);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P13 _evalStaticButtonState: collects rect + name + disabled state", () => {
  const fn = _evalStaticButtonState;
  globalThis.document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ width: 100, height: 30 }),
      textContent: "  Click me  ",
      getAttribute: (k) => {
        if (k === "aria-label") return null;
        if (k === "title") return null;
        if (k === "aria-labelledby") return null;
        if (k === "aria-disabled") return null;
        if (k === "disabled") return null;
        return null;
      },
      disabled: false,
    }),
  };
  try {
    const out = fn("button");
    assert.equal(out.found, true);
    assert.equal(out.visible, true);
    assert.equal(out.hasName, true);
    assert.equal(out.text, "Click me");
    assert.equal(out.disabled, false);
    assert.equal(out.hasReason, false);
    assert.equal(out.width, 100);
    assert.equal(out.height, 30);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P13 _evalStaticButtonState: disabled with aria-label → hasReason:true", () => {
  const fn = _evalStaticButtonState;
  globalThis.document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ width: 100, height: 30 }),
      textContent: "Send",
      getAttribute: (k) => {
        if (k === "aria-label") return "Disabled — start a session first";
        return null;
      },
      disabled: true,
    }),
  };
  try {
    const out = fn("button");
    assert.equal(out.disabled, true);
    assert.equal(out.hasReason, true);
    assert.equal(out.hasName, true);
  } finally {
    delete globalThis.document;
  }
});

test("UI-P13 _evalStaticButtonState: aria-disabled='true' counts as disabled", () => {
  const fn = _evalStaticButtonState;
  globalThis.document = {
    querySelector: () => ({
      getBoundingClientRect: () => ({ width: 100, height: 30 }),
      textContent: "X",
      getAttribute: (k) => {
        if (k === "aria-disabled") return "true";
        if (k === "title") return "이유 설명";
        return null;
      },
      disabled: false,
    }),
  };
  try {
    const out = fn("button");
    assert.equal(out.disabled, true);
    assert.equal(out.hasReason, true);
  } finally {
    delete globalThis.document;
  }
});
