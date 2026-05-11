// Slice MA7-a (Phase D, 2026-04-27) — tool-feed-render.
//
// Behaviour-preserving lift of the pure-DOM render helpers that lived
// in public/app.js around lines 1276-1435:
//   - renderToolFeed(toolFeed)
//   - renderCritiqueTimeline(timeline)
//   - renderFindingCounts(findings)
//   - setBadge(cls, text)
//
// These render functions are state-free — app.js still owns the
// toolFeed / critiqueTimeline / findings arrays and just calls these
// helpers after mutation. That keeps the extraction surgical: tests
// can drive the renders against stub doc + arrays without ever
// touching app.js.
//
// Update lane: warm. The legacy dashboard re-renders the whole feed
// after each push; budget is small (TOOL_FEED_LIMIT = 50 in legacy,
// CRITIQUE_TIMELINE_LIMIT = 20).

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorToolFeedRender = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function install({
    doc = null,
    formatHMS = null,
  } = {}) {
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    const _formatHMS = typeof formatHMS === "function"
      ? formatHMS
      : (typeof globalThis !== "undefined"
          && globalThis.OrchestratorFormatters
          && typeof globalThis.OrchestratorFormatters.formatHMS === "function"
          ? globalThis.OrchestratorFormatters.formatHMS
          : (ts) => new Date(ts).toISOString());

    function _div(className, textContent) {
      const el = _doc.createElement("div");
      el.className = className;
      if (textContent !== undefined) el.textContent = textContent;
      return el;
    }

    function _span(className, textContent) {
      const el = _doc.createElement("span");
      el.className = className;
      if (textContent !== undefined) el.textContent = textContent;
      return el;
    }

    function renderToolFeed(toolFeed) {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const el = _doc.getElementById("tool-feed");
      const counter = _doc.getElementById("tool-feed-counter");
      if (!el) return;
      if (counter) counter.textContent = String((toolFeed && toolFeed.length) || 0);
      // textContent="" clears children deterministically (matches legacy).
      el.textContent = "";
      if (!toolFeed || toolFeed.length === 0) {
        el.appendChild(_div("tool-empty", "아직 기록된 툴 호출이 없습니다."));
        return;
      }
      for (const e of toolFeed) {
        const div = _doc.createElement("div");
        div.className = e.blocked ? "tool-entry blocked" : "tool-entry";
        div.appendChild(_span("tool-time", _formatHMS(e.ts)));
        div.appendChild(_span("tool-phase", "[" + (e.phase || "") + "]"));
        div.appendChild(_span("tool-tool", e.tool || ""));
        if (e.blocked) {
          div.appendChild(_span("tool-blocked", "BLOCK"));
          div.appendChild(_span("tool-reason", e.reason || (e.allowed || []).join(",")));
        } else {
          div.appendChild(_doc.createElement("span"));
          div.appendChild(_span("tool-input", e.input || ""));
        }
        el.appendChild(div);
      }
    }

    function renderCritiqueTimeline(timeline) {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const el = _doc.getElementById("critique-timeline");
      const counter = _doc.getElementById("critique-counter");
      if (!el) return;
      if (counter) counter.textContent = String((timeline && timeline.length) || 0);
      el.textContent = "";
      if (!timeline || timeline.length === 0) {
        el.appendChild(_div("tool-empty", "아직 수신된 비평이 없습니다."));
        return;
      }
      for (const e of timeline) {
        const entry = _doc.createElement("div");
        entry.className = "critique-entry";
        const head = _doc.createElement("div");
        head.className = "critique-head";
        const iter = e.iteration != null ? " iter " + e.iteration : "";
        head.appendChild(_span("critique-time", _formatHMS(e.ts)));
        head.appendChild(_span("critique-phase", "[" + (e.phase || "") + iter + "]"));
        const chips = _doc.createElement("span");
        chips.className = "critique-chips";
        const counts = e.counts || {};
        for (const k of ["critical", "high", "medium", "low", "note"]) {
          if (counts[k] > 0) {
            chips.appendChild(_span("sev-chip sev-" + k,
              k.charAt(0).toUpperCase() + ":" + counts[k]));
          }
        }
        head.appendChild(chips);
        entry.appendChild(head);
        if (e.summary) {
          entry.appendChild(_div("critique-summary", e.summary));
        }
        for (const f of (e.topFindings || [])) {
          const finding = _doc.createElement("div");
          finding.className = "critique-finding";
          finding.appendChild(_span("sev-dot sev-" + (f.severity || "note")));
          finding.appendChild(_doc.createTextNode(f.note || ""));
          entry.appendChild(finding);
        }
        el.appendChild(entry);
      }
    }

    function renderFindingCounts(findings) {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      if (!findings || typeof findings !== "object") return;
      for (const k of ["critical", "high", "medium", "low", "note"]) {
        const el = _doc.getElementById("count-" + k);
        if (el) el.textContent = String(findings[k] || 0);
      }
    }

    function setBadge(cls, text) {
      if (!_doc || typeof _doc.getElementById !== "function") return;
      const el = _doc.getElementById("status-badge");
      if (!el) return;
      el.className = "badge " + (cls || "");
      el.textContent = text || "";
    }

    return {
      renderToolFeed,
      renderCritiqueTimeline,
      renderFindingCounts,
      setBadge,
    };
  }

  return { install };
});
