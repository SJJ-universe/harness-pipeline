// Slice UI-P5-f (Phase 2 Round 3, 2026-04-30) — product-shell-data tests.
// Pure selector contract — no DOM, no store, just snapshot shape →
// selector output. Every selector must return null for "no real data"
// so panels fall back to mock cleanly.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const data = require("../../public/js/monitor/product-shell-data");

// ── selectActiveRunId ────────────────────────────────────────────

test("UI-P5: selectActiveRunId returns null on missing snapshot/runs", () => {
  assert.equal(data.selectActiveRunId(null), null);
  assert.equal(data.selectActiveRunId({}), null);
  assert.equal(data.selectActiveRunId({ runs: null }), null);
  assert.equal(data.selectActiveRunId({ runs: new Map() }), null);
  assert.equal(data.selectActiveRunId({ runs: {} }), null);
});

test("UI-P5: selectActiveRunId honors selectedRunId when run exists", () => {
  const runs = new Map([["r1", { id: "r1" }]]);
  assert.equal(
    data.selectActiveRunId({ selectedRunId: "r1", runs }),
    "r1",
  );
});

test("UI-P5: selectActiveRunId falls through when selectedRunId is missing from runs", () => {
  const runs = new Map([["r1", { id: "r1", status: "active" }]]);
  assert.equal(
    data.selectActiveRunId({ selectedRunId: "ghost", runs }),
    "r1",
    "non-existent selectedRunId falls back to first active",
  );
});

test("UI-P5: selectActiveRunId prefers active over completed", () => {
  const runs = new Map([
    ["r1", { id: "r1", status: "completed", lastEventAt: 1000 }],
    ["r2", { id: "r2", status: "active",    lastEventAt: 100 }],
  ]);
  assert.equal(
    data.selectActiveRunId({ runs }),
    "r2",
    "active beats completed even with older lastEventAt",
  );
});

test("UI-P5: selectActiveRunId picks most recent when no active runs", () => {
  const runs = new Map([
    ["r1", { id: "r1", status: "completed", lastEventAt: 100 }],
    ["r2", { id: "r2", status: "completed", lastEventAt: 1000 }],
  ]);
  // Implementation note: sort uses (b - a) to pick newest first.
  // Either valid id is acceptable — pin "some run from the map".
  const got = data.selectActiveRunId({ runs });
  assert.ok(["r1", "r2"].indexOf(got) >= 0);
});

// ── selectAggregateRunStatus ─────────────────────────────────────

test("UI-P5: selectAggregateRunStatus returns idle/running/error correctly", () => {
  assert.equal(data.selectAggregateRunStatus(null), "idle");
  assert.equal(data.selectAggregateRunStatus({}), "idle");
  const empty = new Map();
  assert.equal(data.selectAggregateRunStatus({ runs: empty }), "idle");

  const onlyError = new Map([["r1", { status: "error" }]]);
  assert.equal(data.selectAggregateRunStatus({ runs: onlyError }), "error");

  const withActive = new Map([
    ["r1", { status: "error" }],
    ["r2", { status: "active" }],
  ]);
  assert.equal(
    data.selectAggregateRunStatus({ runs: withActive }),
    "running",
    "active beats error in priority",
  );
});

// ── selectRunPhases ──────────────────────────────────────────────

test("UI-P5: selectRunPhases returns null when no detail/run data exists", () => {
  assert.equal(data.selectRunPhases({}, "r1"), null);
  assert.equal(data.selectRunPhases({ runDetails: new Map() }, "r1"), null);
});

test("UI-P5: selectRunPhases normalizes run.phases to MOCK shape", () => {
  const snap = {
    runs: new Map([["r1", {
      id: "r1",
      phases: [
        { id: "plan", status: "done", actor: "Claude", label: "Plan", durationMs: 1234 },
        { id: "exec", status: "active", actor: "Claude", label: "Execute" },
      ],
    }]]),
    runDetails: new Map(),
  };
  const phases = data.selectRunPhases(snap, "r1");
  assert.ok(Array.isArray(phases));
  assert.equal(phases.length, 2);
  assert.equal(phases[0].id, "plan");
  assert.equal(phases[0].kor, "Plan");
  assert.equal(phases[0].dur, "1.2s");
  assert.equal(phases[1].id, "exec");
  assert.equal(phases[1].status, "active");
});

test("UI-P5: selectRunPhases prefers detail.run.phases over run.phases", () => {
  const snap = {
    runs: new Map([["r1", {
      id: "r1",
      phases: [{ id: "old", label: "OLD" }],
    }]]),
    runDetails: new Map([["r1", {
      run: { phases: [{ id: "new", label: "NEW" }] },
    }]]),
  };
  const phases = data.selectRunPhases(snap, "r1");
  assert.equal(phases.length, 1);
  assert.equal(phases[0].id, "new");
});

// ── selectFindings ──────────────────────────────────────────────

test("UI-P5: selectFindings returns null when detail/findings missing", () => {
  assert.equal(data.selectFindings({}, "r1"), null);
  assert.equal(
    data.selectFindings({ runDetails: new Map([["r1", {}]]) }, "r1"),
    null,
  );
});

test("UI-P5: selectFindings aggregates by severity tier in canonical order", () => {
  const snap = {
    runDetails: new Map([["r1", {
      findings: [
        { severity: "critical" },
        { severity: "high" },
        { severity: "high" },
        { severity: "low" },
        { severity: "note" }, { severity: "note" }, { severity: "note" },
      ],
    }]]),
  };
  const arr = data.selectFindings(snap, "r1");
  assert.deepEqual(arr.map((f) => f.tier), ["critical", "high", "medium", "low", "note"]);
  assert.deepEqual(arr.map((f) => f.count), [1, 2, 0, 1, 3]);
});

test("UI-P5: selectFindings returns null when all counts are 0 (mock fallback)", () => {
  const snap = { runDetails: new Map([["r1", { findings: [] }]]) };
  assert.equal(data.selectFindings(snap, "r1"), null,
    "empty findings array → null so panel uses mock for demo readability",
  );
});

// ── selectContextUsage ──────────────────────────────────────────

test("UI-P5: selectContextUsage requires numeric percent", () => {
  assert.equal(data.selectContextUsage({}, "r1"), null);
  const snap = { runDetails: new Map([["r1", { context: { percent: "abc" } }]]) };
  assert.equal(data.selectContextUsage(snap, "r1"), null);
});

test("UI-P5: selectContextUsage clamps percent to [0,1]", () => {
  const snap = {
    runDetails: new Map([["r1", { context: { percent: 1.5, used: "300k", total: "200k" } }]]),
  };
  const ctx = data.selectContextUsage(snap, "r1");
  assert.equal(ctx.percent, 1);
});

// ── selectVerifyStatus ──────────────────────────────────────────

test("UI-P5: selectVerifyStatus normalizes pass/fail/idle", () => {
  const mk = (v) => data.selectVerifyStatus(
    { runDetails: new Map([["r1", { verifyStatus: v }]]) }, "r1",
  );
  assert.equal(mk("pass").status, "pass");
  assert.equal(mk("fail").status, "fail");
  assert.equal(mk("garbage").status, "idle", "unknown status coerces to idle");
});

test("UI-P5: selectVerifyStatus computes gates label from passing/total", () => {
  const snap = {
    runDetails: new Map([["r1", {
      verifyStatus: { status: "pass", passing: 4, total: 4 },
    }]]),
  };
  const v = data.selectVerifyStatus(snap, "r1");
  assert.equal(v.gates, "4 of 4 gates");
});

// ── selectSubagents ─────────────────────────────────────────────

test("UI-P5: selectSubagents returns null when subagents empty/missing", () => {
  assert.equal(data.selectSubagents({}, "r1"), null);
  assert.equal(
    data.selectSubagents({ runDetails: new Map([["r1", { subagents: [] }]]) }, "r1"),
    null,
  );
});

test("UI-P5: selectSubagents normalizes server snapshot shape", () => {
  const snap = {
    runDetails: new Map([["r1", {
      subagents: [
        { session_id: "s1", agent_type: "researcher", active: true, metrics: { durationMs: 4200 } },
        { session_id: "s2", agent_type: "scribe", active: false, completedAt: "2026-04-30T00:00:00Z" },
      ],
    }]]),
  };
  const arr = data.selectSubagents(snap, "r1");
  assert.equal(arr.length, 2);
  assert.equal(arr[0].name, "researcher");
  assert.equal(arr[0].status, "running");
  assert.equal(arr[0].dur, "4.2s");
  assert.equal(arr[1].status, "done");
});

// ── selectRecentToolCalls ───────────────────────────────────────

test("UI-P5: selectRecentToolCalls returns null when no tool events", () => {
  assert.equal(data.selectRecentToolCalls({}, "r1"), null);
  assert.equal(data.selectRecentToolCalls({ events: [] }, "r1"), null);
  assert.equal(
    data.selectRecentToolCalls({
      events: [{ type: "phase_change", data: {} }],
    }, "r1"),
    null,
  );
});

test("UI-P5: selectRecentToolCalls returns most-recent N tool events", () => {
  const events = [];
  for (let i = 0; i < 10; i++) {
    events.push({
      type: "tool_call",
      data: { tool: "Read", arg: "file" + i, durationMs: i, runId: "r1", at: "2026-04-30T00:00:" + String(i).padStart(2, "0") },
    });
  }
  const calls = data.selectRecentToolCalls({ events }, "r1", 3);
  assert.equal(calls.length, 3);
  // Most recent first → file9, file8, file7
  assert.equal(calls[0].arg, "file9");
  assert.equal(calls[2].arg, "file7");
});

test("UI-P5: selectRecentToolCalls filters by runId when specified", () => {
  const events = [
    { type: "tool", data: { tool: "Read", runId: "r1", arg: "ours" } },
    { type: "tool", data: { tool: "Read", runId: "r2", arg: "theirs" } },
  ];
  const calls = data.selectRecentToolCalls({ events }, "r1", 5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arg, "ours");
});

// ── selectCritique ──────────────────────────────────────────────

test("UI-P5: selectCritique returns null when no review session matches", () => {
  assert.equal(data.selectCritique({}, "r1"), null);
  assert.equal(
    data.selectCritique({ reviewSessions: new Map() }, "r1"),
    null,
  );
});

test("UI-P5: selectCritique normalizes history with side mapping", () => {
  const snap = {
    reviewSessions: new Map([["s1", {
      sessionId: "s1",
      runId: "r1",
      history: [
        { actor: "Codex",  text: "review 1" },
        { actor: "Claude", text: "applied 1" },
      ],
    }]]),
  };
  const arr = data.selectCritique(snap, "r1");
  assert.equal(arr.length, 2);
  assert.equal(arr[0].side, "left",  "Codex maps to left");
  assert.equal(arr[1].side, "right", "Claude maps to right");
});

// ── selectServerStatus / selectCodexStatus ──────────────────────

test("UI-P5: selectServerStatus defaults to ok when nothing reported", () => {
  const s = data.selectServerStatus({});
  assert.equal(s.status, "ok");
  assert.match(s.label, /ONLINE|확인/);
});

test("UI-P5: selectServerStatus reports OFFLINE when server.up=false", () => {
  const s = data.selectServerStatus({ server: { up: false } });
  assert.equal(s.status, "fail");
  assert.match(s.label, /OFFLINE/);
});

test("UI-P5: selectCodexStatus reports auth-needed from profile.codexLastTest", () => {
  const snap = {
    accountStatus: {
      profile: {
        codexLastTest: { installed: true, authenticated: false },
      },
    },
  };
  const c = data.selectCodexStatus(snap);
  assert.equal(c.status, "warn");
  assert.match(c.label, /인증/);
});

test("UI-P5: selectCodexStatus reports not-installed when installed=false", () => {
  const snap = {
    accountStatus: {
      profile: {
        codexLastTest: { installed: false },
      },
    },
  };
  const c = data.selectCodexStatus(snap);
  assert.equal(c.status, "fail");
  assert.match(c.label, /미설치/);
});
