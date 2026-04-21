// Slice U (v6) — RunTabBarState pure-logic tests. DOM install is covered
// lightly with a hand-rolled element stub so we can assert hide/show + tab
// button behavior without jsdom.

const test = require("node:test");
const assert = require("node:assert/strict");
const { RunTabBarState, install, DEFAULT_RUN_ID } = require("../../public/js/run-tab-bar");

// ── State ────────────────────────────────────────────────────────

test("constructor seeds the default run and sets currentRunId", () => {
  const s = new RunTabBarState();
  assert.equal(s.size(), 1);
  assert.equal(s.current(), DEFAULT_RUN_ID);
  assert.equal(s.list()[0].id, DEFAULT_RUN_ID);
});

test("seen(newRunId) registers and returns changed:true", () => {
  const s = new RunTabBarState();
  const r = s.seen("sess-B");
  assert.equal(r.changed, true);
  assert.equal(s.size(), 2);
  assert.equal(r.entry.label, "sess-B");
});

test("seen(existingRunId) updates lastEventAt but returns changed:false", async () => {
  const s = new RunTabBarState();
  const initial = s.list()[0].lastEventAt;
  await new Promise((r) => setTimeout(r, 5));
  const r = s.seen(DEFAULT_RUN_ID);
  assert.equal(r.changed, false);
  assert.ok(r.entry.lastEventAt > initial);
});

test("seen ignores empty / non-string runId", () => {
  const s = new RunTabBarState();
  assert.equal(s.seen("").changed, false);
  assert.equal(s.seen(null).changed, false);
  assert.equal(s.seen(123).changed, false);
  assert.equal(s.size(), 1);
});

test("complete(runId) marks entry as completed + inactive", () => {
  const s = new RunTabBarState();
  s.seen("sess-B");
  assert.equal(s.complete("sess-B"), true);
  const entry = s.list().find((r) => r.id === "sess-B");
  assert.equal(entry.completed, true);
  assert.equal(entry.active, false);
});

test("complete on unknown runId returns false", () => {
  const s = new RunTabBarState();
  assert.equal(s.complete("ghost"), false);
});

test("select switches currentRunId; unknown returns false", () => {
  const s = new RunTabBarState();
  s.seen("sess-B");
  assert.equal(s.select("sess-B"), true);
  assert.equal(s.current(), "sess-B");
  assert.equal(s.select("ghost"), false);
  assert.equal(s.current(), "sess-B", "current unchanged on bad select");
});

test("remove(default) is refused; remove(other) succeeds", () => {
  const s = new RunTabBarState();
  s.seen("sess-B");
  assert.equal(s.remove(DEFAULT_RUN_ID), false);
  assert.equal(s.remove("sess-B"), true);
  assert.equal(s.size(), 1);
});

test("removing the currently-selected run resets current to default", () => {
  const s = new RunTabBarState();
  s.seen("sess-B");
  s.select("sess-B");
  s.remove("sess-B");
  assert.equal(s.current(), DEFAULT_RUN_ID);
});

test("list() returns entries with id + label + active + completed + lastEventAt", () => {
  const s = new RunTabBarState();
  s.seen("sess-B");
  const entries = s.list();
  assert.equal(entries.length, 2);
  for (const e of entries) {
    assert.ok(typeof e.id === "string");
    assert.ok(typeof e.label === "string");
    assert.ok(typeof e.active === "boolean");
    assert.ok(typeof e.completed === "boolean");
    assert.ok(typeof e.lastEventAt === "number");
  }
});

// ── install with a hand-rolled DOM stub ─────────────────────────

function makeFakeDoc() {
  // Minimal shim: getElementById returns our container. container supports
  // innerHTML, classList, appendChild, createElement via a separate factory.
  const children = [];
  const classList = (() => {
    const set = new Set();
    return {
      add: (...cls) => cls.forEach((c) => set.add(c)),
      remove: (...cls) => cls.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c),
      _set: set,
    };
  })();
  const container = {
    _children: children,
    classList,
    set innerHTML(v) {
      if (v === "") children.length = 0;
    },
    get innerHTML() { return "stub"; },
    appendChild(child) { children.push(child); return child; },
  };
  const doc = {
    getElementById: () => container,
    createElement: () => {
      const listeners = {};
      return {
        type: "",
        className: "",
        dataset: {},
        textContent: "",
        _listeners: listeners,
        setAttribute(k, v) { this[k] = v; },
        addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
        _click: function () { (this._listeners.click || []).forEach((fn) => fn()); },
      };
    },
  };
  return { doc, container };
}

test("install returns a state + render + seen/complete/select API", () => {
  const { doc, container } = makeFakeDoc();
  global.document = doc;
  try {
    const api = install({ mountEl: "run-tabs" });
    assert.ok(api.state instanceof RunTabBarState);
    // Only default run → container hidden
    assert.ok(container.classList.contains("is-hidden"));
    api.seen("sess-B");
    // 2 runs → container shown
    assert.ok(!container.classList.contains("is-hidden"));
    assert.equal(container._children.length, 2);
  } finally {
    delete global.document;
  }
});

test("install onSelect fires when a tab button is clicked", () => {
  const { doc, container } = makeFakeDoc();
  global.document = doc;
  try {
    const selected = [];
    const api = install({
      mountEl: "run-tabs",
      onSelect: (runId) => selected.push(runId),
    });
    api.seen("sess-B");
    // First tab is default, second is sess-B
    container._children[1]._click();
    assert.deepEqual(selected, ["sess-B"]);
  } finally {
    delete global.document;
  }
});

test("install on missing mountEl degrades gracefully (state only)", () => {
  global.document = { getElementById: () => null };
  try {
    const api = install({ mountEl: "missing" });
    // No render errors; seen returns { changed } regardless
    const r = api.seen("x");
    assert.equal(r.changed, false); // state.seen returns true, but fake doc's state object was discarded
  } finally {
    delete global.document;
  }
});

test("install when document is undefined still returns a state", () => {
  // tests are in Node; document may be undefined — install shouldn't throw.
  const prior = global.document;
  delete global.document;
  try {
    const api = install({ mountEl: "run-tabs" });
    assert.ok(api.state instanceof RunTabBarState);
  } finally {
    if (prior !== undefined) global.document = prior;
  }
});
