// T9 live verification — V-T9-3 (hook entry) and V-T9-4 (executor entry)
//
// Run (dashboard must be listening on 4200):
//   node executor/__t9-live-verify.js

const http = require("http");
const WebSocket = require("ws");
const { PipelineExecutor } = require("./pipeline-executor");
const templates = require("../pipeline-templates.json");

const HOST = "127.0.0.1";
const PORT = 4200;

function post(event, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ event, payload });
    const req = http.request({
      host: HOST, port: PORT, path: "/api/hook", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const fails = [];
  const wsEvents = [];

  // Subscribe to broadcasts first
  const ws = new WebSocket(`ws://${HOST}:${PORT}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.on("message", (buf) => {
    try { wsEvents.push(JSON.parse(buf.toString())); } catch (_) {}
  });

  console.log("[live] WS connected");

  // ── V-T9-3: /api/hook injection blocks git reset --hard ──
  const r1 = await post("pre-tool", {
    session_id: "vt9-live",
    tool_name: "Bash",
    tool_input: { command: "git reset --hard HEAD" },
  });
  console.log(`V-T9-3a POST: status=${r1.status} body=${r1.body}`);
  try {
    const parsed = JSON.parse(r1.body);
    if (parsed.decision !== "block") {
      fails.push(`V-T9-3a: expected decision=block, got ${JSON.stringify(parsed)}`);
    }
  } catch (e) {
    fails.push(`V-T9-3a: body not JSON: ${r1.body}`);
  }

  // ── V-T9-3b: /api/hook allows a benign command ──
  const r2 = await post("pre-tool", {
    session_id: "vt9-live",
    tool_name: "Bash",
    tool_input: { command: "git status" },
  });
  console.log(`V-T9-3b POST: status=${r2.status} body=${r2.body}`);
  try {
    const parsed = JSON.parse(r2.body);
    if (parsed.decision === "block") {
      fails.push(`V-T9-3b: benign git status should not be blocked: ${r2.body}`);
    }
  } catch (e) {
    fails.push(`V-T9-3b: body not JSON: ${r2.body}`);
  }

  // ── V-T9-3c: /api/hook blocks Write to .env ──
  const r3 = await post("pre-tool", {
    session_id: "vt9-live",
    tool_name: "Write",
    tool_input: { file_path: "apps/web/.env.local" },
  });
  console.log(`V-T9-3c POST: status=${r3.status} body=${r3.body}`);
  try {
    const parsed = JSON.parse(r3.body);
    if (parsed.decision !== "block") {
      fails.push(`V-T9-3c: .env.local write should block: ${r3.body}`);
    }
  } catch (e) {
    fails.push(`V-T9-3c: body not JSON: ${r3.body}`);
  }

  // Wait a tick for WS broadcasts
  await sleep(200);

  const dangersBlocked = wsEvents.filter((e) => e.type === "dangers_blocked");
  console.log(`[live] dangers_blocked broadcasts received: ${dangersBlocked.length}`);
  if (dangersBlocked.length < 2) {
    fails.push(`V-T9-3d: expected at least 2 dangers_blocked broadcasts, got ${dangersBlocked.length}`);
  }
  // V-T9-3e: entry marker must be "hook"
  for (const ev of dangersBlocked) {
    if (ev.data && ev.data.entry !== "hook") {
      fails.push(`V-T9-3e: hook-entry broadcasts should have entry="hook", got ${ev.data.entry}`);
    }
  }

  ws.close();

  // ── V-T9-4: direct PipelineExecutor.onPreTool simulation ──
  console.log("\n[V-T9-4] direct executor.onPreTool simulation");
  const capturedEvents = [];
  const ex = new PipelineExecutor({
    broadcast: (ev) => capturedEvents.push(ev),
    templates,
    codex: { async exec() { return { ok: true, summary: "", findings: [] }; } },
  });
  // Intentionally leave ex.enabled = false — danger gate must still fire.

  const d1 = await ex.onPreTool("Bash", { command: "rm -rf /tmp/safe-test" });
  console.log(`V-T9-4a: ${JSON.stringify(d1)}`);
  if (d1.decision !== "block") {
    fails.push(`V-T9-4a: executor should block rm -rf even when disabled, got ${JSON.stringify(d1)}`);
  }

  const d2 = await ex.onPreTool("Write", { file_path: "/secrets/.env" });
  console.log(`V-T9-4b: ${JSON.stringify(d2)}`);
  if (d2.decision !== "block") {
    fails.push(`V-T9-4b: executor should block .env write even when disabled, got ${JSON.stringify(d2)}`);
  }

  const d3 = await ex.onPreTool("Edit", { file_path: ".claude/agents/context-analyzer.md" });
  console.log(`V-T9-4c: ${JSON.stringify(d3)}`);
  if (d3.decision === "block") {
    fails.push(`V-T9-4c: .claude edit must NOT be blocked (no self-block): ${JSON.stringify(d3)}`);
  }

  const d4 = await ex.onPreTool("Bash", { command: "git status" });
  console.log(`V-T9-4d: ${JSON.stringify(d4)}`);
  if (d4.decision === "block") {
    fails.push(`V-T9-4d: benign command must not be blocked: ${JSON.stringify(d4)}`);
  }

  // V-T9-4e: captured broadcasts contain executor-entry dangers_blocked
  const execBlocks = capturedEvents.filter(
    (e) => e.type === "dangers_blocked" && e.data && e.data.entry === "executor"
  );
  console.log(`[V-T9-4e] executor-entry dangers_blocked: ${execBlocks.length}`);
  if (execBlocks.length !== 2) {
    fails.push(`V-T9-4e: expected 2 executor-entry broadcasts (rm + .env), got ${execBlocks.length}`);
  }

  if (fails.length === 0) {
    console.log("\nALL PASS — V-T9-3 (hook) and V-T9-4 (executor) both block and broadcast correctly");
    process.exit(0);
  } else {
    console.error("\nFAIL:");
    for (const f of fails) console.error("  - " + f);
    process.exit(1);
  }
})().catch((err) => {
  console.error("live-verify error:", err);
  process.exit(2);
});
