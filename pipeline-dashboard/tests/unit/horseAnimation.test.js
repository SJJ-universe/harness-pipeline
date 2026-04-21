// Slice AC (Phase 2.5) — HarnessHorseAnimation structural tests.
//
// Node has no DOM, so we focus on what's safely testable here:
//   - the SVG generator produces a valid-looking `<svg>` string for each
//     pose (run1 / run2 / rein) and embeds the expected rider / horse
//     pixel rectangles;
//   - the state helpers don't throw when called without a DOM
//     (renderInitial / setState / setStatusText / reinThenResume all
//     no-op gracefully on Node);
//   - the public API surface is what app.js expects to call into.

const test = require("node:test");
const assert = require("node:assert/strict");
const horse = require("../../public/js/horse-animation");

test("module exposes the public API app.js depends on", () => {
  assert.equal(typeof horse.setState, "function");
  assert.equal(typeof horse.setStatusText, "function");
  assert.equal(typeof horse.reinThenResume, "function");
  assert.equal(typeof horse.renderInitial, "function");
});

test("_buildHorseSvg returns a well-formed SVG for each mode", () => {
  for (const mode of ["run1", "run2", "rein"]) {
    const svg = horse._buildHorseSvg(mode);
    assert.ok(
      svg.startsWith('<svg viewBox="') && svg.endsWith("</svg>"),
      `${mode} output must be wrapped in <svg>…</svg>`
    );
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    // Pixel art is made entirely of <rect> elements.
    const rectCount = (svg.match(/<rect\s/g) || []).length;
    assert.ok(rectCount > 30, `${mode}: expected >30 rects, got ${rectCount}`);
    // `image-rendering:pixelated` keeps the art crisp on HiDPI displays.
    assert.match(svg, /image-rendering:pixelated/);
  }
});

test("rein mode has a larger viewBox (chest/head lift)", () => {
  const rein = horse._buildHorseSvg("rein");
  const run = horse._buildHorseSvg("run1");
  // Pull the viewBox height (4th numeric in "0 minY W H").
  const reinH = Number(rein.match(/viewBox="\S+\s\S+\s\S+\s(\d+)/)[1]);
  const runH = Number(run.match(/viewBox="\S+\s\S+\s\S+\s(\d+)/)[1]);
  assert.ok(reinH > runH, `rein viewBox height (${reinH}) should exceed run (${runH})`);
});

test("precomputed frames (exposed for tests) cover run1/run2/stop", () => {
  assert.ok(Array.isArray(horse._frames), "_frames is an array");
  assert.equal(horse._frames.length, 2, "two gallop frames");
  assert.ok(typeof horse._stopSvg === "string" && horse._stopSvg.length > 0);
  // The two run frames differ — otherwise the gallop loop has no animation.
  assert.notEqual(horse._frames[0], horse._frames[1], "gallop frames must differ");
});

test("setState / reinThenResume / setStatusText are DOM-safe no-ops in Node", () => {
  // None of these should throw when document / DOM elements are absent.
  assert.doesNotThrow(() => horse.setState("idle"));
  assert.doesNotThrow(() => horse.setState("galloping", "running"));
  assert.doesNotThrow(() => horse.setState("reining", "blocked"));
  assert.doesNotThrow(() => horse.setStatusText("hi"));
  assert.doesNotThrow(() => horse.reinThenResume("pause", 1));
});

test("setState transitions are observable via _currentState()", () => {
  horse._resetForTests();
  assert.equal(horse._currentState(), "idle");
  horse.setState("galloping", "run");
  assert.equal(horse._currentState(), "galloping");
  horse.setState("reining", "stop");
  assert.equal(horse._currentState(), "reining");
  horse.setState("idle");
  assert.equal(horse._currentState(), "idle");
  horse._resetForTests();
});

test("setState is idempotent for non-reining states (no-op if already in state)", () => {
  horse._resetForTests();
  horse.setState("galloping", "a");
  const before = horse._currentState();
  horse.setState("galloping", "b"); // same state → should not toggle
  assert.equal(horse._currentState(), before);
  horse._resetForTests();
});
