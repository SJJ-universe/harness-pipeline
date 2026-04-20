#!/usr/bin/env node
// Slice J (v5) — SRI hash computer for pinned CDN resources.
//
//   npm run sri:print    Fetches each URL listed below, hashes it with SHA-384,
//                        and prints an `integrity="sha384-..."` line the user
//                        can paste into public/index.html.
//
// The list is hard-coded rather than parsed out of index.html so version bumps
// are a deliberate, reviewable commit rather than an opaque script artifact.
// When a URL 404s or the fetch fails, the row is marked FAILED and exit code
// becomes 1 — that way CI catches broken pins immediately.
//
// Testable pure helper: `hashBody(buffer)` returns the `sha384-...` string.

const crypto = require("crypto");

const PINNED_URLS = [
  "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/css/xterm.min.css",
  "https://cdn.jsdelivr.net/npm/@xterm/xterm@5/lib/xterm.min.js",
  "https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0/lib/addon-fit.min.js",
];

function hashBody(buffer) {
  const h = crypto.createHash("sha384").update(buffer).digest("base64");
  return `sha384-${h}`;
}

async function fetchAndHash(url) {
  if (typeof fetch !== "function") {
    throw new Error("This Node build lacks global fetch — use Node ≥18.");
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return hashBody(buf);
}

async function main() {
  const rows = [];
  let failed = 0;
  for (const url of PINNED_URLS) {
    try {
      const integrity = await fetchAndHash(url);
      rows.push({ url, integrity, status: "OK" });
    } catch (err) {
      rows.push({ url, integrity: null, status: `FAILED: ${err.message}` });
      failed++;
    }
  }
  console.log("\n# SRI hashes for index.html — paste these integrity attributes:\n");
  for (const row of rows) {
    console.log(`# ${row.url}`);
    if (row.integrity) {
      console.log(`  integrity="${row.integrity}" crossorigin="anonymous"`);
    } else {
      console.log(`  ${row.status}`);
    }
    console.log("");
  }
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { hashBody, PINNED_URLS };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
