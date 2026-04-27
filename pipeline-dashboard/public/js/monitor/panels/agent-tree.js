// Slice MA6 (Phase D, 2026-04-27) — HarnessMonitorAgentTree.
//
// Left-rail companion to run-tree. Surfaces the operational data the
// global-bar can only summarise as counters:
//
//   1. Children — snapshot.activeChildren grouped by runId (the
//      childRegistry data Phase 3-S Slice S3-a started tracking).
//   2. Subagents — derived from the events ring: subagent_started
//      events without a matching subagent_completed are still alive.
//      Grouped by runId. The events ring is bounded (default 200) so
//      a long-running subagent whose start event was evicted will
//      drop out of this list — that's accepted: agent-tree is for
//      RECENT agent activity, not historical accounting.
//
// Click → onSelect("child", payload) or onSelect("subagent", payload).
// Layout wires the callback to store.selectItem so the inspector lights
// up with kind:"child" or kind:"subagent" detail.
//
// Update lane: warm. Re-renders on every store publish; rows are O(N)
// where N = activeChildren.length + open subagent count, both small.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorAgentTree = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + "h " + m + "m";
  }

  function _groupByRunId(items) {
    const groups = new Map();
    for (const item of items) {
      const rid = (item && item.runId) || "(no run)";
      if (!groups.has(rid)) groups.set(rid, []);
      groups.get(rid).push(item);
    }
    return groups;
  }

  /**
   * Walk the events ring (newest-first) and extract subagent_started
   * envelopes whose session_id has not been matched by a later
   * subagent_completed.
   *
   * Returns [{ session_id, agent_id, runId, agent_type, ts, env }]
   */
  function _activeSubagents(events) {
    if (!Array.isArray(events) || events.length === 0) return [];
    const completed = new Set();
    const out = [];
    // walk newest → oldest so we know "completed" before we see "started"
    for (let i = events.length - 1; i >= 0; i--) {
      const env = events[i];
      if (!env || typeof env !== "object") continue;
      if (env.type === "subagent_completed") {
        const sid = env.payload && (env.payload.session_id || env.payload.agent_id);
        if (sid) completed.add(String(sid));
        continue;
      }
      if (env.type === "subagent_started") {
        const p = env.payload || {};
        const sid = p.session_id || p.agent_id || null;
        if (!sid) continue;
        const key = String(sid);
        if (completed.has(key)) continue;
        // A subagent can fire multiple started events (e.g. resume); keep
        // only the newest. Our walk is newest-first, so first-seen wins.
        if (out.find((x) => x.session_id === key)) continue;
        out.push({
          session_id: key,
          agent_id: p.agent_id || null,
          agent_type: p.agent_type || p.type || null,
          runId: env.runId || null,
          ts: env.ts,
          env,
        });
      }
    }
    // Stable sort: oldest started first (reverse of newest-first walk).
    return out.reverse();
  }

  function create({ root, store, onSelect, doc } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("agentTree.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("agentTree.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("agentTree.create: no document available");
    }

    function _emit(kind, payload) {
      if (typeof onSelect === "function") {
        try { onSelect(kind, payload); } catch (_) { /* user cb never aborts panel */ }
      }
    }

    function _renderChildRow(child, isSelected) {
      const li = _doc.createElement("li");
      li.className = "at-item at-child" + (isSelected ? " is-selected" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", isSelected ? "true" : "false");
      li.setAttribute("tabindex", isSelected ? "0" : "-1");
      li.setAttribute("data-pid", String(child.pid != null ? child.pid : "?"));

      const dot = _doc.createElement("span");
      dot.className = "at-status at-status-child";
      li.appendChild(dot);

      const labelWrap = _doc.createElement("span");
      labelWrap.className = "at-label";
      const name = _doc.createElement("span");
      name.className = "at-name";
      name.textContent = (child.label || "child") + " (" + (child.pid != null ? child.pid : "?") + ")";
      labelWrap.appendChild(name);
      const meta = _doc.createElement("span");
      meta.className = "at-meta";
      meta.textContent = _formatAge(child.ageMs);
      labelWrap.appendChild(meta);
      li.appendChild(labelWrap);

      li.addEventListener("click", () => _emit("child", child));
      li.addEventListener("keydown", (ev) => {
        if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
          if (ev.preventDefault) ev.preventDefault();
          _emit("child", child);
        }
      });
      return li;
    }

    function _renderSubagentRow(sub, isSelected) {
      const li = _doc.createElement("li");
      li.className = "at-item at-subagent" + (isSelected ? " is-selected" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", isSelected ? "true" : "false");
      li.setAttribute("tabindex", isSelected ? "0" : "-1");
      li.setAttribute("data-session-id", sub.session_id);

      const dot = _doc.createElement("span");
      dot.className = "at-status at-status-subagent";
      li.appendChild(dot);

      const labelWrap = _doc.createElement("span");
      labelWrap.className = "at-label";
      const name = _doc.createElement("span");
      name.className = "at-name";
      name.textContent = sub.agent_type ? sub.agent_type : "subagent";
      labelWrap.appendChild(name);
      const meta = _doc.createElement("span");
      meta.className = "at-meta";
      meta.textContent = sub.session_id;
      labelWrap.appendChild(meta);
      li.appendChild(labelWrap);

      li.addEventListener("click", () => _emit("subagent", sub));
      li.addEventListener("keydown", (ev) => {
        if (ev && (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar")) {
          if (ev.preventDefault) ev.preventDefault();
          _emit("subagent", sub);
        }
      });
      return li;
    }

    function _renderGroup(title, runId, items, kind, selectedItem) {
      const group = _doc.createElement("div");
      group.className = "at-group";
      const head = _doc.createElement("div");
      head.className = "at-group-title";
      head.textContent = "[" + runId + "] " + title;
      group.appendChild(head);
      const list = _doc.createElement("ul");
      list.className = "at-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", title + " for " + runId);
      for (const item of items) {
        const isSel = !!(
          selectedItem
          && selectedItem.kind === kind
          && (
            (kind === "child" && selectedItem.payload && selectedItem.payload.pid === item.pid)
            || (kind === "subagent" && selectedItem.payload && selectedItem.payload.session_id === item.session_id)
          )
        );
        if (kind === "child") list.appendChild(_renderChildRow(item, isSel));
        else list.appendChild(_renderSubagentRow(item, isSel));
      }
      group.appendChild(list);
      return group;
    }

    function _renderSection(title, kind, items, selectedItem) {
      const section = _doc.createElement("div");
      section.className = "at-section at-section-" + kind;
      const head = _doc.createElement("div");
      head.className = "at-section-title";
      head.textContent = title;
      section.appendChild(head);
      if (items.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "at-empty";
        empty.textContent = (kind === "child" ? "활성 자식 프로세스 없음" : "활성 서브에이전트 없음");
        section.appendChild(empty);
        return section;
      }
      const groups = _groupByRunId(items);
      for (const [runId, group] of groups.entries()) {
        section.appendChild(_renderGroup(title, runId, group, kind, selectedItem));
      }
      return section;
    }

    function render(snapshot) {
      root.innerHTML = "";
      const children = (snapshot && snapshot.activeChildren) || [];
      const subs = _activeSubagents((snapshot && snapshot.events) || []);
      const sel = (snapshot && snapshot.selectedItem) || null;
      root.appendChild(_renderSection("Children", "child", children, sel));
      root.appendChild(_renderSection("Subagents", "subagent", subs, sel));
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
      _formatAge,
      _groupByRunId,
      _activeSubagents,
    };
  }

  return { create, _formatAge, _groupByRunId, _activeSubagents };
});
