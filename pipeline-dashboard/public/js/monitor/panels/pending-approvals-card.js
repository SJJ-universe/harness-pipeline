// Slice UI-H6 (Phase D / Phase E1.5, 2026-04-30) — "승인 필요" card.
//
// Simple-mode card showing the count of pending operator approvals.
// Click → scroll-to / open the approval-card region (UX-2-b).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorPendingApprovalsCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function create({ root, store, doc, onClick } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("pending-approvals-card.create: root must be an element");
    }
    if (!store) throw new Error("pending-approvals-card.create: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("pending-approvals-card.create: no document available");

    let unsubscribe = null;
    let destroyed = false;

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const list = Array.isArray(snap.pendingApprovals) ? snap.pendingApprovals : [];
      const count = list.length;

      root.innerHTML = "";
      root.classList.add("pac-card");
      root.classList.toggle("pac-has-pending", count > 0);
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "승인 필요");

      const title = _doc.createElement("h3");
      title.className = "pac-title";
      title.textContent = "승인 필요";
      root.appendChild(title);

      const countEl = _doc.createElement("div");
      countEl.className = "pac-count";
      countEl.textContent = count === 0 ? "0" : String(count);
      root.appendChild(countEl);

      const meta = _doc.createElement("div");
      meta.className = "pac-meta";
      if (count === 0) {
        meta.textContent = "대기 중인 승인 없음";
      } else {
        const sample = list[0];
        meta.textContent = `${sample.tool}: ${sample.argsSummary}`
          + (count > 1 ? ` (+${count - 1})` : "");
      }
      root.appendChild(meta);

      // Action button: jump to the approval card region.
      if (count > 0) {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "pac-action";
        btn.textContent = "확인하기 →";
        btn.addEventListener("click", () => {
          if (typeof onClick === "function") {
            try { onClick(); } catch (_) { /* defensive */ }
          }
        });
        root.appendChild(btn);
      }
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
        root.classList.remove("pac-card", "pac-has-pending");
      },
      _render: render,
    };
  }

  return { create };
});
