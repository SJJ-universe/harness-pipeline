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

    // ── UI-P8: legacy view deprecation banner ───────────────────────
    // Banner appears at the top of /?mode=legacy. Dismissible with
    // localStorage persistence. Per UI-P0 §285+286 the legacy view
    // stays available indefinitely as an operator escape hatch — the
    // banner advertises the new shell without forcing migration.
    "legacy.banner.aria":     "새 대시보드 안내",
    "legacy.banner.message":  "🚀 새 대시보드가 준비되었습니다 — 같은 데이터, 새로운 디자인",
    "legacy.banner.cta":      "체험하기 →",
    "legacy.banner.cta.title":"새 product shell 열기",
    "legacy.banner.dismiss":  "이 안내 닫기",
    "legacy.banner.footnote": "이 보기(legacy)는 계속 사용할 수 있습니다",

    // ── UI-FirstRun: 6 first-run state messages + 9 CTA labels ─────
    // "지금 해야 할 일" card. Surfaces the most blocking first-run
    // state with concrete CTAs. Honest framing: "we don't pretend
    // anything works until you've actually verified it."
    "firstRun.cardLabel":                                "지금 해야 할 일",
    "firstRun.aria.region":                              "지금 해야 할 일 카드",
    "firstRun.noProfile.headline":                       "프로필이 아직 없습니다",
    "firstRun.noProfile.body":                           "Claude / Codex와 연결할 첫 프로필을 만들어야 작업을 시작할 수 있습니다.",
    "firstRun.noActiveProfile.headline":                 "활성 프로필을 선택해 주세요",
    "firstRun.noActiveProfile.body":                     "프로필이 등록되어 있지만 어떤 프로필이 활성 상태인지 지정되지 않았습니다.",
    "firstRun.publicSectorIncomplete.headline":          "🛡 공공기관 모드 설정이 끝나지 않았습니다",
    "firstRun.publicSectorIncomplete.body":              "공공기관 / 사내망 정책이 적용되어 있어 추가 동의 + 샌드박스 설정이 필요합니다.",
    "firstRun.providerMissing.headline":                 "Claude 또는 Codex CLI가 설치되어 있지 않습니다",
    "firstRun.providerMissing.body":                     "활성 프로필은 있지만 CLI 도구를 찾을 수 없습니다. 설치를 확인하거나 경로를 다시 잡아 주세요.",
    "firstRun.providerNotAuthenticated.headline":        "Claude / Codex 로그인이 필요합니다",
    "firstRun.providerNotAuthenticated.body":            "CLI는 설치되어 있지만 인증 상태가 확인되지 않습니다. 각 도구에서 로그인해 주세요.",
    "firstRun.ready.headline":                           "사용할 준비가 되었습니다",
    "firstRun.ready.body":                               "활성 프로필이 설정되어 있습니다. 필요하면 연결 상태를 한 번 확인해 보세요.",

    "firstRun.cta.createProfile":                        "개인 프로필 빠른 생성",
    "firstRun.cta.openSetupWizard":                      "설정 마법사로 시작",
    "firstRun.cta.openSettingsProfiles":                 "계정 설정 열기",
    "firstRun.cta.openPublicSectorSetup":                "공공기관 설정 마법사",
    "firstRun.cta.testClaude":                           "Claude 연결 확인",
    "firstRun.cta.testCodex":                            "Codex 연결 확인",
    "firstRun.cta.reopenSetupForProviders":              "설정 마법사 다시 열기",
    "firstRun.cta.authClaude":                           "Claude 로그인",
    "firstRun.cta.authCodex":                            "Codex 로그인",

    // ── Slice RR0-d: friendlier missing/unauth flows + safe-guidance ──
    "firstRun.cta.copyLoginCommandClaude":               "Claude 로그인 명령 복사 (claude auth login)",
    "firstRun.cta.copyLoginCommandCodex":                "Codex 로그인 명령 복사 (codex auth login)",
    "firstRun.cta.recheckProviders":                     "다시 검사",
    "firstRun.safeGuidance.short":                       "Harness는 비밀번호나 OAuth 토큰을 직접 받지 않습니다.",
    "firstRun.safeGuidance.long":                        "로그인은 Claude/Codex 공식 CLI에서 직접 처리합니다. Harness는 (1) 로그인 명령을 클립보드에 복사하거나 (2) 공식 docs 링크를 새 탭에 열어 안내만 합니다. 로그인이 끝나면 위의 \"다시 검사\" 버튼으로 상태를 갱신하세요.",
    "firstRun.docsUrl.claude":                           "https://docs.anthropic.com/en/docs/claude-code/cli-usage",
    "firstRun.docsUrl.codex":                            "https://github.com/openai/codex#authentication",

    "firstRun.meta.profileCount":                        "등록된 프로필: {count}개",
    "firstRun.meta.missing":                             "확인 안된 도구: {runners}",
    "firstRun.meta.unauth":                              "로그인 필요: {runners}",
    "firstRun.meta.untestedHint":                        "연결 상태는 아직 확인되지 않았습니다. 위 버튼으로 한 번 테스트해 보세요.",

    // ── SMART-1: Recommendations card (7 frozen rules) ──────────────
    // 운영자 attention을 우선순위별로 안내. SMART-0 decisionContext의
    // 8 booleans + 5 counts에서 derive되는 추천 카드. 각 추천에는
    // title / body / CTA가 i18n 가능한 키로 정의됨. {count}/{title}
    // placeholder substitution 지원.
    "smart.rec.cardLabel":                                "추천",
    "smart.rec.aria.region":                              "추천 카드",
    "smart.rec.empty":                                    "현재 권장 행동이 없습니다.",
    "smart.rec.dismiss":                                  "닫기",
    "smart.rec.dismiss.aria":                             "추천 닫기: {title}",

    "smart.rec.completeProfileSetup.title":               "프로필 설정이 필요합니다",
    "smart.rec.completeProfileSetup.body":                "활성 프로필이 없어 어떤 작업도 시작할 수 없습니다.",
    "smart.rec.completeProfileSetup.cta":                 "설정 마법사 열기",

    "smart.rec.resolveApprovals.title":                   "승인 요청 {count}개 대기 중",
    "smart.rec.resolveApprovals.body":                    "AI 도구 실행이 운영자 결정을 기다리고 있습니다.",
    "smart.rec.resolveApprovals.cta":                     "승인 카드 보기",

    "smart.rec.requestCodexReview.title":                 "Codex 비평 대기 중인 세션이 있습니다",
    "smart.rec.requestCodexReview.body":                  "Claude 결과를 Codex에게 검토시키면 정확성을 한 번 더 확인할 수 있습니다.",
    "smart.rec.requestCodexReview.cta":                   "리뷰 세션 보기",

    "smart.rec.monitorActiveRuns.title":                  "{count}개 작업이 실행 중입니다",
    "smart.rec.monitorActiveRuns.body":                   "현재 진행 중인 작업의 상태를 확인하세요.",
    "smart.rec.monitorActiveRuns.cta":                    "최근 결과 보기",

    "smart.rec.exportAuditEvidence.title":                "감사 봉투 export 준비됨",
    "smart.rec.exportAuditEvidence.body":                 "감사관에게 제출할 sealed JSON 봉투를 만들 수 있습니다.",
    "smart.rec.exportAuditEvidence.cta":                  "감사 봉투 만들기",

    "smart.rec.publicSectorPiiBlock.title":               "🛡 공공기관 모드: 개인정보 감지로 차단됨",
    "smart.rec.publicSectorPiiBlock.body":                "공공기관 / 사내망 정책에 따라 개인정보가 포함된 입력은 외부 모델 호출이 차단됩니다. 개인정보를 제거하거나 샌드박스로 옮기세요.",
    "smart.rec.publicSectorPiiBlock.cta":                 "보안 정책 확인",

    "smart.rec.publicSectorEvidenceTrail.title":          "🛡 공공기관 감사 evidence 권장",
    "smart.rec.publicSectorEvidenceTrail.body":           "공공기관 절차상 정기적으로 감사 봉투를 export해 보관해 두는 것이 좋습니다.",
    "smart.rec.publicSectorEvidenceTrail.cta":            "감사 봉투 만들기",

    // ── SMART-3: Expert review presets (6 frozen) ───────────────────
    // 운영자가 자유 입력 대신 6가지 전문가 관점 중 하나를 골라 Codex
    // 비평 / Claude hand-back 시 system prompt + severity tag 지침이
    // 함께 전송됨. preset이 적용되면 audit chain entry에도 presetId
    // 가 기록됨.
    "smart.preset.label":                                 "검토 관점",
    "smart.preset.aria":                                  "전문가 검토 관점 선택",
    "smart.preset.loading":                               "(불러오는 중…)",
    "smart.preset.unavailable":                           "(preset 목록 불러오지 못함 — 자유 입력만 사용)",
    "smart.preset.none":                                  "자유 입력 (preset 없음)",

    "smart.preset.accuracy.label":                        "정확성",
    "smart.preset.accuracy.description":                  "논리 정합성, off-by-one, 경계값, 타입 혼동.",
    "smart.preset.security.label":                        "보안",
    "smart.preset.security.description":                  "인증/인가, 인젝션, 비밀값 누출, 공급망 위험.",
    "smart.preset.privacy.label":                         "개인정보",
    "smart.preset.privacy.description":                   "PII (KRN/주민번호/이메일) 노출, 보존 기간, 데이터 최소화.",
    "smart.preset.performance.label":                     "성능",
    "smart.preset.performance.description":               "Hot path, N+1, 메모리 누수, 이벤트 루프 동기 작업.",
    "smart.preset.release.label":                         "배포 준비",
    "smart.preset.release.description":                   "롤아웃 안전, manifest 서명, 하위 호환성, audit chain 커버리지.",
    "smart.preset.public-sector-audit.label":             "🛡 공공기관 감사",
    "smart.preset.public-sector-audit.description":       "공공기관 / 규제 배포 — fail-closed 자세, audit chain 깊이, 서명 무결성.",

    // ── Slice POL-c: policy pack catalog labels ──────────────────────
    // 운영자가 simple-shell의 pack-info card에서 보는 레이블들.
    // Pack ID는 frozen registry의 modeId로 통일 (영문 kebab-case),
    // 화면 표시는 한국어로 친절하게.
    "policyPack.cardLabel":                              "현재 정책 팩",
    "policyPack.aria.region":                            "정책 팩 정보",
    "policyPack.currentLabel":                           "현재 사용 중",
    "policyPack.changeHint":                             "팩 변경은 서버 재시작이 필요합니다 (HARNESS_DEPLOYMENT_PROFILE 환경변수 변경 + 재부팅).",
    "policyPack.publicSectorRequirements.title":         "🛡 공공기관 / 규제 배포 요구사항",
    "policyPack.publicSectorRequirements.intro":         "이 팩을 선택하기 전에 다음을 준비해 두세요:",
    "policyPack.runtimeEffective.label":                 "현재 런타임 적용 상태",
    "policyPack.runtimeEffective.hardGates":             "하드 게이트: {mode}",
    "policyPack.runtimeEffective.runMemory":             "런 메모리: {state}",
    "policyPack.runtimeEffective.envOverride":           "(환경변수 명시)",

    "policyPack.modeId.standard":                        "Standard",
    "policyPack.modeId.public-sector":                   "공공기관 (Public Sector)",
    "policyPack.modeId.finance-high-privacy":            "🛡 금융 / 고강도 프라이버시 (Finance High-Privacy)",
    "policyPack.modeId.offline-internal-network":        "오프라인 / 내부망 (Offline Internal Network)",
    "policyPack.modeId.developer-lab":                   "개발자 랩 (Developer Lab)",

    "policyPack.field.publicSector":                     "공공기관 자세",
    "policyPack.field.allowLocalExecutor":               "로컬 실행기 허용",
    "policyPack.field.allowPlaintextSecrets":            "평문 시크릿 허용",
    "policyPack.field.requireSandboxWorkspace":          "샌드박스 워크스페이스 필수",
    "policyPack.field.requireSignedManifest":            "서명된 manifest 필수",
    "policyPack.field.requirePiiScanBeforeProviderDispatch": "공급자 호출 전 PII 스캔 필수",
    "policyPack.field.scannerFailurePolicy":             "스캐너 실패 정책",
    "policyPack.field.hardGatesDefault":                 "기본 하드 게이트",
    "policyPack.field.runMemoryEnabled":                 "런 메모리 활성",
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = table;
  }
  if (typeof root !== "undefined") {
    root.HARNESS_I18N = root.HARNESS_I18N || {};
    root.HARNESS_I18N.ko = table;
  }
})(typeof window !== "undefined" ? window : globalThis);
