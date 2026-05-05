// Slice PRODUCT-SHELL-WIRING (rc.5 prep, 2026-05-06) — modal lazy-DOM
// + self-binding tests.
//
// In product shell mode (`/`) there's no `app.js` doing
// `_b("#btn-gr-start", submitGeneralRun)`. The modal module now
// builds its own overlay DOM AND attaches its own click listeners
// when the existing `general-run-overlay` is missing. These tests
// pin both the structure of the lazy-created tree and the binding
// behaviour (clicks → submit/close, ESC → close, backdrop → close).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../../public/js/general-pipeline-modal");

// ── DOM stub with proper getElementById tracking ───────────────────
//
// The existing modal test stub auto-creates elements on every
// getElementById call — perfect for "modal already exists" semantics.
// For the lazy-DOM path we need a stub where getElementById returns
// null until `body.appendChild(...)` plants an element with that id.

function makeLazyStubDoc() {
  const idMap = new Map();

  function makeElement(tag) {
    const _listeners = {};
    let _id = "";
    const el = {
      tagName: String(tag).toUpperCase(),
      get id() { return _id; },
      set id(v) { _id = String(v || ""); },
      children: [],
      attributes: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
      },
      _className: "",
      get className() { return this._className; },
      set className(v) { this._className = String(v); },
      _textContent: "",
      get textContent() { return this._textContent; },
      set textContent(v) { this._textContent = String(v); this.children = []; },
      style: {},
      value: "",
      disabled: false,
      type: "",
      appendChild(c) {
        this.children.push(c);
        c.parentNode = this;
        return c;
      },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener(name, fn) { (_listeners[name] = _listeners[name] || []).push(fn); },
      _click() {
        for (const fn of (_listeners.click || [])) fn({ type: "click", target: el });
      },
      _trigger(name, evt) {
        for (const fn of (_listeners[name] || [])) fn(evt || { type: name });
      },
      focus() { this._focused = true; },
    };
    return el;
  }

  function _registerSubtree(el) {
    if (!el) return;
    if (el.id) idMap.set(el.id, el);
    for (const c of (el.children || [])) _registerSubtree(c);
  }

  const body = makeElement("body");

  return {
    body,
    createElement(tag) { return makeElement(tag); },
    createTextNode(text) { return { nodeValue: String(text), nodeType: 3 }; },
    getElementById(id) {
      // Re-walk on every lookup so ids set after appendChild are found.
      _registerSubtree(body);
      return idMap.get(id) || null;
    },
  };
}

function makeFakeFetch({ ok = true, body = null, error = null } = {}) {
  const calls = [];
  return {
    fetchImpl(url, init) {
      calls.push({ url, init });
      if (error) return Promise.reject(error);
      return Promise.resolve({
        ok,
        status: ok ? 200 : 500,
        async json() { return body || {}; },
      });
    },
    calls,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

test("open() creates overlay DOM when general-run-overlay is missing (lazy path)", () => {
  const doc = makeLazyStubDoc();
  assert.equal(doc.getElementById("general-run-overlay"), null,
    "precondition: overlay must NOT exist before open()");
  const modal = install({ doc });
  modal.open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.ok(overlay, "open() must lazy-create the overlay");
  assert.ok(overlay.classList.contains("visible"));
});

test("lazy-created overlay carries data-modal-source=\"product\" + role=\"dialog\"", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.equal(overlay.getAttribute("data-modal-source"), "product");
  assert.equal(overlay.getAttribute("role"), "dialog");
  assert.equal(overlay.getAttribute("aria-modal"), "true");
});

test("lazy-created modal includes the four required ids (overlay/task/iter/start)", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  for (const id of ["general-run-overlay", "gr-task-input", "gr-max-iter", "btn-gr-start", "btn-gr-cancel"]) {
    assert.ok(doc.getElementById(id), `lazy-created modal must expose id="${id}"`);
  }
});

test("lazy-created modal includes a close (×) button with class=modal-close", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  const overlay = doc.getElementById("general-run-overlay");
  // walk overlay subtree to find the .modal-close child
  let found = null;
  function walk(el) {
    if (!el || found) return;
    if (el._className && /\bmodal-close\b/.test(el._className)) { found = el; return; }
    for (const c of (el.children || [])) walk(c);
  }
  walk(overlay);
  assert.ok(found, "lazy-created modal must expose a .modal-close button");
});

test("open() reuses existing overlay DOM when present (legacy path) — does NOT inject duplicate", () => {
  const doc = makeLazyStubDoc();
  // Pre-plant a legacy-shaped overlay.
  const legacy = doc.createElement("div");
  legacy.id = "general-run-overlay";
  legacy.className = "modal-overlay legacy-shape";
  doc.body.appendChild(legacy);
  // Sanity precondition.
  assert.ok(doc.getElementById("general-run-overlay"));
  install({ doc }).open();
  // Lazy create should NOT have stamped data-modal-source on a legacy overlay
  // (the function returns the existing element without touching it).
  const overlay = doc.getElementById("general-run-overlay");
  const stamp = overlay.getAttribute("data-modal-source");
  assert.ok(stamp == null,
    "legacy overlay must NOT be stamped data-modal-source=product (got: " + stamp + ")");
  assert.ok(overlay.classList.contains("visible"));
});

test("lazy-created modal binds 시작 button click → submit() (POSTs /api/pipeline/general-run)", async () => {
  const doc = makeLazyStubDoc();
  const { fetchImpl, calls } = makeFakeFetch({ ok: true, body: { runId: "test-run" } });
  const modal = install({ doc, fetchImpl });
  modal.open();
  // Populate the task field so the 3-char guard passes.
  doc.getElementById("gr-task-input").value = "Add JWT auth middleware";
  // Click the Start button — the lazy-create branch wired this to submit().
  const startBtn = doc.getElementById("btn-gr-start");
  startBtn._click();
  // submit() is async; wait one tick.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 1, "click on 시작 must trigger fetch");
  assert.equal(calls[0].url, "/api/pipeline/general-run");
  assert.equal(calls[0].init.method, "POST");
  const sentBody = JSON.parse(calls[0].init.body);
  assert.equal(sentBody.task, "Add JWT auth middleware");
  assert.equal(sentBody.maxIterations, 3);
});

test("lazy-created modal binds 취소 (cancel) button click → close()", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.ok(overlay.classList.contains("visible"));
  doc.getElementById("btn-gr-cancel")._click();
  assert.equal(overlay.classList.contains("visible"), false,
    "cancel must remove .visible (close)");
});

test("lazy-created modal binds backdrop click on overlay itself → close()", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.ok(overlay.classList.contains("visible"));
  // Synthesize a click whose target IS the overlay (backdrop, not content).
  overlay._trigger("click", { type: "click", target: overlay });
  assert.equal(overlay.classList.contains("visible"), false,
    "backdrop click must close the overlay");
});

test("lazy-created modal binds ESC key on overlay → close()", () => {
  const doc = makeLazyStubDoc();
  install({ doc }).open();
  const overlay = doc.getElementById("general-run-overlay");
  assert.ok(overlay.classList.contains("visible"));
  overlay._trigger("keydown", { type: "keydown", key: "Escape" });
  assert.equal(overlay.classList.contains("visible"), false);
});

test("installFocusTrap opt is invoked with overlay + onEscape on open()", () => {
  const doc = makeLazyStubDoc();
  const trapCalls = [];
  function fakeTrap(container, opts) {
    trapCalls.push({ container, opts });
    return function release() { trapCalls.push({ released: true }); };
  }
  const modal = install({ doc, installFocusTrap: fakeTrap });
  modal.open();
  assert.equal(trapCalls.length, 1, "installFocusTrap must fire once on open");
  assert.equal(trapCalls[0].container, doc.getElementById("general-run-overlay"));
  assert.equal(typeof trapCalls[0].opts.onEscape, "function");
  // close() must release the trap.
  modal.close();
  assert.equal(trapCalls[1].released, true,
    "close() must invoke the release function returned by installFocusTrap");
});

test("submit() with task < 3 chars alerts + does NOT fire fetch", async () => {
  const doc = makeLazyStubDoc();
  const alerts = [];
  const { fetchImpl, calls } = makeFakeFetch({ ok: true });
  const modal = install({
    doc,
    fetchImpl,
    alertFn: (msg) => alerts.push(msg),
  });
  modal.open();
  doc.getElementById("gr-task-input").value = "ab"; // 2 chars
  doc.getElementById("btn-gr-start")._click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 0, "fetch must NOT fire for short task");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /3자/);
});
