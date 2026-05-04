# Live Browser Fused Verification — 운영자 Runbook

> **Slice**: UI-Fuse (Phase D Round UI-P, 2026-05-04)
>
> **목적**: 4개 visual contract (UI-P10 capture / UI-P11 assert / UI-P12 a11y / UI-P13 button)을 단일 서버 부트 + 단일 chromium 설치 아래 순차 실행해, 한 번에 모든 contract 결과를 단일 디렉토리 + 단일 artifact로 받기. 4개 manual workflow를 따로 돌릴 때 발생하는 ~12-20분 오버헤드를 ~3-7분으로 단축.
>
> **이 도구가 잡는 것**: 4 contract 모두를 한 번에 평가 → 종합 evidence
>
> **이 도구가 잡지 못하는 것** (deferred): PR-gating. 자동 CI gate. 4 entry conditions가 충족되기 전까지 manual-dispatch only.

---

## 1. 사전조건

UI-P10/P11/P12/P13과 동일:
1. Node 24+
2. `pipeline-dashboard`에서 `npm ci` 완료
3. **chromium 설치 완료** (UI-P10/P11/P12/P13에서 했다면 재사용)

---

## 2. 첫 실행

```bash
cd pipeline-dashboard

# 첫 실행 (UI-P10/P11/P12/P13에서 했다면 skip)
npm run visual:install-browsers

# 표준 fused 실행 — 4 contract 모두
npm run visual:fused-live
```

**무엇이 일어나는가**:
1. 서버를 in-process로 부트 (port 4799) — **한 번만**
2. chromium 실행 — **한 번만 (browser context는 각 tool이 새로 생성)**
3. 4 tool이 순차 실행:
   - capture (16 PNG evidence)
   - assert (6 frozen rules × 16 cells)
   - a11y (axe + 2 custom × 16 cells)
   - button (13 buttons × 4 routes × 1 viewport)
4. `docs/reports/<YYYY-MM-DD>-ui-fuse[-<label>]/` 디렉토리 생성:
   ```
   <YYYY-MM-DD>-ui-fuse/
   ├── summary.json           ← top-level fused summary
   ├── capture/               ← UI-P10 PNGs + manifest
   │   ├── manifest.json
   │   ├── product-default__desktop-1366.png
   │   └── ... (15 more PNGs)
   ├── assert/                ← UI-P11 manifest + (optional) failed PNGs
   │   └── manifest.json
   ├── a11y/                  ← UI-P12 manifest
   │   └── manifest.json
   └── button/                ← UI-P13 manifest
       └── manifest.json
   ```
5. 콘솔에 per-tool exit code 요약
6. 최종 exit code = max(per-tool exit codes)

---

## 3. 옵션

```bash
node scripts/visual-fused-live.js --help
```

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--port <n>` | 서버 포트 | 4799 |
| `--out-dir <path>` | 출력 디렉토리 | `docs/reports/<date>-ui-fuse[-<label>]/` |
| `--label <text>` | label suffix | (없음) |
| `--tools <list>` | comma-separated 부분집합 | 4 tool 모두 |
| `--quiet` | per-tool 진행 출력 억제 | 출력 |
| `--json` | summary를 stdout으로 | 안함 |

### 3.1 권장 시나리오

**일반 PR 종합 점검**:
```bash
npm run visual:fused-live -- --label "pr-1234"
```

**a11y만 빠른 회귀 체크** (~30초):
```bash
node scripts/visual-fused-live.js --tools a11y --label "a11y-quick"
```

**capture + button 조합** (시각 polish + button wiring 동시 검증):
```bash
node scripts/visual-fused-live.js --tools capture,button
```

**CI/scripting**:
```bash
node scripts/visual-fused-live.js --quiet --json > fused-result.json
```

---

## 4. 결과 해석 — summary.json

```json
{
  "schema": "harness-visual-fused/v1",
  "fusedAt": "2026-05-04T08:00:00.000Z",
  "outDir": "docs/reports/2026-05-04-ui-fuse-pr-1234",
  "tools": {
    "capture": "ran",
    "assert":  "ran",
    "a11y":    "errored",
    "button":  "ran"
  },
  "perTool": {
    "capture": { "schema": "harness-visual-live/v1", "totalElapsedMs": 8421, "summary": { "ok": 16, "failed": 0 } },
    "assert":  { "schema": "harness-visual-assert/v1", "totalElapsedMs": 5234, "summary": { "cellsAllPassed": 16 } },
    "a11y":    { "error": "navigation timeout" },
    "button":  { "schema": "harness-visual-button/v1", "totalElapsedMs": 4521, "summary": { "totalCells": 4, "cellsAllPassed": 4 } }
  }
}
```

**핵심 필드**:
- `tools.<id>` 상태:
  - `"ran"` → 정상 실행 + manifest 작성됨
  - `"errored"` → 도구 자체 실패 (서버/네트워크/runtime 오류)
  - `"skipped"` → 도구가 명시적으로 skip (`--tools` 부분집합 사용 시)
- `perTool.<id>` 데이터:
  - 정상 → `{schema, capturedAt, totalElapsedMs, summary}`
  - 오류 → `{error: "..."}` 만

per-tool 상세는 각 subdir의 `manifest.json` 참고. 형식은 도구별 runbook (`visual-{capture,assert,a11y,button}-live.md`)에 명시.

---

## 5. 트러블슈팅

### 5.1 `BROWSER_NOT_INSTALLED` (모든 tool에서 fail)

원인: chromium 미설치.

해결:
```bash
npm run visual:install-browsers
```

### 5.2 `tools.a11y === "errored"` 만, 다른 도구는 "ran"

원인: a11y-runner 자체 fault (axe-core 주입 실패 등). 다른 도구는 같은 base URL에서 잘 작동했으니 서버는 멀쩡.

해결: 단독 실행으로 stack trace 확인:
```bash
npm run visual:a11y-live -- --label "diag"
```

### 5.3 모든 도구가 "errored"

원인: 서버 부트 실패 또는 chromium crash.

해결:
1. 다른 포트 시도: `--port 5500`
2. `npm run start` 별도 부트 → 로그 확인
3. chromium 재설치: `npx playwright install chromium --force`

### 5.4 wall time이 너무 길다 (10분+)

원인 가능성:
- 디스크 I/O 병목 (PNG 16개 + assert 실패 cell PNG들)
- chromium 첫 실행 시 추가 설정
- 가상화 환경 (WSL2)

해결: `--tools` 부분집합으로 진단. 어느 도구가 느린지 식별.

---

## 6. 산출물 commit 정책

- ✅ `summary.json`: **항상 commit** (fused 결과 한눈 추적)
- ✅ 각 subdir의 `manifest.json`: **commit** (역대 회귀 추적)
- ⚠️ 각 subdir의 PNG: per-tool runbook 정책 따름 (capture는 ad-hoc, assert는 회귀 시만, a11y/button은 commit 안 함)

PR 첨부 패턴:
```markdown
## Visual fused (UI-Fuse)

Run: docs/reports/2026-05-04-ui-fuse-pr-1234/

| Tool | Status | Detail |
|---|---|---|
| capture | ran | 16/16 PNG |
| assert | ran | 16/16 cells passed |
| a11y | ran | 14/16 cells, 2 critical violations |
| button | ran | 4/4 cells, 0 dead buttons |

summary: [summary.json](.../summary.json)
Wall time: 4m 21s (vs ~16m for 4 separate workflows)
```

---

## 7. CI 통합 — 현재 + 미래

### 7.1 현재 (UI-Fuse 라운드 직후)

`.github/workflows/visual-fused-live.yml` — workflow_dispatch ONLY. PR push 자동 실행 X.

**왜 manual만**: `docs/visual-contract-governance.md` §6.2가 PR-gating 4 entry conditions를 명시:
1. Stable baselines for assert/a11y/button manifests
2. chromium 캐시 안정 (UI-Fuse가 이걸 닫음 — single install)
3. Total wall time ≤ 5분 (UI-Fuse가 이걸 닫음 — sequential under one job)
4. Operator UX (PR-fail 메시지 명확)

UI-Fuse는 조건 2 + 3을 만족시킴. 조건 1 (baseline stability)과 4 (operator UX)는 운영 데이터가 누적되어야 만족 검증 가능. PR-gating은 별도 라운드 (UI-Fuse-2 가설).

### 7.2 미래 — UI-Fuse-2 후보 라운드

조건 1 + 4 충족 후:
- workflow_dispatch + push trigger 추가
- PR push 시 자동 실행 + cellsAllPassed 회귀 시 fail
- 30-day artifact 자동 생성

진입 시점은 운영 데이터에 따라 결정.

---

## 8. 후속 라운드 연결

| 다음 라운드 | UI-Fuse가 제공하는 것 |
|---|---|
| UI-Fuse-2 (가설) | 같은 workflow + same script — push trigger만 추가 |
| SMART arc | 의사결정 context의 visual-evidence 입력 |
| UI-Onboarding-Tour | 첫 실행 시 fused-live 자동 호출 + UX 안내 |

---

## 9. 변경 이력

- **2026-05-04**: 초판 (UI-Fuse-c 슬라이스 일부)
