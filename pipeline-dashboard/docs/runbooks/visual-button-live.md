# Live Browser Button Integrity — 운영자 Runbook

> **Slice**: UI-P13 (Phase D Round UI-P, 2026-05-04)
>
> **목적**: "눌렀는데 아무 일도 없음" UX 회귀를 자동 검출. 13개 product-shell 버튼이 (1) accessible name 가지고 있고 (2) disabled라면 이유가 명시되어 있고 (3) clickSafe 버튼이 click 시 실제로 DOM 변경 또는 network request 발생시키는지 검증.
>
> **이 도구가 잡는 것**: 빈 버튼 (handler 미연결), aria-label 없는 disabled 버튼, click 시 console.error 발생, dead button (mutation 0 + request 0)
>
> **이 도구가 잡지 못하는 것**: 각 버튼이 _올바른_ action을 수행하는가 (의미 검증), 비동기 action의 최종 결과 (e.g., codex 비평 완료까지의 전체 플로우 — LV round가 담당)

---

## 1. 사전조건

UI-P10/P11/P12와 동일:
1. Node 24+
2. `pipeline-dashboard`에서 `npm ci` 완료
3. **chromium 설치 완료** (UI-P10/P11/P12에서 했다면 재사용)

---

## 2. 첫 실행

```bash
cd pipeline-dashboard

# UI-P10/P11/P12에서 했다면 skip
npm run visual:install-browsers

# UI-P13 표준 button integrity 평가
npm run visual:button-live
```

**무엇이 일어나는가**:
1. 서버 in-process 부트 (port 4799)
2. chromium 실행 + 4 routes 순차 평가 (1 desktop viewport)
3. 각 route마다 13 buttons 평가
4. `docs/reports/<YYYY-MM-DD>-ui-p13-buttons/` 디렉토리에 manifest.json
5. 콘솔에 per-cell + per-button 출력
6. exit 0/1/2

**왜 1 viewport만인가**: 버튼 wiring은 viewport-independent. UI-P11이 이미 viewport별 CSS visibility를 검증함. 4 routes × 13 buttons × 4 viewports × click+wait는 ~3분. 가치 대비 시간 낭비.

---

## 3. 13 Button 카탈로그

### 3.1 Header buttons (8개)

| ID | Selector | clickSafe |
|---|---|:---:|
| `header-mode-simple` | `[data-region="header"] button[data-mode="simple"]` | ✅ |
| `header-mode-pro` | `[data-region="header"] button[data-mode="pro"]` | ✅ |
| `header-locale-ko` | `[data-region="header"] button[data-locale="ko"]` | ✅ |
| `header-locale-en` | `[data-region="header"] button[data-locale="en"]` | ✅ |
| `header-action-metrics` | `[data-region="header"] button[data-action="metrics"]` | ✅ (modal) |
| `header-action-history` | `[data-region="header"] button[data-action="history"]` | ✅ (modal) |
| `header-action-codex-verify` | `[data-region="header"] button[data-action="codex-verify"]` | ❌ codex spawn |
| `header-action-shutdown` | `[data-region="header"] button[data-action="shutdown"]` | ❌ server kill |

### 3.2 Dual terminal action row (5개)

| ID | Selector | clickSafe |
|---|---|:---:|
| `dual-action-start` | `[data-region="dual-terminals-actions"] [data-action-id="start"]` | ✅ (POST) |
| `dual-action-send-codex` | ..."send-codex" | ❌ codex spawn |
| `dual-action-followup-codex` | ..."followup-codex" | ❌ codex spawn |
| `dual-action-hand-back` | ..."hand-back" | ❌ claude spawn |
| `dual-action-archive` | ..."archive" | ❌ state mutation |

### 3.3 Click-safety 정책

`clickSafe: false` 버튼은 click하지 않음. 이유:
- `shutdown`: 서버를 실제로 죽임
- `codex-verify` / `send-codex` / `followup-codex` / `hand-back`: 실제 provider 호출 (API quota 소비, 수 초 소요, 부분 완료 상태 발생)
- `archive`: 서버측 state 변경 (다음 button 평가 영향)

이 버튼들은 STATIC 검사만 받음 — visible + accessible name + disabled 시 explanatory text. UI-H7-f / LV round가 별도로 click 동작 검증 (실제 spawn 검증).

### 3.4 검증 verdict 카탈로그

| Status | Verdict | 의미 |
|---|:---:|---|
| `applies-to-false` | OK (skipped) | route/mode에 적용 안 됨 |
| `skipped` | OK | element not in DOM 또는 not visible |
| `no-accessible-name` | **FAIL** | textContent / aria-label / title 모두 없음 |
| `disabled-without-reason` | **FAIL** | disabled인데 aria-label / title로 이유 안 밝힘 |
| `disabled-with-reason` | OK | disabled + 이유 명시 |
| `static-ok-not-clicked` | OK | static 통과, clickSafe:false라 click 안 함 |
| `click-failed` | **FAIL** | playwright click 자체 실패 (보이지 않거나 가려짐) |
| `click-console-error` | **FAIL** | click 시 console.error 발생 (handler error) |
| `click-no-activity` | **FAIL** | **dead button** — click 시 0 mutation + 0 request |
| `click-fired-activity` | OK | click이 의미 있는 변화 트리거 |

---

## 4. 옵션

```bash
node scripts/visual-button-live.js --help
```

| 플래그 | 설명 | 기본값 |
|---|---|---|
| `--port <n>` | 서버 포트 | 4799 |
| `--out-dir <path>` | 출력 디렉토리 | `docs/reports/<date>-ui-p13-buttons/` |
| `--label <text>` | label suffix | (없음) |
| `--quiet` | per-button 진행 출력 억제 | 출력 |
| `--json` | manifest를 stdout으로 | 안함 |

### 4.1 권장 시나리오

**일반 dead-button 점검**:
```bash
npm run visual:button-live
```

**PR-별 evidence 첨부**:
```bash
node scripts/visual-button-live.js --label "pr-1234"
```

**CI/scripting**:
```bash
node scripts/visual-button-live.js --quiet --json > button-result.json
```

---

## 5. Manifest 스키마 (harness-visual-button/v1)

```json
{
  "schema": "harness-visual-button/v1",
  "capturedAt": "2026-05-04T08:00:00.000Z",
  "base": "http://127.0.0.1:4799",
  "browser": { "name": "chromium", "version": "131.0.6778.69" },
  "viewportId": "desktop-1366",
  "catalogVersion": 13,
  "catalogIds": ["header-mode-simple", "header-mode-pro", ...],
  "activityThresholds": { "minMutations": 1, "minNetworkRequests": 1 },
  "totalElapsedMs": 4521,
  "cells": [
    {
      "routeId": "product-default",
      "viewportId": "desktop-1366",
      "buttons": [
        {
          "id": "header-mode-simple",
          "label": "Header / Mode toggle / Simple",
          "selector": "...",
          "clickSafe": true,
          "static": { "found": true, "visible": true, "hasName": true, ... },
          "click": { "clickError": null, "mutations": 5, "requests": 0, "errors": [] },
          "ok": true,
          "status": "click-fired-activity",
          "detail": { "mutations": 5, "requests": 0 }
        }
      ],
      "summary": { "applicable": 13, "passed": 13, "failed": 0, "skipped": 0 },
      "totalMs": 612,
      "ok": true,
      "failed": false
    }
  ],
  "summary": {
    "totalCells": 4,
    "cellsAllPassed": 4,
    "cellsWithFailures": 0,
    "cellsWithErrors": 0,
    "totalButtonsApplicable": 36,
    "totalButtonsPassed": 36,
    "totalButtonsFailed": 0,
    "totalButtonsSkipped": 16
  }
}
```

**핵심 필드**:
- `summary.totalCells = 4` (4 routes)
- `summary.cellsAllPassed` ↔ 모든 button 통과 cell 수
- `summary.totalButtonsFailed` ↔ 실패 button 총합
- `catalogVersion + catalogIds` ↔ 평가 시점 카탈로그 스냅샷
- `activityThresholds` ↔ "no activity"의 정의를 manifest 안에 박아둠 (operator가 의미 알 수 있게)

---

## 6. 트러블슈팅

### 6.1 모든 cell에서 `header-action-shutdown :: no-accessible-name` FAIL

원인: shutdown 버튼이 icon-only인데 aria-label 누락.

해결:
```html
<button data-action="shutdown" aria-label="서버 종료" title="서버 종료">⏻</button>
```

### 6.2 `dual-action-send-codex :: disabled-without-reason` FAIL

원인: 세션 없을 때 send-codex가 disabled되는데 왜 disabled인지 사용자가 모름.

해결: dual-terminals 패널에서 disabled 상태일 때 aria-label 추가:
```js
btn.setAttribute("aria-label", "세션을 먼저 시작하세요 — Start 버튼을 누르세요");
```

### 6.3 `header-mode-pro :: click-no-activity` FAIL

**가장 위험한 결함**. Mode toggle을 클릭했는데 DOM 변화도, network request도 없음 → 사용자에게 "꿀먹은" UX.

원인 가능성:
- mode toggle handler가 무한 early-return (이미 같은 mode인 경우 등) — 코드 path 디버깅
- handler가 throw했지만 try/catch에 묻힘 — console.error 미감지 케이스
- DOM 변경이 outside `<body>` (e.g., `<html>` attribute change) — observer 범위 밖

해결:
- handler 함수에서 명시적 DOM mutation 추가 (`document.body.setAttribute("data-mode-changed", Date.now())`)
- 또는 `harness:mode-changed` CustomEvent 발사 + UI 업데이트 후크

### 6.4 `click-console-error` FAIL

원인: handler가 `TypeError: X is undefined` 같은 silent error 발생.

해결: console.error stack trace 확인 (manifest.errors[]에 200자까지 캡처). 보통:
- store가 expected slice 갖고 있다고 가정했는데 비어 있음
- DOM element를 querySelector로 못 찾음 (race condition)

### 6.5 모든 cell ERR

서버 부트 자체 실패 — `npm run start`로 별도 부트 시도해서 진단.

---

## 7. 산출물 commit 정책

- ✅ `manifest.json`: **항상 commit** (line-friendly diff로 버튼 회귀 추적)

PR 첨부 패턴:
```markdown
## Button integrity (UI-P13)

Run: docs/reports/2026-05-04-ui-p13-buttons-pr-1234/

| Metric | Value |
|---|---|
| Cells passed | 4/4 |
| Buttons passed | 36/36 (16 skipped on legacy) |
| Wall time | 4.5s |

manifest: [manifest.json](.../manifest.json)
```

---

## 8. CI 통합

P13-d에서 `.github/workflows/visual-button-live.yml` workflow_dispatch만 추가 (UI-P10/P11/P12와 동일 정책).

---

## 9. 후속 라운드 연결

| 다음 라운드 | UI-P13이 제공하는 것 |
|---|---|
| UI-Doc-Gov | button manifest 형식 + commit 정책 |
| UI-FirstRun | first-run welcome overlay button도 같은 검증 받아야 |
| 모든 후속 button 추가 PR | 추가 즉시 catalog 갱신 + manifest 회귀 확인 |

`scripts/visual-live/button-catalog.js`에 button 추가는 frozen-list 변경 — 항상 PR review로 명시. catalog test가 자동으로 shape contract 강제.

---

## 10. 변경 이력

- **2026-05-04**: 초판 (UI-P13-c 슬라이스 일부)
