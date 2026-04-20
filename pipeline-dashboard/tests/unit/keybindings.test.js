// Slice H (v5) — Keybindings dispatcher unit tests.
//
// Exercises the pure createDispatcher() — no document, no install path.

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDispatcher, SEQUENCE_TIMEOUT_MS } = require("../../public/js/keybindings");

function keyEvent(key, { target = null, shiftKey = false } = {}) {
  let prevented = false;
  return {
    key,
    shiftKey,
    target,
    preventDefault() { prevented = true; },
    get _prevented() { return prevented; },
  };
}

test("single-key binding fires on matching key and preventDefaults", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ "?": () => { fired++; } });
  const ev = keyEvent("?");
  assert.equal(d.handleKey(ev), true);
  assert.equal(fired, 1);
  assert.ok(ev._prevented);
});

test("pure modifier press is ignored (Shift / Control / Alt / Meta)", () => {
  const d = createDispatcher();
  d.register({ Shift: () => { throw new Error("should not fire"); } });
  assert.equal(d.handleKey(keyEvent("Shift")), false);
});

test("typing in an input field is ignored (forms keep working)", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ t: () => { fired++; } });
  const target = { tagName: "INPUT" };
  d.handleKey(keyEvent("t", { target }));
  assert.equal(fired, 0);
});

test("typing in a textarea is ignored", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ t: () => { fired++; } });
  d.handleKey(keyEvent("t", { target: { tagName: "TEXTAREA" } }));
  assert.equal(fired, 0);
});

test("contenteditable target is treated as a text field", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ t: () => { fired++; } });
  d.handleKey(keyEvent("t", { target: { tagName: "DIV", isContentEditable: true } }));
  assert.equal(fired, 0);
});

test("2-key sequence fires when the second key completes it", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ "g t": () => { fired++; } });
  // First key: 'g' — buffers, returns true (consumed), no fire yet
  assert.equal(d.handleKey(keyEvent("g")), true);
  assert.equal(fired, 0);
  assert.equal(d._getBuffer(), "g");
  // Second key: 't' — completes, fires, clears buffer
  assert.equal(d.handleKey(keyEvent("t")), true);
  assert.equal(fired, 1);
  assert.equal(d._getBuffer(), "");
});

test("unrelated single-key binding does NOT eat the first letter of a sequence", () => {
  const d = createDispatcher();
  let gtFired = 0;
  let qFired = 0;
  d.register({ "g t": () => { gtFired++; }, q: () => { qFired++; } });
  // q is a single-key binding and has no prefix relationship with 'g t'
  d.handleKey(keyEvent("q"));
  assert.equal(qFired, 1);
  assert.equal(d._getBuffer(), "");
  // Now test that 'g' still begins a sequence even after q ran
  d.handleKey(keyEvent("g"));
  d.handleKey(keyEvent("t"));
  assert.equal(gtFired, 1);
});

test("stale sequence times out after SEQUENCE_TIMEOUT_MS", () => {
  let fakeNow = 0;
  const d = createDispatcher({ now: () => fakeNow, timeoutMs: 1000 });
  let fired = 0;
  d.register({ "g t": () => { fired++; } });
  fakeNow = 1000;
  d.handleKey(keyEvent("g"));
  assert.equal(d._getBuffer(), "g");
  // Advance past the timeout
  fakeNow = 2500;
  d.handleKey(keyEvent("t"));
  // 't' alone has no binding → fired stays 0, buffer cleared
  assert.equal(fired, 0);
  assert.equal(d._getBuffer(), "");
});

test("unknown key after a buffered prefix clears buffer without firing", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ "g t": () => { fired++; } });
  d.handleKey(keyEvent("g"));
  d.handleKey(keyEvent("x"));
  assert.equal(fired, 0);
  assert.equal(d._getBuffer(), "");
});

test("register() can overwrite an existing binding", () => {
  const d = createDispatcher();
  let firstFired = 0, secondFired = 0;
  d.register({ a: () => { firstFired++; } });
  d.register({ a: () => { secondFired++; } });
  d.handleKey(keyEvent("a"));
  assert.equal(firstFired, 0);
  assert.equal(secondFired, 1);
});

test("unregister() removes a binding", () => {
  const d = createDispatcher();
  let fired = 0;
  d.register({ a: () => { fired++; } });
  d.unregister("a");
  assert.equal(d.handleKey(keyEvent("a")), false);
  assert.equal(fired, 0);
});

test("handleKey returns false when no binding matches and no prefix is active", () => {
  const d = createDispatcher();
  d.register({ "g t": () => {} });
  assert.equal(d.handleKey(keyEvent("x")), false);
});

test("Single-key priority: 'g' alone fires its own binding when registered", () => {
  const d = createDispatcher();
  let gFired = 0, gtFired = 0;
  d.register({ g: () => { gFired++; }, "g t": () => { gtFired++; } });
  // 'g t' sequence exists but so does 'g' single-key — when buffer is empty,
  // a sequence prefix still takes priority (we want sequences). This test
  // fixes the expected behavior: the single-key fires because the buffer is
  // empty and single-key match beats sequence-prefix detection.
  d.handleKey(keyEvent("g"));
  assert.equal(gFired, 1);
  assert.equal(gtFired, 0);
});

test("SEQUENCE_TIMEOUT_MS is the documented constant", () => {
  assert.equal(typeof SEQUENCE_TIMEOUT_MS, "number");
  assert.ok(SEQUENCE_TIMEOUT_MS > 0);
});
