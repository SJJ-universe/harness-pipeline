// Slice UI-P1-f (Phase 2 Round 3, 2026-04-30) — dual terminals stub.
//
// Renders the bottom 280px dual-terminal strip per the reference.
// UI-P1 ships the tab bar + empty terminal bodies. UI-P6 wires real
// Claude/Codex/Bash/Verifier streams from the review-session manager
// + bash session.
//
// Reference layout:
//   ┌──────────────────────────────┬─────────────────────────────┐
//   │ [● Claude] [● Bash]   [auto] │ [● Codex] [● Verifier] [..] │
//   ├──────────────────────────────┼─────────────────────────────┤
//   │  body (claude lines)         │  body (codex lines)         │
//   │  ◇ ▍                         │  ◈ ▍                        │
//   └──────────────────────────────┴─────────────────────────────┘
//
// Mode behavior:
//   - simple: no per-line timestamps (fits more lines visually)
//   - pro:    timestamps on every line

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductDualTerminals = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const TABS_LEFT = Object.freeze([
    { id: "claude",   label: "Claude",   actor: "claude" },
    { id: "bash",     label: "Bash",     actor: "claude" },
  ]);
  const TABS_RIGHT = Object.freeze([
    { id: "codex",    label: "Codex",    actor: "codex" },
    { id: "verifier", label: "Verifier", actor: "codex" },
  ]);

  function _terminal(_doc, side, tabs, defaultTab) {
    const term = _doc.createElement("div");
    term.className = "prod-terminal";
    term.setAttribute("data-side", side);

    let activeTab = defaultTab;

    const tabBar = _doc.createElement("div");
    tabBar.className = "prod-terminal-tabs";
    const tabButtons = {};
    tabs.forEach(function (tab) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "prod-terminal-tab";
      btn.setAttribute("data-actor", tab.actor);
      btn.setAttribute("data-tab", tab.id);
      btn.setAttribute("aria-selected", tab.id === activeTab ? "true" : "false");
      btn.setAttribute("role", "tab");
      const dot = _doc.createElement("span");
      dot.className = "prod-terminal-tab-dot";
      btn.appendChild(dot);
      btn.appendChild(_doc.createTextNode(tab.label));
      btn.addEventListener("click", function () {
        if (tab.id === activeTab) return;
        activeTab = tab.id;
        Object.keys(tabButtons).forEach(function (k) {
          tabButtons[k].setAttribute("aria-selected", k === activeTab ? "true" : "false");
        });
        // UI-P1: stub body just shows "(empty: <tab name> stream)".
        // UI-P6 wires real streams.
        body.textContent = "";
        const empty = _doc.createElement("div");
        empty.className = "prod-terminal-empty";
        empty.textContent = "(" + tab.label + " stream — UI-P6에서 연결됩니다)";
        body.appendChild(empty);
      });
      tabButtons[tab.id] = btn;
      tabBar.appendChild(btn);
    });
    term.appendChild(tabBar);

    const body = _doc.createElement("div");
    body.className = "prod-terminal-body";
    body.setAttribute("role", "log");
    body.setAttribute("aria-live", "polite");
    const empty = _doc.createElement("div");
    empty.className = "prod-terminal-empty";
    empty.textContent = "(" + tabs[0].label + " stream — UI-P6에서 연결됩니다)";
    body.appendChild(empty);
    term.appendChild(body);

    return {
      el: term,
      getActiveTab: function () { return activeTab; },
      setActiveTab: function (id) {
        const btn = tabButtons[id];
        if (btn) btn.click();
      },
    };
  }

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("HarnessProductDualTerminals.create: opts required");
    }
    const root = opts.root;
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!root || !_doc) throw new Error("HarnessProductDualTerminals.create: root + doc required");

    const wrap = _doc.createElement("div");
    wrap.className = "prod-terminals";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Dual Terminals");

    const left = _terminal(_doc, "left", TABS_LEFT, "claude");
    const right = _terminal(_doc, "right", TABS_RIGHT, "codex");
    wrap.appendChild(left.el);
    wrap.appendChild(right.el);

    root.appendChild(wrap);

    return {
      destroy: function () {
        if (wrap.parentNode === root) {
          try { root.removeChild(wrap); } catch (_) {}
        }
      },
      setMode: function () { /* mode has no impact on stub layout */ },
      _state: function () {
        return {
          left: left.getActiveTab(),
          right: right.getActiveTab(),
        };
      },
    };
  }

  return {
    create,
    TABS_LEFT,
    TABS_RIGHT,
  };
});
