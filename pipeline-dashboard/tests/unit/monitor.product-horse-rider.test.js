// Slice UI-P3-e (Phase 2 Round 3, 2026-04-30) — horse rider sprite tests.
// Pins: sprite mount + state transitions, RAF loop frame advance,
// emoji fallback on Image() error, destroy cleanup.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const horseRider = require("../../public/js/monitor/panels/product-horse-rider");

// Reused DOM stub
function makeStubElement(tag) {
  const listeners = {};
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    attributes: {},
    parentNode: null,
    classList: {
      _classes: new Set(),
      add(...args) { for (const c of args) this._classes.add(c); return this; },
      remove(...args) { for (const c of args) this._classes.delete(c); return this; },
      contains(c) { return this._classes.has(c); },
      toString() { return Array.from(this._classes).join(" "); },
    },
    style: {},
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
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) { this.children.splice(idx, 1); c.parentNode = null; }
      return c;
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k]; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    _findOneByClass(cls) {
      for (const c of this.children) {
        if (c.classList && c.classList.contains(cls)) return c;
        if (typeof c._findOneByClass === "function") {
          const found = c._findOneByClass(cls);
          if (found) return found;
        }
      }
      return null;
    },
  };
  return el;
}
const makeStubDoc = () => ({ createElement: makeStubElement });
const makeRoot = () => makeStubElement("div");

// ── frozen vocabulary ────────────────────────────────────────────

test("UI-P3: horse-rider exports sprite constants matching reference + verified PNG", () => {
  // Reference image dimensions verified in UI-P3-a: 2016×96 = 12 × (168×96)
  assert.equal(horseRider.HORSE_FRAME_W, 168);
  assert.equal(horseRider.HORSE_FRAME_H, 96);
  assert.equal(horseRider.HORSE_FRAMES, 12);
  assert.equal(horseRider.REAR_FRAME, 7);  // reference horse.jsx line 30
  assert.equal(horseRider.GALLOP_FPS, 8.5);
  assert.equal(horseRider.SPRITE_SRC, "images/horse-frames.png");
  // VALID_STATES is the only state vocabulary — frozen.
  assert.deepEqual(horseRider.VALID_STATES.slice().sort(), ["gallop", "rear"]);
  assert.throws(() => { horseRider.VALID_STATES.push("trot"); });
});

test("UI-P3: _coerceState accepts gallop/rear, falls back to gallop", () => {
  assert.equal(horseRider._coerceState("gallop"), "gallop");
  assert.equal(horseRider._coerceState("rear"), "rear");
  assert.equal(horseRider._coerceState("trot"), "gallop");
  assert.equal(horseRider._coerceState(null), "gallop");
  assert.equal(horseRider._coerceState(undefined), "gallop");
});

// ── factory + DOM build ──────────────────────────────────────────

test("UI-P3: create throws on missing root + doc", () => {
  assert.throws(() => horseRider.create({}), /opts required.*|root must be an element/);
  assert.throws(
    () => horseRider.create({ root: makeRoot(), doc: {} }),
    /no document available/,
  );
});

test("UI-P3: create() mounts wrap with sprite + glint + fallback layers", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(),
    rafImpl: null,  // no RAF in tests
  });
  // Single child (the wrap)
  assert.equal(root.children.length, 1);
  const wrap = root.children[0];
  assert.ok(wrap.classList.contains("prod-horse"));
  assert.equal(wrap.getAttribute("data-state"), "gallop");
  // Sprite + glint + fallback layers
  assert.ok(wrap._findOneByClass("prod-horse-sprite"));
  assert.ok(wrap._findOneByClass("prod-horse-bridle-glint"));
  assert.ok(wrap._findOneByClass("prod-horse-fallback"));
  // Initial state = gallop, frame 0
  const s = handle._state();
  assert.equal(s.state, "gallop");
  assert.equal(s.frame, 0);
  assert.equal(s.spriteAvailable, true);
  handle.destroy();
});

test("UI-P3: create() honors size + accent props", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
    size: 100, accent: "#FF00FF",
  });
  const s = handle._state();
  assert.equal(s.size, 100);
  assert.equal(s.accent, "#FF00FF");
  // Wrap CSS reflects the size
  const wrap = root.children[0];
  // 96 → 100 scale = 100/96; width = 168 × scale
  const expectedW = (168 * (100 / 96)).toString();
  assert.ok(wrap.style.width.startsWith(expectedW.slice(0, 5)),
    "wrap width matches scale: " + wrap.style.width,
  );
  handle.destroy();
});

// ── state transitions ───────────────────────────────────────────

test("UI-P3: setState('rear') swaps to frame 7 + applies rotation transform", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
  });
  handle.setState("rear");
  const s = handle._state();
  assert.equal(s.state, "rear");
  assert.equal(s.frame, 7, "rear freezes on REAR_FRAME (index 7 = 8th frame)");
  // The wrap data-state attribute updated
  assert.equal(root.children[0].getAttribute("data-state"), "rear");
  // Sprite transform reflects rear pose
  const sprite = root.children[0]._findOneByClass("prod-horse-sprite");
  assert.match(sprite.style.transform, /rotate\(-18deg\).*translateY\(-4px\)/);
  // Glint becomes visible
  const glint = root.children[0]._findOneByClass("prod-horse-bridle-glint");
  assert.equal(glint.style.display, "block");
  handle.destroy();
});

test("UI-P3: setState('gallop') from rear restores frame 0 + clears transform + hides glint", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null, state: "rear",
  });
  // Initial rear → frame 7
  assert.equal(handle._state().frame, 7);
  handle.setState("gallop");
  const s = handle._state();
  assert.equal(s.state, "gallop");
  assert.equal(s.frame, 0, "gallop restart starts at frame 0");
  const sprite = root.children[0]._findOneByClass("prod-horse-sprite");
  assert.equal(sprite.style.transform, "none");
  const glint = root.children[0]._findOneByClass("prod-horse-bridle-glint");
  assert.equal(glint.style.display, "none");
  handle.destroy();
});

test("UI-P3: setState() is idempotent + coerces unknown values", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
  });
  // Same state — no-op (no error)
  handle.setState("gallop");
  assert.equal(handle._state().state, "gallop");
  // Unknown → coerced to gallop (already gallop, no-op)
  handle.setState("trot");
  assert.equal(handle._state().state, "gallop");
  handle.destroy();
});

// ── RAF loop ────────────────────────────────────────────────────

test("UI-P3: RAF tick advances frame based on injected clock + fps", () => {
  const root = makeRoot();
  let fakeNow = 0;
  let scheduled = null;
  const rafImpl = (cb) => { scheduled = cb; return 1; };
  const cafImpl = () => { scheduled = null; };
  const handle = horseRider.create({
    root, doc: makeStubDoc(),
    rafImpl, cafImpl,
    now: () => fakeNow,
  });
  // Initial: frame 0
  assert.equal(handle._state().frame, 0);
  // GALLOP_FPS = 8.5 → one frame every ~117.6ms.
  // After 200ms, frame should be floor(200/1000 * 8.5 % 12) = floor(1.7) = 1.
  fakeNow = 200;
  scheduled(); // simulate RAF tick
  assert.equal(handle._state().frame, 1);
  // After 1300ms, frame = floor(1300/1000 * 8.5 % 12) = floor(11.05) = 11.
  fakeNow = 1300;
  scheduled();
  assert.equal(handle._state().frame, 11);
  // After 1500ms, wraps: floor(1500/1000 * 8.5 % 12) = floor(12.75 % 12) = 0.
  fakeNow = 1500;
  scheduled();
  assert.equal(handle._state().frame, 0);
  handle.destroy();
});

test("UI-P3: setState('rear') stops RAF loop", () => {
  const root = makeRoot();
  let scheduled = null;
  let cancelCount = 0;
  const rafImpl = (cb) => { scheduled = cb; return 42; };
  const cafImpl = () => { cancelCount += 1; scheduled = null; };
  const handle = horseRider.create({
    root, doc: makeStubDoc(),
    rafImpl, cafImpl,
  });
  // RAF was scheduled on init
  assert.ok(scheduled, "RAF scheduled on init for gallop state");
  handle.setState("rear");
  assert.equal(cancelCount, 1, "RAF cancelled when transitioning to rear");
  handle.destroy();
});

// ── emoji fallback ──────────────────────────────────────────────

test("UI-P3: Image() onerror swaps to emoji fallback + hides sprite", () => {
  const root = makeRoot();
  // Stub Image that captures onerror to fire later
  let lastImg = null;
  function FakeImage() {
    lastImg = this;
    this.src = "";
    this.onerror = null;
  }
  horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
    imageImpl: FakeImage,
  });
  // src was set
  assert.equal(lastImg.src, "images/horse-frames.png");
  // Fire onerror → fallback engages
  lastImg.onerror();
  const wrap = root.children[0];
  const sprite = wrap._findOneByClass("prod-horse-sprite");
  const glint = wrap._findOneByClass("prod-horse-bridle-glint");
  const fallback = wrap._findOneByClass("prod-horse-fallback");
  assert.equal(sprite.style.display, "none");
  assert.equal(glint.style.display, "none");
  assert.equal(fallback.style.display, "flex");
});

test("UI-P3: emoji fallback contains 🐎 character", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
  });
  const fallback = root.children[0]._findOneByClass("prod-horse-fallback");
  assert.equal(fallback.textContent, "🐎");
  handle.destroy();
});

// ── _setFrame test hook ─────────────────────────────────────────

test("UI-P3: _setFrame manually advances + updates background-position", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
  });
  handle._setFrame(5);
  assert.equal(handle._state().frame, 5);
  const sprite = root.children[0]._findOneByClass("prod-horse-sprite");
  // Sprite background-position should reflect frame 5 offset
  // = 5 * 168 * (84/96) = 735
  assert.match(sprite.style.backgroundPosition, /^-735(\.\d+)?px 0px$/);
  handle.destroy();
});

test("UI-P3: _setFrame ignores out-of-range + non-number", () => {
  const root = makeRoot();
  const handle = horseRider.create({
    root, doc: makeStubDoc(), rafImpl: null,
  });
  handle._setFrame(-1);
  assert.equal(handle._state().frame, 0, "negative ignored");
  handle._setFrame(99);
  assert.equal(handle._state().frame, 0, "out-of-range ignored");
  handle._setFrame("nope");
  assert.equal(handle._state().frame, 0, "non-number ignored");
  handle.destroy();
});

// ── lifecycle ────────────────────────────────────────────────────

test("UI-P3: destroy unmounts wrap + cancels RAF + setState afterward is no-op", () => {
  const root = makeRoot();
  let cancelled = false;
  const rafImpl = () => 7;
  const cafImpl = () => { cancelled = true; };
  const handle = horseRider.create({
    root, doc: makeStubDoc(),
    rafImpl, cafImpl,
  });
  assert.equal(root.children.length, 1);
  handle.destroy();
  assert.equal(root.children.length, 0);
  assert.equal(cancelled, true, "RAF cancelled on destroy");
  // setState after destroy = silent no-op
  handle.setState("rear");
  assert.equal(handle._state().state, "gallop", "destroyed handle does not change state");
});
