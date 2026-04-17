// Tests for CodexRunner real-time output streaming, bounded final buffers,
// and secret redaction. Uses a fake spawnImpl so no real codex process runs.

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { CodexRunner, defaultRedact } = require("../../executor/codex-runner");

// Minimal fake child process factory. Returns { start(), emitStdout(), emitStderr(), close() }
function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    on: () => {},
    write: () => {},
    end: () => {},
  };
  child.kill = () => {};
  return child;
}

function makeFakeSpawn() {
  const children = [];
  const fake = (_cmd, _args, _opts) => {
    const c = makeFakeChild();
    children.push(c);
    return c;
  };
  return { spawn: fake, children };
}

test("defaultRedact masks common secret patterns", () => {
  const input = "token: sk-ABCDEFGHIJKLMNOPQRSTUVWX, ghp_ZYXWVUTSRQPONMLKJIHGF, HARNESS_TOKEN=abc123xyz";
  const out = defaultRedact(input);
  assert.ok(out.includes("[REDACTED]"));
  assert.ok(!out.includes("sk-ABCDEFG"));
  assert.ok(!out.includes("ghp_ZYXWVU"));
  assert.ok(!out.includes("abc123xyz"));
});

test("codex_progress broadcast fires after flush interval", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    flushIntervalMs: 30,
    flushBytes: 1_000_000, // large so only interval triggers flush
  });

  const done = runner.exec("prompt", { phaseId: "C", iteration: 1, source: "test" });
  const c = children[0];
  c.stdout.emit("data", Buffer.from("line1\n"));
  // Wait for flush interval
  await new Promise((r) => setTimeout(r, 80));
  c.emit("close", 0);
  await done;

  const progressEvents = events.filter((e) => e.type === "codex_progress");
  assert.ok(progressEvents.length >= 1, "at least one codex_progress event");
  assert.equal(progressEvents[0].data.phase, "C");
  assert.equal(progressEvents[0].data.iteration, 1);
  assert.equal(progressEvents[0].data.source, "test");
  assert.match(progressEvents[0].data.stdout, /line1/);
});

test("flushBytes triggers immediate flush before interval", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    flushIntervalMs: 10_000, // never via timer
    flushBytes: 100,
  });

  const done = runner.exec("prompt", {});
  const c = children[0];
  // Emit 150 bytes — should trigger immediate flush
  c.stdout.emit("data", Buffer.from("x".repeat(150)));
  await new Promise((r) => setImmediate(r));
  c.emit("close", 0);
  await done;

  const progressEvents = events.filter((e) => e.type === "codex_progress");
  assert.ok(progressEvents.length >= 1, "immediate flush on byte threshold");
});

test("final stdout buffer caps at maxFinalStdoutBytes", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    maxFinalStdoutBytes: 100,
    flushIntervalMs: 10_000,
  });

  const done = runner.exec("prompt", {});
  const c = children[0];
  // Emit 200 bytes — exceeds cap
  c.stdout.emit("data", Buffer.from("a".repeat(200)));
  c.emit("close", 0);
  const result = await done;

  assert.equal(result.stdoutTruncated, true);
  assert.ok(result.stdout.length <= 200, "stdout bounded");
});

test("codex_progress payload uses redact on stdout", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    flushIntervalMs: 10,
  });

  const done = runner.exec("prompt", {});
  const c = children[0];
  c.stdout.emit("data", Buffer.from("key=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ and done"));
  await new Promise((r) => setTimeout(r, 40));
  c.emit("close", 0);
  await done;

  const progress = events.find((e) => e.type === "codex_progress");
  assert.ok(progress, "progress event exists");
  assert.match(progress.data.stdout, /\[REDACTED\]/);
  assert.ok(!/sk-ABCDEFG/.test(progress.data.stdout));
});

test("codex_progress payload includes truncated flag when over cap", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    maxFinalStdoutBytes: 50,
    flushIntervalMs: 10,
  });

  const done = runner.exec("prompt", {});
  const c = children[0];
  c.stdout.emit("data", Buffer.from("x".repeat(100)));
  await new Promise((r) => setTimeout(r, 40));
  c.emit("close", 0);
  await done;

  const progress = events.filter((e) => e.type === "codex_progress");
  // After 100 bytes with cap 50, truncated should be true on some flush
  assert.ok(progress.some((e) => e.data.truncated === true), "truncated flag surfaces");
});

test("runId/phase/iteration/source flow through to progress events", async () => {
  const events = [];
  const { spawn, children } = makeFakeSpawn();
  const fakeRegistry = { start: () => "run-123", complete: () => {} };
  const runner = new CodexRunner({
    repoRoot: __dirname,
    broadcast: (e) => events.push(e),
    spawnImpl: spawn,
    runRegistry: fakeRegistry,
    flushIntervalMs: 10,
  });

  const done = runner.exec("prompt", { phaseId: "G", iteration: 2, source: "general-pipeline" });
  const c = children[0];
  c.stdout.emit("data", Buffer.from("stuff"));
  await new Promise((r) => setTimeout(r, 40));
  c.emit("close", 0);
  await done;

  const progress = events.find((e) => e.type === "codex_progress");
  assert.equal(progress.data.runId, "run-123");
  assert.equal(progress.data.phase, "G");
  assert.equal(progress.data.iteration, 2);
  assert.equal(progress.data.source, "general-pipeline");
});
