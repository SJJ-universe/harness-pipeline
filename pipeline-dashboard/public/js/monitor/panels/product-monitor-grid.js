// Slice UI-P1-f (Phase 2 Round 3, 2026-04-30) — monitor grid stub.
//
// Renders the center monitor grid per the reference. UI-P1 ships
// the layout shape (top stat row + Codex live (pro) + subagent tray +
// bottom 2-col grid for tools/critique). Each card body is a
// placeholder with the title only — UI-P5 wires real data.
//
// Mode behavior:
//   - simple: 2-col stat row (Findings + Context); no CodexLive; no Verify
//   - pro:    3-col stat row (+ Verify); CodexLive card visible
//
// This shape matches the reference 1:1 so the visual parity check
// (UI-P9) compares the same DOM structure.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductMonitorGrid = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _card(_doc, title, meta, extraClass) {
    const card = _doc.createElement("div");
    card.className = "prod-card" + (extraClass ? " " + extraClass : "");
    const t = _doc.createElement("div");
    t.className = "prod-card-title";
    const ts = _doc.createElement("span");
    ts.textContent = title;
    t.appendChild(ts);
    if (meta) {
      const m = _doc.createElement("span");
      m.className = "prod-card-title-meta";
      m.textContent = meta;
      t.appendChild(m);
    }
    card.appendChild(t);
    return card;
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductMonitorGrid.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductMonitorGrid.create: root + doc required");

    let mode = opts.mode || "simple";

    const grid = _doc.createElement("div");
    grid.className = "prod-grid";

    // Top stat row
    const statRow = _doc.createElement("div");
    statRow.className = "prod-grid-stat-row";

    const findingsCard = _card(_doc, "발견 사항 · Findings", "5-tier", "prod-card-findings");
    statRow.appendChild(findingsCard);

    const contextCard = _card(_doc, "컨텍스트 · Context", "—%", "prod-card-context");
    statRow.appendChild(contextCard);

    const verifyCard = _card(_doc, "검증 · Verify", null, "prod-card-verify");
    verifyCard.setAttribute("data-pro-only", "true");
    statRow.appendChild(verifyCard);

    grid.appendChild(statRow);

    // Codex live card (pro only)
    const codexLiveCard = _card(_doc, "🤖 Codex 라이브 출력", "—", "prod-card-codex-live");
    codexLiveCard.setAttribute("data-pro-only", "true");
    grid.appendChild(codexLiveCard);

    // Subagent tray
    const subagentCard = _card(_doc, "🤝 서브에이전트 · Subagents", "0", "prod-card-subagents");
    grid.appendChild(subagentCard);

    // Bottom 2-col row — tool feed + critique timeline
    const bottomRow = _doc.createElement("div");
    bottomRow.className = "prod-grid-bottom-row";
    bottomRow.appendChild(_card(_doc, "🔧 툴 호출 · Tool Calls", "0", "prod-card-tools"));
    bottomRow.appendChild(_card(_doc, "💬 Critique 타임라인", "0", "prod-card-critique"));
    grid.appendChild(bottomRow);

    function _applyMode() {
      // Show/hide pro-only sections via CSS attribute selector
      const proOnly = grid.querySelectorAll('[data-pro-only="true"]');
      const display = (mode === "pro") ? "" : "none";
      for (let i = 0; i < proOnly.length; i++) {
        proOnly[i].style.display = display;
      }
    }
    _applyMode();

    root.appendChild(grid);

    return {
      destroy: function () {
        if (grid.parentNode === root) {
          try { root.removeChild(grid); } catch (_) {}
        }
      },
      setMode: function (next) {
        if (next === "simple" || next === "pro") {
          mode = next;
          _applyMode();
        }
      },
      _state: function () {
        return {
          mode,
          cards: ["findings", "context", "verify", "codex-live", "subagents", "tools", "critique"],
        };
      },
    };
  }

  return { create };
});
