// Slice UI-P1-f / UI-P2-b (Phase 2 Round 3, 2026-04-30) — pipeline rail.
//
// Renders the left-rail pipeline view per the reference. UI-P1 shipped
// the header (코드 리뷰 pill + 작업 시작 button) + empty state. UI-P2
// adds 3 skeleton nodes (done/active/pending) so the rail's visual
// shape matches the reference at first paint — no live run required.
//
// §S sign-off decision 3: production reads phases from the active
// run's template. UI-P2's skeleton renders ONLY when there is no
// active run (mock display); UI-P5 swaps to real-run rendering when
// store.runs has an entry.
//
// What this stub renders (UI-P2):
//   - Header: 코드 리뷰 pill + 작업 시작 button (CTA)
//   - Pro mode: + compact / 템플릿 secondary buttons
//   - Body: skeleton 3-node rail (done · active · pending) showing
//     the visual shape of a real pipeline run, plus an inline note
//     "(예시 — 실행을 시작하면 실제 단계로 교체됩니다)"
//   - Pro mode: + RUN METRICS block with placeholder values
//
// What this stub does NOT do:
//   - Render real PipelineNode cards from store.runs (UI-P5)
//   - 작업 시작 click → POST /api/pipeline/start (UI-P5)
//   - 템플릿 click → opens existing template-editor modal (UI-P5)
//   - Per-stage live progress + duration (UI-P5)

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductPipelineRail = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // UI-P2-b: skeleton node renderer. Mirrors PipelineNode in the
  // reference (pipeline.jsx). All visual rules live in style.product.css
  // — this builder only assigns the data-status attributes the CSS
  // selectors key off.
  function _renderSkeletonNode(doc, stage, mode) {
    const node = doc.createElement("div");
    node.className = "prod-pipeline-node";

    // Rail column (circle + connecting line)
    const rail = doc.createElement("div");
    rail.className = "prod-pipeline-node-rail";
    const circle = doc.createElement("div");
    circle.className = "prod-pipeline-node-circle";
    circle.setAttribute("data-status", stage.status);
    if (stage.status === "active") {
      const pulse = doc.createElement("span");
      pulse.className = "prod-pipeline-node-circle-pulse";
      circle.appendChild(pulse);
    } else if (stage.status === "done") {
      circle.textContent = "✓";
    } else {
      circle.textContent = "◇";
    }
    rail.appendChild(circle);
    if (!stage.isLast) {
      const line = doc.createElement("div");
      line.className = "prod-pipeline-node-line";
      line.setAttribute("data-status", stage.status);
      rail.appendChild(line);
    }
    node.appendChild(rail);

    // Card column
    const card = doc.createElement("div");
    card.className = "prod-pipeline-node-card";

    const head = doc.createElement("div");
    head.className = "prod-pipeline-node-head";
    const headLeft = doc.createElement("div");
    headLeft.className = "prod-pipeline-node-head-left";
    const num = doc.createElement("span");
    num.className = "prod-pipeline-node-num";
    num.textContent = "0" + (stage.index + 1);
    headLeft.appendChild(num);
    const title = doc.createElement("span");
    title.className = "prod-pipeline-node-title";
    title.textContent = stage.kor;
    headLeft.appendChild(title);
    if (mode === "pro") {
      const eng = doc.createElement("span");
      eng.className = "prod-pipeline-node-eng";
      eng.textContent = stage.eng;
      headLeft.appendChild(eng);
    }
    head.appendChild(headLeft);

    const badge = doc.createElement("span");
    badge.className = "prod-pipeline-node-badge";
    badge.setAttribute("data-status", stage.status);
    badge.textContent = stage.status === "active"
      ? "● ACTIVE"
      : stage.status.toUpperCase();
    head.appendChild(badge);
    card.appendChild(head);

    const meta = doc.createElement("div");
    meta.className = "prod-pipeline-node-meta";
    const actor = doc.createElement("span");
    actor.style.color = stage.status === "done" ? "var(--prod-green)"
                     : stage.status === "active" ? "var(--prod-bronze)"
                     : "var(--prod-text-dim-50)";
    actor.textContent = stage.actor;
    meta.appendChild(actor);
    meta.appendChild(doc.createTextNode(" · "));
    meta.appendChild(doc.createTextNode(
      stage.status === "active" ? "진행 중..."
      : stage.status === "done" ? "완료"
      : "대기",
    ));
    card.appendChild(meta);

    if (mode === "pro" || stage.status === "active") {
      const detail = doc.createElement("div");
      detail.className = "prod-pipeline-node-detail";
      detail.textContent = stage.detail;
      card.appendChild(detail);
    }

    if (stage.status === "active") {
      const progress = doc.createElement("div");
      progress.className = "prod-pipeline-node-progress";
      const fill = doc.createElement("div");
      fill.className = "prod-pipeline-node-progress-fill";
      progress.appendChild(fill);
      card.appendChild(progress);
    }

    node.appendChild(card);
    return node;
  }

  function _renderMetricsBlock(doc) {
    const block = doc.createElement("div");
    block.className = "prod-rail-metrics";
    const title = doc.createElement("div");
    title.className = "prod-rail-metrics-title";
    title.textContent = "RUN METRICS — 예시";
    block.appendChild(title);
    [
      ["총 경과", "—"],
      ["이터레이션", "— / —"],
      ["게이트 통과", "— / —"],
      ["예상 잔여", "—"],
    ].forEach(function (entry) {
      const row = doc.createElement("div");
      row.className = "prod-rail-metrics-row";
      const label = doc.createElement("span");
      label.className = "prod-rail-metrics-label";
      label.textContent = entry[0];
      const value = doc.createElement("span");
      value.className = "prod-rail-metrics-value";
      value.textContent = entry[1];
      row.appendChild(label);
      row.appendChild(value);
      block.appendChild(row);
    });
    return block;
  }

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

    // Body — UI-P2 skeleton: 3 nodes covering the 3 status colors
    // (done/active/pending) so the rail's visual layout matches the
    // reference. The note above the nodes makes the skeleton role
    // clear so an operator never confuses it with a live run.
    const body = _doc.createElement("div");
    body.className = "prod-rail-body";

    const note = _doc.createElement("div");
    note.className = "prod-rail-empty";
    note.style.padding = "0 0 12px";
    note.style.textAlign = "left";
    note.style.fontSize = "10px";
    note.style.letterSpacing = "0.06em";
    note.textContent = "예시 단계 — 실행을 시작하면 실제 파이프라인으로 교체됩니다";
    body.appendChild(note);

    // 3 skeleton nodes
    body.appendChild(_renderSkeletonNode(_doc, {
      index: 0, status: "done",
      kor: "계획 수립", eng: "Planning", actor: "Claude",
      detail: "예시 단계입니다.",
      isLast: false,
    }, mode));
    body.appendChild(_renderSkeletonNode(_doc, {
      index: 1, status: "active",
      kor: "재검증", eng: "Re-critique", actor: "Codex",
      detail: "게이트 통과 대기 중...",
      isLast: false,
    }, mode));
    body.appendChild(_renderSkeletonNode(_doc, {
      index: 2, status: "pending",
      kor: "실행", eng: "Execution", actor: "Claude",
      detail: "Bash · Edit · Write 툴 디스패치",
      isLast: true,
    }, mode));

    if (mode === "pro") {
      body.appendChild(_renderMetricsBlock(_doc));
    }

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
