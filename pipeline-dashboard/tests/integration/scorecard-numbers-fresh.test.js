// Slice MC5 (Phase D Round 2.5, 2026-04-27) — scorecard freshness anchor.
//
// Catches doc drift: if scorecard.md / readiness-rubric.md hard-code
// test counts that don't match the actual runner output, this test
// fails. CI also runs `npm run scorecard:check` which exits 1 when
// the docs are stale; this in-process test gives a faster fail signal
// without spawning an extra process.
//
// What we DON'T do here: actually run the test suites. That would be
// circular (this test is part of the test:integration suite). Instead
// we read the doc + assert structure (markers exist + the format
// inside them is the expected shape).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SCORECARD = path.join(__dirname, "../../docs/scorecard.md");
const RUBRIC    = path.join(__dirname, "../../docs/readiness-rubric.md");

function readDoc(p) {
  return fs.readFileSync(p, "utf-8");
}

function findMarkerContent(text, key) {
  const re = new RegExp(
    "<!-- AUTO:" + key + " -->([\\s\\S]*?)<!-- /AUTO -->"
  );
  const m = text.match(re);
  return m ? m[1] : null;
}

// ── markers exist in their target docs ──────────────────────────────

test("MC5: scorecard.md has the AUTO:test-counts marker", () => {
  const text = readDoc(SCORECARD);
  const inner = findMarkerContent(text, "test-counts");
  assert.ok(inner !== null, "AUTO:test-counts marker present in scorecard.md");
  // Format: "**N unit / M integration**"
  assert.match(inner, /^\*\*\d+ unit \/ \d+ integration\*\*$/);
});

test("MC5: readiness-rubric.md has the AUTO:test-counts marker", () => {
  const text = readDoc(RUBRIC);
  const inner = findMarkerContent(text, "test-counts");
  assert.ok(inner !== null, "AUTO:test-counts marker present in readiness-rubric.md");
  assert.match(inner, /^\*\*\d+ unit \/ \d+ integration\*\*$/);
});

test("MC5: readiness-rubric.md has the AUTO:readiness-total marker", () => {
  const text = readDoc(RUBRIC);
  const inner = findMarkerContent(text, "readiness-total");
  assert.ok(inner !== null, "AUTO:readiness-total marker present");
  // Format: "**N / 15**"
  assert.match(inner, /^\*\*\d+ \/ 15\*\*$/);
});

test("MC5: readiness-rubric.md has the AUTO:readiness-stars marker", () => {
  const text = readDoc(RUBRIC);
  const inner = findMarkerContent(text, "readiness-stars");
  assert.ok(inner !== null, "AUTO:readiness-stars marker present");
  // Each line should be "  - <name>: N/3"
  for (const line of inner.split("\n").map((l) => l.trim()).filter(Boolean)) {
    assert.match(line, /^- [a-z-]+: \d+\/3$/, "rubric line: " + line);
  }
});

// ── scorecard test-counts agree with rubric test-counts ─────────────

test("MC5: scorecard.md and readiness-rubric.md test-counts agree", () => {
  const sc = findMarkerContent(readDoc(SCORECARD), "test-counts");
  const rb = findMarkerContent(readDoc(RUBRIC), "test-counts");
  assert.equal(sc, rb,
    "scorecard.md and readiness-rubric.md AUTO:test-counts must match — "
    + "run `npm run scorecard:sync` after a slice."
  );
});

// ── sync-scorecard.js script exists + has --check flag ──────────────

test("MC5: sync-scorecard.js exists + --check flag wired", () => {
  const scriptPath = path.join(__dirname, "../../scripts/sync-scorecard.js");
  assert.ok(fs.existsSync(scriptPath), "sync-scorecard.js present");
  const src = fs.readFileSync(scriptPath, "utf-8");
  assert.match(src, /isCheck = flag\("--check"\)/);
  assert.match(src, /STALE: /);
});

test("MC5: package.json wires scorecard:sync + scorecard:check + readiness:check", () => {
  const pkg = JSON.parse(readDoc(path.join(__dirname, "../../package.json")));
  assert.ok(pkg.scripts["scorecard:sync"], "scorecard:sync script wired");
  assert.ok(pkg.scripts["scorecard:check"], "scorecard:check script wired");
  assert.ok(pkg.scripts["readiness:check"], "readiness:check script wired");
});
