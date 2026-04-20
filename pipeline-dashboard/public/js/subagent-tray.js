// Harness subagent tray — Slice D (v4).
//
// Renders a live list of Claude Code subagents (dispatched via the Agent tool)
// driven by the SubagentStart / SubagentStop hooks. Matches toast.js's two-
// layer structure:
//   1. `SubagentTrayState` — pure in-memory map (session_id → entry). Node
//      tests exercise this directly for start/complete/eviction/replay semantics.
//   2. `install()` — DOM wiring. Renders into `<div id="subagent-items">`,
//      runs a 1s live-elapsed tick only while active subagents exist, and
//      schedules a post-completion fade-out.
//
// Completed entries stay in the DOM briefly (`fadeMs`, default 5s) so the user
// actually sees that the subagent finished — wiping them on the stop event
// would hide short-lived dispatches entirely.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    root.HarnessSubagentTray = api.install({ doc: document, win: window });
    root.HarnessSubagentTray.SubagentTrayState = api.SubagentTrayState;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_MAX_VISIBLE = 8;
  const DEFAULT_FADE_MS = 5000;
  const TICK_MS = 1000;

  // ── Pure state manager ─────────────────────────────────────────────
  class SubagentTrayState {
    constructor({ maxVisible = DEFAULT_MAX_VISIBLE } = {}) {
      this.maxVisible = maxVisible;
      this.agents = new Map(); // id → entry
    }

    start({ session_id, agent_type, parent_session_id, at }) {
      const id = session_id || ("sub-" + Math.random().toString(36).slice(2, 10));
      // If we somehow get a duplicate start (same id), preserve the earliest
      // startedAt — helps replay be deterministic.
      const existing = this.agents.get(id);
      const startedAt = existing ? existing.startedAt : (at || Date.now());
      this.agents.set(id, {
        id,
        agent_type: agent_type || "unknown",
        startedAt,
        completedAt: existing ? existing.completedAt : null,
        parent_session_id: parent_session_id || null,
      });
      return this.agents.get(id);
    }

    complete({ session_id, agent_type, elapsedMs, at }) {
      const id = session_id;
      if (!id) return null;
      let entry = this.agents.get(id);
      // It's legitimate to receive a stop event without a prior start event —
      // e.g. the dashboard came online mid-run and only saw replay. Synthesize
      // an entry with the reported elapsed so the UI still shows "✓ Ns".
      if (!entry) {
        const now = at || Date.now();
        const synthStart = Number.isFinite(elapsedMs) ? now - elapsedMs : now;
        entry = {
          id,
          agent_type: agent_type || "unknown",
          startedAt: synthStart,
          completedAt: null,
          parent_session_id: null,
        };
        this.agents.set(id, entry);
      }
      entry.completedAt = at || Date.now();
      return entry;
    }

    remove(id) {
      return this.agents.delete(id);
    }

    clear() {
      this.agents.clear();
    }

    size() { return this.agents.size; }
    activeCount() {
      let n = 0;
      for (const e of this.agents.values()) if (!e.completedAt) n++;
      return n;
    }
    completedCount() { return this.agents.size - this.activeCount(); }

    /**
     * Snapshot ordered for UI rendering:
     *   - active entries first, oldest→newest (lets the user follow the fan-out)
     *   - completed entries after, most-recently-completed first
     *   - up to `maxVisible`; overflow is summarized into { overflow: N }
     */
    snapshot() {
      const active = [];
      const completed = [];
      for (const e of this.agents.values()) {
        if (e.completedAt) completed.push(e);
        else active.push(e);
      }
      active.sort((a, b) => a.startedAt - b.startedAt);
      completed.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      const ordered = active.concat(completed);
      if (ordered.length <= this.maxVisible) {
        return { items: ordered.slice(), overflow: 0 };
      }
      return {
        items: ordered.slice(0, this.maxVisible - 1),
        overflow: ordered.length - (this.maxVisible - 1),
      };
    }
  }

  // ── DOM wiring ─────────────────────────────────────────────────────
  function install({ doc, win, maxVisible = DEFAULT_MAX_VISIBLE, fadeMs = DEFAULT_FADE_MS } = {}) {
    if (!doc) {
      return {
        state: new SubagentTrayState({ maxVisible }),
        start() {}, complete() {}, reset() {}, restore() {}, clear() {},
      };
    }

    const state = new SubagentTrayState({ maxVisible });
    let tickTimer = null;
    const fadeTimers = new Map(); // id → timer

    function _container() { return doc.getElementById("subagent-items"); }
    function _countNode() { return doc.getElementById("subagent-count"); }
    function _trayNode() { return doc.getElementById("subagent-tray"); }

    function _formatElapsed(ms) {
      if (!Number.isFinite(ms) || ms < 0) ms = 0;
      if (ms < 10_000) return (ms / 1000).toFixed(1) + "s";
      return Math.round(ms / 1000) + "s";
    }

    function _renderItem(entry, now) {
      const node = doc.createElement("div");
      node.className = "subagent-item" + (entry.completedAt ? " done" : " active");
      node.dataset.subagentId = entry.id;

      const type = doc.createElement("span");
      type.className = "subagent-type";
      type.textContent = entry.agent_type || "unknown";
      node.appendChild(type);

      const elapsedEl = doc.createElement("span");
      elapsedEl.className = "subagent-elapsed";
      const ms = entry.completedAt
        ? (entry.completedAt - entry.startedAt)
        : (now - entry.startedAt);
      elapsedEl.textContent = entry.completedAt
        ? `✓ ${_formatElapsed(ms)}`
        : _formatElapsed(ms);
      node.appendChild(elapsedEl);
      return node;
    }

    function _render() {
      const container = _container();
      if (!container) return;
      const now = Date.now();
      const snap = state.snapshot();

      // Fast path: update elapsed text for existing nodes when their id matches.
      // Avoids flicker on every tick — we only tear down/rebuild when the set
      // of ids actually changes.
      const wantIds = snap.items.map((e) => e.id);
      const hasIds = [];
      for (const child of [...container.children]) {
        const id = child && child.dataset && child.dataset.subagentId;
        if (id) hasIds.push(id);
      }
      const idsEqual =
        wantIds.length === hasIds.filter((id) => id !== "__overflow__").length &&
        wantIds.every((id, i) => hasIds[i] === id);

      if (idsEqual && snap.overflow === 0) {
        // In-place elapsed update only.
        for (const entry of snap.items) {
          const n = container.querySelector(`[data-subagent-id="${entry.id}"]`);
          if (!n) continue;
          const el = n.querySelector(".subagent-elapsed");
          if (!el) continue;
          const ms = entry.completedAt
            ? (entry.completedAt - entry.startedAt)
            : (now - entry.startedAt);
          el.textContent = entry.completedAt
            ? `✓ ${_formatElapsed(ms)}`
            : _formatElapsed(ms);
          n.className = "subagent-item" + (entry.completedAt ? " done" : " active");
        }
      } else {
        // Full rebuild when the membership or overflow changes.
        while (container.firstChild) container.removeChild(container.firstChild);
        for (const entry of snap.items) {
          container.appendChild(_renderItem(entry, now));
        }
        if (snap.overflow > 0) {
          const more = doc.createElement("div");
          more.className = "subagent-item subagent-more";
          more.dataset.subagentId = "__overflow__";
          more.textContent = `+${snap.overflow} more`;
          container.appendChild(more);
        }
      }

      const count = _countNode();
      if (count) count.textContent = String(state.size());

      const tray = _trayNode();
      if (tray) {
        if (state.size() === 0) tray.classList.add("empty");
        else tray.classList.remove("empty");
      }
    }

    function _ensureTick() {
      if (tickTimer) return;
      // Skip the interval when only completed entries remain — their "✓ Ns"
      // is frozen. We only need the tick while at least one active entry
      // is incrementing.
      tickTimer = win.setInterval(() => {
        if (state.activeCount() === 0) {
          win.clearInterval(tickTimer);
          tickTimer = null;
          return;
        }
        _render();
      }, TICK_MS);
    }

    function _scheduleFade(id) {
      const prev = fadeTimers.get(id);
      if (prev) win.clearTimeout(prev);
      const t = win.setTimeout(() => {
        fadeTimers.delete(id);
        state.remove(id);
        _render();
      }, fadeMs);
      fadeTimers.set(id, t);
    }

    return {
      state,

      start(payload) {
        state.start(payload || {});
        _render();
        _ensureTick();
      },

      complete(payload) {
        const entry = state.complete(payload || {});
        _render();
        if (entry) _scheduleFade(entry.id);
      },

      /**
       * Replay wrapper — called from applyReplayEvent with a canonical
       * subagent_* event. Sets startedAt/completedAt from the event's own
       * timestamps when present so the elapsed display is deterministic
       * across reconnect.
       */
      restore(type, data) {
        if (type === "subagent_started") {
          state.start({ ...data, at: data.at || Date.now() });
        } else if (type === "subagent_completed") {
          state.complete({ ...data, at: data.at || Date.now() });
          // Don't schedule a live fade on replay — completed entries already
          // have their terminal elapsed; let the first real tick resolve.
        }
        _render();
        _ensureTick();
      },

      reset() {
        for (const t of fadeTimers.values()) win.clearTimeout(t);
        fadeTimers.clear();
        if (tickTimer) { win.clearInterval(tickTimer); tickTimer = null; }
        state.clear();
        _render();
      },

      clear() { this.reset(); },
    };
  }

  return { SubagentTrayState, install, DEFAULT_MAX_VISIBLE, DEFAULT_FADE_MS };
});
