# Live Browser Visual Verification — 운영자 Runbook

> **Slice**: UI-P10 (Phase D Round UI-P, 2026-05-04)
>
> **목적**: 실제 chromium에서 4개 라우트 × 4개 viewport 매트릭스 (16 cells)를 캡처해, 구조 스냅샷(`tests/visual/baseline-product-shell.json`)이 잡지 못하는 픽셀-수준 회귀(overflow, animation, mobile rendering)를 evidence로 남긴다.
>
> **이 도구가 잡는 것**: full-page 스크린샷 — 텍스트 잘림, 레이아웃 깨짐, mobile/tablet 렌더링 차이, 색상/폰트 시각 검증
>
> **이 도구가 잡지 못하는 것**: 픽셀-단위 자동 diff (UI-P10 범위 외 — 후속 라운드 후보), 접근성 (UI-P12), 반응형 텍스트 적합성 (UI-P11), 행동 검증 (live-verify-review-relay 사용)

---

## 1. 사전조건

1. Node 24+ 설치 (`node --version`)
2. `pipeline-dashboard` 디렉토리에서 `npm ci` 완료
3. 운영 시스템: Windows 10/11, macOS, Linux (Playwright 지원 OS면 모두 가능)
4. 디스크 여유 공간 ≥ 500MB (chromium 한 번 설치 + 캡처 산출물)
5. 네트워크: 첫 실행 시 Playwright가 chromium을 다운로드 (~150MB)

---

## 2. 첫 실행 — 1회만 수행

### 2.1 chromium 설치

```bash
cd pipeline-dashboard
npm run visual:install-browsers
```

이 명령은 내부적으로 `npx playwright install chromium --with-deps`를 실행한다. 네트워크 + 권한이 필요하므로 첫 실행에 1~2분 소요된다.

**Windows 운영자**: PowerShell 또는 Git Bash에서 동일하게 동작한다.

**Linux 운영자**: `--with-deps` 플래그가 시스템 라이브러리(libnss3, libxss1 등)도 설치한다. sudo 권한 필요할 수 있다.

**오프라인 환경**: chromium 바이너리를 미리 받아 `PLAYWRIGHT_BROWSERS_PATH` 환경변수로 가리킬 수 있다 (Playwright 공식 문서 참조).

### 2.2 설치 확인

```bash
node -e "const pw = require('playwright-core'); pw.chromium.launch().then(b => { console.log('chromium ok', b.version()); return b.close(); }).catch(e => { console.error('FAIL:', e.message); process.exit(1); });"
```

`chromium ok 131.x.x.x` 같은 출력이 나오면 정상.

---

## 3. 표준 캡처 절차

### 3.1 기본 명령

```bash
cd pipeline-dashboard
npm run visual:capture-live
```

**무엇이 일어나는가**:
1. 서버를 백그라운드(in-process)로 부트 — port 4799 (변경 가능)
2. `/api/health`로 ready 확인
3. chromium 실행 + 16 cells 순차 캡처
4. `docs/reports/<YYYY-MM-DD>-ui-p10-live/` 디렉토리 생성
5. PNG 16개 + `manifest.json` 1개 작성
6. 서버 graceful shutdown
7. 콘솔 + exit code로 결과 보고

### 3.2 옵션

```bash
node scripts/visual-capture-live.js --help
```

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--port <n>` | 서버 포트 | 4799 (env `ORCHESTRATOR_VISUAL_LIVE_PORT` override 가능) |
| `--out-dir <path>` | 출력 디렉토리 | `docs/reports/<date>-ui-p10-live/` |
| `--label <text>` | 출력 디렉토리 label suffix | (없음) |
| `--quiet` | per-cell 진행 출력 억제 | 출력함 |
| `--json` | 최종 manifest를 stdout으로 dump | 안함 |

### 3.3 예시 시나리오

**일반 evidence 캡처** (PR에 첨부할 산출물):
```bash
npm run visual:capture-live -- --label "ui-p9-baseline-refresh"
```

**다른 포트로 실행** (4799가 점유된 경우):
```bash
node scripts/visual-capture-live.js --port 5500
```

**CI/스크립트에서 호출** (조용히 + JSON 결과만):
```bash
node scripts/visual-capture-live.js --quiet --json > capture-result.json
```

---

## 4. 결과 해석

### 4.1 Exit code

| 코드 | 의미 | 대응 |
|---|---|---|
| 0 | 16 cells 모두 PASS | 산출물 디렉토리 commit + PR에 첨부 |
| 1 | 1개 이상 cell 실패 | manifest.json `cells[].failureReason` 확인 + 수정 후 재실행 |
| 2 | Config error | 안내 메시지에 따라 chromium 설치 / 포트 변경 / 권한 확인 |

### 4.2 manifest.json 스키마

```json
{
  "schema": "orchestrator-visual-live/v1",
  "capturedAt": "2026-05-04T08:30:00.000Z",
  "base": "http://127.0.0.1:4799",
  "browser": { "name": "chromium", "version": "131.0.6778.69" },
  "totalElapsedMs": 8421,
  "cells": [
    {
      "routeId": "product-default",
      "viewportId": "desktop-1366",
      "pathname": "/",
      "width": 1366,
      "height": 768,
      "isMobile": false,
      "filename": "product-default__desktop-1366.png",
      "bytes": 142589,
      "navMs": 312,
      "paintMs": 89,
      "totalMs": 654,
      "ok": true,
      "failed": false,
      "failureReason": null
    }
    // ... 15 more cells
  ],
  "summary": { "total": 16, "ok": 16, "failed": 0 }
}
```

### 4.3 PNG 파일명 규약

`<routeId>__<viewportId>.png` (double-underscore 구분자):

```
product-default__desktop-1366.png
product-default__desktop-1920.png
product-default__mobile-390.png
product-default__tablet-768.png
product-pro__desktop-1366.png
...
legacy__tablet-768.png
```

이 규약 덕분에 `ls *__mobile-390.png`로 모든 모바일 캡처를 한 번에 grep할 수 있다.

---

## 5. 트러블슈팅

### 5.1 "BROWSER_NOT_INSTALLED" 에러

```
[visual-capture-live] CONFIG ERROR: chromium binary not found.
[visual-capture-live]   Run: npm run visual:install-browsers
```

→ §2.1 첫 실행 절차 수행.

### 5.2 "server did not respond on /api/health within 10000ms"

원인:
- 다른 프로세스가 포트 4799 점유 중 → `--port 5500` 같은 다른 포트로 재시도
- 서버 부트 자체 실패 (코드 회귀) → `npm run start`로 별도 부트 후 로그 확인

### 5.3 Cell 실패 — `failureReason` 분석

```json
{ "filename": "product-pro__mobile-390.png", "failed": true,
  "failureReason": "page.waitForSelector: Timeout 15000ms exceeded." }
```

→ 해당 라우트의 `waitForSelector`가 mount되지 않음. 코드 변경으로 mount ID가 바뀐 경우, `scripts/visual-live/routes.js`의 selector를 갱신.

```json
{ "failureReason": "net::ERR_CONNECTION_REFUSED" }
```

→ 서버가 캡처 도중 죽음. 서버 로그 + 다른 cell의 ok 여부 확인.

### 5.4 캡처가 너무 느림

기본값(8~12초)보다 오래 걸리는 경우:
- 디스크 I/O 병목 (`bytes` 큰 cell이 많음 → fullPage 캡처 정상)
- chromium 첫 실행 시 추가 다운로드 대기
- 가상화 환경 (WSL2 등)에서 native 부트 오버헤드

`scripts/visual-live/capture.js`의 `DEFAULT_NAV_TIMEOUT_MS` 변경은 권장하지 않음 — 그 대신 환경 자체를 점검.

---

## 6. CI 통합 가이드

UI-P10 라운드는 **CI manual-dispatch만 추가**한다 (PR push 자동 실행은 의도적 제외):

- 워크플로 파일: `.github/workflows/visual-capture-live.yml` (P10-d 슬라이스에서 추가)
- 트리거: `workflow_dispatch` (운영자가 GitHub Actions UI에서 수동 실행)
- 산출물: `artifacts/ui-p10-live-<run-id>/` 디렉토리 업로드

PR마다 자동 실행하지 않는 이유:
1. chromium 다운로드 비용 (CI cache 미스 시 ~150MB)
2. evidence 캡처는 정기 점검 성격이지 PR-blocking 회귀 게이트가 아님
3. UI-P11 (responsive) / UI-P12 (a11y) 안정 후에 PR gate화 검토

자동 PR gate가 필요해지는 시점: UI-P11 + UI-P12 마감 후 별도 라운드.

---

## 7. 산출물 commit 정책

### 7.1 언제 commit하는가

- UI 코드를 의도적으로 변경한 PR: **함께 commit** (코드 + evidence가 같은 PR에서 검토 가능)
- 정기 점검(주 1회): commit 권장 (시각 변화 history 보존)
- 매번 자동: **권장하지 않음** (PNG 16개 × 100~300KB = 매번 ~3MB 디스크 증가)

### 7.2 무엇을 commit하는가

- ✅ `manifest.json` (line-friendly diff 가능)
- ✅ PNG 16개 (단, repo 사이즈 정책에 맞춰 후속 라운드에서 외부 storage 검토 가능)
- ❌ 임시 디렉토리 (`/tmp/visual-live-*`)
- ❌ Playwright 브라우저 바이너리 (gitignore 처리됨)

### 7.3 PR 첨부 패턴

PR description에 다음 형식으로 link:
```markdown
## Visual evidence (UI-P10)

Capture run: docs/reports/2026-05-04-ui-p10-live-pr-1234/

| Cell | Result |
|---|---|
| product-default × desktop-1366 | ✅ |
| product-default × mobile-390 | ✅ |
| ... | ... |
| **Summary** | **16/16 ok** |

manifest: [manifest.json](.../manifest.json)
```

---

## 8. 후속 라운드 연결

| 다음 라운드 | UI-P10이 제공하는 것 |
|---|---|
| UI-P11 Responsive + Text Fit | viewports.js + capture.js 재사용 가능 |
| UI-P12 Accessibility | server-boot.js + chromium launch 재사용 가능 (`page.evaluate(axeCheck)` 추가) |
| UI-P13 Dead Button | 같은 chromium context에서 click + verify 가능 |

---

## 9. 변경 이력

- **2026-05-04**: 초판 (UI-P10-c 슬라이스 closeout 일부)
