// Slice UI-H2 (Phase D / Phase E1.5, 2026-04-30) — horse state machine.
//
// Pure function that maps run state into a (laneIdx, displayState)
// tuple the orchestrator-track panel renders. Splitting the state out
// from the DOM panel keeps the transition logic testable without a
// browser + makes future variations (public-sector reduced-motion,
// "policy gate timeline") additive rather than embedded.
//
// Inputs:
//
//   phase            — string from `snapshot.runs[selectedRunId].phase`
//                      Mapping per UI Plan §"가져올 요소":
//                        Plan      → laneIdx 0  (Claude)
//                        Critique  → laneIdx 1  (Codex)
//                        Revise    → laneIdx 2  (Claude)
//                        Re-check  → laneIdx 3  (Codex)
//                        Execute   → laneIdx 4  (Claude)
//                        Verify    → laneIdx 5  (Verifier)
//                        Done      → laneIdx 6  (System)
//                      Aliases (the orchestrator uses these in production):
//                        plan / planning           → 0
//                        critique / critic         → 1
//                        revise / revision         → 2
//                        recheck / re-critique     → 3
//                        execute / execution       → 4
//                        verify / verification     → 5
//                        finalize / done / sealed  → 6
//                      Unknown / null phase → laneIdx -1 ("waiting").
//
//   approvalPending  — boolean from `snapshot.pendingApprovals.length > 0`
//                      When true at lane 4 (Execute) the displayState
//                      becomes "rearing" — horse stops at the approval
//                      gate. (Per UI Plan: approval gate visualizes as
//                      horse rearing up.)
//
//   verifyResult     — "pass" | "fail" | null from
//                      `runDetails[selectedRunId].verifyStatus`. When
//                      "fail" at lane 5 (Verify) displayState becomes
//                      "rearing" — horse rears at verify gate. "pass"
//                      lets it advance.
//
//   reducedMotion    — boolean. When true displayState is always "idle"
//                      (no gallop animation; static lane indicator).
//
// Output shape:
//   {
//     laneIdx:      number  // -1..6 (-1 = waiting, no run selected)
//     laneName:     string  // operator-friendly Korean label
//     displayState: "running" | "rearing" | "idle" | "waiting"
//     gate:         string|null   // "approval" / "verify" / null
//   }
//
// The panel uses laneIdx + displayState to position the horse and pick
// the gallop / rear sprite frame. The gate field is what the rear-
// callout displays ("◈ HARNESS · APPROVAL").

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorHorseStateMachine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // The 7-lane pipeline. Order is canonical — UI consumers index into
  // this array.
  const LANES = Object.freeze([
    { id: "plan",     ko: "계획",     en: "Plan"     },
    { id: "critique", ko: "비평",     en: "Critique" },
    { id: "revise",   ko: "수정",     en: "Revise"   },
    { id: "recheck",  ko: "재검증",   en: "Re-check" },
    { id: "execute",  ko: "실행",     en: "Execute"  },
    { id: "verify",   ko: "검증",     en: "Verify"   },
    { id: "done",     ko: "완료",     en: "Done"     },
  ]);

  // Phase string aliases → laneIdx. Built once, frozen so a future
  // refactor that adds a new alias must touch this map (visible in
  // code review).
  const PHASE_TO_LANE = Object.freeze({
    // Lane 0 — Plan
    "plan": 0, "planning": 0,
    // Lane 1 — Critique
    "critique": 1, "critic": 1,
    // Lane 2 — Revise
    "revise": 2, "revision": 2,
    // Lane 3 — Re-check
    "recheck": 3, "re-check": 3, "re-critique": 3, "recritique": 3,
    // Lane 4 — Execute
    "execute": 4, "execution": 4,
    // Lane 5 — Verify
    "verify": 5, "verification": 5,
    // Lane 6 — Done
    "done": 6, "finalize": 6, "sealed": 6, "complete": 6,
  });

  // Display states — the panel uses these to pick sprite frames +
  // animation classes.
  const STATES = Object.freeze({
    WAITING: "waiting",
    RUNNING: "running",
    REARING: "rearing",
    IDLE:    "idle",
  });

  /**
   * @param {string|null|undefined} phase
   * @returns {number} laneIdx in [0..6], or -1 if unknown
   */
  function laneIdxForPhase(phase) {
    if (typeof phase !== "string" || phase.length === 0) return -1;
    const norm = phase.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PHASE_TO_LANE, norm)
      ? PHASE_TO_LANE[norm] : -1;
  }

  /**
   * Compute the horse's display state given the inputs.
   *
   * @param {object} input
   * @param {string} [input.phase]
   * @param {boolean} [input.approvalPending=false]
   * @param {"pass"|"fail"|null} [input.verifyResult=null]
   * @param {boolean} [input.reducedMotion=false]
   * @returns {{laneIdx, laneName, displayState, gate}}
   */
  function computeHorseState(input) {
    const i = input && typeof input === "object" ? input : {};
    const laneIdx = laneIdxForPhase(i.phase);
    const approvalPending = !!i.approvalPending;
    const verifyResult = i.verifyResult === "pass" || i.verifyResult === "fail"
      ? i.verifyResult : null;
    const reducedMotion = !!i.reducedMotion;

    // Unknown phase → waiting state.
    if (laneIdx === -1) {
      return Object.freeze({
        laneIdx: -1,
        laneName: "대기 중",
        displayState: STATES.WAITING,
        gate: null,
      });
    }

    const lane = LANES[laneIdx];
    let displayState = reducedMotion ? STATES.IDLE : STATES.RUNNING;
    let gate = null;

    // Approval gate: pending approval AT or BEFORE Execute lane causes
    // the horse to rear. The most common case is approval at Execute
    // (lane 4) for write-tool dispatches, but the gate-rearing
    // visualization is meaningful at any lane where dispatch could
    // happen — operator sees "horse paused, awaiting your decision."
    if (approvalPending) {
      // Don't rear in reduced motion; just stay idle with a gate flag
      // so the static UI still renders the pending-approval marker.
      displayState = reducedMotion ? STATES.IDLE : STATES.REARING;
      gate = "approval";
    }
    // Verify gate: a failed verify at lane 5 rears the horse.
    else if (laneIdx === 5 && verifyResult === "fail") {
      displayState = reducedMotion ? STATES.IDLE : STATES.REARING;
      gate = "verify";
    }
    // Done lane (6) — horse "stands" at finish, not running.
    else if (laneIdx === 6) {
      displayState = STATES.IDLE;
    }

    return Object.freeze({
      laneIdx,
      laneName: lane.ko,
      displayState,
      gate,
    });
  }

  return {
    LANES,
    STATES,
    PHASE_TO_LANE,
    laneIdxForPhase,
    computeHorseState,
  };
});
