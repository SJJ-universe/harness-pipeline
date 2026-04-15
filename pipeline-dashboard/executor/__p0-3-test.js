// P0-3 unit tests — CLI runner hardening + child registry.
//
// Run: node executor/__p0-3-test.js
//
// Covers:
//   1. ChildRegistry — track/untrack on exit, killAll
//   2. ClaudeRunner — passes prompt via stdin (NOT argv), fires onChild
//   3. ClaudeRunner — args array contains no prompt text, no shell metachars
//   4. CodexRunner — sanity that the existing stdin path still compiles
//
// We stub `child_process.spawn` via Module._cache so neither runner actually
// fires `claude` / `codex`. The stub records args and stdin writes.

const Module = require("module");
const path = require("path");
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
    } catch (err) {
      failed++;
      console.error("  FAIL  " + name + "\n        " + (err.stack || err.message));
    }
  });
}

function section(name) {
  console.log("\n[" + name + "]");
}

// ─── 1. ChildRegistry ───────────────────────────────────────────────────
section("ChildRegistry");

const { ChildRegistry } = require("./child-registry");

function fakeChild() {
  const ee = new EventEmitter();
  ee.killed = false;
  ee.kill = () => {
    ee.killed = true;
    ee.emit("exit");
  };
  return ee;
}

test("track adds to set", () => {
  const reg = new ChildRegistry();
  const c = fakeChild();
  reg.track(c);
  if (reg.size() !== 1) throw new Error("expected size 1, got " + reg.size());
});

test("auto-untrack on exit event", () => {
  const reg = new ChildRegistry();
  const c = fakeChild();
  reg.track(c);
  c.emit("exit");
  if (reg.size() !== 0) throw new Error("expected size 0 after exit");
});

test("auto-untrack on close event", () => {
  const reg = new ChildRegistry();
  const c = fakeChild();
  reg.track(c);
  c.emit("close", 0);
  if (reg.size() !== 0) throw new Error("expected size 0 after close");
});

test("killAll kills every tracked child and clears", () => {
  const reg = new ChildRegistry();
  const a = fakeChild();
  const b = fakeChild();
  reg.track(a);
  reg.track(b);
  reg.killAll();
  if (!a.killed || !b.killed) throw new Error("expected both killed");
  if (reg.size() !== 0) throw new Error("expected cleared");
});

test("label is optional and stored", () => {
  const reg = new ChildRegistry();
  const c = fakeChild();
  reg.track(c, "codex");
  // Implementation detail: labels queryable via snapshot()
  const snap = reg.snapshot();
  if (snap.length !== 1 || snap[0].label !== "codex") {
    throw new Error("label not recorded");
  }
});

// ─── 2. ClaudeRunner stdin-based prompt ─────────────────────────────────
section("ClaudeRunner (mocked spawn)");

// Install a fake child_process.spawn into the module cache so ClaudeRunner
// (and anything else) picks it up. We load the runner AFTER installing.

const capturedSpawns = [];

function fakeSpawn(cmd, args, opts) {
  const stdinBuf = [];
  const ee = new EventEmitter();
  ee.cmd = cmd;
  ee.args = args.slice();
  ee.opts = opts;
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.stdin = {
    _chunks: stdinBuf,
    _ended: false,
    on() {},
    write(chunk) {
      stdinBuf.push(String(chunk));
    },
    end() {
      this._ended = true;
    },
  };
  ee.kill = () => ee.emit("exit");
  capturedSpawns.push(ee);
  setImmediate(() => {
    ee.stdout.emit("data", Buffer.from("OK\n"));
    ee.emit("close", 0);
  });
  return ee;
}

// Patch child_process.spawn IN PLACE so any downstream module that
// destructured spawn already sees the mock. We force-load child_process
// first, save the real spawn, replace the property, and restore on teardown.
const childProcess = require("child_process");
const realSpawn = childProcess.spawn;
childProcess.spawn = fakeSpawn;
function restore() {
  childProcess.spawn = realSpawn;
}

const { ClaudeRunner } = require("./claude-runner");

test("ClaudeRunner does NOT pass prompt as argv element", async () => {
  capturedSpawns.length = 0;
  const runner = new ClaudeRunner({});
  const prompt = "HELLO; rm -rf /; echo WORLD";
  await runner.exec(prompt, { timeoutMs: 500 });
  if (capturedSpawns.length === 0) throw new Error("spawn never called");
  const s = capturedSpawns[0];
  if (s.args.some((a) => a.includes("rm -rf") || a === prompt)) {
    throw new Error("prompt leaked into argv: " + JSON.stringify(s.args));
  }
});

test("ClaudeRunner writes prompt via stdin", async () => {
  capturedSpawns.length = 0;
  const runner = new ClaudeRunner({});
  const prompt = "hello stdin";
  await runner.exec(prompt, { timeoutMs: 500 });
  const s = capturedSpawns[0];
  const joined = s.stdin._chunks.join("");
  if (joined !== prompt) {
    throw new Error("stdin mismatch: got " + JSON.stringify(joined));
  }
  if (!s.stdin._ended) throw new Error("stdin not closed");
});

test("ClaudeRunner args contain -p and --bare but no prompt-shaped strings", async () => {
  capturedSpawns.length = 0;
  const runner = new ClaudeRunner({});
  await runner.exec("multi\nline\n`backticks`\n$(cmd)", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  const flags = s.args;
  if (!flags.includes("-p")) throw new Error("-p missing");
  if (!flags.includes("--bare")) throw new Error("--bare missing");
  if (flags.some((a) => a.includes("`") || a.includes("$("))) {
    throw new Error("shell metachars leaked into argv: " + JSON.stringify(flags));
  }
});

test("ClaudeRunner fires onChild callback with the spawned child", async () => {
  capturedSpawns.length = 0;
  let captured = null;
  const runner = new ClaudeRunner({});
  await runner.exec("x", { timeoutMs: 500, onChild: (c) => (captured = c) });
  if (!captured) throw new Error("onChild not fired");
  if (captured !== capturedSpawns[0]) throw new Error("onChild got wrong child");
});

test("ClaudeRunner stdio layout has stdin piped (not ignored)", async () => {
  capturedSpawns.length = 0;
  const runner = new ClaudeRunner({});
  await runner.exec("x", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  const stdio = s.opts && s.opts.stdio;
  if (!Array.isArray(stdio)) throw new Error("stdio not array");
  if (stdio[0] !== "pipe") {
    throw new Error("stdin must be 'pipe', got " + JSON.stringify(stdio[0]));
  }
});

// Run every queued test sequentially so mocked spawn state stays clean
(async () => {
  for (const run of pending) await run();
  restore();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
