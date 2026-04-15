# Pipeline Dashboard

Dual AI (Claude Code + Codex CLI) 하네스의 실시간 시각화 · 제어 대시보드.
Claude가 코드를 생성하면 Codex가 비평하고, 하네스가 그 루프를 Phase 단위로
관리합니다. 이 리포지토리는 **하네스 엔진 + 웹 UI + 온디맨드 Codex 트리거**로
구성됩니다.

---

## Quick start

```bash
# 1) Claude Code lifecycle hooks 설치 (.claude/settings.json 생성·병합)
npm run setup

# 2) 대시보드 서버 실행 (기본 http://127.0.0.1:4200)
npm start

# 3) 유닛 테스트 / 라이브 검증
npm test
npm run test:live
```

`npm run setup`은 기존 `.claude/settings.json`을 클로버하지 않고 harness 훅만
추가합니다. `--dry-run`으로 미리 확인할 수 있습니다:

```bash
node scripts/setup-harness.js --target C:/path/to/workspace --dry-run
```

---

## 문서 맵 — 어느 문서를 읽어야 하는가

세 문서는 서로 다른 독자를 대상으로 합니다. 상단의 `Audience:` 헤더로 빠르게
판별할 수 있습니다.

| 문서 | 독자 | 목적 |
|---|---|---|
| [`HARNESS-ENGINEERING-GUIDE.md`](./HARNESS-ENGINEERING-GUIDE.md) | 신규 기여자 · 개념을 처음 접하는 사람 | 하네스 엔지니어링이란 무엇이고 왜 필요한가 — 이론 · 레벨 · 일반론 |
| [`HARNESS-GUIDE.md`](./HARNESS-GUIDE.md) | 대시보드를 **실제로 돌리는** 사용자 | 설치 · 실행 · 트리거 사용법 · 커스터마이징 · 파일 레퍼런스 |
| [`HARNESS-DESIGN.md`](./HARNESS-DESIGN.md) | 하네스 내부를 **수정하는** 엔지니어 | Phase 1–4 구현 설계 · 상태 모델 · 이벤트 프로토콜 |

순서대로 읽을 필요는 없습니다. 기능 하나만 고치고 싶다면 GUIDE → DESIGN만
봐도 충분하고, 하네스가 왜 존재하는지 이해하고 싶다면 ENGINEERING-GUIDE로
시작하세요.

---

## 주요 환경 변수

`.env.example` 참고. 기본값이면 그대로 동작합니다.

| 변수 | 기본 | 의미 |
|---|---|---|
| `HARNESS_PORT` | `4200` | 대시보드 HTTP/WebSocket 포트 |
| `HARNESS_HOST` | `127.0.0.1` | 바인드 호스트 (외부 노출 금지 기본값) |
| `HARNESS_TOKEN` | — | 설정 시 비(非)루프백 요청에 `X-Harness-Token` 필수 |
| `HARNESS_WATCHER_MODE` | `auto` | `auto` · `hook` · `watcher` · `off` — 파이프라인 감지 모드 (상세는 `.env.example`) |

---

## 주요 디렉터리

```
pipeline-dashboard/
├── server.js                  # Express + WebSocket 진입점
├── session-watcher.js         # Claude Code 세션 JSONL tail + auto pipeline
├── codex-triggers.js          # 온디맨드 Codex 트리거 정의
├── executor/
│   ├── claude-runner.js       # claude CLI 호출 (stdin 기반 prompt)
│   ├── codex-runner.js        # codex CLI 호출 + stdout/stderr 스트림
│   ├── child-registry.js      # 생성된 자식 프로세스 통합 관리
│   ├── hook-router.js         # Claude Code 훅 이벤트 라우팅
│   └── __*-test.js            # 유닛 테스트 (P0/P1/P2 시리즈)
├── hooks/
│   └── harness-hook.js        # Claude Code 훅 브릿지 (setup-harness가 연결)
├── public/                    # 프론트엔드 (index.html / app.js / style.css)
├── scripts/
│   ├── setup-harness.js       # npm run setup — .claude/settings.json 병합
│   ├── run-unit-tests.js      # npm test — executor/__*-test.js 디스커버
│   └── run-live-verify.js     # npm run test:live — 라이브 대시보드 검증
└── _workspace/                # Codex 트리거 결과물 (git ignored)
```

### `_workspace/`

Codex 트리거를 실행하면 결과가 `../_workspace/codex-trigger-{id}-{ts}.md`에
저장됩니다. 대시보드 UI의 "Codex 콘솔"에서 실시간 진행을 볼 수 있고, 완료
후에는 이 경로의 파일에서 전체 findings / summary / raw stdout을 확인할
수 있습니다.

---

## 테스트

| 명령 | 대상 | 비고 |
|---|---|---|
| `npm test` | `executor/__*-test.js` 전체 유닛 스위트 | 서버 없이 실행 가능 |
| `npm run test:live` | `executor/__*-live-verify.js` | **대시보드가 떠 있어야 함** (`npm start`) |
| `TEST_FILTER=p1-6 npm test` | 특정 테스트만 | 파일명 부분 일치 |

유닛 테스트는 커밋 전 필수, 라이브 검증은 서버/WS 핫패스를 수정했을 때만
필요합니다.
