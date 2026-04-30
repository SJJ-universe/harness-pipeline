// Slice UI-H7-d (Phase D / Phase E1.5, 2026-04-30) — claude-runner +
// codex-runner reviewSessionId hint integration tests.
//
// Pins:
//   - When reviewSessionId is in opts AND reviewSessionManager is wired:
//     * stdout chunks → manager.recordCodexChunk / recordClaudeChunk
//     * close (success) → manager.recordCritiqueReceived / recordClaudeReceived
//   - When EITHER is absent: runner behaves as before (no manager calls)
//   - Manager-side throws are swallowed (defensive)
//   - Codex severityCounts derived from result.findings via the helper

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("path");

const {
  CodexRunner, _severityCountsFromFindings,
} = require("../../executor/codex-runner");
const { ClaudeRunner } = require("../../executor/claude-runner");

// ── Shared fake-child factory ─────────────────────────────────────

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on: () => {}, write: () => {}, end: () => {} };
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

function makeSpyManager() {
  const calls = {
    recordCodexChunk: [], recordClaudeChunk: [],
    recordCritiqueReceived: [], recordClaudeReceived: [],
  };
  return {
    calls,
    recordCodexChunk: (sid, chunk) => calls.recordCodexChunk.push({ sid, chunk }),
    recordClaudeChunk: (sid, chunk) => calls.recordClaudeChunk.push({ sid, chunk }),
    recordCritiqueReceived: (sid, summary) => calls.recordCritiqueReceived.push({ sid, summary }),
    recordClaudeReceived: (sid, summary) => calls.recordClaudeReceived.push({ sid, summary }),
  };
}

// ── _severityCountsFromFindings ──────────────────────────────────

test("UI-H7-d: _severityCountsFromFindings counts each severity once", () => {
  const findings = [
    { severity: "critical", message: "x" },
    { severity: "critical", message: "y" },
    { severity: "high", message: "z" },
    { severity: "medium", message: "z" },
    { severity: "low", message: "z" },
  ];
  const counts = _severityCountsFromFindings(findings);
  assert.deepEqual(counts, {
    critical: 2, high: 1, medium: 1, low: 1, note: 0,
  });
});

test("UI-H7-d: _severityCountsFromFindings handles non-array / null input", () => {
  assert.deepEqual(_severityCountsFromFindings(null),
    { critical: 0, high: 0, medium: 0, low: 0, note: 0 });
  assert.deepEqual(_severityCountsFromFindings(undefined),
    { critical: 0, high: 0, medium: 0, low: 0, note: 0 });
});

test("UI-H7-d: _severityCountsFromFindings ignores unknown severity values", () => {
  const findings = [
    { severity: "trivial" }, { severity: 42 }, { severity: null },
  ];
  const counts = _severityCountsFromFindings(findings);
  assert.deepEqual(counts, {
    critical: 0, high: 0, medium: 0, low: 0, note: 0,
  });
});

// ── CodexRunner ──────────────────────────────────────────────────

test("UI-H7-d: codex chunks pipe to manager.recordCodexChunk when hint present", async () => {
  const { spawn, children } = makeFakeSpawn();
  const manager = makeSpyManager();
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    reviewSessionManager: manager,
  });
  const p = runner.exec("test prompt", { reviewSessionId: "rs-1" });
  // Spawn happens synchronously inside the async IIFE, but we need
  // to yield once for the await chain to register the listeners.
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("chunk-A"));
  child.stdout.emit("data", Buffer.from("chunk-B"));
  child.emit("close", 0);
  await p;

  assert.equal(manager.calls.recordCodexChunk.length, 2);
  assert.equal(manager.calls.recordCodexChunk[0].sid, "rs-1");
  assert.equal(manager.calls.recordCodexChunk[0].chunk.text, "chunk-A");
  assert.equal(manager.calls.recordCodexChunk[1].chunk.text, "chunk-B");
});

test("UI-H7-d: codex close emits recordCritiqueReceived with severityCounts", async () => {
  const { spawn, children } = makeFakeSpawn();
  const manager = makeSpyManager();
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    reviewSessionManager: manager,
  });
  const p = runner.exec("test prompt", { reviewSessionId: "rs-1" });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("- [critical] First issue\n- [high] Second issue\n"));
  child.emit("close", 0);
  await p;

  assert.equal(manager.calls.recordCritiqueReceived.length, 1);
  const { sid, summary } = manager.calls.recordCritiqueReceived[0];
  assert.equal(sid, "rs-1");
  assert.deepEqual(summary.severityCounts, {
    critical: 1, high: 1, medium: 0, low: 0, note: 0,
  });
});

test("UI-H7-d: codex without reviewSessionId → no manager calls", async () => {
  const { spawn, children } = makeFakeSpawn();
  const manager = makeSpyManager();
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    reviewSessionManager: manager,
  });
  const p = runner.exec("test prompt", { /* no reviewSessionId */ });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("output"));
  child.emit("close", 0);
  await p;

  assert.equal(manager.calls.recordCodexChunk.length, 0);
  assert.equal(manager.calls.recordCritiqueReceived.length, 0);
});

test("UI-H7-d: codex without manager wired → no errors thrown", async () => {
  const { spawn, children } = makeFakeSpawn();
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    /* no reviewSessionManager */
  });
  const p = runner.exec("test prompt", { reviewSessionId: "rs-1" });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("output"));
  child.emit("close", 0);
  const result = await p;
  // Should still complete normally
  assert.equal(result.ok, true);
});

test("UI-H7-d: codex skips recordCritiqueReceived on non-zero exit", async () => {
  const { spawn, children } = makeFakeSpawn();
  const manager = makeSpyManager();
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    reviewSessionManager: manager,
  });
  const p = runner.exec("test prompt", { reviewSessionId: "rs-1" });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("partial"));
  child.emit("close", 1);  // non-zero exit
  await p;

  assert.equal(manager.calls.recordCodexChunk.length, 1);
  // No completion event because exit was non-zero
  assert.equal(manager.calls.recordCritiqueReceived.length, 0);
});

test("UI-H7-d: codex tolerates manager-side recordCodexChunk throws", async () => {
  const { spawn, children } = makeFakeSpawn();
  const breaker = {
    recordCodexChunk: () => { throw new Error("manager broke"); },
    recordCritiqueReceived: () => {},
  };
  const runner = new CodexRunner({
    repoRoot: __dirname, broadcast: () => {}, spawnImpl: spawn,
    reviewSessionManager: breaker,
  });
  const p = runner.exec("test prompt", { reviewSessionId: "rs-1" });
  await new Promise((r) => setImmediate(r));
  const child = children[0];
  child.stdout.emit("data", Buffer.from("output"));
  child.emit("close", 0);
  const result = await p;
  // Spawn should still complete despite manager throwing
  assert.equal(result.ok, true);
});

// ── ClaudeRunner ─────────────────────────────────────────────────
//
// Note: ClaudeRunner currently constructs its child via the real
// `spawn` from child_process (no spawnImpl override). To exercise
// it without a real claude binary we need to monkey-patch
// child_process.spawn temporarily — common pattern in this repo's
// runner tests when no spawnImpl seam is exposed.
//
// Use require.cache surgery: replace the runner's resolved spawn
// for the duration of one test.

function withFakeSpawn(fn) {
  const cp = require("child_process");
  const original = cp.spawn;
  const { spawn, children } = makeFakeSpawn();
  cp.spawn = spawn;
  // Reload claude-runner so it picks up the patched spawn. The
  // module caches the spawn reference at top-level, so we need to
  // bust the cache.
  const cacheKey = require.resolve("../../executor/claude-runner");
  const oldCache = require.cache[cacheKey];
  delete require.cache[cacheKey];
  try {
    const { ClaudeRunner: PatchedClaude } = require("../../executor/claude-runner");
    return fn({ ClaudeRunner: PatchedClaude, children });
  } finally {
    cp.spawn = original;
    if (oldCache) require.cache[cacheKey] = oldCache;
    else delete require.cache[cacheKey];
  }
}

test("UI-H7-d: claude chunks pipe to manager.recordClaudeChunk when hint present", async () => {
  await withFakeSpawn(async ({ ClaudeRunner: PC, children }) => {
    const manager = makeSpyManager();
    const runner = new PC({
      repoRoot: __dirname,
      reviewSessionManager: manager,
    });
    const p = runner.exec("apply patch", { reviewSessionId: "rs-claude-1" });
    // The async IIFE resolves the env then enters spawn — yield twice
    // for the buildSpawnEnv await + the spawn registration.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const child = children[0];
    child.stdout.emit("data", Buffer.from("Patch applied: file.js\n"));
    child.emit("close", 0);
    await p;

    assert.equal(manager.calls.recordClaudeChunk.length, 1);
    assert.equal(manager.calls.recordClaudeChunk[0].sid, "rs-claude-1");
    assert.equal(manager.calls.recordClaudeChunk[0].chunk.text,
      "Patch applied: file.js\n");
  });
});

test("UI-H7-d: claude close emits recordClaudeReceived with summary", async () => {
  await withFakeSpawn(async ({ ClaudeRunner: PC, children }) => {
    const manager = makeSpyManager();
    const runner = new PC({
      repoRoot: __dirname,
      reviewSessionManager: manager,
    });
    const p = runner.exec("apply patch", { reviewSessionId: "rs-claude-2" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const child = children[0];
    child.stdout.emit("data", Buffer.from("All done.\n"));
    child.emit("close", 0);
    await p;

    assert.equal(manager.calls.recordClaudeReceived.length, 1);
    assert.equal(manager.calls.recordClaudeReceived[0].sid, "rs-claude-2");
    assert.match(manager.calls.recordClaudeReceived[0].summary.summary, /All done/);
  });
});

test("UI-H7-d: claude without reviewSessionId → no manager calls", async () => {
  await withFakeSpawn(async ({ ClaudeRunner: PC, children }) => {
    const manager = makeSpyManager();
    const runner = new PC({
      repoRoot: __dirname,
      reviewSessionManager: manager,
    });
    const p = runner.exec("apply patch", { /* no hint */ });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const child = children[0];
    child.stdout.emit("data", Buffer.from("output"));
    child.emit("close", 0);
    await p;
    assert.equal(manager.calls.recordClaudeChunk.length, 0);
    assert.equal(manager.calls.recordClaudeReceived.length, 0);
  });
});

test("UI-H7-d: claude tolerates manager-side recordClaudeChunk throws", async () => {
  await withFakeSpawn(async ({ ClaudeRunner: PC, children }) => {
    const breaker = {
      recordClaudeChunk: () => { throw new Error("manager broke"); },
      recordClaudeReceived: () => {},
    };
    const runner = new PC({
      repoRoot: __dirname,
      reviewSessionManager: breaker,
    });
    const p = runner.exec("apply patch", { reviewSessionId: "rs-1" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const child = children[0];
    child.stdout.emit("data", Buffer.from("output"));
    child.emit("close", 0);
    const result = await p;
    assert.equal(result.ok, true);
  });
});

test("UI-H7-d: claude skips recordClaudeReceived on non-zero exit", async () => {
  await withFakeSpawn(async ({ ClaudeRunner: PC, children }) => {
    const manager = makeSpyManager();
    const runner = new PC({
      repoRoot: __dirname,
      reviewSessionManager: manager,
    });
    const p = runner.exec("apply patch", { reviewSessionId: "rs-1" });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const child = children[0];
    child.stdout.emit("data", Buffer.from("partial"));
    child.emit("close", 1);
    await p;
    assert.equal(manager.calls.recordClaudeChunk.length, 1);
    assert.equal(manager.calls.recordClaudeReceived.length, 0);
  });
});
