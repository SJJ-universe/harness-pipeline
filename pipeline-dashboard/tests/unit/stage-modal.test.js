// Slice MA7-b (Phase D, 2026-04-27) — stage-modal tests.
//
// Hand-rolled DOM stub (matches the MA7-a pattern). Verifies that
// open(title, key, { stageLogs, currentPipelineConfig }) drives the
// canonical modal-overlay / modal-title / modal-body shape, including
// the phase-meta header path and the empty-state placeholder.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/stage-modal");

function makeStubElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) {
      this._textContent = String(v);
      if (v === "") this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) { this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    _firstByClass(cls) {
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) return c;
        if (typeof c._firstByClass === "function") {
          const f = c._firstByClass(cls);
          if (f) return f;
        }
      }
      return null;
    },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") out.push(...c._findAllByClass(cls));
      }
      return out;
    },
  };
  return el;
}
function makeStubDoc() {
  const map = new Map();
  return {
    getElementById(id) {
      if (!map.has(id)) map.set(id, makeStubElement("div"));
      return map.get(id);
    },
    createElement: makeStubElement,
    createTextNode: (s) => ({ nodeValue: String(s), _text: true }),
    _registry: map,
  };
}

// ── open / close basics ─────────────────────────────────────────────

test("open writes title + adds .visible to overlay", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Stage A", "stage-A", { stageLogs: { "stage-A": [] }, currentPipelineConfig: null });
  assert.equal(doc.getElementById("modal-title")._textContent, "Stage A");
  assert.ok(doc.getElementById("modal-overlay").classList.contains("visible"));
});

test("close removes .visible from overlay", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  doc.getElementById("modal-overlay").classList.add("visible");
  m.close();
  assert.ok(!doc.getElementById("modal-overlay").classList.contains("visible"));
});

test("open is a no-op when overlay/title/body missing — graceful in tests", () => {
  // doc.getElementById always returns SOMETHING with our stub, so
  // the no-op path is hit when doc itself is null.
  const m = install({ doc: null });
  assert.doesNotThrow(() => m.open("x", "y", {}));
  assert.doesNotThrow(() => m.close());
});

// ── stage logs render ───────────────────────────────────────────────

test("empty stage-log array → modal-empty placeholder", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Stage B", "stage-B", { stageLogs: { "stage-B": [] } });
  const body = doc.getElementById("modal-body");
  assert.ok(body._firstByClass("modal-empty"));
  assert.match(body._firstByClass("modal-empty")._textContent, /로그가 아직 없습니다/);
});

test("populated stage-log renders one .log-entry per item", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Stage C", "stage-C", {
    stageLogs: {
      "stage-C": [
        { time: "12:00:01", message: "first", isError: false },
        { time: "12:00:02", message: "second-error", isError: true },
        "raw string log",
      ],
    },
  });
  const body = doc.getElementById("modal-body");
  const entries = body._findAllByClass("log-entry");
  assert.equal(entries.length, 3);
  // First entry: time + msg.
  assert.equal(entries[0]._firstByClass("log-time")._textContent, "12:00:01");
  assert.equal(entries[0]._firstByClass("log-msg")._textContent, "first");
  // Second entry: error class wired on log-msg.
  const e2msg = entries[1]._firstByClass("log-msg");
  assert.ok(e2msg.classList.contains("error-msg"));
  // Third entry: raw string fallback path → entry.textContent set directly.
  assert.equal(entries[2]._textContent, "raw string log");
});

// ── phase metadata header ───────────────────────────────────────────

test("phase modal with currentPipelineConfig renders modal-phase-meta", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  const config = {
    phases: [
      {
        id: "B", agent: "Claude",
        allowedTools: ["Read", "Edit"],
        exitCriteria: [{ message: "all tests pass" }, { message: "no findings" }],
        cycle: true, maxIterations: 5, linkedCycle: "C",
      },
    ],
  };
  m.open("Phase B", "phase-B", { stageLogs: {}, currentPipelineConfig: config });
  const meta = doc.getElementById("modal-body")._firstByClass("modal-phase-meta");
  assert.ok(meta);
  assert.match(meta._textContent, /Agent: Claude/);
  assert.match(meta._textContent, /Tools: Read, Edit/);
  assert.match(meta._textContent, /Exit: all tests pass; no findings/);
  assert.match(meta._textContent, /Cycle: max 5 iterations → Phase C/);
});

test("non-phase key skips the phase-meta header even with config", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Other", "stage-other", {
    stageLogs: { "stage-other": [] },
    currentPipelineConfig: { phases: [{ id: "B", agent: "X" }] },
  });
  assert.equal(doc.getElementById("modal-body")._firstByClass("modal-phase-meta"), null);
});

test("phase modal with NO matching config phase renders no header", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Ghost", "phase-Z", {
    stageLogs: { "phase-Z": [] },
    currentPipelineConfig: { phases: [{ id: "B", agent: "X" }] },
  });
  assert.equal(doc.getElementById("modal-body")._firstByClass("modal-phase-meta"), null);
});

test("phase with cycle flag but no maxIterations defaults to 3", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("Phase C", "phase-C", {
    stageLogs: {},
    currentPipelineConfig: { phases: [{ id: "C", agent: "Codex", cycle: true }] },
  });
  const meta = doc.getElementById("modal-body")._firstByClass("modal-phase-meta");
  assert.match(meta._textContent, /Cycle: max 3 iterations/);
});

// ── stageLogs key fallback ──────────────────────────────────────────

test("missing stageLogs map → empty placeholder (no crash)", () => {
  const doc = makeStubDoc();
  const m = install({ doc });
  m.open("X", "x", {});
  const body = doc.getElementById("modal-body");
  assert.ok(body._firstByClass("modal-empty"));
});
