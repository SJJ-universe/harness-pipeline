// Slice F (v5) — AnalyticsPanel pure-render unit tests.
//
// Exercises the two render functions (table + timeline) in isolation — no
// DOM, no fetch. install() is browser-only and is covered indirectly by
// the integration test's broadcast assertions + manual smoke check.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  renderTable,
  renderTimeline,
  setSnapshot,
  _resetSnapshotForTests,
} = require("../../public/js/analytics-panel");

test("renderTable: null / empty snapshot → 'no run data' empty state", () => {
  assert.match(renderTable(null, null), /표시할 run 데이터가 없습니다/);
  assert.match(renderTable({}, null), /표시할 run 데이터가 없습니다/);
  assert.match(renderTable({ phases: {} }, null), /아직 완료된 phase가 없습니다/);
});

test("renderTable: single phase with attempts → renders row per attempt + total row", () => {
  const ss = {
    phases: {
      A: {
        attempts: [
          { enteredAt: 1000, exitedAt: 1050, durationMs: 50, gatePass: false, reason: "cycle-reenter-findings" },
          { enteredAt: 1100, exitedAt: 1200, durationMs: 100, gatePass: true, reason: "advance" },
        ],
        totalDurationMs: 150,
        latestDurationMs: 100,
        gateAttempts: 2,
        gateFailures: 1,
        toolCount: 3,
        artifactKeys: [],
        hasCritique: false,
      },
    },
  };
  const html = renderTable(ss, { phases: [{ id: "A", name: "Plan" }] });
  assert.match(html, /<table/);
  assert.match(html, /A · Plan/);            // phase label joined with name
  assert.match(html, /#1/);
  assert.match(html, /#2/);
  assert.match(html, /50ms/);
  assert.match(html, /100ms/);
  assert.match(html, /150ms/);               // total row
  assert.match(html, /analytics-gate-fail/); // first attempt was a fail
  assert.match(html, /analytics-gate-pass/); // second attempt passed
  assert.match(html, /gate 2 \/ fail 1/);    // summary
  assert.match(html, /cycle-reenter-findings/);
});

test("renderTable: still-open attempt renders '(open)' duration and '—' gate", () => {
  const ss = {
    phases: {
      A: {
        attempts: [{ enteredAt: 1000, exitedAt: null, durationMs: null, gatePass: null, reason: null }],
        totalDurationMs: 0,
        latestDurationMs: 0,
        gateAttempts: 0,
        gateFailures: 0,
        toolCount: 0,
        artifactKeys: [],
        hasCritique: false,
      },
    },
  };
  const html = renderTable(ss, null);
  assert.match(html, /\(open\)/);
  assert.match(html, /analytics-gate-none/);
});

test("renderTable: escapes HTML in reason / phase name", () => {
  const ss = {
    phases: {
      A: {
        attempts: [
          { enteredAt: 0, exitedAt: 10, durationMs: 10, gatePass: true, reason: '<script>alert("x")</script>' },
        ],
        totalDurationMs: 10, latestDurationMs: 10,
        gateAttempts: 0, gateFailures: 0, toolCount: 0, artifactKeys: [], hasCritique: false,
      },
    },
  };
  const html = renderTable(ss, null);
  assert.ok(!html.includes("<script>alert"), "raw script tag must be escaped");
  assert.match(html, /&lt;script&gt;/);
});

test("renderTimeline: all-zero durations → empty-state message", () => {
  const ss = {
    phases: {
      A: { attempts: [], totalDurationMs: 0, latestDurationMs: 0, gateAttempts: 0, gateFailures: 0 },
    },
  };
  const html = renderTimeline(ss, null);
  assert.match(html, /완료된 duration 없음/);
});

test("renderTimeline: phases with duration → SVG with rect per phase", () => {
  const ss = {
    phases: {
      A: { attempts: [], totalDurationMs: 100, latestDurationMs: 100, gateAttempts: 0, gateFailures: 0 },
      B: { attempts: [], totalDurationMs: 300, latestDurationMs: 300, gateAttempts: 0, gateFailures: 0 },
    },
  };
  const html = renderTimeline(ss, null);
  assert.match(html, /<svg/);
  assert.match(html, /role="img"/);
  // 2 phase rows → 2 rects
  const rectCount = (html.match(/<rect/g) || []).length;
  assert.equal(rectCount, 2);
  // Both phase labels present
  assert.match(html, /<text[^>]*>A<\/text>/);
  assert.match(html, /<text[^>]*>B<\/text>/);
  // B has 3× the duration → should get ~3× width
  // (hard to assert exact pixels, just check both bars exist with numeric width)
  assert.match(html, /width="\d+"/);
});

test("renderTimeline: phase with gateFailures > 0 gets warn-styled bar", () => {
  const ss = {
    phases: {
      A: { attempts: [], totalDurationMs: 100, latestDurationMs: 100, gateAttempts: 2, gateFailures: 1 },
    },
  };
  const html = renderTimeline(ss, null);
  assert.match(html, /analytics-timeline-bar-warn/);
});

test("renderTimeline: template provides phase name → label shows 'id · name'", () => {
  const ss = {
    phases: {
      A: { attempts: [], totalDurationMs: 50, gateAttempts: 0, gateFailures: 0 },
    },
  };
  const html = renderTimeline(ss, { phases: [{ id: "A", name: "Plan" }] });
  assert.match(html, /A · Plan/);
});

test("setSnapshot accepts multiple payload shapes", () => {
  _resetSnapshotForTests();
  // wrapped shape
  setSnapshot({ stateSnapshot: { phases: {} }, template: null });
  // /api/runs/current shape
  setSnapshot({ snapshot: { stateSnapshot: { phases: {} }, template: null } });
  // raw state snapshot
  setSnapshot({ phases: { A: { attempts: [], totalDurationMs: 0 } } });
  // null clears
  setSnapshot(null);
  // All calls should be silent (no mount → _render no-op).
});
