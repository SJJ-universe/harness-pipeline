---
name: universal-task-pipeline
description: "신규 기능 구현·버그 수정·리팩토링·테스트 추가·문서 작성 등 모든 유형의 코딩 태스크를 Phase 기반으로 실행할 때 반드시 사용할 것. 사용자가 '작업해줘', '구현해줘', '만들어줘', '고쳐줘', '다시 실행', '재실행', '보완', '이전 결과 개선', '업데이트' 같은 표현으로 일반 코딩 작업이나 중단된 작업 재개를 요청하면 즉시 기동한다. 순수 리뷰 전용이라면 code-review-pipeline을 사용하라."
---

# Universal Task Pipeline

범용 태스크 파이프라인 — 어떤 코딩 작업이든 구조화된 Phase로 실행합니다.

## When to Use
- 복잡한 코딩 작업을 체계적으로 수행할 때
- Claude + Codex 이중 AI 순환 계획 검토가 필요할 때
- 작업 결과를 자동으로 검증하고 다음 작업을 추천받을 때
- 프로젝트 컨텍스트를 자동으로 수집하여 정밀한 계획을 세울 때

## Pipeline Phases

### Phase A: 컨텍스트 수집
프로젝트의 CLAUDE.md, ARCHITECTURE.md, 기술 스택을 자동으로 분석합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"A","status":"active"}}' \
  2>/dev/null || true
```

1. 프로젝트 루트에서 가이드 문서 자동 발견
2. package.json 등에서 기술 스택 추론
3. 관련 스킬 자동 로드

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"A","status":"completed"}}' \
  2>/dev/null || true
```

### Phase B: 계획 수립 (Claude Code)
수집된 컨텍스트와 스킬 가이드라인을 기반으로 정밀한 실행 계획을 수립합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"B","status":"active"}}' \
  2>/dev/null || true
```

계획에는 반드시 포함:
- 구체적인 변경 대상 파일과 변경 내용
- 단계별 실행 순서
- 위험 요소 및 완화 방안
- 검증 기준 체크리스트

### Phase C: 계획 검토 (Codex CLI) — 순환 (최대 3회)
Codex CLI가 독립적인 관점에서 계획의 빈틈을 비평합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"C","status":"active"}}' \
  2>/dev/null || true
```

```bash
npx @openai/codex exec --full-auto --skip-git-repo-check \
  "Review this plan for: 1) Missing edge cases 2) Security issues 3) Performance risks. Plan: [계획 요약]. Give specific, actionable feedback in under 100 words." \
  2>/dev/null || true
```

피드백이 있으면 Phase D(계획 보완)로 순환, 수렴하면 Phase E로 진행.

### Phase D: 계획 보완 (Claude Code) — 순환
Codex의 피드백을 반영하여 계획을 개선합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"node_update","data":{"node":"plan-refiner","status":"active"}}' \
  2>/dev/null || true
```

순환 카운터 업데이트:
```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"cycle_update","data":{"iteration":1,"maxIterations":3}}' \
  2>/dev/null || true
```

### Phase E: 실행
확정된 계획에 따라 코드를 작성/수정합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"E","status":"active"}}' \
  2>/dev/null || true
```

### Phase F: 검증
변경 사항을 검증합니다 — 구문 검사, 테스트 실행, 린트 확인.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"phase_update","data":{"phase":"F","status":"active"}}' \
  2>/dev/null || true
```

검증 완료 후 verdict 전송:
```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"verdict","data":{"verdict":"PASS","stats":{"checks":3,"passed":3,"failed":0}}}' \
  2>/dev/null || true
```

### 하네스 완료 → 다음 추천
작업이 끝나면 대시보드가 다음 적합한 하네스를 자동으로 추천합니다.

```bash
curl -s -X POST http://localhost:4200/api/event \
  -H "Content-Type: application/json" \
  -d '{"type":"harness_complete","data":{"harnessId":"implementation","summary":"구현 완료"}}' \
  2>/dev/null || true
```

## Available Harness Types
- **planning**: 작업 범위 정의 및 구현 계획 수립
- **implementation**: 계획에 따른 코드 작성
- **code-review**: 다중 관점 코드 리뷰
- **testing**: 테스트 작성 및 커버리지 개선
- **debugging**: 버그 분석 및 수정
- **refactoring**: 코드 품질 개선
- **deployment**: CI/CD 및 배포 설정

## Dashboard
대시보드: http://localhost:4200
- 왼쪽: 파이프라인 시각화 (Phase 진행 상황)
- 오른쪽 상단: 실제 토큰 사용량 + 예상 비용
- 오른쪽 하단: 터미널 (Claude Code 자동 실행)
