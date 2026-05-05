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
    // PRODUCT-SHELL-WIRING: lazy-DOM mode for the product shell at `/`.
    // The legacy view (`index.legacy.html`) ships the overlay markup
    // pre-built; product `index.html` does not. When `open()` runs and
    // there is no `general-run-overlay`, this module builds it itself
    // AND self-binds the start/close/cancel/ESC handlers — because in
    // product mode there is no `app.js` doing the `_b("#btn-gr-start",
    // submitGeneralRun)` wiring. `mountTarget` is the parent (defaults
    // to `_doc.body`); `installFocusTrap` is the trap factory (defaults
    // to `window.HarnessFocusTrap?.trap` if available).
    mountTarget = null,
    installFocusTrap = null,
  } = {}) {
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    const _fetch = fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _confirm = confirmFn
      || (typeof confirm !== "undefined" ? confirm : (() => true));
    const _alert = alertFn
      || (typeof alert !== "undefined" ? alert : (() => {}));
    const _trap = (typeof installFocusTrap === "function")
      ? installFocusTrap
      : ((typeof window !== "undefined"
          && window.HarnessFocusTrap
          && typeof window.HarnessFocusTrap.trap === "function")
            ? window.HarnessFocusTrap.trap
            : null);

    // Tracks the active focus-trap release fn between open() and close().
    // Module-level state (per install() invocation) so a second open
    // before close doesn't double-install.
    let _releaseFocusTrap = null;

    // Lazy-create the overlay DOM tree + bind events. Called from open();
    // returns the overlay element (existing or newly created). Returns
    // null only if `_doc` is unavailable. Idempotent: if the overlay
    // already exists (legacy DOM), this is a fast lookup with no edits
    // and no re-binding (legacy `app.js:1834-1835` owns those bindings).
    function _ensureOverlay() {
      if (!_doc) return null;
      let overlay = _doc.getElementById("general-run-overlay");
      if (overlay) return overlay;

      // Build mirroring `index.legacy.html:268-291` exactly so the
      // existing CSS selectors apply with no style.product.css change.
      overlay = _doc.createElement("div");
      overlay.className = "modal-overlay";
      overlay.id = "general-run-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-labelledby", "general-run-title");
      // Marker so tests + future style overrides can branch on source.
      overlay.setAttribute("data-modal-source", "product");

      const content = _doc.createElement("div");
      content.className = "modal-content";
      overlay.appendChild(content);

      const header = _doc.createElement("div");
      header.className = "modal-header";
      content.appendChild(header);

      const title = _doc.createElement("span");
      title.className = "modal-title";
      title.id = "general-run-title";
      title.textContent = "범용 파이프라인 시작 — Claude 플랜 ↔ Codex 비평";
      header.appendChild(title);

      const xBtn = _doc.createElement("button");
      xBtn.className = "modal-close";
      xBtn.type = "button";
      xBtn.setAttribute("aria-label", "닫기");
      xBtn.textContent = "×";
      header.appendChild(xBtn);

      const body = _doc.createElement("div");
      body.className = "modal-body";
      content.appendChild(body);

      const help = _doc.createElement("p");
      help.className = "plan-help";
      help.textContent = "작업을 입력하면 Claude가 계획을 세우고 Codex가 비평하며, "
        + "critical/high 이슈가 남아 있는 동안 자동으로 계획을 수정하고 다시 비평합니다.";
      body.appendChild(help);

      const taskLabel = _doc.createElement("label");
      taskLabel.className = "plan-field-label";
      taskLabel.textContent = "작업 설명";
      body.appendChild(taskLabel);

      const taskInput = _doc.createElement("textarea");
      taskInput.id = "gr-task-input";
      taskInput.className = "plan-textarea";
      taskInput.setAttribute("rows", "5");
      taskInput.setAttribute(
        "placeholder",
        "예: Express 서버에 JWT 인증 미들웨어를 추가하고 기존 /admin 라우트를 보호하기",
      );
      body.appendChild(taskInput);

      const iterLabel = _doc.createElement("label");
      iterLabel.className = "plan-field-label";
      iterLabel.textContent = "최대 반복 횟수";
      body.appendChild(iterLabel);

      const iterInput = _doc.createElement("input");
      iterInput.type = "number";
      iterInput.id = "gr-max-iter";
      iterInput.className = "plan-input";
      iterInput.value = "3";
      iterInput.setAttribute("min", "1");
      iterInput.setAttribute("max", "5");
      body.appendChild(iterInput);

      const actions = _doc.createElement("div");
      actions.className = "plan-actions";
      body.appendChild(actions);

      const cancelBtn = _doc.createElement("button");
      cancelBtn.className = "btn-ctrl";
      cancelBtn.id = "btn-gr-cancel";
      cancelBtn.type = "button";
      cancelBtn.textContent = "취소";
      actions.appendChild(cancelBtn);

      const startBtn = _doc.createElement("button");
      startBtn.className = "btn-ctrl primary";
      startBtn.id = "btn-gr-start";
      startBtn.type = "button";
      startBtn.textContent = "시작";
      actions.appendChild(startBtn);

      // Mount the overlay into the requested target (default: body).
      const target = mountTarget || _doc.body;
      if (target && typeof target.appendChild === "function") {
        target.appendChild(overlay);
      }

      // Self-bind ONLY in the lazy-create branch. Legacy DOM is owned
      // by `app.js:1834-1835`. Branching on creation (not on a global
      // attribute) prevents the double-binding regression where both
      // app.js and this module attach listeners to the same legacy
      // node.
      xBtn.addEventListener("click", function () { close(); });
      cancelBtn.addEventListener("click", function () { close(); });
      startBtn.addEventListener("click", function () { submit(); });

      // Backdrop click: close ONLY when the click target is the
      // overlay itself (not a descendant — the modal content).
      overlay.addEventListener("click", function (event) {
        if (event && event.target === overlay) close();
      });

      // ESC: close. The focus trap (if installed in open()) also
      // forwards Escape to onEscape, so this is a belt-and-braces
      // path for cases where the trap is not available.
      overlay.addEventListener("keydown", function (event) {
        if (event && event.key === "Escape") close();
      });

      return overlay;
    }

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
      const overlay = _ensureOverlay();
      if (overlay) overlay.classList.add("visible");
      // Install focus trap if available (lazy-created OR legacy overlay).
      if (overlay && typeof _trap === "function" && !_releaseFocusTrap) {
        try {
          _releaseFocusTrap = _trap(overlay, {
            onEscape: close,
            initialFocus: _doc.getElementById("gr-task-input"),
          });
        } catch (_) { _releaseFocusTrap = null; }
      }
      setTimeout(() => {
        const ti = _doc.getElementById("gr-task-input");
        if (ti && typeof ti.focus === "function") ti.focus();
      }, 50);
    }

    function close() {
      if (!_doc) return;
      const overlay = _doc.getElementById("general-run-overlay");
      if (overlay) overlay.classList.remove("visible");
      if (typeof _releaseFocusTrap === "function") {
        try { _releaseFocusTrap(); } catch (_) {}
        _releaseFocusTrap = null;
      }
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
