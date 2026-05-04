// Slice UI-P1-f / UI-P2-c (Phase 2 Round 3, 2026-04-30) — monitor grid.
//
// Renders the center monitor grid per the reference. UI-P1 shipped
// the layout shape (top stat row + Codex live + subagent tray +
// bottom 2-col tools/critique). UI-P2 fills each card with structural
// placeholders (5-tier findings grid, gradient bar, dot+label, code
// pre, pill row, mono grid, left/right bubbles) so a screenshot
// matches the reference at first paint.
//
// All values are deliberate placeholders — UI-P5 wires real store
// data per card. Mode behavior:
//   - simple: 2-col stat row (Findings + Context); no CodexLive; no Verify
//   - pro:    3-col stat row (+ Verify); CodexLive card visible

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductMonitorGrid = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _cardShell(_doc, title, meta, extraClass) {
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

  // ── Card body builders (UI-P2 placeholders, UI-P5 swaps to real data) ──

  function _buildFindings(_doc, mode) {
    const card = _cardShell(_doc, "발견 사항 · Findings", mode === "pro" ? "5-tier" : null, "prod-card-findings");
    const grid = _doc.createElement("div");
    grid.className = "prod-findings-grid";
    [
      ["critical", 0],
      ["high", 0],
      ["medium", 0],
      ["low", 0],
      ["note", 0],
    ].forEach(function (entry) {
      const tier = _doc.createElement("div");
      tier.className = "prod-finding-tier";
      tier.setAttribute("data-tier", entry[0]);
      const count = _doc.createElement("div");
      count.className = "prod-finding-count";
      count.setAttribute("data-zero", entry[1] === 0 ? "true" : "false");
      count.textContent = String(entry[1]);
      tier.appendChild(count);
      const label = _doc.createElement("div");
      label.className = "prod-finding-label";
      label.textContent = entry[0];
      tier.appendChild(label);
      grid.appendChild(tier);
    });
    card.appendChild(grid);
    return card;
  }

  function _buildContext(_doc) {
    const card = _cardShell(_doc, "컨텍스트 · Context", "—%", "prod-card-context");
    const bar = _doc.createElement("div");
    bar.className = "prod-context-bar-bg";
    const fill = _doc.createElement("div");
    fill.className = "prod-context-bar-fill";
    fill.style.width = "0%";
    bar.appendChild(fill);
    card.appendChild(bar);
    const meta = _doc.createElement("div");
    meta.className = "prod-context-meta";
    const left = _doc.createElement("span");
    left.textContent = "— / — tokens";
    meta.appendChild(left);
    const right = _doc.createElement("span");
    right.className = "prod-context-meta-secondary";
    right.textContent = "— 잔여";
    meta.appendChild(right);
    card.appendChild(meta);
    return card;
  }

  function _buildVerify(_doc) {
    const card = _cardShell(_doc, "검증 · Verify", null, "prod-card-verify");
    card.setAttribute("data-pro-only", "true");
    const row = _doc.createElement("div");
    row.className = "prod-verify-row";
    const dot = _doc.createElement("span");
    dot.className = "prod-verify-dot";
    dot.setAttribute("data-status", "idle");
    row.appendChild(dot);
    const labels = _doc.createElement("div");
    const primary = _doc.createElement("div");
    primary.className = "prod-verify-label-primary";
    primary.textContent = "—";
    labels.appendChild(primary);
    const secondary = _doc.createElement("div");
    secondary.className = "prod-verify-label-secondary";
    secondary.textContent = "0 of 0 gates";
    labels.appendChild(secondary);
    row.appendChild(labels);
    card.appendChild(row);
    return card;
  }

  function _buildCodexLive(_doc) {
    const card = _cardShell(_doc, "🤖 Codex 라이브 출력", "—", "prod-card-codex-live");
    card.setAttribute("data-pro-only", "true");
    const pre = _doc.createElement("pre");
    pre.className = "prod-codex-live-pre";
    // Placeholder text — UI-P5 replaces with real critique stream chunks.
    const placeholder = _doc.createTextNode("> 실행을 시작하면 Codex 비평이 여기 스트림됩니다.");
    pre.appendChild(placeholder);
    const caret = _doc.createElement("span");
    caret.className = "prod-codex-caret";
    caret.textContent = "▍";
    pre.appendChild(caret);
    card.appendChild(pre);
    return card;
  }

  function _buildSubagents(_doc) {
    const card = _cardShell(_doc, "🤝 서브에이전트 · Subagents", "0", "prod-card-subagents");
    const row = _doc.createElement("div");
    row.className = "prod-subagent-row";
    // UI-P2 leaves the row empty (no live agents in mock state). UI-P5
    // populates from store.subagents. The empty row preserves the
    // card's vertical height so the layout doesn't jump when an agent
    // arrives.
    const empty = _doc.createElement("span");
    empty.style.color = "var(--prod-text-dim-40)";
    empty.style.fontSize = "var(--prod-fs-11)";
    empty.style.fontStyle = "italic";
    empty.textContent = "(예시 — 실행 중 활성 에이전트가 표시됩니다)";
    row.appendChild(empty);
    card.appendChild(row);
    return card;
  }

  function _buildToolFeed(_doc, mode) {
    const card = _cardShell(_doc, "🔧 툴 호출 · Tool Calls", mode === "pro" ? "0" : null, "prod-card-tools");
    const feed = _doc.createElement("div");
    feed.className = "prod-tool-feed";
    // UI-P2 placeholder rows showing the visual shape (one per tool
    // type) so the 5-color tool badge palette renders. Real rows in
    // UI-P5 from event stream.
    [
      ["—:—:—", "Read", "(예시 항목)", "—"],
      ["—:—:—", "Grep", "(예시 항목)", "—"],
      ["—:—:—", "Edit", "(예시 항목)", "—"],
      ["—:—:—", "Bash", "(예시 항목)", "—"],
      ["—:—:—", "Write", "(예시 항목)", "—"],
    ].forEach(function (entry) {
      const row = _doc.createElement("div");
      row.className = "prod-tool-row";
      const time = _doc.createElement("span");
      time.className = "prod-tool-time";
      time.textContent = entry[0];
      row.appendChild(time);
      const tool = _doc.createElement("span");
      tool.className = "prod-tool-name";
      tool.setAttribute("data-tool", entry[1]);
      tool.textContent = entry[1];
      row.appendChild(tool);
      const arg = _doc.createElement("span");
      arg.className = "prod-tool-arg";
      arg.textContent = entry[2];
      row.appendChild(arg);
      const dur = _doc.createElement("span");
      dur.className = "prod-tool-dur";
      dur.textContent = entry[3];
      row.appendChild(dur);
      feed.appendChild(row);
    });
    card.appendChild(feed);
    return card;
  }

  function _buildCritique(_doc) {
    const card = _cardShell(_doc, "💬 Critique 타임라인", "0", "prod-card-critique");
    const stream = _doc.createElement("div");
    stream.className = "prod-critique-stream";
    // UI-P2 placeholder bubbles: 1 left (Codex) + 1 right (Claude) so
    // both color treatments render. UI-P5 replaces with real review-
    // session history.
    [
      { side: "left", actor: "CODEX", time: "—:—:—", text: "(예시 — 실행을 시작하면 비평이 여기 표시됩니다)" },
      { side: "right", actor: "CLAUDE", time: "—:—:—", text: "(예시 — Claude 응답이 오른쪽에 표시됩니다)" },
    ].forEach(function (item) {
      const wrap = _doc.createElement("div");
      wrap.className = "prod-critique-bubble-wrap";
      wrap.setAttribute("data-side", item.side);
      const bubble = _doc.createElement("div");
      bubble.className = "prod-critique-bubble";
      bubble.setAttribute("data-side", item.side);
      const meta = _doc.createElement("div");
      meta.className = "prod-critique-meta";
      const actor = _doc.createElement("span");
      actor.className = "prod-critique-actor";
      actor.textContent = item.actor;
      meta.appendChild(actor);
      const time = _doc.createElement("span");
      time.className = "prod-critique-time";
      time.textContent = item.time;
      meta.appendChild(time);
      bubble.appendChild(meta);
      const text = _doc.createElement("div");
      text.className = "prod-critique-text";
      text.textContent = item.text;
      bubble.appendChild(text);
      wrap.appendChild(bubble);
      stream.appendChild(wrap);
    });
    card.appendChild(stream);
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
    statRow.appendChild(_buildFindings(_doc, mode));
    statRow.appendChild(_buildContext(_doc));
    statRow.appendChild(_buildVerify(_doc));
    grid.appendChild(statRow);

    // Codex live (pro)
    grid.appendChild(_buildCodexLive(_doc));

    // Subagent tray
    grid.appendChild(_buildSubagents(_doc));

    // Bottom 2-col
    const bottomRow = _doc.createElement("div");
    bottomRow.className = "prod-grid-bottom-row";
    bottomRow.appendChild(_buildToolFeed(_doc, mode));
    bottomRow.appendChild(_buildCritique(_doc));
    grid.appendChild(bottomRow);

    function _applyMode() {
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
