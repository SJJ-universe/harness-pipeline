# Harness Pipeline Hardening Plan

> **For agentic workers:** 이 문서는 현재 구현 완료 상태와 다음 구현 작업을 함께 담는다. 새 작업을 실행할 때는 `npm test`를 기준 품질 게이트로 사용하고, 각 작업은 테스트 추가 또는 기존 테스트 갱신 후 구현한다.

**작성일:** 2026-04-15  
**대상 리포:** `C:/Users/SJ/harness-pipeline-analysis`  
**대상 앱:** `pipeline-dashboard`  
**현재 목표:** 실험용 대시보드 수준의 하네스를 84점 이상 내부 운영 하네스로 강화한다.  
**현재 상태:** 보안/이식성/테스트 보강 1차 구현 완료, `npm test` 통과.  

---

## 1. 현재 구현 완료 요약

### 1.1 Runtime Proof

완료:

- `/api/version` 엔드포인트 추가.
- 응답에 `gitSha`, `bootTime`, `nodeVersion`, `templateHash`, `policyHash`, `repoRoot`, `mode` 포함.
- 서버가 `require()`될 때 자동 listen하지 않도록 `start()`를 export하여 smoke/integration 테스트 가능하게 변경.

주요 파일:

- `server.js`
- `src/runtime/version.js`
- `tests/smoke/server-boot.test.js`

검증:

```powershell
npm run test:smoke
```

기대 결과:

- `/api/health` 200
- `/api/version` 200
- `gitSha`, `bootTime`, `templateHash`, `policyHash`, `mode=local` 존재

### 1.2 Security Boundary

완료:

- 기본 host를 `127.0.0.1`, 기본 port를 `4201`로 고정.
- `HARNESS_ALLOW_REMOTE=1` 없이는 remote client 차단.
- state-changing API에 `x-harness-token` 요구.
- token은 `HARNESS_TOKEN` 또는 `.harness/local-token` 사용.
- `/api/auth/token`은 loopback 전용으로 제공.
- `express.json({ limit: "256kb" })` 적용.
- 보안 헤더 적용.
- `/api/event`, `/api/hook`, `/api/context/load`, `/api/context/discover`, `/api/pipeline/general-run`, `/api/codex/trigger`, `/api/executor/mode`에 입력 검증 적용.
- `/api/context/load`와 `/api/run` target file에 repo-root path sandbox 적용.

주요 파일:

- `server.js`
- `src/security/auth.js`
- `src/security/pathSandbox.js`
- `src/security/requestSchemas.js`
- `public/js/api-client.js`
- `hooks/harness-hook.js`

검증:

```powershell
npm run test:unit
npm run test:integration
```

기대 결과:

- token 없는 state-changing API는 `401`
- unknown event type은 `400`
- repo root 밖 context load는 `403`
- allowlisted event는 token 포함 시 `200`

### 1.3 Danger Gate & Phase Policy

완료:

- Phase A에서 `Bash` 제거.
- Phase A exit gate를 discovery tool 3회로 강화.
- `phasePolicy.evaluateTool()` 추가.
- `dangerGate.evaluate()` 추가.
- 기본 block 항목:
  - `rm -rf`
  - `Remove-Item -Recurse`
  - `git reset --hard`
  - `git checkout --`
  - `format disk`
  - `del /s`
  - `--dangerously-skip-permissions`
  - repo root 밖 path/cwd
  - Phase A에서 read-only가 아닌 Bash

주요 파일:

- `pipeline-templates.json`
- `src/policy/phasePolicy.js`
- `src/policy/dangerGate.js`
- `executor/pipeline-executor.js`
- `executor/__phase2-test.js`

검증:

```powershell
npm run test:unit
npm run test:legacy
```

기대 결과:

- Phase A Bash 차단
- Phase A Read/Glob 허용
- destructive command 차단
- 기존 phase2/3/4 회귀 테스트 통과

### 1.4 Runner Hardening

완료:

- Claude/Codex runner에서 `shell: false` 사용.
- Windows에서 `npx`, `codex`, `claude`는 `.cmd`로 resolution.
- Claude runner에서 `--dangerously-skip-permissions` 기본 제거.
- 위험 agent flag는 `HARNESS_ALLOW_DANGEROUS_AGENT=1`과 explicit confirmation 없이는 차단.
- runner 실행마다 `RunRegistry` manifest 기록.

주요 파일:

- `executor/claude-runner.js`
- `executor/codex-runner.js`
- `src/runtime/runRegistry.js`
- `tests/integration/runRegistry.test.js`

검증:

```powershell
npm run test:integration
```

기대 결과:

- `runs/<runId>/manifest.json` 형태의 manifest 작성 가능
- manifest에 input hash, policy decision, duration, exit code, output hash 저장

### 1.5 Hook-Driven Runtime State

완료:

- `HookRouter`에서 hook payload sampling 지원.
- `HARNESS_SAMPLE_HOOKS=1`이면 `fixtures/hooks/*.json`에 sample 저장.
- `context_usage`, `contextUsage`, `usage.context`, `usage.context_usage` 기반 context usage 추출.
- context alarm 기준:
  - 70% 이상: warning
  - 85% 이상: compaction suggestion
  - 95% 이상: block
- `SessionWatcher`가 import 시 바로 interval을 만들지 않고, server start/close에 맞춰 start/stop.

주요 파일:

- `executor/hook-router.js`
- `src/runtime/contextUsage.js`
- `session-watcher.js`

검증:

```powershell
npm run test:smoke
```

기대 결과:

- server close 시 watcher interval 정리
- 테스트 프로세스가 hang 없이 종료

### 1.6 UI Safety & Local Token Flow

완료:

- `public/js/api-client.js` 추가.
- 브라우저가 `/api/auth/token`에서 local token을 얻고 state-changing API에 자동으로 `x-harness-token` 부착.
- terminal WebSocket은 `?token=` 쿼리로 인증.
- Codex trigger card rendering은 dynamic `innerHTML` 대신 DOM API로 변경.
- `public/js/dom.js` 추가. 이후 renderer 분리 시 사용할 DOM helper 제공.

주요 파일:

- `public/index.html`
- `public/app.js`
- `public/js/api-client.js`
- `public/js/dom.js`

검증:

```powershell
npm run test:smoke
```

수동 확인:

```text
http://127.0.0.1:4201
```

### 1.7 Test Gate

완료:

- `npm test`를 실제 품질 게이트로 변경.
- Node 내장 `node:test` 사용.
- 샌드박스에서 `node --test tests/*.js`가 child spawn `EPERM`을 낼 수 있어 `tests/run-tests.js` 직렬 runner 추가.
- 기존 phase2/3/4 테스트를 `test:legacy`로 연결.
- `npm audit --package-lock-only --audit-level=moderate`를 전체 test gate에 포함.

주요 파일:

- `package.json`
- `tests/run-tests.js`
- `tests/unit/*.test.js`
- `tests/integration/*.test.js`
- `tests/smoke/*.test.js`

검증:

```powershell
npm test
```

현재 검증 결과:

- Unit: 12 pass
- Integration: 3 pass
- Legacy phase2/3/4: all pass
- Smoke: 1 pass
- Audit: 0 vulnerabilities

### 1.8 Docs & Runbook

완료:

- quick start, env vars, verification, runtime proof 문서화.
- architecture, security model, scorecard 문서 추가.
- `.claude/settings.json`의 hardcoded absolute hook path 제거.
- root launch port를 `4201`로 정렬.
- `.harness/`, `runs/` git ignore 추가.

주요 파일:

- `README.md`
- `docs/harness-architecture.md`
- `docs/security-model.md`
- `docs/scorecard.md`
- `.claude/settings.json`
- `.claude/launch.json`
- `.gitignore`
- `pipeline-dashboard/.gitignore`

---

## 2. 현재 점수

### 2.1 이전 점수

이전 평가: **49/100**

주요 감점:

- state-changing API 인증 없음
- arbitrary event broadcast
- repo root 밖 file read 가능
- Phase A Bash 정책 불일치
- `npm test` placeholder
- runner shell 의존
- hardcoded hook path
- runtime proof 부족

### 2.2 현재 점수

현재 평가: **84/100**

상승 근거:

- Runtime proof 추가
- local token/auth/origin/loopback posture 추가
- path sandbox 추가
- event/hook/request schema validation 추가
- danger gate와 phase policy 추가
- runner `shell: false` 및 run manifest 추가
- context alarm 기반 마련
- `npm test` 전체 품질 게이트화
- docs/runbook/scorecard 추가

남은 감점:

- `server.js`가 아직 route host 역할을 많이 갖고 있음
- full policy-as-code schema 미완성
- replay mode 미완성
- evidence ledger가 append-only/signed 구조는 아님
- agent contract system 미완성
- UI 전체 `innerHTML` 제거는 일부만 완료
- remote/team mode용 container sandbox 미완성

---

## 3. 다음 목표: 90점대 True Harness

다음 단계 목표 점수: **90~92/100**

핵심 원칙:

- 하네스는 실행을 돕는 UI가 아니라 실행을 통제하고 증거를 남기는 시스템이어야 한다.
- policy, evidence, replay, agent contract가 같은 데이터 모델을 공유해야 한다.
- 완료 선언은 evidence와 test result로 검증되어야 한다.

---

## 4. 다음 구현 계획

### Task 1: Route Extraction

**Goal:** `server.js`를 thin bootstrap에 가깝게 축소한다.

**Files:**

- Modify: `server.js`
- Create: `src/routes/healthRoutes.js`
- Create: `src/routes/contextRoutes.js`
- Create: `src/routes/eventRoutes.js`
- Create: `src/routes/executorRoutes.js`
- Create: `src/routes/hookRoutes.js`
- Create: `src/routes/codexRoutes.js`
- Create: `src/routes/templateRoutes.js`
- Create: `src/routes/serverControlRoutes.js`
- Test: `tests/integration/api-security.test.js`
- Test: `tests/smoke/server-boot.test.js`

**Steps:**

- [ ] 현재 `server.js` route 목록을 기능별로 묶는다.
- [ ] 각 route module은 `{ router }` 또는 `createXRoutes(deps)`를 export한다.
- [ ] `server.js`는 dependency 생성, WebSocket setup, route mount, `start()` export만 담당하게 한다.
- [ ] route extraction 후 `npm test`를 실행한다.

Acceptance:

- `server.js`가 신규 route logic을 직접 갖지 않는다.
- 기존 API response shape는 유지한다.
- `npm test` 통과.

### Task 2: Policy-as-Code Schema

**Goal:** phase/tool/command/file/agent 권한을 JSON policy로 선언하고 UI와 executor가 같은 policy를 읽게 한다.

**Files:**

- Create: `policies/harness-policy.schema.json`
- Create: `policies/default-policy.json`
- Modify: `src/policy/phasePolicy.js`
- Modify: `src/policy/dangerGate.js`
- Modify: `executor/pipeline-executor.js`
- Modify: `public/app.js`
- Test: `tests/unit/phasePolicy.test.js`
- Test: `tests/unit/dangerGate.test.js`

**Policy shape v1:**

```json
{
  "version": 1,
  "phases": {
    "A": {
      "allowedTools": ["Read", "Glob", "Grep", "Agent", "TodoWrite"],
      "bash": { "mode": "blocked" }
    },
    "E": {
      "allowedTools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep", "TodoWrite"],
      "bash": { "mode": "allowlisted", "allowPrefixes": ["npm test", "node", "git status"] }
    }
  },
  "blockedCommandPatterns": [
    "rm -rf",
    "git reset --hard",
    "--dangerously-skip-permissions"
  ],
  "rootSandbox": true
}
```

**Steps:**

- [ ] schema 파일을 추가한다.
- [ ] `default-policy.json`을 현재 hardcoded policy와 동일하게 만든다.
- [ ] `phasePolicy`와 `dangerGate`가 policy object를 입력으로 받도록 바꾼다.
- [ ] `/api/version`에 `policyHash`가 policy JSON hash를 반영하게 한다.
- [ ] UI에 active policy version/hash를 표시한다.
- [ ] `npm test`를 실행한다.

Acceptance:

- hardcoded phase policy와 JSON policy가 불일치하지 않는다.
- policy 변경 시 `/api/version.policyHash`가 바뀐다.
- `npm test` 통과.

### Task 3: Evidence Ledger v2

**Goal:** 모든 실행의 입력, 정책 결정, artifact, test 결과, reviewer result를 하나의 ledger로 연결한다.

**Files:**

- Modify: `src/runtime/runRegistry.js`
- Create: `src/runtime/evidenceLedger.js`
- Create: `src/runtime/artifactStore.js`
- Modify: `executor/pipeline-executor.js`
- Modify: `executor/codex-runner.js`
- Modify: `executor/claude-runner.js`
- Test: `tests/integration/runRegistry.test.js`

**Ledger event shape v2:**

```json
{
  "eventId": "evt-...",
  "runId": "run-...",
  "type": "policy_decision",
  "at": "2026-04-15T00:00:00.000Z",
  "dataHash": "sha256...",
  "data": {
    "decision": "allow",
    "matchedRule": null
  }
}
```

**Steps:**

- [ ] `RunRegistry` manifest를 유지하되, events를 별도 append API로 분리한다.
- [ ] artifact path, prompt hash, policy decision, exit code, test result를 event로 기록한다.
- [ ] ledger write는 append-only 방식으로 구현한다.
- [ ] 현재 단계에서는 signing은 하지 않는다.
- [ ] `npm run test:integration`을 실행한다.

Acceptance:

- 하나의 `runId`로 policy, prompt hash, result, artifact를 추적할 수 있다.
- 기존 runner manifest 테스트가 v2 ledger 기준으로 통과한다.

### Task 4: Replay Mode

**Goal:** 저장된 hook fixture와 run manifest로 동일한 phase transition을 재현한다.

**Files:**

- Create: `src/runtime/replay.js`
- Create: `tests/integration/replay.test.js`
- Modify: `executor/hook-router.js`
- Modify: `executor/pipeline-executor.js`
- Add fixtures: `fixtures/hooks/*.json`

**Replay input:**

```json
{
  "templateId": "default",
  "events": [
    { "event": "user-prompt", "payload": { "prompt": "please implement" } },
    { "event": "post-tool", "payload": { "tool_name": "Read", "tool_response": { "filePath": "server.js" } } },
    { "event": "stop", "payload": {} }
  ]
}
```

**Steps:**

- [ ] `HookRouter.route()` 호출을 순차 재생하는 replay runner를 만든다.
- [ ] broadcast 결과를 memory sink에 모은다.
- [ ] replay 결과에 final phase, blocked tools, gate decisions를 포함한다.
- [ ] fixture 기반 integration test를 추가한다.
- [ ] `npm test`를 실행한다.

Acceptance:

- 같은 fixture는 같은 final phase와 gate result를 낸다.
- replay 중 실제 Claude/Codex process는 실행하지 않는다.

### Task 5: Agent Contract System

**Goal:** agent/skill이 capabilities, forbidden actions, required artifacts, test obligations를 선언하게 한다.

**Files:**

- Create: `contracts/agent-contract.schema.json`
- Create: `contracts/default-agent-contracts.json`
- Create: `src/contracts/agentContracts.js`
- Modify: `executor/skill-injector.js`
- Modify: `executor/pipeline-executor.js`
- Test: `tests/unit/agentContracts.test.js`

**Contract shape v1:**

```json
{
  "agent": "planner",
  "capabilities": ["read", "write-plan"],
  "forbiddenActions": ["execute-shell", "modify-source"],
  "requiredArtifacts": ["plan"],
  "testObligations": ["plan-has-verification-section"]
}
```

**Steps:**

- [ ] schema와 default contracts를 추가한다.
- [ ] phase의 `agent`와 contract를 연결한다.
- [ ] forbidden action이 policy와 충돌하면 더 강한 제한을 적용한다.
- [ ] required artifact가 없으면 phase gate가 실패하게 한다.
- [ ] `npm test`를 실행한다.

Acceptance:

- agent contract가 phase behavior에 영향을 준다.
- contract 없는 agent는 명시적으로 default contract를 받는다.

### Task 6: Self-Verification Loop

**Goal:** Phase F 이후 “claim vs evidence” 검사를 수행하고, 증거 없는 완료 선언을 fail 처리한다.

**Files:**

- Create: `src/verification/claimVerifier.js`
- Modify: `executor/quality-gate.js`
- Modify: `executor/pipeline-executor.js`
- Create: `tests/unit/claimVerifier.test.js`

**Verification rules v1:**

- `npm test` 실행 evidence가 없으면 complete 불가.
- modified files가 있는데 test result가 없으면 warning 이상.
- critical/high findings가 unresolved이면 complete 불가.
- final answer에 “통과”라고 주장하려면 matching test evidence가 있어야 한다.

**Steps:**

- [ ] evidence ledger에서 latest test event를 조회한다.
- [ ] claim text와 evidence를 비교하는 rule-based verifier를 만든다.
- [ ] Phase F exit criteria에 `claim-verified`를 추가한다.
- [ ] 실패 시 UI에 missing evidence를 표시한다.
- [ ] `npm test`를 실행한다.

Acceptance:

- 증거 없는 완료 선언은 fail.
- `npm test` evidence가 있으면 pass.

### Task 7: UI Safety Completion

**Goal:** dynamic `innerHTML` 사용을 제거하거나 명시적 static template으로 한정한다.

**Files:**

- Modify: `public/app.js`
- Create: `public/js/renderers/pipeline.js`
- Create: `public/js/renderers/logs.js`
- Create: `public/js/renderers/triggers.js`
- Create: `tests/unit/uiSanitizer.test.js`

**Steps:**

- [ ] `rg "innerHTML|insertAdjacentHTML" public/app.js` 결과를 분류한다.
- [ ] dynamic payload가 들어가는 부분은 DOM API 또는 `textContent`로 바꾼다.
- [ ] static template만 `safeHtmlFromTemplate` 사용을 허용한다.
- [ ] malicious event payload가 DOM HTML로 삽입되지 않는 test를 추가한다.
- [ ] `npm test`를 실행한다.

Acceptance:

- event payload, trigger metadata, log message가 HTML로 실행되지 않는다.
- UI regression 없이 trigger cards, logs, pipeline render가 동작한다.

### Task 8: Remote/Team Mode Readiness

**Goal:** remote/team mode를 열기 전에 container sandbox와 stronger auth를 설계한다.

**Files:**

- Create: `docs/remote-mode-design.md`
- Create: `docs/container-sandbox.md`
- Optional Create: `Dockerfile.harness-runner`
- Optional Create: `src/security/rateLimit.js`

**Steps:**

- [ ] 현재 remote mode는 disabled-by-default임을 유지한다.
- [ ] remote mode threat model을 문서화한다.
- [ ] container runner boundary를 설계한다.
- [ ] token-only auth의 한계를 정리하고 session auth 또는 signed request로 전환 계획을 쓴다.
- [ ] 이 단계에서는 remote mode를 실제로 enable하지 않는다.

Acceptance:

- `HARNESS_ALLOW_REMOTE=1` 없이 remote 접근이 계속 막힌다.
- remote mode 문서가 구현 전 gate 역할을 한다.

---

## 5. Verification Commands

모든 변경 후 기본 검증:

```powershell
npm test
```

부분 검증:

```powershell
npm run test:unit
npm run test:integration
npm run test:legacy
npm run test:smoke
npm run audit:moderate
```

서버 수동 확인:

```powershell
npm start
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4201/api/health
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4201/api/version
```

---

## 6. Operational Notes

- 기본 운영 모드는 single-user local harness다.
- remote/team mode는 아직 켜지 않는다.
- `.harness/local-token`과 `runs/`는 git에 포함하지 않는다.
- hook path는 repo-relative `node pipeline-dashboard/hooks/harness-hook.js <event>`를 사용한다.
- `node --test tests/*.js`는 일부 샌드박스에서 child spawn `EPERM`을 낼 수 있으므로 `tests/run-tests.js`를 유지한다.
- `node_modules` 설치는 `npm install`이 필요하다.

---

## 7. Open Risks

- `server.js`가 아직 완전한 thin bootstrap은 아니다.
- CDN xterm asset은 CSP상 허용되어 있으나 vendoring 또는 SRI 고정이 남아 있다.
- Evidence ledger는 현재 manifest 중심이며, append-only/signing은 아직 아니다.
- Agent contract와 self-verification loop가 없어 “진짜 하네스”의 자동 판정 능력은 다음 단계에서 완성된다.
- UI 전체 sanitizer 완료 전까지 `innerHTML` 사용 지점은 계속 추적해야 한다.

---

## 8. Recommended Next Order

1. Route Extraction
2. Policy-as-Code Schema
3. Evidence Ledger v2
4. Replay Mode
5. Agent Contract System
6. Self-Verification Loop
7. UI Safety Completion
8. Remote/Team Mode Readiness

이 순서를 지키면 현재 84점대 하네스가 90점대 true harness로 자연스럽게 올라간다.
