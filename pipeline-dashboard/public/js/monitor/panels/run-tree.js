// Slice MA4 (Phase D, 2026-04-27) — OrchestratorMonitorRunTree.
//
// Left-rail panel: lists every run in the monitor store and lets the user
// pick one. Click → onSelect(runId) (the layout wires this to
// store.selectRun). Highlights snapshot.selectedRunId. Updates live on
// store publish.
//
// Per spec section 4.1 the left navigation rail eventually grows to host
// Agent Tree + replay/history entries too — those become sibling panels
// in MA6. This slice ships JUST the run list so the run-summary panel
// (centre) has something to react to.
//
// Update lane: warm. Re-renders on store publish, but the list is small
// (typically 1–3 runs in single-active mode, up to HARNESS_MAX_RUNS) so a
// full repaint stays cheap.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorRunTree = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _statusClass(status) {
    if (status === "active") return "is-active";
    if (status === "paused") return "is-paused";
    return "is-idle";
  }

  function _metaLine(run) {
    if (!run) return "";
    const parts = [];
    if (run.templateId) parts.push(run.templateId);
    if (run.phase) parts.push("phase " + run.phase);
    return parts.join(" · ");
  }

  function create({ root, store, onSelect, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("runTree.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("runTree.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("runTree.create: no document available");
    }

    function _emit(runId) {
      if (typeof onSelect === "function") {
        try { onSelect(runId); } catch (_) { /* user callback never aborts panel */ }
      }
    }

    function _renderItem(runId, run, isSelected) {
      const li = _doc.createElement("li");
      li.className = "rt-item" + (isSelected ? " is-selected" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", isSelected ? "true" : "false");
      li.setAttribute("tabindex", isSelected ? "0" : "-1");
      li.setAttribute("data-run-id", runId);

      const dot = _doc.createElement("span");
      dot.className = "rt-status " + _statusClass(run && run.status);
      li.appendChild(dot);

      const labelWrap = _doc.createElement("span");
      labelWrap.className = "rt-label";
      const idEl = _doc.createElement("span");
      idEl.className = "rt-id";
      idEl.textContent = runId;
      labelWrap.appendChild(idEl);
      const metaText = _metaLine(run);
      if (metaText) {
        const metaEl = _doc.createElement("span");
        metaEl.className = "rt-meta";
        metaEl.textContent = metaText;
        labelWrap.appendChild(metaEl);
      }
      li.appendChild(labelWrap);

      li.addEventListener("click", () => _emit(runId));
      li.addEventListener("keydown", (ev) => {
        if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
          if (ev.preventDefault) ev.preventDefault();
          _emit(runId);
        }
      });
      return li;
    }

    function render(snapshot) {
      root.innerHTML = "";
      const ids = (snapshot && snapshot.runIds) || [];
      const runs = (snapshot && snapshot.runs) || {};
      const selected = (snapshot && snapshot.selectedRunId) || null;

      if (ids.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "rt-empty";
        empty.textContent = "실행 중인 런 없음";
        root.appendChild(empty);
        return;
      }

      const list = _doc.createElement("ul");
      list.className = "rt-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Runs");
      for (const id of ids) {
        list.appendChild(_renderItem(id, runs[id], id === selected));
      }
      root.appendChild(list);
    }

    render(store.snapshot());
    const off = store.subscribe(render);

    return {
      destroy() {
        try { off(); } catch (_) {}
        root.innerHTML = "";
      },
      // Test hooks
      _render: render,
      _statusClass,
      _metaLine,
    };
  }

  return { create, _statusClass, _metaLine };
});
