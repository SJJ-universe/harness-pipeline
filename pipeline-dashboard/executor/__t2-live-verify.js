// T2 live verification — connects to the running dashboard over WebSocket,
// POSTs synthetic hook payloads to /api/hook, and asserts that
// `context_alarm` events are broadcast with the right severity/count.
//
// Run (server must be listening on 4200):
//   node executor/__t2-live-verify.js

const http = require("http");
const WebSocket = require("ws");

const HOST = "127.0.0.1";
const PORT = 4200;
const SESSION_ID = "vt2-live-" + Date.now();

const received = [];

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
  const ws = new WebSocket(`ws://${HOST}:${PORT}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.on("message", (buf) => {
    try {
      const ev = JSON.parse(buf.toString());
      if (ev.type === "context_alarm") received.push(ev);
    } catch (_) {}
  });

  console.log(`[live] WS connected, session=${SESSION_ID}`);

  // V-T2-1: first 0.42 → notice
  let res = await post("pre-tool", { session_id: SESSION_ID, tool_name: "Read", context_usage: 0.42 });
  console.log(`V-T2-1 POST: status=${res.status} body=${res.body}`);

  // V-T2-2: duplicate 0.42 → no new broadcast
  res = await post("pre-tool", { session_id: SESSION_ID, tool_name: "Read", context_usage: 0.43 });
  console.log(`V-T2-2 POST: status=${res.status} body=${res.body}`);

  // V-T2-3: cross to 0.58 → warn
  res = await post("pre-tool", { session_id: SESSION_ID, tool_name: "Read", context_usage: 0.58 });
  console.log(`V-T2-3 POST: status=${res.status} body=${res.body}`);

  // V-T2-4: Stop at 0.90 → response must not include block/decision
  res = await post("stop", { session_id: SESSION_ID, context_usage: 0.90 });
  console.log(`V-T2-4 POST: status=${res.status} body=${res.body}`);

  await sleep(300); // drain WS
  ws.close();

  const ours = received.filter((ev) => ev.data && ev.data.sessionId === SESSION_ID);
  console.log(`\n[live] context_alarm events for our session: ${ours.length}`);
  for (const ev of ours) {
    console.log(`  - severity=${ev.data.severity} usage=${ev.data.usage} threshold=${ev.data.threshold}`);
  }

  const fails = [];

  // V-T2-1 assertion
  const notice = ours.filter((e) => e.data.severity === "notice");
  if (notice.length !== 1) fails.push(`V-T2-1: expected exactly 1 notice, got ${notice.length}`);

  // V-T2-3 assertion
  const warn = ours.filter((e) => e.data.severity === "warn");
  if (warn.length !== 1) fails.push(`V-T2-3: expected exactly 1 warn, got ${warn.length}`);

  // V-T2-2 assertion — total alarms should be 2, not 3+ (duplicate suppression)
  if (ours.length !== 2) fails.push(`V-T2-2: expected 2 total alarms, got ${ours.length}`);

  // V-T2-4 assertion — stop response must not contain block or decision:block
  try {
    const parsed = JSON.parse(res.body);
    if (parsed.block === true || parsed.decision === "block") {
      fails.push(`V-T2-4: Stop response included block — rev2 H5 violation: ${res.body}`);
    }
  } catch (_) {
    fails.push(`V-T2-4: Stop body not parseable JSON: ${res.body}`);
  }

  if (fails.length === 0) {
    console.log("\nALL PASS — V-T2-1, V-T2-2, V-T2-3, V-T2-4");
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
