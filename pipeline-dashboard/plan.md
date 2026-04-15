# Plan rev2: Step 0 검증 + Phase 3 (P0) 하네스 튜닝

작성일: 2026-04-15
작성자: Claude (Codex rev1 비평 13개 항목 전면 반영)
**리포 루트**: `C:/Users/SJ/workspace` (= `SJJ-universe/harness-pipeline` 루트)
**작업 브랜치**: `tuning/step0-phase3` (rev2부터 `master` 직접 push 중단)
**HEAD(rev2 시작 시점)**: `d5a08e6`
**현재 HEAD (2026-04-15)**: `e9eb6be` — rev2 전체 배치 + P0~P2 하드닝 완료, `master`로 FF merge 대기 중

---

## 진행 상태 요약 (2026-04-15 업데이트)

rev2 범위 T0~T9는 **전부 완료**되었고, 그 위에 세 단계 하드닝 배치(P0/P1/P2)가 추가로 얹혔습니다. 아래는 현재 브랜치(`tuning/step0-phase3`)의 커밋 이력 순서입니다.

### ✅ 완료 — rev2 본 배치 (T-시리즈)

| SHA | 커밋 | 내용 |
|---|---|---|
| `fbfd7df` | `feat(T0)` | `/api/version` endpoint — 파일 HEAD와 런타임 프로세스 일치 검증 |
| `720e5c9` | `chore(T2.0)` | hook payload dumper — context_usage 필드 부재 확정, transcript_path 기반 추정 확정 |
| `0270a1b` | `feat(T1)` | 8개 에이전트 모델 라우팅 (haiku/sonnet/opus) |
| `1deebe8` | `feat(T3)` | universal/code-review skill description 재작성, smoke 라우팅 검증 |
| `214b863` | `feat(T2)` | 컨텍스트 사용량 배너 40%/55% — Stop 훅 block 없음 |
| `b869b6c` | `feat(T9)` | tool-scoped danger gate (정규식→tool 분기, `.claude` 자해 제거) |
| `57f183f` | `test` | bec58ce 드리프트로 깨진 phase2 테스트 업데이트 |
| `7b09284` | `docs` | Step 0 + Phase 3 P0 완료 보고서 (`TUNING-STEP0-PHASE3.md`) |

### ✅ 완료 — P0 보안 baseline (rev2 후속 하드닝)

| SHA | 커밋 | 내용 |
|---|---|---|
| `fd29e16` | `feat(P0-1)` | 서버 권한 경계 — loopback bind + HARNESS_TOKEN middleware + WS origin 검증 |
| `b34587f` | `feat(P0-2)` | 파일 접근 샌드박스 — context/load + skills 경로에 `path-guard` 적용 |
| `029ba01` | `feat(P0-3)` | CLI runner 하드닝 + 통합 child registry (graceful shutdown 리핑) |

### ✅ 완료 — P1 안정성 (rev2 후속 하드닝)

| SHA | 커밋 | 내용 |
|---|---|---|
| `ff3bb8d` | `feat(P1-2)` | `npm test` 진입점 + unit/live 러너 분리 |
| `c211c9e` | `feat(P1-3)` | `HARNESS_WATCHER_MODE` + SessionWatcher broadcast gate |
| `6404648` | `feat(P1-4)` | UI XSS 방어 — DOM API + 공용 sanitizer (`public/ui-sanitize.js`) |
| `e24a83c` | `feat(P1-5)` | Node 24 DEP0190 제거 — `cmd.exe /c` wrapper, `shell:false` |
| `8c1a91a` | `feat(P1-6)` | Codex 트리거 per-trigger timeout + 실시간 stdout/stderr 콘솔 |

### ✅ 완료 — P2 구조 정리

| SHA | 커밋 | 내용 |
|---|---|---|
| `cad7b53` | `feat(P2-1)` | 하네스 온보딩 — `scripts/setup-harness.js` + `npm run setup` |
| `14e95b5` | `feat(P2-2)` | 문서 분리 — README 엔트리 + HARNESS-*.md 3개에 Audience 헤더 |
| `e9eb6be` | `feat(P2-3)` | `server.js` 리팩터 — `executor/general-pipeline.js` + `routes/codex-triggers.js` 추출 (906 → 516줄) |

### 🎯 다음 — FF merge 대기

`tuning/step0-phase3`는 `origin/master`의 fast-forward 후손이므로 충돌 없이 병합 가능. **사용자 명시 승인 후에만 실행** (rev2 C2 안전 규칙: master 직접 push 금지 + PR 없어도 승인 필요).

```bash
git checkout master
git merge --ff-only tuning/step0-phase3
git push origin master
```

---

## P3 백로그 (rev2 스코프 **밖** — 후속 배치 후보)

아래 8개는 rev2 작업 과정에서 드러난 gap, TUNING-STEP0-PHASE3.md에 명시된 deferred 항목, 그리고 하드닝을 한 번 더 태우면 보일 잔여 리스크입니다. 우선순위 라벨은 가변적입니다.

| ID | 항목 | 근거 |
|---|---|---|
| **P3-1** | End-to-end Step 0 세션 (S1~S7) | TUNING-STEP0-PHASE3.md 명시적 deferred — 이 세션의 executor가 self-conflict 회피로 꺼져 있어 fresh Claude Code 세션 필요. 유닛/라이브 테스트로는 커버되지 않는 실제 Phase C Codex 경로 포함 |
| **P3-2** | GitHub Actions CI 워크플로 | `.github/workflows/` 부재. 현재 모든 회귀 검증이 수동 — master에 깨진 코드가 도달할 안전장치 없음. 매트릭스 Node 20/22/24로 P1-5 류 deprecation 조기 감지 |
| **P3-3** | `_workspace/` retention 정책 | `codex-trigger-*.md`가 무제한 누적 (이미 9개). 유지 개수 상한 또는 TTL cleanup + 실패 덤프(`step0-failure-*.md`) 보존 정책 결정 |
| **P3-4** | Danger gate shell-lex 파싱 | TUNING 문서의 known tradeoff — 커밋 메시지 본문에 `rm -rf` 같은 패턴을 문자 그대로 쓰면 게이트 트립. 정규식 대신 shell-lex로 argv 토큰만 매칭. T9 커밋 시도 때 실제로 발생한 문제 |
| **P3-5** | Playwright 브라우저 smoke 테스트 | `public/app.js` 1397줄 중 DOM/WS/console 렌더링 경로가 자동 브라우저 테스트 없음. `npm run test:browser` 추가 — 트리거 카드 렌더, 코덱스 콘솔 started/chunk/done, 콘솔 에러 부재 |
| **P3-6** | 구조적 서버 로깅 + 회전 | plan.md 실패 덤프 스키마가 `logs/server.log`를 가정했는데 실제로는 `console.log`만 사용. pino 또는 rolling file writer, INFO/WARN/ERROR, 일일 회전, 7일 보존 |
| **P3-7** | HARNESS_TOKEN 회전 + 시크릿 위생 | 단일 정적 토큰, 누출 시 revocation 경로 없음. `scripts/rotate-token.js` + `HARNESS_TOKEN_PREVIOUS` 유예 슬롯 + HARNESS-GUIDE 플레이북 + 로그/에러에 토큰 에코 여부 감사 |
| **P3-8** | `public/app.js` 모듈화 | 1397줄 단일 파일 (WS/렌더/라우팅/sanitize 전부 혼재). `public/app/*.mjs`로 분리, `<script type="module">` 로드, bundler 없음. P2-3 서버 리팩터의 프론트엔드 미러 |

---

## 원본 rev2 목표

1. **Step 0**: 최근 7개 커밋(FIX-1~3 ~ Codex 트리거)이 런타임 프로세스에 실제로 로드되어 동작하는지 결정론적으로 검증
2. **Phase 3 P0**: 통과 시 T1(모델 라우팅) + T3(skill description) + T2(컨텍스트 알람) + T9(danger gate)를 순차 진행

---

## 작업 브랜치 & 세이프티 규칙 (rev2 신설 — 비평 C2 대응)

```
git fetch origin
git checkout -b tuning/step0-phase3 origin/master
```

각 T 태스크 실행 흐름:
1. `git status` → clean 확인 (clean 아니면 중단)
2. 시작 SHA 기록: `ROLLBACK_SHA=$(git rev-parse HEAD)` → 커밋 메시지 footer에 기록
3. 코드 편집 → 로컬 테스트 → `git diff` self-review
4. commit → `git push origin tuning/step0-phase3`
5. 로컬 회귀 확인(restart + /api/version) 완료 후에만 다음 태스크로
6. 전체 4개 태스크 끝나면 사용자에게 FF merge 여부 확인 → 승인 시 master로 FF merge

**master 직접 push 금지**. PR 없어도 브랜치는 반드시 분리.

---

## T0: Runtime Proof Endpoint (rev2 신설 — 비평 H2 대응)

파일 HEAD와 실제 서버 프로세스가 일치하는지 결정론적으로 확인하기 위해 `/api/version` 신설.

**작업** (`pipeline-dashboard/server.js`):
```js
const SERVER_STARTED_AT = new Date().toISOString();
const SERVER_PID = process.pid;
let SERVER_COMMIT_SHA = "unknown";
try {
  SERVER_COMMIT_SHA = require("child_process")
    .execSync("git rev-parse HEAD", { cwd: path.resolve(__dirname, "..") })
    .toString().trim();
} catch (e) {}

app.get("/api/version", (req, res) => {
  res.json({
    commitSha: SERVER_COMMIT_SHA,
    startedAt: SERVER_STARTED_AT,
    pid: SERVER_PID,
    node: process.version,
  });
});
```

**Verification**:
- V-T0-1: `curl http://127.0.0.1:4200/api/version` → `commitSha`가 `git rev-parse HEAD`와 일치
- V-T0-2: 대시보드 재시작 후 `startedAt`이 갱신됨
- V-T0-3: `pid`가 `ps` 출력의 node 프로세스와 일치

**커밋**: `feat(T0): /api/version endpoint for runtime proof`

---

## T2.0: Hook Payload Sample Collection ✅ COMPLETED

**Status**: DONE (commit `720e5c9`). 30+ 샘플 수집 및 분석 완료.

**확인된 Claude Code hook payload 필드**:

| Event | 공통 필드 | 고유 필드 |
|---|---|---|
| UserPromptSubmit | session_id, transcript_path, cwd, permission_mode, hook_event_name | `prompt` |
| PreToolUse | 위 + | `tool_name`, `tool_input`, `tool_use_id` |
| PostToolUse | 위 + | `tool_name`, `tool_input`, `tool_response`, `tool_use_id` |
| Stop | 위 + | `stop_hook_active`, `last_assistant_message` |

**결론 (Codex H4 확정)**:
- **`context_usage` 필드는 어떤 payload에도 없다**. 토큰 카운트·context_window 관련 필드도 없음
- 그러나 **`transcript_path` 필드가 모든 event에 있다** — 이것이 T2 fallback의 실질 경로
- 세션 jsonl 파일 크기로 현재 컨텍스트 사용량을 추정할 수 있음

**T2 확정 추정 함수**:
```js
// server.js 또는 전용 모듈
const fs = require("fs");
const CONTEXT_LIMIT_TOKENS = 200_000; // Sonnet/Opus 기본

function estimateContextUsage(transcriptPath) {
  try {
    const bytes = fs.statSync(transcriptPath).size;
    // Rough: 4 bytes/token (영문 코드 기준; 한글은 더 빡빡하지만
    // 알람 임계 40%/55% 용도로는 충분히 보수적)
    const tokensApprox = Math.round(bytes / 4);
    return Math.min(tokensApprox / CONTEXT_LIMIT_TOKENS, 1.0);
  } catch (_) {
    return 0;
  }
}
```

T2 구현 시 이 함수를 `server.js /api/hook` 핸들러에서 payload.transcript_path로 호출하고 state에 기록.

---

## 사전 상태 확인 (Baseline Verify, rev2)

| 체크 | 명령/동작 | 기대 결과 |
|---|---|---|
| B0 | `curl http://127.0.0.1:4200/api/version` | `commitSha`가 `git rev-parse HEAD`와 정확히 일치 |
| B1 | `curl http://127.0.0.1:4200/api/codex/triggers` | JSON 배열 4개 (plan-verify, code-review, debug-analysis, security-review) |
| B2 | 브라우저 터미널 탭 하단 "Codex 트리거" 패널 4장 카드 DOM 존재 | `document.querySelectorAll("#trigger-cards .recommend-card").length === 4` (브라우저 콘솔에서 확인) |
| B3 | `git rev-parse HEAD` (루트=`C:/Users/SJ/workspace`) | T0 커밋 이후 SHA (예: `<T0-SHA>`) |
| B4 | Ctrl+V로 여러 줄 텍스트 붙여넣기 | 한 번만 입력됨 (비평 L1: "다행" 오타 수정) |

B0~B4 전부 pass여야 Step 0 세션 진행.

---

## Step 0 결정론적 검증 세션 (rev2 — 비평 H3/M5/M6 대응)

**원칙**: 모델 변덕에 의존하지 않는다. 각 세션은 사용자 프롬프트로 하네스를 자극하되 **검증은 하네스 내부 broadcast 이벤트와 파일 시스템 상태**로 판정한다.

### 세션 프롬프트 (명시적 자극)

> "Read, Glob, Grep 툴을 각각 1번씩 호출하여 pipeline-dashboard/server.js 파일을 찾아 상단 30줄을 보고하라. 그 후 Bash로 `git status`를 한 번 실행하라. 이후 코드 변경 없이 계획만 수립하고 종료하라."

이 프롬프트는 Phase A에서 **Read/Glob/Grep/Bash 각 1회** 호출을 명시하므로 행동 재현성이 있다.

### 체크리스트

| # | 확인 항목 | 판정 방식 | 통과 조건 | 실패 시 timeout |
|---|---|---|---|---|
| S1 | Phase A Edit 차단 (인공 이벤트) | `curl -X POST /api/hook -d '{"event":"PreToolUse","tool_name":"Edit",...}'` | 응답 `decision:"block"` + reason에 "Phase A" | 10s |
| S2 | Phase A Bash 허용 (신규 튜닝) | 위 프롬프트 실행 → broadcast `tool_call` 중 `tool:"Bash"` 존재 + 차단 이벤트 없음 | broadcast 로그에 Bash 1회, tool_blocked 0회 | 60s |
| S3 | Phase A→B 전환 (count=2) | 세션 중 broadcast `phase_enter` with `phase:"B"` | phaseIdx 증가 + broadcast 수신 | 90s |
| S4 | Phase B plan.md Write → artifact 캡처 | `_workspace/plan*.md` 존재 + broadcast `artifact_captured` | 파일 존재 AND broadcast 1회 | 120s |
| S5 | Phase C Codex 호출 | broadcast `codex_started` → `codex_critique_ready` | 두 이벤트 모두 수신 | **120s** (rev2: 29s 고정 제거) |
| S6 | `_workspace/C_codex_critique_iter1.md` 실파일 | `test -f` + 최소 크기 500바이트 + `## Summary` `## Findings` 모두 포함 | grep으로 두 헤더 확인 | — |
| S7 | Phase D→E→F + 최종 verdict | `_workspace/F_final_verdict.md` 존재 + verdict 필드 | verdict ∈ {CLEAN, CONCERNS} **AND** critical count=0 (high는 기록만) | — |

**전체 세션 timeout**: 10분. 초과 시 하네스 세션 강제 종료 + S?-timeout 기록.

### 실패 덤프 스키마 (rev2 — 비평 M7)

`_workspace/step0-failure-{phase}.md`는 다음 6개 섹션을 반드시 포함:
1. **commit SHA**: `git rev-parse HEAD`
2. **PID / started at**: `/api/version` 응답
3. **Last hook payload**: 직전 10개 hook 이벤트 원본 JSON
4. **Server log tail**: `pipeline-dashboard/logs/server.log` 마지막 50줄 (없으면 stdout 캡처)
5. **Broadcast events**: 마지막 20개 broadcast 이벤트
6. **Phase state**: `state.phaseIdx`, `state.phaseToolCount`, `state.artifacts`

---

## Phase 3 P0 작업 (Step 0 통과 시)

### T1. 에이전트 모델 라우팅 (비평 M2/M3 대응)

**선행 확인 (rev2 신설)**:
- T1.0: 기존 `.claude/agents/*.md`에 `model:` 필드를 쓰는 파일이 있는지 grep → 있으면 포맷 참고
- T1.1: Claude Code 공식 문서에서 agent frontmatter `model:` 허용값 확인 (WebFetch). 확인 불가 시 `model:` 대신 `description:`에 "간단한 조회 전용" 같은 힌트 추가로 fallback

**작업** (허용 시):

| 에이전트 | 추가 라인 | 근거 |
|---|---|---|
| context-analyzer.md | `model: haiku` | 결정론적 디스커버리 |
| task-validator.md | `model: haiku` | 테스트 결과 파싱 |
| readability-reviewer.md | `model: haiku` | 패턴 체크 |
| review-synthesizer.md | `model: sonnet` | findings 병합·집계(기계적) |
| security-auditor.md | `model: sonnet` | OWASP 패턴 스캔 |
| task-planner.md | `model: opus` | 복잡한 작업 분해·계획 수립 |
| saboteur-reviewer.md | `model: opus` | 창의적 공격 시나리오 상상 |
| review-orchestrator.md | `model: opus` | 최종 조율·판정 |
| plan-critic.md | — | Codex CLI 전용 |

**Verification (rev2 — 비평 M3 Windows 호환)**:
- V-T1-1: Node 스크립트로 검증 — `node -e "const fs=require('fs'); const files=require('glob').sync('.claude/agents/*.md'); let ok=0; for (const f of files) { const m=fs.readFileSync(f,'utf8').match(/^---\n([\s\S]*?)\n---/); if (m && /^model:\s*(haiku|sonnet|opus)/m.test(m[1])) ok++; } console.log(ok);"` → `8`
- V-T1-2: 각 파일 frontmatter `---` 앞뒤 유지, YAML 파싱 통과 (`js-yaml`로 파싱)
- V-T1-3: **런타임 라우팅 검증** — `subagent_type:"context-analyzer"`로 Agent 툴을 실제 호출하고 응답 metadata에 모델이 찍히는지 확인. 찍히지 않으면 "보류" 커밋이 아니라 **T1 전체 revert** (M2 대응: "TODO 남김"으로 통과시키지 않음)

**커밋**: `feat(T1): model routing for 8 agents` + footer `Rollback: <ROLLBACK_SHA>`

---

### T3. Skill description 재작성 (비평 M4 대응)

**작업**: 2개 SKILL.md description 재작성 — 구체 트리거 + 후속 키워드 + 구분.

**대상**:
- `.claude/skills/universal-task-pipeline/SKILL.md`
- `.claude/skills/code-review-pipeline/SKILL.md`

**Verification (rev2 — 표면 조건 + 실제 라우팅)**:
- V-T3-1: 각 description 길이 100~500자 (과도 방지)
- V-T3-2: 키워드 3개 모두 포함: "재실행", "보완", 명확한 구분 문구
- V-T3-3: 두 description이 공유하는 동일 문구 30자 이상 없음 (중복 방지)
- V-T3-4: **라우팅 smoke test** — 다음 3개 프롬프트 각각 실행 후 어떤 skill이 활성화되는지 관찰
  - A. "이 코드 리뷰해줘" → code-review-pipeline 활성
  - B. "이 작업 다시 실행해줘" → universal-task-pipeline 활성
  - C. "로그인 기능 만들어줘" → universal-task-pipeline 활성
  - 결과가 기대와 다르면 description 재조정, 커밋 보류

**과도 사용 방지**: "반드시" 문구는 최대 2회/파일 제한.

**커밋**: `feat(T3): skill descriptions with differentiated triggers`

---

### T2. 컨텍스트 알람 (비평 H4/H5 대응 — 대폭 수정)

**전제**: T2.0 완료. `context_usage` 필드는 **부재** 확정 — `transcript_path` 기반 파일 크기 추정으로 대체.

**작업**:
1. `server.js` (또는 별도 모듈)에 T2.0에서 확정한 `estimateContextUsage(transcriptPath)` 함수 구현
2. `/api/hook` 핸들러에서 payload.transcript_path로 호출 → `state.contextUsage` 저장
3. 40% 초과 시 broadcast `context_alarm` (상태 플래그로 세션당 1회만)
4. 55% 초과 시 두 번째 broadcast `context_alarm` with severity "warn"
5. `public/app.js` 상단 배너 UI — 40% 노란 배너, 55% 빨간 배너 + `/compact` 권고 안내(버튼 아님)
6. **Stop 훅에서 block 금지 (비평 H5)**. `decision: block`을 던지지 않음. 알람은 broadcast만
7. 세션당 알람 중복 억제 — `state.contextAlarmSent = { at40: false, at55: false }`

**Verification**:
- V-T2-1: 가짜 payload POST (`context_usage: 0.42`) → 서버 로그에 `context_alarm` broadcast 1회
- V-T2-2: 동일 payload 재전송 → `at40: true`이므로 broadcast 없음 (중복 억제)
- V-T2-3: `context_usage: 0.58` → 두 번째 broadcast (55% 임계)
- V-T2-4: Stop 이벤트에 `context_usage: 0.90` 포함 → 응답이 `{continue: true}` 또는 decision 없음 (block 아님)
- V-T2-5: 브라우저에서 배너 색상 변경 (DOM selector로 자동 assert)

**Failing test first (rev2 — 비평 M8)**: `pipeline-dashboard/executor/__t2-context-test.js` 먼저 작성. 모든 V-T2-* 케이스가 실패 상태에서 시작하도록.

**커밋**: `feat(T2): context usage banner at 40%/55% (no stop block)`

---

### T9. Danger Gate (비평 C1/H6/M1 대응 — 대폭 수정)

**자해 패턴 제거**: `.claude[\\/]/` **삭제**. 이후 T1/T3 같은 정상 튜닝 작업을 막지 않음.

**Tool-scoped 구조적 판정 (정규식 문자열 매칭 탈피)**:
```js
// pipeline-dashboard/executor/danger-gate.js (신규, 공용 모듈)
function isDangerous(tool, input) {
  if (tool === "Bash") {
    const cmd = input.command || "";
    if (/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\b/.test(cmd)) return "rm -rf";
    if (/\bgit\s+push\s+.*(--force|--force-with-lease|-f\b)/.test(cmd)) return "force push";
    if (/\bgit\s+reset\s+--hard\b/.test(cmd)) return "git reset --hard";
    if (/\bRemove-Item\b.*-Recurse/i.test(cmd)) return "Remove-Item -Recurse";
    return null;
  }
  if (tool === "Write" || tool === "Edit") {
    const fp = (input.file_path || "").toLowerCase();
    if (/\.env(\.|$)/.test(fp)) return ".env write";
    if (/credentials\.json$/.test(fp)) return "credentials write";
    // .claude 수정은 허용 (하네스 자체 튜닝)
    return null;
  }
  return null;
}
module.exports = { isDangerous };
```

**단일 게이트, 이중 진입점 (비평 H6)**:
- `pipeline-executor.js onPreTool` → `isDangerous` 호출
- `server.js /api/hook` PreToolUse 경로 → **같은** `isDangerous` 호출
- 두 경로 모두 차단 이벤트 `dangers_blocked` broadcast

**Verification**:
- V-T9-0 **Failing test first**: `pipeline-dashboard/executor/__danger-gate-test.js` — 모든 케이스가 구현 전 실패
- V-T9-1 positive: `rm -rf /`, `rm -fr tmp`, `git push --force-with-lease`, `git reset --hard HEAD`, `Remove-Item -Recurse .`, `Write .env`, `Edit credentials.json` → 모두 block 반환
- V-T9-2 negative: `git reset HEAD~1`, `git status`, `rm file.tmp` (단일 파일, 재귀 아님), `Edit .claude/agents/foo.md`, `Read .env` → 모두 통과
- V-T9-3 실제 `/api/hook`으로 `git reset --hard` PreToolUse 주입 → block
- V-T9-4 실제 executor.onPreTool 시뮬레이션 → block

**커밋**: `feat(T9): tool-scoped danger gate (no .claude self-block)`

---

## 타임라인 (rev2 — restart 단계 포함)

```
[브랜치 생성]   git checkout -b tuning/step0-phase3
[T0]          /api/version 추가 → restart → V-T0 → commit/push
[T2.0]         payload dumper → restart → 수동 세션 1회로 샘플 수집 → 분석 → commit/push

[Baseline]     B0 B1 B2 B3 B4 (모두 pass 확인)

[사용자 하네스 ON]
[Step 0]       S1(인공 이벤트) → S2~S7 (10분 timeout)
               실패 시 step0-failure-{phase}.md 덤프 → Phase 3 보류

[T1]          skill schema 선행 확인 → 편집 → V-T1-1~3 → commit/push → [restart → /api/version 확인]
[T3]          편집 → V-T3-1~4 (라우팅 smoke test 포함) → commit/push → [restart → /api/version]
[T2]          failing test 작성 → 구현 → V-T2-1~5 → commit/push → [restart → /api/version]
[T9]          failing test 작성 → danger-gate.js + 두 진입점 → V-T9-0~4 → commit/push → [restart → /api/version]

[최종]         Step 0 세션 재실행 → 회귀 없음 확인
[Merge 승인]   사용자 확인 후 master로 FF merge + push
```

---

## 변경 파일 (rev2 예상)

| 파일 | 태스크 | 성격 |
|---|---|---|
| `pipeline-dashboard/plan.md` | rev2 | 전면 재작성 |
| `pipeline-dashboard/server.js` | T0, T2 | /api/version, /api/hook 확장, danger-gate import |
| `pipeline-dashboard/hooks/harness-hook.js` | T2.0, T2 | payload dumper, context_usage 파싱 |
| `_workspace/hook-payload-samples/*.json` | T2.0 | (gitignore) 샘플 |
| `.claude/agents/*.md` × 8 | T1 | frontmatter 1줄 |
| `.claude/skills/universal-task-pipeline/SKILL.md` | T3 | description |
| `.claude/skills/code-review-pipeline/SKILL.md` | T3 | description |
| `pipeline-dashboard/public/app.js` | T2 | 배너 UI |
| `pipeline-dashboard/public/style.css` | T2 | 배너 스타일 |
| `pipeline-dashboard/executor/pipeline-executor.js` | T9 | onPreTool 게이트 |
| `pipeline-dashboard/executor/danger-gate.js` | T9 | 공용 모듈 (신규) |
| `pipeline-dashboard/executor/__danger-gate-test.js` | T9 | 단위 테스트 (신규) |
| `pipeline-dashboard/executor/__t2-context-test.js` | T2 | 단위 테스트 (신규) |

---

## 리스크 & 롤백 (rev2)

| 리스크 | 감지 | 롤백 |
|---|---|---|
| T0 /api/version이 기존 라우트와 충돌 | `curl` 404 또는 500 | `git reset --hard <ROLLBACK_SHA>` (로컬) |
| T2.0 hook payload에 context_usage 필드 부재 | 덤프 JSON에서 필드 미발견 | T2 fallback(자체 추정)로 전환, 계획 일부 수정 |
| T1 `model:` 값이 Claude Code에서 인식 안 됨 | Agent 호출 시 "model not recognized" 에러 | T1 브랜치 커밋 revert, 대신 description 힌트로 전환 |
| T3 라우팅이 의도와 달라짐 (smoke test 실패) | V-T3-4 실패 | description 재조정 후 재검증, 통과 못하면 revert |
| T2 Stop 훅이 여전히 block 유발 | 세션 중 Phase 전이 멈춤 | T2 revert + block 금지 원칙 재확인 |
| T9 negative 케이스 false-positive | V-T9-2 실패 | 패턴 완화 후 재테스트 |
| 전체 실패 | 세션 불안정 | `git checkout master && git branch -D tuning/step0-phase3` |

---

## Codex rev1 비평 반영 매트릭스

| 비평 ID | 심각도 | 대응 위치 |
|---|---|---|
| C1 `.claude` 자해 | critical | T9 패턴에서 `.claude[\\/]/` 제거, .env는 Write/Edit만 차단 |
| C2 master 직접 push | critical | 세이프티 브랜치 규칙 신설 |
| H1 리포 루트 모순 | high | 상단 고정 `workspace`, 모든 경로 상대화 |
| H2 runtime 증명 없음 | high | T0 `/api/version` 신설 |
| H3 모델 행동 가정 | high | 명시적 자극 프롬프트 + S1 인공 이벤트 |
| H4 context_usage 필드 가정 | high | T2.0 payload 선조사 |
| H5 Stop block 충돌 | high | 45% block 제거, 배너 안내만 |
| H6 T9 단일 경로 | high | danger-gate.js 공용 모듈 + 두 진입점 |
| M1 정규식 우회/오탐 | medium | tool-scoped 판정, Remove-Item/force-with-lease 추가 |
| M2 model 스키마 미검증 | medium | T1.0 선행 확인, 실패 시 revert |
| M3 V-T1-1 Windows 부적합 | medium | Node 스크립트로 교체 |
| M4 T3 표면 검증 | medium | V-T3-4 라우팅 smoke test 추가 |
| M5 29s 시간 가정 | medium | S5 timeout 120s |
| M6 S7 CONCERNS 기준 | medium | critical=0 AND verdict ∈ {CLEAN, CONCERNS} |
| M7 실패 덤프 미명시 | medium | 6개 필드 스키마 명시 |
| M8 test first 순서 없음 | medium | T2/T9 failing test 선작성 |
| M9 restart 절차 누락 | medium | 타임라인에 각 태스크 후 restart + /api/version 확인 |
| L1 B4 오타 | low | "다행" → "여러 줄" |
| L2 육안 확인 과다 | low | B2, V-T2-5는 DOM selector assert |
| L3 push가 검토 경계 축소 | low | 브랜치 분리 + 각 태스크 후 self-review diff 단계 |

---

## Next Section (참고)

Phase 3 P0 완료 후 Phase 4 P1 (T4/T5/T6) → Phase 5 P2/P3 (T7/T8/T10) → Phase 6 측정. rev2 범위 밖.
