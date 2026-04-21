// Slice V (v6) — File conflict detector unit tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFileConflictDetector } = require("../../src/runtime/fileConflictDetector");

function collect() {
  const events = [];
  return { events, broadcast: (e) => events.push(e) };
}

test("single run recording the same file is not a conflict", () => {
  const { events, broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  const r1 = det.recordEdit("run-A", "src/a.js");
  const r2 = det.recordEdit("run-A", "src/a.js");
  assert.equal(r1.conflict, false);
  assert.equal(r2.conflict, false);
  assert.equal(events.length, 0);
});

test("second run editing same file → conflict:true + broadcast", () => {
  const { events, broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  det.recordEdit("run-A", "src/a.js");
  const r = det.recordEdit("run-B", "src/a.js");
  assert.equal(r.conflict, true);
  assert.deepEqual(r.conflictWithRunIds, ["run-A"]);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "file_conflict_warning");
  assert.equal(events[0].data.runId, "run-B");
  assert.deepEqual(events[0].data.conflictWithRunIds, ["run-A"]);
});

test("three runs on same file — each subsequent reports all prior owners", () => {
  const { events, broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  det.recordEdit("run-A", "src/a.js");
  det.recordEdit("run-B", "src/a.js");
  const r = det.recordEdit("run-C", "src/a.js");
  assert.deepEqual(r.conflictWithRunIds.sort(), ["run-A", "run-B"]);
  assert.equal(events.length, 2);
});

test("invalid runId/filePath are no-ops", () => {
  const { events, broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  assert.equal(det.recordEdit("", "x.js").conflict, false);
  assert.equal(det.recordEdit("run-A", "").conflict, false);
  assert.equal(det.recordEdit(null, "x.js").conflict, false);
  assert.equal(det.recordEdit("run-A", null).conflict, false);
  assert.equal(events.length, 0);
});

test("clear(runId) releases all files claimed by that run", () => {
  const { broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  det.recordEdit("run-A", "src/a.js");
  det.recordEdit("run-A", "src/b.js");
  det.clear("run-A");
  // After clear, another run can claim without conflict
  const r = det.recordEdit("run-B", "src/a.js");
  assert.equal(r.conflict, false);
  assert.equal(det.size(), 1); // only src/a.js now held by run-B
});

test("snapshot returns a plain { file: [runIds] } shape", () => {
  const { broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  det.recordEdit("run-A", "src/a.js");
  det.recordEdit("run-B", "src/a.js");
  det.recordEdit("run-A", "src/b.js");
  const snap = det.snapshot();
  assert.deepEqual(snap["src/a.js"].sort(), ["run-A", "run-B"]);
  assert.deepEqual(snap["src/b.js"], ["run-A"]);
});

test("clear(nonexistent) is a silent no-op", () => {
  const det = createFileConflictDetector();
  det.clear("ghost"); // must not throw
  det.clear(null);
  det.clear("");
});

test("conflict broadcast carries timestamp", () => {
  const { events, broadcast } = collect();
  const det = createFileConflictDetector({ broadcast });
  const before = Date.now();
  det.recordEdit("A", "x.js");
  det.recordEdit("B", "x.js");
  const after = Date.now();
  const ev = events[0];
  assert.ok(ev.data.at >= before);
  assert.ok(ev.data.at <= after + 10);
});
