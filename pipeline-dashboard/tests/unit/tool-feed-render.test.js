// Slice MA7-a (Phase D, 2026-04-27) — tool-feed-render tests.
//
// Behaviour-preserving lift coverage. Verifies the pure-DOM render
// functions produce the expected DOM shape against a hand-rolled doc
// stub. The legacy app.js still owns the toolFeed / critiqueTimeline /
// findings state — these renderers are stateless.

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/tool-feed-render");

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
      // textContent="" clears children; this matches the legacy semantics
      // that app.js relied on (legacy code: el.textContent = "").
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

const FIXED_HMS = (ts) => "12:34:56";

// ── renderToolFeed ──────────────────────────────────────────────────

test("renderToolFeed shows the empty placeholder when feed is empty", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderToolFeed([]);
  const el = doc.getElementById("tool-feed");
  assert.equal(el.children.length, 1);
  assert.ok(el.children[0].classList.contains("tool-empty"));
  assert.equal(el.children[0]._textContent, "아직 기록된 툴 호출이 없습니다.");
});

test("renderToolFeed renders one .tool-entry per entry + counter", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderToolFeed([
    { ts: 1, phase: "B", tool: "Edit", input: "foo.js" },
    { ts: 2, phase: "C", tool: "Read", input: "bar.md" },
  ]);
  const el = doc.getElementById("tool-feed");
  assert.equal(el.children.length, 2);
  assert.equal(doc.getElementById("tool-feed-counter")._textContent, "2");
  // First entry: time + phase + tool + (empty span) + tool-input.
  const first = el.children[0];
  assert.ok(first.classList.contains("tool-entry"));
  assert.ok(!first.classList.contains("blocked"));
  assert.equal(first._firstByClass("tool-tool")._textContent, "Edit");
  assert.equal(first._firstByClass("tool-input")._textContent, "foo.js");
});

test("renderToolFeed marks blocked entries + carries reason", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderToolFeed([
    { ts: 1, phase: "B", tool: "Bash", blocked: true, reason: "tool not allowed in B" },
  ]);
  const el = doc.getElementById("tool-feed");
  const e = el.children[0];
  assert.ok(e.classList.contains("blocked"));
  assert.equal(e._firstByClass("tool-blocked")._textContent, "BLOCK");
  assert.equal(e._firstByClass("tool-reason")._textContent, "tool not allowed in B");
});

test("renderToolFeed falls back to allowed[].join when reason missing", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderToolFeed([
    { ts: 1, phase: "C", tool: "WebFetch", blocked: true, allowed: ["Read", "Edit"] },
  ]);
  const reason = doc.getElementById("tool-feed").children[0]._firstByClass("tool-reason");
  assert.equal(reason._textContent, "Read,Edit");
});

// ── renderCritiqueTimeline ──────────────────────────────────────────

test("renderCritiqueTimeline shows empty placeholder when timeline empty", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderCritiqueTimeline([]);
  const el = doc.getElementById("critique-timeline");
  assert.equal(el.children.length, 1);
  assert.ok(el.children[0].classList.contains("tool-empty"));
});

test("renderCritiqueTimeline renders entries with chips + summary + top findings", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderCritiqueTimeline([
    {
      ts: 1, phase: "C", iteration: 0,
      counts: { critical: 2, high: 1, medium: 0, low: 0, note: 1 },
      summary: "needs more tests",
      topFindings: [
        { severity: "critical", note: "missing test for foo" },
        { severity: "note", note: "doc nit" },
      ],
    },
  ]);
  const el = doc.getElementById("critique-timeline");
  const entry = el.children[0];
  assert.ok(entry.classList.contains("critique-entry"));
  // chips for critical(2), high(1), note(1) — medium(0) + low(0) skipped.
  const chips = entry._findAllByClass("sev-chip");
  assert.equal(chips.length, 3);
  // summary line.
  assert.equal(entry._firstByClass("critique-summary")._textContent, "needs more tests");
  // top findings.
  const findings = entry._findAllByClass("critique-finding");
  assert.equal(findings.length, 2);
});

test("renderCritiqueTimeline counter advances with timeline length", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderCritiqueTimeline([
    { ts: 1, phase: "C", counts: {}, summary: "", topFindings: [] },
    { ts: 2, phase: "D", counts: {}, summary: "", topFindings: [] },
  ]);
  assert.equal(doc.getElementById("critique-counter")._textContent, "2");
});

// ── renderFindingCounts ─────────────────────────────────────────────

test("renderFindingCounts updates each count-* element", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderFindingCounts({ critical: 3, high: 5, medium: 1, low: 0, note: 2 });
  assert.equal(doc.getElementById("count-critical")._textContent, "3");
  assert.equal(doc.getElementById("count-high")._textContent, "5");
  assert.equal(doc.getElementById("count-medium")._textContent, "1");
  assert.equal(doc.getElementById("count-low")._textContent, "0");
  assert.equal(doc.getElementById("count-note")._textContent, "2");
});

test("renderFindingCounts treats missing severities as 0", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.renderFindingCounts({ critical: 1 });
  assert.equal(doc.getElementById("count-critical")._textContent, "1");
  assert.equal(doc.getElementById("count-medium")._textContent, "0");
});

test("renderFindingCounts is a no-op on null/non-object", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  assert.doesNotThrow(() => r.renderFindingCounts(null));
  assert.doesNotThrow(() => r.renderFindingCounts("garbage"));
});

// ── setBadge ────────────────────────────────────────────────────────

test("setBadge writes class + text to #status-badge", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.setBadge("active", "진행 중");
  const el = doc.getElementById("status-badge");
  assert.equal(el.className, "badge active");
  assert.equal(el._textContent, "진행 중");
});

test("setBadge with empty class still sets the badge prefix", () => {
  const doc = makeStubDoc();
  const r = install({ doc, formatHMS: FIXED_HMS });
  r.setBadge("", "—");
  const el = doc.getElementById("status-badge");
  assert.equal(el.className, "badge");
  assert.equal(el._textContent, "—");
});

// ── degradation when doc missing ─────────────────────────────────────

test("install with no doc returns no-op renderers", () => {
  const r = install({ doc: null });
  // Calling the renderers must not throw even without a real doc.
  assert.doesNotThrow(() => r.renderToolFeed([]));
  assert.doesNotThrow(() => r.renderCritiqueTimeline([]));
  assert.doesNotThrow(() => r.renderFindingCounts({}));
  assert.doesNotThrow(() => r.setBadge("x", "y"));
});

// ── formatHMS injection fallback ─────────────────────────────────────

test("formatHMS callback is invoked for each entry", () => {
  const doc = makeStubDoc();
  let calls = [];
  const r = install({ doc, formatHMS: (ts) => { calls.push(ts); return "T(" + ts + ")"; } });
  r.renderToolFeed([{ ts: 100, phase: "A", tool: "X" }, { ts: 200, phase: "A", tool: "Y" }]);
  assert.deepEqual(calls, [100, 200]);
  // The string returned is what landed in the time span.
  const times = doc.getElementById("tool-feed")._findAllByClass("tool-time");
  assert.equal(times[0]._textContent, "T(100)");
});
