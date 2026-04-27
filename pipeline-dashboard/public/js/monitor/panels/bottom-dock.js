// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorBottomDock.
//
// Bottom-dock panel: raw event log. Shows EVERY event in the store ring
// without filtering, monospace, newest-first. Think "devtools console
// for the harness" — operators reach for this when the timeline filter
// is hiding context they want to see.
//
// Spec section 4.1 calls the bottom dock a tabbed surface (Terminal,
// raw event log, replay, debug). MA5 ships only the raw-log tab — the
// terminal already lives in the legacy dashboard, and replay/debug are
// MA6+ work. The dock element is sized + scrollable so future tab
// content can drop in without restructure.
//
// Update lane: cold. Re-renders on every store publish but the row
// budget is small (capped at MAX_DISPLAY=80) and there's no per-row
// listener wiring, so cost stays flat under burst load.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorBottomDock = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const MAX_DISPLAY = 80;

  function _formatTimeMs(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("bottomDock.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("bottomDock.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("bottomDock.create: no document available");
    }

    function _renderRow(env) {
      const row = _doc.createElement("div");
      row.className = "bd-row";

      const ts = _doc.createElement("span");
      ts.className = "bd-ts";
      ts.textContent = _formatTimeMs(env.ts);
      row.appendChild(ts);

      const type = _doc.createElement("span");
      type.className = "bd-type";
      type.textContent = env.type || "(?)";
      row.appendChild(type);

      const runId = _doc.createElement("span");
      runId.className = "bd-runId";
      runId.textContent = env.runId ? "[" + env.runId + "]" : "[—]";
      row.appendChild(runId);

      const summary = _doc.createElement("span");
      summary.className = "bd-summary";
      summary.textContent = env.summary || "";
      row.appendChild(summary);

      return row;
    }

    function render(snapshot) {
      root.innerHTML = "";

      const events = (snapshot && snapshot.events) || [];
      const header = _doc.createElement("div");
      header.className = "bd-header";
      const label = _doc.createElement("span");
      label.className = "bd-tab is-active";
      label.textContent = "raw event log";
      header.appendChild(label);
      const count = _doc.createElement("span");
      count.className = "bd-count";
      count.textContent = String(events.length);
      header.appendChild(count);
      root.appendChild(header);

      if (events.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "bd-empty";
        empty.textContent = "이벤트 없음";
        root.appendChild(empty);
        return;
      }

      // newest-first, capped — render the most recent MAX_DISPLAY entries.
      const display = events.slice(-MAX_DISPLAY).reverse();
      const list = _doc.createElement("div");
      list.className = "bd-list";
      list.setAttribute("role", "log");
      list.setAttribute("aria-label", "Raw event log");
      list.setAttribute("aria-live", "polite");
      for (const env of display) list.appendChild(_renderRow(env));
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
      _formatTimeMs,
      MAX_DISPLAY,
    };
  }

  return { create, _formatTimeMs, MAX_DISPLAY };
});
