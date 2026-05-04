// Slice UI-Fuse-b (Phase D Round UI-P, 2026-05-04) — fused CLI
// shape contract + tool-selection logic + summary builder tests.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cli = require("../../scripts/visual-fused-live");

// ── Module surface ──────────────────────────────────────────────

test("UI-Fuse cli: documented exports", () => {
  for (const fn of ["parseArgs", "defaultOutDir", "selectTools",
                    "buildFusedSummary", "main"]) {
    assert.equal(typeof cli[fn], "function",
      `cli must export "${fn}"`);
  }
  assert.ok(Array.isArray(cli.KNOWN_TOOL_IDS));
  assert.ok(Array.isArray(cli.TOOLS) || typeof cli.TOOLS === "object");
});

test("UI-Fuse cli: TOOLS frozen + 4 entries", () => {
  assert.ok(Object.isFrozen(cli.TOOLS),
    "TOOLS registry must be frozen — adding/removing changes manifest contract");
  assert.equal(cli.TOOLS.length, 4);
  for (const t of cli.TOOLS) {
    assert.ok(Object.isFrozen(t), `tool ${t.id} must be frozen`);
    assert.equal(typeof t.id, "string");
    assert.equal(typeof t.label, "string");
    assert.equal(typeof t.runFn, "function");
  }
});

test("UI-Fuse cli: KNOWN_TOOL_IDS lists all 4 canonical IDs", () => {
  assert.deepEqual(cli.KNOWN_TOOL_IDS.slice().sort(),
    ["a11y", "assert", "button", "capture"]);
});

// ── parseArgs ───────────────────────────────────────────────────

test("UI-Fuse parseArgs: empty args → empty options + tools:null", () => {
  assert.deepEqual(cli.parseArgs([]), { help: false, tools: null });
});

test("UI-Fuse parseArgs: --help and -h flip help", () => {
  assert.equal(cli.parseArgs(["--help"]).help, true);
  assert.equal(cli.parseArgs(["-h"]).help, true);
});

test("UI-Fuse parseArgs: --port + --out-dir + --label round-trip", () => {
  const out = cli.parseArgs([
    "--port", "5500", "--out-dir", "/tmp/fused", "--label", "smoke",
  ]);
  assert.equal(out.port, 5500);
  assert.equal(out.outDir, "/tmp/fused");
  assert.equal(out.label, "smoke");
});

test("UI-Fuse parseArgs: --tools comma-separated parsing", () => {
  const out = cli.parseArgs(["--tools", "capture,a11y"]);
  assert.deepEqual(out.tools, ["capture", "a11y"]);
});

test("UI-Fuse parseArgs: --tools handles whitespace + filters empty entries", () => {
  const out = cli.parseArgs(["--tools", " capture , , a11y "]);
  assert.deepEqual(out.tools, ["capture", "a11y"]);
});

test("UI-Fuse parseArgs: --quiet + --json", () => {
  const out = cli.parseArgs(["--quiet", "--json"]);
  assert.equal(out.quiet, true);
  assert.equal(out.json, true);
});

test("UI-Fuse parseArgs: --port number coercion", () => {
  const out = cli.parseArgs(["--port", "4799"]);
  assert.equal(out.port, 4799);
  assert.equal(typeof out.port, "number");
});

// ── defaultOutDir ──────────────────────────────────────────────

test("UI-Fuse defaultOutDir: contains YYYY-MM-DD prefix + ui-fuse suffix", () => {
  const dir = cli.defaultOutDir();
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-fuse$/);
});

test("UI-Fuse defaultOutDir: label appended after sanitization", () => {
  const dir = cli.defaultOutDir("regression-2026-05-04");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /^docs\/reports\/\d{4}-\d{2}-\d{2}-ui-fuse-regression-2026-05-04$/);
});

test("UI-Fuse defaultOutDir: dangerous characters in label sanitized to dashes", () => {
  const dir = cli.defaultOutDir("hello world!@#$%");
  const normalized = dir.replace(/\\/g, "/");
  assert.match(normalized, /-hello-world-+$/);
});

// ── selectTools ─────────────────────────────────────────────────

test("UI-Fuse selectTools: null/empty → all 4 tools selected", () => {
  const r1 = cli.selectTools(null);
  assert.equal(r1.selected.length, 4);
  assert.deepEqual(r1.unknown, []);
  const r2 = cli.selectTools([]);
  assert.equal(r2.selected.length, 4);
});

test("UI-Fuse selectTools: subset preserves ordering of input", () => {
  const r = cli.selectTools(["a11y", "capture"]);
  assert.equal(r.selected.length, 2);
  assert.equal(r.selected[0].id, "a11y");
  assert.equal(r.selected[1].id, "capture");
  assert.deepEqual(r.unknown, []);
});

test("UI-Fuse selectTools: unknown IDs separated into unknown[]", () => {
  const r = cli.selectTools(["capture", "totally-fake", "a11y"]);
  assert.equal(r.selected.length, 2);
  assert.equal(r.selected[0].id, "capture");
  assert.equal(r.selected[1].id, "a11y");
  assert.deepEqual(r.unknown, ["totally-fake"]);
});

test("UI-Fuse selectTools: all-unknown → empty selected + populated unknown", () => {
  const r = cli.selectTools(["xxx", "yyy"]);
  assert.equal(r.selected.length, 0);
  assert.deepEqual(r.unknown, ["xxx", "yyy"]);
});

test("UI-Fuse selectTools: returned selected[] is a copy, not the frozen TOOLS array", () => {
  const r = cli.selectTools(null);
  // Should be a new array (not the frozen TOOLS) so caller can
  // splice/sort without affecting the registry
  r.selected.push({ id: "fake" });  // would throw if frozen
  // ensure registry is still 4 entries
  assert.equal(cli.TOOLS.length, 4);
});

// ── buildFusedSummary ──────────────────────────────────────────

test("UI-Fuse buildFusedSummary: documented schema + structure", () => {
  const summary = cli.buildFusedSummary({
    outDir: "/tmp/fused-test",
    fusedAt: "2026-05-04T00:00:00.000Z",
    results: [
      {
        toolId: "capture",
        manifest: { schema: "harness-visual-live/v1", capturedAt: "x", totalElapsedMs: 100, summary: { total: 16 } },
        exitCode: 0,
        failed: false,
        skipped: false,
      },
      {
        toolId: "assert",
        manifest: null,
        exitCode: 1,
        failed: true,
        skipped: false,
        errorMessage: "navigation timeout",
      },
    ],
  });
  assert.equal(summary.schema, "harness-visual-fused/v1");
  assert.equal(summary.fusedAt, "2026-05-04T00:00:00.000Z");
  assert.equal(summary.outDir, "/tmp/fused-test");
  assert.equal(summary.tools.capture, "ran");
  assert.equal(summary.tools.assert, "errored");
  assert.equal(summary.perTool.capture.schema, "harness-visual-live/v1");
  assert.equal(summary.perTool.capture.totalElapsedMs, 100);
  assert.equal(summary.perTool.assert.error, "navigation timeout");
});

test("UI-Fuse buildFusedSummary: skipped result classified as 'skipped'", () => {
  const summary = cli.buildFusedSummary({
    outDir: "/tmp",
    fusedAt: "x",
    results: [
      { toolId: "button", manifest: null, exitCode: 0, failed: false, skipped: true },
    ],
  });
  assert.equal(summary.tools.button, "skipped");
});

test("UI-Fuse buildFusedSummary: empty results → empty tools/perTool but still has schema", () => {
  const summary = cli.buildFusedSummary({
    outDir: "/tmp", fusedAt: "x", results: [],
  });
  assert.equal(summary.schema, "harness-visual-fused/v1");
  assert.deepEqual(summary.tools, {});
  assert.deepEqual(summary.perTool, {});
});
