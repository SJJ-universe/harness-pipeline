// Slice UI-H2 (Phase D / Phase E1.5, 2026-04-30) — Harness Track panel.
//
// Renders a 7-lane horizontal pipeline with a galloping horse marker
// at the active lane. Reads from the store:
//
//   selectedRunId        → which run's phase drives the lane
//   runs[id].phase       → current pipeline phase
//   pendingApprovals     → if non-empty, horse rears at approval gate
//   runDetails[id]       → verify result (fail → rear at verify gate)
//   accountStatus.deployment.publicSector → reduced-motion mode
//
// The state machine (../horse-state-machine.js) computes
// (laneIdx, displayState, gate). This panel only paints what the
// machine returns — no run-state inference here, no fake progress.
//
// Visual elements:
//   .ht-lanes     7 lane labels above the track
//   .ht-track     dashed lane separators + ground line
//   .ht-horse     positioned horse marker (CSS sprite or fallback glyph)
//   .ht-callout   "◈ HARNESS · {GATE}" appears when displayState=rearing
//   .ht-status    pill showing current stage at right edge
//
// Accessibility: role="region", aria-label="Harness pipeline track",
// aria-live="polite" so a screen-reader announces phase changes.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorHarnessTrack = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolveStateMachine() {
    try { return require("../horse-state-machine"); } catch (_) { /* browser path */ }
    if (typeof window !== "undefined" && window.HarnessHorseStateMachine) {
      return window.HarnessHorseStateMachine;
    }
    return null;
  }

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("harness-track.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("harness-track.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("harness-track.create: no document available");
    }
    const SM = _resolveStateMachine();
    if (!SM) {
      throw new Error("harness-track.create: HarnessHorseStateMachine unavailable");
    }

    let unsubscribe = null;
    let destroyed = false;

    /**
     * Pull the inputs computeHorseState needs out of a snapshot.
     * Defensive against missing slices (a fresh store has empty maps).
     */
    function _readInputs(snap) {
      const sel = snap && snap.selectedRunId;
      const run = sel && snap.runs && snap.runs[sel] ? snap.runs[sel] : null;
      const phase = run && typeof run.phase === "string" ? run.phase : null;

      const approvalPending = Array.isArray(snap && snap.pendingApprovals)
        && snap.pendingApprovals.length > 0;

      const detail = sel && snap.runDetails && snap.runDetails[sel]
        ? snap.runDetails[sel] : null;
      const verifyResult = detail && typeof detail.verifyStatus === "string"
        ? detail.verifyStatus : null;

      const reducedMotion = !!(
        snap && snap.accountStatus && snap.accountStatus.deployment
        && snap.accountStatus.deployment.publicSector === true
      );

      return { phase, approvalPending, verifyResult, reducedMotion };
    }

    function _renderLanes(machineState) {
      const lanesRoot = _doc.createElement("div");
      lanesRoot.className = "ht-lanes";

      for (let i = 0; i < SM.LANES.length; i += 1) {
        const lane = SM.LANES[i];
        const passed = machineState.laneIdx >= 0 && i < machineState.laneIdx;
        const current = i === machineState.laneIdx;

        const cell = _doc.createElement("div");
        cell.className = "ht-lane"
          + (current ? " is-current" : "")
          + (passed ? " is-passed" : "");
        cell.setAttribute("data-lane-idx", String(i));
        cell.setAttribute("data-lane-id", lane.id);

        const label = _doc.createElement("span");
        label.className = "ht-lane-label";
        label.textContent = lane.en.toUpperCase();
        cell.appendChild(label);

        // Approval/verify gate marker on lanes 4 + 5 (Execute, Verify)
        if (i === 4 || i === 5) {
          const gate = _doc.createElement("span");
          gate.className = "ht-lane-gate"
            + (current && machineState.gate ? " is-active" : "");
          gate.textContent = "◈";  // ◈
          cell.appendChild(gate);
        }

        lanesRoot.appendChild(cell);
      }

      return lanesRoot;
    }

    function _renderHorse(machineState) {
      const horse = _doc.createElement("div");
      horse.className = "ht-horse "
        + "ht-horse-state-" + machineState.displayState;
      horse.setAttribute("data-display-state", machineState.displayState);
      horse.setAttribute("data-lane-idx", String(machineState.laneIdx));

      // Position horse at center of current lane (percentage of inner
      // track). Waiting state (-1) parks it at left edge.
      const lanePctEach = 100 / SM.LANES.length;
      const lanePct = machineState.laneIdx >= 0
        ? (machineState.laneIdx + 0.5) * lanePctEach
        : 0;
      horse.style.left = `calc(${lanePct}%)`;

      // Visual content — sprite or fallback glyph. We use a glyph
      // here (no horse-frames.png dependency); CSS can override with
      // a background-image if the operator drops the sprite in.
      horse.textContent = machineState.displayState === "rearing"
        ? "⚞"   // ⚞ approximation; CSS can swap to sprite frame
        : "🐎";  // 🐎 horse emoji as legible fallback

      return horse;
    }

    function _renderCallout(machineState) {
      if (machineState.displayState !== "rearing" || !machineState.gate) {
        return null;
      }
      const callout = _doc.createElement("div");
      callout.className = "ht-callout";
      callout.setAttribute("role", "status");
      const label = machineState.gate === "approval" ? "APPROVAL"
        : machineState.gate === "verify" ? "VERIFY"
        : machineState.gate.toUpperCase();
      callout.textContent = `◈ HARNESS · ${label}`;
      // Position above horse at current lane.
      const lanePctEach = 100 / SM.LANES.length;
      const lanePct = (machineState.laneIdx + 0.5) * lanePctEach;
      callout.style.left = `calc(${lanePct}%)`;
      return callout;
    }

    function _renderStatusPill(machineState) {
      const pill = _doc.createElement("div");
      pill.className = "ht-status"
        + (machineState.displayState === "rearing" ? " is-rearing" : "");

      let text;
      if (machineState.displayState === "waiting") {
        text = "⏳ 관찰 중";   // ⏳ 관찰 중 (waiting)
      } else if (machineState.gate) {
        const lbl = machineState.gate === "approval" ? "APPROVAL"
          : machineState.gate === "verify" ? "VERIFY"
          : machineState.gate.toUpperCase();
        text = `● HARNESS · ${lbl}`;
      } else {
        text = `STAGE ${machineState.laneIdx + 1}/${SM.LANES.length} · ${machineState.laneName}`;
      }
      pill.textContent = text;
      return pill;
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const inputs = _readInputs(snap);
      const machineState = SM.computeHorseState(inputs);

      root.innerHTML = "";
      root.classList.add("harness-track-region");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Harness pipeline track");
      root.setAttribute("aria-live", "polite");
      root.setAttribute("data-lane-idx", String(machineState.laneIdx));
      root.setAttribute("data-display-state", machineState.displayState);
      if (machineState.gate) {
        root.setAttribute("data-gate", machineState.gate);
      } else {
        root.removeAttribute("data-gate");
      }

      // Lane labels row
      root.appendChild(_renderLanes(machineState));

      // Track + horse + callout
      const trackBox = _doc.createElement("div");
      trackBox.className = "ht-track";
      trackBox.appendChild(_renderHorse(machineState));
      const callout = _renderCallout(machineState);
      if (callout) trackBox.appendChild(callout);
      root.appendChild(trackBox);

      // Status pill (right-aligned)
      root.appendChild(_renderStatusPill(machineState));
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.removeAttribute("aria-live");
        root.removeAttribute("data-lane-idx");
        root.removeAttribute("data-display-state");
        root.removeAttribute("data-gate");
        root.classList.remove("harness-track-region");
      },
      _render: render,
    };
  }

  return { create };
});
