// Slice MB4-c (Phase D Round 2, 2026-04-27) — general-pipeline-modal.
//
// Behaviour-preserving lift of the legacy openGeneralRun/closeGeneralRun/
// submitGeneralRun/abortGeneralRun + finalPlan modal handlers out of
// public/app.js. Same DOM ids, same UX. app.js delegates to the
// returned actions so its event-bindings switch from local function
// references to module-method references.
//
// Module dependencies (passed via install — keeps the module decoupled):
//   doc                      — document override (tests)
//   loadPipelineTemplate(id) — app.js helper, optional
//   getCurrentTemplateId()   — app.js getter, optional
//   addLog(kind, message)    — app.js helper, optional
//   fetchImpl                — fetch override (tests)

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessGeneralPipelineModal = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function install({
    doc = null,
    fetchImpl = null,
    loadPipelineTemplate = null,
    getCurrentTemplateId = null,
    addLog = null,
    confirmFn = null,
    alertFn = null,
  } = {}) {
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _confirm = confirmFn
      || (typeof confirm !== "undefined" ? confirm : (() => true));
    const _alert = alertFn
      || (typeof alert !== "undefined" ? alert : (() => {}));

    function open() {
      if (!_doc) return;
      // Auto-switch visual template to "default" so the user sees the
      // phases that will actually run.
      try {
        const cur = typeof getCurrentTemplateId === "function" ? getCurrentTemplateId() : null;
        if (cur !== "default" && typeof loadPipelineTemplate === "function") {
          loadPipelineTemplate("default");
        }
      } catch (_) {}
      const overlay = _doc.getElementById("general-run-overlay");
      if (overlay) overlay.classList.add("visible");
      setTimeout(() => {
        const ti = _doc.getElementById("gr-task-input");
        if (ti && typeof ti.focus === "function") ti.focus();
      }, 50);
    }

    function close() {
      if (!_doc) return;
      const overlay = _doc.getElementById("general-run-overlay");
      if (overlay) overlay.classList.remove("visible");
    }

    async function submit() {
      if (!_doc) return;
      const taskEl = _doc.getElementById("gr-task-input");
      const iterEl = _doc.getElementById("gr-max-iter");
      const task = (taskEl && taskEl.value || "").trim();
      const maxIter = parseInt((iterEl && iterEl.value) || "3", 10) || 3;
      if (task.length < 3) {
        _alert("작업 설명을 3자 이상 입력하세요");
        return;
      }
      const startBtn = _doc.getElementById("btn-gr-start");
      const triggerBtn = _doc.getElementById("btn-start-general");
      const abortBtn = _doc.getElementById("btn-abort-general");
      if (startBtn) startBtn.disabled = true;
      if (triggerBtn) triggerBtn.disabled = true;
      try {
        if (typeof _fetch !== "function") throw new Error("no fetch implementation");
        const r = await _fetch("/api/pipeline/general-run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, maxIterations: maxIter }),
        });
        const d = await r.json();
        if (!r.ok) {
          _alert("시작 실패: " + (d.error || r.status));
          if (triggerBtn) triggerBtn.disabled = false;
          return;
        }
        close();
        if (abortBtn) abortBtn.classList.remove("is-hidden");
        if (typeof addLog === "function") {
          addLog("phase", "범용 파이프라인 시작 — " + task.slice(0, 60) + " (max " + maxIter + " iter)");
        }
      } catch (err) {
        _alert("요청 실패: " + (err && err.message ? err.message : String(err)));
        if (triggerBtn) triggerBtn.disabled = false;
      } finally {
        if (startBtn) startBtn.disabled = false;
      }
    }

    async function abort() {
      if (!_confirm("진행 중인 파이프라인을 중단합니까?")) return;
      try {
        if (typeof _fetch === "function") {
          await _fetch("/api/pipeline/general-abort", { method: "POST" });
        }
      } catch (_) {}
    }

    function closeFinalPlan() {
      if (!_doc) return;
      const overlay = _doc.getElementById("final-plan-overlay");
      if (overlay) overlay.classList.remove("visible");
    }

    function showFinalPlan(data) {
      if (!_doc || !data) return;
      const overlay = _doc.getElementById("final-plan-overlay");
      const meta = _doc.getElementById("final-plan-meta");
      const text = _doc.getElementById("final-plan-text");
      const title = _doc.getElementById("final-plan-title");
      if (!overlay || !meta || !text) return;

      const verdict = data.verdict || "—";
      const verdictClass =
        verdict === "CLEAN" ? "ok" :
        verdict === "CONCERNS" ? "warn" :
        verdict === "ERROR" || verdict === "ABORTED" ? "fail" : "";
      const findings = (data.lastCritique && data.lastCritique.findings) || [];
      const counts = { critical: 0, high: 0, medium: 0, low: 0, note: 0 };
      findings.forEach((f) => {
        const sev = (f && f.severity) || "note";
        if (counts[sev] !== undefined) counts[sev]++;
      });

      if (title) title.textContent = "최종 플랜 — 범용 파이프라인";
      meta.textContent = "";
      const verdictSpan = _doc.createElement("span");
      verdictSpan.className = verdictClass;
      verdictSpan.textContent = verdict;
      meta.appendChild(_doc.createTextNode("판정: "));
      meta.appendChild(verdictSpan);
      meta.appendChild(_doc.createTextNode(
        " · 반복: " + (data.iterations || 0)
        + " · 소요: " + (Math.round((data.durationMs || 0) / 100) / 10) + "s"
        + " · 최종 findings: C" + counts.critical + "/H" + counts.high
        + "/M" + counts.medium + "/L" + counts.low + "/N" + counts.note
        + (data.reason ? " · 이유: " + data.reason : "")
      ));
      text.textContent = data.finalPlan || "(플랜 없음)";
      overlay.classList.add("visible");
    }

    return { open, close, submit, abort, closeFinalPlan, showFinalPlan };
  }

  return { install };
});
