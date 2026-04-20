// Slice F (v5) — Analytics panel (per-phase duration + gate counters).
//
// Two-layer design (same as toast.js / run-history.js):
//   1. Pure render helpers — `renderTable(stateSnapshot, template)` and
//      `renderTimeline(stateSnapshot, template)` return HTML/SVG strings.
//      These are directly testable from Node without a DOM.
//   2. `install({ overlayId, bodyId, timelineId, openBtnId, closeBtnId })`
//      does the browser-side wiring. It stores the mount targets on module
//      state and attaches click/Escape handlers.
//
// Data contract (matches PipelineExecutor.getReplaySnapshot()):
//   {
//     stateSnapshot: { phases: { [id]: { attempts, totalDurationMs, ... } } },
//     template: { phases: [{ id, name, label }] }
//   }
// Also accepts raw state snapshots (no wrapper) and the full
// /api/runs/current response for convenience.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    root.HarnessAnalyticsPanel = api;
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  const STATE = {
    snapshot: null, // { stateSnapshot, template } — freshest payload
    mountedEls: null, // { overlay, body, timeline, openBtn, closeBtn }
  };

  function _escape(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function _phaseName(template, phaseId) {
    if (!template || !Array.isArray(template.phases)) return phaseId;
    const p = template.phases.find((x) => x.id === phaseId);
    return p ? `${phaseId} · ${p.name || p.label || ""}`.trim() : phaseId;
  }

  function renderTable(stateSnapshot, template) {
    if (!stateSnapshot || !stateSnapshot.phases) {
      return '<div class="analytics-empty">표시할 run 데이터가 없습니다.</div>';
    }
    const entries = Object.entries(stateSnapshot.phases);
    if (entries.length === 0) {
      return '<div class="analytics-empty">아직 완료된 phase가 없습니다.</div>';
    }

    const head =
      "<thead><tr>" +
      '<th scope="col">Phase</th>' +
      '<th scope="col">Attempt</th>' +
      '<th scope="col">Duration</th>' +
      '<th scope="col">Gate</th>' +
      '<th scope="col">Reason</th>' +
      "</tr></thead>";

    let rows = "";
    for (const [id, p] of entries) {
      const attempts = p.attempts || [];
      const phaseLabel = _escape(_phaseName(template, id));
      if (attempts.length === 0) {
        rows +=
          `<tr class="analytics-row-empty">` +
          `<td>${phaseLabel}</td>` +
          `<td colspan="4"><span class="analytics-muted">(no attempts)</span></td>` +
          "</tr>";
        continue;
      }
      attempts.forEach((a, i) => {
        const durationLabel =
          a.durationMs === null ? "(open)" : `${a.durationMs}ms`;
        const gateLabel =
          a.gatePass === null ? "—" : a.gatePass ? "pass" : "fail";
        const gateClass =
          a.gatePass === true
            ? "analytics-gate-pass"
            : a.gatePass === false
            ? "analytics-gate-fail"
            : "analytics-gate-none";
        rows +=
          `<tr>` +
          `<td>${i === 0 ? phaseLabel : ""}</td>` +
          `<td>#${i + 1}</td>` +
          `<td>${_escape(durationLabel)}</td>` +
          `<td class="${gateClass}">${_escape(gateLabel)}</td>` +
          `<td>${_escape(a.reason || "—")}</td>` +
          "</tr>";
      });
      const gateSummary = `gate ${p.gateAttempts || 0} / fail ${p.gateFailures || 0}`;
      rows +=
        `<tr class="analytics-row-total">` +
        `<td>${phaseLabel} · 합계</td>` +
        `<td>${attempts.length}회</td>` +
        `<td>${p.totalDurationMs || 0}ms</td>` +
        `<td colspan="2">${_escape(gateSummary)}</td>` +
        "</tr>";
    }

    return `<table class="analytics-table" role="table">${head}<tbody>${rows}</tbody></table>`;
  }

  function renderTimeline(stateSnapshot, template) {
    if (!stateSnapshot || !stateSnapshot.phases) return "";
    const phases = Object.entries(stateSnapshot.phases).filter(
      ([, p]) => (p.totalDurationMs || 0) > 0
    );
    if (phases.length === 0) {
      return '<div class="analytics-empty analytics-timeline-empty">완료된 duration 없음</div>';
    }
    const maxDur = Math.max(...phases.map(([, p]) => p.totalDurationMs || 0));
    const rowH = 26;
    const leftPad = 60;
    const rightPad = 80;
    const vbW = 500;
    const barMaxW = vbW - leftPad - rightPad;
    const scale = maxDur > 0 ? barMaxW / maxDur : 0;
    const height = phases.length * rowH + 20;

    let body = "";
    phases.forEach(([id, p], i) => {
      const y = 10 + i * rowH;
      const w = Math.max(2, Math.round((p.totalDurationMs || 0) * scale));
      const failed = (p.gateFailures || 0) > 0;
      const barClass = failed
        ? "analytics-timeline-bar analytics-timeline-bar-warn"
        : "analytics-timeline-bar";
      const label = _escape(_phaseName(template, id));
      body +=
        `<text x="5" y="${y + 16}" class="analytics-timeline-label">${label}</text>` +
        `<rect x="${leftPad}" y="${y}" width="${w}" height="20" class="${barClass}" rx="2"/>` +
        `<text x="${leftPad + w + 4}" y="${y + 16}" class="analytics-timeline-value">` +
        `${p.totalDurationMs || 0}ms</text>`;
    });

    return `<svg class="analytics-timeline" viewBox="0 0 ${vbW} ${height}" role="img" aria-label="Phase duration timeline">${body}</svg>`;
  }

  function _normalizeSnapshot(payload) {
    if (!payload) return null;
    if (payload.stateSnapshot) return payload;
    if (payload.snapshot && payload.snapshot.stateSnapshot) return payload.snapshot;
    if (payload.phases) return { stateSnapshot: payload, template: null };
    return null;
  }

  function setSnapshot(payload) {
    STATE.snapshot = _normalizeSnapshot(payload);
    _render();
  }

  function _render() {
    if (!STATE.mountedEls) return;
    const { body, timeline } = STATE.mountedEls;
    const snap = STATE.snapshot;
    const ss = snap?.stateSnapshot || null;
    const tpl = snap?.template || null;
    body.innerHTML = renderTable(ss, tpl);
    timeline.innerHTML = renderTimeline(ss, tpl);
  }

  async function _fetchCurrent() {
    try {
      if (typeof fetch !== "function") return null;
      const res = await fetch("/api/runs/current", { credentials: "same-origin" });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.snapshot || null;
    } catch (_) {
      return null;
    }
  }

  async function open() {
    if (!STATE.mountedEls) return;
    STATE.mountedEls.overlay.classList.remove("is-hidden");
    if (!STATE.snapshot) {
      const s = await _fetchCurrent();
      if (s) setSnapshot(s);
      else _render();
    } else {
      _render();
    }
  }

  function close() {
    if (!STATE.mountedEls) return;
    STATE.mountedEls.overlay.classList.add("is-hidden");
  }

  function install({ overlayId, bodyId, timelineId, openBtnId, closeBtnId } = {}) {
    if (typeof document === "undefined") return api;
    const overlay = document.getElementById(overlayId);
    const body = document.getElementById(bodyId);
    const timeline = document.getElementById(timelineId);
    const openBtn = openBtnId ? document.getElementById(openBtnId) : null;
    const closeBtn = closeBtnId ? document.getElementById(closeBtnId) : null;
    if (!overlay || !body || !timeline) return api;
    STATE.mountedEls = { overlay, body, timeline, openBtn, closeBtn };
    if (openBtn) openBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.classList.contains("is-hidden")) close();
    });
    return api;
  }

  const api = {
    install,
    open,
    close,
    setSnapshot,
    renderTable,
    renderTimeline,
    // Expose an internal state reset for tests — does NOT rip down the
    // mounted DOM, only the cached snapshot reference.
    _resetSnapshotForTests: () => { STATE.snapshot = null; },
  };
  return api;
});
