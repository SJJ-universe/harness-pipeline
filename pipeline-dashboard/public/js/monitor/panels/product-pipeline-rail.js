// Slice UI-P1-f (Phase 2 Round 3, 2026-04-30) — pipeline rail stub.
//
// Renders the left-rail pipeline view per the reference. UI-P1 ships
// the header (코드 리뷰 pill + 작업 시작 button) + an empty state
// since the rail has no real run data yet.
//
// What this stub renders:
//   - Header: 코드 리뷰 pill + 작업 시작 button (CTA)
//   - Pro mode: + compact / 템플릿 secondary buttons
//   - Body: empty state ("아직 실행 중인 작업이 없습니다") — per
//     §S sign-off decision 3 (no mock 7 stages)
//
// What this stub does NOT do:
//   - Render real PipelineNode cards (UI-P5 wires from store.runs)
//   - 작업 시작 click → POST /api/pipeline/start (UI-P5)
//   - 템플릿 click → opens existing template-editor modal (UI-P5)
//   - PipelineMetricsBlock (pro only, requires real run summary; UI-P5)

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductPipelineRail = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductPipelineRail.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductPipelineRail.create: root + doc required");

    let mode = opts.mode || "simple";

    const rail = _doc.createElement("div");
    rail.className = "prod-rail";

    const header = _doc.createElement("div");
    header.className = "prod-rail-header";

    const templatePill = _doc.createElement("span");
    templatePill.className = "prod-rail-template-pill";
    templatePill.textContent = "코드 리뷰";
    header.appendChild(templatePill);

    const startBtn = _doc.createElement("button");
    startBtn.type = "button";
    startBtn.className = "prod-rail-start-btn";
    startBtn.setAttribute("data-action", "pipeline-start");
    startBtn.textContent = "▶ 작업 시작";
    header.appendChild(startBtn);

    const headerSpacer = _doc.createElement("div");
    headerSpacer.style.flex = "1";
    header.appendChild(headerSpacer);

    // Pro-only secondary buttons
    const proButtons = _doc.createElement("span");
    proButtons.className = "prod-rail-pro-buttons";
    ["compact", "템플릿"].forEach(function (label) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-rail-secondary-btn";
      btn.textContent = label;
      proButtons.appendChild(btn);
    });
    header.appendChild(proButtons);

    rail.appendChild(header);

    function _refreshProButtons() {
      proButtons.style.display = (mode === "pro") ? "" : "none";
    }
    _refreshProButtons();

    // Body — empty state per §S sign-off decision 3
    const body = _doc.createElement("div");
    body.className = "prod-rail-body";
    const empty = _doc.createElement("div");
    empty.className = "prod-rail-empty";
    empty.textContent = "아직 실행 중인 작업이 없습니다.";
    body.appendChild(empty);
    rail.appendChild(body);

    root.appendChild(rail);

    return {
      destroy: function () {
        if (rail.parentNode === root) {
          try { root.removeChild(rail); } catch (_) {}
        }
      },
      setMode: function (next) {
        if (next === "simple" || next === "pro") {
          mode = next;
          _refreshProButtons();
        }
      },
      _state: function () { return { mode }; },
    };
  }

  return { create };
});
