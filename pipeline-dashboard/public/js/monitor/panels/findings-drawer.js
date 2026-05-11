// LAYOUT-REORG-PRO-0 (2026-05-08) — findings drawer.
// UX-POLISH-1 (2026-05-11) — added iteration summary section + i18n
// fix (drawer.findings.* keys now resolve to Korean/English instead of
// rendering raw strings) + enriched finding messages (severity + text).
//
// Right-side slide-in drawer that surfaces 4 monitor sections that
// previously lived as standalone cards in the monitor-grid:
//   1. Iteration summary (NEW UX-POLISH-1 — total count + drivers + per-iter timing)
//   2. Findings detail (full list with severity / file / line / message)
//   3. TOOL CALLS timeline
//   4. CRITIQUE timeline
//
// Triggered by clicking the FINDINGS card in the (now smaller)
// monitor-grid. Per user direction, the operator wants these 3
// surfaces accessible-on-demand rather than always-visible cards
// crowding the workspace. The drawer reads from the same store
// selectors the original cards used (selectFindings,
// selectRecentToolCalls, selectCritique) so no data plumbing changes.
//
// Behavior:
//   - mount({ root, store, doc, selectors, t }) → handle
//   - handle.open() — slide in from right, focus close button
//   - handle.close() — slide out, restore prior focus
//   - handle.toggle() — open if closed, close if open
//   - handle.destroy() — unsubscribe from store, remove from DOM
//   - ESC key while open → close
//   - Click on backdrop → close
//   - Backdrop is non-modal: workspace remains visible + readable
//     behind a subtle dim. Drawer width 480px on desktop.
//
// Slot attributes (for tests + visual contract):
//   data-region="findings-drawer"           — root
//   data-drawer-state="open|closed"
//   data-drawer-slot="backdrop|panel|head|body|close|tab"
//   data-drawer-section="findings|tools|critique"

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorFindingsDrawer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _t(t, key, fallback) {
    // UX-POLISH-1 (2026-05-11): OrchestratorI18n.t (public/js/i18n.js)
    // returns the lookup key itself when there's no entry in the
    // active locale table (see i18n.js:61). The drawer used to render
    // that raw key directly (the "drawer.findings.title" bug). Detect
    // the miss + substitute the fallback so the surface never shows
    // a key string in production. If `t` returns a properly resolved
    // string (anything OTHER than the bare key), trust it — the
    // operator may have a custom locale active.
    if (typeof t === "function") {
      try {
        const v = t(key, fallback);
        if (v != null && v !== key) return v;
      } catch (_) { /* fall through to fallback */ }
    }
    return fallback;
  }

  function _emptyFindings() {
    return [
      { severity: "critical", count: 0 },
      { severity: "high",     count: 0 },
      { severity: "medium",   count: 0 },
      { severity: "low",      count: 0 },
      { severity: "note",     count: 0 },
    ];
  }

  function mount(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("OrchestratorFindingsDrawer.mount: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    const store = opts.store || null;
    const selectors = opts.selectors || null;
    const t = opts.t || null;

    if (!root || typeof root.appendChild !== "function") {
      throw new Error("OrchestratorFindingsDrawer.mount: root + doc required");
    }
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("OrchestratorFindingsDrawer.mount: doc required");
    }

    const drawer = _doc.createElement("div");
    drawer.className = "prod-findings-drawer";
    drawer.setAttribute("data-region", "findings-drawer");
    drawer.setAttribute("data-drawer-state", "closed");

    // Backdrop — clickable to close, semi-transparent overlay.
    const backdrop = _doc.createElement("div");
    backdrop.className = "prod-findings-drawer-backdrop";
    backdrop.setAttribute("data-drawer-slot", "backdrop");
    drawer.appendChild(backdrop);

    // Panel — slides in from right.
    const panel = _doc.createElement("div");
    panel.className = "prod-findings-drawer-panel";
    panel.setAttribute("data-drawer-slot", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "false");
    panel.setAttribute("aria-label",
      _t(t, "drawer.findings.aria", "Findings + tool calls + critique drawer"));

    // Head — title + close button.
    const head = _doc.createElement("div");
    head.className = "prod-findings-drawer-head";
    head.setAttribute("data-drawer-slot", "head");
    const title = _doc.createElement("h2");
    title.className = "prod-findings-drawer-title";
    title.textContent = _t(t, "drawer.findings.title", "발견 사항 · 도구 호출 · 비평");
    head.appendChild(title);
    const closeBtn = _doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "prod-findings-drawer-close";
    closeBtn.setAttribute("data-drawer-slot", "close");
    closeBtn.setAttribute("aria-label", _t(t, "drawer.findings.close", "닫기"));
    closeBtn.textContent = "✕";
    head.appendChild(closeBtn);
    panel.appendChild(head);

    // Body — 3 sections stacked.
    const body = _doc.createElement("div");
    body.className = "prod-findings-drawer-body";
    body.setAttribute("data-drawer-slot", "body");

    function _section(id, label) {
      const s = _doc.createElement("section");
      s.className = "prod-findings-drawer-section";
      s.setAttribute("data-drawer-section", id);
      const h = _doc.createElement("h3");
      h.className = "prod-findings-drawer-section-title";
      h.textContent = label;
      s.appendChild(h);
      const c = _doc.createElement("div");
      c.className = "prod-findings-drawer-section-content";
      s.appendChild(c);
      return { section: s, content: c };
    }

    // UX-POLISH-1 (2026-05-11): iteration section mounts FIRST so the
    // operator sees "어떤 작업을 몇 번 진행했는지" + "어떤 CRITICAL/HIGH
    // 가 비평 반복을 유발했는지" before scrolling into the raw lists.
    const iterationsSec = _section("iterations", _t(t, "drawer.findings.section.iterations", "비평 반복"));
    const findingsSec   = _section("findings",   _t(t, "drawer.findings.section.findings",   "발견 사항"));
    const toolsSec      = _section("tools",      _t(t, "drawer.findings.section.tools",      "도구 호출"));
    const critiqueSec   = _section("critique",   _t(t, "drawer.findings.section.critique",   "비평 타임라인"));

    body.appendChild(iterationsSec.section);
    body.appendChild(findingsSec.section);
    body.appendChild(toolsSec.section);
    body.appendChild(critiqueSec.section);

    panel.appendChild(body);
    drawer.appendChild(panel);
    root.appendChild(drawer);

    // ── State + listeners ──────────────────────────────────────────

    let isOpen = false;
    let priorFocus = null;
    let unsubscribe = null;
    let escListener = null;

    // UX-POLISH-1 (2026-05-11): iteration summary renderer.
    // Inputs come from selectIterationSummary(snap, runId):
    //   { iterations, drivers: [...], timeline: [...] }
    // Falls back to a friendly "아직 비평 반복이 없습니다." when empty.
    function _renderIterations(summary) {
      const c = iterationsSec.content;
      while (c.firstChild) c.removeChild(c.firstChild);
      if (!summary || (!summary.iterations && (!summary.drivers || summary.drivers.length === 0))) {
        const empty = _doc.createElement("p");
        empty.className = "prod-findings-drawer-empty";
        empty.textContent = _t(t, "drawer.findings.empty.iterations", "아직 비평 반복이 없습니다.");
        c.appendChild(empty);
        return;
      }
      // 1) Total iteration count line.
      const totalRow = _doc.createElement("div");
      totalRow.className = "prod-findings-drawer-iter-total";
      const totalLabel = _doc.createElement("span");
      totalLabel.className = "prod-findings-drawer-iter-label";
      totalLabel.textContent = _t(t, "drawer.findings.iteration.totalLabel", "총 진행:");
      const totalValue = _doc.createElement("span");
      totalValue.className = "prod-findings-drawer-iter-value";
      totalValue.textContent = _t(t, "drawer.findings.iteration.totalValue", "{n}번")
        .replace("{n}", String(summary.iterations || 0));
      totalRow.appendChild(totalLabel);
      totalRow.appendChild(totalValue);
      c.appendChild(totalRow);
      // 2) Drivers — what severity tiers triggered re-critique?
      if (summary.drivers && summary.drivers.length > 0) {
        const dh = _doc.createElement("h4");
        dh.className = "prod-findings-drawer-iter-subhead";
        dh.textContent = _t(t, "drawer.findings.iteration.driverHeader", "재진입 사유");
        c.appendChild(dh);
        const dlist = _doc.createElement("ul");
        dlist.className = "prod-findings-drawer-iter-drivers";
        for (const d of summary.drivers) {
          const li = _doc.createElement("li");
          li.className = "prod-findings-drawer-iter-driver";
          li.setAttribute("data-severity", d.severity || "note");
          const head = _doc.createElement("span");
          head.className = "prod-findings-drawer-iter-driver-head";
          head.textContent = _t(t, "drawer.findings.iteration.driverItem", "{sev} × {n}")
            .replace("{sev}", String(d.severity || "").toUpperCase())
            .replace("{n}", String(d.count || 0));
          li.appendChild(head);
          if (d.sampleMessage) {
            const msg = _doc.createElement("span");
            msg.className = "prod-findings-drawer-iter-driver-msg";
            msg.textContent = " — " + d.sampleMessage;
            li.appendChild(msg);
          }
          dlist.appendChild(li);
        }
        c.appendChild(dlist);
      }
      // 3) Per-iteration duration timeline.
      if (summary.timeline && summary.timeline.length > 0) {
        const th = _doc.createElement("h4");
        th.className = "prod-findings-drawer-iter-subhead";
        th.textContent = _t(t, "drawer.findings.iteration.timelineHeader", "단계별 소요");
        c.appendChild(th);
        const tlist = _doc.createElement("ol");
        tlist.className = "prod-findings-drawer-iter-timeline";
        for (const e of summary.timeline) {
          const li = _doc.createElement("li");
          li.className = "prod-findings-drawer-iter-timeline-row";
          li.setAttribute("data-status", e.status || "done");
          if (e.status === "active") {
            li.textContent = _t(t, "drawer.findings.iteration.timelineActive", "{n}번 비평 — 진행 중")
              .replace("{n}", String(e.n || 0));
          } else {
            const sec = (typeof e.durationMs === "number")
              ? (Math.round(e.durationMs / 100) / 10).toFixed(1)
              : "—";
            li.textContent = _t(t, "drawer.findings.iteration.timelineItem", "{n}번 비평 — {sec}초")
              .replace("{n}", String(e.n || 0))
              .replace("{sec}", sec);
          }
          tlist.appendChild(li);
        }
        c.appendChild(tlist);
      }
    }

    function _renderFindings(arr) {
      const c = findingsSec.content;
      while (c.firstChild) c.removeChild(c.firstChild);
      const data = (Array.isArray(arr) && arr.length > 0) ? arr : _emptyFindings();
      const ul = _doc.createElement("ul");
      ul.className = "prod-findings-drawer-list";
      let totalCount = 0;
      for (const f of data) {
        const li = _doc.createElement("li");
        li.className = "prod-findings-drawer-finding";
        li.setAttribute("data-severity", f.severity || "note");
        const sev = _doc.createElement("span");
        sev.className = "prod-findings-drawer-finding-sev";
        sev.textContent = String(f.severity || "note").toUpperCase();
        li.appendChild(sev);
        const msg = _doc.createElement("span");
        msg.className = "prod-findings-drawer-finding-msg";
        if (typeof f.count === "number") {
          msg.textContent = String(f.count);
        } else {
          msg.textContent = String(f.message || f.label || "");
        }
        li.appendChild(msg);
        if (f.file) {
          const loc = _doc.createElement("span");
          loc.className = "prod-findings-drawer-finding-loc";
          loc.textContent = f.file + (f.line ? ":" + f.line : "");
          li.appendChild(loc);
        }
        ul.appendChild(li);
        if (typeof f.count === "number") totalCount += f.count;
      }
      c.appendChild(ul);
      if (totalCount === 0 && data === _emptyFindings()) {
        const empty = _doc.createElement("p");
        empty.className = "prod-findings-drawer-empty";
        empty.textContent = _t(t, "drawer.findings.empty.findings", "발견된 사항이 없습니다.");
        c.appendChild(empty);
      }
    }

    function _renderTools(arr) {
      const c = toolsSec.content;
      while (c.firstChild) c.removeChild(c.firstChild);
      const data = Array.isArray(arr) ? arr : [];
      if (data.length === 0) {
        const empty = _doc.createElement("p");
        empty.className = "prod-findings-drawer-empty";
        empty.textContent = _t(t, "drawer.findings.empty.tools", "도구 호출 기록이 없습니다.");
        c.appendChild(empty);
        return;
      }
      const ol = _doc.createElement("ol");
      ol.className = "prod-findings-drawer-list";
      for (const tc of data) {
        const li = _doc.createElement("li");
        li.className = "prod-findings-drawer-tool";
        const tool = _doc.createElement("span");
        tool.className = "prod-findings-drawer-tool-name";
        tool.textContent = tc.tool || tc.name || "(unknown)";
        li.appendChild(tool);
        if (tc.phase) {
          const phase = _doc.createElement("span");
          phase.className = "prod-findings-drawer-tool-phase";
          phase.textContent = "[" + tc.phase + "]";
          li.appendChild(phase);
        }
        if (tc.summary || tc.message) {
          const sum = _doc.createElement("span");
          sum.className = "prod-findings-drawer-tool-sum";
          sum.textContent = tc.summary || tc.message;
          li.appendChild(sum);
        }
        ol.appendChild(li);
      }
      c.appendChild(ol);
    }

    function _renderCritique(arr) {
      const c = critiqueSec.content;
      while (c.firstChild) c.removeChild(c.firstChild);
      const data = Array.isArray(arr) ? arr : [];
      if (data.length === 0) {
        const empty = _doc.createElement("p");
        empty.className = "prod-findings-drawer-empty";
        empty.textContent = _t(t, "drawer.findings.empty.critique", "비평 타임라인이 비어 있습니다.");
        c.appendChild(empty);
        return;
      }
      const ol = _doc.createElement("ol");
      ol.className = "prod-findings-drawer-list";
      for (const ent of data) {
        const li = _doc.createElement("li");
        li.className = "prod-findings-drawer-critique";
        if (ent.severity) {
          li.setAttribute("data-severity", ent.severity);
          const sev = _doc.createElement("span");
          sev.className = "prod-findings-drawer-finding-sev";
          sev.textContent = String(ent.severity).toUpperCase();
          li.appendChild(sev);
        }
        const msg = _doc.createElement("span");
        msg.className = "prod-findings-drawer-critique-msg";
        msg.textContent = ent.message || ent.summary || ent.text || "";
        li.appendChild(msg);
        ol.appendChild(li);
      }
      c.appendChild(ol);
    }

    function _refresh() {
      let snap;
      try { snap = store && store.snapshot(); } catch (_) { return; }
      if (!snap) {
        _renderIterations(null);
        _renderFindings(null);
        _renderTools([]);
        _renderCritique([]);
        return;
      }
      const runId = selectors && typeof selectors.selectActiveRunId === "function"
        ? selectors.selectActiveRunId(snap) : null;
      // UX-POLISH-1: iteration summary feeds the new top section.
      const iterations = selectors && selectors.selectIterationSummary
        && selectors.selectIterationSummary(snap, runId);
      const findings   = selectors && selectors.selectFindings        && selectors.selectFindings(snap, runId);
      const tools      = selectors && selectors.selectRecentToolCalls && selectors.selectRecentToolCalls(snap, runId, 30);
      const critique   = selectors && selectors.selectCritique        && selectors.selectCritique(snap, runId);
      _renderIterations(iterations);
      _renderFindings(findings);
      _renderTools(tools);
      _renderCritique(critique);
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      drawer.setAttribute("data-drawer-state", "open");
      _refresh();
      try { priorFocus = _doc.activeElement; } catch (_) { priorFocus = null; }
      try { closeBtn.focus(); } catch (_) { /* defensive */ }
      // Subscribe to store for live updates while open.
      if (store && typeof store.subscribe === "function" && !unsubscribe) {
        try { unsubscribe = store.subscribe(_refresh); }
        catch (_) { /* defensive */ }
      }
      // ESC key listener
      if (_doc && typeof _doc.addEventListener === "function" && !escListener) {
        escListener = function (e) {
          if (e && (e.key === "Escape" || e.keyCode === 27)) close();
        };
        try { _doc.addEventListener("keydown", escListener); } catch (_) {}
      }
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      drawer.setAttribute("data-drawer-state", "closed");
      // Unsubscribe — drawer is closed, no need to re-render on every event.
      if (typeof unsubscribe === "function") {
        try { unsubscribe(); } catch (_) {}
        unsubscribe = null;
      }
      if (escListener && _doc && typeof _doc.removeEventListener === "function") {
        try { _doc.removeEventListener("keydown", escListener); } catch (_) {}
        escListener = null;
      }
      // Restore focus to whichever element had it before open()
      if (priorFocus && typeof priorFocus.focus === "function") {
        try { priorFocus.focus(); } catch (_) {}
      }
      priorFocus = null;
    }

    function toggle() { if (isOpen) close(); else open(); }

    function destroy() {
      close();
      if (drawer.parentNode === root) {
        try { root.removeChild(drawer); } catch (_) {}
      }
    }

    // Wire up close interactions.
    if (typeof closeBtn.addEventListener === "function") {
      closeBtn.addEventListener("click", function () { close(); });
    }
    if (typeof backdrop.addEventListener === "function") {
      backdrop.addEventListener("click", function () { close(); });
    }

    // Initial render so opening is instant (no flicker).
    _renderIterations(null);
    _renderFindings(null);
    _renderTools([]);
    _renderCritique([]);

    return {
      open, close, toggle, destroy,
      // Test hooks
      _root: drawer,
      _isOpen: function () { return isOpen; },
      _refresh,
    };
  }

  return { mount };
});
