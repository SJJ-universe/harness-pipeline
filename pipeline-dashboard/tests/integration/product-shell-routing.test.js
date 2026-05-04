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
