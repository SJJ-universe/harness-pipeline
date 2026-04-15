// P1-6 — Codex trigger timeout + live progress console
//
// Goals:
//   1. Each trigger defines its own `timeoutMs` so plan-verify (heavy
//      reasoning) gets a generous window while quicker triggers stay lean.
//   2. CodexRunner.exec accepts `onChunk({stream, text})` and fires it as
//      stdout/stderr chunks arrive, so the UI can render a live console.
//   3. codex-triggers exports sensible defaults:
//        plan-verify   → 600000ms
//        code-review   → 300000ms
//        security-review → 300000ms
//        debug-analysis → 300000ms
//   4. getTriggers() exposes timeoutMs so the UI can show "max 5min" etc.
//
// Run: node executor/__p1-6-test.js

const { EventEmitter } = require("events");

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push(async () => {
    try {
      await fn();
      passed++;
      console.log("  ok  " + name);
    } catch (e) {
      failed++;
      console.error("  FAIL  " + name + "\n        " + (e.stack || e.message));
    }
  });
}

function section(name) {
  console.log("\n[" + name + "]");
}

// ─── Mock spawn to capture chunk callbacks ──────────────────────────────
const capturedSpawns = [];
function fakeSpawn(cmd, args, opts) {
  const ee = new EventEmitter();
  ee.cmd = cmd;
  ee.args = (args || []).slice();
  ee.opts = opts || {};
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.stdin = {
    _chunks: [],
    _ended: false,
    on() {},
    write(c) { this._chunks.push(String(c)); },
    end() { this._ended = true; },
  };
  ee.kill = () => {
    // Match real child_process: kill fires "exit" then "close".
    ee.emit("exit");
    setImmediate(() => ee.emit("close", null));
  };
  capturedSpawns.push(ee);
  return ee;
}

const childProcess = require("child_process");
const realSpawn = childProcess.spawn;
childProcess.spawn = fakeSpawn;
function restore() { childProcess.spawn = realSpawn; }

// ─── codex-triggers defaults ────────────────────────────────────────────
section("codex-triggers timeoutMs defaults");

const { getTriggers, getTriggerById, TRIGGERS } = require("../codex-triggers");

test("plan-verify timeoutMs ≥ 600000", () => {
  const t = getTriggerById("plan-verify");
  if (!t) throw new Error("plan-verify missing");
  if (typeof t.timeoutMs !== "number") throw new Error("timeoutMs not a number");
  if (t.timeoutMs < 600000) {
    throw new Error("plan-verify timeoutMs=" + t.timeoutMs + " < 600000");
  }
});

test("code-review / security-review / debug-analysis timeoutMs ≥ 300000", () => {
  for (const id of ["code-review", "security-review", "debug-analysis"]) {
    const t = getTriggerById(id);
    if (!t) throw new Error(id + " missing");
    if (typeof t.timeoutMs !== "number") {
      throw new Error(id + ": timeoutMs not set");
    }
    if (t.timeoutMs < 300000) {
      throw new Error(id + ": timeoutMs=" + t.timeoutMs + " < 300000");
    }
  }
});

test("getTriggers() exposes timeoutMs in the wire payload", () => {
  const list = getTriggers();
  for (const t of list) {
    if (typeof t.timeoutMs !== "number") {
      throw new Error("wire payload missing timeoutMs on " + t.id);
    }
  }
});

// ─── CodexRunner onChunk callback ───────────────────────────────────────
section("CodexRunner onChunk callback");

const { CodexRunner } = require("../executor/codex-runner");

test("CodexRunner forwards stdout chunks to onChunk", async () => {
  capturedSpawns.length = 0;
  const events = [];
  const runner = new CodexRunner({});
  const p = runner.exec("x", {
    timeoutMs: 5000,
    onChunk: (ev) => events.push(ev),
  });
  const s = capturedSpawns[0];
  if (!s) throw new Error("spawn not invoked");
  // Emit two stdout chunks then close
  setImmediate(() => {
    s.stdout.emit("data", Buffer.from("hello "));
    s.stdout.emit("data", Buffer.from("world"));
    s.emit("close", 0);
  });
  const res = await p;
  if (!res.ok) throw new Error("exec not ok: " + JSON.stringify(res));
  const stdoutEvents = events.filter((e) => e.stream === "stdout");
  if (stdoutEvents.length !== 2) {
    throw new Error("expected 2 stdout events, got " + stdoutEvents.length);
  }
  if (stdoutEvents[0].text !== "hello ") throw new Error("chunk 0 text");
  if (stdoutEvents[1].text !== "world") throw new Error("chunk 1 text");
});

test("CodexRunner forwards stderr chunks to onChunk", async () => {
  capturedSpawns.length = 0;
  const events = [];
  const runner = new CodexRunner({});
  const p = runner.exec("x", {
    timeoutMs: 5000,
    onChunk: (ev) => events.push(ev),
  });
  const s = capturedSpawns[0];
  setImmediate(() => {
    s.stderr.emit("data", Buffer.from("Reading prompt from stdin..."));
    s.stdout.emit("data", Buffer.from(""));
    s.emit("close", 0);
  });
  await p;
  const errEvents = events.filter((e) => e.stream === "stderr");
  if (errEvents.length !== 1) {
    throw new Error("expected 1 stderr event, got " + errEvents.length);
  }
  if (!errEvents[0].text.includes("Reading prompt from stdin")) {
    throw new Error("stderr chunk text mismatch");
  }
});

test("CodexRunner without onChunk still collects stdout (regression)", async () => {
  capturedSpawns.length = 0;
  const runner = new CodexRunner({});
  const p = runner.exec("x", { timeoutMs: 5000 });
  const s = capturedSpawns[0];
  setImmediate(() => {
    s.stdout.emit("data", Buffer.from("no-callback-path"));
    s.emit("close", 0);
  });
  const res = await p;
  if (!res.stdout.includes("no-callback-path")) {
    throw new Error("stdout not collected when onChunk is absent");
  }
});

test("CodexRunner respects the caller's timeoutMs (chunked kill path)", async () => {
  capturedSpawns.length = 0;
  const runner = new CodexRunner({});
  const t0 = Date.now();
  const p = runner.exec("x", { timeoutMs: 80 });
  // Intentionally DO NOT emit close — the timer should fire and kill().
  const s = capturedSpawns[0];
  let killed = false;
  const origKill = s.kill.bind(s);
  s.kill = () => {
    killed = true;
    origKill();
  };
  const res = await p;
  const dt = Date.now() - t0;
  if (!killed) throw new Error("kill not invoked after timeoutMs");
  if (dt < 60) throw new Error("kill fired too early, dt=" + dt);
  if (res.ok) throw new Error("expected ok:false when killed by timer");
});

// ─── Cleanup ────────────────────────────────────────────────────────────
(async () => {
  for (const run of pending) await run();
  restore();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
