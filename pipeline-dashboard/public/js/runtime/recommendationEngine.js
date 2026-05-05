// Slice SMART-1-a (Phase 2 SMART arc, 2026-05-04) — Recommendation
// Engine. First consumer of SMART-0 decisionContext.
//
// Maps the 8-boolean / 5-count / posture snapshot from
// `harness-decision-context/v1` to a prioritized list of
// recommendation cards rendered in simple shell.
//
// Why frozen rules + pure derive:
//   - Frozen registry → adding/removing a rule is a deliberate
//     PR-reviewed change (matches piiScanner / assertions / etc.)
//   - Pure function → trivially testable (no I/O), easy to compose
//     with future SMART-2 hard-gate logic
//   - i18n keys → ko/en parity tested separately (i18n.coverage.test.js)
//   - CTA action IDs → simple-shell knows how to dispatch each
//
// Severity ordering (highest → lowest):
//   critical > high > medium > info
// recommendFromContext() returns rules sorted by severity then by
// rule index (preserves declaration order for ties).
//
// DismissibleSet: caller passes a Set of dismissed-rule IDs (from
// the operator's panel-side localStorage). Engine filters them out
// of the final list. Operator clicks dismiss → set add ID → next
// derive call doesn't include it. State changes (e.g., a NEW
// approval arrives) re-trigger the dismiss-then-show cycle.
//
// Module shape: UMD — same load pattern as firstRunClassifier
// (Node `require` + browser `<script>` registering globalThis
// HarnessRecommendationEngine). Tests can require it directly.

"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.HarnessRecommendationEngine = api;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this),
   function () {

const SEVERITY_ORDER = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  info: 3,
});

// 7 frozen rules. Each rule:
//   id           — kebab-case stable ID (used for dismiss tracking)
//   severity     — critical / high / medium / info
//   titleKey     — i18n key for title
//   titleFallback — Korean fallback string (production locale)
//   bodyKey      — i18n key for body
//   bodyFallback — Korean fallback string
//   ctaKey       — i18n key for primary CTA label
//   ctaFallback  — Korean fallback CTA label
//   ctaActionId  — string passed to onCta callback in simple-shell
//                  dispatcher (matches firstRunClassifier CTA IDs
//                  where overlap exists)
//   appliesTo(context) → boolean (pure predicate; no side effects)
//   meta(context) → object (interpolation values for {placeholders})

const RULES = Object.freeze([
  // ── BASE 5 (apply in any posture) ────────────────────────────

  // 1. CRITICAL: no active profile blocks every other action.
  Object.freeze({
    id: "complete-profile-setup",
    severity: "critical",
    titleKey: "smart.rec.completeProfileSetup.title",
    titleFallback: "프로필 설정이 필요합니다",
    bodyKey: "smart.rec.completeProfileSetup.body",
    bodyFallback: "활성 프로필이 없어 어떤 작업도 시작할 수 없습니다.",
    ctaKey: "smart.rec.completeProfileSetup.cta",
    ctaFallback: "설정 마법사 열기",
    ctaActionId: "open-setup-wizard",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      return !!(b && !b.hasActiveProfile);
    },
    meta: function () { return {}; },
  }),

  // 2. HIGH: pending operator approvals.
  Object.freeze({
    id: "resolve-pending-approvals",
    severity: "high",
    titleKey: "smart.rec.resolveApprovals.title",
    titleFallback: "승인 요청 {count}개 대기 중",
    bodyKey: "smart.rec.resolveApprovals.body",
    bodyFallback: "AI 도구 실행이 운영자 결정을 기다리고 있습니다.",
    ctaKey: "smart.rec.resolveApprovals.cta",
    ctaFallback: "승인 카드 보기",
    ctaActionId: "scroll-to-approval-card",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      return !!(b && b.approvalPending);
    },
    meta: function (ctx) {
      const c = ctx && ctx.counts;
      return { count: (c && c.pendingApprovals) || 0 };
    },
  }),

  // 3. MEDIUM: codex review pending in active session.
  Object.freeze({
    id: "request-codex-review",
    severity: "medium",
    titleKey: "smart.rec.requestCodexReview.title",
    titleFallback: "Codex 비평 대기 중인 세션이 있습니다",
    bodyKey: "smart.rec.requestCodexReview.body",
    bodyFallback: "Claude 결과를 Codex에게 검토시키면 정확성을 한 번 더 확인할 수 있습니다.",
    ctaKey: "smart.rec.requestCodexReview.cta",
    ctaFallback: "리뷰 세션 보기",
    ctaActionId: "open-review-sessions",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      return !!(b && b.codexReviewMissing);
    },
    meta: function (ctx) {
      const c = ctx && ctx.counts;
      return { count: (c && c.openReviewSessions) || 0 };
    },
  }),

  // 4. INFO: active runs are running healthily.
  Object.freeze({
    id: "monitor-active-runs",
    severity: "info",
    titleKey: "smart.rec.monitorActiveRuns.title",
    titleFallback: "{count}개 작업이 실행 중입니다",
    bodyKey: "smart.rec.monitorActiveRuns.body",
    bodyFallback: "현재 진행 중인 작업의 상태를 확인하세요.",
    ctaKey: "smart.rec.monitorActiveRuns.cta",
    ctaFallback: "최근 결과 보기",
    ctaActionId: "open-recent-results",
    appliesTo: function (ctx) {
      const c = ctx && ctx.counts;
      return !!(c && c.activeRuns > 0);
    },
    meta: function (ctx) {
      const c = ctx && ctx.counts;
      return { count: (c && c.activeRuns) || 0 };
    },
  }),

  // 5. INFO: audit export available + nothing blocking.
  Object.freeze({
    id: "export-audit-evidence",
    severity: "info",
    titleKey: "smart.rec.exportAuditEvidence.title",
    titleFallback: "감사 봉투 export 준비됨",
    bodyKey: "smart.rec.exportAuditEvidence.body",
    bodyFallback: "감사관에게 제출할 sealed JSON 봉투를 만들 수 있습니다.",
    ctaKey: "smart.rec.exportAuditEvidence.cta",
    ctaFallback: "감사 봉투 만들기",
    ctaActionId: "open-audit-export",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      // Show only when there's something to export AND nothing
      // urgent is blocking. Otherwise the more critical recs
      // above will fill the card slot.
      return !!(b && b.auditExportReady && !b.needsHumanDecision);
    },
    meta: function () { return {}; },
  }),

  // ── PUBLIC-SECTOR 2 (only when posture.publicSector true) ────

  // 6. CRITICAL: PII detected in public-sector posture is a hard
  // block (matches GOV-PII-0 fail-closed semantics). The card is
  // informational — actual blocking happens in the runtime gate.
  Object.freeze({
    id: "public-sector-pii-block",
    severity: "critical",
    titleKey: "smart.rec.publicSectorPiiBlock.title",
    titleFallback: "🛡 공공기관 모드: 개인정보 감지로 차단됨",
    bodyKey: "smart.rec.publicSectorPiiBlock.body",
    bodyFallback: "공공기관 / 사내망 정책에 따라 개인정보가 포함된 입력은 외부 모델 호출이 차단됩니다. 개인정보를 제거하거나 샌드박스로 옮기세요.",
    ctaKey: "smart.rec.publicSectorPiiBlock.cta",
    ctaFallback: "보안 정책 확인",
    ctaActionId: "open-security-policy",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      return !!(b && b.publicSector && b.hasPii);
    },
    meta: function () { return {}; },
  }),

  // 7. HIGH: in public-sector mode, regularly exporting audit
  // evidence is part of compliance procurement readiness.
  Object.freeze({
    id: "public-sector-evidence-trail",
    severity: "high",
    titleKey: "smart.rec.publicSectorEvidenceTrail.title",
    titleFallback: "🛡 공공기관 감사 evidence 권장",
    bodyKey: "smart.rec.publicSectorEvidenceTrail.body",
    bodyFallback: "공공기관 절차상 정기적으로 감사 봉투를 export해 보관해 두는 것이 좋습니다.",
    ctaKey: "smart.rec.publicSectorEvidenceTrail.cta",
    ctaFallback: "감사 봉투 만들기",
    ctaActionId: "open-audit-export",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      return !!(b && b.publicSector && b.auditExportReady);
    },
    meta: function () { return {}; },
  }),

  // ── BASELINE 1 (only fires when nothing else applies) ───────────
  //
  // SMART-1-BASELINE-a (Phase 2 v2 follow-up, 2026-05-05):
  // The recommendations-card was landing on its empty state ("현재
  // 권장 행동이 없습니다.") on fresh deployments where the operator
  // has an active profile but hasn't done anything yet (no PII, no
  // approvals, no review sessions, no active runs, no audit export
  // pending). Empty is technically correct but operator-hostile —
  // it doesn't confirm "everything is fine, just start working".
  //
  // The baseline rule fills that gap. It applies when:
  //   - operator has an active profile (otherwise rule #1 fires —
  //     critical, blocks everything)
  //   - AND no other rule matches (engine post-processing filters
  //     this rule out when any non-baseline rule applies)
  //
  // Marked `isBaseline: true`; the engine drops baseline matches
  // when any non-baseline match exists. CTA is a no-op anchor that
  // routes to the setup wizard for "verify everything is fine"
  // operators (a cheap, safe destination — clicking it never
  // mutates state).
  Object.freeze({
    id: "system-ready",
    severity: "info",
    isBaseline: true,
    titleKey: "smart.rec.systemReady.title",
    titleFallback: "✓ 시스템 준비됨",
    bodyKey: "smart.rec.systemReady.body",
    bodyFallback: "현재 처리 중인 작업이 없습니다. 첫 요청을 시작해 보거나 설정을 점검할 수 있습니다.",
    ctaKey: "smart.rec.systemReady.cta",
    ctaFallback: "설정 확인",
    ctaActionId: "open-setup-wizard",
    appliesTo: function (ctx) {
      const b = ctx && ctx.booleans;
      // Fire only when operator is "set up enough to do something" —
      // we don't want to overlap with rule #1 (no profile = critical).
      return !!(b && b.hasActiveProfile);
    },
    meta: function () { return {}; },
  }),
]);

const RULE_IDS = Object.freeze(RULES.map(function (r) { return r.id; }));
const SEVERITY_KEYS = Object.freeze(["critical", "high", "medium", "info"]);

// ── Internal helpers ────────────────────────────────────────────

function _safeIndex(severity) {
  const v = SEVERITY_ORDER[severity];
  return typeof v === "number" ? v : 99;
}

function _interpolate(template, params) {
  if (!params || typeof params !== "object") return template;
  return String(template).replace(/\{(\w+)\}/g, function (_, name) {
    return params[name] !== undefined ? String(params[name]) : "";
  });
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Run all rules against decisionContext + return prioritized
 * recommendations.
 *
 * @param {object} ctx       harness-decision-context/v1 snapshot
 *                            (or null/undefined → empty result)
 * @param {object} [opts]
 *   @param {Set<string>} [opts.dismissedIds]
 *                            Rule IDs the operator dismissed; engine
 *                            filters them out.
 * @returns {Array<{id, severity, title, body, ctaLabel, ctaActionId,
 *                  meta, applies}>} recommendations in priority order
 */
function recommendFromContext(ctx, opts) {
  const o = opts || {};
  const dismissed = (o.dismissedIds instanceof Set) ? o.dismissedIds : null;

  const matches = [];
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (dismissed && dismissed.has(rule.id)) continue;
    let applies = false;
    try {
      applies = !!rule.appliesTo(ctx);
    } catch (_) { applies = false; }
    if (!applies) continue;
    let meta = {};
    try {
      meta = rule.meta(ctx) || {};
    } catch (_) { meta = {}; }
    matches.push({
      id: rule.id,
      severity: rule.severity,
      title: _interpolate(rule.titleFallback, meta),
      body: _interpolate(rule.bodyFallback, meta),
      ctaLabel: rule.ctaFallback,
      ctaActionId: rule.ctaActionId,
      titleKey: rule.titleKey,
      bodyKey: rule.bodyKey,
      ctaKey: rule.ctaKey,
      meta: meta,
      ruleIndex: i,
      // SMART-1-BASELINE-a: thread the baseline flag through so the
      // post-processing step below can drop baselines when non-
      // baselines fire. Defaults to false (existing rules unchanged).
      isBaseline: rule.isBaseline === true,
    });
  }

  // SMART-1-BASELINE-a: drop baseline matches when any non-baseline
  // match exists. Baselines are the "everything is fine, no urgent
  // action" filler — they exist to keep the card useful when
  // nothing else applies, NOT to compete for slot-space with real
  // recommendations.
  const hasNonBaseline = matches.some(function (m) { return !m.isBaseline; });
  let filtered = matches;
  if (hasNonBaseline) {
    filtered = matches.filter(function (m) { return !m.isBaseline; });
  }

  // Sort by severity (critical first), then by rule index for
  // stable ordering on ties.
  filtered.sort(function (a, b) {
    const sevDiff = _safeIndex(a.severity) - _safeIndex(b.severity);
    if (sevDiff !== 0) return sevDiff;
    return a.ruleIndex - b.ruleIndex;
  });

  return filtered;
}

/**
 * Returns the rule object (frozen) matching an id, or null.
 * Used by the panel for i18n rendering when the engine output
 * was already serialized.
 */
function getRule(id) {
  for (const rule of RULES) {
    if (rule.id === id) return rule;
  }
  return null;
}

return {
  RULES,
  RULE_IDS,
  SEVERITY_ORDER,
  SEVERITY_KEYS,
  recommendFromContext,
  getRule,
  // Internal helpers exported for shape testing
  _interpolate,
  _safeIndex,
};

});  // end UMD factory
