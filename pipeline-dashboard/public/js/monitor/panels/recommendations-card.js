// Slice SMART-1-b (Phase 2 SMART arc, 2026-05-04) — Recommendations
// Card. First UI consumer of SMART-0 decisionContext + SMART-1
// recommendation engine.
//
// Renders prioritized recommendation rows in the simple shell.
// Layout pattern matches next-action-card (UI-FirstRun-b):
//   - Single section root (data-card="recommendations")
//   - One row per recommendation (data-rec-id="<id>")
//   - Each row: severity dot + title + body + Primary CTA + Dismiss
//
// Reads from store:
//   - snapshot.decisionContext (SMART-0 polled state)
//   - snapshot.dismissedRecommendations (SMART-1 panel-side)
//
// Writes to store:
//   - store.dismissRecommendation(ruleId) on Dismiss click
//
// Fires onCta callback to caller (simple-shell):
//   onCta(ctaActionId, {ruleId, meta})

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessRecommendationsCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

  // ── Engine resolver (Node + browser) ────────────────────────

  let _engine = null;
  function _resolveEngine() {
    if (_engine) return _engine;
    if (typeof require === "function") {
      try {
        _engine = require("../../runtime/recommendationEngine");
        return _engine;
      } catch (_) { /* fall through to globalThis */ }
    }
    if (typeof globalThis !== "undefined" && globalThis.HarnessRecommendationEngine) {
      _engine = globalThis.HarnessRecommendationEngine;
      return _engine;
    }
    throw new Error(
      "recommendations-card: HarnessRecommendationEngine not available — " +
      "ensure public/js/runtime/recommendationEngine.js is loaded before " +
      "this script (or registered on globalThis).",
    );
  }

  // ── i18n helper with placeholder substitution ──────────────

  function _t(i18n, key, fallback, params) {
    if (i18n && typeof i18n.t === "function") {
      try {
        const v = i18n.t(key, params || {});
        if (v && v !== key) return v;
      } catch (_) { /* fall through */ }
    }
    if (params && typeof fallback === "string") {
      return fallback.replace(/\{(\w+)\}/g, function (_m, name) {
        return params[name] !== undefined ? String(params[name]) : "";
      });
    }
    return fallback;
  }

  // ── Severity → CSS state attribute ─────────────────────────

  const SEVERITY_STATE = {
    critical: "critical",
    high: "high",
    medium: "medium",
    info: "info",
  };

  // ── create({...}) → handle ────────────────────────────────

  function create({ root, store, doc, i18n, onCta, dismissedKey } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("recommendations-card.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("recommendations-card.create: store with subscribe() required");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("recommendations-card.create: document not available");

    const engine = _resolveEngine();

    // Build the card scaffold once + cache references.
    const card = _doc.createElement("section");
    card.className = "rec-card";
    card.setAttribute("data-card", "recommendations");
    card.setAttribute("role", "region");
    card.setAttribute(
      "aria-label",
      _t(i18n, "smart.rec.aria.region", "추천 카드"),
    );

    const labelEl = _doc.createElement("div");
    labelEl.className = "rec-label";
    labelEl.setAttribute("data-card-slot", "label");
    labelEl.textContent = _t(i18n, "smart.rec.cardLabel", "추천");
    card.appendChild(labelEl);

    const list = _doc.createElement("div");
    list.className = "rec-list";
    list.setAttribute("data-card-slot", "list");
    card.appendChild(list);

    const empty = _doc.createElement("div");
    empty.className = "rec-empty";
    empty.setAttribute("data-card-slot", "empty");
    empty.textContent = _t(i18n, "smart.rec.empty",
      "현재 권장 행동이 없습니다.");
    card.appendChild(empty);

    root.appendChild(card);

    // ── Render single recommendation row ──────────────────────

    function _renderRow(rec) {
      const row = _doc.createElement("div");
      row.className = "rec-row rec-row-" + rec.severity;
      row.setAttribute("data-rec-id", rec.id);
      row.setAttribute("data-severity", SEVERITY_STATE[rec.severity] || "info");

      // Severity dot
      const dot = _doc.createElement("span");
      dot.className = "rec-dot";
      dot.setAttribute("data-rec-slot", "dot");
      row.appendChild(dot);

      // Body block (title + body text)
      const bodyBlock = _doc.createElement("div");
      bodyBlock.className = "rec-body-block";
      const title = _doc.createElement("div");
      title.className = "rec-title";
      title.setAttribute("data-rec-slot", "title");
      title.textContent = _t(i18n, rec.titleKey, rec.title, rec.meta);
      const body = _doc.createElement("div");
      body.className = "rec-body";
      body.setAttribute("data-rec-slot", "body");
      body.textContent = _t(i18n, rec.bodyKey, rec.body, rec.meta);
      bodyBlock.appendChild(title);
      bodyBlock.appendChild(body);
      row.appendChild(bodyBlock);

      // Action block (Primary CTA + Dismiss)
      const actions = _doc.createElement("div");
      actions.className = "rec-actions";
      actions.setAttribute("data-rec-slot", "actions");

      const ctaBtn = _doc.createElement("button");
      ctaBtn.type = "button";
      ctaBtn.className = "rec-cta is-primary";
      ctaBtn.setAttribute("data-cta", rec.ctaActionId);
      ctaBtn.setAttribute("data-rec-id", rec.id);
      ctaBtn.textContent = _t(i18n, rec.ctaKey, rec.ctaLabel, rec.meta);
      ctaBtn.addEventListener("click", function () {
        if (typeof onCta === "function") {
          try { onCta(rec.ctaActionId, { ruleId: rec.id, meta: rec.meta }); }
          catch (_) { /* swallow */ }
        }
      });
      actions.appendChild(ctaBtn);

      const dismissBtn = _doc.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.className = "rec-dismiss";
      dismissBtn.setAttribute("data-action", "dismiss-rec");
      dismissBtn.setAttribute("data-rec-id", rec.id);
      dismissBtn.setAttribute("aria-label",
        _t(i18n, "smart.rec.dismiss.aria",
           "추천 닫기: {title}", { title: title.textContent }));
      dismissBtn.textContent = _t(i18n, "smart.rec.dismiss", "닫기");
      dismissBtn.addEventListener("click", function () {
        if (typeof store.dismissRecommendation === "function") {
          try { store.dismissRecommendation(rec.id); } catch (_) {}
        }
      });
      actions.appendChild(dismissBtn);

      row.appendChild(actions);
      return row;
    }

    // ── Render entire card (re-runs on every store publish) ───

    function _render(snapshot) {
      const ctx = snapshot && snapshot.decisionContext;
      const dismissedArr = (snapshot && snapshot.dismissedRecommendations) || [];
      const dismissed = new Set(dismissedArr);
      let recs = [];
      try {
        recs = engine.recommendFromContext(ctx, { dismissedIds: dismissed });
      } catch (_) { recs = []; }

      // Wipe + rebuild list (small + infrequent — typical case has
      // ≤ 4 recs)
      while (list.firstChild) list.removeChild(list.firstChild);
      for (const rec of recs) {
        list.appendChild(_renderRow(rec));
      }

      // Empty-state visibility
      if (recs.length === 0) {
        empty.removeAttribute("hidden");
        card.setAttribute("data-state", "empty");
      } else {
        empty.setAttribute("hidden", "true");
        card.setAttribute("data-state", "populated");
        card.setAttribute("data-rec-count", String(recs.length));
      }
      // Highest severity attribute (hint for CSS treatment)
      if (recs.length > 0) {
        card.setAttribute("data-top-severity", recs[0].severity);
      } else {
        card.removeAttribute("data-top-severity");
      }
      return recs;
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
      _render,
      _readRecs: function () {
        const ctx = store.snapshot && store.snapshot().decisionContext;
        const dismissedArr = (store.snapshot && store.snapshot().dismissedRecommendations) || [];
        return engine.recommendFromContext(ctx, {
          dismissedIds: new Set(dismissedArr),
        });
      },
    };
  }

  return { create, SEVERITY_STATE };
});
