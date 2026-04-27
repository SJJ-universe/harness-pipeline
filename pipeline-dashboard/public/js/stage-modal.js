// Slice MA7-b (Phase D, 2026-04-27) — stage-modal.
//
// Behaviour-preserving lift of openModal + closeModal from app.js
// (~52 lines around line 1518-1569). The legacy modal renders the
// per-stage log buffer (stageLogs[key]) plus optional phase
// operational metadata (agent / allowedTools / exitCriteria / cycle).
//
// State (stageLogs map, currentPipelineConfig) is OWNED by app.js;
// the lifted module accepts both via the open() call so it stays
// stateless. This matches MA7-a's "stateless render module" pattern.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessStageModal = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function install({ doc = null } = {}) {
    const _doc = doc || (typeof document !== "undefined" ? document : null);

    function _div(className, textContent) {
      const el = _doc.createElement("div");
      el.className = className;
      if (textContent !== undefined) el.textContent = textContent;
      return el;
    }

    function _span(className, textContent) {
      const el = _doc.createElement("span");
      el.className = className;
      if (textContent !== undefined) el.textContent = textContent;
      return el;
    }

    function open(title, key, { stageLogs = {}, currentPipelineConfig = null } = {}) {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const overlay = _doc.getElementById("modal-overlay");
      const titleEl = _doc.getElementById("modal-title");
      const body = _doc.getElementById("modal-body");
      if (!overlay || !titleEl || !body) return;

      titleEl.textContent = title || "";
      body.textContent = "";

      // Phase operational metadata header — only when this is a phase
      // modal (key starts with "phase-") AND the current template knows
      // about that phase id.
      if (typeof key === "string"
          && key.startsWith("phase-")
          && currentPipelineConfig
          && Array.isArray(currentPipelineConfig.phases)) {
        const phaseId = key.replace("phase-", "");
        const phase = currentPipelineConfig.phases.find((p) => p && p.id === phaseId);
        if (phase && (phase.agent || phase.allowedTools || phase.exitCriteria)) {
          const meta = _div("modal-phase-meta");
          const items = [];
          if (phase.agent) items.push("Agent: " + phase.agent);
          if (phase.allowedTools) items.push("Tools: " + phase.allowedTools.join(", "));
          if (phase.exitCriteria) {
            items.push("Exit: " + phase.exitCriteria.map((c) => c && c.message).filter(Boolean).join("; "));
          }
          if (phase.cycle) {
            items.push("Cycle: max " + (phase.maxIterations || 3)
              + " iterations → Phase " + (phase.linkedCycle || "?"));
          }
          meta.textContent = items.join(" | ");
          body.appendChild(meta);
        }
      }

      const logs = (stageLogs && stageLogs[key]) || [];
      if (logs.length === 0) {
        body.appendChild(_div("modal-empty", "이 단계의 로그가 아직 없습니다."));
      } else {
        for (const log of logs) {
          const entry = _div("log-entry");
          if (log && typeof log === "object" && log.time) {
            entry.appendChild(_span("log-time", log.time));
            entry.appendChild(_span(
              "log-msg" + (log.isError ? " error-msg" : ""),
              log.message
            ));
          } else {
            entry.textContent = String(log);
          }
          body.appendChild(entry);
        }
      }

      overlay.classList.add("visible");
    }

    function close() {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const overlay = _doc.getElementById("modal-overlay");
      if (overlay && overlay.classList) overlay.classList.remove("visible");
    }

    return { open, close };
  }

  return { install };
});
