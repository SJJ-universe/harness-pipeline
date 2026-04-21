// Slice M (v6) — PipelineState memory hygiene.
//
// findings[] and phases[id].tools[] used to grow unbounded. These tests
// lock the new caps (MAX_FINDINGS=200, MAX_TOOLS_PER_PHASE=500) and verify
// overflow counters stay accurate so downstream consumers (ClaimVerifier,
// analytics, snapshot broadcasts) see true totals.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PipelineState,
  MAX_FINDINGS,
  MAX_TOOLS_PER_PHASE,
} = require("../../executor/pipeline-state");

function addNCritiques(s, phaseId, n) {
  for (let i = 0; i < n; i++) {
    s.setCritique(phaseId, {
      findings: [{ severity: i % 3 === 0 ? "critical" : "note", message: `f${i}`, at: 1000 + i }],
    });
  }
}

function recordNTools(s, phaseId, n, tool = "Edit") {
  for (let i = 0; i < n; i++) {
    s.recordTool(phaseId, tool, {}, { file_path: `src/f${i}.js` });
  }
}

// ── findings cap ────────────────────────────────────────────────

test("MAX_FINDINGS is 200 (regression guard)", () => {
  assert.equal(MAX_FINDINGS, 200);
});

test("findings under cap are all retained, no overflow recorded", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", 50);
  assert.equal(s.findings.length, 50);
  assert.equal(s.findingsOverflow.count, 0);
  assert.deepEqual(s.findingsOverflow.bySeverity, {});
});

test("findings at exactly cap do not trigger overflow", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS);
  assert.equal(s.findings.length, MAX_FINDINGS);
  assert.equal(s.findingsOverflow.count, 0);
});

test("findings over cap trim oldest; overflow.count reflects drop", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS + 50);
  assert.equal(s.findings.length, MAX_FINDINGS,
    `findings should cap at ${MAX_FINDINGS}, got ${s.findings.length}`);
  assert.equal(s.findingsOverflow.count, 50);
  // The NEWEST entries survived — check message tail
  const lastMsg = s.findings[s.findings.length - 1].message;
  assert.equal(lastMsg, `f${MAX_FINDINGS + 49}`);
});

test("findingsOverflow.bySeverity tracks trimmed severities", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS + 30);
  const ov = s.findingsOverflow;
  assert.equal(ov.count, 30);
  // Every 3rd was "critical"; the rest "note". Trimmed are the OLDEST 30
  // (i=0..29), so approx critical ≈ 10 (i=0,3,6,...,27 → 10 items), note ≈ 20.
  assert.ok(ov.bySeverity.critical > 0);
  assert.ok(ov.bySeverity.note > 0);
  assert.equal(ov.bySeverity.critical + ov.bySeverity.note, 30);
});

test("findings oldest/newest timestamps track trim window", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS + 10);
  const ov = s.findingsOverflow;
  // Trimmed 10 items with at=1000..1009
  assert.equal(ov.oldestAt, 1000);
  assert.equal(ov.newestAt, 1009);
});

test("finding without severity rolls into bySeverity.unknown", () => {
  const s = new PipelineState();
  for (let i = 0; i < MAX_FINDINGS + 5; i++) {
    s.setCritique("A", { findings: [{ message: `x${i}` }] }); // no severity
  }
  assert.equal(s.findingsOverflow.bySeverity.unknown, 5);
});

// ── tools cap (per phase) ───────────────────────────────────────

test("MAX_TOOLS_PER_PHASE is 500 (regression guard)", () => {
  assert.equal(MAX_TOOLS_PER_PHASE, 500);
});

test("phase tools under cap are all retained", () => {
  const s = new PipelineState();
  recordNTools(s, "A", 100);
  assert.equal(s.phases.A.tools.length, 100);
  assert.equal(s.phases.A.toolsOverflow.count, 0);
});

test("phase tools over cap trim oldest; toolsOverflow.count reflects drop", () => {
  const s = new PipelineState();
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 80);
  assert.equal(s.phases.A.tools.length, MAX_TOOLS_PER_PHASE);
  assert.equal(s.phases.A.toolsOverflow.count, 80);
});

test("toolsOverflow.byTool tracks trimmed tool types", () => {
  const s = new PipelineState();
  for (let i = 0; i < MAX_TOOLS_PER_PHASE + 30; i++) {
    s.recordTool("A", i % 2 === 0 ? "Edit" : "Bash", {}, { file_path: `f${i}.js`, command: "x" });
  }
  const ov = s.phases.A.toolsOverflow;
  assert.equal(ov.count, 30);
  assert.equal(ov.byTool.Edit + ov.byTool.Bash, 30);
});

test("tools cap is per-phase: two phases each hold up to MAX", () => {
  const s = new PipelineState();
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 10);
  recordNTools(s, "B", 50);
  assert.equal(s.phases.A.tools.length, MAX_TOOLS_PER_PHASE);
  assert.equal(s.phases.A.toolsOverflow.count, 10);
  assert.equal(s.phases.B.tools.length, 50);
  assert.equal(s.phases.B.toolsOverflow.count, 0);
});

test("global metrics.toolCount keeps accumulating even after trim", () => {
  const s = new PipelineState();
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 20);
  assert.equal(s.metrics.toolCount, MAX_TOOLS_PER_PHASE + 20,
    "toolCount is a pure counter — must NOT decrease on trim");
});

test("metrics.filesEdited remains a Set (no duplicate growth)", () => {
  const s = new PipelineState();
  for (let i = 0; i < MAX_TOOLS_PER_PHASE + 100; i++) {
    // Same 3 files, cycled — set should stay size 3
    s.recordTool("A", "Edit", {}, { file_path: `src/${i % 3}.js` });
  }
  assert.equal(s.metrics.filesEdited.size, 3);
});

// ── snapshot exposure ───────────────────────────────────────────

test("snapshot().findingsOverflow is a cloned object (mutation-safe)", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS + 5);
  const snap = s.snapshot();
  snap.findingsOverflow.count = 999;
  assert.equal(s.findingsOverflow.count, 5, "snapshot must not share state");
});

test("snapshot().phases[id].toolsOverflow is cloned and populated after trim", () => {
  const s = new PipelineState();
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 7);
  const snap = s.snapshot();
  assert.equal(snap.phases.A.toolsOverflow.count, 7);
  // mutation isolation
  snap.phases.A.toolsOverflow.count = 999;
  assert.equal(s.phases.A.toolsOverflow.count, 7);
});

test("reset() clears findings + overflow + tools overflow", () => {
  const s = new PipelineState();
  addNCritiques(s, "A", MAX_FINDINGS + 5);
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 5);
  s.reset({ userPrompt: "new", templateId: "default" });
  assert.equal(s.findings.length, 0);
  assert.equal(s.findingsOverflow.count, 0);
  assert.deepEqual(s.findingsOverflow.bySeverity, {});
  assert.equal(Object.keys(s.phases).length, 0);
});

// ── regression: existing invariants still hold ──────────────────

test("recordTool still pushes into attempts-aware phase object", () => {
  const s = new PipelineState();
  s.openPhaseAttempt("A");
  s.recordTool("A", "Edit", {}, { file_path: "x.js" });
  assert.equal(s.phases.A.tools.length, 1);
  assert.equal(s.phases.A.attempts.length, 1);
});

test("phaseTools() on trimmed phase returns only in-memory tools", () => {
  const s = new PipelineState();
  recordNTools(s, "A", MAX_TOOLS_PER_PHASE + 10);
  const tools = s.phaseTools("A");
  assert.equal(tools.length, MAX_TOOLS_PER_PHASE);
});
