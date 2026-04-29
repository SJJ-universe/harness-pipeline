// Slice S3 (Phase 3-S, 2026-04-27) — runner ↔ childRegistry wiring proof.
//
// The unit suite (tests/unit/childRegistry.test.js) covers the registry in
// isolation. This integration suite proves the *wiring*:
//   1. CodexRunner.exec spawns a child and registers it with the registry.
//   2. When the spawn resolves (close event), the child is unregistered.
//   3. server.js gracefulShutdown function references childRegistry.killAll
//      with both SIGTERM and SIGKILL signals.
//   4. server.js still wires the registry into both runners.
// We use a controllable mock spawn so the test stays deterministic without
// needing a real codex/claude binary.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CodexRunner } = require("../../executor/codex-runner");
const { createChildRegistry } = require("../../src/runtime/childRegistry");
const { createChildSemaphore } = require("../../src/runtime/childSemaphore");

// Mock spawn that returns a controllable child object.
function mockSpawnFactory({ holdMs = 0, exitCode = 0, stdoutBurst = "" } = {}) {
  const handles = [];
  function spawn(_cmd, _args, _opts) {
    const dummy = {
      pid: 9999 + handles.length,
      _listeners: {},
      stdin: { write() {}, end() {}, on() {} },
      stdout: { on(name, fn) { dummy.stdout._on = fn; } },
      stderr: { on(name, fn) { dummy.stderr._on = fn; } },
      on(name, fn) { dummy._listeners[name] = fn; },
      _killed: false,
      kill(sig) { dummy._killed = sig || "SIGTERM"; },
    };
    handles.push(dummy);
    setTimeout(() => {
      if (dummy.stdout._on) dummy.stdout._on(Buffer.from(stdoutBurst));
      if (dummy._listeners.close) dummy._listeners.close(exitCode);
      if (dummy._listeners.exit) dummy._listeners.exit(exitCode);
    }, holdMs);
    return dummy;
  }
  spawn._handles = handles;
  return spawn;
}

// ── runner ↔ registry wiring ──────────────────────────────────────────

test("CodexRunner registers the spawned child with childRegistry", async () => {
  const events = [];
  const registry = createChildRegistry({ broadcast: (e) => events.push(e) });
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const spawnImpl = mockSpawnFactory({ holdMs: 0, exitCode: 0, stdoutBurst: "ok" });
  const runner = new CodexRunner({
    repoRoot: process.cwd(),
    childSemaphore: sem,
    childRegistry: registry,
    spawnImpl,
    fallbackCommands: [{ cmd: "codex", argsPrefix: [] }],
  });

  const result = await runner.exec("hi", { timeoutMs: 5000 });
  assert.ok(result, "exec resolves");

  // After exec returns, child should have been registered THEN unregistered.
  const reg = events.find((e) => e.type === "child_registered");
  const unreg = events.find((e) => e.type === "child_unregistered");
  assert.ok(reg, "child_registered fired");
  assert.equal(reg.data.label, "codex");
  assert.ok(unreg, "child_unregistered fired");
  // Final state: nothing left in the registry.
  assert.equal(registry.size(), 0, "registry empty after exec completes");
});

test("CodexRunner.exec — runId from runRegistry.start() is forwarded into child_registered", async () => {
  // The runner doesn't take runId from exec opts; it asks runRegistry.start()
  // for a fresh id, then propagates that id into childRegistry.register().
  // Mock runRegistry so we can capture and assert the propagation.
  const events = [];
  const registry = createChildRegistry({ broadcast: (e) => events.push(e) });
  const sem = createChildSemaphore({ maxConcurrent: 1 });
  const spawnImpl = mockSpawnFactory({ holdMs: 0, exitCode: 0, stdoutBurst: "" });
  const runRegistry = {
    started: [],
    completed: [],
    start(meta) { this.started.push(meta); return "tagged-run-id"; },
    complete(id, result) { this.completed.push({ id, result }); },
  };
  const runner = new CodexRunner({
    repoRoot: process.cwd(),
    childSemaphore: sem,
    childRegistry: registry,
    runRegistry,
    spawnImpl,
    fallbackCommands: [{ cmd: "codex", argsPrefix: [] }],
  });
  await runner.exec("p", { timeoutMs: 5000 });
  const reg = events.find((e) => e.type === "child_registered");
  assert.equal(reg.data.runId, "tagged-run-id");
  // runRegistry was actually consulted (the id didn't materialise from thin air).
  assert.equal(runRegistry.started.length, 1);
  assert.equal(runRegistry.completed.length, 1);
});

// ── server.js wiring + gracefulShutdown source check ───────────────────

const SERVER_SRC = fs.readFileSync(path.join(__dirname, "../../server.js"), "utf-8");

test("server.js imports createChildRegistry alongside createChildSemaphore", () => {
  assert.match(
    SERVER_SRC,
    /require\(["']\.\/src\/runtime\/childRegistry["']\)/,
    "createChildRegistry imported from src/runtime/childRegistry"
  );
  assert.match(
    SERVER_SRC,
    /const childRegistry\s*=\s*createChildRegistry\(/,
    "single registry instance constructed"
  );
});

test("server.js passes childRegistry into both CodexRunner and ClaudeRunner", () => {
  // Look for the constructor arg list on each runner instantiation.
  const codexBlock = SERVER_SRC.slice(
    SERVER_SRC.indexOf("new CodexRunner"),
    SERVER_SRC.indexOf("new CodexRunner") + 400
  );
  assert.match(codexBlock, /childRegistry/, "CodexRunner gets childRegistry");
  const claudeBlock = SERVER_SRC.slice(
    SERVER_SRC.indexOf("new ClaudeRunner"),
    SERVER_SRC.indexOf("new ClaudeRunner") + 400
  );
  assert.match(claudeBlock, /childRegistry/, "ClaudeRunner gets childRegistry");
});

test("R3-d: server.js marks runner WS connections with _isRunnerWs flag at upgrade time", () => {
  // The flag lets gracefulShutdown send close 1000 selectively to runner-
  // bound connections only, not to dashboard clients (which would be
  // bewildered by an explicit 1000 close from a server they're still
  // talking to).
  const idx = SERVER_SRC.indexOf("isRunnerWsPath(req.url)");
  assert.ok(idx > -1, "expected runner-path branch in wss connection handler");
  const window = SERVER_SRC.slice(idx, idx + 800);
  assert.match(window, /ws\._isRunnerWs\s*=\s*true/,
    "runner-path branch must mark ws._isRunnerWs = true so gracefulShutdown can find them");
});

test("R3-d: server.js gracefulShutdown sends close 1000 to runner WS connections (clean shutdown signal)", () => {
  // Without this, the runner agent sees 1006 (abnormal) on every clean
  // SIGTERM and starts a backoff/reconnect loop pointlessly. R3-d
  // distinguishes deliberate shutdown from crash.
  const fnStart = SERVER_SRC.indexOf("function gracefulShutdown");
  assert.ok(fnStart > -1);
  const block = SERVER_SRC.slice(fnStart, fnStart + 3000);
  assert.match(block, /wss\.clients/,
    "gracefulShutdown must walk wss.clients to find runner-bound WS");
  assert.match(block, /_isRunnerWs/,
    "gracefulShutdown must filter on the _isRunnerWs flag");
  assert.match(block, /ws\.close\(1000,\s*["']orchestrator_shutdown["']\)/,
    "runner WS must receive close 1000 with reason orchestrator_shutdown");
});

test("server.js gracefulShutdown calls childRegistry.killAll with SIGTERM and SIGKILL", () => {
  const fnStart = SERVER_SRC.indexOf("function gracefulShutdown");
  assert.ok(fnStart > -1);
  // Capture a generous slice — the SIGKILL path lives after the setTimeout.
  // R3-d (Phase D R3, 2026-04-28) added the runner WS close 1000 broadcast
  // inside gracefulShutdown which pushed SIGKILL past the original 2000-char
  // window. Bumping to 3000 keeps the assertion intact without hard-coding
  // line numbers.
  const block = SERVER_SRC.slice(fnStart, fnStart + 3000);
  assert.match(
    block,
    /childRegistry\.killAll\(["']SIGTERM["']\)/,
    "SIGTERM sent immediately"
  );
  assert.match(
    block,
    /childRegistry\.killAll\(["']SIGKILL["']\)/,
    "SIGKILL follows after grace timeout"
  );
  assert.match(
    block,
    /setTimeout\([^,]+,\s*1000\)/,
    "1000ms grace window applied"
  );
});

test("server.js graceful-shutdown carries Slice S3 carve-out comment", () => {
  assert.match(
    SERVER_SRC,
    /Slice S3.*registry/i,
    "S3 tag near the gracefulShutdown change for traceability"
  );
});

// ── claude-runner / codex-runner constructor surface ──────────────────

test("CodexRunner / ClaudeRunner constructors accept childRegistry option", () => {
  const codexSrc = fs.readFileSync(path.join(__dirname, "../../executor/codex-runner.js"), "utf-8");
  const claudeSrc = fs.readFileSync(path.join(__dirname, "../../executor/claude-runner.js"), "utf-8");
  assert.match(codexSrc, /childRegistry\s*=\s*null/, "codex-runner default option");
  assert.match(claudeSrc, /childRegistry\s*=\s*null/, "claude-runner default option");
  assert.match(codexSrc, /this\.childRegistry\?\.register\(child/, "codex-runner register call");
  assert.match(claudeSrc, /this\.childRegistry\?\.register\(child/, "claude-runner register call");
  assert.match(codexSrc, /this\.childRegistry\?\.unregister\(child\)/, "codex-runner unregister on close + error");
  assert.match(claudeSrc, /this\.childRegistry\?\.unregister\(child\)/, "claude-runner unregister on close + error");
});
