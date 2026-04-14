#!/usr/bin/env node
// Harness Hook Bridge
// Claude Code hook → HTTP POST /api/hook → JSON response back to Claude
//
// Invocation (from .claude/settings.json):
//   node pipeline-dashboard/hooks/harness-hook.js <event>
//
// Where <event> is one of: user-prompt | pre-tool | post-tool | stop | session-end
//
// Claude Code sends hook payload as JSON on stdin and expects JSON on stdout.
// On any failure we exit(0) with empty stdout so Claude is never blocked by harness issues.

const http = require("http");

const EVENT = process.argv[2] || "unknown";
const HOST = process.env.HARNESS_HOST || "127.0.0.1";
const PORT = parseInt(process.env.HARNESS_PORT || "4200", 10);
const TIMEOUT_MS = 1500;

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
  const req = http.request(
    {
      host: HOST,
      port: PORT,
      path: "/api/hook",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
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
