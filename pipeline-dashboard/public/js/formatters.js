// Slice AC (Phase 2.5) — small string formatters extracted from app.js.
//
// None of these functions touch DOM, WebSocket, or pipeline state — they
// are pure data transformations used all over the renderer. Moving them
// into a UMD module lets Node tests exercise them directly, and lets
// app.js shrink without losing any behavior.
//
// Public API (via window.HarnessFormatters):
//   escapeHtml(str)                  — escape for innerHTML interpolation
//   shortPath(p)                     — last 2 path segments, POSIX/Win both
//   formatHMS(ts)                    — HH:MM:SS for a timestamp
//   summarizeToolInput(tool, input)  — one-line tool call summary for the feed
//
// The thin wrappers remain in app.js so every existing inline call site
// keeps compiling without a mass find-and-replace.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessFormatters = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function escapeHtml(str) {
    // Use the DOM when it's available (browser) — document.createElement
    // lets the engine do a correct textContent→innerHTML escape. Tests
    // run in Node where there is no document; fall back to a manual
    // replace that covers the critical five HTML-significant chars.
    if (typeof document !== "undefined" && typeof document.createElement === "function") {
      const d = document.createElement("div");
      d.textContent = str;
      return d.innerHTML;
    }
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function shortPath(p) {
    if (!p) return "";
    const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.slice(-2).join("/");
  }

  function formatHMS(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function summarizeToolInput(tool, input) {
    if (!input || typeof input !== "object") return "";
    if (tool === "Read" || tool === "Edit" || tool === "Write" || tool === "NotebookEdit") {
      return shortPath(input.filePath || input.file_path || input.notebook_path || "");
    }
    if (tool === "Grep" || tool === "Glob") return input.pattern || "";
    if (tool === "Bash") return String(input.command || "").slice(0, 80);
    if (tool === "Agent") return (input.description || input.subagent_type || "").slice(0, 50);
    if (tool === "TodoWrite") return `${(input.todos || []).length} items`;
    if (tool === "WebFetch") return input.url || "";
    if (tool === "WebSearch") return input.query || "";
    if (tool === "Skill") return input.skill || "";
    // MCP tools (mcp__xxx__yyy)
    if (typeof tool === "string" && tool.startsWith("mcp__")) {
      const parts = tool.split("__");
      return parts.length >= 3 ? parts[2] : tool;
    }
    return "";
  }

  return { escapeHtml, shortPath, formatHMS, summarizeToolInput };
});
