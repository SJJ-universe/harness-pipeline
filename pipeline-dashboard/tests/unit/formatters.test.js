// Slice AC (Phase 2.5) — HarnessFormatters unit tests.
//
// Covers the pure string helpers extracted from app.js. Node has no DOM,
// so escapeHtml() takes the manual-replace fallback path here; the
// browser path is identical in result.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  escapeHtml,
  shortPath,
  formatHMS,
  summarizeToolInput,
} = require("../../public/js/formatters");

// ── escapeHtml ──────────────────────────────────────────────────────────

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
  assert.equal(escapeHtml("a & b"), "a &amp; b");
  assert.equal(escapeHtml('\"q\"'), "&quot;q&quot;");
  assert.equal(escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml handles null/undefined without throwing", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("escapeHtml coerces non-strings", () => {
  assert.equal(escapeHtml(42), "42");
  assert.equal(escapeHtml(true), "true");
});

// ── shortPath ───────────────────────────────────────────────────────────

test("shortPath returns the last two POSIX segments", () => {
  assert.equal(shortPath("src/runtime/eventReplayBuffer.js"), "runtime/eventReplayBuffer.js");
  assert.equal(shortPath("a/b"), "a/b");
  assert.equal(shortPath("only.js"), "only.js");
});

test("shortPath normalizes Windows backslashes", () => {
  assert.equal(shortPath("C:\\Users\\SJ\\foo\\bar.js"), "foo/bar.js");
  assert.equal(shortPath("dir\\nested\\file.txt"), "nested/file.txt");
});

test("shortPath returns empty string for empty/nullish input", () => {
  assert.equal(shortPath(""), "");
  assert.equal(shortPath(null), "");
  assert.equal(shortPath(undefined), "");
});

// ── formatHMS ───────────────────────────────────────────────────────────

test("formatHMS pads each component to two digits", () => {
  // 2024-01-01T03:05:09Z → depends on local TZ, but pad semantics hold.
  const ts = new Date(2024, 0, 1, 3, 5, 9).getTime();
  const out = formatHMS(ts);
  assert.match(out, /^\d{2}:\d{2}:\d{2}$/);
  assert.equal(out, "03:05:09");
});

test("formatHMS renders a noon timestamp as 12:00:00", () => {
  const ts = new Date(2024, 5, 15, 12, 0, 0).getTime();
  assert.equal(formatHMS(ts), "12:00:00");
});

// ── summarizeToolInput ─────────────────────────────────────────────────

test("summarizeToolInput returns empty for bad input", () => {
  assert.equal(summarizeToolInput("Read", null), "");
  assert.equal(summarizeToolInput("Read", undefined), "");
  assert.equal(summarizeToolInput("Read", "not-an-object"), "");
});

test("summarizeToolInput file-path tools produce a shortened path", () => {
  assert.equal(
    summarizeToolInput("Read", { file_path: "src/runtime/x.js" }),
    "runtime/x.js"
  );
  assert.equal(
    summarizeToolInput("Edit", { filePath: "a/b/c.js" }),
    "b/c.js"
  );
  assert.equal(
    summarizeToolInput("NotebookEdit", { notebook_path: "notes/diary.ipynb" }),
    "notes/diary.ipynb"
  );
});

test("summarizeToolInput — Grep/Glob return the pattern", () => {
  assert.equal(summarizeToolInput("Grep", { pattern: "TODO" }), "TODO");
  assert.equal(summarizeToolInput("Glob", { pattern: "**/*.ts" }), "**/*.ts");
});

test("summarizeToolInput — Bash truncates the command at 80 chars", () => {
  const long = "echo " + "x".repeat(200);
  const out = summarizeToolInput("Bash", { command: long });
  assert.equal(out.length, 80);
  assert.ok(out.startsWith("echo "));
});

test("summarizeToolInput — Agent returns description or subagent_type", () => {
  assert.equal(
    summarizeToolInput("Agent", { description: "scan dashboard" }),
    "scan dashboard"
  );
  assert.equal(
    summarizeToolInput("Agent", { subagent_type: "security-critic" }),
    "security-critic"
  );
});

test("summarizeToolInput — TodoWrite counts the todos array", () => {
  assert.equal(
    summarizeToolInput("TodoWrite", { todos: [{}, {}, {}] }),
    "3 items"
  );
  assert.equal(summarizeToolInput("TodoWrite", {}), "0 items");
});

test("summarizeToolInput — WebFetch/WebSearch return url/query", () => {
  assert.equal(
    summarizeToolInput("WebFetch", { url: "https://example.com" }),
    "https://example.com"
  );
  assert.equal(summarizeToolInput("WebSearch", { query: "claude code" }), "claude code");
});

test("summarizeToolInput — MCP tools pull the middle segment", () => {
  // `mcp__server__tool` → "tool"
  assert.equal(summarizeToolInput("mcp__ccd_session__mark_chapter", {}), "mark_chapter");
  // Malformed MCP name falls through to the tool itself
  assert.equal(summarizeToolInput("mcp__onlyone", {}), "mcp__onlyone");
});

test("summarizeToolInput — unknown tool returns empty string", () => {
  assert.equal(summarizeToolInput("CustomTool", { whatever: 1 }), "");
});
