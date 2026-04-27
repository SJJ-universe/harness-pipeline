// Slice MB4-c (Phase D Round 2, 2026-04-27) — general-pipeline-modal tests.
//
// install() returns { open, close, submit, abort, closeFinalPlan,
// showFinalPlan }. We verify each handler against a hand-rolled doc
// stub + injected fetch / confirm / alert so the legacy behaviour is
// preserved without browser globals.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/general-pipeline-modal");

function makeElement() {
  return {
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
    },
    children: [],
    attributes: {},
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    value: "",
    disabled: false,
    appendChild(c) { this.children.push(c); return c; },
    set className(v) { this._className = v; },
    get className() { return this._className || ""; },
    focus() { this._focused = true; },
  };
}

function makeStubDoc() {
  const map = new Map();
  return {
    getElementById(id) {
      if (!map.has(id)) map.set(id, makeElement());
      return map.get(id);
    },
    createElement() { return makeElement(); },
    createTextNode(s) { return { nodeValue: String(s), _text: true }; },
  };
}

function fakeFetch(impl) {
  let lastCall = null;
  const fn = async (url, opts) => {
    lastCall = { url, opts };
    return typeof impl === "function" ? impl(url, opts) : impl;
  };
  fn.lastCall = () => lastCall;
  return fn;
}

// ── open / close ─────────────────────────────────────────────────────

test("open() adds .visible to general-run-overlay + auto-switches template if not default", () => {
  const doc = makeStubDoc();
  let switchedTo = null;
  const h = install({
    doc,
    loadPipelineTemplate: (id) => { switchedTo = id; },
    getCurrentTemplateId: () => "code-review",
  });
  h.open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.ok(overlay.classList.contains("visible"));
  assert.equal(switchedTo, "default");
});

test("open() does NOT switch template when already on default", () => {
  const doc = makeStubDoc();
  let switchedTo = null;
  const h = install({
    doc,
    loadPipelineTemplate: (id) => { switchedTo = id; },
    getCurrentTemplateId: () => "default",
  });
  h.open();
  assert.equal(switchedTo, null);
});

test("close() removes .visible from general-run-overlay", () => {
  const doc = makeStubDoc();
  const h = install({ doc });
  h.open();
  h.close();
  assert.ok(!doc.getElementById("general-run-overlay").classList.contains("visible"));
});

// ── submit() ─────────────────────────────────────────────────────────

test("submit() rejects task < 3 chars + alerts the user", async () => {
  const doc = makeStubDoc();
  doc.getElementById("gr-task-input").value = "ab";
  let alerted = null;
  const h = install({
    doc, fetchImpl: fakeFetch({ ok: true, json: async () => ({}) }),
    alertFn: (msg) => { alerted = msg; },
  });
  await h.submit();
  assert.match(alerted, /3자 이상/);
});

test("submit() POSTs /api/pipeline/general-run + closes modal on success", async () => {
  const doc = makeStubDoc();
  doc.getElementById("gr-task-input").value = "implement feature foo";
  doc.getElementById("gr-max-iter").value = "5";
  const overlay = doc.getElementById("general-run-overlay");
  overlay.classList.add("visible");
  let logged = null;
  const _fetch = fakeFetch({ ok: true, json: async () => ({}) });
  const h = install({
    doc, fetchImpl: _fetch,
    addLog: (kind, msg) => { logged = { kind, msg }; },
  });
  await h.submit();
  const call = _fetch.lastCall();
  assert.equal(call.url, "/api/pipeline/general-run");
  assert.equal(call.opts.method, "POST");
  const body = JSON.parse(call.opts.body);
  assert.equal(body.task, "implement feature foo");
  assert.equal(body.maxIterations, 5);
  // Modal closed.
  assert.ok(!overlay.classList.contains("visible"));
  // Log fired.
  assert.equal(logged.kind, "phase");
  assert.match(logged.msg, /범용 파이프라인 시작/);
});

test("submit() shows alert + leaves modal open on non-2xx", async () => {
  const doc = makeStubDoc();
  doc.getElementById("gr-task-input").value = "ok task";
  let alerted = null;
  const _fetch = fakeFetch({ ok: false, status: 500, json: async () => ({ error: "boom" }) });
  const h = install({
    doc, fetchImpl: _fetch, alertFn: (m) => { alerted = m; },
  });
  await h.submit();
  assert.match(alerted, /시작 실패/);
});

test("submit() handles fetch throw + restores trigger button", async () => {
  const doc = makeStubDoc();
  doc.getElementById("gr-task-input").value = "ok task";
  doc.getElementById("btn-start-general").disabled = false;
  let alerted = null;
  const h = install({
    doc, fetchImpl: async () => { throw new Error("net down"); },
    alertFn: (m) => { alerted = m; },
  });
  await h.submit();
  assert.match(alerted, /net down/);
  assert.equal(doc.getElementById("btn-start-general").disabled, false);
});

// ── abort() ──────────────────────────────────────────────────────────

test("abort() POSTs /api/pipeline/general-abort when user confirms", async () => {
  const doc = makeStubDoc();
  let aborted = false;
  const h = install({
    doc,
    fetchImpl: async (url) => {
      if (url === "/api/pipeline/general-abort") aborted = true;
      return { ok: true, json: async () => ({}) };
    },
    confirmFn: () => true,
  });
  await h.abort();
  assert.equal(aborted, true);
});

test("abort() respects user cancel", async () => {
  const doc = makeStubDoc();
  let aborted = false;
  const h = install({
    doc,
    fetchImpl: async () => { aborted = true; return { ok: true, json: async () => ({}) }; },
    confirmFn: () => false,
  });
  await h.abort();
  assert.equal(aborted, false);
});

// ── showFinalPlan() ──────────────────────────────────────────────────

test("showFinalPlan() renders verdict + counts + finalPlan", () => {
  const doc = makeStubDoc();
  const h = install({ doc });
  h.showFinalPlan({
    verdict: "CONCERNS",
    iterations: 2,
    durationMs: 12345,
    finalPlan: "PLAN BODY",
    lastCritique: { findings: [{ severity: "high" }, { severity: "medium" }] },
    reason: null,
  });
  const overlay = doc.getElementById("final-plan-overlay");
  assert.ok(overlay.classList.contains("visible"));
  const meta = doc.getElementById("final-plan-meta");
  // meta.children: [textNode("판정: "), span(verdict), textNode(" · ...")]
  assert.equal(meta.children.length, 3);
  // The span has className = "warn" for CONCERNS.
  const verdictSpan = meta.children[1];
  assert.equal(verdictSpan.className, "warn");
  assert.equal(verdictSpan._textContent, "CONCERNS");
  const text = doc.getElementById("final-plan-text");
  assert.equal(text._textContent, "PLAN BODY");
});

test("closeFinalPlan() removes .visible from final-plan-overlay", () => {
  const doc = makeStubDoc();
  doc.getElementById("final-plan-overlay").classList.add("visible");
  const h = install({ doc });
  h.closeFinalPlan();
  assert.ok(!doc.getElementById("final-plan-overlay").classList.contains("visible"));
});

test("showFinalPlan() handles missing critique + null finalPlan defensively", () => {
  const doc = makeStubDoc();
  const h = install({ doc });
  h.showFinalPlan({ verdict: "CLEAN", iterations: 0, durationMs: 50 });
  const text = doc.getElementById("final-plan-text");
  assert.equal(text._textContent, "(플랜 없음)");
});
