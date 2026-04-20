// Slice H (v5) — FocusTrap unit tests with a hand-rolled DOM (no jsdom).

const test = require("node:test");
const assert = require("node:assert/strict");
const { trap, getFocusables } = require("../../public/js/focus-trap");

// ── Minimal DOM shim ─────────────────────────────────────────────
// Only what `trap()` actually touches:
//   - addEventListener / removeEventListener / dispatch (for keydown)
//   - querySelectorAll  (we return the focusables list directly)
//   - contains(el)      (true if `el` is one of our children)
//   - ownerDocument     (tracks activeElement)

function makeDoc() {
  return { activeElement: null };
}

function makeFocusable(name, doc) {
  const el = {
    name,
    tagName: "BUTTON",
    ownerDocument: doc,
    focused: false,
    focus() {
      this.focused = true;
      doc.activeElement = this;
    },
  };
  return el;
}

function makeContainer(focusables, doc) {
  const listeners = {};
  return {
    focusables,
    ownerDocument: doc,
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    removeEventListener(name, fn) {
      const arr = listeners[name] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    _dispatch(name, ev) {
      (listeners[name] || []).slice().forEach((fn) => fn(ev));
    },
    querySelectorAll() { return this.focusables.slice(); },
    contains(el) { return this.focusables.includes(el); },
    _listeners: listeners,
  };
}

function keyEvent(key, { shiftKey = false } = {}) {
  let prevented = false;
  return {
    key,
    shiftKey,
    preventDefault() { prevented = true; },
    get _prevented() { return prevented; },
  };
}

// ── Tests ────────────────────────────────────────────────────────

test("getFocusables respects container.querySelectorAll output", () => {
  const doc = makeDoc();
  const [a, b] = [makeFocusable("a", doc), makeFocusable("b", doc)];
  const c = makeContainer([a, b], doc);
  assert.deepEqual(getFocusables(c), [a, b]);
});

test("getFocusables of null/missing container is []", () => {
  assert.deepEqual(getFocusables(null), []);
  assert.deepEqual(getFocusables({}), []);
});

test("trap moves focus to first focusable on install", () => {
  const doc = makeDoc();
  const [a, b] = [makeFocusable("a", doc), makeFocusable("b", doc)];
  const c = makeContainer([a, b], doc);
  trap(c);
  assert.ok(a.focused, "first focusable should receive focus");
  assert.equal(doc.activeElement, a);
});

test("trap accepts an explicit initialFocus override", () => {
  const doc = makeDoc();
  const [a, b, c] = [makeFocusable("a", doc), makeFocusable("b", doc), makeFocusable("c", doc)];
  const cont = makeContainer([a, b, c], doc);
  trap(cont, { initialFocus: c });
  assert.ok(c.focused);
});

test("Tab at last focusable wraps to first", () => {
  const doc = makeDoc();
  const [a, b, c] = [makeFocusable("a", doc), makeFocusable("b", doc), makeFocusable("c", doc)];
  const cont = makeContainer([a, b, c], doc);
  trap(cont);
  // Simulate user Tab'd to c
  c.focus();
  const ev = keyEvent("Tab");
  cont._dispatch("keydown", ev);
  assert.ok(ev._prevented, "preventDefault must fire when wrapping");
  assert.ok(a.focused);
});

test("Shift+Tab at first wraps to last", () => {
  const doc = makeDoc();
  const [a, b, c] = [makeFocusable("a", doc), makeFocusable("b", doc), makeFocusable("c", doc)];
  const cont = makeContainer([a, b, c], doc);
  trap(cont);
  a.focus();
  const ev = keyEvent("Tab", { shiftKey: true });
  cont._dispatch("keydown", ev);
  assert.ok(ev._prevented);
  assert.ok(c.focused);
});

test("Tab in middle of the list does NOT prevent default (browser handles it)", () => {
  const doc = makeDoc();
  const [a, b, c] = [makeFocusable("a", doc), makeFocusable("b", doc), makeFocusable("c", doc)];
  const cont = makeContainer([a, b, c], doc);
  trap(cont);
  b.focus();
  const ev = keyEvent("Tab");
  cont._dispatch("keydown", ev);
  assert.equal(ev._prevented, false, "natural Tab between elements must pass through");
});

test("Escape key triggers onEscape callback when provided", () => {
  const doc = makeDoc();
  const [a] = [makeFocusable("a", doc)];
  const cont = makeContainer([a], doc);
  let escaped = false;
  trap(cont, { onEscape: () => { escaped = true; } });
  const ev = keyEvent("Escape");
  cont._dispatch("keydown", ev);
  assert.ok(escaped);
  assert.ok(ev._prevented);
});

test("Escape without onEscape passes through (no preventDefault)", () => {
  const doc = makeDoc();
  const [a] = [makeFocusable("a", doc)];
  const cont = makeContainer([a], doc);
  trap(cont);
  const ev = keyEvent("Escape");
  cont._dispatch("keydown", ev);
  assert.equal(ev._prevented, false);
});

test("release() removes the keydown listener and restores previous focus", () => {
  const doc = makeDoc();
  const prev = makeFocusable("prev", doc);
  prev.focus();
  const [a] = [makeFocusable("a", doc)];
  const cont = makeContainer([a], doc);
  const release = trap(cont);
  assert.ok(a.focused);
  release();
  assert.ok(prev.focused, "previous focus must be restored");
  // After release, Tab event should not be handled
  a.focus();
  const ev = keyEvent("Tab");
  cont._dispatch("keydown", ev);
  assert.equal(ev._prevented, false, "listener must be detached after release");
});

test("trap on an empty focusables list swallows Tab (prevents break-out)", () => {
  const doc = makeDoc();
  const cont = makeContainer([], doc);
  trap(cont);
  const ev = keyEvent("Tab");
  cont._dispatch("keydown", ev);
  assert.ok(ev._prevented);
});

test("trap(null) returns a no-op release", () => {
  const r = trap(null);
  assert.equal(typeof r, "function");
  r(); // must not throw
});
