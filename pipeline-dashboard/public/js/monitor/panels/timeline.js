// Slice MA5 (Phase D, 2026-04-27) — HarnessMonitorTimeline.
//
// Centre-workspace bottom region: chronological list of recent events
// from the store, filtered to the focused run + global events. Clicking
// a row routes through onSelect(env) → store.selectItem("event", env)
// so the right-inspector picks it up.
//
// Filter contract:
//   - snapshot.selectedRunId === null  → show ALL events (global view)
//   - snapshot.selectedRunId === "X"   → show events whose runId === "X"
//                                        plus events whose scope ===
//                                        "global" (toast / hook_event /
//                                        child_*) so the user keeps
//                                        seeing system-wide context
//                                        even while focused on one run.
//
// This mirrors the eventReplayBuffer.snapshot({runId, includeGlobal})
// policy from Phase 2.5 AA-2 — a focused run still surfaces global UI
// events, never a duplicate per tab.
//
// Display: newest-first, capped at MAX_DISPLAY rows. The store ring
// already caps the events array (default 200), so this is just a
// rendering cap to keep the DOM cheap during bursts.
//
// Update lane: warm. Full repaint per snapshot. The cap keeps DOM
// nodes < 100 in steady state, and the timeline re-renders at most as
// often as the store publishes (which already debounces high-frequency
// types in server.js).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorTimeline = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const MAX_DISPLAY = 50;

  function _formatTime(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function _filterEvents(events, focusRunId) {
    if (!Array.isArray(events) || events.length === 0) return [];
    return events.filter((env) => {
      if (!env) return false;
      if (env.scope === "global") return true;
      if (!focusRunId) return true;
      return env.runId === focusRunId;
    });
  }

  // Slice MA6: scope chip filter. Drops envelopes whose scope is in the
  // excluded set. Empty/null set = pass everything (default state).
  function _applyScopeFilter(events, excludedScopes) {
    if (!Array.isArray(events) || events.length === 0) return events || [];
    if (!excludedScopes || excludedScopes.length === 0) return events;
    const set = excludedScopes instanceof Set
      ? excludedScopes
      : new Set(excludedScopes);
    if (set.size === 0) return events;
    return events.filter((env) => env && !set.has(env.scope));
  }

  function _isSelectedEvent(selectedItem, env) {
    return !!(
      selectedItem
      && selectedItem.kind === "event"
      && selectedItem.payload === env
    );
  }

  function create({ root, store, onSelect, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("timeline.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("timeline.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("timeline.create: no document available");
    }

    function _emit(env) {
      if (typeof onSelect === "function") {
        try { onSelect(env); } catch (_) { /* user cb never aborts panel */ }
      }
    }

    function _renderRow(env, isSelected, isPinned) {
      const row = _doc.createElement("div");
      row.className = "tl-row"
        + (isSelected ? " is-selected" : "")
        + (isPinned ? " is-pinned" : "");
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.setAttribute("data-type", env.type || "");

      const ts = _doc.createElement("span");
      ts.className = "tl-ts";
      ts.textContent = _formatTime(env.ts);
      row.appendChild(ts);

      const scope = _doc.createElement("span");
      scope.className = "tl-scope tl-scope-" + (env.scope || "unknown");
      scope.textContent = env.scope || "unknown";
      row.appendChild(scope);

      const type = _doc.createElement("span");
      type.className = "tl-type";
      type.textContent = env.type || "(?)";
      row.appendChild(type);

      const summary = _doc.createElement("span");
      summary.className = "tl-summary";
      // Slice MA6: pin indicator inline at the start of the summary so
      // pinned rows are still scannable at a glance even when the row's
      // scope/type filter is matching the user's chip selection.
      summary.textContent = (isPinned ? "📌 " : "") + (env.summary || "");
      row.appendChild(summary);

      row.addEventListener("click", () => _emit(env));
      row.addEventListener("keydown", (ev) => {
        if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
          if (ev.preventDefault) ev.preventDefault();
          _emit(env);
        }
      });
      return row;
    }

    // Slice MA6: filter chip strip — one chip per known scope. Active
    // (== visible scope) when chip is NOT in timelineExcluded; inactive
    // when it is. Click toggles via store.toggleTimelineScope.
    function _renderChipStrip(snapshot) {
      const strip = _doc.createElement("div");
      strip.className = "tl-filter";
      strip.setAttribute("role", "toolbar");
      strip.setAttribute("aria-label", "Scope filter");
      const excluded = new Set((snapshot && snapshot.timelineExcluded) || []);
      // Show known scopes in stable display order. Other scopes (e.g.
      // unknown) are not chip-filterable in MA6 — they pass through by
      // default but the user can still hide them via store API.
      const KNOWN_SCOPES = [
        "pipeline", "phase", "tool", "gate", "codex",
        "subagent", "child", "verification", "artifact",
        "orchestrator", "server", "context", "ui",
        "telemetry", "cycle", "global",
      ];
      for (const scope of KNOWN_SCOPES) {
        const chip = _doc.createElement("button");
        chip.type = "button";
        chip.className = "tl-chip"
          + (excluded.has(scope) ? "" : " is-active")
          + " tl-chip-" + scope;
        chip.setAttribute("data-scope", scope);
        chip.setAttribute("aria-pressed", excluded.has(scope) ? "false" : "true");
        chip.textContent = scope;
        chip.addEventListener("click", () => {
          if (typeof store.toggleTimelineScope === "function") {
            store.toggleTimelineScope(scope);
          }
        });
        strip.appendChild(chip);
      }
      return strip;
    }

    function render(snapshot) {
      root.innerHTML = "";

      // Slice MA6: chip strip is always present — even on the empty
      // state — so the user can always tweak filters.
      root.appendChild(_renderChipStrip(snapshot));

      const events = (snapshot && snapshot.events) || [];
      const pinned = (snapshot && snapshot.pinnedEvents) || [];
      const focus = (snapshot && snapshot.selectedRunId) || null;
      const excluded = (snapshot && snapshot.timelineExcluded) || [];

      // Slice MA6: merge pinned events (which survive ring eviction)
      // with the live events ring, dedup by reference. Pinned events
      // bypass the runId/scope filters by design — pinning explicitly
      // says "I want this visible regardless".
      const pinnedSet = new Set(pinned);
      const ringSeenSet = new Set(events);
      const survivors = pinned.filter((env) => env && !ringSeenSet.has(env));
      const ringFiltered = _applyScopeFilter(_filterEvents(events, focus), excluded);
      const merged = ringFiltered.concat(survivors);

      if (merged.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "tl-empty";
        empty.textContent = focus
          ? "이 런의 이벤트 없음 — 좌측에서 다른 런 선택"
          : "이벤트 없음";
        root.appendChild(empty);
        return;
      }

      // newest-first by ts, capped.
      const display = merged
        .slice()
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .slice(0, MAX_DISPLAY);
      const list = _doc.createElement("div");
      list.className = "tl-list";
      list.setAttribute("role", "list");
      list.setAttribute("aria-label", "Recent events");
      const sel = (snapshot && snapshot.selectedItem) || null;
      for (const env of display) {
        const isPinned = pinnedSet.has(env);
        list.appendChild(_renderRow(env, _isSelectedEvent(sel, env), isPinned));
      }
      root.appendChild(list);
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
      _filterEvents,
      _applyScopeFilter,
      _isSelectedEvent,
      _renderChipStrip,
      MAX_DISPLAY,
    };
  }

  return { create, _formatTime, _filterEvents, _applyScopeFilter, _isSelectedEvent, MAX_DISPLAY };
});
