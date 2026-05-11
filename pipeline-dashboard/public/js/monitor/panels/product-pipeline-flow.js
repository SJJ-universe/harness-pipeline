// SIMPLE-MODE-VIZ-0 (2026-05-08) — Phase Flow Diagram panel.
//
// Simple-mode-only visualization. Shown in place of the live-terminals
// + monitor-grid in Pro mode. The intent is to give a non-technical
// operator a single, glanceable surface that says:
//   - which phase the pipeline is currently in (A → B → C → D)
//   - whether it's looping between critique (C) and revise (D)
//   - how long it's been running and what iteration we're on
//
// The diagram renders 4 phase boxes (A=context, B=plan, C=critique,
// D=revise) wired with arrows. The active box pulses; completed boxes
// show a checkmark; the C↔D loop arrow highlights while an iteration
// is in flight.
//
// Read path:
//   store.snapshot()
//     → run = runs[selectedRunId] (via selectActiveRunId)
//     → run.phaseIdx (0-6 via MOCK_STAGES; here we mainly care about
//                     letter via run.phase: "A"|"B"|"C"|"D")
//     → cycle_iteration events bumped store via legacy-bridge feed
//       (we read run.iteration if set, else default 0)
//
// Slot contract (for tests + visual baseline):
//   data-region="pipeline-flow"      — root
//   data-flow-state="idle|running|complete|error"
//   data-flow-box="A|B|C|D"
//   data-flow-box-state="pending|active|completed"
//   data-flow-arrow="B>C|C>D|D>C"
//   data-flow-arrow-state="dormant|active"
//   data-flow-slot="title|meta|progress|elapsed|iteration"

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductPipelineFlow = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Phase descriptors. Order matters — drives diagram L→R layout.
  const PHASES = Object.freeze([
    { id: "A", letter: "A", labelKo: "컨텍스트",  labelEn: "Context",  desc: "사용자 입력 분석" },
    { id: "B", letter: "B", labelKo: "계획",      labelEn: "Plan",     desc: "Claude가 작업 계획을 세움" },
    { id: "C", letter: "C", labelKo: "비평",      labelEn: "Critique", desc: "Codex가 계획을 검토함" },
    { id: "D", letter: "D", labelKo: "수정",      labelEn: "Revise",   desc: "Claude가 비평을 반영함" },
  ]);

  // Map run.phase letter to the index of the currently-active box.
  function _activeIdxFor(phase) {
    for (let i = 0; i < PHASES.length; i++) {
      if (PHASES[i].letter === phase) return i;
    }
    return -1;
  }

  function _formatElapsed(ms) {
    if (!ms || ms < 0) return "—";
    const total = Math.round(ms / 1000);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return mm + ":" + (ss < 10 ? "0" + ss : ss);
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("OrchestratorProductPipelineFlow.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) {
      throw new Error("OrchestratorProductPipelineFlow.create: root + doc required");
    }
    const store = opts.store || null;
    const selectors = opts.dataSelectors
      || (typeof window !== "undefined" && window.OrchestratorProductShellData)
      || null;
    let locale = opts.locale === "en" ? "en" : "ko";

    // ── DOM skeleton ──────────────────────────────────────────────

    const flow = _doc.createElement("div");
    flow.className = "prod-pipeline-flow";
    flow.setAttribute("data-region", "pipeline-flow");
    flow.setAttribute("role", "region");
    flow.setAttribute("aria-label", locale === "en"
      ? "Pipeline phase flow visualization"
      : "파이프라인 단계 흐름 시각화");
    flow.setAttribute("data-flow-state", "idle");

    // Title + meta strip.
    const head = _doc.createElement("div");
    head.className = "prod-pipeline-flow-head";
    const title = _doc.createElement("h2");
    title.className = "prod-pipeline-flow-title";
    title.setAttribute("data-flow-slot", "title");
    title.textContent = locale === "en" ? "Pipeline" : "파이프라인";
    head.appendChild(title);
    const meta = _doc.createElement("div");
    meta.className = "prod-pipeline-flow-meta";
    meta.setAttribute("data-flow-slot", "meta");
    head.appendChild(meta);
    flow.appendChild(head);

    // Boxes + arrows row.
    const diagram = _doc.createElement("div");
    diagram.className = "prod-pipeline-flow-diagram";
    flow.appendChild(diagram);

    const boxes = [];
    const arrows = [];
    PHASES.forEach(function (p, i) {
      // Box
      const box = _doc.createElement("div");
      box.className = "prod-pipeline-flow-box";
      box.setAttribute("data-flow-box", p.id);
      box.setAttribute("data-flow-box-state", "pending");
      const letter = _doc.createElement("div");
      letter.className = "prod-pipeline-flow-box-letter";
      letter.textContent = p.letter;
      box.appendChild(letter);
      const label = _doc.createElement("div");
      label.className = "prod-pipeline-flow-box-label";
      label.textContent = locale === "en" ? p.labelEn : p.labelKo;
      box.appendChild(label);
      const check = _doc.createElement("div");
      check.className = "prod-pipeline-flow-box-check";
      check.textContent = "✓";
      box.appendChild(check);
      const pulse = _doc.createElement("div");
      pulse.className = "prod-pipeline-flow-box-pulse";
      box.appendChild(pulse);
      diagram.appendChild(box);
      boxes.push({ el: box, letter, label, check, pulse, descriptor: p });

      // Arrow (after every box except last)
      if (i < PHASES.length - 1) {
        const arrow = _doc.createElement("div");
        arrow.className = "prod-pipeline-flow-arrow";
        const arrowId = PHASES[i].id + ">" + PHASES[i + 1].id;
        arrow.setAttribute("data-flow-arrow", arrowId);
        arrow.setAttribute("data-flow-arrow-state", "dormant");
        const stem = _doc.createElement("div");
        stem.className = "prod-pipeline-flow-arrow-stem";
        arrow.appendChild(stem);
        const head2 = _doc.createElement("div");
        head2.className = "prod-pipeline-flow-arrow-head";
        head2.textContent = "▶";
        arrow.appendChild(head2);
        diagram.appendChild(arrow);
        arrows.push({ el: arrow, id: arrowId });
      }
    });

    // D → C loop arrow (separate visual, curves back).
    const loop = _doc.createElement("div");
    loop.className = "prod-pipeline-flow-loop";
    loop.setAttribute("data-flow-arrow", "D>C");
    loop.setAttribute("data-flow-arrow-state", "dormant");
    const loopArrow = _doc.createElement("span");
    loopArrow.className = "prod-pipeline-flow-loop-arrow";
    loopArrow.textContent = "↻";
    loop.appendChild(loopArrow);
    const loopLabel = _doc.createElement("span");
    loopLabel.className = "prod-pipeline-flow-loop-label";
    loopLabel.textContent = locale === "en"
      ? "critique loop"
      : "비평 반복";
    loop.appendChild(loopLabel);
    flow.appendChild(loop);

    // Progress footer.
    const footer = _doc.createElement("div");
    footer.className = "prod-pipeline-flow-footer";
    const progress = _doc.createElement("div");
    progress.className = "prod-pipeline-flow-progress";
    progress.setAttribute("data-flow-slot", "progress");
    const progressFill = _doc.createElement("div");
    progressFill.className = "prod-pipeline-flow-progress-fill";
    progress.appendChild(progressFill);
    footer.appendChild(progress);
    const stats = _doc.createElement("div");
    stats.className = "prod-pipeline-flow-stats";
    const elapsed = _doc.createElement("span");
    elapsed.setAttribute("data-flow-slot", "elapsed");
    elapsed.textContent = locale === "en" ? "elapsed: —" : "경과: —";
    stats.appendChild(elapsed);
    const iter = _doc.createElement("span");
    iter.setAttribute("data-flow-slot", "iteration");
    iter.textContent = locale === "en" ? "iter: 0" : "반복: 0";
    stats.appendChild(iter);
    footer.appendChild(stats);
    flow.appendChild(footer);

    // ── Update logic ──────────────────────────────────────────────

    let _tick = null;

    function _resolveRunState() {
      const out = {
        runId: null, phase: null, phaseIdx: null, status: "idle",
        startedAt: null, completedAt: null, iteration: 0,
      };
      if (!store || !selectors) return out;
      let snap;
      try { snap = store.snapshot(); } catch (_) { return out; }
      const runId = selectors.selectActiveRunId(snap);
      if (!runId) return out;
      const runs = snap && snap.runs;
      if (!runs) return out;
      const run = (typeof runs.get === "function")
        ? runs.get(runId) : runs[runId];
      if (!run) return out;
      out.runId = run.id || runId;
      out.phase = run.phase || null;
      out.phaseIdx = typeof run.phaseIdx === "number" ? run.phaseIdx : null;
      out.status = run.status || "idle";
      out.startedAt = run.startedAt || null;
      out.completedAt = run.completedAt || null;
      out.iteration = typeof run.iteration === "number" ? run.iteration : 0;
      return out;
    }

    function _render() {
      const st = _resolveRunState();
      const activeIdx = _activeIdxFor(st.phase);
      const isRunning = st.status === "active" || st.status === "running";
      const isError = st.status === "error";
      const isComplete = st.status === "completed";

      // Root state attribute drives header color / pulse intensity.
      flow.setAttribute("data-flow-state",
        isError ? "error" : isComplete ? "complete"
        : (isRunning || activeIdx >= 0) ? "running" : "idle");

      // Box states: pending / active / completed.
      boxes.forEach(function (b, i) {
        let state = "pending";
        if (isComplete && !isError) state = "completed";
        else if (activeIdx === i) state = "active";
        else if (activeIdx > i) state = "completed";
        b.el.setAttribute("data-flow-box-state", state);
      });

      // Arrows: highlight only the arrow leading INTO the active box,
      // OR the arrow LEADING OUT of the previous box.
      arrows.forEach(function (a) {
        let state = "dormant";
        if (activeIdx > 0) {
          const arrow = PHASES[activeIdx - 1].id + ">" + PHASES[activeIdx].id;
          if (a.id === arrow && isRunning) state = "active";
        }
        a.el.setAttribute("data-flow-arrow-state", state);
      });

      // D→C loop is "active" when we're in D phase OR the iteration
      // counter is > 0 (proves the loop has fired before).
      const inLoop = (st.phase === "D" && isRunning) || st.iteration > 0;
      loop.setAttribute("data-flow-arrow-state", inLoop ? "active" : "dormant");

      // Meta header + footer.
      meta.textContent = isError
        ? (locale === "en" ? "Failed" : "실패")
        : isComplete
          ? (locale === "en" ? "Completed" : "완료")
          : isRunning
            ? (locale === "en"
                ? ("Running · phase " + (st.phase || "?"))
                : ("실행 중 · " + (st.phase || "?") + " 단계"))
            : (locale === "en" ? "Idle" : "대기 중");

      // Progress fill: count active+completed boxes out of 4.
      let done = 0;
      boxes.forEach(function (b) {
        const s = b.el.getAttribute("data-flow-box-state");
        if (s === "completed") done += 1;
        else if (s === "active") done += 0.5;
      });
      const pct = (done / PHASES.length) * 100;
      progressFill.style.width = pct.toFixed(0) + "%";

      // Elapsed time.
      const now = Date.now();
      const startedAt = st.startedAt || 0;
      const endAt = st.completedAt || now;
      const ms = (startedAt && (isRunning || isComplete || isError))
        ? (endAt - startedAt) : 0;
      elapsed.textContent = (locale === "en" ? "elapsed: " : "경과: ")
        + _formatElapsed(ms);
      iter.textContent = (locale === "en" ? "iter: " : "반복: ") + st.iteration;
    }

    function _startTick() {
      if (_tick) return;
      // Every 1s update elapsed so the operator sees a live counter
      // even when no events fire (e.g. waiting on Claude's first chunk).
      _tick = setInterval(function () {
        try { _render(); } catch (_) { /* defensive */ }
      }, 1000);
    }

    function _stopTick() {
      if (!_tick) return;
      try { clearInterval(_tick); } catch (_) {}
      _tick = null;
    }

    let unsubscribe = null;
    if (store && typeof store.subscribe === "function") {
      try { unsubscribe = store.subscribe(_render); }
      catch (_) { /* defensive */ }
    }

    _render();
    _startTick();
    root.appendChild(flow);

    return {
      destroy: function () {
        _stopTick();
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        if (flow.parentNode === root) {
          try { root.removeChild(flow); } catch (_) {}
        }
      },
      setMode: function () { /* mode doesn't affect this panel — Simple-only */ },
      setLocale: function (next) {
        const coerced = (next === "en") ? "en" : "ko";
        if (coerced === locale) return;
        locale = coerced;
        // Update static labels.
        title.textContent = locale === "en" ? "Pipeline" : "파이프라인";
        loopLabel.textContent = locale === "en" ? "critique loop" : "비평 반복";
        boxes.forEach(function (b) {
          b.label.textContent = locale === "en"
            ? b.descriptor.labelEn : b.descriptor.labelKo;
        });
        _render();
      },
      // Test hooks
      _state: function () { return _resolveRunState(); },
      _render,
      _boxes: boxes,
      _arrows: arrows,
      _loop: loop,
    };
  }

  return { create, PHASES };
});
