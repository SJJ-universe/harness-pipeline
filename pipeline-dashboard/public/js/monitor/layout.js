// Slice MA3+MA4+MA5+MA6+MB4-a+MC1 (Phase D, 2026-04-27) — HarnessMonitorLayout.
//
// Mounts the monitor shell into a host element, kicks off hydration, and
// instantiates each panel.
//   - MA3   — global-bar (top) + gb-error
//   - MA4   — shell-body row: run-rail (left) + center-workspace (centre)
//   - MA5   — center-workspace splits into cw-summary (top) + cw-timeline
//             (bottom); shell-body grows a right-inspector column;
//             shell-dock (raw event log) sits below shell-body.
//   - MA6   — run-rail splits into run-rail-section (run-tree mount) and
//             agent-rail-section (agent-tree mount); inspector picks up
//             kind:"child" + kind:"subagent" via store.selectItem.
//   - MB4-a — installs HarnessMonitorLegacyBridge so live WS events
//             (via app.js → HarnessEventDispatcher tap) flow into the
//             store, and /api/server/info polls keep server summary +
//             active children fresh. Without this the store is frozen
//             at hydration time. Bridge handle returned for destroy().
//   - MC1   — runTree.onSelect now ALSO calls hydrateRunDetail so
//             agent-tree + run-summary auto-pick up server-authoritative
//             findings + subagents + replayMeta. In-flight dedupe (Set)
//             + TTL cache (default 30s) keep tab-cycling cheap.
//
// Default behaviour: completely opt-in. The init script in index.html
// only invokes mount() when ?monitor=1 is in the URL or
// localStorage.harnessMonitor === "1". Users who don't opt in see no
// change — mount() is never called for them and the shell stays hidden.
//
// Contract:
//   mount({ root, store, normalize, fetchImpl, headers, panels, hydrate, doc })
//     → { hydrationPromise, destroy }
//
//   - root        : HTMLElement (the #monitor-shell-root container).
//   - store       : HarnessMonitorStore instance.
//   - normalize   : function from HarnessMonitorNormalizer.normalize.
//   - fetchImpl   : optional fetch override (defaults to global fetch).
//   - headers     : optional headers passed to hydrate.
//   - panels      : {
//                     globalBar?:   { create({root,store,onClose,doc}) },
//                     runTree?:     { create({root,store,onSelect,doc}) },
//                     runSummary?:  { create({root,store,doc}) },
//                     timeline?:    { create({root,store,onSelect,doc}) },  // MA5
//                     inspector?:   { create({root,store,doc}) },           // MA5
//                     bottomDock?:  { create({root,store,doc}) },           // MA5
//                     agentTree?:   { create({root,store,onSelect,doc}) },  // MA6
//                   }
//                   Defaults are window.HarnessMonitor{GlobalBar,RunTree,
//                   RunSummary,Timeline,Inspector,BottomDock,AgentTree} in
//                   browsers; tests inject stubs.
//   - hydrate     : optional hydrate fn override (defaults to
//                   HarnessMonitorHydrate.hydrateMonitorStore).
//   - doc         : optional document override (test injection).
//
// Hydration errors do NOT throw — they surface in the in-bar error box so
// the panel keeps rendering whatever live store state already arrived
// from the WebSocket. Throwing would orphan the mount.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessMonitorLayout = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  function _resolvePanel(panels, key, globalName) {
    if (panels && panels[key] && typeof panels[key].create === "function") {
      return panels[key];
    }
    if (typeof globalThis !== "undefined" && globalThis[globalName]
        && typeof globalThis[globalName].create === "function") {
      return globalThis[globalName];
    }
    return null;
  }

  function _resolveHydrate(override) {
    if (typeof override === "function") return override;
    if (typeof globalThis !== "undefined"
        && globalThis.HarnessMonitorHydrate
        && typeof globalThis.HarnessMonitorHydrate.hydrateMonitorStore === "function") {
      return globalThis.HarnessMonitorHydrate.hydrateMonitorStore;
    }
    return null;
  }

  // Slice MC1: per-run detail hydrator. Same lookup pattern as
  // _resolveHydrate but reaches for hydrateRunDetail. Tests inject a
  // direct override; browser falls back to
  // window.HarnessMonitorHydrate.hydrateRunDetail.
  function _resolveRunDetailHydrate(override) {
    if (typeof override === "function") return override;
    if (typeof globalThis !== "undefined"
        && globalThis.HarnessMonitorHydrate
        && typeof globalThis.HarnessMonitorHydrate.hydrateRunDetail === "function") {
      return globalThis.HarnessMonitorHydrate.hydrateRunDetail;
    }
    return null;
  }

  // Slice MB4-a: resolve the legacy bridge factory. Tests pass an
  // explicit override; browser uses window.HarnessMonitorLegacyBridge.
  function _resolveBridge(override) {
    if (override && typeof override.install === "function") return override;
    if (typeof globalThis !== "undefined"
        && globalThis.HarnessMonitorLegacyBridge
        && typeof globalThis.HarnessMonitorLegacyBridge.install === "function") {
      return globalThis.HarnessMonitorLegacyBridge;
    }
    return null;
  }

  // Slice UI-H7-e (Phase D / Phase E1.5, 2026-04-30): map review-session
  // client errors to operator-friendly Korean messages. Falls back to
  // the raw err.message + code for unknown error codes so an unknown
  // code still surfaces something. Pure function — exported for tests.
  function _formatReviewError(err) {
    if (!err) return "알 수 없는 오류가 발생했습니다.";
    const code = err.code ? String(err.code) : "review_session_error";
    const msgMap = {
      // 가장 중요한 운영 차단: 공공기관 모드 + 로컬 실행 불허
      public_sector_local_executor_disabled:
        "🛡 공공기관 모드: 로컬 Claude 실행이 차단되어 있습니다. 샌드박스 runner를 사용하거나 Codex 비평까지만 진행하세요.",
      // 세션 상태 머신 위반 (서버 409 invalid_state)
      invalid_state:
        "현재 세션 상태에서는 이 작업을 수행할 수 없습니다. 세션 상태를 확인하세요.",
      // 입력 검증 실패
      invalid_input:
        "입력 값이 올바르지 않습니다. 명령어를 다시 입력하세요.",
      review_session_invalid_input:
        "입력 값이 올바르지 않습니다. 명령어를 다시 입력하세요.",
      review_session_input_too_long:
        "입력 값이 너무 깁니다. 8KB 이하로 줄여 주세요.",
      // 세션을 찾을 수 없음 (이미 archive 됐거나 잘못된 ID)
      session_not_found:
        "세션을 찾을 수 없습니다. 이미 보관됐거나 만료된 세션일 수 있습니다.",
      // 매니저 미동작 (서버 부팅 안 됐거나 dependency 미주입)
      service_unavailable:
        "Review relay 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요.",
      review_session_manager_unavailable:
        "Review relay 서비스가 응답하지 않습니다. 잠시 후 다시 시도하세요.",
      // 네트워크 실패
      network_error:
        "네트워크 오류로 요청을 보내지 못했습니다. 연결 상태를 확인하세요.",
      // 서버 내부 오류
      server_error:
        "서버 내부 오류가 발생했습니다. 다시 시도하거나 관리자에게 문의하세요.",
      review_session_error:
        "Review relay 작업이 실패했습니다. 다시 시도하세요.",
    };
    if (Object.prototype.hasOwnProperty.call(msgMap, code)) {
      return msgMap[code];
    }
    // Unknown code — fall back to raw message + code so it's
    // still actionable.
    const raw = err.message || "Review relay 작업 실패";
    return `${raw} (${code})`;
  }

  function mount({
    root,
    store,
    normalize,
    fetchImpl,
    headers,
    panels = {},
    hydrate,
    doc,
    // Slice MB4-a: legacy-bridge override for tests; browser falls back
    // to window.HarnessMonitorLegacyBridge.
    bridge,
    // Slice MB4-a: optional bridge config — refreshIntervalMs (0 disables
    // the periodic /api/server/info poll, useful in tests).
    bridgeRefreshIntervalMs,
    // Slice MC1: per-run detail hydrate override (tests) + TTL config.
    runDetailHydrate,
    runDetailTtlMs = 30000,
    // Slice UI-H7-c: review-session HTTP client. When provided, the
    // dual-agent-console renders its action row + binds buttons. When
    // null/undefined, dual-agent-console falls back to the original
    // read-only stream view + footer (UI-H3 behavior). Browser falls
    // back to window.HarnessReviewSessionClient.
    reviewSessionClient,
    // Slice UI-H1 (Phase D / Phase E1.5, 2026-04-30): shell mode.
    //
    //   "advanced" (default) — existing 9-panel layout (today's behavior)
    //   "simple"             — operator-friendly skeleton (UI-H6 fills cards)
    //   "legacy"             — bypass the monitor shell entirely; the
    //                          legacy app.js DOM is untouched
    //
    // Resolved by callers via HarnessMonitorMode.resolveMode (URL >
    // localStorage > envDefault > "simple"). Mount accepts the resolved
    // value; defaults to "advanced" so existing tests + ?monitor=1
    // direct mounts keep their behavior.
    mode = "advanced",
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("HarnessMonitorLayout.mount: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("HarnessMonitorLayout.mount: store is required");
    }
    const _doc = doc || (root.ownerDocument) || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("HarnessMonitorLayout.mount: no document available");
    }

    // Slice UI-H1: legacy mode short-circuits the shell mount entirely.
    // The existing app.js view is shown unmodified — exactly today's
    // pre-monitor behavior. Operators who explicitly set ?mode=legacy
    // (or HARNESS_MONITOR_MODE=legacy) are opting out of every UI-H
    // surface; this branch is the operator's escape hatch.
    if (mode === "legacy") {
      return {
        hydrationPromise: Promise.resolve({ mode: "legacy", legacy: true }),
        destroy() { /* nothing to tear down — DOM untouched */ },
        _mode: "legacy",
      };
    }

    // Sanitize: anything other than "simple" / "advanced" / "legacy"
    // collapses to "advanced" (the historical default). Garbage from a
    // future caller can't trap the operator on a broken mode.
    const _validModes = ["simple", "advanced"];
    const _mode = _validModes.includes(mode) ? mode : "advanced";

    // ── Activate the shell + push the existing dashboard down ──
    root.classList.add("monitor-shell");
    root.classList.add("is-active");
    root.classList.add("mode-" + _mode);
    if (typeof root.removeAttribute === "function") root.removeAttribute("hidden");
    const body = _doc.body || (root.ownerDocument && root.ownerDocument.body);
    if (body && body.classList && typeof body.classList.add === "function") {
      body.classList.add("monitor-active");
      body.classList.add("monitor-mode-" + _mode);
    }

    // ── Build the skeleton ──
    const globalBarRoot = _doc.createElement("div");
    globalBarRoot.className = "global-bar";
    globalBarRoot.setAttribute("role", "region");
    globalBarRoot.setAttribute("aria-label", "Monitor global bar");

    // Slice UI-H1: mode-toggle region. Sibling of the global-bar so
    // the existing global-bar panel doesn't have to know about modes
    // (low coupling). Mounted in BOTH simple AND advanced — operators
    // can switch from either side. Legacy mode short-circuits before
    // this code runs (nothing to mount; the legacy app.js handles its
    // own UI).
    const modeToggleMount = _doc.createElement("div");
    modeToggleMount.className = "mode-toggle-mount";
    modeToggleMount.setAttribute("role", "region");
    modeToggleMount.setAttribute("aria-label", "Monitor mode selector");

    const errorBox = _doc.createElement("div");
    errorBox.className = "gb-error";
    errorBox.setAttribute("hidden", "");
    errorBox.setAttribute("role", "alert");

    // Slice MA4 + MA5: shell-body row hosts run-rail (left) +
    // center-workspace (centre, split into cw-summary + cw-timeline by
    // MA5) + right-inspector (added in MA5). Below shell-body sits
    // shell-dock (raw event log, full width).
    const shellBody = _doc.createElement("div");
    shellBody.className = "shell-body";
    shellBody.setAttribute("role", "region");
    shellBody.setAttribute("aria-label", "Monitor body");

    const runRail = _doc.createElement("div");
    runRail.className = "run-rail";
    runRail.setAttribute("role", "navigation");
    runRail.setAttribute("aria-label", "Runs and agents");

    // Slice MA6: split the rail into two sections so run-tree (top) and
    // agent-tree (bottom) each own their mount and don't fight over
    // innerHTML clears. Each subregion gets a small header so users can
    // tell the lists apart.
    const runRailSection = _doc.createElement("div");
    runRailSection.className = "rail-section run-rail-section";
    const runRailTitle = _doc.createElement("div");
    runRailTitle.className = "rail-section-title";
    runRailTitle.textContent = "RUNS";
    const runTreeMount = _doc.createElement("div");
    runTreeMount.className = "run-tree-mount";
    runRailSection.appendChild(runRailTitle);
    runRailSection.appendChild(runTreeMount);

    const agentRailSection = _doc.createElement("div");
    agentRailSection.className = "rail-section agent-rail-section";
    const agentRailTitle = _doc.createElement("div");
    agentRailTitle.className = "rail-section-title";
    agentRailTitle.textContent = "AGENTS";
    const agentTreeMount = _doc.createElement("div");
    agentTreeMount.className = "agent-tree-mount";
    agentRailSection.appendChild(agentRailTitle);
    agentRailSection.appendChild(agentTreeMount);

    runRail.appendChild(runRailSection);
    runRail.appendChild(agentRailSection);

    const centerWs = _doc.createElement("div");
    centerWs.className = "center-workspace";
    centerWs.setAttribute("role", "region");
    centerWs.setAttribute("aria-label", "Selected run");

    // MA5: split the centre workspace into a top summary region + a
    // bottom timeline region. Existing run-summary tests/mounts still
    // work because the panel mounts to .cw-summary (a child of the
    // centre workspace), and any test querying for .center-workspace
    // still finds it as the parent.
    const cwSummary = _doc.createElement("div");
    cwSummary.className = "cw-summary";
    cwSummary.setAttribute("role", "region");
    cwSummary.setAttribute("aria-label", "Run summary");

    const cwTimeline = _doc.createElement("div");
    cwTimeline.className = "cw-timeline";
    cwTimeline.setAttribute("role", "region");
    cwTimeline.setAttribute("aria-label", "Event timeline");

    centerWs.appendChild(cwSummary);
    centerWs.appendChild(cwTimeline);

    // MA5: right inspector — context detail for whatever was last selected
    // (events from timeline today; child/finding/subagent in MA6).
    const rightInspector = _doc.createElement("div");
    rightInspector.className = "right-inspector";
    rightInspector.setAttribute("role", "complementary");
    rightInspector.setAttribute("aria-label", "Inspector");

    shellBody.appendChild(runRail);
    shellBody.appendChild(centerWs);
    shellBody.appendChild(rightInspector);

    // MA5: shell-dock row — raw event log under shell-body. Same opt-in
    // gate as the rest of the shell; visible when the monitor is active.
    const shellDock = _doc.createElement("div");
    shellDock.className = "shell-dock";
    shellDock.setAttribute("role", "region");
    shellDock.setAttribute("aria-label", "Bottom dock");

    // Slice D3-d (Phase E1.5, 2026-04-29): hidden settings region.
    // Mounts the settings-accounts panel ONCE at layout init; the
    // global-bar's "설정" button toggles `is-hidden` to show/hide.
    // No conditional create/destroy — keeps the test result cache
    // alive across open/close cycles.
    const settingsMount = _doc.createElement("div");
    settingsMount.className = "settings-accounts-mount is-hidden";
    settingsMount.setAttribute("role", "dialog");
    settingsMount.setAttribute("aria-label", "Accounts settings");

    // Slice UX-2-c (Phase D R3 + E1.5, 2026-04-29): approval card region.
    // Surfaces pending operator approvals between the global bar and
    // the run rail / center workspace. The panel renders a card per
    // pending approval; empty state shows "No pending approvals" but
    // still occupies a slim header row so operators see "approvals
    // are wired" at a glance. CSS hides the region when the slice is
    // empty if needed; for now it's always visible to keep the
    // visual structure stable.
    const approvalMount = _doc.createElement("div");
    approvalMount.className = "approval-card-region";
    approvalMount.setAttribute("role", "region");
    approvalMount.setAttribute("aria-label", "Pending approvals");

    // Slice UI-H2 (Phase D / E1.5, 2026-04-30): Harness Track region.
    // Galloping-horse pipeline visualization tied to the selected
    // run's actual phase (per UI Plan §"가져올 요소 §Harness Track
    // Animation"). Reads selectedRun.phase + pendingApprovals +
    // runDetails.verifyStatus + accountStatus.deployment.publicSector
    // (the last drives reduced-motion mode for public-sector posture).
    const harnessTrackMount = _doc.createElement("div");
    harnessTrackMount.className = "harness-track-region-mount";
    harnessTrackMount.setAttribute("role", "region");
    harnessTrackMount.setAttribute("aria-label", "Harness pipeline track");

    // Slice UI-H3 (Phase D / E1.5, 2026-04-30): Dual Agent Console
    // mount region. Claude on the left, Codex on the right; read-only
    // stream view. UI-H4 wires structured-action input via the
    // review-relay backend. Mounted in advanced mode only — simple
    // mode focuses on operator-friendly cards (UI-H6).
    const dualConsoleMount = _doc.createElement("div");
    dualConsoleMount.className = "dual-agent-console-mount";
    dualConsoleMount.setAttribute("role", "region");
    dualConsoleMount.setAttribute("aria-label", "Dual agent console");

    // Slice UI-H5 (Phase D / E1.5, 2026-04-30): security-status card
    // mount region. Surfaces posture + sandbox + PII + approval
    // pending. Mounted in BOTH simple AND advanced modes — public-
    // sector deployments need to know their defense layers
    // regardless of which shell they prefer.
    const securityStatusMount = _doc.createElement("div");
    securityStatusMount.className = "security-status-card-region";
    securityStatusMount.setAttribute("role", "region");
    securityStatusMount.setAttribute("aria-label", "Security status");

    root.innerHTML = "";
    root.appendChild(globalBarRoot);
    root.appendChild(modeToggleMount);
    root.appendChild(errorBox);
    // Slice UI-H2: harness-track sits between approval region (so
    // operator-blocking approvals stay above-the-fold) and the
    // shell-body / simple-mount. In simple mode it's the primary
    // status visual; in advanced mode it's a compact summary above
    // the rail + center workspace.
    root.appendChild(harnessTrackMount);
    root.appendChild(approvalMount);
    // Slice UI-H5: security-status card sits between approvalMount
    // and the body, so operators on either shell mode see the
    // defense layer summary above-the-fold.
    root.appendChild(securityStatusMount);
    // Slice UI-H1: shell-body + shell-dock are advanced-only. Simple
    // mode renders a placeholder until UI-H6 fills out the cards.
    if (_mode === "advanced") {
      root.appendChild(shellBody);
      // Slice UI-H3: dual-agent-console sits between shell-body and
      // shell-dock so the operator's primary stream view is always
      // close to the run rail / center workspace.
      root.appendChild(dualConsoleMount);
      root.appendChild(shellDock);
    } else {
      // Slice UI-H6: simple shell with 4 operator-friendly cards.
      // The orchestrator (HarnessMonitorSimpleShell) mounts:
      //   [지금 AI가 하는 일]  [승인 필요]
      //   [최근 결과]          [연결 상태]
      // The 5th security-status card lives in its own region above
      // the simple shell (mounted earlier as securityStatusMount).
      const simpleMount = _doc.createElement("div");
      simpleMount.className = "simple-shell-mount";
      simpleMount.setAttribute("role", "region");
      simpleMount.setAttribute("aria-label", "Simple dashboard");
      root.appendChild(simpleMount);

      const SimpleShell = _resolvePanel(panels, "simpleShell", "HarnessMonitorSimpleShell");
      if (SimpleShell && typeof SimpleShell.mount === "function") {
        try {
          simpleShellHandle = SimpleShell.mount({
            root: simpleMount,
            store,
            doc: _doc,
            panels,
            onApprovalsClick() {
              // Scroll to approval card region (always present
              // above the shell-body, gets the operator's eye).
              if (approvalMount && typeof approvalMount.scrollIntoView === "function") {
                try { approvalMount.scrollIntoView({ behavior: "smooth" }); }
                catch (_) { /* defensive */ }
              }
            },
            onOpenSettings() {
              if (settingsMount.classList.contains("is-hidden")) {
                settingsMount.classList.remove("is-hidden");
              } else {
                settingsMount.classList.add("is-hidden");
              }
            },
          });
        } catch (err) {
          showError("simple shell: " + (err && err.message ? err.message : "init failed"), "simpleShell");
        }
      }
    }
    root.appendChild(settingsMount);

    // Slice MB4-a: keyed error sources so hydrate's success-path doesn't
    // wipe a bridge's install failure (and vice versa). Each caller
    // passes a key ("hydrate" / "bridge") and only its own message gets
    // cleared. The rendered text concatenates all live messages.
    const _errorByKey = new Map();
    function _renderError() {
      if (_errorByKey.size === 0) {
        errorBox.setAttribute("hidden", "");
        errorBox.textContent = "";
        return;
      }
      errorBox.removeAttribute("hidden");
      errorBox.textContent = "monitor: "
        + Array.from(_errorByKey.values()).join(" • ");
    }
    function showError(msg, key) {
      _errorByKey.set(key || "general", msg);
      _renderError();
    }
    function clearError(key) {
      const k = key || "general";
      if (!_errorByKey.has(k)) return;
      _errorByKey.delete(k);
      _renderError();
    }

    // ── Mount the global-bar panel ──
    let panelHandle = null;
    const GlobalBar = _resolvePanel(panels, "globalBar", "HarnessMonitorGlobalBar");
    if (GlobalBar) {
      panelHandle = GlobalBar.create({
        root: globalBarRoot,
        store,
        doc: _doc,
        onClose() {
          // Hide the shell without persistence — the user can re-show by
          // reloading with ?monitor=1 or re-setting localStorage.
          root.classList.remove("is-active");
          if (body && body.classList && typeof body.classList.remove === "function") {
            body.classList.remove("monitor-active");
          }
        },
        // Slice D3-d: toggle the settings region's visibility.
        onOpenSettings() {
          if (settingsMount.classList.contains("is-hidden")) {
            settingsMount.classList.remove("is-hidden");
          } else {
            settingsMount.classList.add("is-hidden");
          }
        },
      });
    }

    // ── Slice UI-H1: mount the mode-toggle panel ──
    // Mounted in BOTH simple AND advanced modes. Operators can switch
    // from either side; clicking persists to localStorage + reloads.
    let modeToggleHandle = null;
    const ModeToggle = _resolvePanel(panels, "modeToggle", "HarnessMonitorModeToggle");
    if (ModeToggle) {
      try {
        modeToggleHandle = ModeToggle.create({
          root: modeToggleMount,
          currentMode: _mode,
          doc: _doc,
        });
      } catch (err) {
        // Never break the layout if the mode-toggle panel fails to
        // mount — the rest of the monitor still works without it.
        showError("mode toggle: " + (err && err.message ? err.message : "init failed"), "modeToggle");
      }
    }

    // ── Slice UI-H2: mount the harness-track panel ──
    // Always-live subscription to the store. Renders the 7-lane
    // pipeline + horse marker + rear-callout for approval/verify gates.
    // Public-sector posture (snapshot.accountStatus.deployment.publicSector)
    // forces reduced-motion / idle state.
    let harnessTrackHandle = null;
    const HarnessTrack = _resolvePanel(panels, "harnessTrack", "HarnessMonitorHarnessTrack");
    if (HarnessTrack) {
      try {
        harnessTrackHandle = HarnessTrack.create({
          root: harnessTrackMount,
          store,
          doc: _doc,
        });
      } catch (err) {
        showError("harness track: " + (err && err.message ? err.message : "init failed"), "harnessTrack");
      }
    }

    // ── Slice UI-H5: mount the security-status card (BOTH modes) ──
    let securityStatusHandle = null;
    const SecurityStatusCard = _resolvePanel(panels, "securityStatusCard", "HarnessMonitorSecurityStatusCard");
    if (SecurityStatusCard) {
      try {
        securityStatusHandle = SecurityStatusCard.create({
          root: securityStatusMount,
          store,
          doc: _doc,
        });
      } catch (err) {
        showError("security status: " + (err && err.message ? err.message : "init failed"), "securityStatus");
      }
    }

    // ── Slice UI-H5: posture-aware [data-posture] on documentElement ──
    // Subscribes to accountStatus.deployment.publicSector and writes
    // the attribute to <html> so the harness-shell.css overrides
    // (animation freeze, public-sector visual mode) fire globally.
    // The legacy app.js view (mode === "legacy") doesn't reach this
    // code; it gets standard motion regardless of posture (the
    // monitor shell's job is to apply posture visuals).
    const _docEl = _doc.documentElement
      || (root.ownerDocument && root.ownerDocument.documentElement)
      || (typeof document !== "undefined" ? document.documentElement : null);
    let _postureUnsubscribe = null;
    if (_docEl && typeof _docEl.setAttribute === "function") {
      function _applyPosture(snap) {
        const dep = snap && snap.accountStatus && snap.accountStatus.deployment;
        const isPublicSector = !!(dep && dep.publicSector === true);
        try {
          if (isPublicSector) {
            _docEl.setAttribute("data-posture", "public-sector");
          } else {
            _docEl.setAttribute("data-posture", "standard");
          }
        } catch (_) { /* defensive */ }
      }
      _applyPosture(store.snapshot());
      _postureUnsubscribe = store.subscribe(_applyPosture);
    }

    // Slice UX-2-c (Phase D R3 + E1.5, 2026-04-29): mount the approval
    // card panel into the dedicated region. Always-live subscription
    // to the store; renders cards as approval_requested broadcasts
    // arrive, removes them on approval_resolved.
    let approvalHandle = null;
    const ApprovalCard = _resolvePanel(panels, "approvalCard", "HarnessMonitorApprovalCard");
    if (ApprovalCard) {
      try {
        approvalHandle = ApprovalCard.create({
          root: approvalMount,
          store,
          doc: _doc,
          headers,
          fetchImpl,
        });
      } catch (err) {
        // Never break the layout if the approval panel fails to mount —
        // pending approvals still drive audit chain entries via the
        // manager's broadcastFn; operators just lose the in-shell UI.
        showError("approval panel: " + (err && err.message ? err.message : "init failed"), "approval");
      }
    }

    // Slice D3-d: mount the settings-accounts panel into the hidden
    // region. The panel is always live (subscribed to the store) so
    // open/close just toggles visibility — the test result cache + any
    // in-flight fetches survive the close.
    let settingsHandle = null;
    const SettingsAccounts = _resolvePanel(panels, "settingsAccounts", "HarnessMonitorSettingsAccounts");
    if (SettingsAccounts) {
      try {
        settingsHandle = SettingsAccounts.create({
          root: settingsMount,
          store,
          doc: _doc,
          headers,
          fetchImpl,
          onClose() {
            settingsMount.classList.add("is-hidden");
          },
        });
      } catch (err) {
        // Never break the layout if the settings panel fails to mount —
        // the rest of the monitor still works without it.
        showError("settings panel: " + (err && err.message ? err.message : "init failed"), "settings");
      }
    }

    // ── Advanced-only panels (run-tree / run-summary / timeline /
    //    inspector / bottom-dock / agent-tree) ──
    //
    // Slice UI-H1: these panels mount only when _mode === "advanced".
    // Simple mode renders a placeholder via `simpleMount` above; UI-H6
    // populates that with operator-friendly cards. The shell-body /
    // shell-dock DOM nodes don't exist in simple mode, so attempting
    // to mount these panels there would fail — gate the mounts.
    let runTreeHandle = null;
    let runSummaryHandle = null;
    let timelineHandle = null;
    let inspectorHandle = null;
    let bottomDockHandle = null;
    let agentTreeHandle = null;
    let dualConsoleHandle = null;
    let simpleShellHandle = null;

    if (_mode === "advanced") {
      // ── Slice MA4: mount the run-tree (left rail) + run-summary (centre) ──
      // Slice MA6: run-tree mounts to .run-tree-mount inside the rail
      // section instead of the whole rail (agent-tree gets its own
      // sibling section below).
      const RunTree = _resolvePanel(panels, "runTree", "HarnessMonitorRunTree");
      if (RunTree) {
        runTreeHandle = RunTree.create({
          root: runTreeMount,
          store,
          doc: _doc,
          onSelect(runId) {
            // Wire to the store so the run-summary panel re-renders on its
            // own subscription. We don't carry selection state in layout —
            // the store is the single source of truth.
            if (typeof store.selectRun === "function") store.selectRun(runId);
            // Slice MC1: pull the server-authoritative detail (findings +
            // children + subagents + replayMeta) so agent-tree + run-
            // summary light up with real data instead of stale bootstrap.
            _ensureRunDetailHydrated(runId);
          },
        });
      }

      const RunSummary = _resolvePanel(panels, "runSummary", "HarnessMonitorRunSummary");
      if (RunSummary) {
        runSummaryHandle = RunSummary.create({
          root: cwSummary,    // MA5: was centerWs; now mounts to cw-summary subregion
          store,
          doc: _doc,
        });
      }

      // ── Slice MA5: timeline (centre bottom), inspector (right), bottom-dock (below) ──
      const Timeline = _resolvePanel(panels, "timeline", "HarnessMonitorTimeline");
      if (Timeline) {
        timelineHandle = Timeline.create({
          root: cwTimeline,
          store,
          doc: _doc,
          onSelect(env) {
            if (typeof store.selectItem === "function") store.selectItem("event", env);
          },
        });
      }

      const Inspector = _resolvePanel(panels, "inspector", "HarnessMonitorInspector");
      if (Inspector) {
        inspectorHandle = Inspector.create({
          root: rightInspector,
          store,
          doc: _doc,
        });
      }

      const BottomDock = _resolvePanel(panels, "bottomDock", "HarnessMonitorBottomDock");
      if (BottomDock) {
        bottomDockHandle = BottomDock.create({
          root: shellDock,
          store,
          doc: _doc,
        });
      }

      // ── Slice MA6: agent-tree (left rail bottom) ──
      const AgentTree = _resolvePanel(panels, "agentTree", "HarnessMonitorAgentTree");
      if (AgentTree) {
        agentTreeHandle = AgentTree.create({
          root: agentTreeMount,
          store,
          doc: _doc,
          onSelect(kind, payload) {
            // child / subagent → store.selectItem, inspector picks it up.
            if (typeof store.selectItem === "function") store.selectItem(kind, payload);
          },
        });
      }

      // ── Slice UI-H3 + UI-H7-c: dual-agent-console (Claude + Codex stream + action row) ──
      const DualConsole = _resolvePanel(panels, "dualAgentConsole", "HarnessMonitorDualAgentConsole");
      if (DualConsole) {
        // UI-H7-c: resolve review-session client. Test path uses the
        // explicit `reviewSessionClient` mount option; browser falls
        // back to window.HarnessReviewSessionClient (loaded via
        // <script src="js/monitor/review-session-client.js">).
        const _client = reviewSessionClient
          || (typeof window !== "undefined" && window.HarnessReviewSessionClient)
          || null;
        try {
          dualConsoleHandle = DualConsole.create({
            root: dualConsoleMount,
            store,
            doc: _doc,
            client: _client,
            onError: (err) => {
              // UI-H7-c + UI-H7-e: surface client errors via the
              // existing global-bar error box + a console.warn
              // fallback. Public-sector 409 + network failures map
              // to operator-friendly Korean messages so the toast
              // reads naturally instead of "(error_code) http_status".
              const friendlyMsg = _formatReviewError(err);
              showError(friendlyMsg, "reviewSession");
            },
          });
        } catch (err) {
          showError("dual console: " + (err && err.message ? err.message : "init failed"), "dualConsole");
        }
      }
    }

    // ── Slice MB4-a: install the legacy bridge BEFORE hydration so any
    //    events that arrive while bootstrap is in flight are captured. ──
    let bridgeHandle = null;
    const Bridge = _resolveBridge(bridge);
    if (Bridge && typeof normalize === "function") {
      try {
        const bridgeOpts = { store, normalize, fetchImpl, headers };
        if (typeof bridgeRefreshIntervalMs === "number") {
          bridgeOpts.refreshIntervalMs = bridgeRefreshIntervalMs;
        }
        bridgeHandle = Bridge.install(bridgeOpts);
      } catch (err) {
        // Bridge install must never abort the layout mount. Surface in
        // the error box (keyed) but keep going so panels still render.
        showError("bridge: " + (err && err.message ? err.message : String(err)), "bridge");
      }
    }

    // ── Slice MC1: per-run detail auto-hydrator ──
    //
    // _ensureRunDetailHydrated(runId) is the bridge between
    // runTree.onSelect and the server-authoritative detail payload.
    // Dedupe: same runId already in-flight → skip new fetch.
    // TTL:    cached < runDetailTtlMs old → skip (avoid tab-cycling
    //         spam). Default 30s. Set runDetailTtlMs:0 to force every
    //         click to refetch (tests).
    // Errors are swallowed so a failed detail fetch never breaks the
    // selection flow — the agent-tree falls back to events-ring data.
    const runDetailHydrateFn = _resolveRunDetailHydrate(runDetailHydrate);
    const _runDetailInFlight = new Set();
    const _runDetailFetchedAt = new Map();
    function _ensureRunDetailHydrated(runId) {
      if (typeof runDetailHydrateFn !== "function") return;
      if (typeof runId !== "string" || !runId) return;
      if (_runDetailInFlight.has(runId)) return;
      const last = _runDetailFetchedAt.get(runId) || 0;
      if (runDetailTtlMs > 0 && Date.now() - last < runDetailTtlMs) return;
      _runDetailInFlight.add(runId);
      Promise.resolve(runDetailHydrateFn({ store, runId, fetchImpl, headers }))
        .then(() => { _runDetailFetchedAt.set(runId, Date.now()); })
        .catch(() => { /* swallowed — store left untouched per hydrate contract */ })
        .then(() => { _runDetailInFlight.delete(runId); });
    }

    // ── Kick off hydration ──
    const hydrateFn = _resolveHydrate(hydrate);
    let hydrationPromise = Promise.resolve();
    if (typeof hydrateFn === "function" && typeof normalize === "function") {
      hydrationPromise = hydrateFn({
        store,
        normalize,
        fetchImpl,
        headers,
      })
        .then(() => {
          clearError("hydrate");
          // Slice MC1: kick off detail hydrate for whatever the
          // bootstrap pre-selected (typically the orchestrator's
          // default run). Without this, a brand-new tab open shows
          // empty findings + empty subagents until the user clicks
          // a run row.
          try {
            const sel = store.snapshot && store.snapshot().selectedRunId;
            if (sel) _ensureRunDetailHydrated(sel);
          } catch (_) {}
        })
        .catch((err) => {
          showError(err && err.message ? err.message : String(err), "hydrate");
        });
    }

    return {
      hydrationPromise,
      destroy() {
        try { panelHandle && panelHandle.destroy && panelHandle.destroy(); } catch (_) {}
        // Slice UI-H1: tear down mode-toggle alongside the global-bar.
        try { modeToggleHandle && modeToggleHandle.destroy && modeToggleHandle.destroy(); } catch (_) {}
        try { runTreeHandle && runTreeHandle.destroy && runTreeHandle.destroy(); } catch (_) {}
        try { runSummaryHandle && runSummaryHandle.destroy && runSummaryHandle.destroy(); } catch (_) {}
        try { timelineHandle && timelineHandle.destroy && timelineHandle.destroy(); } catch (_) {}
        try { inspectorHandle && inspectorHandle.destroy && inspectorHandle.destroy(); } catch (_) {}
        try { bottomDockHandle && bottomDockHandle.destroy && bottomDockHandle.destroy(); } catch (_) {}
        try { agentTreeHandle && agentTreeHandle.destroy && agentTreeHandle.destroy(); } catch (_) {}
        // Slice UI-H6: tear down simple shell first (its inner card
        // handles unsubscribe individually).
        try { simpleShellHandle && simpleShellHandle.destroy && simpleShellHandle.destroy(); } catch (_) {}
        // Slice UI-H3: tear down the dual-agent-console.
        try { dualConsoleHandle && dualConsoleHandle.destroy && dualConsoleHandle.destroy(); } catch (_) {}
        // Slice UI-H2: tear down the harness-track panel.
        try { harnessTrackHandle && harnessTrackHandle.destroy && harnessTrackHandle.destroy(); } catch (_) {}
        // Slice UI-H5: tear down security-status card + posture watcher.
        try { securityStatusHandle && securityStatusHandle.destroy && securityStatusHandle.destroy(); } catch (_) {}
        try { _postureUnsubscribe && _postureUnsubscribe(); } catch (_) {}
        try {
          if (_docEl && typeof _docEl.removeAttribute === "function") {
            _docEl.removeAttribute("data-posture");
          }
        } catch (_) {}
        // Slice UX-2-c: tear down the approval card before the bridge.
        try { approvalHandle && approvalHandle.destroy && approvalHandle.destroy(); } catch (_) {}
        // Slice D3-d: tear down the settings panel before the bridge.
        try { settingsHandle && settingsHandle.destroy && settingsHandle.destroy(); } catch (_) {}
        // Slice MB4-a: tear down the bridge LAST so any final events that
        // panels might emit during destroy still reach the store cleanly.
        try { bridgeHandle && bridgeHandle.destroy && bridgeHandle.destroy(); } catch (_) {}
        root.classList.remove("is-active");
        root.classList.remove("monitor-shell");
        if (typeof root.setAttribute === "function") root.setAttribute("hidden", "");
        if (body && body.classList && typeof body.classList.remove === "function") {
          body.classList.remove("monitor-active");
        }
        root.innerHTML = "";
      },
      // Test hooks (prefixed _).
      _showError: showError,
      _clearError: clearError,
      _errorBox: errorBox,
      _globalBarRoot: globalBarRoot,
      _runRail: runRail,
      _centerWs: centerWs,
      _shellBody: shellBody,
      // MA5 hooks
      _cwSummary: cwSummary,
      _cwTimeline: cwTimeline,
      _rightInspector: rightInspector,
      _shellDock: shellDock,
      // MA6 hooks
      _runRailSection: runRailSection,
      _agentRailSection: agentRailSection,
      _runTreeMount: runTreeMount,
      _agentTreeMount: agentTreeMount,
      // Slice UX-2-c: approval region + handle exposed for tests.
      _approvalMount: approvalMount,
      _approvalHandle: approvalHandle,
      // Slice UI-H2: harness-track region + handle exposed for tests.
      _harnessTrackMount: harnessTrackMount,
      _harnessTrackHandle: harnessTrackHandle,
      // Slice UI-H3: dual-agent-console region + handle exposed for tests.
      _dualConsoleMount: dualConsoleMount,
      _dualConsoleHandle: dualConsoleHandle,
      // Slice UI-H5: security-status region + handle exposed for tests.
      _securityStatusMount: securityStatusMount,
      _securityStatusHandle: securityStatusHandle,
      // Slice UI-H6: simple-shell handle exposed for tests.
      _simpleShellHandle: simpleShellHandle,
      // Slice UI-H1: shell-mode + mode-toggle exposed for tests.
      _mode,
      _modeToggleMount: modeToggleMount,
      _modeToggleHandle: modeToggleHandle,
      // MB4-a hooks
      _bridgeHandle: bridgeHandle,
      // MC1 hooks — tests inspect dedupe/TTL state directly
      _ensureRunDetailHydrated,
      _runDetailInFlight,
      _runDetailFetchedAt,
    };
  }

  return {
    mount,
    // Slice UI-H7-e: exposed for unit tests so the friendly message
    // table is verifiable without driving a full mount.
    _formatReviewError,
  };
});
