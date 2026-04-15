# Harness Engineering Guide

> AI 에이전트 오케스트레이션의 다음 단계

---

## 1. 하네스 엔지니어링이란?

### 정의

**하네스 엔지니어링(Harness Engineering)**은 여러 AI 에이전트를 하나의 통제된 워크플로우로 엮어, 각 에이전트의 출력이 다음 에이전트의 입력이 되는 **구조화된 파이프라인**을 설계하고 운용하는 엔지니어링 분야다.

단일 AI에게 "이거 해줘"라고 지시하는 것과 근본적으로 다르다.

### 핵심 구성 요소

```
하네스 = 파이프라인 구조 + 에이전트 오케스트레이션 + 피드백 루프 + 품질 게이트
```

| 구성 요소 | 설명 |
|---|---|
| **파이프라인 구조** | 작업의 Phase와 Node를 정의하는 실행 그래프 |
| **에이전트 오케스트레이션** | 어떤 AI가, 어떤 순서로, 어떤 컨텍스트를 받아 실행되는가 |
| **피드백 루프** | AI의 출력을 다른 AI가 비평하고 원래 AI가 보완하는 반복 사이클 |
| **품질 게이트** | Phase 간 진행 여부를 결정하는 조건부 분기 |

---

## 2. 하네스 vs 플러그인/스킬: 무엇이 다른가?

### 스킬(Plugin) 사용

```
사용자 → "코드 리뷰 해줘" → Claude (security-hardening 스킬 활성화) → 결과
```

- 단일 AI, 단일 실행
- 스킬은 **프롬프트 확장** — AI의 역할/맥락을 보강하는 텍스트
- 실행 순서, 반복, 분기 없음
- 결과의 검증은 사용자 몫

### 하네스 엔지니어링

```
사용자 → "코드 리뷰 해줘"
  ↓
[Phase A] Claude 계획 수립 ⟷ Codex 계획 비평 (최대 3회 반복)
  ↓
[Phase B] Claude 코드 분석
  ↓
[Phase C] Orchestrator → Saboteur + Security + Readability (병렬)
           → Synthesizer 결과 종합 → Codex 2차 검토
  ↓
[Phase D] 품질 게이트: BLOCK이면 Debug Phase 진입, CLEAN이면 완료
  ↓
[완료] → 다음 하네스 추천 (테스트? 배포? 리팩토링?)
```

### 핵심 차이 비교

| 관점 | 스킬/플러그인 | 하네스 엔지니어링 |
|---|---|---|
| **실행 단위** | 단일 AI 호출 | 다중 AI 오케스트레이션 |
| **실행 흐름** | 선형, 1회 | 비선형, 반복/분기 가능 |
| **컨텍스트** | 대화 컨텍스트 내 | 에이전트 간 구조화된 상태 전달 |
| **품질 보장** | 사용자가 판단 | 자동 검증 게이트 |
| **확장성** | 스킬 추가 = 프롬프트 추가 | 하네스 추가 = 워크플로우 추가 |
| **AI 다양성** | 단일 모델 | 복수 모델(Claude + Codex) 협업 |
| **상태 관리** | 없음 | Phase 간 상태 추적 |
| **실패 처리** | 없음 | 에러 핸들링, 재시도, 대체 경로 |

### 비유

- **스킬** = 공구 하나 (드라이버, 망치)
- **하네스** = 조립 라인 (공정 순서, 품질 검사, 피드백 루프, 다음 공정 추천)

스킬이 아무리 좋아도, 어떤 순서로 조합하고, 결과를 어떻게 검증하고, 실패 시 어디로 분기하는지를 결정하는 것은 하네스의 영역이다.

---

## 3. 이 대시보드의 하네스 아키텍처

### 시스템 구성도

```
┌─────────────────────────────────────────────────────────┐
│                    Dashboard (port 4200)                 │
│                                                         │
│  ┌──────────────────┐     ┌──────────────────────────┐  │
│  │  Pipeline View   │     │      Stats Panel          │  │
│  │  (동적 렌더링)    │     │  Claude: Max(5x) 36%     │  │
│  │                  │     │  Codex:  Plus     1%      │  │
│  │  Phase A ──→     │     │  Findings: 0/0/0          │  │
│  │  Phase B ──→     │     ├──────────────────────────┤  │
│  │  Phase C ──→     │     │  Terminal (xterm.js)      │  │
│  │  Phase D ──→     │     │  └─ claude CLI 자동 실행   │  │
│  │                  │     │                           │  │
│  │  [추천 카드]      │     │  Event Log (실시간)       │  │
│  └──────────────────┘     └──────────────────────────┘  │
│                                                         │
│  ┌─────────────────── server.js ──────────────────────┐  │
│  │                                                     │ │
│  │  SessionWatcher ──→ JSONL 감시 ──→ 작업 자동 감지   │ │
│  │  TokenTracker   ──→ 실사용량 파싱                    │ │
│  │  SkillRegistry  ──→ 73개 스킬 인덱스                 │ │
│  │  HarnessRecommender ──→ 다음 하네스 추천             │ │
│  │  PipelineTemplates ──→ 3개 파이프라인 템플릿          │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  데이터 소스:                                            │
│  ~/.claude/projects/*/  ← Claude 세션 JSONL             │
│  ~/.claude/.credentials.json ← 구독 플랜 정보           │
│  ~/.codex/sessions/*/   ← Codex 세션 JSONL + rate_limits│
│  ~/.codex/auth.json     ← Codex 구독 플랜 (JWT)        │
│  ~/.claude/skills/*/    ← 커뮤니티 스킬 73개            │
└─────────────────────────────────────────────────────────┘
```

### 자동 연동 흐름

```
1. 터미널에서 Claude에게 작업 지시
   └─ "이 API에 테스트를 작성해줘"

2. SessionWatcher가 JSONL에서 메시지를 감지
   └─ 패턴 매칭: "테스트" → testing 하네스

3. auto_pipeline_detect 이벤트 발행
   └─ 대시보드가 testing 파이프라인으로 자동 전환

4. Claude가 도구를 사용할 때마다 Phase 자동 진행
   └─ Read/Grep → Phase A (분석)
   └─ Edit/Write → Phase D (테스트 작성)
   └─ Bash(test) → Phase E (실행)

5. 60초 idle → 파이프라인 자동 완료
   └─ 다음 하네스 추천 카드 표시: "디버깅? 배포?"
```

### 하네스 체이닝

```
code-review 완료
    ├──→ debugging (발견된 버그 수정)
    ├──→ refactoring (코드 품질 개선)
    └──→ testing (테스트 보강)

testing 완료
    ├──→ debugging (실패 테스트 수정)
    └──→ deployment (테스트 통과 시)

implementation 완료
    ├──→ code-review (코드 검토)
    └──→ testing (테스트 작성)
```

이것이 단순한 "다음에 뭐 할까?"가 아닌 이유:
- 각 하네스는 자신만의 **파이프라인 구조**를 가짐
- 완료된 하네스의 **결과(findings, verdict)**가 다음 하네스의 **컨텍스트**로 전달됨
- 프로젝트 상태(기술 스택, 테스트 프레임워크 유무 등)에 따라 추천 우선순위가 달라짐

---

## 4. Dual AI 협업의 의미

### 왜 Claude + Codex인가?

단일 AI의 한계: **자기 작업을 자기가 검증하면 편향이 생긴다.**

```
Claude가 계획 수립  →  Codex가 비평  →  Claude가 보완
     (생성자)           (비평자)          (개선자)
```

이것은 소프트웨어 공학의 **코드 리뷰**와 동일한 원리다:
- 작성자 혼자 검토하면 blind spot이 남는다
- 다른 시각(다른 모델)이 보면 새로운 문제를 발견한다
- 반복하면 품질이 수렴한다

### 현재 구현의 Dual AI 포인트

| 위치 | Claude 역할 | Codex 역할 |
|---|---|---|
| Phase A (계획) | 리뷰 계획 수립 | 계획 비평 및 보완 제안 |
| Phase C (리뷰) | 3개 페르소나 리뷰 실행 | 독립적 2차 검토 (추가 발견) |
| Phase B↔C (범용) | 작업 계획 수립 | 계획 비평 (최대 3회 사이클) |

### 구독 사용량 모니터링

```
Claude  [Max 5x]  세션: ████████████░░░░░░░ 36%   주간: █░░░░░░░░░ 2%
Codex   [Plus]    세션: ░░░░░░░░░░░░░░░░░░ 1%    주간: ░░░░░░░░░░ 0%
```

- Claude: `~/.claude/projects/` 세션 JSONL에서 토큰 파싱 + `.credentials.json`에서 플랜 확인
- Codex: `~/.codex/sessions/` JSONL의 `token_count` 이벤트에서 **실제 rate_limits** (`used_percent`) 직접 읽음
- 5초마다 폴링하여 실시간 반영

이것으로 두 AI의 자원 소모를 동시에 추적하며, 한쪽이 rate limit에 가까워지면 다른 쪽에 작업을 재분배하는 전략적 판단이 가능해진다.

---

## 5. 현재 구현의 수준 평가

### 달성한 것 (Phase 1)

| 항목 | 상태 | 설명 |
|---|---|---|
| 동적 파이프라인 렌더링 | **완료** | 3개 템플릿, JSON 기반 구조 |
| 실시간 사용량 추적 | **완료** | Claude/Codex 실제 계정 데이터 |
| 세션 자동 감지 | **완료** | JSONL 감시 → 작업 유형 판별 → 템플릿 자동 로드 |
| Phase 자동 진행 | **완료** | 도구 사용 패턴 기반 Phase 전환 |
| 하네스 체이닝 | **완료** | 완료 후 다음 하네스 추천 |
| 스킬 레지스트리 | **완료** | 73개 스킬 인덱스, 하네스별 매핑 |
| 내장 터미널 | **완료** | xterm.js + node-pty, claude CLI 자동 실행 |

---

## 6. 진정한 하네스 엔지니어링까지의 거리

현재 시스템은 **관찰 기반(Observational)** 하네스다. Claude가 실행하는 것을 옆에서 관찰하며 대시보드를 업데이트한다. 진정한 하네스는 **지시 기반(Directive)** — 하네스가 AI에게 지시하고 결과를 검증한다.

### 6.1 핵심 격차

#### Gap 1: 관찰(Passive) vs 지시(Active) 오케스트레이션

```
현재:   Claude가 일한다 → Watcher가 관찰한다 → 대시보드가 보여준다
목표:   하네스가 지시한다 → Claude가 실행한다 → 하네스가 검증한다 → 다음 Phase 결정
```

**현재**: SessionWatcher가 JSONL을 읽어 Phase를 *추측*한다.
**목표**: 하네스가 Phase를 *명시적으로 제어*하고, 각 Phase에서 어떤 AI에게 무엇을 지시할지 결정한다.

**해결 방향**: Claude Code Hooks (`PreToolUse`, `PostToolUse`, `Stop`) 활용
```json
// .claude/settings.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "node pipeline-dashboard/hooks/on-tool-use.js"
      }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "node pipeline-dashboard/hooks/on-turn-end.js"
      }]
    }]
  }
}
```

Hook이 정확한 도구 사용 정보를 stdin으로 받아 대시보드에 전달하면, JSONL 파싱의 2초 지연 없이 **즉시** Phase를 업데이트할 수 있다.

#### Gap 2: 실제 Codex 자동 호출 없음

```
현재:   Claude가 리뷰 → (Codex 자리만 있음) → 끝
목표:   Claude가 리뷰 → 하네스가 Codex를 자동 호출 → 결과 비교 → 종합
```

**현재**: Codex는 데모 파이프라인(`runPipeline`)에서만 `execSync`로 호출됨. 자동 감지 파이프라인에서는 Codex가 실행되지 않음.

**해결 방향**: Phase C에서 `codex exec` 자동 실행
```javascript
// Phase C 진입 시 자동으로 Codex에게 비평 요청
async function executeCodexCritique(plan) {
  const result = await exec(`codex exec --full-auto "${plan}"`);
  broadcast({ type: "node_update", data: { node: "plan-critic", status: "completed" } });
  return parseCritique(result);
}
```

#### Gap 3: 품질 게이트 없음

```
현재:   Phase A → Phase B → Phase C → Phase D (무조건 순차 진행)
목표:   Phase A → [게이트: 계획 충분한가?] → Phase B 또는 Phase A 재실행
```

**현재**: Phase 진행이 도구 사용 순서에 의해 결정되며, "이 Phase의 결과가 충분한가?"를 판단하지 않음.

**해결 방향**: 각 Phase에 exit criteria 정의
```json
{
  "phase": "A",
  "exitCriteria": {
    "type": "llm_judge",
    "prompt": "이 계획이 실행 가능한 수준인가? YES/NO로 답하라.",
    "passCondition": "YES",
    "maxRetries": 3
  }
}
```

#### Gap 4: 에이전트 간 상태 전달 없음

```
현재:   Phase A 완료 → Phase B 시작 (Phase A의 결과를 Phase B가 알 수 없음)
목표:   Phase A 완료 → 결과 객체 생성 → Phase B에 주입
```

**현재**: 각 Phase는 독립적으로 실행됨. 리뷰 결과가 디버그 Phase에 전달되지 않음.

**해결 방향**: Pipeline State Object
```javascript
const pipelineState = {
  phaseA: { plan: "...", context: { files: [...], techStack: {...} } },
  phaseB: { findings: [...], verdict: "BLOCK" },
  phaseC: { critiques: [...], refinedPlan: "..." },
};

// 각 Phase 시작 시 이전 Phase의 state를 에이전트에게 전달
function buildPhasePrompt(phase, state) {
  return `이전 단계 결과:\n${JSON.stringify(state[prevPhase])}\n\n현재 작업: ...`;
}
```

#### Gap 5: 스킬 자동 활성화 없음

```
현재:   testing 하네스 → (스킬 목록만 보여줌)
목표:   testing 하네스 → tdd-mastery + testing-strategies 자동 로드 → 에이전트 프롬프트에 주입
```

**현재**: `skill-categories.json`에 하네스↔스킬 매핑이 있지만, 실제로 스킬을 에이전트 프롬프트에 주입하지 않음.

**해결 방향**: Phase 시작 시 관련 스킬 내용을 프롬프트에 포함
```javascript
const skills = getSkillsForHarness("testing");
const skillContext = skills.map(s => getSkillContent(s.id)).join("\n---\n");
const prompt = `${skillContext}\n\n작업: ${userRequest}`;
```

---

### 6.2 성숙도 모델

```
Level 0: Manual          사용자가 직접 AI를 하나씩 호출
Level 1: Skill-Enhanced  스킬이 프롬프트를 보강 (현재 Claude Code 기본)
Level 2: Observable      파이프라인을 관찰하고 시각화 ← 현재 수준
Level 3: Directive       하네스가 AI를 직접 호출하고 결과를 검증
Level 4: Adaptive        실행 결과에 따라 파이프라인이 동적으로 변형
Level 5: Self-Improving  하네스가 자신의 성능을 측정하고 구조를 개선
```

**현재 이 도구는 Level 2에 있다.** 파이프라인의 시각화, 사용량 추적, 자동 감지는 구현했지만, 하네스가 AI를 직접 제어하지는 않는다.

---

## 7. Level 3 달성을 위한 로드맵

### Phase 1: Hook 기반 정밀 추적 (현재 → Level 2.5)

```
목표: JSONL 폴링 → Hook 기반 즉시 이벤트로 전환
난이도: 낮음
효과: Phase 감지 정확도 ↑, 지연 2초 → 0초
```

- `.claude/settings.json`에 `PostToolUse`/`Stop` hook 등록
- hook handler가 도구 정보를 파싱하여 `POST /api/event`로 전달
- SessionWatcher와 병행 운용 (fallback)

### Phase 2: Codex 자동 실행 (Level 2.5 → Level 3)

```
목표: 지정된 Phase에서 Codex를 자동 호출
난이도: 중간
효과: 진정한 Dual AI 협업 실현
```

- `pipeline-executor.js` 모듈 신설
- Phase C 진입 시 `codex exec`를 자동 실행
- 결과를 파싱하여 findings에 추가
- B↔C 사이클의 실제 반복 구현

### Phase 3: 상태 전달 + 품질 게이트 (Level 3 완성)

```
목표: Phase 간 결과 전달, 조건부 분기
난이도: 중간~높음
효과: 품질 보장, 자율적 워크플로우
```

- `PipelineState` 클래스 구현
- Phase 시작 시 이전 결과를 에이전트 프롬프트에 주입
- exit criteria 평가 후 통과/재시도/분기 결정
- 스킬 자동 로드 및 프롬프트 주입

### Phase 4: Adaptive Pipeline (Level 3 → Level 4)

```
목표: 실행 중 파이프라인 구조 동적 변경
난이도: 높음
효과: 상황에 맞는 최적 워크플로우 자동 생성
```

- 런타임 중 Phase 추가/제거/순서 변경
- findings 심각도에 따른 분기 (심각 → debug, 경미 → skip)
- 이전 실행 기록 기반 파이프라인 최적화

---

## 8. 결론: 이 도구를 사용하는 의미

### 지금 이 도구가 제공하는 가치

1. **가시성(Visibility)**: AI가 무엇을 하고 있는지, 어떤 Phase에 있는지, 자원을 얼마나 쓰고 있는지를 실시간으로 본다. 이것만으로도 AI 협업의 품질이 달라진다.

2. **구조화(Structure)**: "그냥 해줘"에서 "이 파이프라인의 이 Phase를 실행해줘"로 사고가 바뀐다. 작업에 구조를 부여하면 누락이 줄고 품질이 오른다.

3. **연속성(Continuity)**: 하네스 추천으로 "다음에 뭘 해야 하지?"를 AI가 제안한다. 계획 → 구현 → 리뷰 → 테스트 → 배포의 흐름이 자연스럽게 이어진다.

4. **자원 인식(Resource Awareness)**: 두 AI 구독의 사용량을 동시에 추적한다. rate limit에 빠지기 전에 작업 분배를 조정할 수 있다.

### 아직 도달하지 못한 것

이 도구는 아직 **하네스가 AI를 직접 제어하는** 단계에 이르지 못했다. 현재는 관찰자(Observer)이지 지휘자(Conductor)가 아니다.

그러나 이것이 의미 없는 것은 아니다. 오케스트라의 지휘자가 연주하기 전에 먼저 하는 일은 **악보를 읽고, 악기의 상태를 확인하고, 연주자의 역량을 파악하는 것**이다. 이 도구는 바로 그 단계 — 지휘를 위한 관찰과 구조화 — 를 수행하고 있다.

Level 2에서 Level 3으로의 도약은 기술적으로 명확하다:
- Hook 기반 정밀 추적
- Codex 자동 실행
- Phase 간 상태 전달
- 품질 게이트

이 네 가지가 구현되면, 사용자는 터미널에서 "이 프로젝트를 리팩토링해줘"라고 한 마디만 하면 된다. 하네스가 알아서 컨텍스트를 수집하고, 계획을 세우고, Codex에게 비평을 받고, 실행하고, 검증한다. 사용자는 대시보드에서 진행 상황을 지켜보며 필요할 때만 개입하면 된다.

그것이 하네스 엔지니어링의 최종 목표다.
