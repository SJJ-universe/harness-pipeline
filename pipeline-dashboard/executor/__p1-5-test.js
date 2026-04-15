// P1-5 — Node 24 DEP0190 fix: CodexRunner/ClaudeRunner must not pass
// `shell: true` to child_process.spawn alongside an args array.
//
// Historical context: on Windows we had to use `shell: true` so that
// `codex.cmd` and `claude.cmd` got resolved via PATHEXT. Node 24 deprecates
// that combo (args + shell:true → shell concatenation is unsafe). The fix is
// to manually invoke cmd.exe with /c on Windows and stop asking Node to run
// things through a shell.
//
// This test mocks child_process.spawn and asserts:
//   1. `opts.shell` is never truthy for either runner.
//   2. On win32, the runner invokes `cmd.exe` with `["/c", spec.cmd, ...]`.
//   3. Fixed flags are still present (regression against the P0-3 fix):
//        - ClaudeRunner: -p, --bare, --dangerously-skip-permissions
//        - CodexRunner: exec, --full-auto, --skip-git-repo-check
//   4. Prompt still reaches stdin (regression against P0-3).
//   5. onChild callback still fires (ClaudeRunner).
//   6. A real end-to-end `node -e "console.log('p1-5-probe')"` spawn with
//      the helper pattern emits no DeprecationWarning on stderr.
//
// Run: node executor/__p1-5-test.js

const { EventEmitter } = require("events");
const { spawnSync } = require("child_process");

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

// ── Mock spawn ──────────────────────────────────────────────────────────
const capturedSpawns = [];

function fakeSpawn(cmd, args, opts) {
  const stdinBuf = [];
  const ee = new EventEmitter();
  ee.cmd = cmd;
  ee.args = (args || []).slice();
  ee.opts = opts || {};
  ee.stdout = new EventEmitter();
  ee.stderr = new EventEmitter();
  ee.stdin = {
    _chunks: stdinBuf,
    _ended: false,
    on() {},
    write(c) {
      stdinBuf.push(String(c));
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

const childProcess = require("child_process");
const realSpawn = childProcess.spawn;
childProcess.spawn = fakeSpawn;
function restore() {
  childProcess.spawn = realSpawn;
}

const { ClaudeRunner } = require("./claude-runner");
const { CodexRunner } = require("./codex-runner");

const isWin = process.platform === "win32";

// ── ClaudeRunner ────────────────────────────────────────────────────────
section("ClaudeRunner (no shell:true)");

test("ClaudeRunner: opts.shell is not truthy", async () => {
  capturedSpawns.length = 0;
  const r = new ClaudeRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.opts.shell) {
    throw new Error(
      "shell=" + JSON.stringify(s.opts.shell) + " — must be falsy"
    );
  }
});

test("ClaudeRunner: on win32 uses cmd.exe /c wrapper", async () => {
  if (!isWin) {
    console.log("    (skipped — non-Windows host)");
    return;
  }
  capturedSpawns.length = 0;
  const r = new ClaudeRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.cmd.toLowerCase() !== "cmd.exe") {
    throw new Error("expected cmd.exe, got " + s.cmd);
  }
  if (s.args[0] !== "/c") {
    throw new Error("expected /c as first arg, got " + s.args[0]);
  }
  if (s.args[1] !== "claude") {
    throw new Error("expected 'claude' as second arg, got " + s.args[1]);
  }
});

test("ClaudeRunner: fixed flags still present after wrapping", async () => {
  capturedSpawns.length = 0;
  const r = new ClaudeRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  const hay = s.args.join(" ");
  if (!hay.includes("-p")) throw new Error("-p missing: " + hay);
  if (!hay.includes("--bare")) throw new Error("--bare missing: " + hay);
  if (!hay.includes("--dangerously-skip-permissions")) {
    throw new Error("--dangerously-skip-permissions missing: " + hay);
  }
});

test("ClaudeRunner: prompt still reaches stdin", async () => {
  capturedSpawns.length = 0;
  const r = new ClaudeRunner({});
  await r.exec("PROBE-STDIN", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.stdin._chunks.join("") !== "PROBE-STDIN") {
    throw new Error("stdin mismatch: " + JSON.stringify(s.stdin._chunks));
  }
  if (!s.stdin._ended) throw new Error("stdin not closed");
});

test("ClaudeRunner: onChild still fires", async () => {
  capturedSpawns.length = 0;
  let got = null;
  const r = new ClaudeRunner({});
  await r.exec("x", { timeoutMs: 500, onChild: (c) => (got = c) });
  if (!got) throw new Error("onChild not fired");
  if (got !== capturedSpawns[0]) throw new Error("onChild wrong child");
});

// ── CodexRunner ─────────────────────────────────────────────────────────
section("CodexRunner (no shell:true)");

test("CodexRunner: opts.shell is not truthy", async () => {
  capturedSpawns.length = 0;
  const r = new CodexRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.opts.shell) {
    throw new Error("shell=" + JSON.stringify(s.opts.shell));
  }
});

test("CodexRunner: on win32 uses cmd.exe /c wrapper", async () => {
  if (!isWin) {
    console.log("    (skipped — non-Windows host)");
    return;
  }
  capturedSpawns.length = 0;
  const r = new CodexRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.cmd.toLowerCase() !== "cmd.exe") {
    throw new Error("expected cmd.exe, got " + s.cmd);
  }
  if (s.args[0] !== "/c") {
    throw new Error("expected /c as first arg, got " + s.args[0]);
  }
  if (s.args[1] !== "codex") {
    throw new Error("expected 'codex' as second arg, got " + s.args[1]);
  }
});

test("CodexRunner: fixed flags still present after wrapping", async () => {
  capturedSpawns.length = 0;
  const r = new CodexRunner({});
  await r.exec("hello", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  const hay = s.args.join(" ");
  if (!hay.includes("exec")) throw new Error("exec missing: " + hay);
  if (!hay.includes("--full-auto")) throw new Error("--full-auto missing: " + hay);
  if (!hay.includes("--skip-git-repo-check")) {
    throw new Error("--skip-git-repo-check missing: " + hay);
  }
});

test("CodexRunner: prompt still reaches stdin", async () => {
  capturedSpawns.length = 0;
  const r = new CodexRunner({});
  await r.exec("CODEX-PROBE", { timeoutMs: 500 });
  const s = capturedSpawns[0];
  if (s.stdin._chunks.join("") !== "CODEX-PROBE") {
    throw new Error("stdin mismatch: " + JSON.stringify(s.stdin._chunks));
  }
});

// ── Real-spawn smoke test: no DEP0190 warning ──────────────────────────
section("DEP0190 smoke test");

test("real cmd.exe /c node -e <probe> emits no DeprecationWarning on stderr", () => {
  if (!isWin) {
    console.log("    (skipped — non-Windows host)");
    return;
  }
  // Use the REAL spawn (save and restore it), bypassing our fake.
  const real = realSpawn;
  const r = real.call(
    childProcess,
    "cmd.exe",
    ["/c", process.execPath, "-e", "console.log('p1-5-probe')"],
    { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true }
  );
  // spawnSync would be cleaner but we already have the real one; emulate
  // synchronous wait via spawnSync separately for the final assertion.
  const sync = spawnSync(
    "cmd.exe",
    ["/c", process.execPath, "-e", "console.log('p1-5-probe')"],
    { encoding: "utf-8", shell: false, windowsHide: true }
  );
  if (sync.status !== 0) {
    throw new Error("probe failed, status=" + sync.status + " stderr=" + sync.stderr);
  }
  if (/DEP0190|DeprecationWarning/.test(sync.stderr || "")) {
    throw new Error("DEP0190 warning leaked: " + sync.stderr);
  }
  if (!/p1-5-probe/.test(sync.stdout || "")) {
    throw new Error("probe output missing, stdout=" + sync.stdout);
  }
  try { r.kill(); } catch (_) {}
});

(async () => {
  for (const t of pending) await t();
  restore();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
