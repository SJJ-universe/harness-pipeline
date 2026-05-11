// Slice MA4 + MC3 (Phase D, 2026-04-27) — OrchestratorMonitorRunSummary.
//
// Centre-workspace panel: shows the currently-selected run's high-level
// state (status, template, phase + index, started time). Re-renders on
// every store publish; selection changes flow through automatically
// because the store publishes after selectRun().
//
// Per spec section 4.1 the centre workspace will eventually host the
// pipeline graph + tool/event timeline too — those are MA5 panels. This
// slice ships the summary card so MA4 has end-to-end "click run on left
// → see detail in centre" behavior.
//
// MC3 addition: when snapshot.runDetails[selectedRunId] is populated
// (by MC1's auto-hydrate), the summary card grows two extra blocks:
//   - findings preview: severity-aggregated counts + top 3 findings
//   - replayMeta indicator: "Checkpoint available · saved Xs ago"
// When runDetails is missing (cold start, before first hydrate finishes)
// the legacy MA4 card renders alone.
//
// Update lane: hot. The summary is small + always-visible; full repaint
// per snapshot is well under 1ms even for fast event bursts.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorRunSummary = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _statusClass(status) {
    if (status === "active") return "is-active";
    if (status === "paused") return "is-paused";
    return "is-idle";
  }

  /**
   * Render `started X ago`. ms is the delta to now in milliseconds.
   * Returns "방금 전" for sub-second, "Ns 전" / "Nm 전" / "Nh Mm 전".
   */
  function _formatRelative(ts, now) {
    if (!Number.isFinite(ts) || ts <= 0) return "—";
    const _now = Number.isFinite(now) ? now : Date.now();
    const ms = Math.max(0, _now - ts);
    if (ms < 1000) return "방금 전";
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "초 전";
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r === 0 ? m + "분 전" : m + "분 " + r + "초 전";
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m === 0 ? h + "시간 전" : h + "시간 " + m + "분 전";
  }

  function _selectedRun(snapshot) {
    if (!snapshot || !snapshot.selectedRunId) return null;
    const r = snapshot.runs && snapshot.runs[snapshot.selectedRunId];
    return r || null;
  }

  // Slice MC3: pull the per-run detail from snapshot.runDetails (populated
  // by MC1 auto-hydrate). Returns null when no detail is cached yet.
  function _selectedDetail(snapshot) {
    if (!snapshot || !snapshot.selectedRunId) return null;
    const d = snapshot.runDetails && snapshot.runDetails[snapshot.selectedRunId];
    return d || null;
  }

  // Slice MC3: aggregate findings severity counts from a detail payload.
  // Severity bucket order matches the legacy 5-tier dashboard.
  function _aggregateFindings(findings) {
    const out = { critical: 0, high: 0, medium: 0, low: 0, note: 0, total: 0 };
    if (!Array.isArray(findings)) return out;
    for (const f of findings) {
      if (!f) continue;
      const sev = (f.severity || "note").toLowerCase();
      if (out[sev] === undefined) out.note++;
      else out[sev]++;
      out.total++;
    }
    return out;
  }

  function create({ root, store, doc, now } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("runSummary.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("runSummary.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("runSummary.create: no document available");
    }
    // `now` is a clock injection point so tests can pin "started X 전" output.
    const _nowFn = typeof now === "function" ? now : () => Date.now();

    function _kv(label, value) {
      const dt = _doc.createElement("dt");
      dt.textContent = label;
      const dd = _doc.createElement("dd");
      dd.textContent = value == null || value === "" ? "—" : String(value);
      return [dt, dd];
    }

    function render(snapshot) {
      root.innerHTML = "";
      const run = _selectedRun(snapshot);
      const selectedId = (snapshot && snapshot.selectedRunId) || null;

      if (!run) {
        const empty = _doc.createElement("div");
        empty.className = "rs-empty";
        empty.textContent = selectedId
          ? "선택된 런(" + selectedId + ")을 찾지 못했습니다."
          : "선택된 런 없음 — 좌측 목록에서 선택하세요.";
        root.appendChild(empty);
        return;
      }

      const card = _doc.createElement("div");
      card.className = "rs-card";

      const header = _doc.createElement("div");
      header.className = "rs-header";
      const idEl = _doc.createElement("span");
      idEl.className = "rs-id";
      idEl.textContent = run.id || selectedId || "—";
      header.appendChild(idEl);
      const statusEl = _doc.createElement("span");
      statusEl.className = "rs-status " + _statusClass(run.status);
      statusEl.textContent = run.status || "idle";
      header.appendChild(statusEl);
      card.appendChild(header);

      const dl = _doc.createElement("dl");
      dl.className = "rs-meta";
      const phaseValue = run.phase
        ? run.phase + (typeof run.phaseIdx === "number" ? " (idx " + run.phaseIdx + ")" : "")
        : "—";
      const startedValue = run.startedAt
        ? _formatRelative(run.startedAt, _nowFn())
        : "—";
      const lastEventValue = run.lastEventAt
        ? _formatRelative(run.lastEventAt, _nowFn())
        : "—";
      const rows = [
        _kv("template", run.templateId || "—"),
        _kv("phase", phaseValue),
        _kv("started", startedValue),
        _kv("last event", lastEventValue),
      ];
      for (const [dt, dd] of rows) { dl.appendChild(dt); dl.appendChild(dd); }
      card.appendChild(dl);

      // ── Slice MC3: findings + replayMeta from runDetails ──
      const detail = _selectedDetail(snapshot);
      if (detail) {
        // Findings preview block.
        if (Array.isArray(detail.findings) && detail.findings.length > 0) {
          const findingsBlock = _doc.createElement("div");
          findingsBlock.className = "rs-findings";

          const fHeader = _doc.createElement("div");
          fHeader.className = "rs-findings-header";
          fHeader.textContent = "findings";
          findingsBlock.appendChild(fHeader);

          // Severity counts row.
          const counts = _aggregateFindings(detail.findings);
          const countsRow = _doc.createElement("div");
          countsRow.className = "rs-findings-counts";
          for (const sev of ["critical", "high", "medium", "low", "note"]) {
            const chip = _doc.createElement("span");
            chip.className = "rs-find-chip rs-find-" + sev;
            chip.textContent = sev.charAt(0).toUpperCase() + ":" + counts[sev];
            countsRow.appendChild(chip);
          }
          findingsBlock.appendChild(countsRow);

          // Top 3 findings preview (severity-prioritised order).
          const sorted = detail.findings.slice().sort((a, b) => {
            const order = { critical: 0, high: 1, medium: 2, low: 3, note: 4 };
            const sa = order[(a && a.severity) || "note"] != null ? order[(a && a.severity) || "note"] : 5;
            const sb = order[(b && b.severity) || "note"] != null ? order[(b && b.severity) || "note"] : 5;
            return sa - sb;
          });
          const top3 = sorted.slice(0, 3);
          if (top3.length > 0) {
            const list = _doc.createElement("ul");
            list.className = "rs-findings-top";
            for (const f of top3) {
              const li = _doc.createElement("li");
              li.className = "rs-find-item rs-find-" + ((f && f.severity) || "note");
              const sevTag = _doc.createElement("span");
              sevTag.className = "rs-find-sev";
              sevTag.textContent = "[" + ((f && f.severity) || "note") + "]";
              const msg = _doc.createElement("span");
              msg.className = "rs-find-msg";
              msg.textContent = (f && f.message) || "(no message)";
              li.appendChild(sevTag);
              li.appendChild(msg);
              list.appendChild(li);
            }
            findingsBlock.appendChild(list);
          }
          card.appendChild(findingsBlock);
        }

        // Replay metadata indicator.
        if (detail.replayMeta && detail.replayMeta.hasCheckpoint) {
          const replayBlock = _doc.createElement("div");
          replayBlock.className = "rs-replay-hint";
          const savedAtText = detail.replayMeta.savedAt
            ? _formatRelative(detail.replayMeta.savedAt, _nowFn())
            : "(timestamp unknown)";
          replayBlock.textContent = "Checkpoint available · saved " + savedAtText;
          card.appendChild(replayBlock);
        }
      }

      root.appendChild(card);
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
      _formatRelative,
      _statusClass,
      _selectedRun,
      // MC3 hooks
      _selectedDetail,
      _aggregateFindings,
    };
  }

  return {
    create,
    _formatRelative, _statusClass, _selectedRun,
    // MC3
    _selectedDetail, _aggregateFindings,
  };
});
