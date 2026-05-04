// Slice UI-P3-b (Phase 2 Round 3, 2026-04-30) — horse rider sprite.
//
// Vanilla JS port of dashboard/horse.jsx (12-frame CSS sprite from
// reference image). The sprite sheet at public/images/horse-frames.png
// is 2016×96 (12 frames × 168×96 each — verified in UI-P3-a).
//
// States:
//   gallop : RAF loop cycling frames 0..11 at ~8.5fps (1.4s loop)
//   rear   : freezes on frame 7 (front legs reaching forward) with
//            -18deg rotation + bridle glint overlay
//
// Production notes vs reference (horse.jsx):
//   - No React: factory + setState() + destroy() handle pattern
//   - rAF injection point for tests (default to globalThis.requestAnimationFrame)
//   - Image() preflight detects sprite-load failure → emoji 🐎 fallback
//     (operator never sees a broken-image icon if the asset is missing
//     or the CSP blocks img-src)
//   - bridle-glint animation lives in style.product.css (already
//     defined in UI-P1-c as @keyframes prod-bridle-glint)
//   - Accent color drives the glint radial gradient — defaults to
//     bronze; passing a different accent overrides per-instance
//
// What this module does NOT do:
//   - Drive the gallop/rear state from store events. The harness-track
//     panel owns that decision (UI-P5 wires phase_change → setState).
//   - Pan horizontally across lanes. The harness-track positions this
//     sprite via absolute left%; the sprite itself only animates
//     in-place.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductHorseRider = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const HORSE_FRAME_W = 168;
  const HORSE_FRAME_H = 96;
  const HORSE_FRAMES = 12;
  const REAR_FRAME = 7;          // frame index for rearing pose
  const GALLOP_FPS = 8.5;        // ~1.4s for 12 frames (gentler pace)
  const SPRITE_SRC = "images/horse-frames.png";

  const VALID_STATES = Object.freeze(["gallop", "rear"]);

  function _coerceState(s) {
    return VALID_STATES.indexOf(s) >= 0 ? s : "gallop";
  }

  /**
   * Mount a horse rider sprite into root.
   *
   * @param {object} opts
   * @param {HTMLElement} opts.root      mount point
   * @param {object} [opts.doc]          document override (tests)
   * @param {string} [opts.state="gallop"]   initial state
   * @param {string} [opts.accent="#C9A66B"] glint color when rearing
   * @param {number} [opts.size=84]      output height in px
   * @param {string} [opts.spriteSrc]    override PNG path (tests)
   * @param {function} [opts.rafImpl]    requestAnimationFrame override
   * @param {function} [opts.cafImpl]    cancelAnimationFrame override
   * @param {function} [opts.now]        clock injection (tests)
   * @param {object} [opts.imageImpl]    Image constructor override (tests)
   * @returns {{ setState, getState, destroy, _state }}
   */
  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductHorseRider.create: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("HarnessProductHorseRider.create: root must be an element");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("HarnessProductHorseRider.create: no document available");
    }
    const accent = opts.accent || "#C9A66B";
    const size = (typeof opts.size === "number" && opts.size > 0) ? opts.size : 84;
    const spriteSrc = opts.spriteSrc || SPRITE_SRC;
    const rafImpl = opts.rafImpl
      || (typeof requestAnimationFrame === "function" ? requestAnimationFrame : null);
    const cafImpl = opts.cafImpl
      || (typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : null);
    const now = opts.now || (typeof performance !== "undefined" ? () => performance.now() : () => Date.now());

    let state = _coerceState(opts.state);
    let frame = 0;
    let rafId = null;
    let destroyed = false;
    let spriteAvailable = true; // optimistic; preflight may flip to false

    // Compute scale
    const scale = size / HORSE_FRAME_H;
    const dispW = HORSE_FRAME_W * scale;
    const dispH = HORSE_FRAME_H * scale;

    const wrap = _doc.createElement("div");
    wrap.className = "prod-horse";
    wrap.setAttribute("data-state", state);
    wrap.style.position = "relative";
    wrap.style.width = dispW + "px";
    wrap.style.height = dispH + "px";
    wrap.style.display = "block";
    wrap.style.overflow = "hidden";

    // Sprite layer (background-position drives frame). Wrapped so we
    // can hide it cleanly when fallback engages.
    const sprite = _doc.createElement("div");
    sprite.className = "prod-horse-sprite";
    sprite.style.position = "absolute";
    sprite.style.inset = "0";
    sprite.style.backgroundImage = "url('" + spriteSrc + "')";
    sprite.style.backgroundRepeat = "no-repeat";
    sprite.style.backgroundSize = (HORSE_FRAME_W * HORSE_FRAMES * scale) + "px " + dispH + "px";
    sprite.style.backgroundPosition = "0px 0px";
    sprite.style.transformOrigin = "78% 92%";
    wrap.appendChild(sprite);

    // Bridle glint overlay (only paints in rear state; CSS handles the
    // animation via @keyframes prod-bridle-glint).
    const glint = _doc.createElement("div");
    glint.className = "prod-horse-bridle-glint";
    glint.setAttribute("aria-hidden", "true");
    glint.style.position = "absolute";
    glint.style.left = (dispW * 0.08) + "px";
    glint.style.top = (dispH * 0.15) + "px";
    glint.style.width = (dispW * 0.22) + "px";
    glint.style.height = (dispH * 0.25) + "px";
    glint.style.borderRadius = "50%";
    glint.style.pointerEvents = "none";
    glint.style.background =
      "radial-gradient(circle, " + accent + "55 0%, " + accent + "00 70%)";
    glint.style.display = "none"; // shown only on rear
    wrap.appendChild(glint);

    // Emoji fallback layer (hidden until sprite-load fails)
    const fallback = _doc.createElement("div");
    fallback.className = "prod-horse-fallback";
    fallback.setAttribute("aria-label", "horse");
    fallback.style.position = "absolute";
    fallback.style.inset = "0";
    fallback.style.display = "none";
    fallback.style.alignItems = "center";
    fallback.style.justifyContent = "center";
    fallback.style.fontSize = (size * 0.7) + "px";
    fallback.textContent = "🐎";
    wrap.appendChild(fallback);

    // Sprite load preflight. If Image() exists in this env, kick off a
    // load test — on error, swap to emoji fallback. In test envs that
    // lack Image() (Node test runner), keep the optimistic default and
    // let tests inject opts.imageImpl explicitly.
    function _preflight() {
      const ImageCtor = opts.imageImpl
        || (typeof Image !== "undefined" ? Image : null);
      if (!ImageCtor) return; // no Image — keep optimistic
      let img;
      try { img = new ImageCtor(); } catch (_) { return; }
      img.onerror = function () {
        spriteAvailable = false;
        try {
          sprite.style.display = "none";
          glint.style.display = "none";
          fallback.style.display = "flex";
        } catch (_) { /* defensive */ }
      };
      // Don't bother with onload — we're optimistic by default.
      try { img.src = spriteSrc; } catch (_) {}
    }
    _preflight();

    function _applyState() {
      wrap.setAttribute("data-state", state);
      const displayFrame = state === "gallop" ? frame : REAR_FRAME;
      sprite.style.backgroundPosition =
        "-" + (displayFrame * HORSE_FRAME_W * scale) + "px 0px";
      if (state === "rear") {
        sprite.style.transform = "rotate(-18deg) translateY(-4px)";
        sprite.style.transition =
          "transform .45s cubic-bezier(.34, 1.4, .55, 1)";
        if (spriteAvailable) glint.style.display = "block";
      } else {
        sprite.style.transform = "none";
        sprite.style.transition = "transform .2s";
        glint.style.display = "none";
      }
    }
    _applyState();

    // RAF loop — only runs while gallop. setState("rear") cancels.
    let t0 = now();
    function _tick() {
      if (destroyed) return;
      if (state !== "gallop") { rafId = null; return; }
      const dt = (now() - t0) / 1000;
      const next = Math.floor((dt * GALLOP_FPS) % HORSE_FRAMES);
      if (next !== frame) {
        frame = next;
        _applyState();
      }
      rafId = rafImpl ? rafImpl(_tick) : null;
    }

    function _startGallop() {
      if (rafId !== null) return;
      if (!rafImpl) return; // no RAF available (Node test) — frame stays 0
      t0 = now();
      rafId = rafImpl(_tick);
    }

    function _stopGallop() {
      if (rafId !== null && cafImpl) {
        try { cafImpl(rafId); } catch (_) {}
      }
      rafId = null;
    }

    if (state === "gallop") _startGallop();

    root.appendChild(wrap);

    function setState(next) {
      if (destroyed) return;
      const coerced = _coerceState(next);
      if (coerced === state) return;
      state = coerced;
      if (state === "gallop") {
        _startGallop();
      } else {
        _stopGallop();
      }
      _applyState();
    }

    function getState() { return state; }

    function destroy() {
      destroyed = true;
      _stopGallop();
      if (wrap.parentNode === root) {
        try { root.removeChild(wrap); } catch (_) {}
      }
    }

    function _state() {
      return {
        state,
        frame: state === "gallop" ? frame : REAR_FRAME,
        spriteAvailable,
        size,
        accent,
      };
    }

    // Test hook — manually advance frame without RAF. Useful for
    // assertion on background-position after a known time delta.
    function _setFrame(idx) {
      if (typeof idx !== "number" || idx < 0 || idx >= HORSE_FRAMES) return;
      frame = idx;
      _applyState();
    }

    return {
      setState,
      getState,
      destroy,
      _state,
      _setFrame,
    };
  }

  return {
    create,
    HORSE_FRAME_W,
    HORSE_FRAME_H,
    HORSE_FRAMES,
    REAR_FRAME,
    GALLOP_FPS,
    SPRITE_SRC,
    VALID_STATES,
    _coerceState,
  };
});
