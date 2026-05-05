// Slice POL-UI-1-a (Phase 2 v2 follow-up, 2026-05-05) — Pack-info card.
//
// Operator-facing display of the current policy pack (resolved at boot
// from HARNESS_DEPLOYMENT_PROFILE) + the runtime-effective hard-gates
// mode + run-memory state + public-sector requirement checklist (when
// applicable) + restart hint + collapsible alternatives.
//
// Closes the POL-c deferred UI: POL-c shipped the store slice +
// legacy-bridge fetch + 23 i18n keys; this panel is the operator
// surface that reads them.
//
// Data flow:
//   GET /api/policy-packs (legacy-bridge one-shot at boot)
//     → store.policyPacks slice (frozen at boot; pack switch needs
//       server restart, so polling is wasted work)
//     → snapshot.policyPacks → this panel renders
//
// Reads from store:
//   - snapshot.policyPacks = { schema, currentPack, packs[],
//                              metadata{ hardGatesEffectiveMode,
//                                        runMemoryEffective,
//                                        hardGatesEnvOverride,
//                                        runMemoryEnvOverride,
//                                        publicSectorRequirements[] },
//                              serverTime }
//
// Does NOT write to store: read-only display.
//
// CTAs (forwarded via onCta(actionId, meta)):
//   - "open-deployment-docs" — link to harness-pipeline-distribution-guide
//
// Mount position (set by simple-shell.js):
//   Below recommendations-card, above the 4-card grid. Operator sees
//   "current pack" as a posture banner before the work cards.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") root.HarnessPackInfoCard = api;
})(typeof window !== "undefined" ? window : globalThis, function () {

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

  // ── Pack-rule field rendering helpers ──────────────────────

  // Boolean-shaped rule fields render as "예/아니오" + visual badge.
  // Some non-boolean fields (scannerFailurePolicy = "fail-closed" |
  // "warn-only") render as the literal value.
  const BOOLEAN_RULE_FIELDS = Object.freeze([
    "publicSector",
    "allowLocalExecutor",
    "allowPersonalAccounts",
    "allowPlaintextSecrets",
    "requireSandboxWorkspace",
    "requireAgencyManagedAccount",
    "requireSignedManifest",
    "requirePiiScanBeforeProviderDispatch",
    "hardGatesDefault",
    "runMemoryEnabled",
  ]);

  const STRING_RULE_FIELDS = Object.freeze([
    "scannerFailurePolicy",
  ]);

  // POL-DIFF-1-a (Phase 2 v2 follow-up, 2026-05-05): All comparable
  // fields in priority order — boolean fields first, then string
  // fields. The diff renderer iterates this array so the table has
  // stable ordering.
  const DIFFABLE_RULE_FIELDS = Object.freeze([
    ...BOOLEAN_RULE_FIELDS,
    ...STRING_RULE_FIELDS,
  ]);

  // POL-DIFF-1-a: compute a structured diff between two pack
  // entries from the /api/policy-packs response. Returns:
  //   { changed: number, rows: [{ field, fromValue, toValue, isChanged }] }
  // - `changed` count is the headline ("3 rules differ")
  // - `rows` is the full ordered list, with `isChanged: true` for
  //   the rows that differ + `false` for unchanged (rendered for
  //   context but visually de-emphasized)
  // Both packs must be objects from the bridge-fetched policyPacks
  // catalog. Missing fields are treated as `null` (legitimate
  // absence — older snapshots may not carry every field).
  function diffPacks(packA, packB) {
    const rows = [];
    let changed = 0;
    for (const field of DIFFABLE_RULE_FIELDS) {
      const fromValue = packA && (field in packA) ? packA[field] : null;
      const toValue = packB && (field in packB) ? packB[field] : null;
      const isChanged = fromValue !== toValue;
      if (isChanged) changed++;
      rows.push({ field, fromValue, toValue, isChanged });
    }
    return { changed, rows };
  }

  function _renderRuleValue(doc, value, i18n) {
    const span = doc.createElement("span");
    span.className = "pic-rule-value";
    if (typeof value === "boolean") {
      span.textContent = value
        ? _t(i18n, "policyPack.value.yes", "예")
        : _t(i18n, "policyPack.value.no", "아니오");
      span.setAttribute("data-rule-bool", value ? "true" : "false");
    } else if (value == null) {
      span.textContent = "—";
      span.setAttribute("data-rule-bool", "unset");
    } else {
      span.textContent = String(value);
    }
    return span;
  }

  // ── create({...}) → handle ────────────────────────────────

  function create({ root, store, doc, i18n, onCta } = {}) {
    if (!root || typeof root.appendChild !== "function") {
      throw new Error("pack-info-card.create: root must be an element");
    }
    if (!store || typeof store.subscribe !== "function") {
      throw new Error("pack-info-card.create: store with subscribe() required");
    }
    const _doc = doc || (typeof document !== "undefined" ? document : null);
    if (!_doc) throw new Error("pack-info-card.create: document not available");

    // ── Build the card scaffold once + cache references ────

    const card = _doc.createElement("section");
    card.className = "pic-card";
    card.setAttribute("data-card", "pack-info");
    card.setAttribute("role", "region");
    card.setAttribute(
      "aria-label",
      _t(i18n, "policyPack.aria.region", "정책 팩 정보"),
    );

    const labelEl = _doc.createElement("div");
    labelEl.className = "pic-label";
    labelEl.textContent = _t(i18n, "policyPack.cardLabel", "현재 정책 팩");
    card.appendChild(labelEl);

    // Current pack header row (badge + currently-active hint)
    const headerRow = _doc.createElement("div");
    headerRow.className = "pic-header";
    const currentPackBadge = _doc.createElement("span");
    currentPackBadge.className = "pic-current-pack";
    currentPackBadge.setAttribute("data-current-pack", "");
    headerRow.appendChild(currentPackBadge);
    const currentHint = _doc.createElement("span");
    currentHint.className = "pic-current-hint";
    currentHint.textContent = _t(i18n, "policyPack.currentLabel", "현재 사용 중");
    headerRow.appendChild(currentHint);
    card.appendChild(headerRow);

    // Runtime effective row (hard-gates + run-memory + override badges)
    const runtimeRow = _doc.createElement("div");
    runtimeRow.className = "pic-runtime";
    runtimeRow.setAttribute("data-runtime-row", "");
    const runtimeLabel = _doc.createElement("div");
    runtimeLabel.className = "pic-runtime-label";
    runtimeLabel.textContent = _t(
      i18n, "policyPack.runtimeEffective.label",
      "현재 런타임 적용 상태",
    );
    runtimeRow.appendChild(runtimeLabel);
    const runtimeValues = _doc.createElement("div");
    runtimeValues.className = "pic-runtime-values";
    runtimeRow.appendChild(runtimeValues);
    card.appendChild(runtimeRow);

    // Public-sector requirements panel (only shown when currentPack is publicSector)
    const reqsPanel = _doc.createElement("div");
    reqsPanel.className = "pic-public-sector-reqs";
    reqsPanel.setAttribute("data-public-sector-reqs", "");
    reqsPanel.hidden = true;
    card.appendChild(reqsPanel);

    // Restart hint (always visible)
    const hintEl = _doc.createElement("div");
    hintEl.className = "pic-restart-hint";
    hintEl.textContent = _t(
      i18n, "policyPack.changeHint",
      "팩 변경은 서버 재시작이 필요합니다 (HARNESS_DEPLOYMENT_PROFILE 환경변수 변경 + 재부팅).",
    );
    card.appendChild(hintEl);

    // Alternatives — collapsible (<details>) so the operator can expand
    // when comparing packs. Default closed.
    const altDetails = _doc.createElement("details");
    altDetails.className = "pic-alternatives";
    altDetails.setAttribute("data-alternatives", "");
    const altSummary = _doc.createElement("summary");
    altSummary.className = "pic-alt-summary";
    altSummary.textContent = _t(
      i18n, "policyPack.alternatives.summary",
      "다른 팩 비교 보기",
    );
    altDetails.appendChild(altSummary);
    const altList = _doc.createElement("div");
    altList.className = "pic-alt-list";
    altDetails.appendChild(altList);
    card.appendChild(altDetails);

    // Empty-state placeholder (shown until store has data)
    const emptyEl = _doc.createElement("div");
    emptyEl.className = "pic-empty";
    emptyEl.setAttribute("data-empty", "");
    emptyEl.textContent = _t(
      i18n, "policyPack.empty",
      "정책 팩 정보를 불러오는 중...",
    );
    card.appendChild(emptyEl);

    root.appendChild(card);

    // ── Render functions ───────────────────────────────────

    function _renderRuntimeValues(meta) {
      runtimeValues.innerHTML = "";
      if (!meta) return;
      // Hard gates mode + (env override badge)
      const hgRow = _doc.createElement("span");
      hgRow.className = "pic-runtime-item pic-runtime-hg";
      hgRow.setAttribute("data-runtime-key", "hardGates");
      hgRow.textContent = _t(
        i18n, "policyPack.runtimeEffective.hardGates",
        "하드 게이트: {mode}",
        { mode: meta.hardGatesEffectiveMode || "—" },
      );
      if (meta.hardGatesEnvOverride) {
        const ovr = _doc.createElement("span");
        ovr.className = "pic-runtime-override";
        ovr.textContent = " " + _t(
          i18n, "policyPack.runtimeEffective.envOverride",
          "(환경변수 명시)",
        );
        hgRow.appendChild(ovr);
      }
      runtimeValues.appendChild(hgRow);

      // Run memory state + (env override badge)
      const rmRow = _doc.createElement("span");
      rmRow.className = "pic-runtime-item pic-runtime-rm";
      rmRow.setAttribute("data-runtime-key", "runMemory");
      rmRow.textContent = _t(
        i18n, "policyPack.runtimeEffective.runMemory",
        "런 메모리: {state}",
        { state: meta.runMemoryEffective
            ? _t(i18n, "policyPack.value.enabled", "활성")
            : _t(i18n, "policyPack.value.disabled", "비활성") },
      );
      if (meta.runMemoryEnvOverride) {
        const ovr = _doc.createElement("span");
        ovr.className = "pic-runtime-override";
        ovr.textContent = " " + _t(
          i18n, "policyPack.runtimeEffective.envOverride",
          "(환경변수 명시)",
        );
        rmRow.appendChild(ovr);
      }
      runtimeValues.appendChild(rmRow);
    }

    function _renderPublicSectorRequirements(currentPackEntry, meta) {
      reqsPanel.innerHTML = "";
      const reqs = (meta && Array.isArray(meta.publicSectorRequirements))
        ? meta.publicSectorRequirements : [];
      const isPublicSector = !!(currentPackEntry && currentPackEntry.publicSector);
      if (!isPublicSector || reqs.length === 0) {
        reqsPanel.hidden = true;
        return;
      }
      reqsPanel.hidden = false;
      const title = _doc.createElement("div");
      title.className = "pic-reqs-title";
      title.textContent = _t(
        i18n, "policyPack.publicSectorRequirements.title",
        "🛡 공공기관 / 규제 배포 요구사항",
      );
      reqsPanel.appendChild(title);
      const intro = _doc.createElement("div");
      intro.className = "pic-reqs-intro";
      intro.textContent = _t(
        i18n, "policyPack.publicSectorRequirements.intro",
        "이 팩을 선택하기 전에 다음을 준비해 두세요:",
      );
      reqsPanel.appendChild(intro);
      const ul = _doc.createElement("ul");
      ul.className = "pic-reqs-list";
      for (const req of reqs) {
        const li = _doc.createElement("li");
        li.className = "pic-reqs-item";
        li.textContent = String(req);
        ul.appendChild(li);
      }
      reqsPanel.appendChild(ul);
    }

    function _renderAlternatives(packs, currentPackId) {
      altList.innerHTML = "";
      if (!Array.isArray(packs)) return;
      const others = packs.filter((p) => p && p.modeId !== currentPackId);
      if (others.length === 0) {
        const noneEl = _doc.createElement("div");
        noneEl.className = "pic-alt-none";
        noneEl.textContent = _t(
          i18n, "policyPack.alternatives.none",
          "(다른 팩이 등록되어 있지 않습니다)",
        );
        altList.appendChild(noneEl);
        return;
      }
      // POL-DIFF-1-a: resolve current pack entry once for diff
      // computation. If currentPack object can't be resolved (e.g.
      // catalog is partial), the diff button silently degrades to
      // hidden — alt-card still renders without the comparison.
      const currentPackEntry = packs.find((p) => p && p.modeId === currentPackId)
        || packs.find((p) => p && p.isCurrent)
        || null;

      for (const p of others) {
        const card = _doc.createElement("div");
        card.className = "pic-alt-card";
        card.setAttribute("data-alt-pack", p.modeId);
        // Pack label (localized via modeId key)
        const labelKey = "policyPack.modeId." + p.modeId;
        const localized = _t(i18n, labelKey, p.label || p.modeId);
        const labelDiv = _doc.createElement("div");
        labelDiv.className = "pic-alt-label";
        labelDiv.textContent = localized;
        card.appendChild(labelDiv);
        // Description (truncate to ~100 chars defensively)
        if (p.description) {
          const desc = _doc.createElement("div");
          desc.className = "pic-alt-desc";
          const trimmed = String(p.description);
          desc.textContent = trimmed.length > 140
            ? trimmed.slice(0, 137) + "…"
            : trimmed;
          card.appendChild(desc);
        }
        // Three quick badges: publicSector / hardGatesDefault / runMemoryEnabled
        const badges = _doc.createElement("div");
        badges.className = "pic-alt-badges";
        if (p.publicSector) {
          const b = _doc.createElement("span");
          b.className = "pic-alt-badge pic-alt-badge-ps";
          b.textContent = _t(i18n, "policyPack.altBadge.publicSector", "공공기관");
          badges.appendChild(b);
        }
        if (p.hardGatesDefault) {
          const b = _doc.createElement("span");
          b.className = "pic-alt-badge pic-alt-badge-hg";
          b.textContent = _t(i18n, "policyPack.altBadge.hardGates", "기본 하드 게이트");
          badges.appendChild(b);
        }
        if (p.runMemoryEnabled === false) {
          const b = _doc.createElement("span");
          b.className = "pic-alt-badge pic-alt-badge-norm";
          b.textContent = _t(i18n, "policyPack.altBadge.noRunMemory", "런 메모리 OFF");
          badges.appendChild(b);
        }
        card.appendChild(badges);

        // POL-DIFF-1-a: diff toggle. Operator clicks "비교 보기"
        // → reveal a 2-column rule diff highlighting changes
        // between currentPack and this alt. Read-only — no
        // runtime mutation, just a "what would change if I
        // switched" preview. Only mounted when we have BOTH
        // a current-pack entry AND a non-zero diff (no point
        // showing a button if the packs are identical).
        if (currentPackEntry) {
          const diff = diffPacks(currentPackEntry, p);
          if (diff.changed > 0) {
            const diffWrap = _doc.createElement("div");
            diffWrap.className = "pic-alt-diff-wrap";
            diffWrap.setAttribute("data-diff-state", "collapsed");

            const toggleBtn = _doc.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = "pic-alt-diff-toggle";
            toggleBtn.setAttribute("aria-expanded", "false");
            toggleBtn.setAttribute("data-diff-toggle", p.modeId);
            toggleBtn.textContent = _t(
              i18n, "policyPack.altDiff.toggle",
              "비교 보기 ({count}개 차이)",
              { count: diff.changed },
            );

            const diffPanel = _doc.createElement("div");
            diffPanel.className = "pic-alt-diff-panel";
            diffPanel.setAttribute("data-diff-panel", p.modeId);
            diffPanel.hidden = true;
            // Build the diff table once + cache (re-render on
            // toggle would be wasted work — pack data is frozen
            // for the life of the boot).
            _renderDiffTable(diffPanel, diff, currentPackEntry, p);

            // Toggle wiring
            toggleBtn.addEventListener("click", function () {
              const expanded = !diffPanel.hidden ? false : true;
              diffPanel.hidden = !expanded;
              toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
              diffWrap.setAttribute("data-diff-state",
                expanded ? "expanded" : "collapsed");
              toggleBtn.textContent = _t(
                i18n,
                expanded
                  ? "policyPack.altDiff.collapse"
                  : "policyPack.altDiff.toggle",
                expanded ? "비교 닫기 ({count}개 차이)" : "비교 보기 ({count}개 차이)",
                { count: diff.changed },
              );
            });

            diffWrap.appendChild(toggleBtn);
            diffWrap.appendChild(diffPanel);
            card.appendChild(diffWrap);
          }
        }

        altList.appendChild(card);
      }
    }

    // POL-DIFF-1-a: render the diff table inside a panel. Each
    // changed row shows from→to; unchanged rows are present but
    // visually de-emphasized (operator sees full context, not just
    // the deltas — useful when a small change matters because
    // surrounding rules support a posture).
    function _renderDiffTable(panel, diff, fromPack, toPack) {
      const table = _doc.createElement("div");
      table.className = "pic-alt-diff-table";
      table.setAttribute("role", "table");

      // Header row
      const headerRow = _doc.createElement("div");
      headerRow.className = "pic-alt-diff-row pic-alt-diff-header";
      headerRow.setAttribute("role", "row");

      const fieldHeader = _doc.createElement("div");
      fieldHeader.className = "pic-alt-diff-field-header";
      fieldHeader.textContent = _t(i18n, "policyPack.altDiff.fieldHeader", "규칙");
      headerRow.appendChild(fieldHeader);

      const fromHeader = _doc.createElement("div");
      fromHeader.className = "pic-alt-diff-from-header";
      const fromLabel = _t(i18n,
        "policyPack.modeId." + (fromPack.modeId || ""),
        fromPack.label || fromPack.modeId || "현재");
      fromHeader.textContent = _t(i18n, "policyPack.altDiff.fromHeader",
        "현재 ({label})", { label: fromLabel });
      headerRow.appendChild(fromHeader);

      const toHeader = _doc.createElement("div");
      toHeader.className = "pic-alt-diff-to-header";
      const toLabel = _t(i18n,
        "policyPack.modeId." + (toPack.modeId || ""),
        toPack.label || toPack.modeId || "대상");
      toHeader.textContent = _t(i18n, "policyPack.altDiff.toHeader",
        "전환 시 ({label})", { label: toLabel });
      headerRow.appendChild(toHeader);

      table.appendChild(headerRow);

      // Body rows — changed first, then unchanged (de-emphasized)
      const changedFirst = diff.rows.slice().sort((a, b) => {
        if (a.isChanged === b.isChanged) return 0;
        return a.isChanged ? -1 : 1;
      });
      for (const row of changedFirst) {
        const tr = _doc.createElement("div");
        tr.className = "pic-alt-diff-row";
        tr.setAttribute("role", "row");
        if (row.isChanged) tr.setAttribute("data-changed", "true");

        const fieldCell = _doc.createElement("div");
        fieldCell.className = "pic-alt-diff-field";
        fieldCell.textContent = _t(
          i18n, "policyPack.field." + row.field, row.field);
        tr.appendChild(fieldCell);

        const fromCell = _doc.createElement("div");
        fromCell.className = "pic-alt-diff-from";
        fromCell.appendChild(_renderRuleValue(_doc, row.fromValue, i18n));
        tr.appendChild(fromCell);

        const toCell = _doc.createElement("div");
        toCell.className = "pic-alt-diff-to";
        toCell.appendChild(_renderRuleValue(_doc, row.toValue, i18n));
        tr.appendChild(toCell);

        table.appendChild(tr);
      }

      panel.appendChild(table);
    }

    function _renderCurrentPackBadge(currentPackEntry, currentPackId) {
      const labelKey = "policyPack.modeId." + (currentPackId || "");
      const localized = _t(
        i18n, labelKey,
        (currentPackEntry && currentPackEntry.label) || currentPackId || "—",
      );
      currentPackBadge.textContent = localized;
      currentPackBadge.setAttribute("data-current-pack", currentPackId || "");
      // Visual variant tag for CSS — public-sector packs render with a
      // distinct posture color.
      if (currentPackEntry && currentPackEntry.publicSector) {
        currentPackBadge.setAttribute("data-public-sector", "true");
      } else {
        currentPackBadge.removeAttribute("data-public-sector");
      }
    }

    function render(snapshot) {
      const pp = snapshot && snapshot.policyPacks;
      if (!pp) {
        // Empty state — keep the empty placeholder visible.
        emptyEl.hidden = false;
        headerRow.hidden = true;
        runtimeRow.hidden = true;
        reqsPanel.hidden = true;
        altDetails.hidden = true;
        hintEl.hidden = true;
        return;
      }
      emptyEl.hidden = true;
      headerRow.hidden = false;
      runtimeRow.hidden = false;
      altDetails.hidden = false;
      hintEl.hidden = false;
      // Resolve the current pack entry (the one with isCurrent or
      // matching modeId).
      const currentId = pp.currentPack || null;
      let currentEntry = null;
      if (Array.isArray(pp.packs)) {
        currentEntry = pp.packs.find((p) => p && p.modeId === currentId)
          || pp.packs.find((p) => p && p.isCurrent)
          || null;
      }
      _renderCurrentPackBadge(currentEntry, currentId);
      _renderRuntimeValues(pp.metadata);
      _renderPublicSectorRequirements(currentEntry, pp.metadata);
      _renderAlternatives(pp.packs, currentId);
    }

    // Initial render + subscription
    let lastSnapshot = null;
    function _trigger() {
      try {
        lastSnapshot = store.snapshot();
        render(lastSnapshot);
      } catch (_) { /* never break the shell on a render fault */ }
    }
    _trigger();
    const unsubscribe = store.subscribe(_trigger);

    // The onCta seam exists for future extensions (e.g. "open
    // deployment guide", "compare packs side-by-side"). Today the
    // panel doesn't dispatch any CTAs by itself, but future slices
    // may add a "비교하기" / "Compare" button per alternative card.
    if (typeof onCta === "function") {
      // Reserved for future use — keep parameter shape stable for
      // tests that pass a stub.
    }

    return {
      destroy() {
        try { unsubscribe && unsubscribe(); } catch (_) {}
        try { card.remove(); } catch (_) {}
      },
      _render: render,            // exposed for tests
      _lastSnapshot() { return lastSnapshot; },
    };
  }

  return {
    create,
    // POL-DIFF-1-a: helper exports for unit tests.
    diffPacks,
    DIFFABLE_RULE_FIELDS,
  };
});
