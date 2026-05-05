// Slice UI-P1-f / UI-P2-b / UI-P4-a / UI-P5-b (Phase 2 Round 3, 2026-04-30) — pipeline rail.
//
// UI-P5-b swap: when store has real run phase data, the rail renders
// those instead of MOCK_STAGES. Subscribe to store on mount; rebuild
// body when snapshot changes. Demo note auto-toggles between
// "예시 단계" (no live run) and "활성 run: <runId>" (live).
//
// Renders the left-rail pipeline view per the reference. UI-P1 shipped
// the header + empty state, UI-P2 added 3 skeleton nodes, UI-P4
// promotes those skeletons into a full 7-stage demo-grade mock that
// matches the reference's PIPELINE_STAGES exactly. Every renderable
// slot is now annotated with data-* attributes so UI-P5 can update
// in place without rebuilding the DOM.
//
// §S sign-off decision 3: production reads phases from the active
// run's template. UI-P4's MOCK_STAGES renders ONLY when there is no
// active run; UI-P5 swaps `_renderPhaseList(phases)` to take real
// run data when the store has an entry. The slot-attribute contract
// stays identical between mock + real.
//
// Slot attributes (UI-P5 wiring contract):
//   data-region="pipeline-rail"            — panel root
//   data-rail-slot="header"                — top button row
//     data-action="pipeline-start" / "compact" / "template"
//   data-rail-slot="phase-list"            — body container
//     data-phase-id, data-phase-index, data-phase-status — per node
//     data-phase-slot="title" / "actor" / "detail" / "badge" / "progress"
//   data-rail-slot="metrics" (pro only)
//     data-metric="elapsed" / "iteration" / "gates-passed" / "eta"

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductPipelineRail = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // UI-P4: 7-stage demo mock matching the reference's PIPELINE_STAGES.
  // Status mix shows all 3 visual states (done/active/pending) so the
  // operator sees the full color palette during demos.
  const MOCK_STAGES = Object.freeze([
    { id: "plan",     index: 0, status: "done",    actor: "Claude",   icon: "◇", kor: "계획 수립",   eng: "Planning",        dur: "12.4s", detail: "작업 분해 · 리스크 식별 · 단계별 액션 정의" },
    { id: "critique", index: 1, status: "done",    actor: "Codex",    icon: "◈", kor: "플랜 비평",   eng: "Critique",        dur: "8.1s",  detail: "논리 결함 / 보안 / 효율성 검토. critical 0, high 1" },
    { id: "revise",   index: 2, status: "done",    actor: "Claude",   icon: "◇", kor: "계획 수정",   eng: "Revision",        dur: "6.2s",  detail: "high 이슈 1건 반영. 재비평 트리거됨." },
    { id: "recheck",  index: 3, status: "active",  actor: "Codex",    icon: "◈", kor: "재검증",      eng: "Re-critique",     dur: "—",     detail: "게이트 통과 대기 중..." },
    { id: "execute",  index: 4, status: "pending", actor: "Claude",   icon: "◇", kor: "실행",        eng: "Execution",       dur: "—",     detail: "Bash · Edit · Write 툴 디스패치" },
    { id: "verify",   index: 5, status: "pending", actor: "Verifier", icon: "◉", kor: "검증",        eng: "Verification",    dur: "—",     detail: "결과물 검수 + 회귀 테스트" },
    { id: "finalize", index: 6, status: "pending", actor: "System",   icon: "◆", kor: "최종 산출물", eng: "Finalize",        dur: "—",     detail: "아티팩트 봉인 · 감사 로그 동결" },
  ]);

  // UI-P4: realistic RUN METRICS demo values (pro mode footer).
  const MOCK_METRICS = Object.freeze([
    { id: "elapsed",       label: "총 경과",     value: "00:01:42" },
    { id: "iteration",     label: "이터레이션", value: "2 / 3" },
    { id: "gates-passed",  label: "게이트 통과", value: "4 / 7" },
    { id: "eta",           label: "예상 잔여",  value: "~ 38s" },
  ]);

  function _renderSkeletonNode(doc, stage, mode, isLast) {
    const node = doc.createElement("div");
    node.className = "prod-pipeline-node";
    // Slot attributes for UI-P5 wiring + visual regression checks
    node.setAttribute("data-phase-id", stage.id);
    node.setAttribute("data-phase-index", String(stage.index));
    node.setAttribute("data-phase-status", stage.status);

    // Rail column (circle + connecting line)
    const rail = doc.createElement("div");
    rail.className = "prod-pipeline-node-rail";
    const circle = doc.createElement("div");
    circle.className = "prod-pipeline-node-circle";
    circle.setAttribute("data-status", stage.status);
    circle.setAttribute("data-phase-slot", "circle");
    if (stage.status === "active") {
      const pulse = doc.createElement("span");
      pulse.className = "prod-pipeline-node-circle-pulse";
      circle.appendChild(pulse);
    } else if (stage.status === "done") {
      circle.textContent = "✓";
    } else {
      circle.textContent = stage.icon;
    }
    rail.appendChild(circle);
    if (!isLast) {
      const line = doc.createElement("div");
      line.className = "prod-pipeline-node-line";
      line.setAttribute("data-status", stage.status);
      rail.appendChild(line);
    }
    node.appendChild(rail);

    // Card column
    const card = doc.createElement("div");
    card.className = "prod-pipeline-node-card";
    card.setAttribute("data-phase-slot", "card");

    const head = doc.createElement("div");
    head.className = "prod-pipeline-node-head";
    const headLeft = doc.createElement("div");
    headLeft.className = "prod-pipeline-node-head-left";
    const num = doc.createElement("span");
    num.className = "prod-pipeline-node-num";
    num.setAttribute("data-phase-slot", "num");
    num.textContent = "0" + (stage.index + 1);
    headLeft.appendChild(num);
    const title = doc.createElement("span");
    title.className = "prod-pipeline-node-title";
    title.setAttribute("data-phase-slot", "title");
    title.textContent = stage.kor;
    headLeft.appendChild(title);
    if (mode === "pro") {
      const eng = doc.createElement("span");
      eng.className = "prod-pipeline-node-eng";
      eng.setAttribute("data-phase-slot", "eng");
      eng.textContent = stage.eng;
      headLeft.appendChild(eng);
    }
    head.appendChild(headLeft);

    const badge = doc.createElement("span");
    badge.className = "prod-pipeline-node-badge";
    badge.setAttribute("data-status", stage.status);
    badge.setAttribute("data-phase-slot", "badge");
    badge.textContent = stage.status === "active"
      ? "● ACTIVE"
      : stage.status.toUpperCase();
    head.appendChild(badge);
    card.appendChild(head);

    const meta = doc.createElement("div");
    meta.className = "prod-pipeline-node-meta";
    meta.setAttribute("data-phase-slot", "meta");
    const actor = doc.createElement("span");
    actor.setAttribute("data-phase-slot", "actor");
    actor.style.color = stage.status === "done" ? "var(--prod-green)"
                     : stage.status === "active" ? "var(--prod-bronze)"
                     : "var(--prod-text-dim-50)";
    actor.textContent = stage.actor;
    meta.appendChild(actor);
    meta.appendChild(doc.createTextNode(" · "));
    const status = doc.createElement("span");
    status.setAttribute("data-phase-slot", "status-text");
    status.textContent = stage.status === "active" ? "진행 중..."
      : stage.status === "done" ? ("완료 " + stage.dur)
      : "대기";
    meta.appendChild(status);
    card.appendChild(meta);

    if (mode === "pro" || stage.status === "active") {
      const detail = doc.createElement("div");
      detail.className = "prod-pipeline-node-detail";
      detail.setAttribute("data-phase-slot", "detail");
      detail.textContent = stage.detail;
      card.appendChild(detail);
    }

    if (stage.status === "active") {
      const progress = doc.createElement("div");
      progress.className = "prod-pipeline-node-progress";
      progress.setAttribute("data-phase-slot", "progress");
      const fill = doc.createElement("div");
      fill.className = "prod-pipeline-node-progress-fill";
      progress.appendChild(fill);
      card.appendChild(progress);
    }

    node.appendChild(card);
    return node;
  }

  function _renderMetricsBlock(doc, realMetrics) {
    const block = doc.createElement("div");
    block.className = "prod-rail-metrics";
    block.setAttribute("data-rail-slot", "metrics");
    const title = doc.createElement("div");
    title.className = "prod-rail-metrics-title";
    title.setAttribute("data-metric-slot", "title");
    // UI-P5-b: live metrics flag in title so demo vs live is visible
    title.textContent = realMetrics
      ? "RUN METRICS"
      : "RUN METRICS — 예시";
    block.appendChild(title);
    const rows = realMetrics || MOCK_METRICS;
    rows.forEach(function (entry) {
      const row = doc.createElement("div");
      row.className = "prod-rail-metrics-row";
      row.setAttribute("data-metric", entry.id);
      const label = doc.createElement("span");
      label.className = "prod-rail-metrics-label";
      label.textContent = entry.label;
      const value = doc.createElement("span");
      value.className = "prod-rail-metrics-value";
      value.setAttribute("data-metric-slot", "value");
      value.textContent = entry.value;
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
    const allowMockData = opts.allowMockData !== false;
    const store = opts.store || null;
    // UI-P5-b: selectors module resolves real run data → phases array
    // or null. Test injection via opts.dataSelectors; production reads
    // from window.HarnessProductShellData.
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.HarnessProductShellData)
      || null;

    const rail = _doc.createElement("div");
    rail.className = "prod-rail";
    rail.setAttribute("data-region", "pipeline-rail");
    rail.setAttribute("role", "region");
    rail.setAttribute("aria-label", "파이프라인 단계");

    // ── Header ──────────────────────────────────────
    const header = _doc.createElement("div");
    header.className = "prod-rail-header";
    header.setAttribute("data-rail-slot", "header");

    const templatePill = _doc.createElement("span");
    templatePill.className = "prod-rail-template-pill";
    templatePill.setAttribute("data-rail-slot", "template-name");
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

    const proButtons = _doc.createElement("span");
    proButtons.className = "prod-rail-pro-buttons";
    [
      { action: "pipeline-compact", label: "compact" },
      { action: "pipeline-template", label: "템플릿" },
    ].forEach(function (entry) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-rail-secondary-btn";
      btn.setAttribute("data-action", entry.action);
      btn.textContent = entry.label;
      proButtons.appendChild(btn);
    });
    header.appendChild(proButtons);
    rail.appendChild(header);

    function _refreshProButtons() {
      proButtons.style.display = (mode === "pro") ? "" : "none";
    }
    _refreshProButtons();

    // ── Body — phase list (rebuilt on store change) ─────────────
    const body = _doc.createElement("div");
    body.className = "prod-rail-body";
    body.setAttribute("data-rail-slot", "phase-list");
    body.setAttribute("role", "list");
    rail.appendChild(body);

    // UI-P5-b: read snapshot + select real phases (or null for mock).
    // Returns { stages, metrics, isLive, runId } so _renderBody can
    // toggle the demo note text.
    function _resolveData() {
      if (!store || !selectors) return { stages: null, metrics: null, isLive: false, runId: null };
      let snap;
      try { snap = store.snapshot(); } catch (_) { return { stages: null, metrics: null, isLive: false, runId: null }; }
      const runId = selectors.selectActiveRunId(snap);
      const stages = runId ? selectors.selectRunPhases(snap, runId) : null;
      const metrics = runId ? selectors.selectRunMetrics(snap, runId) : null;
      return { stages, metrics, isLive: !!stages, runId };
    }

    function _renderBody() {
      // Wipe body but keep slot attributes by re-using the same node
      while (body.firstChild) body.removeChild(body.firstChild);

      const data = _resolveData();
      const stages = data.stages || (allowMockData ? MOCK_STAGES : []);
      const metrics = data.metrics; // null when no real metrics
      const isLive = data.isLive;
      const runId = data.runId;

      // ARIA label reflects mock vs live state
      body.setAttribute("aria-label",
        isLive ? "파이프라인 단계 목록 (활성 run: " + (runId || "default") + ")"
               : "파이프라인 단계 목록 (예시 데이터)",
      );

      // Demo / live note above nodes
      const note = _doc.createElement("div");
      note.className = "prod-rail-empty";
      note.setAttribute("data-rail-slot", "demo-note");
      note.style.padding = "0 0 12px";
      note.style.textAlign = "left";
      note.style.fontSize = "10px";
      note.style.letterSpacing = "0.06em";
      note.textContent = isLive
        ? ("활성 run: " + (runId || "default"))
        : "예시 단계 — 실행을 시작하면 실제 파이프라인으로 교체됩니다";
      if (!isLive && !allowMockData) {
        note.textContent = "아직 실행 중인 작업이 없습니다. 작업을 시작하면 실제 파이프라인이 표시됩니다.";
      }
      body.appendChild(note);

      stages.forEach(function (stage, idx) {
        const isLast = idx === stages.length - 1;
        body.appendChild(_renderSkeletonNode(_doc, stage, mode, isLast));
      });

      if (mode === "pro" && (metrics || allowMockData)) {
        body.appendChild(_renderMetricsBlock(_doc, metrics));
      }
    }

    _renderBody();

    // UI-P5-b: subscribe to store, rebuild on change. Cheap because
    // the rail body is small (≤7 nodes + metrics block). UI-P9 may
    // add an in-place diff later if profiling shows it matters.
    let unsubscribe = null;
    if (store && typeof store.subscribe === "function") {
      try {
        unsubscribe = store.subscribe(_renderBody);
      } catch (_) { /* defensive — store contract violated, keep mock */ }
    }

    root.appendChild(rail);

    return {
      destroy: function () {
        // UI-P5-b: clean up store subscription before unmount
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        if (rail.parentNode === root) {
          try { root.removeChild(rail); } catch (_) {}
        }
      },
      setMode: function (next) {
        if (next === "simple" || next === "pro") {
          mode = next;
          _refreshProButtons();
          _renderBody(); // re-render so phase detail visibility tracks mode
        }
      },
      _state: function () {
        const data = _resolveData();
        return {
          mode,
          phaseCount: data.stages ? data.stages.length : (allowMockData ? MOCK_STAGES.length : 0),
          isLive: data.isLive,
          runId: data.runId,
          slot: "pipeline-rail",
        };
      },
    };
  }

  return {
    create,
    MOCK_STAGES,
    MOCK_METRICS,
  };
});
