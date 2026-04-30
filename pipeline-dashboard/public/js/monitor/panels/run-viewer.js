// Slice UI-H9-b (Phase D / Phase E1.5, 2026-04-30) — run drill-down viewer.
// Slice UI-H10 (Phase E Round 2, 2026-04-30) — sealed evidence export.
//
// Modal-style panel that opens when the operator clicks a row in the
// "최근 결과" simple-shell card. Aggregates four data planes for a
// single runId:
//
//   1. Run metadata        — store.runs[runId] + store.runDetails[runId]
//   2. Audit chain         — GET /api/audit/runs/:runId (UI-H9-a)
//   3. Review sessions     — store.reviewSessions filtered by runId
//   4. Approvals (live)    — store.pendingApprovals filtered by runId
//
// UI-H10 adds an EXPORT button to the audit section. POST
// /api/audit/runs/:runId/export → JSON Blob → URL.createObjectURL →
// `<a download>` click. Filename = audit-<runId>-<YYYYMMDDHHMM>.json.
// Public-sector posture switches the button to a bronze accent + an
// offline-verify hint tooltip.
//
// What this does NOT do:
//   - No write surface. The viewer is read-only; resolved approvals
//     are not shown (the live `pendingApprovals` slice only carries
//     unresolved decisions). A future GOV-AUDIT-0 round will surface
//     resolved approvals via the audit chain itself, not a side query.
//   - No PII history scan. Past PII findings live only in audit verbs
//     `pii_*`; they appear naturally in the audit-chain panel.
//   - No CSV / multi-run export. The window-bundle endpoint
//     (POST /api/audit/export with windowFromAt/windowToAt) is for
//     auditor workflows that span multiple runs; the per-run drill
//     down sticks to one runId at a time.
//
// Modal lifecycle: caller invokes `handle.open(runId)` → fetch fires,
// modal becomes visible; caller invokes `handle.close()` (or operator
// clicks the × / overlay backdrop) → modal hides + cleared. The
// store subscription stays live across open/close so re-opening the
// same run renders fresh data without re-fetching.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorRunViewer = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _formatTime(value) {
    if (value == null) return "";
    let d;
    if (typeof value === "number") d = new Date(value);
    else if (typeof value === "string") d = new Date(value);
    else return "";
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }

  function _truncate(text, max) {
    if (typeof text !== "string") return "";
    if (text.length <= max) return text;
    return text.slice(0, max - 1) + "…";
  }

  // UI-H10: filename timestamp (local TZ) for the downloaded bundle.
  // Format YYYYMMDDHHMM with no separators so the filename stays safe
  // across Windows / macOS / Linux file systems.
  function _filenameTimestamp(now) {
    const d = (now instanceof Date) ? now : new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear()
      + pad(d.getMonth() + 1)
      + pad(d.getDate())
      + pad(d.getHours())
      + pad(d.getMinutes());
  }

  // UI-H10: server-error code → 한국어 운영자 메시지. _formatReviewError
  // (review-session lifecycle) is intentionally NOT reused — the export
  // surface has its own vocabulary that may diverge later (e.g. when
  // sealed bundles add per-key cosign output).
  function _formatExportError(code) {
    const mapping = {
      not_found: "이 실행에는 감사 봉투가 없습니다.",
      invalid_run_id: "잘못된 실행 ID입니다.",
      bundle_failed: "감사 봉투 생성에 실패했습니다.",
      ledger_unavailable: "감사 ledger를 사용할 수 없습니다.",
      network_error: "네트워크 오류 — 다시 시도해 주세요.",
      download_unavailable: "이 브라우저는 다운로드 기능을 지원하지 않습니다.",
      empty_response: "서버 응답이 비어 있습니다.",
      http_error: "서버에서 오류가 반환되었습니다.",
    };
    if (typeof code === "string" && mapping[code]) return mapping[code];
    return "감사 봉투 내보내기에 실패했습니다.";
  }

  function create({
    root, store, doc,
    fetchImpl,
    headers,
    onClose,
    // UI-H10 injection points (defaults read from globals when unset).
    // Tests pass stubs; production runs let runtime resolve.
    windowImpl,    // for URL.createObjectURL + Blob (defaults to window/self)
    downloadImpl,  // override the <a>.click() trigger (default: real DOM click)
    nowFn,         // clock injection for filename timestamp
    onExportSuccess, // optional callback for tests + future toast hooks
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("run-viewer.create: root must be an element");
    }
    if (!store) throw new Error("run-viewer.create: store is required");
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("run-viewer.create: no document available");
    const _fetch = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);

    let destroyed = false;
    let openRunId = null;
    let auditState = null; // { loading, error, data }
    let unsubscribe = null;
    // UI-H10 export state. exporting=true while POST in flight; error
    // carries the frozen code from _formatExportError; success is set
    // briefly after a download triggers so the operator sees the
    // offline-verify hint. _successTimer self-clears the success
    // banner after 6s so a stale "다운로드 완료" doesn't linger.
    let exportState = { exporting: false, error: null, success: null };
    let _successTimer = null;
    const _winImpl = windowImpl
      || (typeof window !== "undefined" ? window : null)
      || (typeof self !== "undefined" ? self : null);
    const _now = (typeof nowFn === "function") ? nowFn : () => new Date();

    // Modal scaffold (created lazily when first opened so the
    // closed state never paints DOM).
    let overlay = null;
    let modal = null;
    let bodyEl = null;

    function _ensureScaffold() {
      if (overlay) return;
      overlay = _doc.createElement("div");
      overlay.className = "rv-overlay rv-hidden";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "실행 상세");
      overlay.addEventListener("click", (ev) => {
        // Click on the backdrop (NOT the modal contents) closes.
        if (ev && ev.target === overlay) closeModal();
      });
      modal = _doc.createElement("div");
      modal.className = "rv-modal";
      const header = _doc.createElement("div");
      header.className = "rv-header";
      const title = _doc.createElement("h3");
      title.className = "rv-title";
      title.textContent = "실행 상세";
      header.appendChild(title);
      const closeBtn = _doc.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "rv-close";
      closeBtn.setAttribute("aria-label", "닫기");
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", closeModal);
      header.appendChild(closeBtn);
      modal.appendChild(header);
      bodyEl = _doc.createElement("div");
      bodyEl.className = "rv-body";
      modal.appendChild(bodyEl);
      overlay.appendChild(modal);
      root.appendChild(overlay);
    }

    function _section(title, kind) {
      const sec = _doc.createElement("section");
      sec.className = "rv-section rv-section-" + kind;
      const h = _doc.createElement("h4");
      h.className = "rv-section-title";
      h.textContent = title;
      sec.appendChild(h);
      return sec;
    }

    function _kv(label, value) {
      const row = _doc.createElement("div");
      row.className = "rv-kv";
      const k = _doc.createElement("span");
      k.className = "rv-kv-label";
      k.textContent = label;
      const v = _doc.createElement("span");
      v.className = "rv-kv-value";
      v.textContent = value;
      row.appendChild(k);
      row.appendChild(v);
      return row;
    }

    function _renderRun(runId) {
      const sec = _section("실행", "run");
      const snap = store.snapshot();
      const run = ((snap.runs || {})[runId]) || null;
      const detail = ((snap.runDetails || {})[runId]) || null;
      if (!run && !detail) {
        const empty = _doc.createElement("div");
        empty.className = "rv-empty";
        empty.textContent = `runId "${runId}" 정보가 없습니다`;
        sec.appendChild(empty);
        return sec;
      }
      sec.appendChild(_kv("Run ID", runId));
      if (run && run.label) sec.appendChild(_kv("Label", String(run.label)));
      if (run && run.templateId) sec.appendChild(_kv("Template", String(run.templateId)));
      if (run && run.status) sec.appendChild(_kv("상태", String(run.status)));
      if (run && run.phase) sec.appendChild(_kv("Phase", String(run.phase)));
      if (run && run.startedAt) sec.appendChild(_kv("시작", _formatTime(run.startedAt)));
      if (run && run.completedAt) sec.appendChild(_kv("완료", _formatTime(run.completedAt)));
      if (detail && detail.verifyStatus) {
        sec.appendChild(_kv("Verify", String(detail.verifyStatus)));
      }
      return sec;
    }

    function _renderAudit() {
      const sec = _section("감사 로그", "audit");
      if (!auditState) {
        const empty = _doc.createElement("div");
        empty.className = "rv-empty";
        empty.textContent = "감사 로그를 불러오지 않았습니다";
        sec.appendChild(empty);
        return sec;
      }
      if (auditState.loading) {
        const loading = _doc.createElement("div");
        loading.className = "rv-loading";
        loading.textContent = "불러오는 중…";
        sec.appendChild(loading);
        return sec;
      }
      if (auditState.error) {
        const err = _doc.createElement("div");
        err.className = "rv-error";
        err.textContent = "감사 로그 오류: " + auditState.error;
        sec.appendChild(err);
        return sec;
      }
      const data = auditState.data || {};
      const summary = _doc.createElement("div");
      summary.className = "rv-audit-summary";
      const chainOk = data.chain && data.chain.valid !== false;
      const chainBadge = _doc.createElement("span");
      chainBadge.className = "rv-chain-badge rv-chain-" + (chainOk ? "ok" : "broken");
      chainBadge.textContent = chainOk ? "체인 검증 OK" : "체인 손상";
      summary.appendChild(chainBadge);
      const counts = _doc.createElement("span");
      counts.className = "rv-audit-counts";
      counts.textContent = `${data.returned ?? 0} / ${data.total ?? 0} 항목`;
      summary.appendChild(counts);
      sec.appendChild(summary);

      // ── UI-H10: sealed evidence export ─────────────────────────
      // Posture detection from store.accountStatus.deployment. The
      // public-sector branch hard-codes a stronger label + bronze tone
      // CSS class so the operator can never miss the "this is the
      // auditor-grade copy" signal in a screenshot.
      const snap = store.snapshot();
      const dep = (snap.accountStatus && snap.accountStatus.deployment) || null;
      const isPublicSector = !!(dep && dep.publicSector === true);
      const exportRow = _doc.createElement("div");
      exportRow.className = "rv-export-row";
      const exportBtn = _doc.createElement("button");
      exportBtn.type = "button";
      exportBtn.className = "rv-export-btn"
        + (isPublicSector ? " rv-export-btn-public-sector" : "");
      exportBtn.textContent = isPublicSector
        ? "🛡 감사 봉투 내보내기 (공공기관)"
        : "감사 봉투 내보내기";
      exportBtn.setAttribute("aria-label", "감사 봉투 다운로드");
      if (isPublicSector) {
        exportBtn.setAttribute("title",
          "오프라인 검증: node scripts/verify-auditor-bundle.js <파일>");
      }
      if (exportState.exporting) {
        exportBtn.setAttribute("disabled", "disabled");
        exportBtn.textContent = "내보내는 중…";
      }
      exportBtn.addEventListener("click", () => {
        // Snapshot openRunId at click time — the audit fetch may be
        // for a different runId if the modal got reopened mid-flight.
        if (openRunId) _exportBundle(openRunId);
      });
      exportRow.appendChild(exportBtn);

      // Status line — error / success / offline-verify hint.
      if (exportState.error) {
        const errLine = _doc.createElement("span");
        errLine.className = "rv-export-error";
        errLine.setAttribute("role", "alert");
        errLine.textContent = _formatExportError(exportState.error);
        exportRow.appendChild(errLine);
      } else if (exportState.success) {
        const okLine = _doc.createElement("span");
        okLine.className = "rv-export-success";
        okLine.setAttribute("role", "status");
        const filename = exportState.success.filename || "감사 봉투";
        okLine.textContent = isPublicSector
          ? `${filename} 다운로드됨 — 오프라인 검증: node scripts/verify-auditor-bundle.js <파일>`
          : `${filename} 다운로드됨`;
        exportRow.appendChild(okLine);
      } else if (isPublicSector) {
        const hint = _doc.createElement("span");
        hint.className = "rv-export-hint";
        hint.textContent = "공공기관 모드 — 봉투는 HMAC-SHA256 봉인됩니다.";
        exportRow.appendChild(hint);
      }
      sec.appendChild(exportRow);

      const list = _doc.createElement("ul");
      list.className = "rv-audit-list";
      list.setAttribute("role", "list");
      const entries = Array.isArray(data.entries) ? data.entries.slice().reverse() : [];
      for (const entry of entries.slice(0, 50)) {
        const li = _doc.createElement("li");
        li.className = "rv-audit-row";
        const t = _doc.createElement("span");
        t.className = "rv-audit-time";
        t.textContent = _formatTime(entry.at) || (entry.at || "");
        li.appendChild(t);
        const ty = _doc.createElement("span");
        ty.className = "rv-audit-type";
        ty.textContent = entry.type || "";
        li.appendChild(ty);
        list.appendChild(li);
      }
      sec.appendChild(list);
      if (entries.length > 50) {
        const more = _doc.createElement("div");
        more.className = "rv-more";
        more.textContent = `+${entries.length - 50}개 더 (감사 export로 전체 확인)`;
        sec.appendChild(more);
      }
      return sec;
    }

    function _renderReviewSessions(runId) {
      const sec = _section("리뷰 세션", "review");
      const snap = store.snapshot();
      const sessions = snap.reviewSessions || new Map();
      const ours = [];
      const iter = typeof sessions.values === "function" ? sessions.values() : Object.values(sessions);
      for (const s of iter) {
        if (!s) continue;
        if (s.runId === runId) ours.push(s);
      }
      if (ours.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "rv-empty";
        empty.textContent = "이 실행에 연결된 리뷰 세션이 없습니다";
        sec.appendChild(empty);
        return sec;
      }
      const list = _doc.createElement("ul");
      list.className = "rv-review-list";
      list.setAttribute("role", "list");
      for (const s of ours) {
        const li = _doc.createElement("li");
        li.className = "rv-review-row";
        const label = _doc.createElement("span");
        label.className = "rv-review-label";
        label.textContent = s.label || s.sessionId || s.id || "";
        li.appendChild(label);
        const state = _doc.createElement("span");
        state.className = "rv-review-state";
        state.textContent = String(s.state || "");
        li.appendChild(state);
        list.appendChild(li);
      }
      sec.appendChild(list);
      return sec;
    }

    function _renderApprovals(runId) {
      const sec = _section("승인", "approvals");
      const snap = store.snapshot();
      const pending = snap.pendingApprovals || new Map();
      const ours = [];
      const iter = typeof pending.values === "function" ? pending.values() : Object.values(pending);
      for (const a of iter) {
        if (!a) continue;
        if (a.runId === runId) ours.push(a);
      }
      if (ours.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "rv-empty";
        empty.textContent = "이 실행에 대기 중인 승인이 없습니다";
        sec.appendChild(empty);
        return sec;
      }
      const list = _doc.createElement("ul");
      list.className = "rv-approval-list";
      list.setAttribute("role", "list");
      for (const a of ours) {
        const li = _doc.createElement("li");
        li.className = "rv-approval-row";
        const tool = _doc.createElement("span");
        tool.className = "rv-approval-tool";
        tool.textContent = a.tool || "";
        li.appendChild(tool);
        const summary = _doc.createElement("span");
        summary.className = "rv-approval-summary";
        summary.textContent = _truncate(a.argsSummary || "", 80);
        li.appendChild(summary);
        list.appendChild(li);
      }
      sec.appendChild(list);
      return sec;
    }

    function _render() {
      if (destroyed) return;
      _ensureScaffold();
      bodyEl.innerHTML = "";
      if (!openRunId) return;
      bodyEl.appendChild(_renderRun(openRunId));
      bodyEl.appendChild(_renderReviewSessions(openRunId));
      bodyEl.appendChild(_renderApprovals(openRunId));
      bodyEl.appendChild(_renderAudit());
    }

    // ── UI-H10: export wiring ────────────────────────────────────
    // Sealed-bundle download: POST /api/audit/runs/:runId/export →
    // { ok, bundle } → JSON Blob → URL.createObjectURL → <a download>.
    // _exportBundle owns the network + state plumbing; _triggerDownload
    // owns the DOM mechanics so tests can substitute downloadImpl
    // without touching real Blob/URL globals.

    function _scheduleSuccessClear() {
      if (_successTimer) {
        try { clearTimeout(_successTimer); } catch (_) {}
        _successTimer = null;
      }
      // Auto-clear the success banner after 6s. If the operator keeps
      // the modal open we don't want a stale "다운로드 완료" lingering.
      try {
        _successTimer = setTimeout(() => {
          if (destroyed) return;
          if (exportState.success) {
            exportState = { exporting: false, error: null, success: null };
            _render();
          }
        }, 6000);
      } catch (_) { /* defensive — non-Node test envs without setTimeout */ }
    }

    function _triggerDownload(filename, bundle) {
      // Override hook for tests + future toast/preview integrations.
      if (typeof downloadImpl === "function") {
        try { downloadImpl({ filename, bundle }); return true; }
        catch (_) { return false; }
      }
      // Real browser path.
      if (!_winImpl || !_winImpl.URL || typeof _winImpl.URL.createObjectURL !== "function") {
        return false;
      }
      const BlobCtor = (_winImpl && _winImpl.Blob)
        || (typeof Blob !== "undefined" ? Blob : null);
      if (!BlobCtor) return false;
      let url;
      try {
        const blob = new BlobCtor([JSON.stringify(bundle, null, 2)], { type: "application/json" });
        url = _winImpl.URL.createObjectURL(blob);
      } catch (_) {
        return false;
      }
      const a = _doc.createElement("a");
      a.href = url;
      a.download = filename;
      a.style && (a.style.display = "none");
      // Some test stubs can append/click but never paint — guard each
      // step. In a real browser the synthetic click() invokes the
      // download dialog; revokeObjectURL frees the blob 1s later
      // (longer than any sane click handler).
      try { root.appendChild(a); } catch (_) {}
      try { typeof a.click === "function" && a.click(); } catch (_) {}
      try { root.removeChild(a); } catch (_) {}
      try { setTimeout(() => { try { _winImpl.URL.revokeObjectURL(url); } catch (_) {} }, 1000); } catch (_) {}
      return true;
    }

    async function _exportBundle(runId) {
      if (destroyed) return;
      if (exportState.exporting) return;
      exportState = { exporting: true, error: null, success: null };
      _render();
      if (typeof _fetch !== "function") {
        exportState = { exporting: false, error: "network_error", success: null };
        _render();
        return;
      }
      let res;
      try {
        const reqHeaders = Object.assign(
          { "Content-Type": "application/json" }, headers || {},
        );
        res = await _fetch(
          "/api/audit/runs/" + encodeURIComponent(runId) + "/export",
          { method: "POST", headers: reqHeaders, body: "{}" },
        );
      } catch (_) {
        exportState = { exporting: false, error: "network_error", success: null };
        _render();
        return;
      }
      if (!res) {
        exportState = { exporting: false, error: "network_error", success: null };
        _render();
        return;
      }
      if (!res.ok) {
        // Try to map server's frozen error code; fall back to http_error.
        let code = "http_error";
        try {
          const errBody = typeof res.json === "function" ? await res.json() : null;
          if (errBody && typeof errBody.error === "string") code = errBody.error;
        } catch (_) { /* defensive */ }
        exportState = { exporting: false, error: code, success: null };
        _render();
        return;
      }
      let body = null;
      try { body = typeof res.json === "function" ? await res.json() : null; }
      catch (_) { body = null; }
      if (!body || !body.bundle) {
        exportState = { exporting: false, error: "empty_response", success: null };
        _render();
        return;
      }
      const filename = `audit-${runId}-${_filenameTimestamp(_now())}.json`;
      const ok = _triggerDownload(filename, body.bundle);
      if (!ok) {
        exportState = { exporting: false, error: "download_unavailable", success: null };
        _render();
        return;
      }
      exportState = {
        exporting: false,
        error: null,
        success: { at: Date.now(), filename, runId },
      };
      _render();
      _scheduleSuccessClear();
      try {
        if (typeof onExportSuccess === "function") {
          onExportSuccess({ filename, runId, bundle: body.bundle });
        }
      } catch (_) { /* defensive */ }
    }

    async function _fetchAudit(runId) {
      auditState = { loading: true, error: null, data: null };
      _render();
      if (typeof _fetch !== "function") {
        auditState = { loading: false, error: "fetch unavailable", data: null };
        _render();
        return;
      }
      try {
        const reqHeaders = Object.assign({}, headers || {});
        const url = "/api/audit/runs/" + encodeURIComponent(runId);
        const res = await _fetch(url, { method: "GET", headers: reqHeaders });
        if (!res) {
          auditState = { loading: false, error: "no_response", data: null };
        } else if (res.status === 404) {
          auditState = { loading: false, error: null, data: { entries: [], total: 0, returned: 0, chain: { valid: true } } };
        } else if (!res.ok) {
          auditState = { loading: false, error: `http_${res.status}`, data: null };
        } else {
          const body = await res.json();
          auditState = { loading: false, error: null, data: body };
        }
      } catch (err) {
        auditState = { loading: false, error: err && err.message ? err.message : "network_error", data: null };
      }
      _render();
    }

    function openModal(runId) {
      if (destroyed) return;
      if (typeof runId !== "string" || runId.length === 0) return;
      _ensureScaffold();
      openRunId = runId;
      overlay.classList.remove("rv-hidden");
      // Subscribe lazily — only while open. The drill-down panel is
      // re-rendered on store changes (e.g. new approval lands while
      // the operator is reading), but when closed we don't pay
      // the subscription overhead.
      if (!unsubscribe) unsubscribe = store.subscribe(_render);
      _render();
      // Kick off audit fetch (live, side-effecting).
      _fetchAudit(runId);
    }

    function closeModal() {
      if (destroyed) return;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      openRunId = null;
      auditState = null;
      // UI-H10: clear export banner on close so re-opening any run
      // starts fresh. The success-clear timer is also cancelled to
      // prevent a leaked render after close.
      exportState = { exporting: false, error: null, success: null };
      if (_successTimer) {
        try { clearTimeout(_successTimer); } catch (_) {}
        _successTimer = null;
      }
      if (overlay) {
        overlay.classList.add("rv-hidden");
        if (bodyEl) bodyEl.innerHTML = "";
      }
      try { typeof onClose === "function" && onClose(); } catch (_) { /* defensive */ }
    }

    return {
      open: openModal,
      close: closeModal,
      destroy() {
        destroyed = true;
        if (unsubscribe) { unsubscribe(); unsubscribe = null; }
        if (_successTimer) {
          try { clearTimeout(_successTimer); } catch (_) {}
          _successTimer = null;
        }
        if (overlay && overlay.parentNode === root) {
          try { root.removeChild(overlay); } catch (_) {}
        }
        overlay = null;
        modal = null;
        bodyEl = null;
      },
      _state() { return { openRunId, auditState, exportState }; },
      // UI-H10: test hook — kick off an export without a click. Tests
      // (and a future toast preview) can drive the export flow without
      // synthesizing DOM events.
      _exportNow(runId) { return _exportBundle(runId || openRunId); },
    };
  }

  return { create, _formatTime, _truncate, _formatExportError, _filenameTimestamp };
});
