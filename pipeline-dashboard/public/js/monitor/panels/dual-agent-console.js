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
//   - Caller passes optional `client` (OrchestratorReviewSessionClient)
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
  if (typeof window !== "undefined") root.OrchestratorMonitorDualAgentConsole = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Prefer require (test path); fall back to window global (browser).
  function _resolveFilters() {
    try { return require("../event-filters"); } catch (_) { /* no-op */ }
    if (typeof window !== "undefined" && window.OrchestratorMonitorEventFilters) {
      return window.OrchestratorMonitorEventFilters;
    }
    return null;
  }

  const TAIL_LINES = 200;  // last N lines per pane

  // ── i18n helper (matches recommendations-card pattern) ────────
  // S3-d: dual-agent-console gains a preset dropdown that needs
  // localized labels. Reuses the same _t pattern as the rest of the
  // monitor shell — i18n optional, fallback string used when missing.
  function _t(i18n, key, fallback, params) {
    if (i18n && typeof i18n.t === "function") {
      try {
        const v = i18n.t(key, params || {});
        if (typeof v === "string" && v !== key) return v;
      } catch (_) { /* fall through */ }
    }
    if (typeof fallback !== "string") return key;
    if (!params) return fallback;
    return fallback.replace(/\{(\w+)\}/g, (_m, k) => (k in params ? String(params[k]) : `{${k}}`));
  }

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
    // S3-d: optional i18n (OrchestratorI18n.bind() result). Used for
    // preset dropdown labels + "expert review focus" aria.
    i18n = null,
    // SMART-3-POLISH-a (Phase 2 v2 follow-up, 2026-05-05): localStorage
    // shim for recently-used preset memory. Defaults to globalThis.
    // localStorage when available; tests pass an in-memory Map-backed
    // shim. Setting `storage = null` (explicit) disables persistence
    // entirely — the dropdown still works, it just doesn't remember
    // selections across mounts.
    storage,
    // SMART-3-POLISH-a: localStorage key for the recently-used preset.
    // Default uses the harness:<feature>:v1 namespace pattern shared
    // across the dashboard (e.g. harness:runHistory:v1). Bumping the
    // version (v2) is how a future schema change is rolled out without
    // operator intervention — old keys simply become orphans.
    recentPresetsKey = "harness:recentPresetId:v1",
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("dual-agent-console.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("dual-agent-console.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("dual-agent-console.create: no document available");
    }
    const filters = _resolveFilters();
    if (!filters) {
      throw new Error("dual-agent-console.create: OrchestratorMonitorEventFilters unavailable");
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

    // SMART-3-POLISH-a: storage resolver. Three states:
    //   - explicit null      → memory disabled
    //   - undefined (default)→ try globalThis.localStorage; if missing
    //                          (e.g. SSR / Node), memory disabled
    //   - shim object        → use as-is (tests pass a Map-backed shim)
    // The interface only requires getItem(k) → string|null and
    // setItem(k, v) → void. removeItem is optional (we never strictly
    // need it; setting a sentinel "" is enough to mean "free-form").
    const _storage = (() => {
      if (storage === null) return null;            // explicit opt-out
      if (storage && typeof storage.getItem === "function"
          && typeof storage.setItem === "function") {
        return storage;
      }
      // Default — try globalThis.localStorage. Wrap in try/catch
      // because some browser configs (e.g. private mode + iframe-with-
      // restricted-storage) throw on access rather than returning null.
      try {
        if (typeof globalThis !== "undefined"
            && globalThis.localStorage
            && typeof globalThis.localStorage.getItem === "function"
            && typeof globalThis.localStorage.setItem === "function") {
          return globalThis.localStorage;
        }
      } catch (_) { /* fall through */ }
      return null;
    })();

    function _readRecentPresetId() {
      if (!_storage) return null;
      try {
        const v = _storage.getItem(recentPresetsKey);
        if (typeof v !== "string") return null;
        const trimmed = v.trim();
        if (trimmed.length === 0) return null;
        // Defensive cap — a corrupted entry shouldn't crash the panel.
        if (trimmed.length > 128) return null;
        return trimmed;
      } catch (_) { return null; }
    }

    function _writeRecentPresetId(presetId) {
      if (!_storage) return;
      try {
        // Empty string sentinel = "free-form (no preset)". Distinct
        // from missing key (= "never selected before"); the read side
        // collapses both to null but the write side preserves the
        // operator's explicit choice across mounts.
        _storage.setItem(recentPresetsKey,
          typeof presetId === "string" && presetId.length > 0
            ? presetId : "");
      } catch (_) { /* never break the shell on a storage fault */ }
    }

    // Pane state — which tab is active per pane. Defaults: Claude on
    // left, Codex on right (matches the mockup).
    let activeLeft = "claude";
    let activeRight = "codex";
    let unsubscribe = null;
    let destroyed = false;
    // UI-H7-c: track in-flight requests per session so duplicate
    // clicks don't spawn parallel requests. Map<sessionId, action>.
    const inFlight = new Set();
    // S3-d: preset state. `availablePresets` is null until the GET
    // returns; in that window the dropdown shows a "(loading…)"
    // placeholder. `selectedPresetId` is null = free-form prompt
    // (legacy dispatcher behavior).
    let availablePresets = null;
    let selectedPresetId = null;
    let presetsFetchInFlight = false;
    let presetsFetchFailed = false;

    function _fetchPresetsOnce() {
      if (!client || typeof client.listPresets !== "function") return;
      if (presetsFetchInFlight || availablePresets !== null) return;
      presetsFetchInFlight = true;
      Promise.resolve()
        .then(() => client.listPresets())
        .then((payload) => {
          if (destroyed) return;
          if (payload && Array.isArray(payload.presets)) {
            availablePresets = payload.presets;
            presetsFetchFailed = false;
            // SMART-3-POLISH-a: restore the operator's most-recent
            // preset selection IF (a) the operator hasn't already
            // explicitly selected something this session, and (b) the
            // remembered preset is still in the catalog the server
            // returned (a preset removed server-side falls back to
            // null, matching legacy free-form dispatch behaviour).
            if (selectedPresetId === null) {
              const remembered = _readRecentPresetId();
              if (remembered) {
                const found = availablePresets.find(
                  (p) => p && p.presetId === remembered);
                if (found) selectedPresetId = remembered;
              }
            }
          } else {
            availablePresets = [];
            presetsFetchFailed = true;
          }
          render();
        })
        .catch((err) => {
          if (destroyed) return;
          // Soft fail: dropdown shows "(presets unavailable)" but the
          // existing free-form action row still works exactly as before.
          availablePresets = [];
          presetsFetchFailed = true;
          _onError(err);
          render();
        })
        .finally(() => { presetsFetchInFlight = false; });
    }

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

      // Section A.5: S3-d preset dropdown (only when presets endpoint
      // is available + fetched successfully). Pre-fetch lifecycle:
      // null → loading placeholder; [] + failed → "presets unavailable"
      // disabled; [...6] → actual dropdown.
      row.appendChild(_renderPresetDropdown());

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

    // ── S3-d: preset dropdown ─────────────────────────────────────
    //
    // Layout:
    //   <span class="dac-preset-picker" data-state="...">
    //     <label class="dac-preset-label">검토 관점</label>
    //     <select class="dac-preset-select" data-preset="...">
    //       <option value="">자유 입력 (preset 없음)</option>
    //       <option value="security">보안</option>
    //       <option value="accuracy">정확성</option>
    //       ...6 options
    //     </select>
    //     <span class="dac-preset-tooltip">(description of selected)</span>
    //   </span>
    //
    // States via data-state:
    //   "loading"   — fetch in flight, single disabled placeholder
    //   "ready"     — 1+6 options + tooltip
    //   "missing"   — fetch failed; disabled stub + warning text
    //   "no-client" — client doesn't support listPresets; hidden
    function _renderPresetDropdown() {
      const wrap = _doc.createElement("span");
      wrap.className = "dac-preset-picker";

      // No client.listPresets → hide the picker entirely (legacy /
      // older client without preset support). Uses the standard HTML
      // `hidden` attribute (display:none equivalent + a11y-aware) so
      // the same code works under both browser DOM + minimal stubs.
      if (!client || typeof client.listPresets !== "function") {
        wrap.setAttribute("data-state", "no-client");
        wrap.setAttribute("hidden", "");
        return wrap;
      }

      const label = _doc.createElement("label");
      label.className = "dac-preset-label";
      label.textContent = _t(i18n, "smart.preset.label", "검토 관점");
      wrap.appendChild(label);

      const select = _doc.createElement("select");
      select.className = "dac-preset-select";
      select.setAttribute(
        "aria-label",
        _t(i18n, "smart.preset.aria", "전문가 검토 관점 선택"),
      );

      if (availablePresets === null) {
        // Loading state — disabled select with single placeholder.
        wrap.setAttribute("data-state", "loading");
        const opt = _doc.createElement("option");
        opt.value = "";
        opt.textContent = _t(i18n, "smart.preset.loading", "(불러오는 중…)");
        select.appendChild(opt);
        select.disabled = true;
        wrap.appendChild(select);
        return wrap;
      }

      if (presetsFetchFailed || availablePresets.length === 0) {
        // Soft-fail state — disabled with explanation. Operator
        // continues with free-form prompt.
        wrap.setAttribute("data-state", "missing");
        const opt = _doc.createElement("option");
        opt.value = "";
        opt.textContent = _t(i18n, "smart.preset.unavailable",
          "(preset 목록 불러오지 못함 — 자유 입력만 사용)");
        select.appendChild(opt);
        select.disabled = true;
        wrap.appendChild(select);
        return wrap;
      }

      // Ready state — 1+6 options.
      wrap.setAttribute("data-state", "ready");
      const noneOpt = _doc.createElement("option");
      noneOpt.value = "";
      noneOpt.textContent = _t(i18n, "smart.preset.none",
        "자유 입력 (preset 없음)");
      if (selectedPresetId === null) noneOpt.selected = true;
      select.appendChild(noneOpt);

      let selectedDescription = "";
      for (const p of availablePresets) {
        const opt = _doc.createElement("option");
        opt.value = p.presetId;
        // Prefer i18n key `smart.preset.<id>.label`; fall back to
        // server-provided defaultLabel.
        opt.textContent = _t(i18n,
          `smart.preset.${p.presetId}.label`,
          p.defaultLabel || p.presetId);
        if (p.presetId === selectedPresetId) {
          opt.selected = true;
          selectedDescription = _t(i18n,
            `smart.preset.${p.presetId}.description`,
            p.defaultDescription || "");
        }
        select.appendChild(opt);
      }

      select.addEventListener("change", (ev) => {
        const v = ev && ev.target && ev.target.value;
        selectedPresetId = (typeof v === "string" && v.length > 0) ? v : null;
        // SMART-3-POLISH-a: persist for the next mount. Free-form
        // (selectedPresetId=null) writes empty-string sentinel so the
        // explicit "I want free-form" choice survives across mounts
        // and isn't fooled by a missing-key into auto-restoring an
        // older preset.
        _writeRecentPresetId(selectedPresetId);
        // Re-render so the tooltip + option-selected sync.
        render();
      });
      wrap.appendChild(select);

      if (selectedDescription) {
        const tooltip = _doc.createElement("span");
        tooltip.className = "dac-preset-tooltip";
        tooltip.textContent = selectedDescription;
        wrap.appendChild(tooltip);
      }
      return wrap;
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
        // S3-d: pass the operator-selected preset (or null for free-form).
        const opts = { instruction, store };
        if (selectedPresetId) opts.preset = selectedPresetId;
        await client.sendToCodex(session.sessionId, opts);
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
        const opts = { question, target, store };
        if (selectedPresetId) opts.preset = selectedPresetId;
        await client.followUp(session.sessionId, opts);
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
        const opts = { instruction, store };
        if (selectedPresetId) opts.preset = selectedPresetId;
        await client.handBackToClaude(session.sessionId, opts);
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
    // S3-d: kick off the preset fetch on mount. Render once
    // immediately (will show "(loading…)" placeholder), then re-render
    // when the fetch resolves. Soft-fail keeps the action row usable
    // without preset support.
    _fetchPresetsOnce();
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
      _state() {
        return {
          activeLeft, activeRight,
          selectedPresetId,
          availablePresets,
          presetsFetchFailed,
        };
      },
      // S3-d: test hook so unit tests don't have to mock client.listPresets.
      _setPresets(presets) {
        availablePresets = Array.isArray(presets) ? presets : [];
        presetsFetchFailed = false;
        render();
      },
      _selectPreset(presetId) {
        selectedPresetId = (typeof presetId === "string" && presetId.length > 0)
          ? presetId : null;
        render();
      },
    };
  }

  return { create };
});
