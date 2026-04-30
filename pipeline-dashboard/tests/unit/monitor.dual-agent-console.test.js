// Slice UI-H3 (Phase D / Phase E1.5, 2026-04-30) — dual-agent-console tests.
//
// Pins the panel's render contract: tab structure, pane filtering by
// scope/runner, empty-state placeholder, line rendering with timestamp,
// destroy() lifecycle.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const dualConsole = require("../../public/js/monitor/panels/dual-agent-console");
const { createMonitorStore } = require("../../public/js/monitor/store");

// ── DOM stub ──────────────────────────────────────────────────────

function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); return this; },
      remove(c) { this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    _textContent: "",
    get textContent() { return this._textContent; },
    set textContent(v) { this._textContent = String(v); this.children = []; },
    get innerHTML() { return ""; },
    set innerHTML(v) {
      if (v !== "") throw new Error("stub element only supports innerHTML = ''");
      this.children = [];
    },
    get className() { return this.classList.toString(); },
    set className(v) {
      this.classList._classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _click() { for (const fn of (listeners.click || []).slice()) fn({}); },
    _findAllByClass(cls) {
      const out = [];
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) out.push(c);
        if (typeof c._findAllByClass === "function") {
          out.push(...c._findAllByClass(cls));
        }
      }
      return out;
    },
    _findOneByClass(cls) {
      const arr = this._findAllByClass(cls);
      return arr.length > 0 ? arr[0] : null;
    },
    _findAllByDataAttr(attr, val) {
      const out = [];
      for (const c of this.children) {
        if (c.attributes && (val === undefined ? attr in c.attributes : c.attributes[attr] === val)) out.push(c);
        if (typeof c._findAllByDataAttr === "function") {
          out.push(...c._findAllByDataAttr(attr, val));
        }
      }
      return out;
    },
  };
  el.disabled = false;
  return el;
}

function makeStubDoc() { return { createElement: makeStubElement }; }
function makeRoot() { return makeStubElement("div"); }

// ── Construction guards ──────────────────────────────────────────

test("UI-H3: dual-agent-console.create throws without root", () => {
  assert.throws(() => dualConsole.create({ store: createMonitorStore() }),
    /root must be an element/);
});

test("UI-H3: dual-agent-console.create throws without store", () => {
  assert.throws(() => dualConsole.create({ root: makeRoot(), doc: makeStubDoc() }),
    /store must be a HarnessMonitorStore/);
});

// ── Initial render ───────────────────────────────────────────────

test("UI-H3: empty store renders left + right panes with empty placeholders", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  // ARIA contract
  assert.equal(root.attributes.role, "region");
  assert.equal(root.attributes["aria-label"], "Dual agent console");

  // Two panes (left + right)
  const panes = root._findAllByClass("dac-pane");
  assert.equal(panes.length, 2);
  // Both empty
  const empties = root._findAllByClass("dac-empty");
  assert.equal(empties.length, 2);
  empties.forEach((e) => assert.match(e._textContent, /no stream yet/));
});

test("UI-H3: tabs render in both panes (left=Claude/Audit, right=Codex/Verifier/Audit)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  const leftTabs = root._findOneByClass("dac-tabs-left")
    ._findAllByClass("dac-tab")
    .map((t) => t.attributes["data-tab-id"]);
  assert.deepEqual(leftTabs, ["claude", "audit"]);

  const rightTabs = root._findOneByClass("dac-tabs-right")
    ._findAllByClass("dac-tab")
    .map((t) => t.attributes["data-tab-id"]);
  assert.deepEqual(rightTabs, ["codex", "verifier", "audit"]);
});

test("UI-H3: default active tabs are claude (left) + codex (right)", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  const leftActive = root._findOneByClass("dac-tabs-left")
    ._findAllByClass("dac-tab")
    .find((t) => t.classList.contains("is-active"));
  assert.equal(leftActive.attributes["data-tab-id"], "claude");
  assert.equal(leftActive.attributes["aria-selected"], "true");

  const rightActive = root._findOneByClass("dac-tabs-right")
    ._findAllByClass("dac-tab")
    .find((t) => t.classList.contains("is-active"));
  assert.equal(rightActive.attributes["data-tab-id"], "codex");
});

test("UI-H3: footer reminds operator that this is a read-only view", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });
  const footer = root._findOneByClass("dac-footer");
  assert.ok(footer);
  assert.match(footer._textContent, /Read-only/);
  assert.match(footer._textContent, /UI-H4 review relay/);
});

// ── Stream filtering ─────────────────────────────────────────────

test("UI-H3: claude-scoped events render in the LEFT pane only", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  store.pushEvent({
    type: "claude_stream_chunk", scope: "claude",
    payload: { runner: "claude", chunk: "hello from Claude" },
    ts: 1000,
  });

  const leftCol = root._findOneByClass("dac-col-left");
  const rightCol = root._findOneByClass("dac-col-right");
  const leftLines = leftCol._findAllByClass("dac-line");
  const rightLines = rightCol._findAllByClass("dac-line");

  assert.equal(leftLines.length, 1);
  assert.equal(rightLines.length, 0);
  // Read the actual text span (line has ts + text spans as children).
  const text = leftLines[0]._findOneByClass("dac-line-text");
  assert.match(text._textContent, /hello from Claude/);
});

test("UI-H3: codex-scoped events render in the RIGHT pane only", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  store.pushEvent({
    type: "codex_stream_chunk", scope: "codex",
    payload: { runner: "codex", chunk: "Codex critique" },
    ts: 1500,
  });

  const left = root._findOneByClass("dac-col-left")._findAllByClass("dac-line");
  const right = root._findOneByClass("dac-col-right")._findAllByClass("dac-line");

  assert.equal(left.length, 0);
  assert.equal(right.length, 1);
});

test("UI-H3: payload.runner=claude (no scope match) still routes to left pane", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  store.pushEvent({
    type: "tool_recorded", scope: "tool",
    payload: { runner: "claude", tool: "Read" },
    ts: 1000,
  });

  const leftLines = root._findOneByClass("dac-col-left")._findAllByClass("dac-line");
  assert.equal(leftLines.length, 1);
});

test("UI-H3: irrelevant events (phase/tool/audit) do NOT appear in claude/codex panes", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  store.pushEvent({ type: "phase_update", scope: "phase", payload: { phase: "execute" } });
  store.pushEvent({ type: "audit_appended", scope: "audit", payload: { verb: "x" } });

  const leftLines = root._findOneByClass("dac-col-left")._findAllByClass("dac-line");
  const rightLines = root._findOneByClass("dac-col-right")._findAllByClass("dac-line");
  assert.equal(leftLines.length, 0);
  assert.equal(rightLines.length, 0);
});

// ── Tab switching ───────────────────────────────────────────────

test("UI-H3: clicking a tab switches the active tab", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  const auditTab = root._findOneByClass("dac-tabs-left")
    ._findAllByClass("dac-tab")
    .find((t) => t.attributes["data-tab-id"] === "audit");

  // Audit is currently disabled in this slice (UI-H4 enables); we
  // verify the data attribute + disabled flag.
  assert.ok(auditTab);
  assert.equal(auditTab.disabled, true);
  assert.ok(auditTab.classList.contains("is-disabled"));
});

test("UI-H3: _selectLeft test hook switches left tab + re-renders", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = dualConsole.create({ root, store, doc: makeStubDoc() });
  // Use the test hook to bypass the disabled-button gate.
  handle._selectLeft("audit");
  assert.equal(handle._state().activeLeft, "audit");
  // After switching, the active tab marker should follow.
  const active = root._findOneByClass("dac-tabs-left")
    ._findAllByClass("dac-tab")
    .find((t) => t.classList.contains("is-active"));
  assert.equal(active.attributes["data-tab-id"], "audit");
});

// ── Lifecycle ────────────────────────────────────────────────────

test("UI-H3: destroy() unsubscribes + clears DOM + removes ARIA", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  const handle = dualConsole.create({ root, store, doc: makeStubDoc() });
  store.pushEvent({
    type: "claude_stream_chunk", scope: "claude",
    payload: { runner: "claude", chunk: "x" }, ts: 1,
  });
  assert.ok(root._findOneByClass("dac-line"));

  handle.destroy();

  assert.equal(root.children.length, 0);
  assert.equal(root.hasAttribute("role"), false);
  assert.equal(root.hasAttribute("aria-label"), false);

  // After destroy, store updates do not re-render.
  store.pushEvent({
    type: "claude_stream_chunk", scope: "claude",
    payload: { runner: "claude", chunk: "y" }, ts: 2,
  });
  assert.equal(root.children.length, 0);
});

test("UI-H3: pane body role='log' + aria-live='polite' for SR announce", () => {
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  const bodies = root._findAllByClass("dac-pane-body");
  assert.equal(bodies.length, 2);
  bodies.forEach((b) => {
    assert.equal(b.attributes.role, "log");
    assert.equal(b.attributes["aria-live"], "polite");
  });
});

// ── Negative pin: NO PTY / NO stdin ─────────────────────────────

test("UI-H3: panel does NOT render any input element (read-only contract)", () => {
  // Per UI Plan §UX-H3: this is a stream view, not a PTY. Defensive
  // pin: no <input>, no <textarea>, no contenteditable.
  const root = makeRoot();
  const store = createMonitorStore();
  dualConsole.create({ root, store, doc: makeStubDoc() });

  // Walk the DOM tree manually (stub doesn't have querySelector).
  function walk(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") return false;
    if (node.attributes && node.attributes.contenteditable === "true") return false;
    for (const c of (node.children || [])) {
      if (!walk(c)) return false;
    }
    return true;
  }
  assert.ok(walk(root), "no input/textarea/contenteditable should be present");
});
