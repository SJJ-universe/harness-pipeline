// Slice MA7-c (Phase D, 2026-04-27) — subagent-events tests.
//
// install() registers two handlers on the supplied (or global)
// HarnessEventDispatcher. We verify:
//   - registration happens for both event types
//   - dispatched events drive subagentTray.start / .complete
//   - addLog is called with the canonical Korean log strings
//   - uninstall() drops both registrations
//   - missing dispatcher → no-op (graceful for SSR)

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/event-handlers/subagent-events");
const dispatcher = require("../../public/js/event-dispatcher");

function fresh() {
  dispatcher._resetForTests();
  return dispatcher;
}

function makeStubTray() {
  const calls = { start: [], complete: [] };
  return {
    start: (payload) => { calls.start.push(payload); },
    complete: (payload) => { calls.complete.push(payload); },
    _calls: calls,
  };
}

function captureLogs() {
  const logs = [];
  const fn = (kind, message) => logs.push({ kind, message });
  fn._all = logs;
  return fn;
}

// ── registration / unregistration ───────────────────────────────────

test("install registers handlers for subagent_started + subagent_completed", () => {
  const d = fresh();
  install({ dispatcher: d });
  assert.equal(d.has("subagent_started"), true);
  assert.equal(d.has("subagent_completed"), true);
});

test("uninstall drops both registrations", () => {
  const d = fresh();
  const handle = install({ dispatcher: d });
  handle.uninstall();
  assert.equal(d.has("subagent_started"), false);
  assert.equal(d.has("subagent_completed"), false);
});

test("install with no dispatcher is a no-op (graceful SSR)", () => {
  // Pre-existing global dispatcher cleared so the fallback can't find one.
  fresh();
  const handle = install({ dispatcher: null });
  // The function still returns an uninstall handle.
  assert.equal(typeof handle.uninstall, "function");
  assert.doesNotThrow(() => handle.uninstall());
});

// ── started flow ────────────────────────────────────────────────────

test("dispatched subagent_started fires tray.start with normalised id fallback", () => {
  const d = fresh();
  const tray = makeStubTray();
  const log = captureLogs();
  install({ dispatcher: d, subagentTray: tray, addLog: log });
  d.dispatch({
    type: "subagent_started",
    data: {
      session_id: "abc12345",
      agent_type: "codex",
      parent_session_id: "parent-1",
    },
  });
  assert.equal(tray._calls.start.length, 1);
  assert.equal(tray._calls.start[0].session_id, "abc12345");
  assert.equal(tray._calls.start[0].agent_type, "codex");
  assert.equal(tray._calls.start[0].parent_session_id, "parent-1");
});

test("subagent_started without session_id falls back to agent_id", () => {
  const d = fresh();
  const tray = makeStubTray();
  install({ dispatcher: d, subagentTray: tray });
  d.dispatch({
    type: "subagent_started",
    data: { agent_id: "agent-xyz", agent_type: "claude" },
  });
  assert.equal(tray._calls.start[0].session_id, "agent-xyz");
});

test("subagent_started addLog format: '서브에이전트 시작 — <type> (id=…)'", () => {
  const d = fresh();
  const log = captureLogs();
  install({ dispatcher: d, subagentTray: makeStubTray(), addLog: log });
  d.dispatch({
    type: "subagent_started",
    data: { session_id: "abc12345-extra-suffix", agent_type: "codex" },
  });
  assert.equal(log._all.length, 1);
  assert.equal(log._all[0].kind, "phase");
  // ID is sliced to 8 chars to match legacy.
  assert.equal(log._all[0].message, "서브에이전트 시작 — codex (id=abc12345)");
});

// ── completed flow ──────────────────────────────────────────────────

test("dispatched subagent_completed fires tray.complete + log", () => {
  const d = fresh();
  const tray = makeStubTray();
  const log = captureLogs();
  install({ dispatcher: d, subagentTray: tray, addLog: log });
  d.dispatch({
    type: "subagent_completed",
    data: { session_id: "s1", agent_type: "codex", elapsedMs: 12345 },
  });
  assert.equal(tray._calls.complete.length, 1);
  assert.equal(tray._calls.complete[0].elapsedMs, 12345);
  // 12345ms → 12.3s (toFixed(1)).
  assert.equal(log._all[0].message, "서브에이전트 완료 — codex (12.3s)");
});

test("subagent_completed without elapsedMs renders '?s'", () => {
  const d = fresh();
  const log = captureLogs();
  install({ dispatcher: d, subagentTray: makeStubTray(), addLog: log });
  d.dispatch({
    type: "subagent_completed",
    data: { session_id: "s2", agent_type: "claude" },
  });
  assert.equal(log._all[0].message, "서브에이전트 완료 — claude (?s)");
});

// ── tray-missing graceful path ──────────────────────────────────────

test("install with no subagentTray still logs (tray fields skipped)", () => {
  const d = fresh();
  const log = captureLogs();
  install({ dispatcher: d, subagentTray: null, addLog: log });
  d.dispatch({
    type: "subagent_started",
    data: { session_id: "abc12345", agent_type: "codex" },
  });
  // Log still fires.
  assert.equal(log._all.length, 1);
  assert.match(log._all[0].message, /서브에이전트 시작/);
});

test("install with no addLog still calls tray (log skipped)", () => {
  const d = fresh();
  const tray = makeStubTray();
  install({ dispatcher: d, subagentTray: tray });   // no addLog
  d.dispatch({
    type: "subagent_started",
    data: { session_id: "x", agent_type: "claude" },
  });
  assert.equal(tray._calls.start.length, 1);
});

// ── short-circuit semantics ─────────────────────────────────────────

test("dispatcher.dispatch returns true when subagent handler ran (short-circuits switch)", () => {
  // The whole point of MA7-c — the dispatcher returns true so the
  // legacy switch in app.js never runs. This test locks the contract.
  const d = fresh();
  install({ dispatcher: d, subagentTray: makeStubTray() });
  const ran = d.dispatch({
    type: "subagent_started",
    data: { session_id: "x", agent_type: "codex" },
  });
  assert.equal(ran, true);
});
