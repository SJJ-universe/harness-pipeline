// Slice UI-P1-f (Phase 2 Round 3, 2026-04-30) — harness track stub.
//
// Renders the 92px harness-track band per the reference. UI-P1 ships
// a static 7-stage display with a CSS-positioned horse placeholder
// (no sprite yet — UI-P3 ports horse-frames.png + RAF loop).
// Real phase data wiring lands in UI-P5.
//
// What this stub renders:
//   - 7 lane labels (PLAN ─ CRITIQUE◈ ─ REVISE ─ RE-CRITIQUE◈ ─ EXECUTE ─ VERIFY◈ ─ DONE)
//   - Dashed lane separators
//   - Ground line + drop shadow
//   - Static horse placeholder (🐎 emoji at center) — sprite in UI-P3
//   - Static status pill ("STAGE 1/7 · PLAN")
//
// What this stub does NOT do:
//   - Animation (UI-P3 wires sprite + RAF + state machine)
//   - Real phase reading from store (UI-P5)
//   - Trigger callout for gates (UI-P5 — needs real gate events)
//
// Mode behavior:
//   - simple: same 7 lanes, smaller horse
//   - pro: same 7 lanes (mode toggle doesn't affect track in reference)

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

    // Horse placeholder — UI-P3 replaces with sprite player. For now
    // a 🐎 emoji at the position of the current stage.
    const horseWrap = _doc.createElement("div");
    horseWrap.className = "prod-track-horse-wrap";
    horseWrap.style.left = "calc(24px + (100% - 48px) * " + ((currentStage + 0.5) / MOCK_STAGES.length) + " - 28px)";
    horseWrap.style.fontSize = "44px";
    horseWrap.textContent = "🐎";
    track.appendChild(horseWrap);

    // Status pill
    const pill = _doc.createElement("div");
    pill.className = "prod-track-status-pill";
    pill.textContent = "STAGE " + (currentStage + 1) + "/" + MOCK_STAGES.length
      + " · " + MOCK_STAGES[currentStage].label;
    track.appendChild(pill);

    root.appendChild(track);

    return {
      destroy: function () {
        if (track.parentNode === root) {
          try { root.removeChild(track); } catch (_) {}
        }
      },
      setMode: function () { /* mode doesn't affect track in this stub */ },
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
