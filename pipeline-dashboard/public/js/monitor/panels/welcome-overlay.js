// Slice UI-H8 (Phase D / Phase E1.5, 2026-04-30) — first-visit welcome overlay.
//
// Operator-facing onboarding banner shown when the dashboard boots
// with NO active profile. Three states:
//
//   1. profile.count === 0 + profile.activeId === null
//      → "처음 오셨네요" full-onboarding panel.
//        Two CTAs:
//          [설정 마법사로 시작]  → onOpenSetupWizard()  (CLI guide / settings modal)
//          [개인 프로필 빠른 생성] → onCreatePersonal()  (POST /api/profiles)
//        Plus dismissible "x" → onDismiss() so power-users who run
//        the wizard from a separate shell can hide the overlay.
//
//   2. profile.count > 0 + profile.activeId === null
//      → "활성 프로필이 없습니다" warning banner.
//        Single CTA: [계정 설정 열기] → onOpenSettings().
//
//   3. profile.activeId !== null
//      → overlay is hidden entirely (handle.update() returns false).
//
// Dismissal is session-scoped: `localStorage.setItem("harness:welcomeDismissed", "1")`.
// The overlay re-appears on each new session (new tab / new boot)
// until a profile is actually active. This is intentional — once a
// profile is configured the overlay disappears regardless of dismissal.
//
// Reads from store.snapshot:
//   accountStatus.profile.{activeId, count, activeLabel, credentialBackend}
//
// The overlay is NEVER full-screen modal — it sits as a banner at
// the top of the simple-shell grid so the operator can still see
// the cards behind it. This honours the "monitor-first" principle
// (cards always visible) while making the missing-profile state
// loud enough that nobody misses it.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.OrchestratorMonitorWelcomeOverlay = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  const DISMISS_KEY = "harness:welcomeDismissed";

  function _readDismissed(storage) {
    if (!storage || typeof storage.getItem !== "function") return false;
    try {
      return storage.getItem(DISMISS_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function _writeDismissed(storage, val) {
    if (!storage || typeof storage.setItem !== "function") return;
    try {
      if (val) storage.setItem(DISMISS_KEY, "1");
      else storage.removeItem && storage.removeItem(DISMISS_KEY);
    } catch (_) { /* defensive */ }
  }

  function _classify(snapshot) {
    const ac = (snapshot && snapshot.accountStatus) || null;
    const profile = (ac && ac.profile) || {};
    const activeId = profile.activeId || null;
    const count = typeof profile.count === "number" ? profile.count : 0;
    if (activeId) return "ready";
    if (count === 0) return "first-visit";
    return "no-active";
  }

  function create({
    root, store, doc,
    onOpenSetupWizard,
    onCreatePersonal,
    onOpenSettings,
    onDismiss,
    storage,
  } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("welcome-overlay.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function" || typeof store.snapshot !== "function") {
      throw new Error("welcome-overlay.create: store must be a OrchestratorMonitorStore");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc || typeof _doc.createElement !== "function") {
      throw new Error("welcome-overlay.create: no document available");
    }
    const _storage = storage || (typeof window !== "undefined" ? window.localStorage : null);

    let destroyed = false;
    let unsubscribe = null;
    let lastClassification = null;

    function _button(text, kind) {
      const btn = _doc.createElement("button");
      btn.type = "button";
      btn.className = "wo-action wo-action-" + (kind || "primary");
      btn.textContent = text;
      return btn;
    }

    function _renderFirstVisit() {
      root.innerHTML = "";
      root.classList.add("wo-banner", "wo-first-visit");
      root.classList.remove("wo-no-active", "wo-hidden");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "환영합니다");

      const title = _doc.createElement("h2");
      title.className = "wo-title";
      title.textContent = "환영합니다 — 시작하기 전에 프로필이 필요합니다";
      root.appendChild(title);

      const lede = _doc.createElement("p");
      lede.className = "wo-lede";
      lede.textContent =
        "Claude / Codex CLI 자격 증명을 안전하게 보관하려면 프로필을 만들어야 합니다. " +
        "설정 마법사가 두 CLI를 자동으로 찾아 시험까지 해 줍니다.";
      root.appendChild(lede);

      const actions = _doc.createElement("div");
      actions.className = "wo-actions";

      const wizardBtn = _button("설정 마법사로 시작", "primary");
      wizardBtn.addEventListener("click", () => {
        try { typeof onOpenSetupWizard === "function" && onOpenSetupWizard(); }
        catch (_) { /* defensive */ }
      });
      actions.appendChild(wizardBtn);

      const quickBtn = _button("개인 프로필 빠른 생성", "secondary");
      quickBtn.addEventListener("click", () => {
        try { typeof onCreatePersonal === "function" && onCreatePersonal(); }
        catch (_) { /* defensive */ }
      });
      actions.appendChild(quickBtn);

      root.appendChild(actions);

      const dismiss = _doc.createElement("button");
      dismiss.type = "button";
      dismiss.className = "wo-dismiss";
      dismiss.setAttribute("aria-label", "환영 배너 닫기");
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => {
        _writeDismissed(_storage, true);
        try { typeof onDismiss === "function" && onDismiss(); } catch (_) {}
        _hide();
      });
      root.appendChild(dismiss);
    }

    function _renderNoActive(profile) {
      root.innerHTML = "";
      root.classList.add("wo-banner", "wo-no-active");
      root.classList.remove("wo-first-visit", "wo-hidden");
      root.setAttribute("role", "region");
      root.setAttribute("aria-label", "활성 프로필 없음");

      const title = _doc.createElement("h2");
      title.className = "wo-title";
      title.textContent = "활성 프로필이 없습니다";
      root.appendChild(title);

      const lede = _doc.createElement("p");
      lede.className = "wo-lede";
      const count = typeof profile.count === "number" ? profile.count : 0;
      lede.textContent =
        `등록된 프로필 ${count}개 중 활성 프로필이 지정되지 않았습니다. ` +
        "계정 설정에서 사용할 프로필을 선택하세요.";
      root.appendChild(lede);

      const actions = _doc.createElement("div");
      actions.className = "wo-actions";

      const settingsBtn = _button("계정 설정 열기", "primary");
      settingsBtn.addEventListener("click", () => {
        try { typeof onOpenSettings === "function" && onOpenSettings(); }
        catch (_) { /* defensive */ }
      });
      actions.appendChild(settingsBtn);

      root.appendChild(actions);

      const dismiss = _doc.createElement("button");
      dismiss.type = "button";
      dismiss.className = "wo-dismiss";
      dismiss.setAttribute("aria-label", "배너 닫기");
      dismiss.textContent = "×";
      dismiss.addEventListener("click", () => {
        _writeDismissed(_storage, true);
        try { typeof onDismiss === "function" && onDismiss(); } catch (_) {}
        _hide();
      });
      root.appendChild(dismiss);
    }

    function _hide() {
      root.innerHTML = "";
      root.classList.remove("wo-first-visit", "wo-no-active");
      root.classList.add("wo-hidden");
      root.removeAttribute("role");
      root.removeAttribute("aria-label");
    }

    function render() {
      if (destroyed) return false;
      const snap = store.snapshot();
      const cls = _classify(snap);
      lastClassification = cls;

      if (cls === "ready") {
        _hide();
        return false;
      }

      // Ready → not-ready transition: clear stale dismissal so the
      // operator sees the new state. (Going from ready → not-ready
      // is unusual; usually it means a profile was deleted.)
      // No-op: dismissal is allowed at any time.

      if (_readDismissed(_storage)) {
        _hide();
        return false;
      }

      const profile = (snap.accountStatus && snap.accountStatus.profile) || {};
      if (cls === "first-visit") _renderFirstVisit();
      else _renderNoActive(profile);
      return true;
    }

    // Initial render + subscription so we react to accountStatus refreshes.
    render();
    unsubscribe = store.subscribe(() => render());

    return {
      destroy() {
        destroyed = true;
        if (typeof unsubscribe === "function") unsubscribe();
        root.innerHTML = "";
        root.classList.remove("wo-banner", "wo-first-visit", "wo-no-active", "wo-hidden");
        root.removeAttribute("role");
        root.removeAttribute("aria-label");
      },
      // Expose for tests / external callers that want to force a
      // re-render (e.g. after clearing dismissal).
      _render: render,
      _classification() { return lastClassification; },
      _isDismissed() { return _readDismissed(_storage); },
      _resetDismiss() { _writeDismissed(_storage, false); render(); },
    };
  }

  return {
    create,
    DISMISS_KEY,
    _classify,
    _readDismissed,
    _writeDismissed,
  };
});
