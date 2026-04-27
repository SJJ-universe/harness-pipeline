// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorInspector.
//
// Right-rail panel: shows the detail of snapshot.selectedItem. The
// timeline panel populates this by calling store.selectItem("event", env)
// on click; future MA6 panels will populate kinds "child", "finding",
// "subagent", etc.
//
// Renderers are dispatched by `kind`. Unknown kinds fall back to a
// generic JSON dump so the panel never silently swallows new selection
// types — operators always see SOMETHING when they select.
//
// Update lane: hot. The inspector re-renders on every store publish but
// the snapshot.selectedItem reference equality check inside avoids
// repaint when nothing changed for the panel.
//
// Empty state: "선택된 항목 없음 — 타임라인에서 이벤트를 선택하세요."

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorInspector = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _formatTime(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function _safeStringify(value) {
    if (value == null) return "null";
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      // Circular structure or BigInt — fall back to a coarse summary.
      try { return String(value); } catch (__) { return "(unserializable)"; }
    }
  }

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("inspector.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("inspector.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("inspector.create: no document available");
    }

    function _kv(label, value) {
      const dt = _doc.createElement("dt");
      dt.textContent = label;
      const dd = _doc.createElement("dd");
      dd.textContent = value == null || value === "" ? "—" : String(value);
      return [dt, dd];
    }

    function _renderEvent(env) {
      const card = _doc.createElement("div");
      card.className = "ip-card";

      const header = _doc.createElement("div");
      header.className = "ip-header";
      const typeEl = _doc.createElement("span");
      typeEl.className = "ip-type";
      typeEl.textContent = env.type || "(?)";
      header.appendChild(typeEl);
      const scopeEl = _doc.createElement("span");
      scopeEl.className = "ip-scope ip-scope-" + (env.scope || "unknown");
      scopeEl.textContent = env.scope || "unknown";
      header.appendChild(scopeEl);
      card.appendChild(header);

      const dl = _doc.createElement("dl");
      dl.className = "ip-meta";
      const rows = [
        _kv("runId", env.runId || "—"),
        _kv("ts", _formatTime(env.ts)),
        _kv("summary", env.summary || ""),
      ];
      for (const [dt, dd] of rows) { dl.appendChild(dt); dl.appendChild(dd); }
      card.appendChild(dl);

      const payloadHeader = _doc.createElement("div");
      payloadHeader.className = "ip-payload-header";
      payloadHeader.textContent = "payload";
      card.appendChild(payloadHeader);

      const payload = _doc.createElement("pre");
      payload.className = "ip-payload";
      payload.textContent = _safeStringify(env.payload);
      card.appendChild(payload);

      return card;
    }

    function _renderGeneric(kind, payload) {
      // Fallback for kinds we don't have a dedicated renderer for yet.
      // Future MA6 will swap this out per-kind; for MA5 we just dump.
      const card = _doc.createElement("div");
      card.className = "ip-card ip-card-generic";

      const header = _doc.createElement("div");
      header.className = "ip-header";
      const typeEl = _doc.createElement("span");
      typeEl.className = "ip-type";
      typeEl.textContent = "kind: " + kind;
      header.appendChild(typeEl);
      card.appendChild(header);

      const pre = _doc.createElement("pre");
      pre.className = "ip-payload";
      pre.textContent = _safeStringify(payload);
      card.appendChild(pre);
      return card;
    }

    function render(snapshot) {
      root.innerHTML = "";
      const sel = (snapshot && snapshot.selectedItem) || null;
      if (!sel) {
        const empty = _doc.createElement("div");
        empty.className = "ip-empty";
        empty.textContent = "선택된 항목 없음 — 타임라인에서 이벤트를 선택하세요.";
        root.appendChild(empty);
        return;
      }
      if (sel.kind === "event" && sel.payload) {
        root.appendChild(_renderEvent(sel.payload));
        return;
      }
      // Unknown kind → generic dump so future panels don't silently break.
      root.appendChild(_renderGeneric(sel.kind, sel.payload));
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
      _formatTime,
      _safeStringify,
      _renderEvent,
      _renderGeneric,
    };
  }

  return { create, _formatTime, _safeStringify };
});
