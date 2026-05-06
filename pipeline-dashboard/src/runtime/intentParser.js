// Slice AGENT-DESKTOP-0-a (Phase 2 chat-first UX, 2026-05-06) — intent parser.
//
// Translates a free-form chat input (Korean or English) into a typed
// `actionProposal` object. The proposal is what the operator sees in the
// chat UI; clicking Approve fires the underlying API call. The parser
// itself is PURE — it does no I/O, no audit ledger writes, no PII scans.
// The route layer (`src/routes/chatIntentRoutes.js`) wraps:
//
//     route handler →  PII scan → parseIntent({...}) → ledger.append → respond
//
// Conservative design choices (per plan §2):
//
//   1. Intent set is a CLOSED enumeration. Unknown inputs fall through
//      to `general_task` which routes to /api/pipeline/general-run —
//      the existing pipeline IS the safety container.
//
//   2. NO LLM-based classification. Keyword + regex only. Deterministic,
//      auditable, no hallucination risk.
//
//   3. Long inputs (≥ MIN_FREEFORM_LENGTH chars) AUTOMATICALLY classify
//      as general_task even if they happen to contain a keyword. Long
//      text describes a task; short text issues a command.
//
//   4. Every classification produces a `classifierTrace` string for
//      audit / forensic visibility. The operator can see in the proposal
//      card WHY a particular intent was matched.
//
//   5. PII context is consumed (not produced) — the route pre-scans and
//      passes the result; the parser only branches on it for blocking
//      semantics.

"use strict";

// Inputs shorter than this are treated as commands; longer as task
// descriptions. 30 chars covers "Codex 검증해줘", "최근 기록 보여줘"
// type imperatives without trapping multi-sentence requests.
const MIN_FREEFORM_LENGTH = 30;

// Inputs shorter than this are rejected outright — too short to convey
// intent, almost certainly a typo or accidental Enter. Korean is
// information-dense (1 char ≈ 1 morpheme) so 2 chars covers commands
// like "시작" / "확인" / "go" while still rejecting single keystrokes.
const MIN_INPUT_LENGTH = 2;

// Intent rules — order matters, FIRST MATCH WINS. Each rule has a list
// of matchers; if ANY matcher hits the (lowercased) text, the rule wins.
// More-specific intents listed first so general "시작" doesn't swallow
// "코덱스 검증 시작".
const INTENT_RULES = Object.freeze([
  {
    intent: "codex_verify",
    matchers: [
      /\bcodex\s*(verify|check|연결|확인|검증)/i,
      /codex\s*검증/,
      /코덱스\s*(검증|확인|연결)/,
      /verify\s*codex/i,
    ],
    summary: "Codex CLI 연결을 검증합니다.",
    riskLevel: "low",
    parameters: {},
    alternatives: [],
  },
  {
    intent: "show_status",
    matchers: [
      /(현재|지금)?\s*상태\s*(알려|보여|어떄|어때|어떻|확인)/,
      /어디까지\s*(왔|진행|했)/,
      /진행\s*상황/,
      /\bstatus\b/i,
      /where\s*(am\s*i|are\s*we)/i,
    ],
    summary: "현재 실행 상태와 활성 run을 요약합니다.",
    riskLevel: "low",
    parameters: {},
    alternatives: [],
  },
  {
    intent: "open_history",
    matchers: [
      /(실행|작업|지난)?\s*(기록|히스토리|이력)\s*(보여|열어|보고|확인|가)?/,
      /(과거|이전|지난)\s*(작업|run|실행)/,
      /\b(history|past\s*runs)\b/i,
    ],
    summary: "과거 실행 기록 화면(legacy)으로 이동합니다.",
    riskLevel: "low",
    parameters: {},
    alternatives: [],
  },
  {
    intent: "open_metrics",
    matchers: [
      /(메트릭|통계|분석)\s*(보여|열어|확인)?/,
      /\b(metrics|analytics|stats)\b/i,
    ],
    summary: "메트릭/분석 화면(legacy)으로 이동합니다.",
    riskLevel: "low",
    parameters: {},
    alternatives: [],
  },
  {
    intent: "start_run",
    matchers: [
      // Very narrow on purpose. "—해줘" is too broad and would swallow
      // every general task; we only match when the operator EXPLICITLY
      // says "start" / "run" / "execute" with nothing else (or with a
      // very short subject).
      /^\s*(시작|실행|돌려|런|run|start|execute|go)\s*[!.?]?\s*$/i,
      /^\s*(작업|파이프라인|pipeline)\s*(시작|실행|돌려|run|start)\s*[!.?]?\s*$/i,
    ],
    summary: "기본 파이프라인을 시작합니다 (작업 설명 없이 빈 task).",
    riskLevel: "medium", // higher: empty task, operator must edit before approving
    parameters: { task: "", maxIterations: 3 },
    alternatives: [],
  },
]);

// All intents the parser can produce. Used by route validation + tests
// to assert the contract is exhaustive.
const KNOWN_INTENTS = Object.freeze([
  "codex_verify",
  "show_status",
  "open_history",
  "open_metrics",
  "start_run",
  "general_task",
  "blocked_pii",
  "blocked_input_too_short",
  "blocked_input_too_long",
]);

// Body cap for chat input. Matches the route layer's body limit so the
// parser doesn't accept text the route would have rejected anyway.
const MAX_INPUT_LENGTH = 8000;

// Build a stable, audit-friendly description of which rule matched.
function _trace(reason, detail) {
  if (!detail) return reason;
  return reason + " — " + detail;
}

/**
 * parseIntent — pure classifier.
 *
 * @param {object} opts
 * @param {string} opts.text                    Raw chat input from operator.
 * @param {string} [opts.deploymentMode]        "standard" | "public-sector"
 *                                              | "finance-high-privacy" | other.
 *                                              Public-sector branches block
 *                                              on PII; standard warns + redacts.
 * @param {object} [opts.piiContext]            Result from piiScanner.scanForPii
 *                                              (null when scan was skipped).
 *                                              Shape: { hasPii, findings, redacted }.
 * @returns {object} proposal — see plan §6.2 for the full shape.
 */
function parseIntent(opts) {
  const o = opts || {};
  const rawText = (typeof o.text === "string") ? o.text : "";
  const text = rawText.trim();
  const deploymentMode = (typeof o.deploymentMode === "string")
    ? o.deploymentMode
    : "standard";
  const piiContext = (o.piiContext && typeof o.piiContext === "object")
    ? o.piiContext
    : null;
  const isPublicSector = deploymentMode === "public-sector";

  // ── Length guards ────────────────────────────────────────────
  if (text.length < MIN_INPUT_LENGTH) {
    return {
      intent: "blocked_input_too_short",
      parameters: {},
      summary: "입력이 너무 짧습니다 (최소 " + MIN_INPUT_LENGTH + "자).",
      riskLevel: "low",
      requiresApproval: false,
      alternatives: [],
      piiContext: piiContext,
      confidence: 1.0,
      classifierTrace: _trace("blocked", "length=" + text.length),
    };
  }
  if (text.length > MAX_INPUT_LENGTH) {
    return {
      intent: "blocked_input_too_long",
      parameters: {},
      summary: "입력이 너무 깁니다 (최대 " + MAX_INPUT_LENGTH + "자).",
      riskLevel: "low",
      requiresApproval: false,
      alternatives: [],
      piiContext: piiContext,
      confidence: 1.0,
      classifierTrace: _trace("blocked", "length=" + text.length),
    };
  }

  // ── PII gate (public-sector hard block) ──────────────────────
  // Standard mode does NOT block here — the proposal carries the
  // piiContext through so the UI can render a redacted echo +
  // warning. The frontend then asks the operator to confirm or edit
  // before approval.
  if (isPublicSector && piiContext && piiContext.hasPii) {
    return {
      intent: "blocked_pii",
      parameters: {},
      summary: "공공기관 모드에서는 개인정보가 포함된 입력을 외부 AI로 보낼 수 없습니다.",
      riskLevel: "high",
      requiresApproval: false, // user cannot approve a blocked proposal
      alternatives: [],
      piiContext: piiContext,
      confidence: 1.0,
      classifierTrace: _trace("blocked",
        "pii in public-sector; types=" + (piiContext.findings || []).map((f) => f.type).join(",")),
    };
  }

  // ── Free-form length cutoff ──────────────────────────────────
  // Long text describes a task — go to general_task even if a
  // keyword matches. Short text issues a command — try keyword
  // rules first.
  if (text.length >= MIN_FREEFORM_LENGTH) {
    return _generalTaskProposal(text, piiContext, isPublicSector,
      "length=" + text.length + " (auto-routed to general_task; matchers skipped)");
  }

  // ── Short text: try keyword rules in priority order ──────────
  const lowered = text.toLowerCase();
  for (const rule of INTENT_RULES) {
    for (const matcher of rule.matchers) {
      if (matcher.test(lowered) || matcher.test(text)) {
        return {
          intent: rule.intent,
          parameters: Object.assign({}, rule.parameters),
          summary: rule.summary,
          riskLevel: rule.riskLevel,
          requiresApproval: true,
          alternatives: rule.alternatives.slice(),
          piiContext: piiContext,
          confidence: 1.0,
          classifierTrace: _trace("matched:" + rule.intent,
            "keyword: " + String(matcher)),
        };
      }
    }
  }

  // ── No keyword match → general_task fallback ─────────────────
  return _generalTaskProposal(text, piiContext, isPublicSector,
    "no keyword match (length=" + text.length + ")");
}

// general_task proposal builder — the catch-all path. The pipeline
// itself (and all its safety layers — approval queue, PII scanner
// at hook level, policy gates, audit ledger, sandbox) is the safety
// container. The chat layer just submits.
function _generalTaskProposal(text, piiContext, isPublicSector, traceDetail) {
  // Risk is medium by default for general tasks (full pipeline runs
  // are not trivially low-risk, especially when they may write files
  // via the runner_hook_approval queue). Public-sector + non-blocking
  // PII (warn-mode in standard) bumps to high — the operator sees the
  // pill warning that PII may be redacted but proceeded.
  let riskLevel = "medium";
  if (piiContext && piiContext.hasPii && !isPublicSector) {
    riskLevel = "high";
  }
  return {
    intent: "general_task",
    parameters: {
      task: text,
      maxIterations: 3,
    },
    summary: "이 내용을 일반 파이프라인 작업으로 시작합니다 (Claude 계획 ↔ Codex 비평, 최대 3회 반복).",
    riskLevel: riskLevel,
    requiresApproval: true,
    alternatives: [
      {
        label: "한 번만 (max 1)",
        intent: "general_task",
        parameters: { task: text, maxIterations: 1 },
      },
      {
        label: "최대 5회 반복",
        intent: "general_task",
        parameters: { task: text, maxIterations: 5 },
      },
    ],
    piiContext: piiContext,
    confidence: 0.5, // fallback path always lower confidence than keyword match
    classifierTrace: _trace("fallback:general_task", traceDetail),
  };
}

module.exports = {
  parseIntent,
  KNOWN_INTENTS,
  INTENT_RULES, // exported for tests + audit explorer
  MIN_FREEFORM_LENGTH,
  MIN_INPUT_LENGTH,
  MAX_INPUT_LENGTH,
};
