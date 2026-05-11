// Slice J (v5) — inline style + event handler audit.
//
// Enforces that index.html carries zero `style="..."` attributes AND
// zero `on<event>="..."` inline event handlers so the static HTML is
// CSP-compatible with `style-src 'self'` + `script-src 'self' 'nonce-…'`.
// This lint prevents regression.
//
// LEGACY-VIEW-REMOVE-0 (2026-05-11): the legacy view (index.legacy.html)
// was retired — assertions are now scoped to the product shell only.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const index = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "public", "index.html"),
  "utf-8"
);

test("index.html has zero inline style=\"...\" attributes", () => {
  // Allow `style` inside attribute-name regexes for other contexts? No —
  // match the literal ` style="`. Must not appear anywhere in the file.
  const matches = index.match(/\sstyle="[^"]*"/g) || [];
  assert.equal(
    matches.length,
    0,
    `Found inline style attributes in product shell (must be CSS classes): ${matches.join(", ")}`
  );
});

test("index.html has zero inline event handlers (on<event>=\"...\")", () => {
  // CSP-safe contract: every event handler must be attached via
  // addEventListener from a nonce-loaded script. Inline `onclick="..."`
  // and friends would break under script-src 'self' 'nonce-<…>'.
  const matches = index.match(/\son[a-z]+="/gi) || [];
  assert.equal(
    matches.length,
    0,
    `Found inline event handlers in product shell: ${matches.join(", ")}`,
  );
});

test("index.html has zero <style>...</style> blocks", () => {
  // Similar lint — no <style> blocks. All styling goes through style.product.css.
  const matches = index.match(/<style[\s>]/gi) || [];
  assert.equal(
    matches.length,
    0,
    "Inline <style> blocks found — keep all styling in style.product.css"
  );
});
