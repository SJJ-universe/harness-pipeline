// T2 verification harness — ContextAlarm module
//
// Run: node executor/__t2-context-test.js
//
// rev2 M8: failing-first. This test file must run BEFORE context-alarm.js
// exists. All cases should fail on first run, then pass after T2 implementation.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

let mod;
try {
  mod = require("./context-alarm");
} catch (e) {
  console.error("context-alarm module not found — this is EXPECTED on failing-first run");
  console.error(e.message);
  process.exit(1);
}
const { ContextAlarm, estimateContextUsage, getContextUsage } = mod;

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

// ── V-T2-1: notice alarm at 40% threshold ──
test("V-T2-1: context_usage 0.42 broadcasts one notice alarm", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  const out = alarm.evaluate({ session_id: "s1", context_usage: 0.42 });
  assert.strictEqual(fired.length, 1, "expected exactly 1 broadcast");
  assert.strictEqual(fired[0].type, "context_alarm");
  assert.strictEqual(fired[0].data.severity, "notice");
  assert.ok(out.fired === 1, "return payload should report fired=1");
});

// ── V-T2-2: duplicate suppression for 40% tier ──
test("V-T2-2: repeated 0.42 events do not re-fire notice", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  alarm.evaluate({ session_id: "s1", context_usage: 0.42 });
  alarm.evaluate({ session_id: "s1", context_usage: 0.43 });
  alarm.evaluate({ session_id: "s1", context_usage: 0.50 });
  assert.strictEqual(fired.length, 1, "only the first notice should broadcast");
});

// ── V-T2-3: crossing to 55% fires warn after notice ──
test("V-T2-3: crossing from 0.42 to 0.58 fires warn once", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  alarm.evaluate({ session_id: "s1", context_usage: 0.42 });
  alarm.evaluate({ session_id: "s1", context_usage: 0.58 });
  alarm.evaluate({ session_id: "s1", context_usage: 0.60 });
  assert.strictEqual(fired.length, 2, "notice + warn, no more");
  assert.strictEqual(fired[0].data.severity, "notice");
  assert.strictEqual(fired[1].data.severity, "warn");
});

// ── V-T2-4: never returns block decision (rev2 H5) ──
test("V-T2-4: ContextAlarm.evaluate never returns block/decision", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  const out = alarm.evaluate({ session_id: "s1", context_usage: 0.90 });
  assert.ok(out, "should return an object");
  assert.strictEqual(out.block, undefined, "must not set block");
  assert.strictEqual(out.decision, undefined, "must not set decision");
  assert.ok(out.fired >= 1, "should broadcast for 0.90");
});

// ── V-T2-5: transcript_path fallback estimates via file size ──
test("V-T2-5: estimateContextUsage uses transcript_path file size", () => {
  const tmp = path.join(os.tmpdir(), `harness-t2-${process.pid}-${Date.now()}.jsonl`);
  // 320_000 bytes ≈ 80_000 tokens ÷ 200_000 limit = 0.40
  fs.writeFileSync(tmp, "x".repeat(320_000));
  try {
    const usage = estimateContextUsage(tmp);
    assert.ok(
      usage >= 0.39 && usage <= 0.41,
      `expected usage ≈0.40, got ${usage}`
    );
  } finally {
    fs.unlinkSync(tmp);
  }
});

// ── V-T2-6: getContextUsage prefers explicit context_usage over transcript_path ──
test("V-T2-6: getContextUsage returns payload.context_usage when present", () => {
  const usage = getContextUsage({ context_usage: 0.33, transcript_path: "/nonexistent" });
  assert.strictEqual(usage, 0.33);
});

// ── V-T2-7: jump directly past both thresholds fires single warn ──
test("V-T2-7: going straight to 0.58 fires warn, not notice", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  alarm.evaluate({ session_id: "s1", context_usage: 0.58 });
  assert.strictEqual(fired.length, 1);
  assert.strictEqual(fired[0].data.severity, "warn");
});

// ── V-T2-8: separate sessions tracked independently ──
test("V-T2-8: different session_id gets its own alarm state", () => {
  const fired = [];
  const alarm = new ContextAlarm({ broadcast: (ev) => fired.push(ev) });
  alarm.evaluate({ session_id: "sA", context_usage: 0.42 });
  alarm.evaluate({ session_id: "sB", context_usage: 0.42 });
  assert.strictEqual(fired.length, 2, "each session fires its own notice");
});

// ── V-T2-9: missing transcript_path returns 0 (no crash) ──
test("V-T2-9: missing transcript_path yields 0 without throwing", () => {
  const usage = estimateContextUsage(undefined);
  assert.strictEqual(usage, 0);
});

const failed = results.filter((r) => !r.ok).length;
const total = results.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed === 0 ? 0 : 1);
