// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — "지금 AI가 하는 일" card.
//
// Simple-mode card showing the current pipeline phase in plain
// Korean, with a pulsing dot for active runs. Reads
// snapshot.runs[selectedRunId] + horse-state-machine for the
// operator-friendly phase name.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorNowDoingCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolveSM() {
    try { return require("../horse-state-machine"); } catch (_) {}
    if (typeof window !== "undefined" && window.HarnessHorseStateMachine) {
      return window.HarnessHorseStateMachine;
    }
    return null;
  }

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("now-doing-card.create: root must be an element");
    }
    if (!store) throw new Error("now-doing-card.create: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("now-doing-card.create: no document available");
    const SM = _resolveSM();

    let unsubscribe = null;
    let destroyed = false;

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const sel = snap.selectedRunId;
      const run = sel && snap.runs ? snap.runs[sel] : null;
      const phase = run && run.phase ? run.phase : null;
      const status = run && run.status ? run.status : "idle";

      // Get human-readable phase via state machine if available.
      let laneName = "대기 중";
      let isActive = false;
      if (phase && SM) {
        const ms = SM.computeHorseState({ phase });
        laneName = ms.laneName;
        isActive = ms.displayState === "running" || ms.displayState === "rearing";
      } else if (phase) {
        laneName = phase;
      }

      root.innerHTML = "";
      root.classList.add("ndc-card");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "현재 작업");

      const title = _doc.createElement("h3");
      title.className = "ndc-title";
      title.textContent = "지금 AI가 하는 일";
      root.appendChild(title);

      const status_row = _doc.createElement("div");
      status_row.className = "ndc-status";
      if (isActive) {
        const dot = _doc.createElement("span");
        dot.className = "ndc-pulse-dot";
        status_row.appendChild(dot);
      }
      const lbl = _doc.createElement("span");
      lbl.className = "ndc-label";
      lbl.textContent = laneName;
      status_row.appendChild(lbl);
      root.appendChild(status_row);

      const meta = _doc.createElement("div");
      meta.className = "ndc-meta";
      meta.textContent = run
        ? (status === "completed" ? "완료됨"
          : status === "paused"   ? "일시정지"
          : status === "error"    ? "오류 발생"
          : status === "active"   ? "진행 중"
          : "대기 중")
        : "활성 실행 없음";
      root.appendChild(meta);
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") unsubscribe();
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("ndc-card");
      },
      _render: render,
    };
  }

  return { create };
});
