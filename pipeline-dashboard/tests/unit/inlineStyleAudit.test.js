// Slice J (v5) — inline style audit.
//
// Enforces that index.html carries zero `style="..."` attributes so the
// static HTML is CSP-compatible with `style-src 'self'` (we still retain
// 'unsafe-inline' for style-src because of the context bar's .style.width,
// tracked as a Slice K follow-up). This lint prevents regression.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// Slice UI-P1 (2026-04-30): inline-style audit covers BOTH the product
// shell (index.html) AND the preserved legacy view (index.legacy.html).
// Both must satisfy the no-inline-style invariant for CSP compliance.
const index = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "public", "index.html"),
  "utf-8"
);
const indexLegacy = fs.readFileSync(
  path.resolve(__dirname, "..", "..", "public", "index.legacy.html"),
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

test("legacy index.html has zero inline style=\"...\" attributes", () => {
  const matches = indexLegacy.match(/\sstyle="[^"]*"/g) || [];
  assert.equal(
    matches.length,
    0,
    `Found inline style attributes in legacy: ${matches.join(", ")}`
  );
});

test("index.html has zero <style>...</style> blocks", () => {
  // Similar lint — no <style> blocks. All styling goes through style.css.
  const matches = index.match(/<style[\s>]/gi) || [];
  assert.equal(
    matches.length,
    0,
    "Inline <style> blocks found — keep all styling in style.css"
  );
});
