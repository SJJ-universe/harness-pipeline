// Slice UI-H3 (Phase D / Phase E1.5, 2026-04-30) — Dual Agent Console.
//
// Read-only stream viewer split into Left (Claude) and Right (Codex)
// terminal-styled panels. Per UI Plan §UX-H3:
//
//   왼쪽: Claude Code 작업/수정 스트림
//   오른쪽: Codex 비평/검증 스트림
//   하단: 사용자의 follow-up 입력
//   버튼: Codex에 비평 요청, 추가 질문, Claude에 수정 요청
//
// **Read-only first.** This slice (UI-H3) renders the stream view
// only. UI-H4 adds the structured-action input row (review-relay
// backend). The dual console is NEVER a real PTY — operator input
// flows through the relay backend as typed actions, NOT raw stdin.
//
// Tabs (per UI Plan §UX-H3):
//   Left:  Claude / Bash (Bash hidden in public-sector mode)
//   Right: Codex  / Verifier
//   Plus per-pane: Audit (read-only audit chain feed)
//
// First cut shows Claude + Codex tabs. Verifier + Audit + Bash
// tabs are placeholder buttons; UI-H4/H5 wires them.
//
// Auto-scroll behavior matches the bottom-dock raw-log: sticky-bottom
// unless the operator scrolls up; resumes on scroll-to-bottom.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorDualAgentConsole = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Prefer require (test path); fall back to window global (browser).
  function _resolveFilters() {
    try { return require("../event-filters"); } catch (_) { /* no-op */ }
    if (typeof window !== "undefined" && window.HarnessMonitorEventFilters) {
      return window.HarnessMonitorEventFilters;
    }
    return null;
  }

  const TAIL_LINES = 200;  // last N lines per pane

  function create({ root, store, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("dual-agent-console.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("dual-agent-console.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("dual-agent-console.create: no document available");
    }
    const filters = _resolveFilters();
    if (!filters) {
      throw new Error("dual-agent-console.create: HarnessMonitorEventFilters unavailable");
    }

    // Pane state — which tab is active per pane. Defaults: Claude on
    // left, Codex on right (matches the mockup).
    let activeLeft = "claude";
    let activeRight = "codex";
    let unsubscribe = null;
    let destroyed = false;

    function _renderTabs(side, tabs, active, onSelect) {
      const tabsRoot = _doc.createElement("div");
      tabsRoot.className = "dac-tabs dac-tabs-" + side;
      tabsRoot.setAttribute("role", "tablist");

      for (const tab of tabs) {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "dac-tab" + (tab.id === active ? " is-active" : "");
        btn.setAttribute("data-tab-id", tab.id);
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", tab.id === active ? "true" : "false");
        if (tab.disabled) {
          btn.disabled = true;
          btn.classList.add("is-disabled");
        }
        btn.textContent = tab.label;
        btn.addEventListener("click", () => onSelect(tab.id));
        tabsRoot.appendChild(btn);
      }
      return tabsRoot;
    }

    function _renderPane(side, label, accent, lines) {
      const pane = _doc.createElement("div");
      pane.className = "dac-pane dac-pane-" + side;
      pane.setAttribute("data-side", side);
      pane.setAttribute("data-actor", label);

      const header = _doc.createElement("div");
      header.className = "dac-pane-header";
      const title = _doc.createElement("span");
      title.className = "dac-pane-title";
      title.textContent = label;
      header.appendChild(title);
      pane.appendChild(header);

      const body = _doc.createElement("div");
      body.className = "dac-pane-body";
      body.setAttribute("role", "log");
      body.setAttribute("aria-live", "polite");
      body.setAttribute("aria-label", label + " stream output");

      if (lines.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "dac-empty";
        empty.textContent = "(no stream yet)";
        body.appendChild(empty);
      } else {
        for (const env of lines) {
          const line = _doc.createElement("div");
          line.className = "dac-line";
          line.setAttribute("data-event-type", env.type || "");
          if (env.ts) {
            const ts = _doc.createElement("span");
            ts.className = "dac-line-ts";
            ts.textContent = _formatTs(env.ts);
            line.appendChild(ts);
          }
          const text = _doc.createElement("span");
          text.className = "dac-line-text";
          text.textContent = filters.envelopeToLine(env);
          line.appendChild(text);
          body.appendChild(line);
        }
      }
      pane.appendChild(body);
      return pane;
    }

    function _formatTs(ts) {
      if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
      try {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      } catch (_) { return ""; }
    }

    function _tabsFor(side) {
      // First-cut tab set per pane. UI-H4 adds Verifier + Audit
      // wiring; UI-H5 hides Bash in public-sector mode.
      if (side === "left") {
        return [
          { id: "claude",   label: "Claude" },
          { id: "audit",    label: "Audit",    disabled: true },
        ];
      }
      return [
        { id: "codex",    label: "Codex" },
        { id: "verifier", label: "Verifier", disabled: true },
        { id: "audit",    label: "Audit",    disabled: true },
      ];
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const events = Array.isArray(snap.events) ? snap.events : [];

      // Filter: left pane shows whichever tab is active.
      const leftLabel = activeLeft === "claude" ? "claude" : activeLeft;
      const rightLabel = activeRight === "codex" ? "codex" : activeRight;
      const leftLines = filters.tailEvents(
        filters.filterEventsByLabel(events, leftLabel),
        TAIL_LINES,
      );
      const rightLines = filters.tailEvents(
        filters.filterEventsByLabel(events, rightLabel),
        TAIL_LINES,
      );

      root.innerHTML = "";
      root.classList.add("dual-agent-console");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Dual agent console");

      // Container — left + right grid
      const grid = _doc.createElement("div");
      grid.className = "dac-grid";

      const leftCol = _doc.createElement("div");
      leftCol.className = "dac-col dac-col-left";
      leftCol.appendChild(_renderTabs("left", _tabsFor("left"), activeLeft, (id) => {
        if (id !== activeLeft) {
          activeLeft = id;
          render();
        }
      }));
      leftCol.appendChild(_renderPane("left", _labelFor(activeLeft), "claude", leftLines));

      const rightCol = _doc.createElement("div");
      rightCol.className = "dac-col dac-col-right";
      rightCol.appendChild(_renderTabs("right", _tabsFor("right"), activeRight, (id) => {
        if (id !== activeRight) {
          activeRight = id;
          render();
        }
      }));
      rightCol.appendChild(_renderPane("right", _labelFor(activeRight), "codex", rightLines));

      grid.appendChild(leftCol);
      grid.appendChild(rightCol);
      root.appendChild(grid);

      // Footer note: read-only first, UI-H4 will add the structured
      // action input row.
      const footer = _doc.createElement("div");
      footer.className = "dac-footer";
      footer.textContent = "📺 Read-only stream view. Actions land via UI-H4 review relay.";
      root.appendChild(footer);
    }

    function _labelFor(tabId) {
      const labels = {
        claude:   "Claude · Plan & Execute",
        codex:    "Codex · Critique Stream",
        verifier: "Verifier · Test Output",
        audit:    "Audit · Chain Feed",
      };
      return labels[tabId] || tabId;
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("dual-agent-console");
      },
      // Test hooks
      _selectLeft(tabId) { activeLeft = tabId; render(); },
      _selectRight(tabId) { activeRight = tabId; render(); },
      _state() { return { activeLeft, activeRight }; },
    };
  }

  return { create };
});
