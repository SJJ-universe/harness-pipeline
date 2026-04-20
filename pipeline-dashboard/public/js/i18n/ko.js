// Slice I (v5) — Korean locale table.
//
// Keys are dot.namespaced so related UI surfaces cluster alphabetically.
// New key → add matching English entry in en.js (enforced by
// tests/unit/i18n.coverage.test.js). `{param}` placeholders get replaced
// by HarnessI18n.t("...", { param: "value" }).

(function (root) {
  const table = {
    // ── Header / chrome ─────────────────────────────────────────────
    "header.title": "SJ 하네스 엔진",
    "status.idle": "대기",
    "server.status.title": "서버 상태",
    "server.label.checking": "서버: 확인중",
    "codex.status.title": "Codex CLI 상태",

    // ── Toolbar buttons ─────────────────────────────────────────────
    "btn.codexVerify": "Codex 검증",
    "btn.codexVerify.title": "Codex CLI 실제 호출 테스트",
    "btn.openAnalytics": "📈 메트릭",
    "btn.openAnalytics.title": "Phase별 duration / gate 메트릭 열기",
    "btn.openAnalytics.aria": "Phase 메트릭 드로어 열기 (g m)",
    "btn.openRunHistory": "📜 히스토리",
    "btn.openRunHistory.title": "과거 실행 기록 드로어 열기",
    "btn.openRunHistory.aria": "과거 실행 기록 드로어 열기 (g h)",
    "btn.serverRestart": "재시작",
    "btn.serverRestart.title": "서버 재시작",
    "btn.serverStop": "서버 종료",
    "btn.serverStop.title": "서버 종료",

    // ── Pipeline selector ───────────────────────────────────────────
    "pipeline.selector.title": "템플릿 전환 (클릭)",
    "btn.startGeneral": "▶ 작업 시작",
    "btn.startGeneral.title": "범용 태스크 파이프라인 실행 (Claude 플랜 ↔ Codex 비평 순환)",
    "btn.abortGeneral": "■ 중단",
    "btn.abortGeneral.title": "진행 중인 파이프라인 중단",
    "btn.toggleCompact.title": "컴팩트/상세 보기 전환",
    "btn.openTemplateEditor": "템플릿",
    "btn.openTemplateEditor.title": "커스텀 템플릿 추가/편집/삭제",

    // ── Stats cards ─────────────────────────────────────────────────
    "stat.findings": "발견 사항",
    "stat.context": "컨텍스트",
    "stat.verify": "검증",
    "stat.codexLive": "🤖 Codex 라이브 출력",
    "stat.subagents": "🤝 서브에이전트",
    "stat.toolCalls": "🔧 툴 호출",
    "stat.critiqueTimeline": "💬 Critique 타임라인",
    "btn.clear": "지우기",

    // ── Tabs ────────────────────────────────────────────────────────
    "tab.eventLog": "이벤트 로그",
    "tab.terminal": "터미널",

    // ── General Run modal ───────────────────────────────────────────
    "modal.general.title": "범용 파이프라인 시작 — Claude 플랜 ↔ Codex 비평",
    "modal.general.description":
      "작업을 입력하면 Claude가 계획을 세우고 Codex가 비평하며, critical/high 이슈가 남아 있는 동안 자동으로 계획을 수정하고 다시 비평합니다.",
    "field.taskDescription": "작업 설명",
    "field.taskPlaceholder": "예: Express 서버에 JWT 인증 미들웨어를 추가하고 기존 /admin 라우트를 보호하기",
    "field.maxIterations": "최대 반복 횟수",
    "btn.cancel": "취소",
    "btn.start": "시작",

    // ── Other modals ────────────────────────────────────────────────
    "modal.finalPlan": "최종 플랜",
    "modal.stepDetail": "단계 상세",
    "modal.analytics.title": "📈 Phase 메트릭",
    "modal.runHistory.title": "📜 실행 기록",
    "modal.templateEditor.title": "파이프라인 템플릿 에디터",

    // ── Run history drawer ──────────────────────────────────────────
    "btn.saveCurrentRun": "현재 실행 저장",
    "btn.clearAll": "전체 삭제",
    "run.historyEmpty": "(저장된 기록 없음 — '현재 실행 저장'을 눌러 기록을 남기세요)",

    // ── Template editor ─────────────────────────────────────────────
    "btn.newTemplate": "+ 새 템플릿",
    "btn.delete": "삭제",
    "btn.save": "저장",
    "field.templateJsonLabel": "JSON (schema: src/templates/pipelineTemplate.schema.json)",

    // ── A11y labels ─────────────────────────────────────────────────
    "a11y.skipLink": "본문 바로가기",
    "a11y.close.analytics": "메트릭 드로어 닫기",
    "a11y.close.history": "기록 드로어 닫기",
    "a11y.close.templateEditor": "템플릿 에디터 닫기",

    // ── Language toggle ─────────────────────────────────────────────
    "lang.toggle.title": "언어 전환",
    "lang.ko": "한국어",
    "lang.en": "English",

    // ── Runtime toasts / runtime strings (opt-in by caller) ─────────
    "toast.keybindings": "단축키: g t=템플릿, g h=히스토리, g m=메트릭, Esc=닫기",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = table;
  }
  if (typeof root !== "undefined") {
    root.HARNESS_I18N = root.HARNESS_I18N || {};
    root.HARNESS_I18N.ko = table;
  }
})(typeof window !== "undefined" ? window : globalThis);
