// Slice X (v6) — Phase 2 마감.
//
// "Parallel critic/executor"의 의미: 이미 Slice N의 childSemaphore가 Codex/
// Claude 자식 프로세스 concurrency를 제어하고, Slice W의 SubRun이 병렬
// subagent 도구 호출을 per-agent에 분리 기록합니다. 이 테스트는 그 두
// 인프라가 실제로 동시 호출 상황에서 깨지지 않고 의도대로 상호작용함을
// 증명합니다.
//
// 세 가지 시나리오:
//   1. 2개의 Codex exec를 동시에 시작 → semaphore(max=2)가 둘 다 통과
//   2. 3개의 Codex exec를 동시에 시작 → 3번째는 대기하다가 앞선 release 후 실행
//   3. 2개의 subagent가 동시에 서로 다른 SubRun에 tool 기록 → 격리 유지

const test = require("node:test");
const assert = require("node:assert/strict");
const { createChildSemaphore } = require("../../src/runtime/childSemaphore");
const { CodexRunner } = require("../../executor/codex-runner");
const { PipelineExecutor } = require("../../executor/pipeline-executor");
const { PipelineState } = require("../../executor/pipeline-state");
const { HookRouter } = require("../../executor/hook-router");
const fs = require("fs");
const os = require("os");
const path = require("path");

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeSpawnMock({ exitCode = 0, stdoutBurst = "", heldBy = null } = {}) {
  // Returns a function that mimics child_process.spawn but parks the child
  // until `heldBy.resolve()` is called. Each call records its own dummy child.
  const calls = [];
  function spawn(cmd, args) {
    const dummy = {
      _cmd: cmd,
      _args: args,
      _listeners: {},
      stdin: { write: () => {}, end: () => {} },
      stdout: { on: (name, fn) => { dummy.stdout._on = fn; } },
      stderr: { on: () => {} },
      on(name, fn) { dummy._listeners[name] = fn; },
      kill() { /* no-op */ },
    };
    calls.push(dummy);
    const held = heldBy ? heldBy() : { promise: Promise.resolve() };
    held.promise.then(() => {
      if (dummy.stdout._on) dummy.stdout._on(Buffer.from(stdoutBurst));
      if (dummy._listeners.close) dummy._listeners.close(exitCode);
      if (dummy._listeners.exit) dummy._listeners.exit(exitCode);
    });
    return dummy;
  }
  spawn._calls = calls;
  return spawn;
}

test("two concurrent Codex execs proceed with semaphore max=2", async () => {
  const broadcasts = [];
  const sem = createChildSemaphore({ maxConcurrent: 2, broadcast: (e) => broadcasts.push(e) });
  const gate1 = deferred();
  const gate2 = deferred();
  const gateMap = [gate1, gate2];
  let idx = 0;
  const spawnImpl = makeSpawnMock({
    stdoutBurst: "no findings",
    heldBy: () => gateMap[idx++ % gateMap.length],
  });
  const runner = new CodexRunner({
    broadcast: () => {},
    spawnImpl,
    childSemaphore: sem,
    fallbackCommands: [{ cmd: "codex", argsPrefix: [] }],
  });
  // Kick off two concurrent exec calls
  const p1 = runner.exec("hello", { timeoutMs: 5000 });
  const p2 = runner.exec("world", { timeoutMs: 5000 });
  // Let the event loop schedule both acquires
  await new Promise((r) => setImmediate(r));
  assert.equal(sem.inFlightCount(), 2, "both should have acquired slots");
  // Release both
  gate1.resolve();
  gate2.resolve();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.ok(r1);
  assert.ok(r2);
  assert.equal(sem.inFlightCount(), 0);
});

test("three concurrent execs — third waits until a slot frees", async () => {
  const sem = createChildSemaphore({ maxConcurrent: 2 });
  const gates = [deferred(), deferred(), deferred()];
  let idx = 0;
  const spawnImpl = makeSpawnMock({
    stdoutBurst: "no findings",
    heldBy: () => gates[idx++],
  });
  const runner = new CodexRunner({
    broadcast: () => {},
    spawnImpl,
    childSemaphore: sem,
    fallbackCommands: [{ cmd: "codex", argsPrefix: [] }],
  });
  const p1 = runner.exec("a", { timeoutMs: 5000 });
  const p2 = runner.exec("b", { timeoutMs: 5000 });
  const p3 = runner.exec("c", { timeoutMs: 5000 });
  await new Promise((r) => setImmediate(r));
  assert.equal(sem.inFlightCount(), 2);
  assert.equal(sem.waitingCount(), 1, "third exec should be waiting");
  gates[0].resolve();
  await p1;
  // Now the third should have acquired
  await new Promise((r) => setImmediate(r));
  assert.equal(sem.waitingCount(), 0);
  gates[1].resolve();
  gates[2].resolve();
  await Promise.all([p2, p3]);
  assert.equal(sem.inFlightCount(), 0);
});

test("two subagents record tools into isolated SubRuns concurrently", async () => {
  const events = [];
  const broadcast = (e) => events.push(e);
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-parallel-"));
  const templates = {
    default: {
      id: "default",
      phases: [{ id: "E", label: "E", name: "Build", agent: "claude", allowedTools: ["Read", "Edit", "Write", "Bash"] }],
    },
  };
  const ex = new PipelineExecutor({
    broadcast,
    templates,
    state: new PipelineState(),
    repoRoot,
    workspaceDir: path.join(repoRoot, "_workspace"),
  });
  ex.setEnabled(true);
  const router = new HookRouter({ broadcast, sessionWatcher: null, runRegistry: null });
  router.attachExecutor(ex);
  await ex.startFromPrompt("implement a feature");
  // Two subagents in parallel
  await ex.onSubagentStart({ session_id: "critic-1", agent_type: "security-critic" });
  await ex.onSubagentStart({ session_id: "critic-2", agent_type: "performance-critic" });

  // Interleave tool calls from both
  await router.route("post-tool", {
    session_id: "critic-1",
    tool_name: "Read",
    tool_input: { file_path: "src/auth.js" },
    tool_response: {},
  });
  await router.route("post-tool", {
    session_id: "critic-2",
    tool_name: "Read",
    tool_input: { file_path: "src/perf.js" },
    tool_response: {},
  });
  await router.route("post-tool", {
    session_id: "critic-1",
    tool_name: "Grep",
    tool_input: { pattern: "password" },
    tool_response: {},
  });

  const sr1 = ex.active.subRuns.get("critic-1");
  const sr2 = ex.active.subRuns.get("critic-2");
  assert.equal(sr1.tools.length, 2, "critic-1 should have 2 tool calls");
  assert.equal(sr2.tools.length, 1, "critic-2 should have 1 tool call");
  assert.equal(sr1.byTool.Read, 1);
  assert.equal(sr1.byTool.Grep, 1);
  assert.equal(sr2.byTool.Read, 1);

  // Both subagent_completed broadcasts carry their own metrics
  await ex.onSubagentStop({ session_id: "critic-1" });
  await ex.onSubagentStop({ session_id: "critic-2" });
  const completed1 = events.find(
    (e) => e.type === "subagent_completed" && e.data.session_id === "critic-1"
  );
  const completed2 = events.find(
    (e) => e.type === "subagent_completed" && e.data.session_id === "critic-2"
  );
  assert.equal(completed1.data.metrics.toolCount, 2);
  assert.equal(completed2.data.metrics.toolCount, 1);
});
