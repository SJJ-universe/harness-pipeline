# SJ 하네스 엔진 — Claude Code 작업 규칙

이 프로젝트에는 **하네스(Harness)** 시스템이 활성화되어 있습니다.
모든 작업은 Phase 순서를 따라야 하며, 각 Phase에서 허용된 도구만 사용할 수 있습니다.

## Phase 시스템

작업은 자동으로 감지되어 Phase A부터 시작됩니다.
각 Phase의 완료 조건을 충족한 후 **턴을 종료**하면 다음 Phase로 자동 진행됩니다.

### 코드 리뷰 파이프라인

| Phase | 목적 | 허용 도구 | 완료 조건 |
|-------|------|----------|----------|
| **A: 공동 플래닝** | 코드 탐색, 구조 파악 | Read, Glob, Grep, Agent, TodoWrite | 최소 2번 탐색 |
| **B: 구현** | 코드 작성/수정 | Read, Edit, Write, Bash, Glob, Grep | 파일 1개 이상 수정 |
| **C: 리뷰 순환** | Codex 비평 (자동) | — (Codex가 자동 실행) | 비평 수신 |
| **D: 디버그 & 수정** | 비평 반영 수정 | Read, Edit, Write, Bash | 파일 1개 이상 수정 |

### 범용 태스크 파이프라인

| Phase | 목적 | 허용 도구 | 완료 조건 |
|-------|------|----------|----------|
| **A: 컨텍스트 수집** | 프로젝트 분석 | Read, Glob, Grep, Agent, TodoWrite | 최소 3번 탐색 |
| **B: 계획 수립** | plan.md 작성 | Read, Glob, Grep, TodoWrite, Write | plan*.md 작성 (Edit 불가 — Write로 작성/덮어쓰기) |
| **C: 계획 검토** | Codex 비평 (자동) | — | 비평 수신 |
| **D: 계획 보완** | 비평 반영 | Read, Edit, Write | plan*.md 수정 |
| **E: 실행** | 작업 실행 | Read, Edit, Write, Bash, Glob, Grep, TodoWrite | 파일 수정 |
| **F: 검증** | 테스트/확인 | Read, Bash, Grep | Bash 실행 + 이슈 해결 |

## 중요 규칙

1. **Phase A에서는 Read/Glob/Grep만 사용하세요** — Write, Edit, Bash는 이후 Phase에서 사용합니다
2. **턴 종료 = Phase 전환** — 완료 조건을 충족하고 턴을 종료하면 자동으로 다음 Phase로 넘어갑니다
3. **도구가 차단되면** 현재 Phase에서 허용된 도구를 확인하고 그것만 사용하세요
4. **Codex 비평 후** Phase D에서 비평 파일을 Read로 읽고 반영하세요

## 스킬 워크스페이스

73개 커뮤니티 스킬이 설치되어 있습니다:
- Superpowers (14): brainstorming, writing-plans, TDD, debugging 등
- Engineering (20): agent-designer, database, docker, CI/CD 등
- Toolkit (23): python, react, nextjs, typescript, security 등
