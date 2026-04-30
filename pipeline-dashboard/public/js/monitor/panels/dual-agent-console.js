// Slice UI-H3 + UI-H7-c (Phase D / Phase E1.5, 2026-04-30) — Dual Agent Console.
//
// Read-only stream viewer split into Left (Claude) and Right (Codex)
// terminal-styled panels. Per UI Plan §UX-H3:
//
//   왼쪽: Claude Code 작업/수정 스트림
//   오른쪽: Codex 비평/검증 스트림
//   하단: 사용자의 structured action row
//   버튼: Codex에 비평 요청, 추가 질문, Claude에 수정 요청, 세션 보관
//
// **Stream view is read-only.** The dual console is NEVER a real
// PTY — operator input flows through the relay backend as typed
// actions, NOT raw stdin. UI-H7-c added the action row that posts
// structured intents (sendToCodex / followUp / handBackToClaude /
// archive) to /api/review-sessions/* via review-session-client.
//
// Tabs (per UI Plan §UX-H3):
//   Left:  Claude / Bash (Bash hidden in public-sector mode)
//   Right: Codex  / Verifier
//   Plus per-pane: Audit (read-only audit chain feed)
//
// First cut shows Claude + Codex tabs. Verifier + Audit + Bash
// tabs are placeholder buttons; UI-H4/H5 wires them.
//
// Auto-scroll behavior matches the bottom-dock raw-log: sticky-bottom
// unless the operator scrolls up; resumes on scroll-to-bottom.
//
// UI-H7-c action-row contract:
//   - Caller passes optional `client` (HarnessReviewSessionClient)
//     and `selectedRunId` (for "Claude → Codex" auto-link).
//   - When no client is provided, the action row hides itself and
//     the original "Read-only stream view" footer remains visible.
//     This keeps existing UI-H3 callers (tests, advanced-mode pre-
//     wiring) unchanged.
//   - State-aware enable/disable per session.state:
//       no session selected → only "Start session" enabled
//       created             → "Send to Codex" enabled
//       awaiting_critique   → "Follow up Codex" + "Archive" only
//       critique_received   → "Hand back to Claude" + "Follow up Codex"
//                              + "Archive" enabled
//       awaiting_claude     → "Follow up Claude" + "Archive" enabled
//       claude_received     → "Send to Codex" (re-iterate) + "Archive"
//       archived            → all action buttons disabled
//   - Public-sector posture (UI-H7-e wires it via deploymentProfile
//     prop): "Hand back to Claude" + "Follow up Claude" hide entirely
//     when publicSector && !allowLocalExecutor. The badge "공공기관
//     모드: 로컬 Claude 실행 차단" appears in their place.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorDualAgentConsole = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Prefer require (test path); fall back to window global (browser).
  function _resolveFilters() {
    try { return require("../event-filters"); } catch (_) { /* no-op */ }
    if (typeof window !== "undefined" && window.HarnessMonitorEventFilters) {
      return window.HarnessMonitorEventFilters;
    }
    return null;
  }

  const TAIL_LINES = 200;  // last N lines per pane

  function create({
    root, store, doc,
    // UI-H7-c: optional review-session-client. When provided, the
    // action row binds its 4 buttons to client.{createSession,
    // sendToCodex, followUp, handBackToClaude} + manager.archive.
    client = null,
    // UI-H7-c: optional onError(err) callback so the host shell can
    // surface failures (toast, banner). Defaults to console.warn.
    onError = null,
    // UI-H7-c: instruction-prompt seam for tests. Default uses
    // window.prompt(); tests can pass a stub to avoid blocking.
    promptFn = null,
    // UI-H7-c: confirm-prompt seam for "Archive session?".
    confirmFn = null,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("dual-agent-console.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("dual-agent-console.create: store must be a HarnessMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("dual-agent-console.create: no document available");
    }
    const filters = _resolveFilters();
    if (!filters) {
      throw new Error("dual-agent-console.create: HarnessMonitorEventFilters unavailable");
    }
    const _onError = typeof onError === "function" ? onError : (err) => {
      try { console.warn("[dual-agent-console]", err && err.message ? err.message : err); }
      catch (_) {}
    };
    const _prompt = typeof promptFn === "function"
      ? promptFn
      : (typeof window !== "undefined" && typeof window.prompt === "function"
          ? window.prompt.bind(window) : null);
    const _confirm = typeof confirmFn === "function"
      ? confirmFn
      : (typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm.bind(window) : null);

    // Pane state — which tab is active per pane. Defaults: Claude on
    // left, Codex on right (matches the mockup).
    let activeLeft = "claude";
    let activeRight = "codex";
    let unsubscribe = null;
    let destroyed = false;
    // UI-H7-c: track in-flight requests per session so duplicate
    // clicks don't spawn parallel requests. Map<sessionId, action>.
    const inFlight = new Set();

    function _renderTabs(side, tabs, active, onSelect) {
      const tabsRoot = _doc.createElement("div");
      tabsRoot.className = "dac-tabs dac-tabs-" + side;
      tabsRoot.setAttribute("role", "tablist");

      for (const tab of tabs) {
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "dac-tab" + (tab.id === active ? " is-active" : "");
        btn.setAttribute("data-tab-id", tab.id);
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", tab.id === active ? "true" : "false");
        if (tab.disabled) {
          btn.disabled = true;
          btn.classList.add("is-disabled");
        }
        btn.textContent = tab.label;
        btn.addEventListener("click", () => onSelect(tab.id));
        tabsRoot.appendChild(btn);
      }
      return tabsRoot;
    }

    function _renderPane(side, label, accent, lines) {
      const pane = _doc.createElement("div");
      pane.className = "dac-pane dac-pane-" + side;
      pane.setAttribute("data-side", side);
      pane.setAttribute("data-actor", label);

      const header = _doc.createElement("div");
      header.className = "dac-pane-header";
      const title = _doc.createElement("span");
      title.className = "dac-pane-title";
      title.textContent = label;
      header.appendChild(title);
      pane.appendChild(header);

      const body = _doc.createElement("div");
      body.className = "dac-pane-body";
      body.setAttribute("role", "log");
      body.setAttribute("aria-live", "polite");
      body.setAttribute("aria-label", label + " stream output");

      if (lines.length === 0) {
        const empty = _doc.createElement("div");
        empty.className = "dac-empty";
        empty.textContent = "(no stream yet)";
        body.appendChild(empty);
      } else {
        for (const env of lines) {
          const line = _doc.createElement("div");
          line.className = "dac-line";
          line.setAttribute("data-event-type", env.type || "");
          if (env.ts) {
            const ts = _doc.createElement("span");
            ts.className = "dac-line-ts";
            ts.textContent = _formatTs(env.ts);
            line.appendChild(ts);
          }
          const text = _doc.createElement("span");
          text.className = "dac-line-text";
          text.textContent = filters.envelopeToLine(env);
          line.appendChild(text);
          body.appendChild(line);
        }
      }
      pane.appendChild(body);
      return pane;
    }

    function _formatTs(ts) {
      if (typeof ts !== "number" || !Number.isFinite(ts)) return "";
      try {
        const d = new Date(ts);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      } catch (_) { return ""; }
    }

    function _tabsFor(side) {
      // First-cut tab set per pane. UI-H4 adds Verifier + Audit
      // wiring; UI-H5 hides Bash in public-sector mode.
      if (side === "left") {
        return [
          { id: "claude",   label: "Claude" },
          { id: "audit",    label: "Audit",    disabled: true },
        ];
      }
      return [
        { id: "codex",    label: "Codex" },
        { id: "verifier", label: "Verifier", disabled: true },
        { id: "audit",    label: "Audit",    disabled: true },
      ];
    }

    function render() {
      if (destroyed) return;
      const snap = store.snapshot();
      const events = Array.isArray(snap.events) ? snap.events : [];

      // Filter: left pane shows whichever tab is active.
      const leftLabel = activeLeft === "claude" ? "claude" : activeLeft;
      const rightLabel = activeRight === "codex" ? "codex" : activeRight;
      const leftLines = filters.tailEvents(
        filters.filterEventsByLabel(events, leftLabel),
        TAIL_LINES,
      );
      const rightLines = filters.tailEvents(
        filters.filterEventsByLabel(events, rightLabel),
        TAIL_LINES,
      );

      root.innerHTML = "";
      root.classList.add("dual-agent-console");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "Dual agent console");

      // Container — left + right grid
      const grid = _doc.createElement("div");
      grid.className = "dac-grid";

      const leftCol = _doc.createElement("div");
      leftCol.className = "dac-col dac-col-left";
      leftCol.appendChild(_renderTabs("left", _tabsFor("left"), activeLeft, (id) => {
        if (id !== activeLeft) {
          activeLeft = id;
          render();
        }
      }));
      leftCol.appendChild(_renderPane("left", _labelFor(activeLeft), "claude", leftLines));

      const rightCol = _doc.createElement("div");
      rightCol.className = "dac-col dac-col-right";
      rightCol.appendChild(_renderTabs("right", _tabsFor("right"), activeRight, (id) => {
        if (id !== activeRight) {
          activeRight = id;
          render();
        }
      }));
      rightCol.appendChild(_renderPane("right", _labelFor(activeRight), "codex", rightLines));

      grid.appendChild(leftCol);
      grid.appendChild(rightCol);
      root.appendChild(grid);

      // UI-H7-c: action row when client is provided. Otherwise keep
      // the original "read-only stream view" footer for backward
      // compatibility with H3-only callers.
      if (client) {
        root.appendChild(_renderActionRow(snap));
      } else {
        const footer = _doc.createElement("div");
        footer.className = "dac-footer";
        footer.textContent = "📺 Read-only stream view. Actions land via UI-H4 review relay.";
        root.appendChild(footer);
      }
    }

    // ── UI-H7-c: action row ───────────────────────────────────────

    function _renderActionRow(snap) {
      const row = _doc.createElement("div");
      row.className = "dac-action-row";
      row.setAttribute("role", "toolbar");
      row.setAttribute("aria-label", "Review relay actions");

      // Find the active session (selected sessionId in store; otherwise
      // null). Action buttons enable/disable based on its state.
      const sessions = Array.isArray(snap.reviewSessions) ? snap.reviewSessions : [];
      const selectedId = snap.selectedReviewSessionId;
      const activeSession = selectedId
        ? sessions.find((s) => s.sessionId === selectedId) || null
        : null;
      const activeState = activeSession ? activeSession.state : null;
      const sessionLabel = activeSession
        ? (activeSession.label || `세션 ${activeSession.sessionId.slice(0, 8)}`)
        : "세션 없음";

      // Section A: session indicator (left side)
      const indicator = _doc.createElement("span");
      indicator.className = "dac-session-indicator";
      indicator.setAttribute("data-state", activeState || "none");
      indicator.textContent = activeSession
        ? `🔗 ${sessionLabel} · ${_stateLabel(activeState)}`
        : "🔗 세션 없음";
      row.appendChild(indicator);

      // Section B: action buttons
      const buttons = _doc.createElement("span");
      buttons.className = "dac-action-buttons";

      // Public-sector posture lookup (UI-H7-e wires this via store).
      const accountStatus = snap.accountStatus || {};
      const deployment = accountStatus.deployment || {};
      const localExecutorBlocked = deployment.publicSector === true
        && deployment.allowLocalExecutor === false;

      // Button: "Start session"
      buttons.appendChild(_renderButton({
        id: "start",
        label: "+ 세션 시작",
        title: "새 review session 시작",
        // Always available
        disabled: false,
        action: () => _onStartSession(),
      }));

      // Button: "Send to Codex"  (Claude → Codex)
      const canSendToCodex =
        !activeSession
        || activeState === "created"
        || activeState === "critique_received"
        || activeState === "claude_received";
      buttons.appendChild(_renderButton({
        id: "send-codex",
        label: "→ Codex 비평 요청",
        title: "Claude 작업물을 Codex에 비평 요청",
        disabled: !activeSession || !canSendToCodex || _isInFlight(activeSession),
        action: () => activeSession && _onSendToCodex(activeSession),
      }));

      // Button: "Follow up Codex"
      const canFollowUpCodex =
        !!activeSession
        && activeState !== "created"
        && activeState !== "archived";
      buttons.appendChild(_renderButton({
        id: "followup-codex",
        label: "? Codex에 추가 질문",
        title: "Codex에게 추가 질문",
        disabled: !canFollowUpCodex || _isInFlight(activeSession),
        action: () => activeSession && _onFollowUp(activeSession, "codex"),
      }));

      // Button: "Hand back to Claude" (only when posture allows).
      // Strict: only enabled when critique has actually been received.
      // Manager allows hand-back from awaiting_critique too ("give up
      // on critique"), but the UX gates that path until critique is
      // back so the operator doesn't accidentally skip the review.
      if (!localExecutorBlocked) {
        const canHandBack =
          !!activeSession
          && activeState === "critique_received";
        buttons.appendChild(_renderButton({
          id: "hand-back",
          label: "→ Claude에게 반영 요청",
          title: "Codex 비평을 Claude로 hand-back",
          disabled: !canHandBack || _isInFlight(activeSession),
          action: () => activeSession && _onHandBackToClaude(activeSession),
        }));
      }

      // Button: "Archive session"
      const canArchive = !!activeSession && activeState !== "archived";
      buttons.appendChild(_renderButton({
        id: "archive",
        label: "⏏ 세션 보관",
        title: "현재 세션을 archive로 이동",
        disabled: !canArchive,
        action: () => activeSession && _onArchive(activeSession),
      }));

      row.appendChild(buttons);

      // Section C: posture badge (UI-H7-e). Visible only when
      // publicSector && !allowLocalExecutor.
      if (localExecutorBlocked) {
        const badge = _doc.createElement("span");
        badge.className = "dac-posture-badge";
        badge.setAttribute("data-posture", "public-sector");
        badge.textContent = "🛡 공공기관 모드 — 로컬 Claude 실행 차단";
        row.appendChild(badge);
      }

      return row;
    }

    function _renderButton({ id, label, title, disabled, action }) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "dac-action-btn dac-action-" + id;
      btn.setAttribute("data-action-id", id);
      btn.setAttribute("title", title);
      btn.textContent = label;
      if (disabled) {
        btn.disabled = true;
        btn.classList.add("is-disabled");
      } else {
        btn.addEventListener("click", () => {
          try { action(); } catch (e) { _onError(e); }
        });
      }
      return btn;
    }

    function _stateLabel(state) {
      const labels = {
        created:           "준비됨",
        awaiting_critique: "Codex 비평 대기",
        critique_received: "비평 도착",
        awaiting_claude:   "Claude 반영 대기",
        claude_received:   "Claude 반영 완료",
        archived:          "보관됨",
      };
      return labels[state] || state || "-";
    }

    function _isInFlight(session) {
      return session && inFlight.has(session.sessionId);
    }

    function _markInFlight(sessionId) { inFlight.add(sessionId); render(); }
    function _clearInFlight(sessionId) { inFlight.delete(sessionId); render(); }

    // ── UI-H7-c: button handlers ─────────────────────────────────

    function _askInstruction(message) {
      if (typeof _prompt !== "function") {
        _onError(new Error("instruction prompt unavailable in this environment"));
        return null;
      }
      const v = _prompt(message);
      if (typeof v !== "string" || v.trim().length === 0) return null;
      return v.trim();
    }

    async function _onStartSession() {
      const label = _askInstruction("새 review session 이름을 입력하세요:");
      if (label === null) return;
      const snap = store.snapshot();
      const runId = snap.selectedRunId || null;
      try {
        await client.createSession({
          label, runId, source: runId ? "selected_run" : "manual",
          store, select: true,
        });
      } catch (err) { _onError(err); }
    }

    async function _onSendToCodex(session) {
      const instruction = _askInstruction(
        "Codex에 어떤 비평을 요청합니까? (예: '보안 검토', '효율성 분석'):"
      );
      if (instruction === null) return;
      _markInFlight(session.sessionId);
      try {
        await client.sendToCodex(session.sessionId, { instruction, store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(session.sessionId); }
    }

    async function _onFollowUp(session, target) {
      const question = _askInstruction(
        target === "codex"
          ? "Codex에 추가 질문:"
          : "Claude에 추가 질문:"
      );
      if (question === null) return;
      _markInFlight(session.sessionId);
      try {
        await client.followUp(session.sessionId, { question, target, store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(session.sessionId); }
    }

    async function _onHandBackToClaude(session) {
      const instruction = _askInstruction(
        "Claude에 어떤 수정을 요청합니까?"
      );
      if (instruction === null) return;
      _markInFlight(session.sessionId);
      try {
        await client.handBackToClaude(session.sessionId, { instruction, store });
      } catch (err) { _onError(err); }
      finally { _clearInFlight(session.sessionId); }
    }

    async function _onArchive(session) {
      const ok = typeof _confirm === "function"
        ? _confirm(`'${session.label || session.sessionId}' 세션을 보관할까요?`)
        : true;
      if (!ok) return;
      _markInFlight(session.sessionId);
      try {
        if (typeof client.archiveSession === "function") {
          await client.archiveSession(session.sessionId, {
            reason: "operator-archive", store,
          });
        } else {
          // Older client without archive — fall back to local mark.
          store.upsertReviewSession(session.sessionId, {
            state: "archived",
            archivedAt: Date.now(),
            archiveReason: "operator-archive",
          });
        }
      } catch (err) { _onError(err); }
      finally { _clearInFlight(session.sessionId); }
    }

    function _labelFor(tabId) {
      const labels = {
        claude:   "Claude · Plan & Execute",
        codex:    "Codex · Critique Stream",
        verifier: "Verifier · Test Output",
        audit:    "Audit · Chain Feed",
      };
      return labels[tabId] || tabId;
    }

    unsubscribe = store.subscribe(render);
    render();

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") {
          try { unsubscribe(); } catch (_) {}
          unsubscribe = null;
        }
        root.innerHTML = "";
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
        root.classList.remove("dual-agent-console");
      },
      // Test hooks
      _selectLeft(tabId) { activeLeft = tabId; render(); },
      _selectRight(tabId) { activeRight = tabId; render(); },
      _state() { return { activeLeft, activeRight }; },
    };
  }

  return { create };
});
