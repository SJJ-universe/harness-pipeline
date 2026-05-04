// Slice J (v5) — SRI helper determinism.
//
// `compute-sri.js` is meant to be run manually as `npm run sri:print`, so we
// don't exercise the network fetch here — just the pure hashBody() helper,
// to lock in that the hash is always `sha384-<base64>` and is deterministic
// for a given input. That's the contract tests and future tooling rely on.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { hashBody, PINNED_URLS } = require("../../scripts/compute-sri");

test("hashBody returns deterministic sha384-<base64> for a given buffer", () => {
  const buf = Buffer.from("harness sri test");
  const a = hashBody(buf);
  const b = hashBody(buf);
  assert.equal(a, b, "hash must be deterministic");
  assert.match(a, /^sha384-[A-Za-z0-9+/=]+$/);
});

test("hashBody differs for different inputs", () => {
  const h1 = hashBody(Buffer.from("abc"));
  const h2 = hashBody(Buffer.from("def"));
  assert.notEqual(h1, h2);
});

test("hashBody matches a manually-computed sha384", () => {
  const buf = Buffer.from("the quick brown fox");
  const expected =
    "sha384-" + crypto.createHash("sha384").update(buf).digest("base64");
  assert.equal(hashBody(buf), expected);
});

test("PINNED_URLS covers the xterm CDN resources actually referenced in legacy index.html", () => {
  // Slice UI-P1 (2026-04-30): xterm CDN refs live in index.legacy.html.
  // The product shell at index.html has no external CDN deps yet —
  // terminals are stubbed, real xterm wiring lands in UI-P6 inside
  // dual-terminals.js. SRI pinning still applies to the legacy view
  // because operators using ?mode=legacy still load the CDN.
  const legacy = require("fs").readFileSync(
    require("path").resolve(__dirname, "..", "..", "public", "index.legacy.html"),
    "utf-8"
  );
  assert.ok(PINNED_URLS.length >= 3, "expected at least 3 pinned CDN URLs");
  for (const url of PINNED_URLS) {
    assert.ok(legacy.includes(url),
      `pinned URL ${url} not found in index.legacy.html — compute-sri would hash a dead pin`);
  }
});
