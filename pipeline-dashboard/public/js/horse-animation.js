// Slice AC (Phase 2.5) — Harness horse animation, extracted from app.js.
//
// The pixel-art horse SVG generator, its gallop frame loop, and the idle/
// running/reining state machine used to live inline in app.js (~215 lines).
// Nothing in here reads pipeline state — it's entirely UI-layer — so the
// module captures its own timers + current state and exposes a small
// public API used by app.js via a thin wrapper:
//
//   setState(state, statusText)  — switch between "idle" | "galloping" | "reining"
//   setStatusText(text)          — update the secondary status line only
//   reinThenResume(text, delayMs) — brief "reining" pose, then back to galloping
//   renderInitial()               — paint the idle frame once at DOM-ready
//
// DOM dependencies (must exist when setState() first runs):
//   #horse-rider      — the svg canvas the pixel art is written into
//   #harness-status   — optional secondary label updated by setState/
//                       setStatusText
//
// This module ships as UMD — browser loads it as window.HarnessHorseAnimation,
// but Node tests can require() it too (they get the functions back, though
// rendering is a no-op without a DOM).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessHorseAnimation = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const P = 3;
  function _px(x, y, c) {
    return `<rect x="${x * P}" y="${y * P}" width="${P}" height="${P}" fill="${c}"/>`;
  }

  // mode: "run1" | "run2" (gallop frames) | "rein" (front legs raised, body lifts)
  function _buildHorseSvg(mode) {
    const B = "#d4a574", H = "#e8c9a0", D = "#a07850";
    const R = "#58a6ff", K = "#3a3a3a";
    const isRein = mode === "rein";
    const G = isRein ? "#f85149" : "#3fb950";
    const W = 20 * P, Ht = 14 * P;

    // Rein offsets: front body lifts, rear stays planted
    const liftY = isRein ? -1 : 0;       // slight body lift
    const chestY = isRein ? -2 : 0;      // front body/head lift
    const viewMinY = isRein ? -2 * P : 0;
    const viewHeight = Ht + (isRein ? 2 * P : 0);

    let px = "";

    if (isRein) {
      // ── REARING POSE: rider leans back, reins taut, front legs raised ──
      // Render order: back→front so legs/reins visible on top.

      // Rear body (slightly lifted, planted on rear legs)
      [5, 6, 7, 8, 9].forEach((x) => [6, 7, 8].forEach((y) => { px += _px(x, y + liftY, B); }));
      [7, 8, 9].forEach((x) => { px += _px(x, 6 + liftY, H); });
      [6, 7, 8, 9].forEach((x) => { px += _px(x, 8 + liftY, D); });

      // Front body (chest raised high)
      [10, 11, 12, 13].forEach((x) => [6, 7, 8].forEach((y) => { px += _px(x, y + chestY, B); }));
      [10, 11].forEach((x) => { px += _px(x, 6 + chestY, H); });
      [10, 11, 12].forEach((x) => { px += _px(x, 8 + chestY, D); });

      // Neck (lifts with chest)
      [12, 13].forEach((x) => [4, 5].forEach((y) => { px += _px(x, y + chestY, B); }));

      // Head raised high
      px += _px(14, 1 + chestY, B); px += _px(15, 0 + chestY, B);
      [13, 14, 15].forEach((x) => [2, 3].forEach((y) => { px += _px(x, y + chestY, B); }));
      px += _px(15, 2 + chestY, K);  // eye
      px += _px(16, 3 + chestY, H);  // muzzle highlight

      // Tail (follows rear body)
      px += _px(4, 7 + liftY, D); px += _px(3, 8 + liftY, D);

      // Back legs planted on ground (no offset)
      px += _px(6, 9, D); px += _px(6, 10, D); px += _px(6, 11, K);
      px += _px(7, 9, D); px += _px(7, 10, D); px += _px(7, 11, K);

      // ── Front legs: bent at knee, hooves dangling forward (rendered ON TOP) ──
      px += _px(11, 7, D);   // thigh below belly
      px += _px(12, 8, D);   // knee
      px += _px(13, 9, K);   // hoof (forward & down)
      px += _px(12, 7, D);   // thigh
      px += _px(13, 7, D);   // knee bent forward
      px += _px(14, 8, D);   // shin
      px += _px(15, 9, K);   // hoof (extended forward)

      // ── Rider leaning BACK, arm extended forward ──
      px += _px(8, 0, R); px += _px(8, 1, R); px += _px(8, 2, R); px += _px(8, 3, R);
      px += _px(9, 2, R); px += _px(9, 3, R); px += _px(9, 4, R);
      px += _px(10, 4, R); px += _px(10, 5, R); px += _px(9, 5, R);
      px += _px(10, 3, R); px += _px(11, 3, R); px += _px(12, 3, R);

      // ── Long taut reins: rider hand (12,3) → horse mouth (16,1) ──
      px += _px(13, 2, G); px += _px(14, 2, G); px += _px(15, 1, G);
    } else {
      // ── RUNNING POSE ──
      [9, 10].forEach((x) => [1, 2].forEach((y) => { px += _px(x, y, R); }));
      [9, 10].forEach((x) => [3, 4, 5].forEach((y) => { px += _px(x, y, R); }));
      [11, 12, 13].forEach((x) => { px += _px(x, 5, G); });
      px += _px(15, 2, B); px += _px(16, 1, B);
      [14, 15, 16].forEach((x) => [3, 4].forEach((y) => { px += _px(x, y, B); }));
      px += _px(16, 3, K); px += _px(17, 4, H);
      [12, 13].forEach((x) => [4, 5].forEach((y) => { px += _px(x, y, B); }));
      [5, 6, 7, 8, 9, 10, 11, 12, 13].forEach((x) => [6, 7, 8].forEach((y) => { px += _px(x, y, B); }));
      [7, 8, 9, 10, 11].forEach((x) => { px += _px(x, 6, H); });
      [6, 7, 8, 9, 10, 11, 12].forEach((x) => { px += _px(x, 8, D); });
      px += _px(4, 5, D); px += _px(3, 4, D); px += _px(2, 3, D);
    }

    // Running gait legs (only for run1/run2 — rein mode handled above)
    if (mode === "run1") {
      px += _px(13, 9, D); px += _px(14, 10, D); px += _px(15, 11, K);
      px += _px(11, 9, D); px += _px(11, 10, D); px += _px(11, 11, K);
      px += _px(6, 9, D); px += _px(5, 10, D); px += _px(4, 11, K);
      px += _px(8, 9, D); px += _px(8, 10, D); px += _px(8, 11, K);
    } else if (mode === "run2") {
      px += _px(12, 9, D); px += _px(12, 10, D); px += _px(12, 11, K);
      px += _px(13, 9, D); px += _px(12, 10, D); px += _px(11, 11, K);
      px += _px(7, 9, D); px += _px(7, 10, D); px += _px(7, 11, K);
      px += _px(6, 9, D); px += _px(5, 10, D); px += _px(5, 11, K);
    }
    return `<svg viewBox="0 ${viewMinY} ${W} ${viewHeight}" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated">${px}</svg>`;
  }

  // Precompute the three static frames once. Re-running _buildHorseSvg()
  // on every gallop tick was pointless — the pixel art is deterministic.
  const FRAMES = [_buildHorseSvg("run1"), _buildHorseSvg("run2")];
  const SVG_STOP = _buildHorseSvg("rein");

  let _state = "idle";
  let _horseTimer = null;
  let _gallopInterval = null;
  let _gallopFrame = 0;

  function _getDoc() {
    return typeof document !== "undefined" ? document : null;
  }

  function _clearHorseTimer() {
    if (_horseTimer) { clearTimeout(_horseTimer); _horseTimer = null; }
  }

  function _stopGallop() {
    if (_gallopInterval) { clearInterval(_gallopInterval); _gallopInterval = null; }
  }

  function _startGallop() {
    _stopGallop();
    const doc = _getDoc();
    if (!doc) return;
    const rider = doc.getElementById("horse-rider");
    if (!rider) return;
    _gallopFrame = 0;
    rider.innerHTML = FRAMES[0];
    _gallopInterval = setInterval(() => {
      _gallopFrame = (_gallopFrame + 1) % 2;
      rider.innerHTML = FRAMES[_gallopFrame];
    }, 250);
  }

  function _renderHorseSvg(mode) {
    _stopGallop();
    const doc = _getDoc();
    if (!doc) return;
    const rider = doc.getElementById("horse-rider");
    if (!rider) return;
    if (mode === "galloping") {
      _startGallop();
    } else {
      rider.innerHTML = SVG_STOP;
    }
  }

  function setState(state, statusText) {
    _clearHorseTimer();
    if (state === _state && state !== "reining") return;
    _state = state;
    const doc = _getDoc();
    if (!doc) return;
    const rider = doc.getElementById("horse-rider");
    const status = doc.getElementById("harness-status");
    if (!rider) return;

    rider.classList.remove("galloping", "reining");

    if (state === "galloping") {
      _renderHorseSvg("galloping");
      rider.classList.add("galloping");
      if (status) { status.textContent = statusText || ""; status.className = "harness-status active"; }
    } else if (state === "reining") {
      _renderHorseSvg("reining");
      rider.classList.add("reining");
      if (status) { status.textContent = statusText || ""; status.className = "harness-status blocked"; }
    } else {
      _renderHorseSvg("idle");
      if (status) { status.textContent = ""; status.className = "harness-status"; }
    }
  }

  function reinThenResume(statusText, delayMs) {
    setState("reining", statusText);
    _horseTimer = setTimeout(() => {
      _horseTimer = null;
      if (_state === "reining") setState("galloping", "실행 중");
    }, delayMs);
  }

  function setStatusText(text) {
    const doc = _getDoc();
    if (!doc) return;
    const status = doc.getElementById("harness-status");
    if (status) status.textContent = text || "";
  }

  function renderInitial() {
    _renderHorseSvg("idle");
  }

  // Exposed for the tests & debugging; resets the internal state machine.
  function _resetForTests() {
    _clearHorseTimer();
    _stopGallop();
    _state = "idle";
    _gallopFrame = 0;
  }

  return {
    setState,
    setStatusText,
    reinThenResume,
    renderInitial,
    // Internals exposed for tests only — do NOT call from app.js.
    _buildHorseSvg,
    _frames: FRAMES,
    _stopSvg: SVG_STOP,
    _currentState: () => _state,
    _resetForTests,
  };
});
