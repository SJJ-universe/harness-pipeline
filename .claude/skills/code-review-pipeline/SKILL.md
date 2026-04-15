---
name: code-review-pipeline
description: "완성되거나 작업 중인 코드·PR diff를 품질·보안·가독성 관점에서 검토받을 때 반드시 이 파이프라인을 쓸 것. 사용자가 '리뷰해줘', 'PR 리뷰', '코드 검토', '보안 검토', 'review this', '다시 리뷰', '재리뷰', '이전 리뷰 보완' 등으로 검토를 요청할 때 발동한다. Saboteur/Security/Readability 3개 리뷰어 팀 + Codex CLI 이중 순환 검토. 구현·버그 수정 작업은 universal-task-pipeline으로 분리하라."
trigger: "코드 리뷰", "리뷰해줘", "PR 리뷰", "코드 검토", "review this code", "review PR", "파이프라인 리뷰", "pipeline review", "다시 리뷰", "재리뷰", "이전 리뷰 보완"
---

# 듀얼 AI 코드 리뷰 파이프라인

Claude Code 에이전트 팀과 Codex CLI가 협력하여 코드를 다각도로 검토하는 자동화 파이프라인이다.
실행 진행 상황은 Pipeline Dashboard (http://localhost:4200)에 실시간 표시된다.

## 트리거 조건

다음 상황에서 이 스킬을 사용한다:
- "이 코드 리뷰해줘", "PR 리뷰해줘", "파이프라인 리뷰"
- "코드 검토 부탁해", "review this code", "pipeline review"
- 사용자가 파일 경로나 PR 번호와 함께 리뷰를 요청할 때

---

## 대시보드 연동 (모든 Phase 전에 실행)

파이프라인 시작 전 대시보드를 자동으로 시작하고 연결한다.

### Step 0-1: 대시보드 서버 확인
Bash tool로 실행:
```bash
curl -s --connect-timeout 2 http://localhost:4200/api/health
```

### Step 0-2: 서버가 응답하지 않으면 자동 시작
`mcp__Claude_Preview__preview_start` 도구를 호출한다:
- name: "pipeline-dashboard"

시작 후 3초 대기, health 재확인. 최대 3회 시도.

### Step 0-3: 대시보드 리셋 및 시작 이벤트
```bash
curl -s -X POST http://localhost:4200/api/reset -H "Content-Type: application/json" 2>/dev/null || true
```
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"pipeline_start","data":{"targetFile":"[대상파일경로]","mode":"live"}}' 2>/dev/null || true
```

### 이벤트 전송 규칙
- 모든 curl 명령 끝에 `2>/dev/null || true` 추가 → 대시보드 없어도 파이프라인 계속 실행
- Phase 전환: `{"type":"phase_update","data":{"phase":"A","status":"active"}}`
- 노드 상태: `{"type":"node_update","data":{"node":"claude-plan","status":"active"}}`
- 발견 사항: `{"type":"findings","data":{"persona":"security","findings":[...]}}`
- 판정: `{"type":"verdict","data":{"verdict":"BLOCK","stats":{...}}}`
- 완료: `{"type":"pipeline_complete","data":{"tokenUsage":{"claude":0,"codex":0},"errors":[],"duration":0}}`

---

## Phase A: 공동 플래닝

### 이벤트 전송
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"A","status":"active"}}' 2>/dev/null || true
```

### 절차
1. **리뷰 대상 코드 수집**
   - PR인 경우: `gh pr diff {PR번호}` 로 diff 수집
   - 파일인 경우: Read tool로 파일 내용 수집

2. **Claude Code 리뷰 계획 수립** (node: `claude-plan`)
   ```bash
   curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"claude-plan","status":"active"}}' 2>/dev/null || true
   ```
   - 중점 리뷰 파일, 예상 위험 영역, 리뷰 우선순위 작성
   ```bash
   curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"claude-plan","status":"completed"}}' 2>/dev/null || true
   ```

3. **Codex CLI 계획 리뷰** (node: `codex-plan`)
   ```bash
   curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"codex-plan","status":"active"}}' 2>/dev/null || true
   ```
   ```bash
   npx @openai/codex exec --full-auto --skip-git-repo-check "You are a senior architect. Review this code review plan and suggest improvements. Plan: [계획 내용]. Respond in under 100 words."
   ```
   ```bash
   curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"codex-plan","status":"completed"}}' 2>/dev/null || true
   ```

4. Codex 피드백을 반영하여 최종 리뷰 계획 확정

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"A","status":"completed"}}' 2>/dev/null || true
```

---

## Phase B: 구현 (리뷰 대상이 신규 코드인 경우만)

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"B","status":"active"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"claude-code","status":"active"}}' 2>/dev/null || true
```

기존 코드 리뷰인 경우 Phase C로 바로 진행한다. (이 경우에도 위 이벤트는 전송 후 즉시 completed 처리)

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"claude-code","status":"completed"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"B","status":"completed"}}' 2>/dev/null || true
```

---

## Phase C: 리뷰 순환

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"C","status":"active"}}' 2>/dev/null || true
```

### C-1: Orchestrator 디스패치 (node: `orchestrator`)
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"orchestrator","status":"active"}}' 2>/dev/null || true
```

3개 리뷰어 에이전트를 **병렬로** 실행한다 (Agent tool, `run_in_background: true`).

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"orchestrator","status":"completed"}}' 2>/dev/null || true
```

### C-2: 3개 리뷰어 병렬 실행

각 에이전트 시작 시 active 이벤트 전송:
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"saboteur","status":"active"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"security","status":"active"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"readability","status":"active"}}' 2>/dev/null || true
```

각 에이전트 완료 시 — findings 이벤트 전송:
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"security","status":"completed","findings":3}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"findings","data":{"persona":"security","findings":[에이전트가 반환한 JSON 배열]}}' 2>/dev/null || true
```

에이전트 출력 형식: `[{severity, file, line, message, persona}]`

### C-3: 결과 종합 — Synthesizer (node: `synthesizer`)
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"synthesizer","status":"active"}}' 2>/dev/null || true
```

3개 리뷰어 결과를 종합:
- 같은 파일·줄(±3줄) 이슈 병합
- 2개 이상 페르소나 교차 발견 시 심각도 한 단계 승격

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"synthesizer","status":"completed"}}' 2>/dev/null || true
```

### C-4: Codex CLI 2차 검토 (node: `codex-review`)
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"codex-review","status":"active"}}' 2>/dev/null || true
```

```bash
npx @openai/codex exec --full-auto --skip-git-repo-check "You are an independent code reviewer. Review the following code. The first review team found these issues: [1차 요약]. Find additional issues they missed. Output as JSON array [{severity, file, line, message}]. Code: [코드]"
```

Codex 결과를 findings 이벤트로 전송:
```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"codex-review","status":"completed"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"findings","data":{"persona":"codex","findings":[Codex 결과 JSON]}}' 2>/dev/null || true
```

### C-5: 최종 판정

| 조건 | 판정 |
|------|------|
| CRITICAL 1개 이상 | **BLOCK** — 머지 차단 |
| CRITICAL 없음, WARNING 1개 이상 | **CONCERNS** — 수정 후 머지 |
| WARNING/CRITICAL 없음 | **CLEAN** — 머지 가능 |

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"verdict","data":{"verdict":"[BLOCK/CONCERNS/CLEAN]","stats":{"critical":N,"warning":N,"note":N,"codexAdditional":N,"total":N}}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"C","status":"completed"}}' 2>/dev/null || true
```

---

## Phase D: 디버그 & 수정

### 진입 조건
- Phase C 판정이 BLOCK 또는 CONCERNS인 경우

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"D","status":"active"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"debug","status":"active"}}' 2>/dev/null || true
```

### 절차
1. CRITICAL 이슈부터 순서대로 수정한다
2. WARNING 이슈를 수정한다
3. NOTE는 선택적으로 수정한다
4. 수정 완료 후 **Phase C로 복귀** (재검토)

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"node_update","data":{"node":"debug","status":"completed"}}' 2>/dev/null || true
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"phase_update","data":{"phase":"D","status":"completed"}}' 2>/dev/null || true
```

### 순환 제한
- **최대 3회** 순환한다
- 3회 후에도 CRITICAL이 남아있으면:
  - 사용자에게 남은 이슈를 보고한다
  - "자동 수정 한계에 도달했습니다. 다음 이슈가 남아있습니다: [이슈 목록]"

---

## 파이프라인 완료

```bash
curl -s -X POST http://localhost:4200/api/event -H "Content-Type: application/json" -d '{"type":"pipeline_complete","data":{"tokenUsage":{"claude":0,"codex":0},"errors":[],"duration":0}}' 2>/dev/null || true
```

---

## 리포트 출력 포맷

```markdown
## Code Review Report — Dual AI Review

**Target**: [파일명 또는 PR#]
**Verdict**: BLOCK / CONCERNS / CLEAN
**Cycle**: #{순환 횟수}/3
**Reviewed by**: Claude Code Team (Saboteur, Security, Readability) + Codex CLI

### 1차 검토 (Claude Code 에이전트 팀)

#### Critical Findings (머지 차단)
| # | File | Line | Issue | Persona(s) |
|---|------|------|-------|------------|

#### Warnings (수정 권장)
| # | File | Line | Issue | Persona(s) |
|---|------|------|-------|------------|

### 2차 검토 (Codex CLI)

#### Additional Findings
| # | File | Line | Issue | Source |
|---|------|------|-------|--------|

### Combined Summary
[2~3문장 종합 리스크 프로파일]

### Action Required
- [ ] Fix: [구체적 수정 사항]
```

---

## 에러 핸들링

| 상황 | 대응 |
|------|------|
| 대시보드 서버 미응답 | 대시보드 없이 파이프라인 계속 실행 (이벤트 전송 무시) |
| 리뷰어 에이전트 타임아웃 | 나머지 리뷰어 결과만으로 진행, 리포트에 표기 |
| Codex CLI 실패/타임아웃 | 1차 리포트만으로 판정, "2차 검토 미실행" 표기 |
| 모든 리뷰어 실패 | 사용자에게 수동 리뷰 요청 |
| JSON 파싱 실패 | 해당 리뷰어 결과를 텍스트로 포함, 파싱 실패 표기 |
| 리뷰 대상 파일 없음 | 사용자에게 대상 확인 요청 |

---

## Few-shot 예제

### 예제 1: 보안 이슈가 있는 코드

입력:
```javascript
app.get('/user/:id', (req, res) => {
  const query = `SELECT * FROM users WHERE id = ${req.params.id}`;
  db.query(query, (err, result) => res.json(result));
});
```

예상 결과:
```json
[
  {"severity": "CRITICAL", "file": "app.js", "line": 2, "message": "SQL 인젝션 취약점: req.params.id가 쿼리에 직접 삽입됨", "persona": "security"},
  {"severity": "WARNING", "file": "app.js", "line": 3, "message": "에러 처리 누락: db.query 에러 시 err을 무시하고 result를 반환", "persona": "saboteur"}
]
```

### 예제 2: 가독성 이슈가 있는 코드

입력:
```python
def p(d, k, v=None):
    if k in d:
        if isinstance(d[k], list):
            for i in d[k]:
                if i.get('s') == 1:
                    return i.get('v', v)
    return v
```

예상 결과:
```json
[
  {"severity": "WARNING", "file": "utils.py", "line": 1, "message": "함수명 'p'와 매개변수 'd,k,v'가 무엇을 의미하는지 알 수 없음", "persona": "readability"},
  {"severity": "NOTE", "file": "utils.py", "line": 4, "message": "매직 값 's'==1의 의미가 불명확. 상수로 추출 필요", "persona": "readability"}
]
```
