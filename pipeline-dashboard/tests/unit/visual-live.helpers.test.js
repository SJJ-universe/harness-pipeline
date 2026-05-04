// Slice UI-P10-a (Phase D Round UI-P, 2026-05-04) — shape contract for
// the visual-live helper modules. These are NOT live browser tests
// (no chromium spawn here) — they pin:
//   1. VIEWPORTS / ROUTES are frozen + 4 entries each (artifact
//      contract relies on stable IDs + ordering)
//   2. boot() helper signature + default constants
//
// Live browser screenshot capture itself runs via
// `npm run visual:capture-live` (UI-P10-b/c) — separate from this
// regular CI gate so chromium download is never on the npm-ci hot
// path.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { VIEWPORTS } = require("../../scripts/visual-live/viewports");
const { ROUTES } = require("../../scripts/visual-live/routes");
const serverBoot = require("../../scripts/visual-live/server-boot");

// ── VIEWPORTS contract ───────────────────────────────────────────

test("UI-P10 viewports: VIEWPORTS is frozen + 4 entries", () => {
  assert.ok(Object.isFrozen(VIEWPORTS),
    "VIEWPORTS must be frozen — capture artifact contract depends on " +
    "stable IDs + ordering across runs",
  );
  assert.equal(VIEWPORTS.length, 4,
    "VIEWPORTS must have exactly 4 entries (1366×768 / 1920×1080 / " +
    "390×844 / 768×1024). Adding viewports requires a baseline-refresh " +
    "decision, not a casual commit.",
  );
});

test("UI-P10 viewports: each entry has the required fields + frozen", () => {
  const REQUIRED = ["id", "label", "width", "height", "deviceScaleFactor", "isMobile"];
  for (const v of VIEWPORTS) {
    assert.ok(Object.isFrozen(v), `viewport ${v.id} must be frozen`);
    for (const field of REQUIRED) {
      assert.ok(field in v, `viewport ${v.id} missing field "${field}"`);
    }
    assert.equal(typeof v.id, "string");
    assert.equal(typeof v.label, "string");
    assert.equal(typeof v.width, "number");
    assert.equal(typeof v.height, "number");
    assert.ok(v.width > 0 && v.width <= 4000, `viewport ${v.id} width out of range`);
    assert.ok(v.height > 0 && v.height <= 4000, `viewport ${v.id} height out of range`);
    assert.equal(typeof v.deviceScaleFactor, "number");
    assert.equal(typeof v.isMobile, "boolean");
  }
});

test("UI-P10 viewports: IDs are unique + match sj-spec format", () => {
  const ids = VIEWPORTS.map((v) => v.id);
  const set = new Set(ids);
  assert.equal(set.size, ids.length, "duplicate viewport id detected");
  for (const id of ids) {
    assert.match(id, /^[a-z0-9-]+$/,
      `viewport id "${id}" must be lowercase alphanum + dash for filesystem safety`,
    );
  }
});

test("UI-P10 viewports: documented 4 must each be present (canonical IDs)", () => {
  const present = new Set(VIEWPORTS.map((v) => v.id));
  for (const expected of ["desktop-1366", "desktop-1920", "mobile-390", "tablet-768"]) {
    assert.ok(present.has(expected),
      `canonical viewport "${expected}" missing — UI-P10 spec requires all 4`,
    );
  }
});

// ── ROUTES contract ──────────────────────────────────────────────

test("UI-P10 routes: ROUTES is frozen + 4 entries", () => {
  assert.ok(Object.isFrozen(ROUTES));
  assert.equal(ROUTES.length, 4,
    "ROUTES must have exactly 4 entries (default / pro / simple / legacy)",
  );
});

test("UI-P10 routes: each entry has the required fields + frozen", () => {
  const REQUIRED = ["id", "pathname", "mode", "label", "waitForSelector"];
  for (const r of ROUTES) {
    assert.ok(Object.isFrozen(r), `route ${r.id} must be frozen`);
    for (const field of REQUIRED) {
      assert.ok(field in r, `route ${r.id} missing field "${field}"`);
    }
    assert.equal(typeof r.pathname, "string");
    assert.match(r.pathname, /^\//, `route ${r.id} pathname must start with "/"`);
    assert.match(r.waitForSelector, /^[#.]/,
      `route ${r.id} waitForSelector must be a CSS selector starting with # or .`,
    );
  }
});

test("UI-P10 routes: documented 4 must each be present (canonical IDs)", () => {
  const present = new Set(ROUTES.map((r) => r.id));
  for (const expected of ["product-default", "product-pro", "product-simple", "legacy"]) {
    assert.ok(present.has(expected),
      `canonical route "${expected}" missing — UI-P10 spec requires all 4`,
    );
  }
});

test("UI-P10 routes: legacy route waits for UI-P8 banner element", () => {
  const legacy = ROUTES.find((r) => r.id === "legacy");
  assert.equal(legacy.waitForSelector, "#harness-legacy-banner",
    "legacy route must wait for UI-P8 banner mount — proves legacy retreat " +
    "deprecation still wired",
  );
});

test("UI-P10 routes: product routes all wait for product-shell-root", () => {
  for (const r of ROUTES) {
    if (r.id === "legacy") continue;
    assert.equal(r.waitForSelector, "#product-shell-root",
      `product route ${r.id} must wait for #product-shell-root mount`,
    );
  }
});

// ── server-boot helper signature ─────────────────────────────────

test("UI-P10 server-boot: exports the documented surface", () => {
  assert.equal(typeof serverBoot.boot, "function",
    "server-boot must export boot()");
  assert.equal(typeof serverBoot.DEFAULT_PORT, "number");
  assert.equal(typeof serverBoot.DEFAULT_HOST, "string");
  assert.equal(typeof serverBoot.DEFAULT_BOOT_TIMEOUT_MS, "number");
  assert.equal(typeof serverBoot.DEFAULT_POLL_INTERVAL_MS, "number");
});

test("UI-P10 server-boot: defaults pin documented values", () => {
  // Default port must be 4799 — distinct from production 4201,
  // integration test ports (43xx), readiness 5099. Explicit pin so
  // a casual change can't collide with a running dev server.
  assert.equal(serverBoot.DEFAULT_PORT, 4799,
    "DEFAULT_PORT must stay 4799 (avoids collision with prod 4201, " +
    "integration test 43xx, readiness 5099). Override via env " +
    "HARNESS_VISUAL_LIVE_PORT.",
  );
  assert.equal(serverBoot.DEFAULT_HOST, "127.0.0.1",
    "DEFAULT_HOST must stay loopback — visual-live never binds 0.0.0.0",
  );
  assert.equal(serverBoot.DEFAULT_BOOT_TIMEOUT_MS, 10000);
  assert.equal(serverBoot.DEFAULT_POLL_INTERVAL_MS, 100);
});

test("UI-P10 server-boot: env override wins over default port", () => {
  // Snapshot + restore to keep the rest of the suite isolated.
  const previous = process.env.HARNESS_VISUAL_LIVE_PORT;
  try {
    process.env.HARNESS_VISUAL_LIVE_PORT = "4823";
    delete require.cache[require.resolve("../../scripts/visual-live/server-boot")];
    const reloaded = require("../../scripts/visual-live/server-boot");
    assert.equal(reloaded.DEFAULT_PORT, 4823,
      "HARNESS_VISUAL_LIVE_PORT env must override default 4799",
    );
  } finally {
    if (previous === undefined) delete process.env.HARNESS_VISUAL_LIVE_PORT;
    else process.env.HARNESS_VISUAL_LIVE_PORT = previous;
    delete require.cache[require.resolve("../../scripts/visual-live/server-boot")];
  }
});
