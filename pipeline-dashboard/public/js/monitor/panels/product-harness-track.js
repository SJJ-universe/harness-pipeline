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
  if (typeof window !== "undefined") root.OrchestratorProductTrack = api;
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
      throw new Error("OrchestratorProductTrack.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("OrchestratorProductTrack.create: root + doc required");

    const store = opts.store || null;
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.OrchestratorProductShellData)
      || null;

    // Runtime guard against the page looking like a running demo when
    // there's no real run. allowMockData=true (test/visual-baseline
    // default) keeps the historic "first paint shows the reference
    // shape" behavior. The browser init script (product-shell-init.js)
    // passes false unless the operator explicitly opts in via ?demo=1.
    const allowMockData = opts.allowMockData !== false;

    function _resolveHasLiveRun() {
      if (!store || !selectors) return false;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return false; }
      try { return Boolean(selectors.selectActiveRunId(snap)); }
      catch (_) { return false; }
    }

    // UI-P5-d: derive current stage from store (selected run's
    // phaseIdx). Fall back to 0 (mock) when no live run.
    function _resolveCurrentStage() {
      if (!store || !selectors) return 0;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return 0; }
      const runId = selectors.selectActiveRunId(snap);
      if (!runId) return 0;
      // Look up phase index from the active run
      const run = (snap.runs && typeof snap.runs.get === "function")
        ? snap.runs.get(runId)
        : (snap.runs ? snap.runs[runId] : null);
      if (run && typeof run.phaseIdx === "number"
          && run.phaseIdx >= 0 && run.phaseIdx < MOCK_STAGES.length) {
        return run.phaseIdx;
      }
      return 0;
    }
    let currentStage = _resolveCurrentStage();
    let hasLiveRun = _resolveHasLiveRun();
    // showActivity drives the "running pipeline" affordance — the
    // current-stage highlight, galloping horse sprite, and stage pill
    // text. Off when allowMockData=false AND no live run, so the
    // operator sees an inert "ready to start" state instead of a fake
    // pipeline animation.
    let showActivity = allowMockData || hasLiveRun;

    const track = _doc.createElement("div");
    track.className = "prod-track";
    track.setAttribute("data-region", "harness-track");
    track.setAttribute("role", "region");
    track.setAttribute("aria-label", "Harness Track — 파이프라인 단계 진행 표시");

    // Lane labels
    const lanes = _doc.createElement("div");
    lanes.className = "prod-track-lanes";
    lanes.setAttribute("data-track-slot", "lanes");
    function _laneStateFor(idx) {
      if (!showActivity) return "pending";
      if (idx < currentStage) return "passed";
      if (idx === currentStage) return "current";
      return "pending";
    }
    MOCK_STAGES.forEach(function (stage, i) {
      const label = _doc.createElement("div");
      label.className = "prod-track-lane-label";
      label.setAttribute("data-lane-index", String(i));
      label.setAttribute("data-lane-id", stage.label.toLowerCase().replace(/\s+/g, "-"));
      label.setAttribute("data-state", _laneStateFor(i));
      if (stage.gate) label.setAttribute("data-gate", "true");
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
    horseWrap.setAttribute("data-track-slot", "horse");
    // Sprite is 56px wide at default; offset by 28 (half) so center
    // sits over the lane midpoint. Uses calc() so window resize keeps
    // alignment without a JS reflow.
    horseWrap.style.left = "calc(24px + (100% - 48px) * "
      + ((currentStage + 0.5) / MOCK_STAGES.length) + " - 28px)";
    track.appendChild(horseWrap);

    let horseHandle = null;
    let horseMounted = false;
    function _mountHorseSprite() {
      if (horseMounted) return;
      const horseRiderFactory = opts.horseRider
        || (typeof window !== "undefined"
            && window.OrchestratorProductHorseRider
            && window.OrchestratorProductHorseRider.create);
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
      horseMounted = true;
    }
    function _unmountHorseSprite() {
      if (!horseMounted) return;
      if (horseHandle) {
        try { horseHandle.destroy(); } catch (_) {}
        horseHandle = null;
      }
      while (horseWrap.firstChild) {
        try { horseWrap.removeChild(horseWrap.firstChild); }
        catch (_) { break; }
      }
      // Clear emoji fallback + custom font sizing
      horseWrap.textContent = "";
      if (horseWrap.style) horseWrap.style.fontSize = "";
      horseMounted = false;
    }
    if (showActivity) _mountHorseSprite();

    // Status pill — "STAGE n/7 · LABEL" while activity is showing,
    // operator-friendly idle copy otherwise.
    const STATUS_PILL_IDLE = "대기 중 — 실행을 시작하면 단계가 진행됩니다";
    function _statusPillText() {
      if (!showActivity) return STATUS_PILL_IDLE;
      return "STAGE " + (currentStage + 1) + "/" + MOCK_STAGES.length
        + " · " + MOCK_STAGES[currentStage].label;
    }
    const pill = _doc.createElement("div");
    pill.className = "prod-track-status-pill";
    pill.setAttribute("data-track-slot", "status-pill");
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.setAttribute("data-activity", showActivity ? "active" : "idle");
    pill.textContent = _statusPillText();
    track.appendChild(pill);

    // UI-P5-d: in-place update on store change. Re-position the horse,
    // re-color lane labels, re-text the status pill — no DOM teardown
    // (sprite RAF loop keeps running). Cheap because the track has
    // ≤7 lane labels + 1 horse + 1 pill. Also handles the
    // activity-state transition (idle → active when a real run starts
    // in non-demo mode): mount the horse sprite, swap the pill text.
    function _updateTrack() {
      const nextStage = _resolveCurrentStage();
      const nextHasLive = _resolveHasLiveRun();
      const nextShowActivity = allowMockData || nextHasLive;
      const activityChanged = nextShowActivity !== showActivity;
      const stageChanged = nextStage !== currentStage;
      if (!activityChanged && !stageChanged) return;
      currentStage = nextStage;
      hasLiveRun = nextHasLive;
      showActivity = nextShowActivity;
      // Update lane labels
      for (let i = 0; i < lanes.children.length; i++) {
        const label = lanes.children[i];
        if (!label || !label.setAttribute) continue;
        label.setAttribute("data-state", _laneStateFor(i));
      }
      // Mount or unmount the sprite when the activity state flips.
      if (activityChanged) {
        if (showActivity) _mountHorseSprite();
        else _unmountHorseSprite();
      }
      // Re-position horse only when active (otherwise the wrap is
      // empty + position is irrelevant).
      if (showActivity) {
        horseWrap.style.left = "calc(24px + (100% - 48px) * "
          + ((currentStage + 0.5) / MOCK_STAGES.length) + " - 28px)";
      }
      // Re-text status pill + sync activity flag for assistive tech.
      pill.setAttribute("data-activity", showActivity ? "active" : "idle");
      pill.textContent = _statusPillText();
    }

    let unsubscribe = null;
    if (store && typeof store.subscribe === "function") {
      try { unsubscribe = store.subscribe(_updateTrack); }
      catch (_) { /* defensive */ }
    }

    root.appendChild(track);

    return {
      destroy: function () {
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        // Stop the horse RAF loop FIRST, then unmount the track.
        // Reverse mount order so the sprite's removeChild call doesn't
        // race with the track being unmounted.
        _unmountHorseSprite();
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
          hasLiveRun,
          showActivity,
          allowMockData,
          horseMounted,
        };
      },
    };
  }

  return {
    create,
    MOCK_STAGES,
  };
});
