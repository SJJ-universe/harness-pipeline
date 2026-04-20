#!/usr/bin/env node
// Harness Hook Bridge
// Claude Code hook → HTTP POST /api/hook → JSON response back to Claude
//
// Invocation (from .claude/settings.json):
//   node pipeline-dashboard/hooks/harness-hook.js <event>
//
// Where <event> is one of:
//   user-prompt | pre-tool | post-tool | stop | session-end
//   session-start | subagent-start | subagent-stop | notification | pre-compact  (Slice A v4)
//
// Claude Code sends hook payload as JSON on stdin and expects JSON on stdout.
// On any failure we exit(0) with empty stdout so Claude is never blocked by harness issues.

const http = require("http");
const fs = require("fs");
const path = require("path");

const EVENT = process.argv[2] || "unknown";
const HOST = process.env.HARNESS_HOST || "127.0.0.1";
const PORT = parseInt(process.env.HARNESS_PORT || "4201", 10);
const HARNESS_ROOT = process.env.HARNESS_ROOT || path.resolve(__dirname, "..", "..");

function readHarnessToken() {
  if (process.env.HARNESS_TOKEN) return process.env.HARNESS_TOKEN;
  try {
    return fs.readFileSync(path.join(HARNESS_ROOT, ".harness", "local-token"), "utf-8").trim();
  } catch (_) {
    return "";
  }
}

// Per-event timeouts. Stop can trigger a Codex phase which itself waits up to
// 120s; we add margin so the hook doesn't bail before the critique is persisted.
// pre-compact writes a summary file + checkpoint, so it gets extra headroom.
const TIMEOUTS = {
  "user-prompt": 3000,
  "pre-tool": 1500,
  "post-tool": 1500,
  "stop": 180000,
  "session-end": 5000,
  // Slice A (v4)
  "session-start": 3000,    // may read .harness/last-compact-summary.md on source=compact
  "subagent-start": 1500,
  "subagent-stop": 1500,
  "notification": 1500,
  "pre-compact": 5000,      // disk write + checkpoint save + replay flush
};
const TIMEOUT_MS = TIMEOUTS[EVENT] || 1500;

// P-1 Performance: safe read-only tools fire HTTP but don't wait for response
const FIRE_AND_FORGET_TOOLS = new Set([
  "Read", "Glob", "Grep", "Agent", "TodoWrite", "WebSearch", "WebFetch",
]);

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let payload = {};
  try {
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (raw.trim()) payload = JSON.parse(raw);
  } catch (_) {
    // malformed stdin — send empty payload
  }

  const body = JSON.stringify({ event: EVENT, payload });

  // Fast path: post-tool events for safe tools → fire HTTP and exit immediately
  if (EVENT === "post-tool" && FIRE_AND_FORGET_TOOLS.has(payload?.tool_name)) {
    const fastReq = http.request(
      {
        host: HOST,
        port: PORT,
        path: "/api/hook",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-harness-token": readHarnessToken(),
        },
        timeout: 2000,
      },
      () => {} // ignore response
    );
    fastReq.on("error", () => {});
    fastReq.on("timeout", () => { try { fastReq.destroy(); } catch (_) {} });
    fastReq.write(body);
    fastReq.end(() => {
      // Wait for TCP flush before exiting — prevents dropped telemetry
      process.stdout.write("{}");
      process.exit(0);
    });
    // Hard timeout: exit even if flush stalls (200ms max)
    setTimeout(() => {
      process.stdout.write("{}");
      process.exit(0);
    }, 200);
    return; // prevent fall-through to normal HTTP path
  }

  const req = http.request(
    {
      host: HOST,
      port: PORT,
      path: "/api/hook",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "x-harness-token": readHarnessToken(),
      },
      timeout: TIMEOUT_MS,
    },
    (res) => {
      const out = [];
      res.on("data", (c) => out.push(c));
      res.on("end", () => {
        const text = Buffer.concat(out).toString("utf-8");
        process.stdout.write(text || "{}");
        process.exit(0);
      });
    }
  );

  req.on("error", () => process.exit(0));
  req.on("timeout", () => {
    req.destroy();
    process.exit(0);
  });

  req.write(body);
  req.end();
});

process.stdin.on("error", () => process.exit(0));
