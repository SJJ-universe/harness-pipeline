// Slice UI-P1-f / UI-P3-d (Phase 2 Round 3, 2026-04-30) — harness track.
//
// Renders the 92px harness-track band per the reference. UI-P1 shipped
// a static 7-stage display with a 🐎 emoji placeholder. UI-P3 swaps
// the placeholder for the real sprite player from product-horse-rider.js
// — now the horse galops in place at first paint.
//
// What this renders:
//   - 7 lane labels (PLAN ─ CRITIQUE◈ ─ REVISE ─ RE-CHECK◈ ─ EXECUTE ─ VERIFY◈ ─ DONE)
//   - Dashed lane separators
//   - Ground line + drop shadow
//   - Real horse rider sprite (12-frame gallop loop, ~8.5fps)
//   - Static status pill ("STAGE 1/7 · PLAN")
//
// What this stub does NOT do (yet):
//   - Animate the horse moving across lanes (UI-P5 wires phase change
//     → setState + horizontal pan)
//   - Real phase reading from store (UI-P5)
//   - Trigger callout for gates (UI-P5 — needs real gate events)
//   - Switch to rear state on gate fire (UI-P5)
//
// Mode behavior:
//   - simple/pro: same 7 lanes; mode doesn't affect track in reference

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductHarnessTrack = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Mock stages — UI-P5 replaces with store-derived phase list from
  // the active run's template. The reference uses these 7 names so
  // first paint matches the design exactly.
  const MOCK_STAGES = Object.freeze([
    { label: "PLAN",       gate: false },
    { label: "CRITIQUE",   gate: true },
    { label: "REVISE",     gate: false },
    { label: "RE-CHECK",   gate: true },
    { label: "EXECUTE",    gate: false },
    { label: "VERIFY",     gate: true },
    { label: "DONE",       gate: false },
  ]);

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductHarnessTrack.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductHarnessTrack.create: root + doc required");

    // Stub state — mock "currently at stage 0".
    const currentStage = 0;

    const track = _doc.createElement("div");
    track.className = "prod-track";

    // Lane labels
    const lanes = _doc.createElement("div");
    lanes.className = "prod-track-lanes";
    MOCK_STAGES.forEach(function (stage, i) {
      const label = _doc.createElement("div");
      label.className = "prod-track-lane-label";
      label.setAttribute("data-state", i < currentStage ? "passed"
                                  : i === currentStage ? "current" : "pending");
      label.textContent = stage.label;
      if (stage.gate) {
        const marker = _doc.createElement("span");
        marker.className = "prod-track-gate-marker";
        marker.textContent = "◈";
        label.appendChild(marker);
      }
      lanes.appendChild(label);
    });
    track.appendChild(lanes);

    // Dashed lane separators
    const separators = _doc.createElement("div");
    separators.className = "prod-track-separators";
    MOCK_STAGES.forEach(function () {
      const sep = _doc.createElement("div");
      sep.className = "prod-track-separator";
      separators.appendChild(sep);
    });
    track.appendChild(separators);

    // Ground line + shadow
    const ground = _doc.createElement("div");
    ground.className = "prod-track-ground";
    track.appendChild(ground);
    const groundShadow = _doc.createElement("div");
    groundShadow.className = "prod-track-ground-shadow";
    track.appendChild(groundShadow);

    // Horse rider — UI-P3 mounts the real sprite player. The wrap
    // owns the absolute positioning (left = lane center − sprite half-
    // width). The horse-rider module owns the sprite dimensions +
    // RAF loop. opts.horseRider override is for tests; production
    // resolves from window globals.
    const horseWrap = _doc.createElement("div");
    horseWrap.className = "prod-track-horse-wrap";
    // Sprite is 56px wide at default; offset by 28 (half) so center
    // sits over the lane midpoint. Uses calc() so window resize keeps
    // alignment without a JS reflow.
    horseWrap.style.left = "calc(24px + (100% - 48px) * "
      + ((currentStage + 0.5) / MOCK_STAGES.length) + " - 28px)";
    track.appendChild(horseWrap);

    let horseHandle = null;
    const horseRiderFactory = opts.horseRider
      || (typeof window !== "undefined"
          && window.HarnessProductHorseRider
          && window.HarnessProductHorseRider.create);
    if (typeof horseRiderFactory === "function") {
      try {
        horseHandle = horseRiderFactory({
          root: horseWrap,
          doc: _doc,
          state: "gallop",
          accent: "#C9A66B",
          size: 56,
        });
      } catch (err) {
        // Sprite mount failed — keep the emoji fallback inline so the
        // operator at least sees something at the lane center.
        horseWrap.style.fontSize = "44px";
        horseWrap.textContent = "🐎";
      }
    } else {
      // Module not loaded (older index.html or test env). Fall back to
      // emoji directly. This matches UI-P1 behavior for graceful
      // degradation.
      horseWrap.style.fontSize = "44px";
      horseWrap.textContent = "🐎";
    }

    // Status pill
    const pill = _doc.createElement("div");
    pill.className = "prod-track-status-pill";
    pill.textContent = "STAGE " + (currentStage + 1) + "/" + MOCK_STAGES.length
      + " · " + MOCK_STAGES[currentStage].label;
    track.appendChild(pill);

    root.appendChild(track);

    return {
      destroy: function () {
        // Stop the horse RAF loop FIRST, then unmount the track.
        // Reverse mount order so the sprite's removeChild call doesn't
        // race with the track being unmounted.
        if (horseHandle && typeof horseHandle.destroy === "function") {
          try { horseHandle.destroy(); } catch (_) {}
        }
        if (track.parentNode === root) {
          try { root.removeChild(track); } catch (_) {}
        }
      },
      setMode: function () { /* mode doesn't affect track in this stub */ },
      // UI-P3 test hook — exposes the horse rider handle so tests can
      // assert on sprite state transitions without reaching into the
      // DOM tree.
      _horse: function () { return horseHandle; },
      _state: function () {
        return {
          currentStage,
          stageCount: MOCK_STAGES.length,
        };
      },
    };
  }

  return {
    create,
    MOCK_STAGES,
  };
});
