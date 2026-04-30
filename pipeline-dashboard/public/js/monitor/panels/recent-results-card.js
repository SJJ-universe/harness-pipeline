// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — "최근 결과" card.
//
// Simple-mode card showing the last 3 completed runs with verify
// result + timestamp. Reads snapshot.runs sorted by completedAt desc.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorRecentResultsCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const MAX_ROWS = 3;

  function _formatTime(ts) {
    if (typeof ts !== "number") return "";
    try {
      const d = new Date(ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch (_) { return ""; }
  }

  function create({ root, store, doc, onSelectRun } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("recent-results-card.create: root must be an element");
    }
    if (!store) throw new Error("recent-results-card.create: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("recent-results-card.create: no document available");

    let unsubscribe = null;
    let destroyed = false;

    function _completedRuns(snap) {
      const runs = (snap && snap.runs) || {};
      const out = [];
      for (const id of Object.keys(runs)) {
        const r = runs[id];
        if (r && r.status === "completed") out.push(r);
      }
      out.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      return out.slice(0, MAX_ROWS);
    }

    function _verifyTone(detail) {
      if (!detail) return null;
      if (detail.verifyStatus === "pass") return "ok";
      if (detail.verifyStatus === "fail") return "error";
      return null;
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const runs = _completedRuns(snap);

      root.innerHTML = "";
      root.classList.add("rrc-card");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "최근 결과");

      const title = _doc.createElement("h3");
      title.className = "rrc-title";
      title.textContent = "최근 결과";
      root.appendChild(title);

      if (runs.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "rrc-empty";
        empty.textContent = "최근 완료된 작업이 없습니다";
        root.appendChild(empty);
        return;
      }

      const list = _doc.createElement("ul");
      list.className = "rrc-list";
      list.setAttribute("role", "list");

      for (const run of runs) {
        const li = _doc.createElement("li");
        li.className = "rrc-row";
        li.setAttribute("data-run-id", run.id);

        const detail = (snap.runDetails || {})[run.id] || null;
        const tone = _verifyTone(detail);

        const statusDot = _doc.createElement("span");
        statusDot.className = "rrc-dot rrc-dot-" + (tone || "neutral");
        li.appendChild(statusDot);

        const label = _doc.createElement("span");
        label.className = "rrc-label";
        label.textContent = run.label || run.templateId || run.id;
        li.appendChild(label);

        const meta = _doc.createElement("span");
        meta.className = "rrc-meta";
        const timeStr = _formatTime(run.completedAt);
        const verifyStr = detail && detail.verifyStatus
          ? (detail.verifyStatus === "pass" ? "✓" : "✗")
          : "·";
        meta.textContent = `${verifyStr} ${timeStr}`;
        li.appendChild(meta);

        // Slice UI-H9-c (2026-04-30): row click → run-viewer drill-down.
        if (typeof onSelectRun === "function") {
          li.classList.add("rrc-row-clickable");
          li.setAttribute("role", "button");
          li.setAttribute("tabindex", "0");
          const fire = () => {
            try { onSelectRun(run.id); } catch (_) { /* defensive */ }
          };
          li.addEventListener("click", fire);
          li.addEventListener("keydown", (ev) => {
            if (!ev) return;
            const key = ev.key || ev.code;
            if (key === "Enter" || key === " " || key === "Space" || key === "Spacebar") {
              if (typeof ev.preventDefault === "function") ev.preventDefault();
              fire();
            }
          });
        }

        list.appendChild(li);
      }
      root.appendChild(list);
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") unsubscribe();
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("rrc-card");
      },
      _render: render,
    };
  }

  return { create };
});
