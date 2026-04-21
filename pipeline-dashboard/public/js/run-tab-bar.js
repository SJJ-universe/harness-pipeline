// Slice U (v6) — Run tab bar for multi-run dashboards.
//
// Two-layer UMD (same as toast / run-history / analytics-panel):
//   1. `RunTabBarState` — pure, Node-testable. Tracks known runIds, their
//      active/completed status, lastEventAt, and the currentRunId the UI
//      is focused on.
//   2. `install({ mountEl, onSelect })` — DOM wiring. Renders buttons,
//      hides the bar when only the default run exists, and dispatches
//      `onSelect(runId)` when the user clicks a tab.
//
// In Slice U the bar exists but stays collapsed (single-active mode means
// one run → nothing to switch between). Once Slice V raises MAX_CONCURRENT_RUNS
// and tags broadcasts with real session_ids, this bar automatically grows
// new tabs as events with fresh runIds arrive.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessRunTabBar = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const DEFAULT_RUN_ID = "default";

  class RunTabBarState {
    constructor({ defaultRunId = DEFAULT_RUN_ID } = {}) {
      this.defaultRunId = defaultRunId;
      this.currentRunId = defaultRunId;
      this.runs = new Map();
      // Seed the default run so it's always present in the list.
      this.runs.set(defaultRunId, {
        label: defaultRunId,
        active: true,
        completed: false,
        lastEventAt: Date.now(),
      });
    }

    /** Register a runId from an incoming event. Returns { changed, entry }. */
    seen(runId) {
      if (!runId || typeof runId !== "string") return { changed: false };
      const existing = this.runs.get(runId);
      if (existing) {
        existing.lastEventAt = Date.now();
        return { changed: false, entry: existing };
      }
      const entry = {
        label: runId,
        active: true,
        completed: false,
        lastEventAt: Date.now(),
      };
      this.runs.set(runId, entry);
      return { changed: true, entry };
    }

    /** Mark a run as completed; it stays visible but dimmed. */
    complete(runId) {
      const entry = this.runs.get(runId);
      if (!entry) return false;
      entry.completed = true;
      entry.active = false;
      return true;
    }

    /** Switch focus to a runId. Returns false if the run is unknown. */
    select(runId) {
      if (!this.runs.has(runId)) return false;
      this.currentRunId = runId;
      return true;
    }

    /** Remove a non-default run (completed + dismissed). */
    remove(runId) {
      if (runId === this.defaultRunId) return false;
      const removed = this.runs.delete(runId);
      if (removed && this.currentRunId === runId) {
        this.currentRunId = this.defaultRunId;
      }
      return removed;
    }

    list() {
      return Array.from(this.runs.entries()).map(([id, info]) => ({ id, ...info }));
    }

    size() { return this.runs.size; }
    current() { return this.currentRunId; }
  }

  function install({ mountEl, onSelect } = {}) {
    if (typeof document === "undefined") {
      return { state: new RunTabBarState(), render: () => {} };
    }
    const state = new RunTabBarState();
    const container =
      typeof mountEl === "string" ? document.getElementById(mountEl) : mountEl;
    if (!container) {
      return { state, render: () => {}, seen: () => ({ changed: false }) };
    }

    function render() {
      // Rebuild in place. Small DOM (max a handful of tabs) so rebuilding
      // each change is simpler than diffing.
      container.innerHTML = "";
      const runs = state.list();
      // Single-run (default only) → collapse the bar entirely.
      if (runs.length <= 1) {
        container.classList.add("is-hidden");
        return;
      }
      container.classList.remove("is-hidden");
      for (const run of runs) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "run-tab" +
          (run.id === state.currentRunId ? " is-active" : "") +
          (run.completed ? " is-completed" : "");
        btn.dataset.runId = run.id;
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", run.id === state.currentRunId ? "true" : "false");
        btn.textContent = run.label;
        btn.addEventListener("click", () => {
          state.select(run.id);
          render();
          if (typeof onSelect === "function") {
            try { onSelect(run.id); } catch (_) {}
          }
        });
        container.appendChild(btn);
      }
    }

    render();

    return {
      state,
      render,
      seen: (runId) => {
        const r = state.seen(runId);
        if (r.changed) render();
        return r;
      },
      complete: (runId) => {
        const ok = state.complete(runId);
        if (ok) render();
        return ok;
      },
      select: (runId) => {
        const ok = state.select(runId);
        if (ok) render();
        return ok;
      },
      remove: (runId) => {
        const ok = state.remove(runId);
        if (ok) render();
        return ok;
      },
      current: () => state.currentRunId,
    };
  }

  return { RunTabBarState, install, DEFAULT_RUN_ID };
});
