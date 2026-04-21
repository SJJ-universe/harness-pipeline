// Slice R (v6) — HarnessEventDispatcher unit tests.
//
// Pure registry module. No DOM dependency.

const test = require("node:test");
const assert = require("node:assert/strict");
const dispatcher = require("../../public/js/event-dispatcher");

function withFreshRegistry(fn) {
  dispatcher._resetForTests();
  fn();
}

test("register + dispatch: handler runs on matching type", () => {
  withFreshRegistry(() => {
    let seen = null;
    dispatcher.register("phase_update", (ev) => { seen = ev; });
    const ran = dispatcher.dispatch({ type: "phase_update", data: { phase: "A" } });
    assert.equal(ran, true);
    assert.deepEqual(seen, { type: "phase_update", data: { phase: "A" } });
  });
});

test("dispatch returns false when no handler is registered", () => {
  withFreshRegistry(() => {
    const ran = dispatcher.dispatch({ type: "unknown_type" });
    assert.equal(ran, false);
  });
});

test("dispatch on malformed event returns false without throwing", () => {
  withFreshRegistry(() => {
    assert.equal(dispatcher.dispatch(null), false);
    assert.equal(dispatcher.dispatch(undefined), false);
    assert.equal(dispatcher.dispatch({}), false);  // no type
    assert.equal(dispatcher.dispatch({ type: 123 }), false); // non-string
  });
});

test("register: same type overwrites previous handler (warns)", () => {
  withFreshRegistry(() => {
    let calls = [];
    dispatcher.register("x", () => calls.push("first"));
    dispatcher.register("x", () => calls.push("second"));
    dispatcher.dispatch({ type: "x" });
    assert.deepEqual(calls, ["second"], "only the latest handler should run");
  });
});

test("register: throws on invalid type", () => {
  withFreshRegistry(() => {
    assert.throws(() => dispatcher.register("", () => {}), /non-empty string/);
    assert.throws(() => dispatcher.register(null, () => {}), /non-empty string/);
    assert.throws(() => dispatcher.register(123, () => {}), /non-empty string/);
  });
});

test("register: throws on invalid handler", () => {
  withFreshRegistry(() => {
    assert.throws(() => dispatcher.register("x", null), /must be a function/);
    assert.throws(() => dispatcher.register("x", "not a fn"), /must be a function/);
  });
});

test("unregister removes a handler and returns true if it existed", () => {
  withFreshRegistry(() => {
    dispatcher.register("x", () => {});
    assert.equal(dispatcher.unregister("x"), true);
    assert.equal(dispatcher.unregister("x"), false, "second unregister → false");
    assert.equal(dispatcher.dispatch({ type: "x" }), false);
  });
});

test("dispatch swallows handler throws and still returns true", () => {
  withFreshRegistry(() => {
    dispatcher.register("x", () => { throw new Error("boom"); });
    // Must NOT propagate
    assert.equal(dispatcher.dispatch({ type: "x" }), true);
  });
});

test("has / size / types inspection helpers", () => {
  withFreshRegistry(() => {
    assert.equal(dispatcher.size(), 0);
    dispatcher.register("a", () => {});
    dispatcher.register("b", () => {});
    assert.equal(dispatcher.size(), 2);
    assert.equal(dispatcher.has("a"), true);
    assert.equal(dispatcher.has("c"), false);
    assert.deepEqual(dispatcher.types().sort(), ["a", "b"]);
  });
});

test("_resetForTests clears the registry", () => {
  dispatcher.register("x", () => {});
  dispatcher._resetForTests();
  assert.equal(dispatcher.size(), 0);
  assert.equal(dispatcher.has("x"), false);
});

test("registered handler receives full event object (type + data)", () => {
  withFreshRegistry(() => {
    let received = null;
    dispatcher.register("tool_recorded", (ev) => { received = ev; });
    const event = { type: "tool_recorded", data: { phase: "A", tool: "Edit" } };
    dispatcher.dispatch(event);
    assert.equal(received.type, "tool_recorded");
    assert.equal(received.data.phase, "A");
    assert.equal(received.data.tool, "Edit");
  });
});
