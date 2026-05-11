// Slice MA5 + MB3 (Phase D Round 2, 2026-04-27) — OrchestratorMonitorBottomDock.
//
// MA5 shipped this as a single-tab raw event log. MB3 promotes it to a
// real tabbed dock matching spec section 4.1: raw log / terminal /
// replay / debug. Tab state is local to the panel (not in the store);
// only the active tab body renders to keep the warm/cold lane budget
// honest.
//
// Tabs:
//   raw      — every event in the store ring, monospace, newest-first.
//              The original MA5 behaviour, untouched semantically.
//   terminal — separate xterm + WebSocket /terminal connection from the
//              one in the legacy dashboard. Spawns its OWN PTY, only
//              when the user opts in to monitor + visits this tab.
//              Fully torn down on tab leave / panel destroy.
//   replay   — list of runs from snapshot.runs, click → store.selectRun.
//              "Open run history" button dispatches a click on the
//              legacy #btn-open-run-history so the existing drawer flow
//              is reused without duplicating its render logic.
//   debug    — JSON.stringify(store.snapshot()) in a <pre>. Power-user
//              tool for verifying state in real time.
//
// Update lane: cold for raw + debug (full repaint per snapshot), warm
// for terminal (one-shot mount, lifecycle managed), warm for replay
// (re-render on snapshot.runs change).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorBottomDock = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const MAX_DISPLAY = 80;
  const TABS = ["raw", "terminal", "replay", "debug"];
  const TAB_LABELS = {
    raw:      "raw event log",
    terminal: "terminal",
    replay:   "replay",
    debug:    "debug",
  };

  function _formatTimeMs(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds())
      + "." + String(d.getMilliseconds()).padStart(3, "0");
  }

  function create({
    root, store, doc,
    initialTab = "raw",
    // MB3: dependency injection for tests + browser fallbacks.
    apiToken = null,
    TerminalCtor = null,
    FitAddonCtor = null,
    WebSocketCtor = null,
    locationProtocol = null,
    locationHost = null,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("bottomDock.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("bottomDock.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("bottomDock.create: no document available");
    }

    let activeTab = TABS.indexOf(initialTab) >= 0 ? initialTab : "raw";

    // Per-tab teardown handles. Each tab returns its own destroy fn so
    // the dock can clean up when switching tabs OR being destroyed.
    let activeTabHandle = null;

    // ── tab body renderers ──────────────────────────────────────────

    function _renderRawRow(env) {
      const row = _doc.createElement("div");
      row.className = "bd-row";
      const ts = _doc.createElement("span");
      ts.className = "bd-ts";
      ts.textContent = _formatTimeMs(env.ts);
      row.appendChild(ts);
      const type = _doc.createElement("span");
      type.className = "bd-type";
      type.textContent = env.type || "(?)";
      row.appendChild(type);
      const runId = _doc.createElement("span");
      runId.className = "bd-runId";
      runId.textContent = env.runId ? "[" + env.runId + "]" : "[—]";
      row.appendChild(runId);
      const summary = _doc.createElement("span");
      summary.className = "bd-summary";
      summary.textContent = env.summary || "";
      row.appendChild(summary);
      return row;
    }

    function _mountRawTab(body) {
      // Subscribe to store. On every snapshot, repaint the events list.
      function render(snap) {
        body.innerHTML = "";
        const events = (snap && snap.events) || [];
        if (events.length === 0) {
          const empty = _doc.createElement("div");
          empty.className = "bd-empty";
          empty.textContent = "이벤트 없음";
          body.appendChild(empty);
          return;
        }
        const display = events.slice(-MAX_DISPLAY).reverse();
        const list = _doc.createElement("div");
        list.className = "bd-list";
        list.setAttribute("role", "log");
        list.setAttribute("aria-label", "Raw event log");
        list.setAttribute("aria-live", "polite");
        for (const env of display) list.appendChild(_renderRawRow(env));
        body.appendChild(list);
      }
      render(store.snapshot());
      const off = store.subscribe(render);
      return { destroy() { try { off(); } catch (_) {} } };
    }

    function _mountTerminalTab(body) {
      // MB3: best-effort live terminal in the dock. The terminal needs
      // xterm + an authenticated WebSocket. Both are provided by the
      // legacy dashboard already, but we mount our own instance so the
      // dock tab is self-contained and we don't fight over the legacy
      // #terminal-container.
      const T = TerminalCtor
        || (typeof globalThis !== "undefined" && globalThis.Terminal);
      const Fit = FitAddonCtor
        || (typeof globalThis !== "undefined" && globalThis.FitAddon && globalThis.FitAddon.FitAddon);
      const WSCtor = WebSocketCtor
        || (typeof globalThis !== "undefined" && globalThis.WebSocket);
      if (typeof T !== "function" || typeof WSCtor !== "function") {
        // Test or SSR env — show a stub message and return a no-op handle.
        const stub = _doc.createElement("div");
        stub.className = "bd-empty";
        stub.textContent = "터미널을 사용할 수 없습니다 (xterm/WebSocket 미로드)";
        body.appendChild(stub);
        return { destroy() {} };
      }

      const term = new T({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: "'Cascadia Code', 'Consolas', monospace",
        theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#d4a574" },
      });
      let fitAddon = null;
      if (typeof Fit === "function") {
        fitAddon = new Fit();
        term.loadAddon(fitAddon);
      }
      const container = _doc.createElement("div");
      container.className = "bd-terminal-container";
      body.appendChild(container);
      term.open(container);
      if (fitAddon && typeof fitAddon.fit === "function") {
        try { fitAddon.fit(); } catch (_) {}
      }

      // Construct ws URL with the auth token.
      const protocol = locationProtocol
        || (typeof location !== "undefined" ? location.protocol : "http:");
      const host = locationHost
        || (typeof location !== "undefined" ? location.host : "127.0.0.1:4201");
      const wsProto = protocol === "https:" ? "wss:" : "ws:";
      const token = apiToken
        || (typeof globalThis !== "undefined" && globalThis.HARNESS_TOKEN)
        || "";
      const url = wsProto + "//" + host + "/terminal?token=" + encodeURIComponent(token);

      let ws = null;
      try {
        ws = new WSCtor(url);
      } catch (err) {
        const errBox = _doc.createElement("div");
        errBox.className = "bd-empty";
        errBox.textContent = "터미널 연결 실패: " + (err && err.message ? err.message : String(err));
        body.appendChild(errBox);
        try { term.dispose && term.dispose(); } catch (_) {}
        return { destroy() {} };
      }

      ws.onopen = () => { try { term.writeln("[36m[monitor terminal connected][0m"); } catch (_) {} };
      ws.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed && parsed.type === "output") term.write(parsed.data);
        } catch (_) {}
      };
      ws.onclose = () => { try { term.writeln("[33m[disconnected][0m"); } catch (_) {} };

      term.onData((data) => {
        if (ws && ws.readyState === 1) {
          try { ws.send(JSON.stringify({ type: "input", data })); } catch (_) {}
        }
      });

      return {
        destroy() {
          try { ws && ws.close && ws.close(); } catch (_) {}
          try { term.dispose && term.dispose(); } catch (_) {}
        },
      };
    }

    function _mountReplayTab(body) {
      function render(snap) {
        body.innerHTML = "";
        const ids = (snap && snap.runIds) || [];
        const runs = (snap && snap.runs) || {};
        const wrap = _doc.createElement("div");
        wrap.className = "bd-replay-wrap";

        const head = _doc.createElement("div");
        head.className = "bd-replay-head";
        const headLabel = _doc.createElement("span");
        headLabel.className = "bd-replay-label";
        headLabel.textContent = "replay (" + ids.length + " runs)";
        head.appendChild(headLabel);
        const openBtn = _doc.createElement("button");
        openBtn.type = "button";
        openBtn.className = "bd-btn";
        openBtn.textContent = "Open run history drawer";
        openBtn.addEventListener("click", () => {
          // Bridge to legacy: dispatch a click on the existing button.
          // If the legacy button is missing (test env or future removal)
          // the click is a silent no-op.
          if (typeof globalThis !== "undefined" && globalThis.document) {
            const legacy = globalThis.document.getElementById("btn-open-run-history");
            if (legacy && typeof legacy.click === "function") legacy.click();
          }
        });
        head.appendChild(openBtn);
        wrap.appendChild(head);

        if (ids.length === 0) {
          const empty = _doc.createElement("div");
          empty.className = "bd-empty";
          empty.textContent = "활성 런 없음";
          wrap.appendChild(empty);
          body.appendChild(wrap);
          return;
        }

        const list = _doc.createElement("ul");
        list.className = "bd-replay-list";
        for (const id of ids) {
          const r = runs[id] || { id };
          const li = _doc.createElement("li");
          li.className = "bd-replay-item" + (snap.selectedRunId === id ? " is-selected" : "");
          li.setAttribute("data-run-id", id);
          li.setAttribute("role", "button");
          li.setAttribute("tabindex", "0");
          const idEl = _doc.createElement("span");
          idEl.className = "bd-replay-id";
          idEl.textContent = id;
          li.appendChild(idEl);
          const meta = _doc.createElement("span");
          meta.className = "bd-replay-meta";
          meta.textContent = (r.status || "idle") + (r.templateId ? " · " + r.templateId : "");
          li.appendChild(meta);
          li.addEventListener("click", () => {
            if (typeof store.selectRun === "function") store.selectRun(id);
          });
          li.addEventListener("keydown", (ev) => {
            if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
              if (ev.preventDefault) ev.preventDefault();
              if (typeof store.selectRun === "function") store.selectRun(id);
            }
          });
          list.appendChild(li);
        }
        wrap.appendChild(list);
        body.appendChild(wrap);
      }
      render(store.snapshot());
      const off = store.subscribe(render);
      return { destroy() { try { off(); } catch (_) {} } };
    }

    function _mountDebugTab(body) {
      function render(snap) {
        body.innerHTML = "";
        const pre = _doc.createElement("pre");
        pre.className = "bd-debug";
        try {
          // pinnedEvents are envelope refs that JSON.stringify can serialise
          // but the runs/runDetails maps were already plain-object on snapshot.
          pre.textContent = JSON.stringify(snap, null, 2);
        } catch (err) {
          pre.textContent = "(snapshot stringify failed: " + (err && err.message) + ")";
        }
        body.appendChild(pre);
      }
      render(store.snapshot());
      const off = store.subscribe(render);
      return { destroy() { try { off(); } catch (_) {} } };
    }

    function _mountTab(name, body) {
      if (name === "raw")      return _mountRawTab(body);
      if (name === "terminal") return _mountTerminalTab(body);
      if (name === "replay")   return _mountReplayTab(body);
      if (name === "debug")    return _mountDebugTab(body);
      // Unknown tab → no-op.
      return { destroy() {} };
    }

    // ── shell render (header tabs + active body) ────────────────────

    let bodyEl = null; // re-used across tab switches; cleared on switch.
    function _renderShell() {
      // Tear down previous tab if any.
      try { activeTabHandle && activeTabHandle.destroy && activeTabHandle.destroy(); } catch (_) {}
      activeTabHandle = null;

      root.innerHTML = "";

      // Header — tab buttons + count badge for the events ring.
      const header = _doc.createElement("div");
      header.className = "bd-header";
      for (const tab of TABS) {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "bd-tab" + (tab === activeTab ? " is-active" : "");
        btn.setAttribute("data-tab", tab);
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", tab === activeTab ? "true" : "false");
        btn.textContent = TAB_LABELS[tab];
        btn.addEventListener("click", () => setTab(tab));
        header.appendChild(btn);
      }
      const count = _doc.createElement("span");
      count.className = "bd-count";
      count.textContent = String((store.snapshot().events || []).length);
      header.appendChild(count);
      root.appendChild(header);

      // Active tab body.
      bodyEl = _doc.createElement("div");
      bodyEl.className = "bd-body bd-body-" + activeTab;
      bodyEl.setAttribute("role", "tabpanel");
      root.appendChild(bodyEl);
      activeTabHandle = _mountTab(activeTab, bodyEl);
    }

    function setTab(name) {
      if (TABS.indexOf(name) < 0) return;
      if (name === activeTab) return;
      activeTab = name;
      _renderShell();
    }

    _renderShell();

    // The header count badge needs to update on every store publish (cheap),
    // even if the body's tab doesn't subscribe (e.g. terminal tab). We
    // attach a thin subscriber that only repaints the count span.
    const headerSubOff = store.subscribe((snap) => {
      const countEl = root.children[0] && root.children[0].children
        ? Array.from(root.children[0].children || []).find((c) => c && c.classList && c.classList.contains("bd-count"))
        : null;
      if (countEl) countEl.textContent = String((snap.events || []).length);
    });

    return {
      destroy() {
        try { headerSubOff(); } catch (_) {}
        try { activeTabHandle && activeTabHandle.destroy && activeTabHandle.destroy(); } catch (_) {}
        activeTabHandle = null;
        root.innerHTML = "";
      },
      // Public action for tests + future keyboard shortcut wiring.
      setTab,
      getActiveTab: () => activeTab,
      // Test hooks
      _render: _renderShell,
      _formatTimeMs,
      MAX_DISPLAY,
      TABS,
    };
  }

  return { create, _formatTimeMs, MAX_DISPLAY, TABS };
});
