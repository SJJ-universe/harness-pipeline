// Slice C (v4) — ToastState (pure logic) + install() DOM wiring behavior.
//
// We avoid jsdom by exercising the pure ToastState class for queue/dedup
// semantics, then use a minimal hand-rolled fake document/window for the
// install() path. That keeps the test suite dependency-light while still
// proving the real DOM-facing code paths.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ToastState, install } = require("../../public/js/toast");

// ── ToastState pure logic ──────────────────────────────────────────

test("ToastState.add returns { added } for a first-seen message", () => {
  const s = new ToastState({ maxStack: 3 });
  const r = s.add({ type: "info", message: "hello" });
  assert.ok(r.added);
  assert.equal(r.added.message, "hello");
  assert.equal(r.added.count, 1);
  assert.equal(s.size(), 1);
});

test("ToastState.add dedups same type+message and bumps counter", () => {
  const s = new ToastState();
  s.add({ type: "warn", message: "flaky network" });
  const r = s.add({ type: "warn", message: "flaky network" });
  assert.ok(r.existing, "second add should return { existing }");
  assert.equal(r.existing.count, 2);
  assert.equal(s.size(), 1, "no new stack entry for a dup");
});

test("ToastState.add does NOT dedup across different types", () => {
  const s = new ToastState();
  s.add({ type: "info", message: "x" });
  const r = s.add({ type: "error", message: "x" });
  assert.ok(r.added, "same text with different type is a separate toast");
  assert.equal(s.size(), 2);
});

test("ToastState evicts FIFO when maxStack is exceeded", () => {
  const s = new ToastState({ maxStack: 2 });
  s.add({ type: "info", message: "a" });
  s.add({ type: "info", message: "b" });
  const r = s.add({ type: "info", message: "c" });
  assert.equal(s.size(), 2);
  assert.ok(r.evicted && r.evicted.length === 1);
  assert.equal(r.evicted[0].message, "a");
  // Order: b, c
  assert.deepEqual(s.snapshot().map((t) => t.message), ["b", "c"]);
});

test("ToastState rejects empty messages", () => {
  const s = new ToastState();
  const r = s.add({ type: "info", message: "" });
  assert.equal(r.rejected, "empty-message");
  assert.equal(s.size(), 0);
});

test("ToastState.remove(id) removes and returns the entry", () => {
  const s = new ToastState();
  const { added } = s.add({ type: "info", message: "x" });
  const removed = s.remove(added.id);
  assert.equal(removed.message, "x");
  assert.equal(s.size(), 0);
  // Unknown id returns null
  assert.equal(s.remove("nope"), null);
});

test("ToastState.snapshot hides the onAction function reference", () => {
  const s = new ToastState();
  s.add({ type: "error", message: "x", actionLabel: "retry", onAction: () => {} });
  const snap = s.snapshot();
  assert.equal(snap[0].onAction, true, "snapshot should only expose a boolean for onAction");
});

// ── install() DOM wiring ───────────────────────────────────────────

function makeFakeDom() {
  const timers = new Map();
  let nextTimer = 1;
  const container = makeEl("div");
  container.id = "toast-container";

  function makeEl(tag) {
    const el = {
      tag, children: [], attrs: {}, dataset: {}, className: "",
      parentNode: null,
      _listeners: {},
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) {
        const i = this.children.indexOf(child);
        if (i >= 0) { this.children.splice(i, 1); child.parentNode = null; }
        return child;
      },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k]; },
      addEventListener(name, fn) { (this._listeners[name] ||= []).push(fn); },
      click() { (this._listeners.click || []).forEach((fn) => fn()); },
      querySelector(sel) {
        // bare-bones support for ".toast-count" and ".toast-action"
        const name = sel.startsWith(".") ? sel.slice(1) : sel;
        const walk = (node) => {
          if (node.className && String(node.className).split(/\s+/).includes(name)) return node;
          for (const c of node.children) {
            const hit = walk(c);
            if (hit) return hit;
          }
          return null;
        };
        return walk(this);
      },
      get textContent() { return this._text || ""; },
      set textContent(v) { this._text = String(v); this.children.length = 0; },
    };
    return el;
  }

  const doc = {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => (id === "toast-container" ? container : null),
  };
  const win = {
    setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    _fireAllTimers() {
      for (const { fn } of timers.values()) fn();
      timers.clear();
    },
    _timerCount() { return timers.size; },
  };
  return { doc, win, container, timers };
}

test("install() renders a toast element when show() is called", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  const id = api.show({ type: "info", message: "hello" });
  assert.ok(id);
  assert.equal(container.children.length, 1);
  const node = container.children[0];
  assert.equal(node.className, "toast toast-info");
  assert.equal(node.getAttribute("role"), "status");
  assert.equal(node.getAttribute("aria-live"), "polite");
});

test("install() uses role=alert + aria-live=assertive for error toasts", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  api.show({ type: "error", message: "boom" });
  const node = container.children[0];
  assert.equal(node.getAttribute("role"), "alert");
  assert.equal(node.getAttribute("aria-live"), "assertive");
});

test("install() updates the count badge on a dup without adding a second node", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  api.show({ type: "warn", message: "flaky" });
  api.show({ type: "warn", message: "flaky" });
  api.show({ type: "warn", message: "flaky" });
  assert.equal(container.children.length, 1, "dups must not stack in the DOM");
  const badge = container.children[0].querySelector(".toast-count");
  assert.equal(badge.textContent, "×3");
});

test("install() evicts the oldest node when stack fills up", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win, maxStack: 2 });
  api.show({ type: "info", message: "a" });
  api.show({ type: "info", message: "b" });
  api.show({ type: "info", message: "c" });
  assert.equal(container.children.length, 2);
  const labels = container.children.map((n) => n.querySelector(".toast-text").textContent);
  assert.deepEqual(labels, ["b", "c"]);
});

test("install() auto-dismisses when the timer fires", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  api.show({ type: "info", message: "fade me", duration: 500 });
  assert.equal(container.children.length, 1);
  win._fireAllTimers();
  assert.equal(container.children.length, 0);
});

test("install() action button invokes onAction and auto-dismisses", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  let fired = 0;
  api.show({
    type: "error",
    message: "retryable",
    actionLabel: "재시도",
    onAction: () => { fired++; },
  });
  const btn = container.children[0].querySelector(".toast-action");
  assert.ok(btn, "action button must exist when actionLabel is provided");
  btn.click();
  assert.equal(fired, 1);
  assert.equal(container.children.length, 0, "toast dismisses after action");
});

test("install() close button dismisses without firing onAction", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  let fired = 0;
  api.show({
    type: "error", message: "x",
    actionLabel: "재시도", onAction: () => { fired++; },
  });
  const close = container.children[0].querySelector(".toast-close");
  close.click();
  assert.equal(fired, 0);
  assert.equal(container.children.length, 0);
});

test("install() clear() wipes all toasts and timers", () => {
  const { doc, win, container } = makeFakeDom();
  const api = install({ doc, win });
  api.show({ type: "info", message: "a" });
  api.show({ type: "warn", message: "b" });
  api.show({ type: "error", message: "c" });
  assert.equal(container.children.length, 3);
  api.clear();
  assert.equal(container.children.length, 0);
  assert.equal(win._timerCount(), 0, "clear() must release dismiss timers");
});

test("install() with no #toast-container still accepts show() without throwing", () => {
  const { win } = makeFakeDom();
  const docNoContainer = {
    createElement: () => ({
      appendChild() {}, setAttribute() {}, addEventListener() {},
      querySelector: () => null,
      dataset: {}, className: "",
    }),
    getElementById: () => null,
  };
  const api = install({ doc: docNoContainer, win });
  // Should not throw even though the container is missing.
  const id = api.show({ type: "info", message: "x" });
  assert.ok(id);
});
