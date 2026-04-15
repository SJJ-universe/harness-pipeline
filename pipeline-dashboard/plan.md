# Plan: Step 0 검증 세션 + Phase 3 (P0) 하네스 튜닝

작성일: 2026-04-15
작성자: Claude (하네스 OFF 상태, Codex 트리거 "계획 검증" 비평 메타 교훈 반영)
대상 리포: `SJJ-universe/harness-pipeline@master` (HEAD=1641f6f)

---

## 목표

1. **Step 0**: 최근 푸시한 7개 커밋(FIX-1~3 ~ Codex 트리거 UI)이 런타임에서 정상 동작하는지 종단 검증
2. **Phase 3 P0**: 검증이 통과하면 `harness-tuning-todo.md`의 Day 1~2 작업(T1 모델 라우팅 + T3 skill description + T2 컨텍스트 알람 + T9 hook 게이트)을 순차 진행

검증이 실패하면 Phase 3는 보류하고 실패 원인부터 디버깅한다. 실패 지점을 정확히 기록해야 롤백 가능.

---

## 범위

### Step 0 대상
- `pipeline-templates.json` Phase A 튜닝 적용 여부 (Bash 허용, count=2)
- `executor/codex-runner.js` stdin prompt 전달 (FIX-3)
- `executor/pipeline-executor.js` `_persistCritique` (FIX-1)
- `hooks/harness-hook.js` Stop 훅 180s + pendingHint (FIX-2)
- `public/app.js` auto-resume (`claude --continue`) + paste 단일 입력 + Codex 트리거 카드 4종

### Phase 3 P0 대상 (Step 0 통과 후에만)
- `.claude/agents/*.md` 9개 frontmatter `model:` 필드 (T1)
- `.claude/skills/universal-task-pipeline/SKILL.md`, `code-review-pipeline/SKILL.md` description 재작성 (T3)
- `pipeline-dashboard/hooks/harness-hook.js` + `server.js` context_usage 40% 알람 (T2)
- `pipeline-dashboard/executor/pipeline-executor.js` `_isDangerousCommand()` (T9)

---

## 사전 상태 확인 (Baseline Verify)

**새로 반영된 코드가 실제 런타임에 실려 있는지 먼저 증명**한다. (Codex 교훈: git rev-parse + 응답 문자열 확인)

| 체크 | 명령/동작 | 기대 결과 (pass 조건) |
|---|---|---|
| B1 | 브라우저에서 `http://127.0.0.1:4200/api/codex/triggers` 직접 호출 | JSON 배열 4개 (plan-verify, code-review, debug-analysis, security-review) 반환 |
| B2 | 터미널 탭 하단 "Codex 트리거" 패널 존재 | 색상 다른 카드 4개 보임 (계획 검증/코드 리뷰/디버그 분석/보안 검토) |
| B3 | `git -C C:/Users/SJ/workspace rev-parse HEAD` | `1641f6f…` (Codex 트리거 커밋) |
| B4 | Ctrl+V 다행 텍스트 붙여넣기 | 한 번만 입력됨 |

B1~B4가 모두 pass해야 Step 0 검증 세션을 의미 있게 돌릴 수 있음. 하나라도 실패하면 그 지점을 먼저 수정.

---

## Step 0 검증 세션 (7가지)

**사용자가 하네스 ON** → 이 대화에서 다음 테스트 프롬프트 실행:

> "파이썬으로 문자열을 역순으로 뒤집는 간단한 유틸리티 함수를 만들어줘"

하네스가 이 프롬프트를 `implementation` 태스크로 감지 → `default` 템플릿 → Phase A 진입.

| # | 확인 항목 | 통과 조건 (구체적 관측 대상) |
|---|---|---|
| S1 | Phase A가 Edit/Write 차단 | Edit 호출 시 `tool_blocked` broadcast + 에러 메시지 "Phase A 단계에서는 다음 도구만 허용됩니다" |
| S2 | Phase A가 Bash 허용 (새 튜닝) | `git log` 또는 `ls` 같은 Bash 실행이 차단 없이 카운트됨 |
| S3 | Phase A → B 전환 | `phaseToolCount("A") >= 2` 달성 후 Stop → Phase B로 phaseIdx 증가, broadcast `phase_enter` |
| S4 | Phase B에서 plan.md Write 허용 | `plan*.md` 작성 → artifact 캡처 → broadcast `artifact_captured` |
| S5 | Phase C Codex 호출 | broadcast `codex_started` → ~29s 후 `codex_critique_ready` |
| S6 | `_workspace/C_codex_critique_iter1.md` 실제 생성 | 파일 존재 + Summary 섹션 + Findings 섹션 포함 |
| S7 | Phase D → E → F 정상 전환 + verdict PASS | 최종 verdict `CLEAN` 또는 `CONCERNS`, `_complete` broadcast |

**한 가지라도 실패 시**: 그 Phase ID + 실패한 구체적 신호 기록 → `_workspace/step0-failure-{phase}.md`로 덤프 → Phase 3 작업 전면 보류 → 원인 파악 후 재시도.

---

## Phase 3 P0 작업 (Step 0 전부 통과 시)

### T1. 에이전트 모델 라우팅 (가장 먼저, ROI 최고)

**작업**: `.claude/agents/*.md` 9개 frontmatter에 `model:` 필드 추가.

| 에이전트 | 추가할 라인 | 근거 |
|---|---|---|
| context-analyzer.md | `model: haiku` | 파일 디스커버리는 결정론적 |
| task-validator.md | `model: haiku` | 테스트 결과 파싱 |
| readability-reviewer.md | `model: haiku` | 패턴 기반 체크 |
| task-planner.md | `model: sonnet` | 중간 난이도 추론 |
| review-synthesizer.md | `model: sonnet` | 병합 |
| saboteur-reviewer.md | `model: sonnet` | 창의적 공격 시나리오 |
| security-auditor.md | `model: sonnet` | OWASP 패턴 + 추론 |
| review-orchestrator.md | `model: opus` | 최종 조율 |
| plan-critic.md | (변경 없음 — Codex CLI) | 이미 독립 AI |

**Verification** (Codex 교훈 적용):
- V-T1-1: `grep -l "^model:" .claude/agents/*.md | wc -l` → `8` (plan-critic 제외)
- V-T1-2: 각 파일 첫 20줄 출력으로 frontmatter 포맷 확인 (앞·뒤 `---` 유지)
- V-T1-3: Agent 도구를 `subagent_type: "context-analyzer"`로 호출 시 모델이 실제로 haiku인지 — 이 세션에서 확인 불가능하면 "런타임 확인 TODO" 플래그 남김

**커밋**: `feat(T1): model routing for 8 agents (haiku/sonnet/opus)`

---

### T3. Skill description 재작성 (T1 다음, 파일 2개)

**작업**: 2개 SKILL.md의 frontmatter description을 다음 요소 포함하도록 재작성:
1. 구체적 트리거 상황 ("사용자가 X, Y, Z를 언급하면")
2. 후속 작업 키워드 ("다시 실행", "재실행", "부분 재실행", "이전 결과 개선", "보완", "업데이트")
3. Pushy 톤 ("~하면 반드시 이 스킬을 사용할 것")
4. 유사 스킬과의 구분 (universal-task-pipeline vs code-review-pipeline)

**대상**:
- `.claude/skills/universal-task-pipeline/SKILL.md`
- `.claude/skills/code-review-pipeline/SKILL.md`

**Verification**:
- V-T3-1: 각 description 길이가 100자 이상
- V-T3-2: "반드시", "재실행", "보완" 키워드 3개 모두 포함
- V-T3-3: 두 description이 서로 구분되는 차별점(범용 vs 리뷰 전용) 명시

**커밋**: `feat(T3): pushy skill descriptions with follow-up keywords`

---

### T2. 컨텍스트 40% 알람 + 자동 압축 트리거

**작업**:
1. `hooks/harness-hook.js` PostToolUse payload에서 `context_usage` 필드 파싱 (Claude Code가 훅에 넘기는 token 정보)
2. `server.js` `/api/hook`에 `context_usage` 수신 후 state에 저장
3. 40% 초과 시 broadcast `context_alarm`
4. `public/app.js`에 경보 UI (기존 어딘가 토큰 게이지가 있다면 색상 변경, 없으면 상단 배너 1개 추가)
5. Phase `onStop`에서 45% 초과면 `decision: block` + "`/compact` 권고" 메시지

**Verification**:
- V-T2-1: 인위적 payload(`context_usage: 0.42`)로 /api/hook POST → 서버 로그에 `context_alarm` broadcast 찍힘
- V-T2-2: 브라우저에서 경보 UI 육안 확인
- V-T2-3: `context_usage: 0.46` + Stop 이벤트 → 응답 JSON이 `decision: "block"` 포함

**커밋**: `feat(T2): context usage alarm at 40% + compact nudge at 45%`

---

### T9. Hook 결정론 게이트 (deterministic danger filter)

**작업**: `pipeline-executor.js`의 `onPreTool`에 `_isDangerousCommand(tool, input)` 체크 추가. 위험 패턴은 모듈화:

```js
const DANGER_PATTERNS = [
  /rm\s+-rf/,
  /del\s+\/s\s+\/q/i,
  /git\s+push\s+--force/,
  /git\s+reset\s+--hard/,
  /\.claude[\\/]/,
  /\.env\b/,
  /credentials\.json/,
  /[^\w]secret[^\w]/i,
];
```

차단 시 `decision: block` + 이유 반환. 차단 사건을 state에 기록해 `dangers_blocked` broadcast.

**Verification**:
- V-T9-1: 단위 테스트 — `executor/__phase-t9-test.js` 신규. 각 패턴 입력 시 block 반환 확인
- V-T9-2: 실제 세션에서 `git reset --hard` 시도 → 차단 이벤트 + 에러 메시지 확인
- V-T9-3: false-positive 확인 — `git reset HEAD~1` (위험 아님) 통과

**커밋**: `feat(T9): deterministic danger pattern gate in onPreTool`

---

## 각 T 태스크 공통 규칙 (Codex 교훈 반영)

1. **Atomic commits**: 한 태스크 = 한 커밋 + 한 push. 실패 시 롤백 경계 명확
2. **Pre-commit verification**: 각 V-Tx-n 체크 실행 후 결과를 커밋 메시지에 "Verified: …" 줄로 기록
3. **Baseline 참조**: 각 태스크 시작 전 `git rev-parse HEAD` 기록 → 변경 범위 명확히
4. **Runtime impact**: 변경이 require 캐시 대상이면 커밋 메시지에 "requires dashboard restart" 명시
5. **리포 커밋 규칙**: `SJJ-universe/harness-pipeline@master`에 직접 push (`workspace/` 루트가 리포 루트)

---

## 변경 파일 (예상)

| 파일 | 태스크 | 변경 성격 |
|---|---|---|
| `pipeline-dashboard/plan.md` | (이 문서) | 교체 작성 |
| `.claude/agents/context-analyzer.md` ~ `review-orchestrator.md` | T1 | frontmatter 1줄 추가 × 8 |
| `.claude/skills/universal-task-pipeline/SKILL.md` | T3 | description 재작성 |
| `.claude/skills/code-review-pipeline/SKILL.md` | T3 | description 재작성 |
| `pipeline-dashboard/hooks/harness-hook.js` | T2 | context_usage 파싱 |
| `pipeline-dashboard/server.js` | T2 | /api/hook 확장 + broadcast |
| `pipeline-dashboard/public/app.js` | T2 | 경보 UI |
| `pipeline-dashboard/executor/pipeline-executor.js` | T9 | `_isDangerousCommand` |
| `pipeline-dashboard/executor/__phase-t9-test.js` | T9 | 단위 테스트 신규 |

---

## 리스크 및 롤백

| 리스크 | 감지 | 롤백 |
|---|---|---|
| Step 0에서 Phase C가 이전처럼 터짐 (FIX-3 미반영 의심) | `_workspace/C_codex_critique_iter1.md` 미생성 + `tool_blocked`/에러 broadcast | `git log server.js` → stdin 전달 코드 확인, 필요 시 서버 프로세스 실제 로드 버전 디버깅 |
| T1 적용 후 Agent 호출이 모델 오류로 실패 | 콘솔 에러 "model not recognized" | `git revert <T1-commit>` |
| T2 context_usage 파싱 중 Claude Code가 보내는 필드명 불일치 | 알람 이벤트가 안 뜸 | 실제 훅 payload 덤프 → 올바른 필드 확인 |
| T9 정규식 false-positive로 정상 작업 차단 | 일상 bash 명령(`ls`, `git status`)이 block됨 | 패턴 수정 또는 `git revert` |

---

## 실행 타임라인

```
[즉시] Baseline Verify B1~B4
[사용자 하네스 ON] Step 0 검증 세션 S1~S7
[S1~S7 pass] → T1 → V-T1 → commit/push
              → T3 → V-T3 → commit/push
              → T2 → V-T2 → commit/push
              → T9 → V-T9 → commit/push
[최종] Step 0 동일 프롬프트 재실행 → 회귀 없음 확인
```

---

## 다음 섹션(참고)

Phase 3 P0 완료 후 Phase 4 P1 (T4 `_workspace/` JSON 스키마, T5 baseline verify, T6 tool allowlist) → Phase 5 P2/P3 (T7 중복 감사, T8 수렴 기준, T10 strip complexity) → Phase 6 성과 측정. 이 플랜 범위 밖.
