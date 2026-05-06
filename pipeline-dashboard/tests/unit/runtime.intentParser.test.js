// Slice AGENT-DESKTOP-0-a (2026-05-06) — intentParser unit tests.
//
// Pure-function tests of the chat-input → action-proposal classifier.
// Covers: 5 known intents (KO + EN keywords), general_task fallback,
// length guards, PII branching (public-sector block vs standard warn),
// classifierTrace correctness, alternatives shape, confidence.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseIntent,
  KNOWN_INTENTS,
  INTENT_RULES,
  MIN_FREEFORM_LENGTH,
  MIN_INPUT_LENGTH,
  MAX_INPUT_LENGTH,
} = require("../../src/runtime/intentParser");

// ── Length guards ──────────────────────────────────────────────────

test("blocked_input_too_short fires for empty / whitespace-only / 1-char input", () => {
  for (const text of ["", " ", "\n", "a"]) {
    const p = parseIntent({ text });
    assert.equal(p.intent, "blocked_input_too_short", `text=${JSON.stringify(text)}`);
    assert.equal(p.requiresApproval, false);
    assert.match(p.classifierTrace, /blocked/);
  }
});

test("blocked_input_too_long fires for input > MAX_INPUT_LENGTH", () => {
  const text = "a".repeat(MAX_INPUT_LENGTH + 1);
  const p = parseIntent({ text });
  assert.equal(p.intent, "blocked_input_too_long");
  assert.equal(p.requiresApproval, false);
});

test("MIN_INPUT_LENGTH sanity: 2 chars passes the short-input guard", () => {
  // Exactly 2 chars must not trigger blocked_input_too_short.
  const p = parseIntent({ text: "ok" });
  assert.notEqual(p.intent, "blocked_input_too_short");
});

// ── PII gate ───────────────────────────────────────────────────────

test("public-sector + PII → blocked_pii (no Approve allowed)", () => {
  const p = parseIntent({
    text: "코덱스 검증",
    deploymentMode: "public-sector",
    piiContext: { hasPii: true, findings: [{ type: "krn" }] },
  });
  assert.equal(p.intent, "blocked_pii");
  assert.equal(p.requiresApproval, false);
  assert.equal(p.riskLevel, "high");
  assert.match(p.classifierTrace, /pii in public-sector/);
});

test("standard + PII → does NOT block; passes piiContext through to proposal", () => {
  const p = parseIntent({
    text: "코덱스 검증",
    deploymentMode: "standard",
    piiContext: { hasPii: true, findings: [{ type: "krn" }] },
  });
  assert.equal(p.intent, "codex_verify");
  assert.equal(p.requiresApproval, true);
  // piiContext flows through so the UI can render the redacted echo
  assert.equal(p.piiContext.hasPii, true);
});

test("standard + PII on a long task → general_task with riskLevel=high (PII bump)", () => {
  const p = parseIntent({
    text: "주민번호 990101-1234567 사용자 데이터를 정리해줘 — 자세한 분석 부탁",
    deploymentMode: "standard",
    piiContext: { hasPii: true, findings: [{ type: "krn" }] },
  });
  assert.equal(p.intent, "general_task");
  assert.equal(p.riskLevel, "high",
    "standard mode + PII bumps general_task risk from medium to high");
});

// ── codex_verify ───────────────────────────────────────────────────

test("codex_verify matches '코덱스 검증' (KO)", () => {
  const p = parseIntent({ text: "코덱스 검증" });
  assert.equal(p.intent, "codex_verify");
  assert.equal(p.confidence, 1.0);
  assert.match(p.classifierTrace, /matched:codex_verify/);
});

test("codex_verify matches 'Codex 검증' (mixed case)", () => {
  const p = parseIntent({ text: "Codex 검증" });
  assert.equal(p.intent, "codex_verify");
});

test("codex_verify matches 'verify codex' (EN)", () => {
  const p = parseIntent({ text: "verify codex" });
  assert.equal(p.intent, "codex_verify");
});

test("codex_verify matches 'codex check' (EN)", () => {
  const p = parseIntent({ text: "codex check" });
  assert.equal(p.intent, "codex_verify");
});

// ── show_status ────────────────────────────────────────────────────

test("show_status matches '상태 알려줘' (KO)", () => {
  const p = parseIntent({ text: "상태 알려줘" });
  assert.equal(p.intent, "show_status");
});

test("show_status matches '진행 상황' (KO)", () => {
  const p = parseIntent({ text: "진행 상황" });
  assert.equal(p.intent, "show_status");
});

test("show_status matches 'where am i' (EN)", () => {
  const p = parseIntent({ text: "where am i" });
  assert.equal(p.intent, "show_status");
});

// ── open_history ───────────────────────────────────────────────────

test("open_history matches '히스토리 보여줘' (KO)", () => {
  const p = parseIntent({ text: "히스토리 보여줘" });
  assert.equal(p.intent, "open_history");
});

test("open_history matches '지난 작업 보여' (KO)", () => {
  const p = parseIntent({ text: "지난 작업 보여" });
  assert.equal(p.intent, "open_history");
});

test("open_history matches 'history' (EN)", () => {
  const p = parseIntent({ text: "history" });
  assert.equal(p.intent, "open_history");
});

// ── open_metrics ───────────────────────────────────────────────────

test("open_metrics matches '메트릭 보여줘' (KO)", () => {
  const p = parseIntent({ text: "메트릭 보여줘" });
  assert.equal(p.intent, "open_metrics");
});

test("open_metrics matches '통계' (KO)", () => {
  const p = parseIntent({ text: "통계" });
  assert.equal(p.intent, "open_metrics");
});

test("open_metrics matches 'analytics' (EN)", () => {
  const p = parseIntent({ text: "analytics" });
  assert.equal(p.intent, "open_metrics");
});

// ── start_run (narrow on purpose) ──────────────────────────────────

test("start_run matches bare '시작' (KO)", () => {
  const p = parseIntent({ text: "시작" });
  assert.equal(p.intent, "start_run");
  assert.equal(p.riskLevel, "medium",
    "start_run with empty task is medium-risk; user must edit before approve");
  assert.equal(p.parameters.task, "",
    "start_run produces empty task — operator fills via Edit");
});

test("start_run matches 'execute' (EN)", () => {
  const p = parseIntent({ text: "execute" });
  assert.equal(p.intent, "start_run");
});

test("start_run does NOT match '코드 리뷰 시작' (subject-prefixed; falls to general_task)", () => {
  const p = parseIntent({ text: "코드 리뷰 시작" });
  // Short text but matcher is anchored to ^...$ for bare verbs
  // → falls through to general_task path
  assert.equal(p.intent, "general_task");
});

// ── general_task fallback ──────────────────────────────────────────

test("general_task fires for unknown short text", () => {
  const p = parseIntent({ text: "asdfqwer" });
  assert.equal(p.intent, "general_task");
  assert.equal(p.parameters.task, "asdfqwer");
  assert.equal(p.parameters.maxIterations, 3);
  assert.equal(p.confidence, 0.5);
  assert.match(p.classifierTrace, /fallback:general_task/);
});

test("general_task fires for long Korean task description (auto-routed by length)", () => {
  // Even though "검증" appears, the input is long enough to be
  // routed to general_task automatically (length ≥ MIN_FREEFORM_LENGTH).
  const text = "이 프로젝트가 배포 가능한지 코덱스로 검증하고 보고서로 정리해줘";
  assert(text.length >= MIN_FREEFORM_LENGTH,
    `precondition: text must be ≥ ${MIN_FREEFORM_LENGTH} chars (got ${text.length})`);
  const p = parseIntent({ text });
  assert.equal(p.intent, "general_task");
  assert.equal(p.parameters.task, text);
  assert.match(p.classifierTrace, /auto-routed to general_task/);
});

test("general_task includes 1-iter and 5-iter alternatives", () => {
  const p = parseIntent({ text: "예쁜 웹페이지 만들어줘" });
  assert.equal(p.intent, "general_task");
  assert.equal(p.alternatives.length, 2);
  assert.equal(p.alternatives[0].parameters.maxIterations, 1);
  assert.equal(p.alternatives[1].parameters.maxIterations, 5);
});

// ── Cross-cutting invariants ───────────────────────────────────────

test("every intent in INTENT_RULES is listed in KNOWN_INTENTS", () => {
  for (const rule of INTENT_RULES) {
    assert.ok(KNOWN_INTENTS.includes(rule.intent),
      `INTENT_RULES has ${rule.intent} but KNOWN_INTENTS does not`);
  }
});

test("KNOWN_INTENTS includes the catch-all + block intents", () => {
  for (const id of ["general_task", "blocked_pii", "blocked_input_too_short", "blocked_input_too_long"]) {
    assert.ok(KNOWN_INTENTS.includes(id), `KNOWN_INTENTS missing: ${id}`);
  }
});

test("every parser output carries classifierTrace + confidence + piiContext", () => {
  const inputs = [
    { text: "코덱스 검증" },
    { text: "asdf" },
    { text: "ab" },
    { text: "a".repeat(MAX_INPUT_LENGTH + 1) },
    { text: "코덱스 검증", deploymentMode: "public-sector",
      piiContext: { hasPii: true, findings: [{ type: "krn" }] } },
  ];
  for (const inp of inputs) {
    const p = parseIntent(inp);
    assert.ok(typeof p.classifierTrace === "string" && p.classifierTrace.length > 0);
    assert.ok(typeof p.confidence === "number" && p.confidence >= 0 && p.confidence <= 1);
    // piiContext is null when none was passed; otherwise echoed through
    assert.ok("piiContext" in p);
  }
});

test("parser is stateless: same input twice produces equal output", () => {
  const opts = { text: "코덱스 검증해줘" };
  const a = parseIntent(opts);
  const b = parseIntent(opts);
  assert.deepEqual(a, b);
});

test("parser handles missing opts defensively (empty object → too short)", () => {
  const p = parseIntent({});
  assert.equal(p.intent, "blocked_input_too_short");
});

test("parser handles non-string text defensively", () => {
  const p = parseIntent({ text: null });
  assert.equal(p.intent, "blocked_input_too_short");
  const p2 = parseIntent({ text: 12345 });
  assert.equal(p2.intent, "blocked_input_too_short");
});
