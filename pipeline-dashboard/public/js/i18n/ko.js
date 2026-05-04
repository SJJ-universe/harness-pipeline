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

    // ── Product shell (UI-P7): mode toggle, status pill, indicators ─
    // Mode toggle is bilingual by design — Korean primary stays Korean
    // in EN locale too; English subscript stays English in KO locale.
    // The two-language ribbon is a fixed reference design element.
    "prod.mode.simple":      "일반사용자",
    "prod.mode.simple.eng":  "Simple",
    "prod.mode.pro":         "전문사용자",
    "prod.mode.pro.eng":     "Pro",
    "prod.status.idle":      "대기 중",
    "prod.status.running":   "실행 중",
    "prod.status.error":     "중단됨",
    "prod.indicator.server.online":   "서버 ONLINE",
    "prod.indicator.server.offline":  "서버 OFFLINE",
    "prod.indicator.server.checking": "서버 확인 중",
    "prod.indicator.codex.ready":         "Codex READY",
    "prod.indicator.codex.authNeeded":    "Codex 인증 필요",
    "prod.indicator.codex.notInstalled":  "Codex 미설치",
    "prod.aria.header":             "SJ Harness 헤더 (상태 · 모드 · 액션)",
    "prod.aria.statusPill":         "실행 상태",
    "prod.aria.modeToggle":         "사용자 모드 전환",
    "prod.aria.localeToggle":       "언어 선택",
    "prod.aria.serverIndicator":    "서버 상태",
    "prod.aria.codexIndicator":     "Codex 상태",
    "prod.aria.dualTerminals":      "듀얼 터미널 (Claude / Codex 스트림)",
    "prod.aria.actionRow":          "Review relay 액션",

    // ── Product shell (UI-P7): dual-terminals action row ────────────
    "prod.terminals.session.none":         "🔗 세션 없음",
    "prod.terminals.posture.publicSector": "🛡 공공기관 모드 — 로컬 Claude 실행 차단",
    "prod.terminals.action.start":         "+ 세션 시작",
    "prod.terminals.action.start.title":   "새 review session 시작",
    "prod.terminals.action.sendCodex":          "→ Codex 비평 요청",
    "prod.terminals.action.sendCodex.title":    "Claude 작업물을 Codex에 비평 요청",
    "prod.terminals.action.followUpCodex":      "? Codex에 추가 질문",
    "prod.terminals.action.followUpCodex.title": "Codex에게 추가 질문",
    "prod.terminals.action.handBack":           "→ Claude에게 반영 요청",
    "prod.terminals.action.handBack.title":     "Codex 비평을 Claude로 hand-back",
    "prod.terminals.action.archive":            "⏏ 세션 보관",
    "prod.terminals.action.archive.title":      "현재 세션을 archive로 이동",
    "prod.terminals.state.created":           "준비됨",
    "prod.terminals.state.awaiting_critique": "Codex 비평 대기",
    "prod.terminals.state.critique_received": "비평 도착",
    "prod.terminals.state.awaiting_claude":   "Claude 반영 대기",
    "prod.terminals.state.claude_received":   "Claude 반영 완료",
    "prod.terminals.state.archived":          "보관됨",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = table;
  }
  if (typeof root !== "undefined") {
    root.HARNESS_I18N = root.HARNESS_I18N || {};
    root.HARNESS_I18N.ko = table;
  }
})(typeof window !== "undefined" ? window : globalThis);
