// Slice UI-FirstRun-b (Phase D Round UI-P, 2026-05-04) —
// "지금 해야 할 일" (Next Action) card.
//
// Operator-facing card mounted in the simple shell that surfaces the
// most blocking first-run state and offers concrete CTAs to fix it.
// Companion to UI-H8 welcome-overlay:
//
//   - welcome-overlay (UI-H8): coarse 3-state strip (first-visit /
//     no-active / ready). Banner-style at top of grid.
//   - next-action-card (UI-FirstRun-b): fine-grained 6-state card
//     (no-profile / no-active-profile / public-sector-incomplete /
//     provider-missing / provider-not-authenticated / ready). Card-style
//     within the simple shell grid.
//
// The two coexist — welcome-overlay handles the "completely empty
// state" hero treatment; next-action-card persists in the grid even
// when ready, so operators always see "what's the next concrete
// action I can take to verify health".
//
// Reads from store.snapshot.accountStatus (profile / deployment /
// providerStatus). Re-renders on store.subscribe.
//
// CTAs are wired by the caller via `onCta(ctaId, meta)` callback.
// Panel doesn't know HOW to "open settings" — that's simple-shell's
// job. Keeps the panel testable with stub callbacks.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessNextActionCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Allow Node-test loading the firstRunClassifier without circular
  // dependency in browser. In browser context, the classifier is
  // exposed on window or through a separate <script> include.
  let _classifierFactory = null;
  function _classifier() {
    if (_classifierFactory) return _classifierFactory;
    if (typeof require === "function") {
      try {
        _classifierFactory = require("../../runtime/firstRunClassifier");
        return _classifierFactory;
      } catch (_) { /* fall through to globalThis */ }
    }
    if (typeof globalThis !== "undefined" && globalThis.HarnessFirstRunClassifier) {
      _classifierFactory = globalThis.HarnessFirstRunClassifier;
      return _classifierFactory;
    }
    throw new Error(
      "next-action-card: firstRunClassifier not available — ensure " +
      "src/runtime/firstRunClassifier.js is loaded in the page or " +
      "registered on globalThis.HarnessFirstRunClassifier",
    );
  }

  // i18n keys per state — caller is responsible for HarnessI18n
  // injection. Fallback strings are Korean (production locale).
  const STATE_COPY = {
    "no-profile": {
      headlineKey: "firstRun.noProfile.headline",
      headlineFallback: "프로필이 아직 없습니다",
      bodyKey: "firstRun.noProfile.body",
      bodyFallback: "Claude / Codex와 연결할 첫 프로필을 만들어야 작업을 시작할 수 있습니다.",
    },
    "no-active-profile": {
      headlineKey: "firstRun.noActiveProfile.headline",
      headlineFallback: "활성 프로필을 선택해 주세요",
      bodyKey: "firstRun.noActiveProfile.body",
      bodyFallback: "프로필이 등록되어 있지만 어떤 프로필이 활성 상태인지 지정되지 않았습니다.",
    },
    "public-sector-incomplete": {
      headlineKey: "firstRun.publicSectorIncomplete.headline",
      headlineFallback: "🛡 공공기관 모드 설정이 끝나지 않았습니다",
      bodyKey: "firstRun.publicSectorIncomplete.body",
      bodyFallback: "공공기관 / 사내망 정책이 적용되어 있어 추가 동의 + 샌드박스 설정이 필요합니다.",
    },
    "provider-missing": {
      headlineKey: "firstRun.providerMissing.headline",
      headlineFallback: "Claude 또는 Codex CLI가 설치되어 있지 않습니다",
      bodyKey: "firstRun.providerMissing.body",
      bodyFallback: "활성 프로필은 있지만 CLI 도구를 찾을 수 없습니다. 설치를 확인하거나 경로를 다시 잡아 주세요.",
    },
    "provider-not-authenticated": {
      headlineKey: "firstRun.providerNotAuthenticated.headline",
      headlineFallback: "Claude / Codex 로그인이 필요합니다",
      bodyKey: "firstRun.providerNotAuthenticated.body",
      bodyFallback: "CLI는 설치되어 있지만 인증 상태가 확인되지 않습니다. 각 도구에서 로그인해 주세요.",
    },
    "ready": {
      headlineKey: "firstRun.ready.headline",
      headlineFallback: "사용할 준비가 되었습니다",
      bodyKey: "firstRun.ready.body",
      bodyFallback: "활성 프로필이 설정되어 있습니다. 필요하면 연결 상태를 한 번 확인해 보세요.",
    },
  };

  // CTA labels — kebab-case CTA IDs from firstRunClassifier.CTA
  const CTA_COPY = {
    "create-profile": {
      labelKey: "firstRun.cta.createProfile",
      labelFallback: "개인 프로필 빠른 생성",
    },
    "open-setup-wizard": {
      labelKey: "firstRun.cta.openSetupWizard",
      labelFallback: "설정 마법사로 시작",
    },
    "open-settings-profiles": {
      labelKey: "firstRun.cta.openSettingsProfiles",
      labelFallback: "계정 설정 열기",
    },
    "open-public-sector-setup": {
      labelKey: "firstRun.cta.openPublicSectorSetup",
      labelFallback: "공공기관 설정 마법사",
    },
    "test-claude": {
      labelKey: "firstRun.cta.testClaude",
      labelFallback: "Claude 연결 확인",
    },
    "test-codex": {
      labelKey: "firstRun.cta.testCodex",
      labelFallback: "Codex 연결 확인",
    },
    "reopen-setup-for-providers": {
      labelKey: "firstRun.cta.reopenSetupForProviders",
      labelFallback: "설정 마법사 다시 열기",
    },
    "auth-claude": {
      labelKey: "firstRun.cta.authClaude",
      labelFallback: "Claude 로그인",
    },
    "auth-codex": {
      labelKey: "firstRun.cta.authCodex",
      labelFallback: "Codex 로그인",
    },
  };

  function _t(i18n, key, fallback, params) {
    if (i18n && typeof i18n.t === "function") {
      try {
        const v = i18n.t(key, params || {});
        if (v && v !== key) return v;
      } catch (_) { /* fall through */ }
    }
    // Fallback path: simple `{name}` substitution so tests without
    // an injected i18n still see the params interpolated.
    if (params && typeof fallback === "string") {
      return fallback.replace(/\{(\w+)\}/g, function (_m, name) {
        return params[name] !== undefined ? String(params[name]) : "";
      });
    }
    return fallback;
  }

  function create({ root, store, doc, i18n, onCta, label = "지금 해야 할 일" } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("next-action-card.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("next-action-card.create: store with subscribe() required");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("next-action-card.create: document not available");

    const { classifyFirstRun } = _classifier();

    // Build the card scaffold once + cache references for cheap update.
    const card = _doc.createElement("section");
    card.className = "nac-card";
    card.setAttribute("data-card", "next-action");
    card.setAttribute("role", "region");
    card.setAttribute("aria-label", _t(i18n, "firstRun.aria.region", label));

    const labelEl = _doc.createElement("div");
    labelEl.className = "nac-label";
    labelEl.setAttribute("data-card-slot", "label");
    labelEl.textContent = _t(i18n, "firstRun.cardLabel", label);
    card.appendChild(labelEl);

    const headline = _doc.createElement("div");
    headline.className = "nac-headline";
    headline.setAttribute("data-card-slot", "headline");
    card.appendChild(headline);

    const body = _doc.createElement("p");
    body.className = "nac-body";
    body.setAttribute("data-card-slot", "body");
    card.appendChild(body);

    const ctaRow = _doc.createElement("div");
    ctaRow.className = "nac-cta-row";
    ctaRow.setAttribute("data-card-slot", "cta-row");
    card.appendChild(ctaRow);

    const meta = _doc.createElement("div");
    meta.className = "nac-meta";
    meta.setAttribute("data-card-slot", "meta");
    card.appendChild(meta);

    root.appendChild(card);

    let lastState = null;

    function _renderCtas(ctas, verdict) {
      // Wipe + rebuild — small, infrequent operation.
      while (ctaRow.firstChild) ctaRow.removeChild(ctaRow.firstChild);
      ctas.forEach(function (ctaId, idx) {
        const copy = CTA_COPY[ctaId];
        if (!copy) return;
        const btn = _doc.createElement("button");
        btn.type = "button";
        btn.className = "nac-cta nac-cta-" + ctaId + (idx === 0 ? " is-primary" : "");
        btn.setAttribute("data-cta", ctaId);
        btn.textContent = _t(i18n, copy.labelKey, copy.labelFallback);
        btn.addEventListener("click", function () {
          if (typeof onCta === "function") {
            try { onCta(ctaId, verdict.meta || {}); } catch (_) { /* swallow */ }
          }
        });
        ctaRow.appendChild(btn);
      });
    }

    function _renderMeta(verdict) {
      // State-specific meta line. Honest framing: tell operator
      // exactly what we know and don't know.
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      const state = verdict.state;
      const m = verdict.meta || {};
      let text = "";
      if (state === "no-active-profile" && typeof m.profileCount === "number") {
        text = _t(i18n, "firstRun.meta.profileCount",
          "등록된 프로필: {count}개", { count: m.profileCount });
      } else if (state === "provider-missing" && Array.isArray(m.missing) && m.missing.length > 0) {
        text = _t(i18n, "firstRun.meta.missing",
          "확인 안된 도구: {runners}", { runners: m.missing.join(" / ") });
      } else if (state === "provider-not-authenticated" && Array.isArray(m.unauthenticated)) {
        text = _t(i18n, "firstRun.meta.unauth",
          "로그인 필요: {runners}", { runners: m.unauthenticated.join(" / ") });
      } else if (state === "ready" && m.providerStatusKnown === false) {
        text = _t(i18n, "firstRun.meta.untestedHint",
          "연결 상태는 아직 확인되지 않았습니다. 위 버튼으로 한 번 테스트해 보세요.");
      }
      if (text) {
        const span = _doc.createElement("span");
        span.textContent = text;
        meta.appendChild(span);
      }
    }

    function _render(snapshot) {
      const ac = snapshot && snapshot.accountStatus;
      const verdict = classifyFirstRun(ac);
      const stateChanged = verdict.state !== lastState;
      lastState = verdict.state;
      const copy = STATE_COPY[verdict.state];
      headline.textContent = _t(i18n, copy.headlineKey, copy.headlineFallback);
      body.textContent = _t(i18n, copy.bodyKey, copy.bodyFallback);
      card.setAttribute("data-state", verdict.state);
      // Public-sector posture flips visual treatment via CSS attribute.
      if (ac && ac.deployment && ac.deployment.publicSector) {
        card.setAttribute("data-posture", "public-sector");
      } else {
        card.removeAttribute("data-posture");
      }
      _renderCtas(verdict.ctas, verdict);
      _renderMeta(verdict);
      return { state: verdict.state, stateChanged };
    }

    // Initial render + subscribe
    _render(store.snapshot ? store.snapshot() : null);
    const unsub = store.subscribe(function () {
      _render(store.snapshot());
    });

    return {
      card,
      destroy: function () {
        try { unsub && unsub(); } catch (_) {}
        try { root.removeChild(card); } catch (_) {}
      },
      // Test hooks — let unit tests force a re-render with a stub
      // snapshot or read the last verdict.
      _render,
      _readState: function () { return lastState; },
    };
  }

  return { create, STATE_COPY, CTA_COPY };
});
