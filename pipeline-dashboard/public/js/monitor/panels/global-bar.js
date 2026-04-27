// Slice MA3 (Phase D, 2026-04-27) — HarnessMonitorGlobalBar.
//
// First panel of the monitor shell. Renders process / orchestrator / child
// summary cells from a HarnessMonitorStore snapshot, re-renders on every
// store update, and exposes a Close button that calls back to the layout
// to hide the shell.
//
// The panel:
//   - Reads ONLY from the store (no window.* access). Tests can drive it
//     with a stub store + a stub doc.
//   - Performs full re-render on every snapshot. The global bar is small
//     (5–6 cells) so a full repaint stays cheap; later MA4/MA5 panels with
//     longer lists will switch to incremental render.
//   - Belongs to the hot lane (spec section 5.4): always rendered live.
//
// Cells (all read from the snapshot):
//   - server      — pid + boot time tooltip
//   - uptime      — formatted "Xh Ym" / "Xm Ys" / "Xs"
//   - runs        — active / total ; selectedRunId in tooltip
//   - children    — count from activeChildren ; tone:warn when > 0
//   - critical    — only shown when counters.critical > 0 ; tone:error
//
// Close button calls onClose() so the layout decides what "close" means
// (this slice: just hide the shell; future slices may persist the choice).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorGlobalBar = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _formatUptime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const s = Math.floor(seconds);
    if (s < 60) return s + "s";
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r === 0 ? m + "m" : m + "m " + r + "s";
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? h + "h" : h + "h " + m + "m";
  }

  function _activeRunCount(snapshot) {
    if (!snapshot || !snapshot.runs) return 0;
    let n = 0;
    for (const id of Object.keys(snapshot.runs)) {
      const r = snapshot.runs[id];
      if (r && r.status === "active") n++;
    }
    return n;
  }

  function create({ root, store, onClose, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("globalBar.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("globalBar.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("globalBar.create: no document available");
    }

    function _cell(label, value, opts) {
      const cell = _doc.createElement("span");
      cell.className = "gb-cell";
      const labelEl = _doc.createElement("span");
      labelEl.className = "gb-cell-label";
      labelEl.textContent = label;
      const valueEl = _doc.createElement("span");
      valueEl.className = "gb-cell-value" + (opts && opts.tone ? " is-" + opts.tone : "");
      valueEl.textContent = value;
      if (opts && opts.title) cell.setAttribute("title", String(opts.title));
      cell.appendChild(labelEl);
      cell.appendChild(valueEl);
      return cell;
    }

    function render(snapshot) {
      // Full repaint — the bar is small enough that the savings from
      // diffing aren't worth the complexity at this slice.
      root.innerHTML = "";

      const server = (snapshot && snapshot.server) || {};
      const activeRuns = _activeRunCount(snapshot);
      const totalRuns = (snapshot && snapshot.runIds && snapshot.runIds.length) || 0;
      const activeChildren = (snapshot && snapshot.activeChildren && snapshot.activeChildren.length) || 0;
      const critical = (snapshot && snapshot.counters && snapshot.counters.critical) || 0;

      root.appendChild(_cell(
        "server",
        server.pid != null ? "pid " + server.pid : "—",
        { title: server.bootTime ? "boot " + server.bootTime : null }
      ));
      root.appendChild(_cell("uptime", _formatUptime(server.uptime)));
      root.appendChild(_cell(
        "runs",
        activeRuns + " / " + totalRuns,
        { title: snapshot && snapshot.selectedRunId ? "selected: " + snapshot.selectedRunId : "no selection" }
      ));
      root.appendChild(_cell(
        "children",
        String(activeChildren),
        { tone: activeChildren > 0 ? "warn" : null }
      ));
      if (critical > 0) {
        root.appendChild(_cell("critical", String(critical), { tone: "error" }));
      }

      const actions = _doc.createElement("span");
      actions.className = "gb-actions";
      const closeBtn = _doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "gb-btn";
      closeBtn.textContent = "닫기";
      closeBtn.setAttribute("aria-label", "Close monitor shell");
      closeBtn.addEventListener("click", () => {
        if (typeof onClose === "function") {
          try { onClose(); } catch (_) { /* never let user callback abort the panel */ }
        }
      });
      actions.appendChild(closeBtn);
      root.appendChild(actions);
    }

    // Initial render + subscription.
    render(store.snapshot());
    const off = store.subscribe(render);

    return {
      destroy() {
        try { off(); } catch (_) {}
        root.innerHTML = "";
      },
      // Test hooks — prefixed with _ to mark "non-public".
      _render: render,
      _formatUptime,
      _activeRunCount,
    };
  }

  return { create, _formatUptime, _activeRunCount };
});
