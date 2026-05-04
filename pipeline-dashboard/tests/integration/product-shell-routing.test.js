// Slice UI-P1-h (Phase 2 Round 3, 2026-04-30) — product shell routing.
// Pins: GET / serves product shell by default, ?mode=legacy serves
// the preserved legacy DOM, both apply nonce + CSP headers.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { start } = require("../../server");

// Per-test server boot / close pattern (matches csp-nonce.test.js).
// Each test owns its server lifetime — avoids accumulating intervals
// from a shared test.before that stay live when listener.close() runs
// (the runner-stale-monitor + session watcher hold long-lived timers
// that block the test runner from draining the event loop).

const PORT = 4318;
const BASE = `http://127.0.0.1:${PORT}`;

async function waitFor(pathname) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const res = await fetch(`${BASE}${pathname}`);
      if (res.ok || res.status === 204 || (res.status >= 300 && res.status < 500)) return res;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not respond on ${pathname}`);
}

async function withServer(fn) {
  const listener = start(PORT, "127.0.0.1");
  try {
    await waitFor("/api/health");
    await fn();
  } finally {
    await new Promise((r) => listener.close(r));
  }
}

test("UI-P1 routing: GET / returns product shell HTML (no ?mode)", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /text\/html/);
    const html = await res.text();
    assert.match(html, /id="product-shell-root"/);
    assert.match(html, /style\.product\.css/);
    assert.match(html, /js\/monitor\/shells\/product-shell\.js/);
    assert.match(html, /product-shell-init\.js/);
    assert.equal(html.includes("monitor-shell-root"), false,
      "product shell must NOT include legacy monitor-shell-root mount",
    );
  });
});

test("UI-P1 routing: ?mode=legacy serves preserved index.legacy.html + ?mode=simple/pro stay product", async () => {
  // One server boot covers the 4 mode variants — keeps the integration
  // suite fast (no need for a per-test boot of all 4 cases).
  await withServer(async () => {
    // ?mode=legacy → legacy DOM
    const legacy = await fetch(`${BASE}/?mode=legacy`);
    assert.equal(legacy.status, 200);
    const legacyHtml = await legacy.text();
    assert.match(legacyHtml, /SJ Harness Engine — Legacy/i);
    assert.ok(legacyHtml.includes("monitor-shell-root") || legacyHtml.includes("skip-link"));
    assert.equal(legacyHtml.includes("product-shell-root"), false,
      "legacy view must NOT contain product-shell-root mount",
    );

    // ?mode=simple → product
    const simple = await fetch(`${BASE}/?mode=simple`);
    assert.match(await simple.text(), /id="product-shell-root"/);

    // ?mode=pro → product
    const pro = await fetch(`${BASE}/?mode=pro`);
    assert.match(await pro.text(), /id="product-shell-root"/);

    // ?mode=garbage → product (falls through, NOT legacy)
    const garbage = await fetch(`${BASE}/?mode=garbage-value-here`);
    assert.match(await garbage.text(), /id="product-shell-root"/);
  });
});

test("UI-P1 routing: both / and /?mode=legacy receive nonce + CSP header", async () => {
  await withServer(async () => {
    for (const path of ["/", "/?mode=legacy"]) {
      const res = await fetch(`${BASE}${path}`);
      const csp = res.headers.get("content-security-policy")
        || res.headers.get("content-security-policy-report-only");
      assert.ok(csp, `CSP header must be present for ${path}`);
      assert.match(csp, /'nonce-/, `CSP must include nonce for ${path}`);
      const html = await res.text();
      assert.match(html, /<script nonce="/, `script tags must carry nonce for ${path}`);
      assert.match(html, /<link nonce="[^"]+" rel="stylesheet"/, `link tags must carry nonce for ${path}`);
    }
  });
});

// ── UI-P8: legacy retreat — deprecation banner ─────────────────────

test("UI-P8 routing: /?mode=legacy serves the deprecation banner + dismiss controller", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/?mode=legacy`);
    assert.equal(res.status, 200);
    const html = await res.text();
    // Banner mount + class hooks present
    assert.match(html, /id="harness-legacy-banner"/,
      "legacy banner element must be present in /?mode=legacy");
    assert.match(html, /class="harness-legacy-banner"/);
    assert.match(html, /class="legacy-banner-dismiss"/,
      "dismiss button must be present in legacy banner markup");
    // CTA links to root (the product shell)
    assert.match(html, /href="\/"/,
      "banner CTA links to / so dismissed users can still reach the shell");
    // Korean copy ships baked-in for first paint
    assert.match(html, /새 대시보드가 준비되었습니다/);
    // i18n hooks for KO/EN toggle
    assert.match(html, /data-i18n="legacy\.banner\.message"/);
    assert.match(html, /data-i18n="legacy\.banner\.cta"/);
    // legacy-banner.js loaded (will be nonce-injected by indexRenderer)
    assert.match(html, /<script nonce="[^"]+" src="js\/legacy-banner\.js"><\/script>/,
      "legacy-banner.js must be loaded with nonce on /?mode=legacy");
  });
});

test("UI-P8 routing: GET / (product shell) does NOT contain the legacy banner", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.equal(html.includes("harness-legacy-banner"), false,
      "product shell never carries the legacy deprecation banner — banner is " +
      "scoped to /?mode=legacy only (per UI-P0 §285+286)",
    );
    assert.equal(html.includes("legacy-banner.js"), false,
      "product shell does NOT load legacy-banner.js — script lives only in " +
      "index.legacy.html and is irrelevant to product-shell sessions",
    );
  });
});

test("UI-P8 routing: legacy banner CTA points at the product shell route", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/?mode=legacy`);
    const html = await res.text();
    // Find banner section + verify CTA href is "/"
    const m = html.match(/<a class="legacy-banner-cta"[^>]*href="([^"]+)"/);
    assert.ok(m, "legacy banner must contain a CTA <a> with href");
    assert.equal(m[1], "/",
      "CTA href must be '/' so the operator lands on the product shell " +
      "without any query string (default mode = simple per UI-P0 §S decision 1)",
    );
  });
});
