# Pipeline Dashboard — 하네스 엔지니어링 가이드

> Claude Code + Codex CLI를 위한 **Directive-mode Harness** 프레임워크 및 실시간 시각화 대시보드

---

## 1. 하네스 엔지니어링이란 무엇인가

### 1.1. 정의

**하네스(Harness)** 는 원래 "말의 멍에 + 고삐"를 뜻합니다. 말이 아무 방향으로나 달리지 않도록 길을 지시하고, 필요할 때 멈추게 하며, 특정 과업에 집중시키는 장치죠. 소프트웨어 용어로 옮기면:

> **하네스 엔지니어링이란, LLM 에이전트가 자유롭게 생성하는 출력의 "가능한 경로(state space)"를, 외부 제어 루프·검증 단계·규칙 엔진으로 좁혀 목표 달성에 수렴시키는 설계 기법이다.**

전통적인 **프롬프트 엔지니어링**이 "모델에게 무엇을 어떻게 말할 것인가"를 다룬다면, 하네스 엔지니어링은 한 단계 위에서 "모델이 무엇을 할 수 있게/없게 할 것인가, 언제 멈추고 언제 다음 단계로 넘어갈 것인가, 어떤 외부 검증을 통과해야 하는가"를 다룹니다.

### 1.2. 왜 필요한가 — LLM 에이전트의 근본 문제

LLM 에이전트(Claude Code, Cursor, Aider 등)는 다음과 같은 실패 모드를 공유합니다:

| 실패 모드 | 증상 |
|---|---|
| **컨텍스트 부족 실행** | 파일 3개만 읽고 전체 아키텍처를 이해했다고 착각한 채 코드를 수정 |
| **검증 없는 종료** | 테스트를 돌리지 않고 "구현 완료" 선언 |
| **루프 탈출 실패** | 같은 버그를 같은 방식으로 3번 수정 시도 |
| **계획 없이 구현** | 즉흥적으로 코드를 쓰다가 절반쯤에서 구조를 다시 뜯어고침 |
| **긍정 편향** | "이 접근은 완벽합니다"라고 말한 뒤 30분 후 "죄송합니다, 누락이 있었네요" |
| **비평 부재** | 스스로의 계획을 스스로 검토 → 당연히 통과 |

이 실패들은 모델의 "지능" 부족이 아니라, **자기 출력을 검증·반박할 외부 기준이 없다는 구조적 한계**에서 나옵니다. 프롬프트만으로는 해결되지 않습니다 — 아무리 "꼼꼼히 검토해줘"라고 써도 모델이 "검토했습니다"라고 거짓말하면 그만입니다.

**하네스 엔지니어링은 이 한계를 외부 통제로 메웁니다.** 모델이 "완료했다"고 주장해도 외부 게이트가 "아니오, 이 조건이 충족되지 않았습니다"라고 반박할 수 있어야 합니다.

### 1.3. 하네스 엔지니어링의 4가지 구성 요소

좋은 하네스는 다음 4가지를 반드시 갖춥니다:

1. **Phase 분해 (Decomposition)** — 복잡한 작업을 탐색/계획/검토/실행/검증 등 단계로 나눔
2. **도구 제한 (Tool Gating)** — 각 단계에서 허용되는 도구를 명시적으로 제한 (예: 계획 단계에서는 코드 수정 금지)
3. **품질 게이트 (Quality Gates)** — 각 단계 종료 시 충족해야 할 객관적 조건 (파일 수정 ≥1, 비평 수신 등)
4. **적응 (Adaptation)** — 실행 중 발견된 정보에 따라 파이프라인 자체를 변형 (예: critical 버그 발견 시 hotfix 단계 삽입)

이 중 **4번 적응**이 가장 어렵고, 많은 에이전트 프레임워크에서 누락되어 있습니다. 정적인 파이프라인은 예상 밖 상황에서 무력하기 때문입니다.

---

## 2. 이 도구가 왜 하네스 엔지니어링에 적합한가

Pipeline Dashboard는 **위 4가지를 모두 런타임에 강제**하는 Claude Code용 하네스입니다. Claude Code의 **Hook API**를 활용해, 사용자가 Claude와 자연스럽게 대화하는 동안 뒤에서 조용히 작동합니다.

| 하네스 요건 | 이 도구의 대응 |
|---|---|
| Phase 분해 | `pipeline-templates.json`에 선언된 A~F 단계 (탐색/계획/검토/보완/실행/검증) |
| 도구 제한 | `PreToolUse` 훅이 `phase.allowedTools`를 초과하는 도구 호출을 **즉시 차단** |
| 품질 게이트 | `Stop` 훅 시점에 `exitCriteria`를 평가, 실패 시 Claude에게 "아직 조건 미충족"이라고 되돌려줌 |
| 적응 | `PipelineAdapter`가 상태를 보고 파이프라인을 mid-run에 삽입/교체/병합 |

**핵심 특징 — Directive Mode**

Claude Code의 훅은 단순히 이벤트를 기록하는 용도가 아니라 **결정을 되돌려 보낼 수 있습니다**. 훅이 `{decision: "block", reason: "..."}`를 반환하면 Claude는 해당 도구 호출을 중단하거나, 턴 종료를 연기하고 이유에 따라 행동을 조정합니다. 이 양방향 채널 덕에 하네스가 실제로 "고삐"를 당길 수 있습니다.

**Claude가 스스로 멈추지 못하는 것을, 외부 하네스가 대신 멈추게 한다 — 이것이 이 도구의 본질입니다.**

---

## 3. 시스템 구조

```
┌──────────────────────────────────────────────────────────────┐
│                     Claude Code 세션                          │
│                                                                │
│  ┌──────────┐   UserPromptSubmit   ┌──────────────────┐      │
│  │  사용자   │ ───────────────────> │  harness-hook.js │      │
│  └──────────┘                       │   (stdio bridge) │      │
│                                     └────────┬─────────┘      │
│  ┌──────────┐   PreToolUse, Stop            │                 │
│  │  Claude  │ ───────────────────────>      │                 │
│  └──────────┘ <─────────────────────────    │                 │
│         ^   decision: block / reason        │                 │
│         │                                    │                 │
└─────────┼────────────────────────────────────┼─────────────────┘
          │                                    │ HTTP
          │                                    v
          │         ┌─────────────────────────────────────┐
          │         │       server.js (Express)           │
          │         │  /api/hook → HookRouter             │
          │         │  /api/executor/mode                 │
          │         └────────┬────────────────────────────┘
          │                  │
          │                  v
          │         ┌─────────────────────────────────────┐
          │         │     PipelineExecutor                │
          │         │  ┌──────────────┐                   │
          │         │  │ TASK_PATTERNS│ → 템플릿 선택      │
          │         │  └──────────────┘                   │
          │         │  ┌──────────────┐                   │
          │         │  │ PipelineState│ ← 도구/산출물 기록 │
          │         │  └──────────────┘                   │
          │         │  ┌──────────────┐                   │
          │         │  │ QualityGate  │ ← exitCriteria   │
          │         │  └──────────────┘                   │
          │         │  ┌──────────────┐                   │
          │         │  │SkillInjector │ → Codex 프롬프트  │
          │         │  └──────────────┘                   │
          │         │  ┌──────────────┐                   │
          │         │  │ CodexRunner  │ → codex CLI       │
          │         │  └──────────────┘                   │
          │         │  ┌──────────────┐                   │
          │         │  │PipelineAdapter│→ 런타임 변형     │
          │         │  └──────────────┘                   │
          │         └────────┬────────────────────────────┘
          │                  │ WebSocket broadcast
          │                  v
          │         ┌─────────────────────────────────────┐
          │         │   대시보드 (public/app.js)           │
          └──────── │   - 실시간 phase 시각화              │
                    │   - gate/finding 이벤트 로그         │
                    │   - pipeline_mutated → 재렌더링     │
                    └─────────────────────────────────────┘
```

### 3.1. 계층별 책임

**① 훅 브릿지** — `hooks/harness-hook.js`
- Claude Code가 훅 이벤트를 발생시키면 stdin으로 JSON을 받음
- HTTP POST로 `/api/hook`에 전달
- 응답을 stdout으로 Claude에 돌려줌
- 실패해도 `exit(0)` — 절대 Claude를 막지 않음 (fail-open)

**② HookRouter** — `executor/hook-router.js`
- 훅 이벤트(`user-prompt`, `pre-tool`, `post-tool`, `stop`, `session-end`)를 PipelineExecutor 메서드로 디스패치
- 통계 수집 (`/api/hook/stats`)

**③ PipelineExecutor** — `executor/pipeline-executor.js`
- 하네스의 두뇌. 6개 내부 모듈을 오케스트레이션
- 환경변수 `HARNESS_ENABLED=1` 또는 API로 활성화

**④ 6개 협력 모듈**
- `PipelineState` — 모든 도구/파일/finding의 중앙 저장소
- `QualityGate` — exitCriteria 평가
- `SkillInjector` — Codex에 보낼 프롬프트 조립
- `CodexRunner` — `codex exec` 서브프로세스 실행
- `PipelineAdapter` — 런타임 파이프라인 변형
- 외부에서 주입되는 `skillRegistry`

**⑤ 대시보드** — `public/app.js`
- WebSocket으로 이벤트 수신
- 파이프라인 재렌더링, finding 카운터, 사이클 카운터, flash 애니메이션

---

## 4. 알고리즘

### 4.1. Task Detection (시작점)

사용자가 Claude에 입력한 프롬프트는 `UserPromptSubmit` 훅으로 포착되어 `startFromPrompt(prompt)`에 전달됩니다.

```javascript
const TASK_PATTERNS = {
  "code-review":   /리뷰|review|검토/i,
  "testing":       /테스트|test|jest|pytest|vitest|coverage/i,
  "debugging":     /디버그|debug|버그|bug|에러|error|fix|수정|고치|오류/i,
  "refactoring":   /리팩토|refactor|개선|improve|clean[\s-]*up/i,
  "planning":      /계획|plan|설계|design|아키텍처|architecture/i,
  "implementation":/구현|implement|만들|생성|추가|add|create|feature|기능/i,
};
```

첫 번째로 매치되는 패턴의 타입이 선택되고, `TEMPLATE_MAP`으로 `pipeline-templates.json`의 템플릿 ID로 변환됩니다. 매치 없어도 프롬프트 길이 > 10자 + 명령형 어미(`해줘`, `세요`, `만들`, `implement` 등)가 있으면 `implementation`으로 폴백합니다.

**왜 regex인가** — LLM에 "이 작업이 어떤 타입인가?"를 묻는 것은 또 다른 추론 호출이고, 지연과 비결정성을 추가합니다. 훅은 **즉시 결정**해야 합니다.

### 4.2. 도구 제한 (PreToolUse 차단)

```javascript
async onPreTool(tool, _input) {
  const phase = this._currentPhase();
  if (!phase.allowedTools) return {};  // 제한 없음
  if (!phase.allowedTools.includes(tool)) {
    return {
      decision: "block",
      reason: `Harness ${phase.label}(${phase.name}) 단계에서는 다음 도구만 허용됩니다: ${phase.allowedTools.join(", ")}. 요청한 도구: ${tool}.`,
    };
  }
  return {};
}
```

예: Phase A(탐색)의 `allowedTools = ["Read","Glob","Grep","Agent","TodoWrite"]`. Claude이 탐색 도중 `Write`를 시도하면 즉시 차단되고, reason이 Claude 본인에게 돌아와 "아, 아직 탐색 단계이므로 Write는 다음 phase에서 해야겠다"고 스스로 교정합니다.

**이것이 Directive Mode의 실전입니다** — 모델에게 "계획 없이 코드 쓰지 마"라고 프롬프트로 부탁하는 대신, 실제로 코드 작성 도구를 **물리적으로 잠그는** 겁니다.

### 4.3. PipelineState — 무엇이 일어났는지 추적

모든 도구 호출은 `PostToolUse` 훅에서 다음과 같이 기록됩니다:

```javascript
recordTool(phaseId, tool, response) {
  this.phases[phaseId].tools.push({tool, at: Date.now()});
  this.metrics.toolCount++;
  this.metrics.byTool[tool] = (this.metrics.byTool[tool] || 0) + 1;

  if (tool === "Edit" || tool === "Write") {
    const filePath = this._extractFilePath(response);
    if (filePath) this.metrics.filesEdited.add(filePath);
  }
  if (tool === "Bash") this.metrics.bashCommands++;
}
```

이 누적 상태가 **QualityGate와 PipelineAdapter의 유일한 진실 공급원**입니다. LLM이 "검증 끝났어요"라고 말하는 걸 믿는 게 아니라, `filesEdited.size`와 `bashCommands` 같은 **관측 가능한 사실**로 판단합니다.

### 4.4. Artifact Rules — 산출물 자동 캡처

`pipeline-templates.json`의 각 phase는 `artifactRules`를 선언할 수 있습니다:

```json
"artifactRules": [
  { "toolMatch": "Write", "pathMatch": "plan.*\\.md$", "artifactKey": "plan" }
]
```

`PostToolUse`에서 Claude이 `Write({filePath: "/tmp/plan-001.md"})`을 호출하면, regex `plan.*\.md$`에 매치되어 `state.setArtifact("B", "plan", "/tmp/plan-001.md")`이 실행됩니다. 이후 QualityGate의 `has-artifact` 조건이 이 키를 참조합니다.

**왜 중요한가** — "계획 문서를 작성했는가?"를 Claude에게 묻는 대신, 실제로 `plan*.md` 파일이 쓰였는지 파일 시스템 이벤트로 증명하는 겁니다.

### 4.5. QualityGate — 턴 종료 차단

`Stop` 훅 시점(Claude이 한 턴을 끝내려 할 때)에 `QualityGate.evaluate(phase, state)`가 호출됩니다:

```javascript
// criterion 평가
switch (c.type) {
  case "min-tools-in-phase":   return state.phaseToolCount(phase.id) >= c.count;
  case "has-artifact":          return state.getArtifact(phase.id, c.key) !== undefined;
  case "no-critical-findings":  return !state.findings.some(f => ["critical","high"].includes(f.severity));
  case "critique-received":     return state.phases[phase.id]?.critique != null;
  case "files-edited":          return state.metrics.filesEdited.size >= c.min;
  case "bash-ran":              return state.metrics.bashCommands >= c.min;
  case "used-tool":             return (state.metrics.byTool[c.tool] || 0) >= c.min;
}
```

하나라도 실패하면 `onStop`이 `{decision: "block", reason: "필요 조건: ..."}`를 반환, Claude은 "아직 이 phase를 못 끝냈구나"를 인지하고 추가 작업을 합니다.

**무한 루프 방지 — MAX_GATE_RETRIES=3**

Claude이 3번 연속 같은 게이트에 실패하면, 하네스는 포기하고 다음 phase로 넘어갑니다 (`gate_bypassed` 이벤트 브로드캐스트). 무한히 붙잡아두는 것보다 전진이 낫기 때문입니다. 이 우회는 로그에 남아 사후 분석이 가능합니다.

### 4.6. Codex Cycle — 계획에 대한 제2의 눈

Phase C는 `agent: "codex"`로 선언되어 있어, `_enterPhase` 시점에 **Codex CLI를 서브프로세스로 자동 실행**합니다:

```javascript
async _runCodexPhase(phase) {
  const prompt = this.injector.buildCodexPrompt(phase, this.state);
  const result = await this.codex.exec(prompt, {timeoutMs: phase.timeoutMs || 120000});
  this.state.setCritique(phase.id, result);

  if (phase.cycle && result.findings.some(f => ["critical","high"].includes(f.severity))
      && this.active.iteration < phase.maxIterations) {
    this.active.iteration++;
    await this._enterPhase(phase.linkedCycle);  // 계획 보완 단계로 되돌아감
    return;
  }
  await this._advance();
}
```

`SkillInjector.buildCodexPrompt`는 다음을 조합해 Codex에 보냅니다:

```markdown
# Task: 계획 검토
## User Goal
<원본 프롬프트>
## Your Role
You are the critic for phase "C"... report concrete issues — do not rewrite.
## Guidelines
<SKILL.md 내용>
## Previous Phase Outputs
### B.plan
<Claude이 작성한 계획 본문>
## Required Output Format
- [critical] <issue>
- [high] <issue>
## Summary
```

Codex의 출력에서 `- [severity] message` 패턴을 regex로 파싱해 `findings` 배열을 구축합니다. critical/high 심각도가 있으면 계획 보완 단계(Phase D)로 되돌아가고, Claude이 계획을 수정한 뒤 다시 Phase C로 와 Codex가 재검토합니다 — 최대 `maxIterations`회.

**왜 별도 모델로 검토하나** — 같은 모델이 자기 계획을 검토하면 "편향의 공모"가 생깁니다. Claude이 "이 접근은 완벽합니다"라고 쓴 다음 Claude에게 검토 요청하면 "네, 완벽해 보입니다"가 대부분의 답입니다. Codex는 독립된 아키텍처와 훈련 데이터를 가진 **구조적으로 다른 심사관**입니다.

### 4.7. PipelineAdapter — 런타임 변형

하네스의 "적응" 요소. `_advance()`가 다음 phase로 넘어가기 **직전**에 호출됩니다:

```javascript
async _advance() {
  const mutation = await this.adapter.review(this.active, this.state);
  if (mutation) {
    const applied = this._applyMutation(mutation);
    if (applied) {
      this.broadcast({ type: "pipeline_mutated", data: {...} });
      await this._enterPhase(applied.nextIdx);
      return;
    }
  }
  await this._enterPhase(this.active.phaseIdx + 1);
}
```

**현재 내장된 3개 룰**:

**룰 1 — `insert-hotfix-on-critical`**
- When: `state.findings.some(f => f.severity === "critical")`
- 동작: `phaseIdx+1`에 긴급 수정 phase E0를 splice로 삽입
- E0의 exitCriteria: `no-critical-findings` + `files-edited ≥ 1`
- 의미: "critical finding이 발견됐다면 다음 단계 가기 전에 반드시 고쳐라"

**룰 2 — `switch-to-debugging-on-stuck-cycle`**
- When: 현재 phase가 cycle이고 `iteration ≥ maxIterations`이며 여전히 critical/high finding이 남아있음
- 동작: `active.template`을 `debugging` 템플릿으로 전체 교체, `phaseIdx=0`으로 리셋
- 의미: "계획 보완 사이클이 3번 실패했다면 근본적으로 접근이 틀렸다. 디버깅 파이프라인으로 전환해라"

**룰 3 — `merge-testing-when-many-edits`**
- When: `state.metrics.filesEdited.size ≥ 20`
- 동작: `testing` 템플릿의 테스트 관련 phase들을 현재 파이프라인의 `phaseIdx+1`에 splice로 병합 (id에 `T_` 프리픽스)
- 의미: "수정 범위가 크면 자동으로 테스트 단계를 추가해라"

**재적용 방지 — `_adapterMarks`**

각 룰은 `markId`를 갖고, 적용되면 `active._adapterMarks` Set에 기록됩니다. 같은 룰이 반복 적용되는 걸 막아 무한 삽입 루프를 방지합니다.

**변형 타입 상세**:

```javascript
_applyMutation(mutation) {
  switch (mutation.type) {
    case "insert-phase":
      this.active.template.phases.splice(at, 0, mutation.phase);
      return { nextIdx: at };

    case "switch-template":
      this.active.template = structuredClone(templates[mutation.templateId]);
      this.active.phaseIdx = -1;
      this.active.iteration = 0;
      return { nextIdx: 0 };

    case "merge-template":
      this.active.template.phases.splice(at, 0, ...mutation.phases);
      return { nextIdx: at };
  }
}
```

`structuredClone`은 변형된 템플릿이 원본 `templates` 객체를 오염시키지 않도록 깊은 복사합니다.

**파이프라인 변형은 대시보드에 실시간 반영**됩니다. `pipeline_mutated` 이벤트가 WebSocket으로 브로드캐스트되면 `app.js`의 `handlePipelineMutated`가 새 템플릿으로 `renderPipeline()`을 호출, 새 phase 블록이 즉시 DOM에 나타나고 flash 애니메이션이 뜹니다.

---

## 5. 사용되는 도구·스킬·모델

### 5.1. 모델 (Execution / Critique)

| 역할 | 모델 | 접근 경로 |
|---|---|---|
| **Planner / Executor** | Claude Opus 4.6 (`claude-opus-4-6`) | Claude Code CLI |
| **Critic** | GPT-5 Codex (Codex CLI의 기본 모델) | `codex exec --full-auto --skip-git-repo-check` 서브프로세스 |
| **Sub-agents** | Sonnet 4.6 / Haiku 4.5 | Claude Code의 Agent 도구로 위임 시 선택 |

**이중 모델 아키텍처의 의도** — Claude와 Codex(GPT-5 기반)는 **다른 RLHF 분포와 다른 실패 모드**를 갖습니다. 한 모델이 놓치는 것을 다른 모델이 잡을 확률이 크게 올라갑니다. 같은 모델을 두 번 호출하는 "셀프 리뷰"와는 질적으로 다른 cross-validation입니다.

### 5.2. Claude Code 내장 도구 (훅 매칭 대상)

| 도구 | Phase별 허용 여부 (default 템플릿) |
|---|---|
| `Read` | 모든 phase |
| `Glob`, `Grep` | A (탐색), B (계획), E (실행), F (검증) |
| `Agent` | A (서브에이전트 위임) |
| `TodoWrite` | A, B, E |
| `Write` | B (계획 문서), D (계획 보완), E (구현) |
| `Edit` | D, E |
| `Bash` | E (실행), F (검증) |

다른 파이프라인 템플릿(`code-review`, `testing`)은 다른 매트릭스를 사용합니다.

### 5.3. 워크스페이스 스킬 (70여 개 설치)

`C:\Users\SJ\workspace\CLAUDE.md`에 선언된 스킬 카테고리:

- **Superpowers (14)** — `brainstorming`, `writing-plans`, `executing-plans`, `tdd`, `debugging`, `root-cause-analysis`, `verification-before-completion` 등 방법론 스킬
- **Harness (1)** — 에이전트 팀 자동 설계 메타스킬
- **Engineering (20)** — `agent-designer`, `database`, `docker`, `ci-cd`, `performance-optimization` 등
- **Toolkit (23)** — `python`, `react`, `nextjs`, `typescript`, `security-audit` 등
- **Product / Marketing (8)** — `content-writing`, `landing-page`, `market-research`
- **Others (7)** — `senior-backend`, `senior-frontend`, `senior-fullstack`, `playwright`

**스킬과 하네스의 연결**

`SkillInjector.gather(phase)`가 `phase.skill` 필드(예: `"superpowers:writing-plans"`)를 보고 `skillRegistry.getSkillContent(id)`로 SKILL.md 본문을 로드합니다. 이후 Codex 프롬프트의 `## Guidelines` 섹션에 주입되어, **Codex가 해당 스킬의 방법론에 따라 계획을 평가**하도록 합니다. 템플릿 JSON에 `skill: "superpowers:writing-plans"`를 추가하면 별도 코드 없이 연결됩니다.

### 5.4. 외부 도구

- **Node.js 24.x** — 서버 런타임
- **Express 4** — HTTP 서버, `/api/hook`, `/api/executor/mode`, `/api/usage` 등
- **ws** — WebSocket 브로드캐스트 (`/api/ws`)
- **node-pty** — 대시보드 내장 터미널 (Windows는 ConPTY 사용)
- **xterm.js** — 브라우저 측 터미널 렌더링
- **Codex CLI** — `npm i -g @openai/codex` 후 `codex --version`으로 확인
- **Claude Code CLI** — `claude --version`

---

## 6. 실행 방법

### 6.1. 가장 쉬운 방법

바탕화면의 **`파이프라인-대시보드.bat`** 을 더블클릭하세요:

1. 포트 4200이 이미 쓰이는지 확인
2. 이미 실행 중이면 브라우저만 열고 종료
3. 아니면 `node server.js`를 포그라운드에서 실행 + 2초 후 브라우저 자동 오픈
4. 창을 닫으면 서버 중지

브라우저에서 `http://127.0.0.1:4200`이 열립니다.

### 6.2. 하네스 활성화

대시보드 우상단에 회색/녹색 토글 배지가 있습니다:

- **Harness OFF** — 훅은 연결되어 있지만 도구 차단·게이트 평가는 비활성화 (안전 모드)
- **🔒 Harness ON** — 전체 Directive Mode 작동

토글을 클릭하거나, 터미널에서:

```bash
curl -X POST http://127.0.0.1:4200/api/executor/mode -H "Content-Type: application/json" -d '{"enabled":true}'
```

### 6.3. 훅 등록 확인

`C:\Users\SJ\workspace\.claude\settings.json`에 다음이 있어야 합니다:

```json
{
  "hooks": {
    "UserPromptSubmit": [{"command": "node C:/Users/SJ/workspace/pipeline-dashboard/hooks/harness-hook.js user-prompt"}],
    "PreToolUse":       [{"matcher": "Edit|Write|Bash", "command": "..."}],
    "PostToolUse":      [{"command": "..."}],
    "Stop":             [{"command": "..."}],
    "SessionEnd":       [{"command": "..."}]
  }
}
```

Claude Code를 재시작하면 훅이 로드됩니다. 이후 사용자가 "구현해줘", "디버그해줘", "리뷰해줘" 같은 요청을 하면 대시보드가 자동으로 해당 파이프라인을 띄웁니다.

### 6.4. 작동 관찰

대시보드에서 실시간으로 확인할 수 있는 것들:

- **Phase 하이라이트** — 현재 활성 phase에 녹색 테두리
- **Tool 로그** — 각 도구 호출이 로그 탭에 나타남
- **Gate failure** — `gate_failed` 이벤트는 phase에 빨간 flash + 에러 로그
- **Artifact 캡처** — 계획 문서 Write 시 phase에 녹색 flash
- **Codex critique** — `## Summary` 섹션이 로그에 표시되고 finding 카운터가 증가
- **Pipeline mutation** — E0 hotfix 삽입이나 템플릿 전환이 즉시 파이프라인 도식에 반영

### 6.5. 안전 장치

**Self-block 방지** — 훅이 이 도구 자체를 개발하는 Claude 세션까지 차단하는 불상사를 막기 위해:
- `HARNESS_ENABLED` 환경변수 + API 토글 이중 게이팅
- 훅 요청 타임아웃 1.5초 (서버 죽으면 빠르게 포기)
- 모든 실패 경로가 `exit(0)` → Claude는 절대 막히지 않음 (fail-open)
- MCP preview 도구(`mcp__Claude_Preview__preview_*`)는 `PreToolUse` 매처(`Edit|Write|Bash`)에 포함되지 않아 하네스 우회 가능 — 응급 해제 경로

---

## 7. 커스터마이징

### 7.1. 새 파이프라인 템플릿 추가

`pipeline-templates.json`에 새 최상위 키를 추가:

```json
"my-template": {
  "id": "my-template",
  "name": "내 커스텀 파이프라인",
  "phases": [
    {
      "id": "A",
      "name": "스코핑",
      "label": "Phase A",
      "agent": "claude",
      "allowedTools": ["Read", "Glob"],
      "exitCriteria": [{"type": "min-tools-in-phase", "count": 5}],
      "nodes": [{"id": "scoper", "icon": "S", "iconType": "emoji", "label": "Scoper", "sublabel": "범위 확정"}]
    }
  ]
}
```

`TEMPLATE_MAP`(`pipeline-executor.js`)에 매핑 추가:

```javascript
const TEMPLATE_MAP = {
  ...
  "my-task-type": "my-template",
};
```

`TASK_PATTERNS`에 감지 regex 추가.

### 7.2. 새 exitCriteria 타입 추가

`quality-gate.js`의 `_check` switch에 case 추가:

```javascript
case "file-size-growth": {
  const target = state.getArtifact(phase.id, "target");
  if (!target) return false;
  const size = fs.statSync(target).size;
  return size >= (c.min || 1000);
}
```

`_defaultMessage`에도 대응하는 한글 메시지 추가.

### 7.3. 새 adapter 룰 추가

`pipeline-adapter.js`의 `_loadRules()` 배열에 항목 추가:

```javascript
{
  id: "insert-security-audit-on-auth-changes",
  when: (active, state) => {
    const filesTouched = [...state.metrics.filesEdited];
    return filesTouched.some(f => /auth|login|token/i.test(f));
  },
  build: (active) => ({
    type: "insert-phase",
    at: active.phaseIdx + 1,
    phase: { id: "SA", name: "보안 감사", ... },
  }),
}
```

### 7.4. Skill 주입

템플릿 phase에 `skill` 필드 추가:

```json
"skill": "superpowers:writing-plans"
```

`SkillInjector`가 자동으로 해당 SKILL.md 본문을 Codex 프롬프트에 삽입합니다.

---

## 8. 파일 레퍼런스

| 파일 | 책임 |
|---|---|
| `hooks/harness-hook.js` | Claude Code 훅 ↔ HTTP 브릿지 |
| `executor/hook-router.js` | 훅 이벤트 → PipelineExecutor 메서드 라우팅 |
| `executor/pipeline-executor.js` | 메인 오케스트레이터 |
| `executor/pipeline-state.js` | 도구/산출물/finding 누적 저장소 |
| `executor/quality-gate.js` | exitCriteria 평가 엔진 |
| `executor/skill-injector.js` | Codex 프롬프트 빌더 |
| `executor/codex-runner.js` | Codex CLI 서브프로세스 실행 |
| `executor/pipeline-adapter.js` | 런타임 변형 룰 엔진 |
| `executor/__phase{2,3,4}-test.js` | 단위/통합 테스트 (24개) |
| `pipeline-templates.json` | phase·exitCriteria·allowedTools 선언 |
| `server.js` | Express + WebSocket + 모든 모듈의 조립 지점 |
| `public/app.js` | 대시보드 렌더링 + 이벤트 핸들러 |
| `public/style.css` | 시각화 스타일 + flash 애니메이션 |
| `.claude/settings.json` | 워크스페이스 훅 등록 |

---

## 9. 검증 — 이 도구가 실제로 작동한다는 증거

24개 단위/통합 테스트가 모든 핵심 경로를 커버합니다:

```
Phase 2 (6 tests):  활성화, allowedTools 차단, 게이트 통과, Codex cycle, 비활성 no-op, disable 시 정리
Phase 3 (8 tests):  State 기록, min-tools-in-phase, has-artifact, no-critical-findings,
                    게이트 차단+우회, artifact capture, SkillInjector prompt, skill gather
Phase 4 (10 tests): Adapter no-op, insert-hotfix, 재적용 방지, switch-template (stuck cycle),
                    merge-testing, executor 통합, mutation 적용
```

```bash
cd C:\Users\SJ\workspace\pipeline-dashboard
node executor/__phase2-test.js && node executor/__phase3-test.js && node executor/__phase4-test.js
```

모두 통과하면 `ALL PHASE {N} TESTS PASSED` 출력.

---

## 10. 마무리 — 이 도구가 담고 있는 생각

이 도구를 만들면서 가장 많이 느낀 건, **LLM 에이전트를 개선하는 길은 두 가지**라는 겁니다:

1. **모델 내부를 바꾸기** — 더 나은 파인튜닝, 더 긴 컨텍스트, 더 똑똑한 추론
2. **모델 외부의 환경을 바꾸기** — 더 좋은 훅, 더 엄격한 게이트, 더 영리한 적응 규칙

업계 대부분이 1번에 집중하지만, 1번의 개선은 분기별로만 찾아옵니다. 반면 2번은 **지금 당장** 할 수 있고, 같은 모델로도 극적으로 다른 결과를 낼 수 있습니다. 이 도구는 2번의 실천입니다.

> 좋은 하네스는 모델을 제약하는 게 아니라, 모델의 **최선**을 끌어내는 구조를 만든다.

말을 잘 달리게 하려면 멍에를 씌워야 하듯이.

---

**버전**: Phase 1-4 완료 (2026-04-14)
**License**: Internal use
**Author**: SJ + Claude Code
