// Slice MB2 (Phase D Round 2, 2026-04-27) — getSubagentSnapshot.
//
// Locks the public contract of PipelineExecutor.getSubagentSnapshot()
// since /api/monitor/runs/:runId (MB1) and agent-tree.js (MA6+MB2)
// both depend on its shape. We only exercise the snapshot getter —
// PipelineExecutor's full lifecycle has its own tests in tests/legacy.

const test = require("node:test");
const assert = require("node:assert/strict");
const { PipelineExecutor } = require("../../executor/pipeline-executor");

function makeExecutor() {
  // Minimal construction — broadcast/templates/state defaults are fine
  // because we never invoke a phase, only poke the snapshot getter.
  return new PipelineExecutor({
    broadcast: () => {},
    templates: {},
    codex: null,
  });
}

// ── no active run → empty list ───────────────────────────────────────

test("getSubagentSnapshot returns [] when no active run", () => {
  const exec = makeExecutor();
  // exec.active is null by default.
  assert.deepEqual(exec.getSubagentSnapshot(), []);
});

test("getSubagentSnapshot returns [] when active run has no subagents map", () => {
  const exec = makeExecutor();
  exec.active = { /* no subagents */ };
  assert.deepEqual(exec.getSubagentSnapshot(), []);
});

// ── populated case (server is the authoritative source) ──────────────

test("getSubagentSnapshot exposes one entry per subagents map key", () => {
  const exec = makeExecutor();
  // Mirror what onSubagentStart populates.
  exec.active = {
    subagents: {
      "s-1": { agent_type: "codex", parent_session_id: null, startedAt: 1000 },
      "s-2": { agent_type: "claude", parent_session_id: "s-1", startedAt: 1100 },
    },
    // SubRun map intentionally left empty for this test — metrics: null path.
    subRuns: new Map(),
  };
  const snap = exec.getSubagentSnapshot();
  assert.equal(snap.length, 2);
  const ids = snap.map((s) => s.session_id).sort();
  assert.deepEqual(ids, ["s-1", "s-2"]);
  // Field shape per entry.
  for (const entry of snap) {
    assert.equal(typeof entry.session_id, "string");
    // metrics is null when no SubRun is attached.
    assert.equal(entry.metrics, null);
  }
});

test("getSubagentSnapshot reports active=true while completedAt is null, false otherwise", () => {
  const exec = makeExecutor();
  exec.active = {
    subagents: {
      "running":  { agent_type: "codex",  startedAt: 1000 },
      "finished": { agent_type: "claude", startedAt: 2000, completedAt: 2500 },
    },
    subRuns: new Map(),
  };
  const map = Object.fromEntries(
    exec.getSubagentSnapshot().map((s) => [s.session_id, s])
  );
  assert.equal(map.running.active, true);
  assert.equal(map.running.completedAt, null);
  assert.equal(map.finished.active, false);
  assert.equal(map.finished.completedAt, 2500);
});

// ── SubRun metrics integration ───────────────────────────────────────

test("getSubagentSnapshot includes SubRun.snapshot() metrics when available", () => {
  const exec = makeExecutor();
  const { SubRun } = require("../../executor/sub-run");
  const subRun = new SubRun({
    sessionId: "s-1",
    agentId: "agent-1",
    agentType: "codex",
  });
  subRun.recordTool("Edit", { filePath: "a.js" });
  subRun.recordTool("Read", { filePath: "b.js" });
  subRun.recordTool("Edit", { filePath: "c.js" });
  exec.active = {
    subagents: {
      "s-1": { agent_type: "codex", startedAt: subRun.startedAt },
    },
    subRuns: new Map([["s-1", subRun]]),
  };
  const snap = exec.getSubagentSnapshot();
  assert.equal(snap.length, 1);
  assert.ok(snap[0].metrics, "metrics present when SubRun attached");
  assert.equal(snap[0].metrics.toolCount, 3);
  assert.deepEqual(snap[0].metrics.byTool, { Edit: 2, Read: 1 });
});

test("getSubagentSnapshot pulls agent_id / agent_type from SubRun when entry lacks them", () => {
  const exec = makeExecutor();
  const { SubRun } = require("../../executor/sub-run");
  const subRun = new SubRun({
    sessionId: "s-1",
    agentId: "subrun-id",
    agentType: "subrun-type",
  });
  exec.active = {
    // entry has neither agent_id nor agent_type — getSubagentSnapshot
    // should fall back to the SubRun's values.
    subagents: { "s-1": { startedAt: 1 } },
    subRuns: new Map([["s-1", subRun]]),
  };
  const snap = exec.getSubagentSnapshot();
  assert.equal(snap[0].agent_id, "subrun-id");
  assert.equal(snap[0].agent_type, "subrun-type");
});

// ── malformed entries are skipped (defensive) ───────────────────────

test("getSubagentSnapshot skips null / non-object entries in the subagents map", () => {
  const exec = makeExecutor();
  exec.active = {
    subagents: {
      "s-1":  { agent_type: "codex", startedAt: 1 },
      "s-2":  null,
      "s-3":  "garbage",
      "s-4":  { agent_type: "claude", startedAt: 2 },
    },
    subRuns: new Map(),
  };
  const ids = exec.getSubagentSnapshot().map((s) => s.session_id).sort();
  assert.deepEqual(ids, ["s-1", "s-4"]);
});
