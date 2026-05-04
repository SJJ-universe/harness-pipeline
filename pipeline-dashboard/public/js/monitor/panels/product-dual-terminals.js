// Slice UI-P1-f / UI-P2-d (Phase 2 Round 3, 2026-04-30) — dual terminals.
//
// Renders the bottom 280px dual-terminal strip per the reference.
// UI-P1 shipped tab bar + empty bodies. UI-P2 adds the right-side
// title pill + auto/clear control buttons + body radial gradient +
// a single placeholder line with the actor prompt + caret cursor —
// all the visible decoration the reference shows even before live
// streams arrive. UI-P6 wires real Claude/Codex/Bash/Verifier
// streams from the review-session manager.
//
// Reference layout (per terminals.jsx):
//   ┌──────────────────────────────────────────────────────────┐
//   │ [● Claude] [● Bash]   [Claude · Plan & Execute] [auto] [clear]
//   ├──────────────────────────────────────────────────────────┤
//   │  body (radial gradient at top, mono lines)               │
//   │  16:42:08  ◇ ▍ (placeholder caret)                       │
//   └──────────────────────────────────────────────────────────┘
//
// Mode behavior:
//   - simple: no per-line timestamps (CSS hides .prod-terminal-line-time)
//   - pro:    timestamps visible

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessProductDualTerminals = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Tabs reference (left = Claude/Bash, right = Codex/Verifier).
  // The `actor` field drives the prompt symbol (◇ Claude, ◈ Codex,
  // $ Bash, ► Verifier) + the caret/control button accent color.
  const TABS_LEFT = Object.freeze([
    { id: "claude",   label: "Claude",   actor: "claude", title: "Claude · Plan & Execute", prompt: "◇" },
    { id: "bash",     label: "Bash",     actor: "claude", title: "Bash · Local Shell",      prompt: "$" },
  ]);
  const TABS_RIGHT = Object.freeze([
    { id: "codex",    label: "Codex",    actor: "codex",  title: "Codex · Critique Stream", prompt: "◈" },
    { id: "verifier", label: "Verifier", actor: "codex",  title: "Verifier · Test Output",  prompt: "►" },
  ]);

  function _terminal(_doc, side, tabs, defaultTab) {
    const term = _doc.createElement("div");
    term.className = "prod-terminal";
    term.setAttribute("data-side", side);

    let activeTab = defaultTab;
    let autoScroll = true;

    // Tab bar row: tab buttons + spacer (title pill + auto + clear)
    const tabBar = _doc.createElement("div");
    tabBar.className = "prod-terminal-tabs";
    tabBar.setAttribute("role", "tablist");
    const tabButtons = {};

    function _findTab(id) {
      for (let i = 0; i < tabs.length; i++) if (tabs[i].id === id) return tabs[i];
      return tabs[0];
    }

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
        _renderBody();
      });
      tabButtons[tab.id] = btn;
      tabBar.appendChild(btn);
    });

    // Right-aligned spacer with title pill + auto + clear
    const spacer = _doc.createElement("div");
    spacer.className = "prod-terminal-tabs-spacer";
    const titlePill = _doc.createElement("span");
    titlePill.className = "prod-terminal-title-pill";
    titlePill.textContent = _findTab(activeTab).title;
    spacer.appendChild(titlePill);

    const autoBtn = _doc.createElement("button");
    autoBtn.type = "button";
    autoBtn.className = "prod-terminal-control-btn";
    autoBtn.setAttribute("data-active", "true");
    autoBtn.setAttribute("data-actor", _findTab(activeTab).actor);
    autoBtn.textContent = "auto";
    autoBtn.addEventListener("click", function () {
      autoScroll = !autoScroll;
      autoBtn.setAttribute("data-active", autoScroll ? "true" : "false");
    });
    spacer.appendChild(autoBtn);

    const clearBtn = _doc.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "prod-terminal-control-btn";
    clearBtn.setAttribute("data-active", "false");
    clearBtn.textContent = "clear";
    clearBtn.addEventListener("click", function () {
      // UI-P2 stub: clear just empties the body (UI-P6 wires real
      // line buffer reset).
      _renderBody({ cleared: true });
    });
    spacer.appendChild(clearBtn);

    tabBar.appendChild(spacer);
    term.appendChild(tabBar);

    // Body
    const body = _doc.createElement("div");
    body.className = "prod-terminal-body";
    body.setAttribute("role", "log");
    body.setAttribute("aria-live", "polite");
    term.appendChild(body);

    function _renderBody(opts) {
      const cleared = opts && opts.cleared;
      const tab = _findTab(activeTab);
      titlePill.textContent = tab.title;
      autoBtn.setAttribute("data-actor", tab.actor);
      // Wipe body
      while (body.firstChild) body.removeChild(body.firstChild);

      if (cleared) {
        const empty = _doc.createElement("div");
        empty.className = "prod-terminal-empty";
        empty.textContent = "(cleared)";
        body.appendChild(empty);
      } else {
        // UI-P2 placeholder: a single greeting line + caret cursor.
        // Real chunks land in UI-P6.
        const placeholder = _doc.createElement("div");
        placeholder.className = "prod-terminal-empty";
        placeholder.textContent = "(" + tab.label + " stream — UI-P6에서 연결됩니다)";
        body.appendChild(placeholder);
      }

      // Always-visible final caret line (matches reference)
      const caretLine = _doc.createElement("div");
      caretLine.className = "prod-terminal-line";
      const caretTime = _doc.createElement("span");
      caretTime.className = "prod-terminal-line-time";
      caretTime.textContent = "—:—:—";
      caretLine.appendChild(caretTime);
      const caretText = _doc.createElement("span");
      caretText.className = "prod-terminal-line-text";
      const prompt = _doc.createElement("span");
      prompt.className = "prod-terminal-prompt";
      prompt.setAttribute("data-actor", tab.actor);
      prompt.textContent = tab.prompt + " ";
      caretText.appendChild(prompt);
      const cursor = _doc.createElement("span");
      cursor.className = "prod-terminal-cursor";
      cursor.setAttribute("data-actor", tab.actor);
      caretText.appendChild(cursor);
      caretLine.appendChild(caretText);
      body.appendChild(caretLine);
    }

    _renderBody();

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
      setMode: function () { /* mode has no impact — CSS-driven */ },
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
