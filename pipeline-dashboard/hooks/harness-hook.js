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
const fs = require("fs");
const path = require("path");

// Load .env from pipeline-dashboard so HARNESS_TOKEN can be shared with server.
try {
  const { loadDotenv } = require("../executor/env-loader");
  loadDotenv(path.resolve(__dirname, ".."));
} catch (_) {
  // env-loader optional — hook must never fail because of config loading
}

const EVENT = process.argv[2] || "unknown";
const HOST = process.env.HARNESS_HOST || "127.0.0.1";
const PORT = parseInt(process.env.HARNESS_PORT || "4200", 10);
const TOKEN = process.env.HARNESS_TOKEN || "";
const DUMP_PAYLOADS = process.env.HARNESS_DUMP_PAYLOADS === "1";

// T2.0: dump raw hook payload to disk so we can discover the real field
// name for context_usage before implementing T2. Enabled by env var only.
function dumpPayload(payload) {
  if (!DUMP_PAYLOADS) return;
  try {
    const dir = path.resolve(__dirname, "..", "..", "_workspace", "hook-payload-samples");
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `${EVENT}-${ts}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  } catch (_) {
    // never let dumper break the hook
  }
}

// Per-event timeouts. Stop can trigger a Codex phase which itself waits up to
// 120s; we add margin so the hook doesn't bail before the critique is persisted.
const TIMEOUTS = {
  "user-prompt": 3000,
  "pre-tool": 1500,
  "post-tool": 1500,
  "stop": 180000,
  "session-end": 5000,
};
const TIMEOUT_MS = TIMEOUTS[EVENT] || 1500;

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

  dumpPayload(payload);

  const body = JSON.stringify({ event: EVENT, payload });
  const headers = {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  };
  if (TOKEN) headers["x-harness-token"] = TOKEN;
  const req = http.request(
    {
      host: HOST,
      port: PORT,
      path: "/api/hook",
      method: "POST",
      headers,
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
