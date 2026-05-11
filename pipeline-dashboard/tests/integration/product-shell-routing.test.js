// Slice UI-P1-h (Phase 2 Round 3, 2026-04-30) — product shell routing.
// Slice LEGACY-VIEW-REMOVE-0 (2026-05-11): legacy view retired. The
// preserved legacy DOM is gone; ?mode=legacy now 302-redirects to /
// so old bookmarks still land somewhere useful.
//
// Pins: GET / serves product shell HTML with nonce + CSP, ?mode=legacy
// 302-redirects to /, ?mode=simple/pro also serve product shell.

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

test("LEGACY-VIEW-REMOVE-0 routing: ?mode=legacy 302-redirects to /", async () => {
  // One server boot covers the 4 mode variants — keeps the integration
  // suite fast (no need for a per-test boot of all 4 cases).
  await withServer(async () => {
    // ?mode=legacy → 302 → /
    const legacy = await fetch(`${BASE}/?mode=legacy`, { redirect: "manual" });
    assert.equal(legacy.status, 302,
      "?mode=legacy must redirect after LEGACY-VIEW-REMOVE-0 (was 200 OK + legacy DOM)");
    assert.equal(legacy.headers.get("location"), "/",
      "redirect target must be / (default product shell)");

    // ?mode=simple → product
    const simple = await fetch(`${BASE}/?mode=simple`);
    assert.match(await simple.text(), /id="product-shell-root"/);

    // ?mode=pro → product
    const pro = await fetch(`${BASE}/?mode=pro`);
    assert.match(await pro.text(), /id="product-shell-root"/);

    // ?mode=garbage → product (falls through)
    const garbage = await fetch(`${BASE}/?mode=garbage-value-here`);
    assert.match(await garbage.text(), /id="product-shell-root"/);
  });
});

test("UI-P1 routing: GET / receives nonce + CSP header", async () => {
  await withServer(async () => {
    const res = await fetch(`${BASE}/`);
    const csp = res.headers.get("content-security-policy")
      || res.headers.get("content-security-policy-report-only");
    assert.ok(csp, "CSP header must be present for /");
    assert.match(csp, /'nonce-/, "CSP must include nonce for /");
    const html = await res.text();
    assert.match(html, /<script nonce="/, "script tags must carry nonce");
    assert.match(html, /<link nonce="[^"]+" rel="stylesheet"/, "link tags must carry nonce");
  });
});

// ── UI-P8: legacy banner tests removed (LEGACY-VIEW-REMOVE-0) ──────
//
// The banner element, dismiss controller, CTA <a>, and i18n hooks
// were retired along with index.legacy.html + js/legacy-banner.js
// when the legacy view was removed.
