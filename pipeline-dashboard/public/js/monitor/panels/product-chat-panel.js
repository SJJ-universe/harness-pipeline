// Slice AGENT-DESKTOP-0-b/c/d (Phase 2 chat-first UX, 2026-05-06)
// — product-chat-panel.
//
// Sticky bottom strip ~200px tall. The composer (textarea + 보내기)
// is operator's primary entry point. On submit:
//
//   1. Append user bubble to history
//   2. POST /api/chat/intent (existing endpoint; backend slice -0-a)
//   3. Render returned proposal as a card with Approve / Edit / Cancel
//   4. Approve → fire underlying action via OrchestratorShellActions[id]
//      (existing dispatcher; no new execution path)
//   5. Append [system] confirmation bubble
//
// CRITICAL: this panel never executes anything itself. All actions
// flow through the existing /api/* endpoints + the existing audit
// chain + the existing approval queue. The chat is a facade.
//
// Public-sector mode: blocked_pii proposal renders with NO Approve
// button — only Cancel. Standard mode: warned but Approve allowed.
//
// Mounted by product-shell.js into a NEW chatMount region appended
// to the workspace. Script load: index.html (after product-shell.js,
// before product-shell-init.js). UMD wrapper for node:test parity
// with every other panel module.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorProductChatPanel = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Recommended quick-action chips shown when history is empty. Each
  // chip is a frozen text — clicking pre-fills the composer + submits
  // immediately. Frozen list (NOT LLM-driven) per plan §11 risk row.
  const RECOMMENDED_CHIPS = Object.freeze([
    "Codex 연결 확인",
    "최근 실행 기록 보여줘",
    "현재 상태 알려줘",
  ]);

  // Risk pill labels + Korean copy for the proposal card.
  const RISK_LABEL = Object.freeze({
    low:    "위험도 낮음",
    medium: "위험도 중간",
    high:   "위험도 높음",
  });

  // Action ids that the panel knows how to dispatch on Approve. Maps
  // intent → handler key in OrchestratorShellActions (which already exists
  // and routes via product-shell._dispatch). Unknown intents render
  // the proposal but disable Approve (safety: never fire something we
  // can't trace).
  const INTENT_TO_DISPATCH = Object.freeze({
    "codex_verify":  "codex-verify",
    // LEGACY-VIEW-REMOVE-0 (2026-05-11): open_history + open_metrics
    // intents are removed — the analytics page and run-history page
    // they targeted lived only in the legacy view (now retired). If
    // the LLM still emits these intents the proposal will render with
    // Approve disabled (safety: never fire something we can't trace).
    "show_status":   "show_status",     // handled inline, see _onApprove
    "start_run":     "pipeline-start",
    "general_task":  "general-task",    // chat-specific dispatch (calls /api/pipeline/general-run with parameters)
  });

  function create(opts) {
    if (!opts || typeof opts !== "object") {
      throw new Error("OrchestratorProductChatPanel.create: opts required");
    }
    const root = opts.root;
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("OrchestratorProductChatPanel.create: root must be an element");
    }
    const _doc = opts.doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) {
      throw new Error("OrchestratorProductChatPanel.create: no document available");
    }

    const _fetch = opts.fetchImpl
      || (typeof fetch === "function" ? fetch : null);
    const _onActionClick = (typeof opts.onActionClick === "function")
      ? opts.onActionClick
      : function () { /* no-op default */ };
    const _toast = (typeof opts.toastFn === "function")
      ? opts.toastFn
      : function () { /* no-op default */ };
    // Endpoint is configurable so tests can point to a stub server.
    const _intentUrl = opts.intentUrl || "/api/chat/intent";

    // UX-POLISH-1 (2026-05-11): store + selectors + i18n for progress
    // milestone subscription. All three are optional — the chat panel
    // works without them (no progress bubbles, manual operator flow).
    const _store = opts.store || null;
    const _selectors = opts.selectors || null;
    const _i18n = opts.i18n
      || (typeof window !== "undefined" && window.OrchestratorI18n)
      || null;
    function _t(key, fallback, params) {
      let s;
      if (_i18n && typeof _i18n.t === "function") {
        try { s = _i18n.t(key); } catch (_) { s = null; }
      }
      // OrchestratorI18n.t returns the key itself on miss (i18n.js:61).
      // Treat that as "missing" so the fallback wins for UX-POLISH-1
      // keys until they're populated in every locale table.
      if (s == null || s === key) s = fallback;
      if (params && typeof params === "object" && typeof s === "string") {
        for (const k of Object.keys(params)) {
          s = s.replace(new RegExp("\\{" + k + "\\}", "g"), String(params[k]));
        }
      }
      return s;
    }

    // ── DOM build ────────────────────────────────────────────────

    const chat = _doc.createElement("div");
    chat.className = "prod-chat";
    chat.setAttribute("data-region", "chat");
    chat.setAttribute("role", "region");
    chat.setAttribute("aria-label", "자연어 명령 채팅");

    const history = _doc.createElement("div");
    history.className = "prod-chat-history";
    history.setAttribute("data-chat-slot", "history");
    history.setAttribute("role", "log");
    history.setAttribute("aria-live", "polite");
    chat.appendChild(history);

    // Recommended-chips row. Visible when history is empty; hidden once
    // the operator has submitted at least one message.
    const recommendedRow = _doc.createElement("div");
    recommendedRow.className = "prod-chat-recommended";
    recommendedRow.setAttribute("data-chat-slot", "recommended");
    RECOMMENDED_CHIPS.forEach(function (label) {
      const chip = _doc.createElement("button");
      chip.type = "button";
      chip.className = "prod-chat-chip";
      chip.setAttribute("data-chat-action", "recommended");
      chip.textContent = label;
      chip.addEventListener("click", function () {
        textarea.value = label;
        _submit();
      });
      recommendedRow.appendChild(chip);
    });
    chat.appendChild(recommendedRow);

    const composer = _doc.createElement("div");
    composer.className = "prod-chat-composer";
    composer.setAttribute("data-chat-slot", "composer");

    const textarea = _doc.createElement("textarea");
    textarea.className = "prod-chat-input";
    textarea.id = "chat-input";
    textarea.setAttribute("rows", "2");
    textarea.setAttribute("placeholder",
      "무엇을 도와드릴까요? (예: 이 프로젝트 배포 가능한지 점검해줘)");
    textarea.setAttribute("aria-label", "채팅 입력");
    textarea.addEventListener("keydown", function (event) {
      // Enter without Shift submits; Shift+Enter inserts newline (textarea default).
      if (event && event.key === "Enter" && !event.shiftKey) {
        event.preventDefault && event.preventDefault();
        _submit();
      }
    });
    composer.appendChild(textarea);

    const sendBtn = _doc.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "prod-chat-send";
    sendBtn.setAttribute("data-chat-action", "send");
    sendBtn.textContent = "보내기";
    sendBtn.addEventListener("click", _submit);
    composer.appendChild(sendBtn);

    chat.appendChild(composer);

    root.appendChild(chat);

    // ── Helpers ──────────────────────────────────────────────────

    function _appendMessage(role, body) {
      const msg = _doc.createElement("div");
      msg.className = "prod-chat-message";
      msg.setAttribute("data-role", role);
      if (typeof body === "string") {
        msg.textContent = body;
      } else if (body && body.appendChild) {
        msg.appendChild(body);
      }
      history.appendChild(msg);
      // Hide recommended chips once history has any user/proposal entries.
      if (recommendedRow.style) recommendedRow.style.display = "none";
      return msg;
    }

    function _appendSystem(text) {
      _appendMessage("system", text);
    }

    function _renderProposalCard(proposal, auditEntryId) {
      const wrap = _doc.createElement("div");
      wrap.className = "prod-chat-proposal";
      wrap.setAttribute("data-intent", proposal.intent || "unknown");
      wrap.setAttribute("data-risk", proposal.riskLevel || "unknown");

      // Header row — intent badge + risk pill
      const header = _doc.createElement("div");
      header.className = "prod-chat-proposal-header";
      const intentBadge = _doc.createElement("span");
      intentBadge.className = "prod-chat-proposal-intent";
      intentBadge.textContent = proposal.intent || "unknown";
      header.appendChild(intentBadge);
      const riskPill = _doc.createElement("span");
      riskPill.className = "prod-chat-proposal-risk";
      riskPill.setAttribute("data-risk", proposal.riskLevel || "unknown");
      riskPill.textContent = RISK_LABEL[proposal.riskLevel] || proposal.riskLevel;
      header.appendChild(riskPill);
      wrap.appendChild(header);

      // Summary
      const summary = _doc.createElement("p");
      summary.className = "prod-chat-proposal-summary";
      summary.setAttribute("data-chat-slot", "summary");
      summary.textContent = proposal.summary || "";
      wrap.appendChild(summary);

      // PII warning (when present)
      if (proposal.piiContext && proposal.piiContext.hasPii) {
        const warn = _doc.createElement("div");
        warn.className = "prod-chat-proposal-pii-warn";
        warn.setAttribute("data-chat-slot", "pii-warn");
        const types = (proposal.piiContext.findings || [])
          .map(function (f) { return f && f.type; })
          .filter(Boolean)
          .join(", ");
        warn.textContent = "⚠ 개인정보가 감지되었습니다 (" + (types || "type 미상") + ")";
        wrap.appendChild(warn);
      }

      // Classifier trace (debug; small font, dimmed)
      const trace = _doc.createElement("div");
      trace.className = "prod-chat-proposal-trace";
      trace.setAttribute("data-chat-slot", "trace");
      trace.textContent = "분류 근거: " + (proposal.classifierTrace || "n/a");
      wrap.appendChild(trace);

      // Action buttons row
      const actions = _doc.createElement("div");
      actions.className = "prod-chat-proposal-actions";

      // Cancel — always available
      const cancelBtn = _doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "prod-chat-proposal-btn cancel";
      cancelBtn.setAttribute("data-chat-action", "cancel");
      cancelBtn.textContent = "취소";
      cancelBtn.addEventListener("click", function () {
        _onCancel(proposal, auditEntryId, wrap);
      });
      actions.appendChild(cancelBtn);

      // Edit — only for general_task in v1 (other intents have no
      // editable parameters). Future slices add per-intent editors.
      if (proposal.intent === "general_task") {
        const editBtn = _doc.createElement("button");
        editBtn.type = "button";
        editBtn.className = "prod-chat-proposal-btn edit";
        editBtn.setAttribute("data-chat-action", "edit");
        editBtn.textContent = "수정";
        editBtn.addEventListener("click", function () {
          _onEdit(proposal, wrap);
        });
        actions.appendChild(editBtn);
      }

      // Approve — only when the proposal allows it. blocked_* proposals
      // set requiresApproval=false and we omit the Approve button.
      if (proposal.requiresApproval === true) {
        const approveBtn = _doc.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "prod-chat-proposal-btn approve";
        approveBtn.setAttribute("data-chat-action", "approve");
        approveBtn.textContent = "승인";
        approveBtn.addEventListener("click", function () {
          _onApprove(proposal, auditEntryId, wrap);
        });
        actions.appendChild(approveBtn);
      } else {
        // Render a disabled hint button so the operator sees why
        // Approve is missing (rather than "where did the button go").
        const blockedNote = _doc.createElement("span");
        blockedNote.className = "prod-chat-proposal-blocked-note";
        blockedNote.textContent = (proposal.intent === "blocked_pii")
          ? "공공기관 모드: 외부 AI 전송 차단됨"
          : "승인 불가";
        actions.appendChild(blockedNote);
      }

      wrap.appendChild(actions);
      return _appendMessage("proposal", wrap);
    }

    // Submit textarea contents to /api/chat/intent and render the
    // resulting proposal card. Empty textarea is a silent no-op.
    function _submit() {
      const text = (textarea.value || "").trim();
      if (!text) return;
      _appendMessage("user", text);
      textarea.value = "";

      if (typeof _fetch !== "function") {
        _appendSystem("⚠ 네트워크 사용 불가 (fetch). 새로고침 후 다시 시도하세요.");
        return;
      }

      _fetch(_intentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      })
        .then(function (r) {
          return r.json().then(function (body) {
            return { status: r.status, body: body };
          });
        })
        .then(function (resp) {
          const proposal = resp.body && resp.body.proposal;
          const auditId = resp.body && resp.body.audit && resp.body.audit.entryId;
          if (!proposal) {
            _appendSystem("⚠ 응답을 해석할 수 없습니다 (status=" + resp.status + ").");
            return;
          }
          _renderProposalCard(proposal, auditId);
        })
        .catch(function (err) {
          _appendSystem("⚠ 요청 실패: "
            + (err && err.message ? err.message : String(err)));
        });
    }

    function _onApprove(proposal, _auditEntryId, cardEl) {
      // Disable the buttons + add "승인됨" badge so re-clicks don't
      // fire the action twice.
      _disableCardButtons(cardEl, "승인됨");

      const dispatchKey = INTENT_TO_DISPATCH[proposal.intent];
      if (!dispatchKey) {
        _appendSystem("⚠ 알 수 없는 intent (" + proposal.intent + ") — 실행 보류.");
        return;
      }

      // show_status is handled inline (no backend call) — render a
      // summary bubble of the current store snapshot.
      if (proposal.intent === "show_status") {
        _renderStatusSummary();
        return;
      }

      // Dispatch through the shell's existing action handler. The
      // handler itself reaches the existing endpoints + audits via
      // the existing chain.
      //
      // Many handlers are async (generalTask awaits fetch + JSON
      // parsing). _onActionClick → _dispatch returns the handler's
      // result synchronously — Promises propagate. We chain here so
      // async failures (network error, 4xx response) become a
      // [system] bubble in the chat instead of just a toast that
      // can be missed. The synchronous "시작했습니다" bubble lands
      // first; if the underlying call rejects, a follow-up
      // "[system] ⚠ ..." appears below it.
      try {
        const dispatched = _onActionClick(dispatchKey, proposal.parameters || {});
        _appendSystem("✓ 시작했습니다 (" + proposal.intent + ").");
        if (dispatched && typeof dispatched.then === "function") {
          dispatched.catch(function (err) {
            const msg = (err && err.message) ? err.message : String(err);
            _appendSystem("⚠ 실행 중 실패: " + msg);
            try { console.error("[chat] dispatch rejected:", err); } catch (_) {}
          });
        }
      } catch (err) {
        _appendSystem("⚠ 실행 실패: "
          + (err && err.message ? err.message : String(err)));
        try { console.error("[chat] dispatch threw:", err); } catch (_) {}
      }
    }

    function _onCancel(proposal, _auditEntryId, cardEl) {
      _disableCardButtons(cardEl, "취소됨");
      _appendSystem("취소했습니다.");
      // TODO -0-d: POST to /api/chat/proposal-rejected for the audit
      // chain (chat_proposal_rejected verb). For -0-c we just log a
      // system bubble — backend rejection audit lands in -0-d.
    }

    function _onEdit(proposal, cardEl) {
      // Inline editor for general_task: textarea + maxIter input + 다시 보내기.
      const editor = _doc.createElement("div");
      editor.className = "prod-chat-proposal-editor";
      editor.setAttribute("data-chat-slot", "editor");

      const taskTextarea = _doc.createElement("textarea");
      taskTextarea.className = "prod-chat-edit-task";
      taskTextarea.setAttribute("rows", "3");
      taskTextarea.value = (proposal.parameters && proposal.parameters.task) || "";
      editor.appendChild(taskTextarea);

      const iterRow = _doc.createElement("div");
      iterRow.className = "prod-chat-edit-iter";
      const iterLabel = _doc.createElement("label");
      iterLabel.textContent = "최대 반복 횟수: ";
      iterRow.appendChild(iterLabel);
      const iterInput = _doc.createElement("input");
      iterInput.type = "number";
      iterInput.min = "1";
      iterInput.max = "5";
      iterInput.value = String((proposal.parameters && proposal.parameters.maxIterations) || 3);
      iterRow.appendChild(iterInput);
      editor.appendChild(iterRow);

      const resubmitBtn = _doc.createElement("button");
      resubmitBtn.type = "button";
      resubmitBtn.className = "prod-chat-proposal-btn resubmit";
      resubmitBtn.setAttribute("data-chat-action", "resubmit");
      resubmitBtn.textContent = "다시 분류";
      resubmitBtn.addEventListener("click", function () {
        textarea.value = taskTextarea.value;
        _submit();
      });
      editor.appendChild(resubmitBtn);

      cardEl.appendChild(editor);
      try { taskTextarea.focus(); } catch (_) {}
    }

    function _disableCardButtons(cardEl, badge) {
      if (!cardEl) return;
      const all = cardEl.children || [];
      function walk(el) {
        if (!el) return;
        if (el.tagName === "BUTTON") {
          el.disabled = true;
        }
        for (const c of (el.children || [])) walk(c);
      }
      walk(cardEl);
      if (badge) {
        const b = _doc.createElement("span");
        b.className = "prod-chat-proposal-badge";
        b.textContent = " — " + badge;
        cardEl.appendChild(b);
      }
    }

    function _renderStatusSummary() {
      // Inline implementation of show_status. Reads from window.__OrchestratorProductShell
      // when available (production); test envs pass null and we degrade gracefully.
      let summary = "현재 상태:\n";
      try {
        const shellApi = (typeof window !== "undefined")
          ? window.__OrchestratorProductShell
          : null;
        if (shellApi && shellApi.handle && typeof shellApi.handle._state === "function") {
          const s = shellApi.handle._state();
          summary += "  • mode: " + (s.mode || "?") + "\n";
          summary += "  • locale: " + (s.locale || "?") + "\n";
          summary += "  • mounted panels: " + (s.panelsMounted || []).join(", ");
        } else {
          summary += "  (shell handle 사용 불가)";
        }
      } catch (err) {
        summary += "  (state 조회 실패: " + (err && err.message || err) + ")";
      }
      _appendSystem(summary);
    }

    // ── UX-POLISH-1 (2026-05-11) — progress milestone emitter ──────
    //
    // Subscribes to the store and converts lifecycle events into
    // [system] chat bubbles so the operator sees "1번 비평 완료",
    // "B 단계 진입", "✓ 작업 완료" without having to scan the track or
    // open the drawer. Dedupe via a per-run Set of emitted milestone
    // IDs (selectProgressMilestones returns stable IDs); resets when
    // the active runId changes so a fresh run starts with a clean set.
    //
    // Safety: store mutations from chat dispatch (e.g. Approve →
    // /api/pipeline/general-run) fire subscribers reentrantly. We
    // guard with _inSubscribe to prevent infinite loops if some
    // future emit path accidentally writes back into the store.
    let _emittedMilestones = new Set();
    let _milestoneRunId = null;
    let _lastEmittedTs = 0;
    let _inSubscribe = false;
    let _progressUnsubscribe = null;

    function _emitMilestone(m) {
      if (!m || !m.id || _emittedMilestones.has(m.id)) return;
      _emittedMilestones.add(m.id);
      if (typeof m.ts === "number" && m.ts > _lastEmittedTs) _lastEmittedTs = m.ts;
      // UX-POLISH-2: pause has two variants — with / without a reason
      // string. selectProgressMilestones always returns kind="pause"
      // with params.reason possibly empty.
      let keySuffix = _PROGRESS_KIND_TO_KEY[m.kind];
      let fallback  = _PROGRESS_FALLBACKS[m.kind] || "";
      if (m.kind === "pause" && m.params && m.params.reason) {
        keySuffix = "pauseWithReason";
        fallback  = _PROGRESS_FALLBACKS.pause_with_reason;
      }
      if (!keySuffix) return;
      const key = "chat.progress." + keySuffix;
      const text = _t(key, fallback, m.params || {});
      if (text) _appendSystem(text);
    }

    function _refreshProgress() {
      if (_inSubscribe) return;
      _inSubscribe = true;
      try {
        if (!_store || typeof _store.snapshot !== "function") return;
        const snap = _store.snapshot();
        const runId = (_selectors && typeof _selectors.selectActiveRunId === "function")
          ? _selectors.selectActiveRunId(snap) : null;
        // Reset dedupe set when the active run changes — a new task
        // starts with a clean progress trail.
        if (runId !== _milestoneRunId) {
          _milestoneRunId = runId;
          _emittedMilestones = new Set();
          _lastEmittedTs = 0;
        }
        if (!_selectors || typeof _selectors.selectProgressMilestones !== "function") return;
        const ms = _selectors.selectProgressMilestones(snap, runId, _lastEmittedTs) || [];
        for (const m of ms) _emitMilestone(m);
      } catch (err) {
        try { console.warn("[chat] progress refresh failed:", err); } catch (_) {}
      } finally {
        _inSubscribe = false;
      }
    }

    if (_store && typeof _store.subscribe === "function") {
      try { _progressUnsubscribe = _store.subscribe(_refreshProgress); }
      catch (_) { /* defensive — chat panel still works without progress */ }
      // Prime once so any milestones already in the snapshot at mount
      // time get rendered (e.g. panel re-mounts mid-run).
      _refreshProgress();
    }

    return {
      destroy: function () {
        if (typeof _progressUnsubscribe === "function") {
          try { _progressUnsubscribe(); } catch (_) {}
          _progressUnsubscribe = null;
        }
        if (chat.parentNode === root) {
          try { root.removeChild(chat); } catch (_) {}
        }
      },
      setMode: function () { /* mode toggle doesn't affect chat in v1 */ },
      setLocale: function () { /* i18n hooks land in -0-d */ },
      _state: function () {
        return {
          historyCount: history.children.length,
          slot: "chat",
        };
      },
      // Test hooks — let unit tests drive the panel without DOM events.
      _submit: _submit,
      _appendMessage: _appendMessage,
      _renderProposalCard: _renderProposalCard,
      _refreshProgress: _refreshProgress,
      _emitMilestone: _emitMilestone,
      _emittedMilestones: function () { return _emittedMilestones; },
    };
  }

  // UX-POLISH-1 + UX-POLISH-2: milestone kind → i18n key + fallback
  // text. Kept at module scope so the create() closure doesn't
  // re-build the table on every panel mount. The kinds map 1:1 onto
  // selectProgressMilestones output; `pause` picks between two i18n
  // keys depending on whether `reason` is non-empty.
  const _PROGRESS_KIND_TO_KEY = Object.freeze({
    phase_enter:       "phaseEnter",
    iteration_start:   "iterStart",
    iteration_done:    "iterDone",
    iteration_failed:  "iterFailed",
    halt_error:        "haltError",
    halt_failed:       "haltFailed",
    tool_blocked:      "toolBlocked",
    pause:             "pauseSimple",       // overridden when params.reason set
    pipeline_complete: "complete",
    pipeline_error:    "error",
  });
  const _PROGRESS_FALLBACKS = Object.freeze({
    phase_enter:       "▸ {phase} 단계 진입",
    iteration_start:   "⏳ {n}번 비평 시작 ({phase})",
    iteration_done:    "✓ {n}번 비평 완료 (CRITICAL {c} · HIGH {h})",
    iteration_failed:  "✗ {n}번 비평 실패: {msg}",
    halt_error:        "⛔ 중단됨 — {phase} / {node}: {msg}",
    halt_failed:       "⛔ 작업 중단 — 사유: {reason} (총 {sec}초)",
    tool_blocked:      "🚫 도구 차단: {tool} ({reason})",
    pause:             "⏸ 일시중지",         // simple variant
    pause_with_reason: "⏸ 일시중지 — {reason}",
    pipeline_complete: "✓ 작업 완료 ({iters}번 반복, 총 {sec}초)",
    pipeline_error:    "✗ 작업 실패: {msg}",
  });

  return {
    create,
    RECOMMENDED_CHIPS,
    INTENT_TO_DISPATCH,
    RISK_LABEL,
  };
});
