// Slice MA4 (Phase D, 2026-04-27) — HarnessMonitorRunSummary.
//
// Centre-workspace panel: shows the currently-selected run's high-level
// state (status, template, phase + index, started time). Re-renders on
// every store publish; selection changes flow through automatically
// because the store publishes after selectRun().
//
// Per spec section 4.1 the centre workspace will eventually host the
// pipeline graph + tool/event timeline too — those are MA5 panels. This
// slice ships the summary card so MA4 has end-to-end "click run on left
// → see detail in centre" behavior.
//
// Update lane: hot. The summary is small + always-visible; full repaint
// per snapshot is well under 1ms even for fast event bursts.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorRunSummary = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _statusClass(status) {
    if (status === "active") return "is-active";
    if (status === "paused") return "is-paused";
    return "is-idle";
  }

  /**
   * Render `started X ago`. ms is the delta to now in milliseconds.
   * Returns "방금 전" for sub-second, "Ns 전" / "Nm 전" / "Nh Mm 전".
   */
  function _formatRelative(ts, now) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const _now = Number.isFinite(now) ? now : Date.now();
    const ms = Math.max(0, _now - ts);
    if (ms < 1000) return "방금 전";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "초 전";
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r === 0 ? m + "분 전" : m + "분 " + r + "초 전";
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? h + "시간 전" : h + "시간 " + m + "분 전";
  }

  function _selectedRun(snapshot) {
    if (!snapshot || !snapshot.selectedRunId) return null;
    const r = snapshot.runs && snapshot.runs[snapshot.selectedRunId];
    return r || null;
  }

  function create({ root, store, doc, now } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("runSummary.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("runSummary.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("runSummary.create: no document available");
    }
    // `now` is a clock injection point so tests can pin "started X 전" output.
    const _nowFn = typeof now === "function" ? now : () => Date.now();

    function _kv(label, value) {
      const dt = _doc.createElement("dt");
      dt.textContent = label;
      const dd = _doc.createElement("dd");
      dd.textContent = value == null || value === "" ? "—" : String(value);
      return [dt, dd];
    }

    function render(snapshot) {
      root.innerHTML = "";
      const run = _selectedRun(snapshot);
      const selectedId = (snapshot && snapshot.selectedRunId) || null;

      if (!run) {
        const empty = _doc.createElement("div");
        empty.className = "rs-empty";
        empty.textContent = selectedId
          ? "선택된 런(" + selectedId + ")을 찾지 못했습니다."
          : "선택된 런 없음 — 좌측 목록에서 선택하세요.";
        root.appendChild(empty);
        return;
      }

      const card = _doc.createElement("div");
      card.className = "rs-card";

      const header = _doc.createElement("div");
      header.className = "rs-header";
      const idEl = _doc.createElement("span");
      idEl.className = "rs-id";
      idEl.textContent = run.id || selectedId || "—";
      header.appendChild(idEl);
      const statusEl = _doc.createElement("span");
      statusEl.className = "rs-status " + _statusClass(run.status);
      statusEl.textContent = run.status || "idle";
      header.appendChild(statusEl);
      card.appendChild(header);

      const dl = _doc.createElement("dl");
      dl.className = "rs-meta";
      const phaseValue = run.phase
        ? run.phase + (typeof run.phaseIdx === "number" ? " (idx " + run.phaseIdx + ")" : "")
        : "—";
      const startedValue = run.startedAt
        ? _formatRelative(run.startedAt, _nowFn())
        : "—";
      const lastEventValue = run.lastEventAt
        ? _formatRelative(run.lastEventAt, _nowFn())
        : "—";
      const rows = [
        _kv("template", run.templateId || "—"),
        _kv("phase", phaseValue),
        _kv("started", startedValue),
        _kv("last event", lastEventValue),
      ];
      for (const [dt, dd] of rows) { dl.appendChild(dt); dl.appendChild(dd); }
      card.appendChild(dl);

      root.appendChild(card);
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
      _formatRelative,
      _statusClass,
      _selectedRun,
    };
  }

  return { create, _formatRelative, _statusClass, _selectedRun };
});
