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

// ── Slice MB4-a (Phase D Round 2): wildcard taps ─────────────────────

test("addTap accepts only functions", () => {
  withFreshRegistry(() => {
    assert.throws(() => dispatcher.addTap(null), /must be a function/);
    assert.throws(() => dispatcher.addTap(42),  /must be a function/);
  });
});

test("notifyTaps fires every tap with the same event", () => {
  withFreshRegistry(() => {
    const seenA = []; const seenB = [];
    dispatcher.addTap((ev) => seenA.push(ev));
    dispatcher.addTap((ev) => seenB.push(ev));
    dispatcher.notifyTaps({ type: "x", data: { v: 1 } });
    dispatcher.notifyTaps({ type: "y", data: { v: 2 } });
    assert.equal(seenA.length, 2);
    assert.equal(seenB.length, 2);
    assert.equal(seenA[1].type, "y");
  });
});

test("notifyTaps fires for events with NO registered handler", () => {
  // The whole point of taps — wildcard observation.
  withFreshRegistry(() => {
    let seen = null;
    dispatcher.addTap((ev) => { seen = ev; });
    dispatcher.notifyTaps({ type: "totally_made_up", data: {} });
    assert.ok(seen);
    assert.equal(seen.type, "totally_made_up");
  });
});

test("addTap returns an unsubscribe handle", () => {
  withFreshRegistry(() => {
    let calls = 0;
    const off = dispatcher.addTap(() => { calls++; });
    dispatcher.notifyTaps({ type: "x" });
    off();
    dispatcher.notifyTaps({ type: "x" });
    assert.equal(calls, 1);
  });
});

test("removeTap returns true when the tap existed", () => {
  withFreshRegistry(() => {
    const fn = () => {};
    dispatcher.addTap(fn);
    assert.equal(dispatcher.removeTap(fn), true);
    assert.equal(dispatcher.removeTap(fn), false);
  });
});

test("addTap is idempotent on the same fn ref (Set semantics)", () => {
  withFreshRegistry(() => {
    const fn = () => {};
    dispatcher.addTap(fn);
    dispatcher.addTap(fn);
    assert.equal(dispatcher.tapCount(), 1);
  });
});

test("a throwing tap doesn't prevent other taps from running", () => {
  withFreshRegistry(() => {
    dispatcher.addTap(() => { throw new Error("bad tap"); });
    let other = 0;
    dispatcher.addTap(() => { other++; });
    assert.doesNotThrow(() => dispatcher.notifyTaps({ type: "x" }));
    assert.equal(other, 1);
  });
});

test("a tap can add or remove other taps during iteration without crashing", () => {
  withFreshRegistry(() => {
    const second = () => {};
    dispatcher.addTap(() => { dispatcher.addTap(second); });
    dispatcher.addTap(() => { dispatcher.removeTap(second); });
    assert.doesNotThrow(() => dispatcher.notifyTaps({ type: "x" }));
  });
});

test("notifyTaps with zero taps is a no-op (cheap fast-path)", () => {
  withFreshRegistry(() => {
    assert.doesNotThrow(() => dispatcher.notifyTaps({ type: "x" }));
  });
});

test("_resetForTests clears both registry and taps", () => {
  withFreshRegistry(() => {
    dispatcher.register("a", () => {});
    dispatcher.addTap(() => {});
    dispatcher._resetForTests();
    assert.equal(dispatcher.size(), 0);
    assert.equal(dispatcher.tapCount(), 0);
  });
});
